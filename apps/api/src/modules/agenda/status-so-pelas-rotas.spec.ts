import { StatusCompromisso } from '@prisma/client';
import { ERRO_LINK } from '../../common/link-reuniao.util';
import { AgendaService } from './agenda.service';
import {
  FRASE_CANCELAR_PELA_ROTA,
  FRASE_CONCLUIR_PELA_ROTA,
  FRASE_REABRIR_PELA_ROTA,
  statusDaCriacao,
  statusPelaEdicao,
} from './porta-do-status.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A SITUAÇÃO SÓ MUDA PELAS ROTAS QUE SABEM O QUE FAZER.
 *
 * `PATCH /compromissos/:id { status: 'CANCELADO' }` cancelava sem categoria e
 * sem dispensar a movimentação ligada — o limbo fechado em 27/08. Nenhuma tela
 * usava; qualquer perfil com EDITAR na agenda alcançava.
 */
const { PENDENTE, EM_ANDAMENTO, CONCLUIDO, CANCELADO } = StatusCompromisso;
const agora = new Date('2026-09-13T12:00:00Z');

describe('statusDaCriacao', () => {
  it('nasce pendente (sem gravar nada) ou em andamento com o cronômetro', () => {
    expect(statusDaCriacao(undefined, agora)).toEqual({});
    expect(statusDaCriacao(PENDENTE, agora)).toEqual({});
    expect(statusDaCriacao(EM_ANDAMENTO, agora)).toEqual({ status: EM_ANDAMENTO, iniciadoEm: agora });
  });

  it('não nasce fechada', () => {
    expect(() => statusDaCriacao(CONCLUIDO, agora)).toThrow(FRASE_CONCLUIR_PELA_ROTA);
    expect(() => statusDaCriacao(CANCELADO, agora)).toThrow(FRASE_CANCELAR_PELA_ROTA);
  });
});

describe('statusPelaEdicao', () => {
  const pendente = { status: PENDENTE, iniciadoEm: null };

  it('o mesmo status que o formulário leu é ignorado', () => {
    expect(statusPelaEdicao({ status: CONCLUIDO, iniciadoEm: null }, CONCLUIDO, agora)).toEqual({});
    expect(statusPelaEdicao(pendente, undefined, agora)).toEqual({});
  });

  it('fechar pela edição é recusado com a frase das rotas', () => {
    expect(() => statusPelaEdicao(pendente, CONCLUIDO, agora)).toThrow(FRASE_CONCLUIR_PELA_ROTA);
    expect(() => statusPelaEdicao(pendente, CANCELADO, agora)).toThrow(FRASE_CANCELAR_PELA_ROTA);
  });

  it('reabrir pela edição também — ela não limparia o desfecho', () => {
    expect(() => statusPelaEdicao({ status: CONCLUIDO, iniciadoEm: null }, PENDENTE, agora)).toThrow(FRASE_REABRIR_PELA_ROTA);
  });

  it('iniciar carimba só na primeira vez; voltar a pendente zera', () => {
    expect(statusPelaEdicao(pendente, EM_ANDAMENTO, agora)).toEqual({ status: EM_ANDAMENTO, iniciadoEm: agora });
    const antes = new Date('2026-09-13T10:00:00Z');
    expect(statusPelaEdicao({ status: PENDENTE, iniciadoEm: antes }, EM_ANDAMENTO, agora)).toEqual({ status: EM_ANDAMENTO });
    expect(statusPelaEdicao({ status: EM_ANDAMENTO, iniciadoEm: antes }, PENDENTE, agora)).toEqual({ status: PENDENTE, iniciadoEm: null });
  });
});

/* ------------------------------------------------------------------------ */

function montar(atual?: Record<string, unknown>) {
  const create = jest.fn(async (_a: any) => ({ id: 'novo' }));
  const update = jest.fn(async (_a: any) => ({}));
  const cartao = { id: 'novo', titulo: 'Reunião' };
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ id: 'u1' })), findMany: jest.fn(async () => []) },
    compromisso: {
      create,
      update,
      findUnique: jest.fn(async () => atual ?? null),
      findUniqueOrThrow: jest.fn(async () => cartao),
    },
    compromissoResponsavel: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      upsert: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => ({ usuarioId: 'u1' })),
      findMany: jest.fn(async () => []),
    },
    compromissoHistorico: { create: jest.fn(async () => ({})) },
  };
  prisma.$transaction = async (cb: (t: unknown) => unknown) => cb(prisma);
  const servico = new AgendaService(
    prisma as never,
    { registrar: jest.fn(async () => ({})) } as never,
    { garantirSlugValido: jest.fn(async () => undefined) } as never,
  );
  return { servico, create, update };
}

const ctx = { userId: 'u1', nome: 'Ana' };
const nova = {
  titulo: 'Reunião com a diretoria',
  tipo: 'REUNIAO',
  inicio: '2026-09-20T12:00:00.000Z',
  fim: '2026-09-20T13:00:00.000Z',
  responsavelId: 'u1',
};

describe('o serviço fecha a porta lateral', () => {
  it('criar já concluída: 400 e nada gravado', async () => {
    const m = montar();
    await expect(m.servico.criar({ ...nova, status: CONCLUIDO }, ctx)).rejects.toThrow(FRASE_CONCLUIR_PELA_ROTA);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('criar em andamento grava o cronômetro, e o link da chamada sai limpo', async () => {
    const m = montar();
    await m.servico.criar({ ...nova, status: EM_ANDAMENTO, linkReuniao: 'Participe: meet.google.com/abc-defg-hij' }, ctx);
    const data = m.create.mock.calls[0][0].data;
    expect(data.status).toBe(EM_ANDAMENTO);
    expect(data.iniciadoEm).toBeInstanceOf(Date);
    expect(data.linkReuniao).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('link que não é https: 400 com a frase da regra, antes de gravar', async () => {
    const m = montar();
    await expect(m.servico.criar({ ...nova, linkReuniao: 'http://meet.google.com/x' }, ctx)).rejects.toThrow(ERRO_LINK.http);
    expect(m.create).not.toHaveBeenCalled();
  });

  const aberta = {
    id: 'c1', titulo: 'Reunião', tipo: 'REUNIAO', status: PENDENTE, iniciadoEm: null,
    inicio: new Date('2026-09-20T12:00:00Z'), fim: new Date('2026-09-20T13:00:00Z'),
    dataOriginal: null, remarcacoes: 0, responsavelId: 'u1', local: null, linkReuniao: 'https://meet.google.com/x',
    descricao: null, filiadoId: null, processoId: null, urgente: false, urgenteMotivo: null, urgenteEm: null, urgentePor: null,
  };

  it('editar para cancelada: 400 e nada gravado', async () => {
    const m = montar(aberta);
    await expect(m.servico.atualizar('c1', { status: CANCELADO }, ctx)).rejects.toThrow(FRASE_CANCELAR_PELA_ROTA);
    expect(m.update).not.toHaveBeenCalled();
  });

  it('editar sem falar do link não o apaga; mandar vazio apaga', async () => {
    const semLink = montar(aberta);
    await semLink.servico.atualizar('c1', { titulo: 'Reunião geral' }, ctx);
    expect(semLink.update.mock.calls[0][0].data).not.toHaveProperty('linkReuniao');

    const apagando = montar(aberta);
    await apagando.servico.atualizar('c1', { linkReuniao: '' }, ctx);
    expect(apagando.update.mock.calls[0][0].data.linkReuniao).toBeNull();
  });
});
