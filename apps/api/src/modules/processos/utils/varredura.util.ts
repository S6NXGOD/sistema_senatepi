import { Prisma, StatusProcesso } from '@prisma/client';

/**
 * QUEM O ROBÔ CONSULTA DE MADRUGADA.
 *
 * O DEFEITO QUE ISTO CONSERTA, encontrado na produção do SENATEPI no processo
 * 0001000-26.2022.5.22.0002.
 *
 * Ao encerrar um processo sozinho, o sistema grava na linha do tempo:
 *
 *     "Se a execução continuar, o robô reabre sozinho na próxima movimentação."
 *
 * Era MENTIRA — e não por pouco. O filtro anterior admitia ENCERRADO apenas
 * quando alguma instância seguia sem baixa. Um processo encerrado com TODAS as
 * instâncias baixadas — que é exatamente o estado em que o encerramento
 * automático o deixa — saía da varredura PARA SEMPRE. Nunca mais seria
 * consultado, então a "próxima movimentação" jamais chegaria, e a reabertura
 * prometida não tinha como acontecer. O sistema prometia vigiar e parava de
 * olhar no mesmo instante.
 *
 * `GANHO_EXECUCAO` TAMBÉM ESTAVA DE FORA, e este é pior: o status significa
 * "procedente, em fase de execução/cumprimento" — um processo VIVO, com prazo e
 * audiência — e mesmo assim o robô não o consultava. Quem ganhou a ação e está
 * executando era justamente quem parava de receber andamento.
 *
 * AS DUAS FAIXAS, e por que não basta consultar todo mundo todo dia:
 *
 *  · RÁPIDA (toda noite) — o que está vivo: ATIVO, PENDENTE, GANHO_EXECUCAO e
 *    o ENCERRADO que ainda tem instância sem baixa.
 *
 *  · LENTA (a cada `DIAS_RECHECAGEM_DORMENTE` dias) — o que está dormente:
 *    ENCERRADO com tudo baixado, ARQUIVADO, SUSPENSO, IMPROCEDENTE. Eles quase
 *    nunca se movem, mas "quase nunca" não é "nunca": a execução recomeça, o
 *    arquivado é desarquivado, o suspenso volta a correr.
 *
 * A faixa lenta existe por causa da COTA DO CNJ. Consultar todo o acervo
 * dormente toda noite multiplicaria as chamadas por um fator que cresce com a
 * idade do sindicato, para pegar um evento raro. Espaçando em N dias, o custo
 * diário vira `dormentes / N` e a execução que recomeça é notada dentro de uma
 * semana em vez de nunca.
 *
 * O QUE A FAIXA LENTA **NÃO** FAZ: mudar status por conta própria. Reabrir só
 * acontece com quem o ROBÔ encerrou (`ENCERRADO`); arquivado, suspenso e
 * improcedente são decisões da equipe, e o sistema não as desfaz — apenas
 * volta a mostrar o que o tribunal registrou, para uma PESSOA decidir.
 */

/**
 * De quantos em quantos dias um processo dormente é reconferido.
 *
 * Sete é o maior intervalo que ainda cabe na rotina semanal de um sindicato: se
 * a execução recomeçou na segunda, alguém vê antes da segunda seguinte. Menos
 * que isso não compra nada — nenhum prazo processual se perde por olhar num
 * sábado em vez de na sexta — e multiplica a conta com o CNJ.
 */
export const DIAS_RECHECAGEM_DORMENTE = 7;

const VIVOS: StatusProcesso[] = [
  StatusProcesso.ATIVO,
  StatusProcesso.PENDENTE,
  StatusProcesso.GANHO_EXECUCAO,
];

const DORMENTES: StatusProcesso[] = [
  StatusProcesso.ENCERRADO,
  StatusProcesso.ARQUIVADO,
  StatusProcesso.SUSPENSO,
  StatusProcesso.IMPROCEDENTE,
];

/**
 * O `where` da varredura.
 *
 * Recebe `agora` em vez de chamar `new Date()` por dentro: é o que torna a
 * regra testável sem depender do relógio de quem roda o teste.
 *
 * PRE_PROCESSUAL não aparece em nenhuma das listas e ainda assim é barrado duas
 * vezes: ele não tem NPU, e `numeroCNJ: { not: null }` é o cinto de segurança
 * para o caso de alguém mudar o status à mão.
 */
export function filtroDeVarredura(
  agora: Date,
  dias: number = DIAS_RECHECAGEM_DORMENTE,
): Prisma.ProcessoWhereInput {
  const corte = new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000);

  return {
    numeroCNJ: { not: null },
    OR: [
      // --- Faixa rápida: o que está vivo -----------------------------------
      { statusInterno: { in: VIVOS } },
      /**
       * O status é do PROCESSO, mas a baixa acontece por GRAU: o 2º grau
       * transita em julgado, o processo é encerrado — e o cumprimento de
       * sentença segue correndo no 1º grau, sem ninguém olhando. Foi o caso que
       * motivou a tabela de instâncias.
       */
      { statusInterno: StatusProcesso.ENCERRADO, instancias: { some: { baixada: false } } },

      // --- Faixa lenta: o que está dormente ---------------------------------
      {
        statusInterno: { in: DORMENTES },
        // Nunca sincronizado entra sempre: sem carimbo não há como afirmar que
        // já foi olhado, e o silêncio não pode valer por "está em dia".
        OR: [{ ultimaSincronizacao: null }, { ultimaSincronizacao: { lt: corte } }],
      },
    ],
  };
}
