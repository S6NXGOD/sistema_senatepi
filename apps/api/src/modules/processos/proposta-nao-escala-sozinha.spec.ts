import { CaixaDePropostasService } from './caixa-de-propostas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A REDE DA CAIXA DE ENTRADA TEM DOIS FUROS A MENOS (17/09/2026).
 *
 * A proposta com prazo que ninguém responde em três dias vira tarefa sozinha —
 * o modo de falhar "ninguém abriu a caixa" não pode custar um prazo. Só que a
 * régua era "tem prazo escrito", a mesma que já tinha colocado "Juntar
 * documentos" na agenda por causa de um prazo de 15 dias da empresa executada
 * (0001381-91.2023.5.22.0101). O ato foi para a caixa porque a prova NÃO
 * fechou; deixar o relógio fechá-la três dias depois é criar pela porta dos
 * fundos a tarefa que a porta da frente recusou.
 *
 * E PROPOSTA NÃO EXPIRA: o que estes testes cobram é que ela FIQUE na caixa,
 * inteira, esperando gente. Nada de `tarefaDispensadaEm` — esse carimbo é o que
 * APAGA o item da caixa, e apagar é o contrário do que se quer.
 */

const DIA = 86_400_000;
const HOJE = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const diaDoDiario = (atras: number) => new Date(HOJE.getTime() - atras * DIA);

/** Ordem nossa, prazo nosso: escalar está certo. */
const REPLICA =
  'PODER JUDICIÁRIO ATO ORDINATÓRIO Intimo a parte autora a apresentar réplica ' +
  'no prazo de 15 dias.';

/**
 * Caso real 0001381-91.2023.5.22.0101 — o sindicato é AUTOR. A ordem para nós é
 * tomar ciência; o prazo de 15 dias é da executada. A advogada fechou a tarefa
 * escrevendo "Prazo direcionado à empresa Reclamada".
 */
const PRAZO_DA_EXECUTADA =
  'Fica V. Sa. intimado para tomar ciência da Decisão ID f94d451. Este Juízo ' +
  'determinou que a executada complementasse a documentação no prazo ' +
  'improrrogável de 15 (quinze) dias.';

type Linha = Record<string, any>;

const proposta = (id: string, texto: string, atras: number, extra: Linha = {}): Linha => ({
  id,
  processoId: 'proc-1',
  numeroProcesso: '00013819120235220101',
  texto,
  link: `https://comunica.pje.jus.br/consulta/certidao/${id}`,
  dataDisponibilizacao: diaDoDiario(atras),
  prazoMencionadoDias: 15,
  compromissoId: null,
  // Proposta feita há cinco dias: já passou dos três da rede.
  tarefaPropostaEm: new Date(Date.now() - 5 * DIA),
  tarefaPropostaPara: 'u-murilo',
  tarefaDispensadaEm: null,
  tarefaDispensadaMotivo: null,
  // O sindicato é o AUTOR deste processo.
  processo: { partes: [{ polo: 'ATIVO' }] },
  ...extra,
});

function caixaCom(propostas: Linha[]) {
  const igual = (a: unknown, b: unknown) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as Date).getTime() === new Date(b as Date).getTime()
      : a === b;

  const casa = (linha: Linha, where: Linha = {}): boolean =>
    Object.entries(where).every(([campo, cond]) => {
      const v = linha[campo];
      if (cond === null) return v == null;
      if (cond instanceof Date || typeof cond !== 'object') return igual(v, cond);
      return Object.entries(cond as Linha).every(([op, alvo]) => {
        switch (op) {
          case 'not':
            return alvo === null ? v != null : !igual(v, alvo);
          case 'gte':
            return v != null && v >= alvo;
          case 'lt':
            return v != null && v < alvo;
          default:
            throw new Error(`operador não simulado: ${campo}.${op}`);
        }
      });
    });

  const prisma = {
    comunicacaoDjen: {
      findMany: jest.fn(async ({ where }: any) => propostas.filter((p) => casa(p, where))),
      findFirst: jest.fn(async () => null), // nenhuma cópia do mesmo ato neste mundo
      update: jest.fn(async ({ where, data }: any) =>
        Object.assign(propostas.find((p) => p.id === where.id)!, data)),
    },
  };
  const correlacao = { criarAtividadeDaProposta: jest.fn(async () => 'comp-1') };
  const caixa = new CaixaDePropostasService(prisma as never, correlacao as never);
  const item = (id: string) => propostas.find((p) => p.id === id)!;
  return { caixa, correlacao, prisma, item };
}

describe('o relógio cobra a decisão, e não assina tarefa por ninguém', () => {
  /**
   * A MUDANÇA DE 21/09/2026, e o número que a decidiu.
   *
   * Das TRÊS atividades que o relógio já criou na produção, nenhuma virou
   * trabalho: duas fecharam com "Analisado — nada a protocolar" e uma continua
   * aberta. Uma delas é a que o dono mandou por print — "Criada automaticamente:
   * a proposta mencionava prazo e ficou três dias sem resposta na caixa de
   * entrada", fechada com "Intimação direcionada à empresa".
   *
   * A rede continua existindo; o que mudou é o que ela produz. Antes: uma
   * atividade com data na agenda de alguém. Agora: um número no log, e a
   * proposta seguindo na caixa com o selo "parada há Nd", que já pede gente.
   */
  it('com o prazo NOSSO, ela CONTA e não cria atividade nenhuma', async () => {
    const { caixa, correlacao, item } = caixaCom([proposta('p-nossa', REPLICA, 6)]);

    await expect(caixa.cobrarEsquecidas()).resolves.toBe(1);
    expect(correlacao.criarAtividadeDaProposta).not.toHaveBeenCalled();
    expect(item('p-nossa').compromissoId).toBeNull();
  });

  /** E NADA É ESCRITO na publicação — nem a dispensa, que a apagaria da caixa. */
  it('nenhuma coluna da proposta é tocada', async () => {
    const { caixa, prisma, item } = caixaCom([proposta('p-nossa', REPLICA, 6)]);

    await caixa.cobrarEsquecidas();
    expect(prisma.comunicacaoDjen.update).not.toHaveBeenCalled();
    expect(item('p-nossa').tarefaDispensadaEm).toBeNull();
    expect(item('p-nossa').tarefaPropostaPara).toBe('u-murilo');
  });

  /**
   * A CONTAGEM É DE QUEM ESPERA DECISÃO DE VERDADE. As duas exclusões de
   * 17/09/2026 continuam valendo: cobrar por um ato cujo prazo é todo da outra
   * parte é pedir à pessoa que decida o que o robô já sabe.
   */
  it('o prazo todo da parte contrária não entra na cobrança', async () => {
    const { caixa, item } = caixaCom([proposta('p-alheia', PRAZO_DA_EXECUTADA, 6)]);

    await expect(caixa.cobrarEsquecidas()).resolves.toBe(0);
    expect(item('p-alheia').compromissoId).toBeNull();
    expect(item('p-alheia').tarefaDispensadaEm).toBeNull();
  });

  it('o ato fora da janela de trabalho também não é cobrança', async () => {
    const { caixa } = caixaCom([proposta('p-velha', REPLICA, 35)]);

    await expect(caixa.cobrarEsquecidas()).resolves.toBe(0);
  });

  it('conta as que pedem gente e ignora as que não pedem, no mesmo lote', async () => {
    const { caixa } = caixaCom([
      proposta('p-alheia', PRAZO_DA_EXECUTADA, 6),
      proposta('p-nossa', REPLICA, 4),
      proposta('p-velha', REPLICA, 35),
    ]);

    await expect(caixa.cobrarEsquecidas()).resolves.toBe(1);
  });

  /**
   * Sem o sindicato nas partes não há polo a comparar e o prazo fica INDEFINIDO.
   * Indefinido continua CONTANDO: não saber de quem é o prazo é exatamente o
   * caso em que se quer uma pessoa olhando.
   */
  it('sem polo do sindicato, a dúvida vira cobrança', async () => {
    const { caixa } = caixaCom([
      proposta('p-sem-polo', PRAZO_DA_EXECUTADA, 6, { processo: { partes: [] } }),
    ]);

    await expect(caixa.cobrarEsquecidas()).resolves.toBe(1);
  });
});
