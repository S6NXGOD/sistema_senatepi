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
   * Validade da trava — agora é um DETECTOR DE MORTE, não um orçamento.
   *
   * Até 03/11/2026 este número tinha de cobrir a pior duração plausível do job,
   * e por isso vivia errado: a varredura do DataJud chegou a 208 minutos contra
   * um TTL de 180, e naquele intervalo a linha estava livre para outra réplica
   * entrar e varrer o acervo em paralelo. Subir o número só empurrava o
   * problema, porque a duração depende do CNJ e não de nós — nas noites de 28 e
   * 29/10 a consulta levou 149 e 160 segundos em média, contra 33 em 03/11.
   *
   * A trava passou a BATER O PONTO (ver `BATIDA_DA_TRAVA_MS`): enquanto o job
   * vive, ela se renova sozinha. O prazo deixou de medir "quanto o job demora"
   * e passou a medir **quanto tempo de silêncio basta para dar o job por
   * morto** — por isso pode ser curto, e quanto mais curto, mais rápido uma
   * queda no meio da madrugada libera a vez para quem está na fila.
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
   * Nome — ou nomes — de outras travas pelas quais este job ESPERA a vez.
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
   *
   * A LISTA É A ORDEM DE PRIORIDADE DO SISTEMA, decidida pelo dono em
   * 03/11/2026: *"a prioridade é CNJ e DataJud e depois os outros"*. As duas
   * fontes do CNJ vêm primeiro porque são as que trazem prazo; o SICONFI
   * (contas públicas) é número de referência e pode começar mais tarde sem
   * custo nenhum. Quem espera por vários só começa quando TODOS saírem.
   */
  esperaPor?: string | string[];
  /**
   * Trava de segurança da espera, em minutos — NÃO é um orçamento.
   *
   * Eram 90 minutos para o Diário, e estourado o teto ele começava junto com o
   * DataJud. Estava errado, e o dono apontou: *"nem que estoure o horário, mas
   * continue para que nenhum processo e atualização fique de fora"*. Começar
   * junto é justamente o que faz um processo ficar de fora — as duas rodadas
   * puxam da mesma cota do CNJ, e o 429 de uma é pago pela outra.
   *
   * Com a trava batendo o ponto, "vigente" passou a significar **vivo**, e
   * esperar enquanto o da frente vive não tem risco de espera infinita: morto
   * o vizinho, a linha expira em `ttlMinutos` e a vez sai sozinha. Este número
   * só existe para o caso patológico de uma trava que se renova sem o job
   * andar — e por isso é largo (horas), não apertado.
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

/**
 * DE QUANTO EM QUANTO TEMPO A TRAVA SE RENOVA enquanto o job roda.
 *
 * É o que transforma `expira_em` de prazo em sinal de vida. Sem a batida, uma
 * rodada mais longa que o próprio TTL solta a trava sozinha no meio do
 * caminho — foi o que aconteceu em três noites de outubro — e quem está na
 * fila entende "o da frente terminou" quando ele ainda está consultando o CNJ.
 *
 * Um minuto é barato (um UPDATE por minuto, numa tabela de 4 linhas) e deixa
 * folga larga: com TTL de 45 minutos, seria preciso perder 44 batidas seguidas
 * para a trava cair com o job vivo.
 */
const BATIDA_DA_TRAVA_MS = 60_000;

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

    UMA PERGUNTA POR NOME, e não um `= ANY($1)`: a consulta de tomada logo
    abaixo já derrubou a varredura noturna inteira por causa de um tipo que o
    Prisma manda diferente do que o Postgres espera (o `::int`), e não vale
    repetir o truque numa consulta que roda de madrugada sem ninguém olhando.
    Duas leituras por minuto numa tabela de quatro linhas não custam nada.
  */
  const filaDaFrente = typeof esperaPor === 'string' ? [esperaPor] : (esperaPor ?? []);
  if (filaDaFrente.length && esperaMaxMinutos) {
    const ate = Date.now() + esperaMaxMinutos * 60_000;
    const jaAvisados = new Set<string>();
    /** Quem, da fila da frente, ainda está vivo agora. */
    const quemEstaNaFrente = async (): Promise<string | null> => {
      for (const alvo of filaDaFrente) {
        const vigente = await prisma.$queryRaw<{ vigente: number }[]>`
          SELECT 1 AS "vigente" FROM travas_job
           WHERE "nome" = ${alvo} AND "expira_em" >= now()
           LIMIT 1
        `;
        if (vigente.length) return alvo;
      }
      return null;
    };
    const comecouAEsperar = Date.now();
    for (;;) {
      const naFrente = await quemEstaNaFrente();
      if (!naFrente) break;
      /*
        ESTOURAR O PRAZO NÃO É MOTIVO PARA COMEÇAR JUNTO — é motivo para
        desconfiar da trava. Com a batida de um minuto, uma trava vigente é um
        job VIVO; se ele está vivo há horas, ou o CNJ está lentíssimo (e aí
        esperar continua certo) ou a renovação virou mentira. O único desfecho
        pior que esperar é começar junto e as duas rodadas se atropelarem na
        cota, então aqui ele começa, mas o log diz que isto é anormal.
      */
      if (Date.now() >= ate) {
        logger.error(
          `[${nome}] "${naFrente}" está com a vez há ${esperaMaxMinutos} minutos e não ` +
            'soltou. A trava se renova a cada minuto enquanto o job vive, então isto ' +
            'significa job preso, não job demorado. Começando assim mesmo — mas as duas ' +
            'rodadas vão disputar a cota do CNJ.',
        );
        break;
      }
      if (!jaAvisados.has(naFrente)) {
        logger.log(
          `[${nome}] "${naFrente}" tem prioridade e ainda está rodando — esperando a vez. ` +
            'A rodada começa atrasada e nada fica de fora por isso.',
        );
        jaAvisados.add(naFrente);
      }
      await dormir(INTERVALO_DA_ESPERA_MS);
    }
    const esperou = Math.round((Date.now() - comecouAEsperar) / 60_000);
    if (esperou >= 1) {
      logger.log(`[${nome}] A vez saiu depois de ${esperou} minuto(s) de espera. Começando.`);
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

  /*
    A TRAVA BATE O PONTO ENQUANTO O JOB VIVE — 03/11/2026.

    Antes, o prazo era uma aposta na duração: se a rodada passasse dele, a
    linha se soltava sozinha e outra réplica entrava junto. Aconteceu em três
    noites de outubro (207, 197 e 208 minutos contra 180 de prazo), e a
    "solução" foi subir o número — que continua sendo aposta, porque a duração
    depende da velocidade do CNJ naquela noite, não de nós.

    Renovando a cada minuto, `expira_em >= now()` deixa de significar "dentro
    do prazo que eu chutei" e passa a significar **este job está vivo**. É isso
    que permite a rodada durar o que precisar durar sem ninguém entrar em cima,
    e é isso que a fila da frente lê para saber se pode começar.

    `unref` para o timer nunca ser motivo de o processo não terminar.
  */
  const batida = setInterval(() => {
    void prisma
      .$executeRaw`
        UPDATE travas_job
           SET "expira_em" = now() + make_interval(mins => ${ttlMinutos}::int)
         WHERE "nome" = ${nome} AND "dono_id" = ${INSTANCIA_ID}
      `
      .then((renovadas) => {
        if (!renovadas) {
          logger.error(
            `[${nome}] A trava não é mais nossa — outra execução a tomou enquanto esta ` +
              'rodava. Pode haver duas rodadas no ar, dobrando as chamadas ao CNJ.',
          );
        }
      })
      .catch((err: Error) => {
        // Uma batida perdida não é problema: o TTL dá folga para dezenas delas.
        logger.warn(`[${nome}] Falha ao renovar a trava: ${err.message}`);
      });
  }, BATIDA_DA_TRAVA_MS);
  batida.unref?.();

  try {
    return { executou: true, resultado: await tarefa() };
  } finally {
    clearInterval(batida);
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
