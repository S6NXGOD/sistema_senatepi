import { DjenController } from './djen.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "CRIAR TAREFA" NUMA CÓPIA DO MESMO ATO (15/09/2026).
 *
 * O DJEN manda uma comunicação por destinatário, com o mesmo link: a do
 * reclamante e a da reclamada são o mesmo ato. A correlação e a caixa já as
 * tratavam assim; `POST /djen/publicacoes/:id/tarefa` não, e criava uma segunda
 * tarefa enquanto a irmã já tinha a sua, ou continuava na caixa como proposta.
 *
 * O banco falso aplica os filtros que a rota manda, e recusa o que não conhece.
 */

const LINK = 'https://comunica.pje.jus.br/consulta/certidao/ato-11-09';

type Pub = Record<string, any>;

const pub = (id: string, extra: Pub = {}): Pub => ({
  id,
  processoId: 'proc-1',
  providencia: 'ELABORAR_MANIFESTACAO',
  link: LINK,
  compromissoId: null,
  tarefaPropostaEm: null,
  tarefaDispensadaEm: null,
  tarefaDispensadaMotivo: null,
  tarefaDecididaEm: null,
  tarefaDecididaPor: null,
  ...extra,
});

function montar(publicacoes: Pub[], compromissos: Record<string, string> = {}) {
  const comCompromisso = (p: Pub) => ({
    ...p,
    compromisso: p.compromissoId ? { id: p.compromissoId, status: compromissos[p.compromissoId] ?? 'PENDENTE' } : null,
  });
  const casa = (p: Pub, where: Pub): boolean =>
    Object.entries(where).every(([campo, cond]) => {
      if (campo === 'id') {
        if (typeof cond === 'string') return p.id === cond;
        if (cond.not !== undefined) return p.id !== cond.not;
        if (cond.in) return cond.in.includes(p.id);
      }
      if (['processoId', 'link', 'tarefaDispensadaMotivo'].includes(campo) && typeof cond === 'string') return p[campo] === cond;
      if (cond === null) return p[campo] === null;
      throw new Error(`filtro não simulado: ${campo}`);
    });

  const prisma = {
    comunicacaoDjen: {
      findUnique: jest.fn(async ({ where }: any) => {
        const p = publicacoes.find((x) => x.id === where.id);
        return p ? comCompromisso(p) : null;
      }),
      findMany: jest.fn(async ({ where }: any) => publicacoes.filter((p) => casa(p, where)).map(comCompromisso)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(publicacoes.find((p) => p.id === where.id)!, data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const alvo = publicacoes.filter((p) => casa(p, where));
        alvo.forEach((p) => Object.assign(p, data));
        return { count: alvo.length };
      }),
    },
  };
  const correlacao = { criarAtividadeDaProposta: jest.fn(async () => 'comp-novo') };
  const ctrl = new DjenController(prisma as never, {} as never, {} as never, {} as never, {} as never, correlacao as never);
  const porId = (id: string) => publicacoes.find((p) => p.id === id)!;
  return { ctrl, prisma, correlacao, porId };
}

const COORDENACAO = { id: 'u-coord' } as never;

describe('POST /djen/publicacoes/:id/tarefa com a cópia do mesmo ato', () => {
  it('a irmã já tem tarefa aberta: liga a esta, devolve a que existe e carimba a decisão da proposta', async () => {
    const { ctrl, correlacao, porId } = montar([
      pub('reclamante', { compromissoId: 'comp-1' }),
      pub('reclamada', { tarefaPropostaEm: new Date('2026-09-14T08:00:00Z') }),
    ]);
    await expect(ctrl.tarefaDaPublicacao('reclamada', COORDENACAO)).resolves.toEqual({ compromissoId: 'comp-1', criada: false });
    expect(correlacao.criarAtividadeDaProposta).not.toHaveBeenCalled();
    expect(porId('reclamada')).toMatchObject({ compromissoId: 'comp-1', tarefaDecididaPor: 'u-coord' });
    expect(porId('reclamada').tarefaDecididaEm).toBeInstanceOf(Date);
  });

  it('a tarefa da irmã foi concluída: o trabalho voltou a existir, e a tarefa nova nasce', async () => {
    const { ctrl, correlacao } = montar(
      [pub('reclamante', { compromissoId: 'comp-1' }), pub('reclamada')],
      { 'comp-1': 'CONCLUIDO' },
    );
    await expect(ctrl.tarefaDaPublicacao('reclamada', COORDENACAO)).resolves.toEqual({ compromissoId: 'comp-novo', criada: true });
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledWith('reclamada', null);
  });

  it('sem tarefa: cria uma; a irmã na caixa sai com a mesma decisão, a que seguia herda, a recusada fica', async () => {
    const { ctrl, correlacao, porId } = montar([
      pub('clicada'),
      pub('na-caixa', { tarefaPropostaEm: new Date('2026-09-14T08:00:00Z') }),
      pub('seguidora', { tarefaDispensadaEm: new Date('2026-09-14T08:00:00Z'), tarefaDispensadaMotivo: 'COPIA_DO_MESMO_ATO' }),
      pub('recusada', {
        tarefaPropostaEm: new Date('2026-09-12T08:00:00Z'),
        tarefaDispensadaEm: new Date('2026-09-13T10:00:00Z'),
        tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO',
      }),
      pub('outro-ato', { link: 'https://comunica.pje.jus.br/consulta/certidao/outro', tarefaPropostaEm: new Date('2026-09-14T08:00:00Z') }),
    ]);

    await expect(ctrl.tarefaDaPublicacao('clicada', COORDENACAO)).resolves.toEqual({ compromissoId: 'comp-novo', criada: true });
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledTimes(1);
    expect(porId('clicada')).toMatchObject({ compromissoId: 'comp-novo', tarefaDecididaPor: null });
    expect(porId('na-caixa')).toMatchObject({ compromissoId: 'comp-novo', tarefaDecididaPor: 'u-coord' });
    expect(porId('seguidora')).toMatchObject({ compromissoId: 'comp-novo', tarefaDecididaPor: null });
    expect(porId('recusada')).toMatchObject({ compromissoId: null, tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO' });
    expect(porId('outro-ato')).toMatchObject({ compromissoId: null, tarefaDecididaPor: null });
  });

  it('publicação sem link: o caminho de sempre, sem procurar irmã', async () => {
    const { ctrl, prisma } = montar([pub('sem-link', { link: null })]);
    await expect(ctrl.tarefaDaPublicacao('sem-link', COORDENACAO)).resolves.toEqual({ compromissoId: 'comp-novo', criada: true });
    expect(prisma.comunicacaoDjen.findMany).not.toHaveBeenCalled();
    expect(prisma.comunicacaoDjen.updateMany).not.toHaveBeenCalled();
  });

  /** GET /djen/publicacoes/:id: a tela precisa saber da tarefa da irmã para oferecer "Abrir", e não "Criar". */
  it('a leitura da publicação diz a tarefa da cópia do mesmo ato, a aberta primeiro', async () => {
    const comTarefas = {
      comunicacaoDjen: {
        findUnique: jest.fn(async () => ({
          id: 'reclamada', link: LINK, compromissoId: null, processo: { id: 'proc-1', numeroCNJ: '00008146120265220002' },
        })),
        findMany: jest.fn(async ({ where }: any) => {
          expect(where).toEqual({ processoId: 'proc-1', link: LINK, id: { not: 'reclamada' }, compromissoId: { not: null } });
          return [
            { compromisso: { id: 'comp-velha', titulo: 'Réplica', status: 'CONCLUIDO', inicio: new Date('2026-08-20T12:00:00Z') } },
            { compromisso: { id: 'comp-1', titulo: 'Réplica', status: 'PENDENTE', inicio: new Date('2026-09-16T12:00:00Z') } },
          ];
        }),
      },
    };
    const ctrl = new DjenController(comTarefas as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(ctrl.umaPublicacao('reclamada')).resolves.toMatchObject({
      id: 'reclamada',
      tarefaDoMesmoAto: { id: 'comp-1', status: 'PENDENTE' },
    });

    comTarefas.comunicacaoDjen.findUnique.mockResolvedValueOnce({
      id: 'propria', link: LINK, compromissoId: 'comp-9', processo: { id: 'proc-1', numeroCNJ: '00008146120265220002' },
    } as never);
    await expect(ctrl.umaPublicacao('propria')).resolves.toMatchObject({ tarefaDoMesmoAto: null });
    expect(comTarefas.comunicacaoDjen.findMany).toHaveBeenCalledTimes(1);
  });

  it('dois toques na mesma publicação: o segundo devolve a tarefa que o primeiro criou', async () => {
    const { ctrl, correlacao } = montar([pub('clicada'), pub('irma')]);
    await ctrl.tarefaDaPublicacao('clicada', COORDENACAO);
    await expect(ctrl.tarefaDaPublicacao('irma', COORDENACAO)).resolves.toEqual({ compromissoId: 'comp-novo', criada: false });
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledTimes(1);
  });
});
