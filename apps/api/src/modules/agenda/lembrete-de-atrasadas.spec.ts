import { UserRole } from '@prisma/client';
import { AgendaService, DIAS_ENTRE_AVISOS } from './agenda.service';
import type { AuthUser } from '../../common/decorators/current-user.decorator';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O LEMBRETE SEMANAL DAS QUE FICARAM PARA TRÁS — 21/09/2026.
 *
 * "Queria uma animação (...) que aparecesse ao menos 1 vez por semana. Como se
 * fosse um POP-UP assim que ele loga no sistema listando as atividades dele que
 * estão atrasadas."
 *
 * As quatro regras que impedem o pop-up de virar cabeçalho estão TODAS no
 * servidor, e é isso que este arquivo cobra — a tela não decide nada.
 */
const DIA = 86_400_000;
const AGORA = new Date('2026-09-21T13:00:00.000Z');

function montar(opcoes: {
  avisoAtrasadasEm?: Date | null;
  atrasadas?: Record<string, unknown>[];
} = {}) {
  const chamadas: { chave: string; args: any }[] = [];
  const itens = opcoes.atrasadas ?? [];
  const prisma: any = {
    user: {
      findUnique: async (args: any) => {
        chamadas.push({ chave: 'user.findUnique', args });
        return { avisoAtrasadasEm: opcoes.avisoAtrasadasEm ?? null };
      },
      update: async (args: any) => {
        chamadas.push({ chave: 'user.update', args });
        return {};
      },
    },
    compromisso: {
      count: async (args: any) => {
        chamadas.push({ chave: 'compromisso.count', args });
        return itens.length;
      },
      findMany: async (args: any) => {
        chamadas.push({ chave: 'compromisso.findMany', args });
        return itens.slice(0, args?.take ?? itens.length);
      },
    },
  };
  const servico = new AgendaService(prisma, {} as never, {} as never);
  const de = (chave: string) => chamadas.filter((c) => c.chave === chave);
  return { servico, de };
}

const usuario = (role: UserRole, permissoes: unknown = null): AuthUser => ({
  id: 'u-carlos',
  email: 'carlos@sindicato.org',
  nome: 'Dr. Carlos',
  role,
  permissoes,
});

const atrasada = (id: string) => ({
  id,
  titulo: `Elaborar manifestação ${id}`,
  tipo: 'PRAZO',
  inicio: new Date(AGORA.getTime() - 3 * DIA),
  urgente: false,
  filiado: null,
  processo: null,
});

beforeEach(() => jest.useFakeTimers({ now: AGORA }));
afterEach(() => jest.useRealTimers());

describe('quem recebe o lembrete', () => {
  it('o advogado com atraso e sem ter visto esta semana recebe', async () => {
    const { servico } = montar({ atrasadas: [atrasada('a'), atrasada('b')] });
    const r: any = await servico.avisoDeAtrasadas(usuario(UserRole.ADVOGADO));
    expect(r).toMatchObject({ mostrar: true, total: 2 });
    expect(r.itens).toHaveLength(2);
  });

  /** Nada atrasado, nada na tela. Pop-up que abre para dizer "está tudo bem"
      é o que ensina a fechar sem ler. */
  it('sem atraso nenhum, não mostra', async () => {
    const { servico } = montar({ atrasadas: [] });
    const r: any = await servico.avisoDeAtrasadas(usuario(UserRole.ADVOGADO));
    expect(r.mostrar).toBe(false);
    expect(r.itens).toEqual([]);
  });

  /**
   * O CORTE DE PERMISSÃO É NO SERVIDOR, e nem a consulta roda. A Triagem do
   * preset vê a agenda; quem tem `agenda: SEM_ACESSO` na matriz própria, não.
   */
  it('quem não vê agenda não recebe, e nada é consultado', async () => {
    const { servico, de } = montar({ atrasadas: [atrasada('a')] });
    const r: any = await servico.avisoDeAtrasadas(
      usuario(UserRole.TRIAGEM, { agenda: 'SEM_ACESSO' }),
    );
    expect(r.mostrar).toBe(false);
    expect(de('compromisso.count')).toHaveLength(0);
    expect(de('user.findUnique')).toHaveLength(0);
  });
});

describe('uma vez por semana, por pessoa', () => {
  it(`visto há ${DIAS_ENTRE_AVISOS - 1} dias: ainda não volta`, async () => {
    const { servico, de } = montar({
      avisoAtrasadasEm: new Date(AGORA.getTime() - (DIAS_ENTRE_AVISOS - 1) * DIA),
      atrasadas: [atrasada('a')],
    });
    expect((await servico.avisoDeAtrasadas(usuario(UserRole.ADVOGADO))).mostrar).toBe(false);
    // E a consulta das atrasadas nem roda: a data já respondeu.
    expect(de('compromisso.count')).toHaveLength(0);
  });

  it(`visto há ${DIAS_ENTRE_AVISOS} dias: volta`, async () => {
    const { servico } = montar({
      avisoAtrasadasEm: new Date(AGORA.getTime() - DIAS_ENTRE_AVISOS * DIA - 1000),
      atrasadas: [atrasada('a')],
    });
    expect((await servico.avisoDeAtrasadas(usuario(UserRole.ADVOGADO))).mostrar).toBe(true);
  });

  it('nunca viu: volta', async () => {
    const { servico } = montar({ avisoAtrasadasEm: null, atrasadas: [atrasada('a')] });
    expect((await servico.avisoDeAtrasadas(usuario(UserRole.ADVOGADO))).mostrar).toBe(true);
  });
});

describe('o que a consulta pede', () => {
  it('só cinco linhas, da mais antiga para a mais nova', async () => {
    const { servico, de } = montar({
      atrasadas: Array.from({ length: 9 }, (_, i) => atrasada(`a${i}`)),
    });
    const r: any = await servico.avisoDeAtrasadas(usuario(UserRole.ADVOGADO));
    expect(r.total).toBe(9);
    expect(r.itens).toHaveLength(5);
    expect(de('compromisso.findMany')[0].args.orderBy).toEqual({ inicio: 'asc' });
  });

  /** É o escopo DELA: o que responde ou o que a equipe dela responde com ela. */
  it('a consulta é da pessoa, nunca da casa', async () => {
    const { servico, de } = montar({ atrasadas: [atrasada('a')] });
    await servico.avisoDeAtrasadas(usuario(UserRole.ADVOGADO));
    expect(JSON.stringify(de('compromisso.count')[0].args.where)).toContain('u-carlos');
  });
});

describe('o carimbo', () => {
  it('marcar visto grava a data de agora', async () => {
    const { servico, de } = montar();
    await servico.marcarAvisoDeAtrasadasVisto(usuario(UserRole.ADVOGADO));
    expect(de('user.update')[0].args).toMatchObject({
      where: { id: 'u-carlos' },
      data: { avisoAtrasadasEm: AGORA },
    });
  });
});
