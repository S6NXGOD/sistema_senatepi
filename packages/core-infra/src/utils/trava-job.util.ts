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
export const JOB_SICONFI_SYNC = 'siconfi-sync';
/**
 * A RELEITURA DE INSTÂNCIAS QUE A TELA DE PROCESSOS DISPARA — trava própria.
 *
 * Ela usava `JOB_DATAJUD_SYNC`, com TTL de 10 minutos. Se alguém abrisse a
 * lista às 02:00 com fila pendente, o cron encontrava a trava ocupada e
 * desistia da NOITE INTEIRA, sem tentar de novo e sem rastro no banco (auditoria
 * dos robôs, 13/09/2026). A tela nunca pode derrubar a varredura noturna: com
 * nome próprio e `cedeA: JOB_DATAJUD_SYNC`, o pior que acontece é a tela esperar.
 */
export const JOB_DATAJUD_REAVALIAR = 'datajud-reavaliar';

/** Identidade desta instância da API. Sobrevive ao job, não ao processo. */
const INSTANCIA_ID = randomUUID();

export interface OpcoesTrava {
  /**
   * Validade da trava. Precisa ser maior que a pior duração plausível do job:
   * expirar durante a execução deixaria uma segunda réplica entrar junto.
   */
  ttlMinutos: number;
  /**
   * Nome de OUTRA trava diante da qual este job desiste.
   *
   * É prioridade, não exclusão mútua: o job de baixo cede ao de cima, e o de
   * cima nunca pergunta pelo de baixo. A conferência é uma leitura separada da
   * tomada, então existe uma janela de milissegundos em que os dois podem
   * começar juntos — aceitável aqui, porque a fila de cota do CNJ já é serial e
   * uma sobreposição só atrasa, sem estourar nada. Fechar essa janela exigiria
   * mudar a consulta de tomada, que é a que sustenta a varredura noturna.
   */
  cedeA?: string;
  /**
   * Nome de OUTRA trava pela qual este job ESPERA, em vez de desistir.
   *
   * POR QUE NÃO BASTAVA O `cedeA`. Ele pula a vez, e pular a vez de um cron
   * DIÁRIO é perder a noite inteira. Medido em 03/11/2026 sobre 30 noites: em
   * **3 delas (10%)** a varredura do DataJud ainda estava rodando às 05:00,
   * quando a do Diário começa — 207, 197 e 208 minutos, contra uma mediana de
   * 101. O p90 (197min) já estoura a janela de 180 entre os dois horários.
   *
   * Nessas três noites as duas rodadas disputaram a MESMA cota do CNJ (20
   * consultas por minuto, serial e compartilhada) — é a origem dos 38% de 429
   * que já custaram uma colheita.
   *
   * Esperar é melhor que pular PORQUE A SEGUNDA RODADA AINDA VALE: o Diário
   * publica em D+0 e perder a noite custa prazo; começar 40 minutos mais tarde
   * não custa nada. Quem não pode esperar (uma tela com gente olhando) usa
   * `cedeA`.
   */
  esperaPor?: string;
  /**
   * Teto da espera, em minutos. Obrigatório junto com `esperaPor`.
   *
   * Espera sem teto é job que some: se o outro travar e a linha ficar até
   * expirar, este ficaria parado o TTL inteiro do vizinho. Estourado o teto,
   * ele **roda assim mesmo** — a cota do CNJ é serial, então sobreposição
   * atrasa mas não estoura, e deixar o Diário sem leitura é o único desfecho
   * que custa prazo.
   */
  esperaMaxMinutos?: number;
}

/**
 * Roda `tarefa` apenas se conseguir a trava. Devolve `executou: false` quando
 * outra execução já a detém.
 *
 * Erro ao TOMAR a trava propaga em vez de virar "pulei": um robô que não roda
 * porque o banco caiu precisa aparecer como falha, não como decisão.
 */
/** Quanto tempo entre duas perguntas "a outra trava já saiu?". */
const INTERVALO_DA_ESPERA_MS = 60_000;

/** `setTimeout` como promessa — só para a espera abaixo ficar legível. */
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function comTravaDeJob<T>(
  prisma: PrismaClient,
  nome: string,
  logger: Logger,
  { ttlMinutos, cedeA, esperaPor, esperaMaxMinutos }: OpcoesTrava,
  tarefa: () => Promise<T>,
): Promise<{ executou: true; resultado: T } | { executou: false }> {
  /*
    A FILA DOS CRONS — este job espera o vizinho terminar antes de começar.

    Pergunta a cada minuto, e não num laço apertado: o que se espera aqui dura
    dezenas de minutos, e uma consulta por minuto é barato o bastante para não
    aparecer em lugar nenhum.
  */
  if (esperaPor && esperaMaxMinutos) {
    const ate = Date.now() + esperaMaxMinutos * 60_000;
    let avisou = false;
    for (;;) {
      const vigente = await prisma.$queryRaw<{ vigente: number }[]>`
        SELECT 1 AS "vigente" FROM travas_job
         WHERE "nome" = ${esperaPor} AND "expira_em" >= now()
         LIMIT 1
      `;
      if (!vigente.length) break;
      if (Date.now() >= ate) {
        logger.warn(
          `[${nome}] A trava "${esperaPor}" não saiu em ${esperaMaxMinutos}min — ` +
            'começando assim mesmo, para não perder a rodada.',
        );
        break;
      }
      if (!avisou) {
        logger.log(`[${nome}] "${esperaPor}" ainda está rodando — aguardando a vez.`);
        avisou = true;
      }
      await dormir(INTERVALO_DA_ESPERA_MS);
    }
  }

  if (cedeA) {
    // Leitura simples e separada, e não um INSERT condicional: a consulta de
    // tomada abaixo é a que já derrubou a varredura noturna uma vez (o `::int`),
    // e não se mexe nela sem um Postgres para provar. Ver `OpcoesTrava.cedeA`.
    const vigente = await prisma.$queryRaw<{ vigente: number }[]>`
      SELECT 1 AS "vigente" FROM travas_job
       WHERE "nome" = ${cedeA} AND "expira_em" >= now()
       LIMIT 1
    `;
    if (vigente.length) {
      logger.warn(`[${nome}] A trava "${cedeA}" está vigente — este job cede a vez.`);
      return { executou: false };
    }
  }

  const donos = await prisma.$queryRaw<{ dono_id: string }[]>`
    INSERT INTO travas_job ("nome", "dono_id", "expira_em")
    -- O ::int NÃO é enfeite. O Prisma manda todo number de $queryRaw como int8
    -- (bigint), e make_interval só tem assinatura com int: sem a conversão o
    -- Postgres responde 42883 ("função não existe") e a trava falha SEMPRE — o
    -- que derrubava a varredura noturna inteira, já que erro ao tomar a trava
    -- propaga de propósito (ver o comentário acima).
    VALUES (${nome}, ${INSTANCIA_ID}, now() + make_interval(mins => ${ttlMinutos}::int))
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
