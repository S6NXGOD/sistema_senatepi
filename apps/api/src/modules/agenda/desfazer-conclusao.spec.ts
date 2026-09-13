import { StatusCompromisso } from '@prisma/client';
import { AgendaService } from './agenda.service';
import {
  JANELA_DO_DESFAZER_MS,
  andamentoDaConclusao,
  podeDesfazerConclusao,
  type RegistroDaConclusao,
} from './desfazer-conclusao.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DESFAZER A CONCLUSÃO (D6) — só quem concluiu, até 120 s, e só quando não há
 * efeito que desfazer não saiba desfazer. O toast dura 8 s; o servidor aceita
 * até 2 minutos para cobrir rede lenta e o celular que dormiu no meio.
 */
const { PENDENTE, EM_ANDAMENTO, CONCLUIDO } = StatusCompromisso;
const agora = new Date('2026-09-13T15:00:00.000Z');
const concluidoEm = new Date(agora.getTime() - 30_000);

const atividade = { status: CONCLUIDO, concluidoEm, concluidoPor: 'u1' };
const registro = (extra: Record<string, unknown> = {}): RegistroDaConclusao => ({
  metadata: {
    concluidoEm: concluidoEm.toISOString(),
    de: PENDENTE,
    seguimentoCriado: null,
    preProcessualCriado: null,
    processoAntes: 'p1',
    processoDepois: 'p1',
    substituidas: [],
    andamentoId: 'm1',
    ...extra,
  },
});

describe('podeDesfazerConclusao', () => {
  it('quem concluiu, dentro do prazo, sem efeito colateral: volta ao que era', () => {
    expect(podeDesfazerConclusao(atividade, registro(), 'u1', agora)).toEqual({ ok: true, voltarPara: PENDENTE, andamentoId: 'm1' });
    expect(podeDesfazerConclusao(atividade, registro({ de: EM_ANDAMENTO }), 'u1', agora)).toEqual(
      expect.objectContaining({ ok: true, voltarPara: EM_ANDAMENTO }),
    );
  });

  it('a janela é de 120 s, com a borda incluída', () => {
    const noLimite = new Date(concluidoEm.getTime() + JANELA_DO_DESFAZER_MS);
    const passou = new Date(noLimite.getTime() + 1);
    expect(podeDesfazerConclusao(atividade, registro(), 'u1', noLimite).ok).toBe(true);
    expect(podeDesfazerConclusao(atividade, registro(), 'u1', passou)).toEqual({
      ok: false,
      motivo: expect.stringContaining('O tempo para desfazer acabou'),
    });
  });

  it.each<[string, Parameters<typeof podeDesfazerConclusao>, string]>([
    ['outra pessoa', [atividade, registro(), 'u2', agora], 'Só quem concluiu'],
    ['sem usuário', [atividade, registro(), undefined, agora], 'Só quem concluiu'],
    ['não está concluída', [{ ...atividade, status: PENDENTE }, registro(), 'u1', agora], 'não está concluída'],
    ['registro de outra conclusão', [atividade, registro({ concluidoEm: '2026-09-10T10:00:00.000Z' }), 'u1', agora], 'Não achei o registro'],
    ['sem registro', [atividade, null, 'u1', agora], 'Não achei o registro'],
    ['criou seguimento', [atividade, registro({ seguimentoCriado: 's1' }), 'u1', agora], 'seguimento'],
    ['abriu pré-processual', [atividade, registro({ preProcessualCriado: 'proc9' }), 'u1', agora], 'pré-processual'],
    ['vinculou processo', [atividade, registro({ processoAntes: null, processoDepois: 'p1' }), 'u1', agora], 'vinculou'],
    ['substituiu providência', [atividade, registro({ substituidas: ['s0'] }), 'u1', agora], 'substituiu'],
  ])('recusa: %s', (_caso, args, trecho) => {
    const r = podeDesfazerConclusao(...args);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toContain(trecho);
    // Toda recusa de algo concluído aponta o caminho que continua existindo.
    // (A que não está concluída não tem o que reabrir.)
    if (args[0].status === StatusCompromisso.CONCLUIDO) {
      expect(!r.ok && r.motivo).toContain('reabra a atividade');
    }
  });

  it('conclusão antiga, sem o id do andamento anotado, não acha nada para substituir', () => {
    expect(andamentoDaConclusao(null)).toBeNull();
    expect(andamentoDaConclusao({ metadata: { desfecho: 'X' } as never })).toBeNull();
    expect(andamentoDaConclusao(registro())).toBe('m1');
  });
});

/* ------------------------------------------------------------------------ */

function montar(opcoes: { concluidoPor?: string; count?: number; concluidoEm?: Date } = {}) {
  const concluida = {
    id: 'c1', status: CONCLUIDO, titulo: 'Elaborar manifestação', desfecho: 'PRAZO_CUMPRIDO',
    concluidoEm: opcoes.concluidoEm ?? new Date(Date.now() - 20_000), concluidoPor: opcoes.concluidoPor ?? 'u1',
  };
  const updateMany = jest.fn(async (_a: any) => ({ count: opcoes.count ?? 1 }));
  const deleteMany = jest.fn(async (_a: any) => ({ count: 1 }));
  const historico = jest.fn(async (_a: any) => ({}));
  const prisma: any = {
    compromisso: {
      findUnique: jest.fn(async () => concluida),
      updateMany,
      findUniqueOrThrow: jest.fn(async () => ({ id: 'c1', status: EM_ANDAMENTO })),
    },
    compromissoHistorico: {
      findFirst: jest.fn(async () => ({
        metadata: {
          concluidoEm: concluida.concluidoEm.toISOString(), de: EM_ANDAMENTO, andamentoId: 'm1',
          seguimentoCriado: null, preProcessualCriado: null, processoAntes: 'p1', processoDepois: 'p1', substituidas: [],
        },
      })),
      create: historico,
    },
    movimentacaoInterna: { deleteMany },
  };
  prisma.$transaction = async (cb: (t: unknown) => unknown) => cb(prisma);
  const audit = { registrar: jest.fn(async () => ({})) };
  const servico = new AgendaService(prisma as never, audit as never, {} as never);
  return { servico, updateMany, deleteMany, historico, audit };
}

const ctx = { userId: 'u1', nome: 'Ana' };

describe('PATCH :id/desfazer-conclusao', () => {
  it('volta ao status de antes, limpa o desfecho, apaga só o andamento de origem CONCLUSAO e conta no histórico', async () => {
    const m = montar();
    const r = await m.servico.desfazerConclusao('c1', ctx);

    expect(r).toEqual({ id: 'c1', status: EM_ANDAMENTO });
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', status: CONCLUIDO, concluidoPor: 'u1' },
      data: { status: EM_ANDAMENTO, desfecho: null, desfechoObs: null, concluidoEm: null, concluidoPor: null },
    });
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', origem: 'CONCLUSAO' } });

    const linha = m.historico.mock.calls[0][0].data;
    expect(linha.acao).toBe('REABERTO');
    expect(linha.metadata).toEqual(expect.objectContaining({ via: 'desfazer', de: CONCLUIDO, para: EM_ANDAMENTO, andamentoRemovido: 'm1' }));
    expect(linha.descricao).toContain('Peça protocolada');
  });

  it('outra pessoa: 400 e nada muda', async () => {
    const m = montar({ concluidoPor: 'u2' });
    await expect(m.servico.desfazerConclusao('c1', ctx)).rejects.toThrow('Só quem concluiu');
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it('passados os 2 minutos: 400', async () => {
    const m = montar({ concluidoEm: new Date(Date.now() - 121_000) });
    await expect(m.servico.desfazerConclusao('c1', ctx)).rejects.toThrow('O tempo para desfazer acabou');
  });

  /** Dois toques em "Desfazer": o segundo encontra a atividade já aberta. */
  it('dois toques não desfazem duas vezes', async () => {
    const m = montar({ count: 0 });
    await expect(m.servico.desfazerConclusao('c1', ctx)).rejects.toThrow('não está mais concluída');
    expect(m.deleteMany).not.toHaveBeenCalled();
  });
});
