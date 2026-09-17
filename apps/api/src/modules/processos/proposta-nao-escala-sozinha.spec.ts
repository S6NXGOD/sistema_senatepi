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

describe('a proposta esquecida que vira tarefa sozinha', () => {
  /** O controle: sem ele, os testes abaixo poderiam estar passando no vazio. */
  it('com o prazo NOSSO, a rede funciona como sempre funcionou', async () => {
    const { caixa, correlacao, item } = caixaCom([proposta('p-nossa', REPLICA, 6)]);

    await expect(caixa.escalarEsquecidas()).resolves.toBe(1);
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledWith('p-nossa', 'u-murilo', true);
    expect(item('p-nossa').compromissoId).toBe('comp-1');
  });

  it('com TODO prazo do ato da parte contrária, não escala — e continua na caixa', async () => {
    const { caixa, correlacao, item } = caixaCom([proposta('p-alheia', PRAZO_DA_EXECUTADA, 6)]);

    await expect(caixa.escalarEsquecidas()).resolves.toBe(0);
    expect(correlacao.criarAtividadeDaProposta).not.toHaveBeenCalled();
    expect(item('p-alheia').compromissoId).toBeNull();
    // Proposta NÃO expira: sem dispensa, ela segue visível esperando gente.
    expect(item('p-alheia').tarefaDispensadaEm).toBeNull();
    expect(item('p-alheia').tarefaDispensadaMotivo).toBeNull();
  });

  /**
   * Tarefa nascida de um ato de mais de 30 dias nasce vencida — 47 das 48
   * "Verificação de Intimação / Prazo" eram assim. O corte fica na CONSULTA
   * porque o ato velho nunca mais vai escalar: no laço ele ocuparia uma das 50
   * vagas do lote toda noite, empurrando para fora a proposta nova.
   */
  it('o ato fora da janela de trabalho não escala, e também fica', async () => {
    const { caixa, correlacao, item } = caixaCom([proposta('p-velha', REPLICA, 35)]);

    await expect(caixa.escalarEsquecidas()).resolves.toBe(0);
    expect(correlacao.criarAtividadeDaProposta).not.toHaveBeenCalled();
    expect(item('p-velha').compromissoId).toBeNull();
    expect(item('p-velha').tarefaDispensadaEm).toBeNull();
  });

  /** Uma proposta segurada não segura as outras. */
  it('o lote continua: a de prazo alheio fica, a nossa vira tarefa', async () => {
    const { caixa, correlacao, item } = caixaCom([
      proposta('p-alheia', PRAZO_DA_EXECUTADA, 6),
      proposta('p-nossa', REPLICA, 4),
    ]);

    await expect(caixa.escalarEsquecidas()).resolves.toBe(1);
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledTimes(1);
    expect(item('p-nossa').compromissoId).toBe('comp-1');
    expect(item('p-alheia').compromissoId).toBeNull();
  });

  /**
   * O processo sem o sindicato nas partes (a ação é do filiado e nós só
   * patrocinamos) não tem polo a comparar: o prazo fica INDEFINIDO, e
   * indefinido escala, como indefinido sempre criou tarefa. Deixar de avisar um
   * prazo custa o prazo; avisar um que não era nosso custa um clique.
   */
  it('sem polo do sindicato no processo, a dúvida continua escalando', async () => {
    const { caixa, correlacao } = caixaCom([
      proposta('p-sem-polo', PRAZO_DA_EXECUTADA, 6, { processo: { partes: [] } }),
    ]);

    await expect(caixa.escalarEsquecidas()).resolves.toBe(1);
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledTimes(1);
  });
});
