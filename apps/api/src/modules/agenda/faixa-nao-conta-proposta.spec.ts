import { PendenciasService } from './pendencias.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A PROPOSTA NÃO É FALHA DA AUTOMAÇÃO (17/09/2026).
 *
 * `PUBLICACAO_SEM_TAREFA` existe para um caso só: o robô DEVERIA ter criado
 * tarefa e não criou. Por isso o where já excluía a publicação com tarefa e a
 * com dispensa carimbada — foi assim que os 1.243 falsos positivos de 07/09
 * morreram.
 *
 * Faltava a terceira: a publicação que virou PROPOSTA. Ela é uma decisão do
 * robô ("isto vai para uma pessoa decidir"), está na caixa de entrada do
 * advogado esperando, e no banco é idêntica ao buraco de verdade — com
 * providência, sem tarefa, sem dispensa. São 16 propostas abertas hoje, todas
 * contadas na faixa ao lado dos buracos reais. Uma faixa que mente em parte é
 * uma faixa que se aprende a ignorar inteira.
 */

type Linha = Record<string, any>;

const publicacao = (id: string, extra: Linha = {}): Linha => ({
  id,
  providencia: 'ELABORAR_MANIFESTACAO',
  dataDisponibilizacao: new Date('2026-09-16T00:00:00Z'),
  processoId: 'proc-1',
  processo: { numeroCNJ: '0000814-61.2026.5.22.0002' },
  compromissoId: null,
  tarefaPropostaEm: null,
  /*
    QUEM ESPERA NA CAIXA DE QUEM. A proposta só justifica sair da faixa quando
    tem DONO — é a caixa dele que avisa. Sem este campo no cenário, toda proposta
    do teste seria órfã, e o arquivo provaria o contrário do que descreve.
  */
  tarefaPropostaPara: null,
  tarefaDispensadaEm: null,
  ...extra,
});

/** Aplica o where de verdade: um teste que passa por não filtrar nada é o pior. */
function faixaCom(publicacoes: Linha[]) {
  const casa = (linha: Linha, where: Linha = {}): boolean =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === 'NOT') return !casa(linha, cond as Linha);
      // `OR` entrou quando a proposta ÓRFÃ voltou para a faixa. Sem tratá-lo, o
      // teste estouraria — e um matcher que ignora o filtro que mudou é um
      // teste que passa por não filtrar nada.
      if (campo === 'OR') return (cond as Linha[]).some((w) => casa(linha, w));
      // O recorte "meus processos" não é o assunto deste teste: tudo o que está
      // na lista é de quem pergunta.
      if (campo === 'processo') return true;
      const v = linha[campo];
      if (cond === null) return v == null;
      if (typeof cond !== 'object') return v === cond;
      if ('not' in cond) return cond.not === null ? v != null : v !== cond.not;
      throw new Error(`filtro não simulado: ${campo}`);
    });

  const prisma = {
    compromisso: { findMany: jest.fn(async () => []) },
    comunicacaoDjen: {
      findMany: jest.fn(async ({ where }: any) => publicacoes.filter((p) => casa(p, where))),
    },
    // Este arquivo é sobre a PUBLICAÇÃO na faixa; o andamento sem decisão é o
    // outro tipo, e tem arquivo próprio (`alerta-no-lugar-da-tarefa.spec.ts`).
    movimentacaoProcessual: { findMany: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => []) },
    refreshToken: { groupBy: jest.fn(async () => []) },
    auditoria: { groupBy: jest.fn(async () => []) },
  };
  return { avisos: new PendenciasService(prisma as never), prisma };
}

describe('a faixa só conta o que o robô deixou passar', () => {
  it('a publicação que virou proposta não entra na contagem', async () => {
    const { avisos } = faixaCom([
      publicacao('esperando-gente', {
        tarefaPropostaEm: new Date('2026-09-16T09:00:00Z'),
        tarefaPropostaPara: 'u-murilo',
      }),
    ]);

    expect(await avisos.minhas('u-murilo')).toEqual({ pendencias: [], total: 0 });
  });

  /** O controle: o buraco de verdade continua avisando. */
  it('a que ninguém decidiu continua contando', async () => {
    const { avisos } = faixaCom([publicacao('buraco')]);

    const r = await avisos.minhas('u-murilo');
    expect(r.total).toBe(1);
    expect(r.pendencias[0].tipo).toBe('PUBLICACAO_SEM_TAREFA');
    expect(r.pendencias[0].exemplos[0].id).toBe('buraco');
  });

  /** Lado a lado, só o buraco aparece — e o número tem de bater com a lista. */
  it('com proposta e buraco no mesmo processo, conta um', async () => {
    const { avisos } = faixaCom([
      publicacao('proposta-1', {
        providencia: 'AVALIAR_RECURSO',
        tarefaPropostaEm: new Date('2026-09-15T09:00:00Z'),
        tarefaPropostaPara: 'u-murilo',
      }),
      publicacao('buraco'),
      publicacao('ja-decidida', { tarefaDispensadaEm: new Date('2026-09-15T09:00:00Z') }),
      publicacao('com-tarefa', { compromissoId: 'comp-1' }),
    ]);

    const r = await avisos.minhas('u-murilo');
    expect(r.total).toBe(1);
    expect(r.pendencias[0].exemplos.map((e) => e.id)).toEqual(['buraco']);
  });

  /**
   * A EXCEÇÃO QUE FALTAVA: A PROPOSTA SEM DONO.
   *
   * O robô abre proposta sem destinatário quando o ato do DJEN lista os
   * advogados e não diz de quem cada um é. A justificativa para tirar proposta
   * da faixa — "quem tem proposta esperando já é avisado pela própria caixa" —
   * não alcança essa: `listar` filtra por `tarefaPropostaPara: usuarioId`, e a
   * órfã só aparece no escopo `?todas=1`, que exige perfil E que alguém se
   * lembre de trocar o filtro. Tirá-la da faixa não a tornaria mais silenciosa;
   * tornaria-a invisível.
   */
  it('a proposta que ninguém recebeu continua na faixa', async () => {
    const { avisos } = faixaCom([
      publicacao('orfa', {
        tarefaPropostaEm: new Date('2026-09-15T09:00:00Z'),
        tarefaPropostaPara: null,
      }),
    ]);

    const r = await avisos.minhas('u-murilo');
    expect(r.total).toBe(1);
    expect(r.pendencias[0].exemplos[0].id).toBe('orfa');
  });
});
