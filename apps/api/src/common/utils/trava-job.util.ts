import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Trava de execução única para jobs agendados — no BANCO, não na memória.
 *
 * POR QUE ISTO EXISTE
 * Cada cron se protegia com um booleano de instância (`private rodando = false`).
 * Isso impede uma execução atrasada de pisar na seguinte DENTRO do mesmo
 * processo, e nada além: duas réplicas da API têm dois booleanos, e ambos valem
 * `false` às 02:00. As duas varreriam o acervo inteiro em paralelo — dobrando as
 * chamadas ao CNJ (que é exatamente o que a cadência de 2–3s existe para evitar)
 * e, como o dedup de movimentação é feito em memória, duplicando linhas.
 *
 * POR QUE NÃO `pg_try_advisory_lock`
 * Foi a primeira escolha e está errada aqui. A trava consultiva do Postgres é de
 * SESSÃO: ela pertence à conexão que a tomou. O Prisma trabalha com POOL, e não
 * há garantia de que o `pg_advisory_unlock` caia na mesma conexão do lock — se
 * cair em outra, ele devolve `false`, o cadeado continua preso na conexão
 * original e o job nunca mais roda. Prender tudo num `$transaction` resolveria a
 * conexão, mas manteria uma transação aberta durante a varredura inteira
 * (dezenas de minutos, com `sleep` no meio), o que segura conexão e atrapalha o
 * VACUUM.
 *
 * COMO FUNCIONA
 * Uma linha por job com prazo de validade. A tomada é um único `INSERT … ON
 * CONFLICT DO UPDATE … WHERE expira_em < now()` — atômico, então duas réplicas
 * disputando no mesmo instante têm exatamente uma vencedora, decidida pelo
 * Postgres e não por quem leu primeiro.
 *
 * O prazo é o que torna a trava à prova de queda: se o processo morrer no meio
 * do job, ninguém devolve a linha, mas ela expira sozinha. Por isso o TTL é
 * generoso em relação à duração do job e curto em relação ao intervalo entre
 * execuções — para um cron diário, uma execução perdida nunca bloqueia a
 * próxima.
 */

export const JOB_DATAJUD_SYNC = 'datajud-sync';
export const JOB_DJEN_SYNC = 'djen-sync';

/** Identidade desta instância da API. Sobrevive ao job, não ao processo. */
const INSTANCIA_ID = randomUUID();

export interface OpcoesTrava {
  /**
   * Validade da trava. Precisa ser maior que a pior duração plausível do job:
   * expirar durante a execução deixaria uma segunda réplica entrar junto.
   */
  ttlMinutos: number;
}

/**
 * Roda `tarefa` apenas se conseguir a trava. Devolve `executou: false` quando
 * outra execução já a detém.
 *
 * Erro ao TOMAR a trava propaga em vez de virar "pulei": um robô que não roda
 * porque o banco caiu precisa aparecer como falha, não como decisão.
 */
export async function comTravaDeJob<T>(
  prisma: PrismaClient,
  nome: string,
  logger: Logger,
  { ttlMinutos }: OpcoesTrava,
  tarefa: () => Promise<T>,
): Promise<{ executou: true; resultado: T } | { executou: false }> {
  const donos = await prisma.$queryRaw<{ dono_id: string }[]>`
    INSERT INTO travas_job ("nome", "dono_id", "expira_em")
    VALUES (${nome}, ${INSTANCIA_ID}, now() + make_interval(mins => ${ttlMinutos}))
    ON CONFLICT ("nome") DO UPDATE
       SET "dono_id"  = EXCLUDED."dono_id",
           "expira_em" = EXCLUDED."expira_em"
     WHERE travas_job."expira_em" < now()
    RETURNING "dono_id"
  `;

  // Sem linha devolvida = o WHERE do DO UPDATE barrou, ou seja, a trava vigente
  // ainda está no prazo e é de outra execução.
  if (donos[0]?.dono_id !== INSTANCIA_ID) {
    logger.warn(`[${nome}] Outra execução detém a trava — pulando esta rodada.`);
    return { executou: false };
  }

  try {
    return { executou: true, resultado: await tarefa() };
  } finally {
    // Devolver cedo é só cortesia — o prazo já garantiria a liberação. Mas sem
    // isto uma falha logo no início bloquearia uma nova tentativa manual pelo
    // TTL inteiro. O `dono_id` no WHERE impede devolver trava de outro.
    try {
      await prisma.$executeRaw`
        DELETE FROM travas_job WHERE "nome" = ${nome} AND "dono_id" = ${INSTANCIA_ID}
      `;
    } catch (err) {
      logger.error(`[${nome}] Falha ao liberar a trava: ${(err as Error).message}`);
    }
  }
}
