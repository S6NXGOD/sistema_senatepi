import { StatusCompromisso, UserRole } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AgendaController } from './agenda.controller';
import { AgendaService, type Leitor } from './agenda.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * AS PARTES DO PROCESSO SÓ VÃO PARA QUEM VÊ PROCESSOS — em TODA resposta da agenda.
 *
 * O corte chegou à listagem e ao detalhe e parou ali (revisão de 13/09/2026):
 * a resposta de cada escrita seguia com o cartão inteiro, partes com nome, polo
 * e filiado. Estes testes rodam o serviço com um banco falso e olham o `select`
 * que chegou ao banco em cada caminho.
 *
 * A rota de alertas, que também vazava, saiu inteira em 14/09/2026 (D20 da
 * rodada 3) — e com ela o teste que a cobria.
 */

const { PENDENTE, EM_ANDAMENTO, CONCLUIDO } = StatusCompromisso;

const TRIAGEM: Leitor = { id: 'tri1', role: UserRole.TRIAGEM, permissoes: null };
const ADVOGADO: Leitor = { id: 'u1', role: UserRole.ADVOGADO, permissoes: null };

function montar(atual: Record<string, unknown> = {}, historico: unknown = null) {
  const chamadas: { chave: string; args: any }[] = [];
  const linha = {
    id: 'c1',
    titulo: 'Elaborar manifestação',
    tipo: 'PRAZO',
    status: PENDENTE,
    inicio: new Date(Date.now() + 3 * 86_400_000),
    fim: new Date(Date.now() + 3 * 86_400_000 + 3_600_000),
    responsavelId: 'u1',
    processoId: null,
    filiadoId: null,
    atendimentoId: null,
    urgente: false,
    urgenteMotivo: null,
    dataOriginal: null,
    remarcacoes: 0,
    iniciadoEm: null,
    desfecho: null,
    concluidoEm: null,
    concluidoPor: null,
    ...atual,
  };
  const resposta = (chave: string, args: any) => {
    const [, metodo] = chave.split('.');
    if (chave === 'compromissoHistorico.findFirst') return historico;
    if (chave === 'compromissoResponsavel.findFirst') return { usuarioId: 'u1' };
    if (metodo === 'findMany') return [];
    if (metodo === 'count' || metodo === 'updateMany' || metodo === 'deleteMany') return { count: 1 };
    if (metodo === 'findUnique' || metodo === 'findFirst' || metodo === 'findUniqueOrThrow') return linha;
    if (metodo === 'update' || metodo === 'create' || metodo === 'upsert') return { ...linha, ...(args?.data ?? {}) };
    return null;
  };
  const prisma: any = new Proxy(
    {},
    {
      get(_a, modelo) {
        if (typeof modelo !== 'string' || modelo === 'then') return undefined;
        if (modelo === '$transaction') return async (cb: (tx: unknown) => unknown) => cb(prisma);
        return new Proxy(
          {},
          {
            get: (_m, metodo) =>
              typeof metodo !== 'string'
                ? undefined
                : async (args: any) => {
                    const chave = `${modelo}.${metodo}`;
                    chamadas.push({ chave, args });
                    return resposta(chave, args);
                  },
          },
        );
      },
    },
  );
  const audit = { registrar: jest.fn(async () => ({})) };
  const tipos = { garantirSlugValido: jest.fn(async () => undefined) };
  const servico = new AgendaService(prisma as never, audit as never, tipos as never);
  /** Os `select` de cartão que chegaram ao banco — os que têm o processo. */
  const cartoes = () =>
    chamadas.filter((c) => c.chave.startsWith('compromisso.') && c.args?.select?.processo).map((c) => c.args.select);
  return { servico, cartoes };
}

const ctx = (leitor?: Leitor) => ({ userId: 'u1', nome: 'Ana', leitor });

/** Cada escrita que devolve o cartão, com o estado de partida que ela aceita. */
const ESCRITAS: [string, Record<string, unknown>, unknown, (s: AgendaService, l?: Leitor) => Promise<unknown>][] = [
  [
    'criar',
    {},
    null,
    (s, l) =>
      s.criar(
        {
          titulo: 'Reunião com a diretoria',
          tipo: 'REUNIAO',
          inicio: new Date(Date.now() + 86_400_000).toISOString(),
          fim: new Date(Date.now() + 90_000_000).toISOString(),
          responsavelId: 'u1',
        } as never,
        ctx(l),
      ),
  ],
  ['editar', {}, null, (s, l) => s.atualizar('c1', { titulo: 'Novo título' } as never, ctx(l))],
  ['mudar status sem mudar nada', {}, null, (s, l) => s.mudarStatus('c1', { status: PENDENTE } as never, ctx(l))],
  ['iniciar', {}, null, (s, l) => s.mudarStatus('c1', { status: EM_ANDAMENTO } as never, ctx(l))],
  [
    'concluir',
    {},
    null,
    (s, l) => s.concluir('c1', { desfecho: 'PRAZO_CUMPRIDO', desfechoObs: 'Protocolo 123' } as never, ctx(l)),
  ],
  ['cancelar', {}, null, (s, l) => s.cancelar('c1', { categoria: 'NAO_COMPARECEU' } as never, ctx(l))],
  [
    'remarcar',
    {},
    null,
    (s, l) => s.remarcar('c1', { inicio: new Date(Date.now() + 5 * 86_400_000).toISOString() } as never, ctx(l)),
  ],
  [
    'desfazer a conclusão',
    { status: CONCLUIDO, desfecho: 'PRAZO_CUMPRIDO', concluidoPor: 'u1', concluidoEm: new Date(Date.now() - 20_000) },
    'HISTORICO_DA_CONCLUSAO',
    (s, l) => s.desfazerConclusao('c1', ctx(l)),
  ],
];

const historicoDe = (marca: unknown, atual: Record<string, unknown>) =>
  marca === 'HISTORICO_DA_CONCLUSAO'
    ? {
        metadata: {
          concluidoEm: (atual.concluidoEm as Date).toISOString(),
          de: PENDENTE,
          andamentoId: null,
          seguimentoCriado: null,
          preProcessualCriado: null,
          processoAntes: null,
          processoDepois: null,
          substituidas: [],
        },
      }
    : null;

describe('as escritas devolvem o cartão pelo leitor', () => {
  it.each(ESCRITAS)('%s: a Triagem recebe sem as partes', async (_nome, atual, marca, agir) => {
    const m = montar(atual, historicoDe(marca, atual));
    await agir(m.servico, TRIAGEM);
    const cartoes = m.cartoes();
    expect(cartoes.length).toBeGreaterThan(0);
    for (const sel of cartoes) {
      expect(sel.processo.select.numeroCNJ).toBe(true);
      expect(sel.processo.select).not.toHaveProperty('partes');
    }
  });

  it.each(ESCRITAS)('%s: o advogado recebe com as partes', async (_nome, atual, marca, agir) => {
    const m = montar(atual, historicoDe(marca, atual));
    await agir(m.servico, ADVOGADO);
    expect(m.cartoes().some((sel) => 'partes' in sel.processo.select)).toBe(true);
  });

  /** A audiência que o radar agenda chama `criar` sem leitor: nada muda para ela. */
  it('chamada interna, sem leitor, segue com o cartão inteiro', async () => {
    const m = montar();
    await ESCRITAS[0][3](m.servico, undefined);
    expect(m.cartoes().every((sel) => 'partes' in sel.processo.select)).toBe(true);
  });
});

describe('o controller leva perfil e matriz no contexto, sem consulta', () => {
  const usuario: AuthUser = {
    id: 'tri1',
    email: 'balcao@sindicato.org',
    nome: 'Bia',
    role: UserRole.TRIAGEM,
    permissoes: { agenda: 'EDITAR' },
  };
  const req = { ip: '10.0.0.1', headers: { 'user-agent': 'navegador' } } as never;
  const esperado = {
    ip: '10.0.0.1',
    userAgent: 'navegador',
    userId: 'tri1',
    nome: 'Bia',
    leitor: { id: 'tri1', role: UserRole.TRIAGEM, permissoes: { agenda: 'EDITAR' } },
  };

  it('toda escrita recebe o leitor', async () => {
    const fns = new Map<string | symbol, jest.Mock>();
    const servico: any = new Proxy(
      {},
      {
        get: (_a, k) => {
          if (k === 'then') return undefined;
          if (!fns.has(k)) fns.set(k, jest.fn(async () => ({})));
          return fns.get(k);
        },
      },
    );
    const c = new AgendaController(servico);
    const dto = {} as never;
    await c.criar(dto, usuario, req);
    expect(servico.criar).toHaveBeenCalledWith(dto, esperado);
    await c.atualizar('c1', dto, usuario, req);
    expect(servico.atualizar).toHaveBeenCalledWith('c1', dto, esperado);
    await c.mudarStatus('c1', dto, usuario, req);
    expect(servico.mudarStatus).toHaveBeenCalledWith('c1', dto, esperado);
    await c.concluir('c1', dto, usuario, req);
    expect(servico.concluir).toHaveBeenCalledWith('c1', dto, esperado);
    await c.cancelar('c1', dto, usuario, req);
    expect(servico.cancelar).toHaveBeenCalledWith('c1', dto, esperado);
    await c.remarcar('c1', dto, usuario, req);
    expect(servico.remarcar).toHaveBeenCalledWith('c1', dto, esperado);
    await c.desfazerConclusao('c1', usuario, req);
    expect(servico.desfazerConclusao).toHaveBeenCalledWith('c1', esperado);
    await c.remover('c1', usuario, req);
    expect(servico.remover).toHaveBeenCalledWith('c1', esperado);
  });
});
