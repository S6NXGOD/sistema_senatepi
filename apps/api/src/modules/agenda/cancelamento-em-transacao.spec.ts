import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, StatusCompromisso, UserRole } from '@prisma/client';
import { AgendaService } from './agenda.service';
import {
  FRASE_CATEGORIA_OBRIGATORIA,
  FRASE_CONCLUIDA_REABRA,
  FRASE_EM_ANDAMENTO_NAO_CANCELA,
  FRASE_JA_CANCELADA,
  FRASE_MUDOU_NO_MEIO,
  cancelarCompromissoEmTransacao,
  dispensarMovimentacaoLigada,
} from './cancelamento-em-transacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O CANCELAMENTO SAIU DO SERVIÇO E CONTINUA GRAVANDO O MESMO (14/09/2026).
 *
 * `AgendaService.cancelar` passou a chamar `cancelarCompromissoEmTransacao`, que
 * o fechamento do atendimento também chama. Os valores esperados abaixo estão
 * escritos por extenso, copiados do que o serviço gravava até 13/09/2026 —
 * status, categoria, motivo, carimbo, autor, cronômetro zerado e a dispensa da
 * movimentação ligada. Se a função extraída esquecer um campo, a consulta
 * cancelada pelo atendimento fica diferente da cancelada pela agenda, e este
 * arquivo reprova.
 *
 * O banco falso anota, em cada chamada, se ela aconteceu DENTRO do
 * `$transaction`: histórico e auditoria vêm depois do commit.
 */

const { PENDENTE, EM_ANDAMENTO, CONCLUIDO, CANCELADO } = StatusCompromisso;

/** Segunda, 14/09/2026, 10h de Teresina. */
const AGORA = new Date('2026-09-14T13:00:00.000Z');
const ID = '6b0e6a52-2f7c-4d0e-9d7e-1a4b5c6d7e8f';
const TITULO = 'Consulta Jurídica — Maria da Silva';

interface Chamada {
  chave: string;
  args: any;
  naTransacao: boolean;
}

function bancoFalso(opcoes: { status?: StatusCompromisso | null; gravou?: number; dispensadas?: number } = {}) {
  const chamadas: Chamada[] = [];
  let naTransacao = false;
  const status = opcoes.status === undefined ? PENDENTE : opcoes.status;
  const anotar = (chave: string, resposta: (args: any) => unknown) =>
    jest.fn(async (args: any) => {
      chamadas.push({ chave, args, naTransacao });
      return resposta(args);
    });

  const prisma: any = {
    compromisso: {
      findUnique: anotar('compromisso.findUnique', () => (status ? { id: ID, status, titulo: TITULO } : null)),
      updateMany: anotar('compromisso.updateMany', () => ({ count: opcoes.gravou ?? 1 })),
      findUniqueOrThrow: anotar('compromisso.findUniqueOrThrow', () => ({ id: ID, titulo: TITULO, status: CANCELADO })),
    },
    movimentacaoProcessual: {
      updateMany: anotar('movimentacaoProcessual.updateMany', () => ({ count: opcoes.dispensadas ?? 1 })),
    },
    compromissoHistorico: {
      create: anotar('compromissoHistorico.create', () => ({})),
    },
  };
  prisma.$transaction = async (cb: (tx: unknown) => unknown) => {
    naTransacao = true;
    try {
      return await cb(prisma);
    } finally {
      naTransacao = false;
    }
  };
  const audit = { registrar: anotar('audit.registrar', () => ({})) };
  const escritas = () =>
    chamadas.filter((c) => /\.(updateMany|update|create|delete|deleteMany|upsert)$/.test(c.chave) && c.chave !== 'audit.registrar');
  const achar = (chave: string) => chamadas.filter((c) => c.chave === chave);
  return { prisma, audit, chamadas, escritas, achar };
}

/* O que `AgendaService.cancelar` gravava até 13/09/2026, escrito por extenso. */
const GRAVADO_COM_MOTIVO = {
  status: CANCELADO,
  canceladoCategoria: 'NAO_COMPARECEU',
  canceladoMotivo: 'Avisou pelo WhatsApp às 8h que não viria.',
  canceladoEm: AGORA,
  canceladoPor: 'u-ana',
  iniciadoEm: null,
};
const DISPENSA_COM_MOTIVO = {
  where: { compromissoId: ID, dispensadoEm: null },
  data: {
    dispensadoEm: AGORA,
    dispensadoPor: 'u-ana',
    dispensadoMotivo: 'Atividade cancelada — Filiado não compareceu: Avisou pelo WhatsApp às 8h que não viria.',
  },
};

describe('cancelarCompromissoEmTransacao grava o que o cancelamento da agenda gravava', () => {
  it('categoria, motivo, carimbo, autor e cronômetro zerado — e dispensa a movimentação ligada', async () => {
    const b = bancoFalso();
    const feito = await cancelarCompromissoEmTransacao(b.prisma, {
      id: ID,
      categoria: 'NAO_COMPARECEU',
      motivo: '  Avisou pelo WhatsApp às 8h que não viria.  ',
      autorId: 'u-ana',
      agora: AGORA,
    });

    const [gravacao] = b.achar('compromisso.updateMany');
    expect(gravacao.args.data).toEqual(GRAVADO_COM_MOTIVO);
    // Condicional à situação: se alguém concluiu no meio, nada é gravado.
    expect(gravacao.args.where).toEqual({ id: ID, status: { in: [PENDENTE, EM_ANDAMENTO] } });
    expect(b.achar('movimentacaoProcessual.updateMany').map((c) => c.args)).toEqual([DISPENSA_COM_MOTIVO]);

    expect(feito).toEqual({
      id: ID,
      titulo: TITULO,
      de: PENDENTE,
      categoria: 'NAO_COMPARECEU',
      rotuloCategoria: 'Filiado não compareceu',
      motivo: 'Avisou pelo WhatsApp às 8h que não viria.',
      canceladoEm: AGORA,
      movimentacoesDispensadas: 1,
      historico: {
        acao: 'CANCELADO',
        descricao: 'Cancelada — Filiado não compareceu. Avisou pelo WhatsApp às 8h que não viria.',
        metadata: { de: PENDENTE, categoria: 'NAO_COMPARECEU', motivo: 'Avisou pelo WhatsApp às 8h que não viria.' },
      },
      auditoria: {
        acao: AcaoAuditoria.UPDATE,
        entidade: 'Compromisso',
        entidadeId: ID,
        descricao:
          'Compromisso CANCELADO: Consulta Jurídica — Maria da Silva — Filiado não compareceu: Avisou pelo WhatsApp às 8h que não viria.',
        metadata: { de: PENDENTE, motivo: 'Avisou pelo WhatsApp às 8h que não viria.', categoria: 'NAO_COMPARECEU' },
      },
    });
  });

  it('sem motivo e sem autor: nulos, e as frases sem os dois-pontos', async () => {
    const b = bancoFalso({ status: EM_ANDAMENTO, dispensadas: 0 });
    const feito = await cancelarCompromissoEmTransacao(b.prisma, {
      id: ID,
      categoria: 'PERDEU_OBJETO',
      motivo: '   ',
      agora: AGORA,
    });

    expect(b.achar('compromisso.updateMany')[0].args.data).toEqual({
      status: CANCELADO,
      canceladoCategoria: 'PERDEU_OBJETO',
      canceladoMotivo: null,
      canceladoEm: AGORA,
      canceladoPor: null,
      iniciadoEm: null,
    });
    expect(b.achar('movimentacaoProcessual.updateMany')[0].args.data).toEqual({
      dispensadoEm: AGORA,
      dispensadoPor: null,
      dispensadoMotivo: 'Atividade cancelada — Perdeu o objeto',
    });
    expect(feito.de).toBe(EM_ANDAMENTO);
    expect(feito.movimentacoesDispensadas).toBe(0);
    expect(feito.historico.descricao).toBe('Cancelada — Perdeu o objeto.');
    expect(feito.auditoria.descricao).toBe('Compromisso CANCELADO: Consulta Jurídica — Maria da Silva — Perdeu o objeto');
  });

  it('o fechamento do atendimento cancela só PENDENTE: a consulta em andamento é de quem está atendendo', async () => {
    const pendente = bancoFalso({ status: PENDENTE });
    await cancelarCompromissoEmTransacao(pendente.prisma, {
      id: ID, categoria: 'DESISTENCIA', autorId: 'u-bia', aceitarStatus: [PENDENTE], agora: AGORA,
    });
    expect(pendente.achar('compromisso.updateMany')[0].args.where).toEqual({ id: ID, status: { in: [PENDENTE] } });

    const andando = bancoFalso({ status: EM_ANDAMENTO });
    await expect(
      cancelarCompromissoEmTransacao(andando.prisma, {
        id: ID, categoria: 'DESISTENCIA', autorId: 'u-bia', aceitarStatus: [PENDENTE], agora: AGORA,
      }),
    ).rejects.toThrow(FRASE_EM_ANDAMENTO_NAO_CANCELA);
    expect(andando.escritas()).toEqual([]);
  });
});

describe('o que não cancela — e não escreve nada', () => {
  it.each<[string, Parameters<typeof bancoFalso>[0], string, string, jest.Constructable]>([
    ['atividade que não existe', { status: null }, 'NAO_COMPARECEU', 'Compromisso não encontrado.', NotFoundException],
    ['já cancelada', { status: CANCELADO }, 'NAO_COMPARECEU', FRASE_JA_CANCELADA, BadRequestException],
    ['concluída', { status: CONCLUIDO }, 'NAO_COMPARECEU', FRASE_CONCLUIDA_REABRA, BadRequestException],
    ['categoria vazia', {}, '', FRASE_CATEGORIA_OBRIGATORIA, BadRequestException],
    ['categoria fora do catálogo', {}, 'FERIADO', FRASE_CATEGORIA_OBRIGATORIA, BadRequestException],
    /** A ordem de sempre: a situação vem antes da categoria. */
    ['já cancelada e sem categoria', { status: CANCELADO }, '', FRASE_JA_CANCELADA, BadRequestException],
  ])('%s', async (_caso, opcoes, categoria, frase, tipo) => {
    const b = bancoFalso(opcoes);
    const tentativa = cancelarCompromissoEmTransacao(b.prisma, { id: ID, categoria, autorId: 'u-ana', agora: AGORA });
    await expect(tentativa).rejects.toThrow(tipo);
    await expect(
      cancelarCompromissoEmTransacao(b.prisma, { id: ID, categoria, autorId: 'u-ana', agora: AGORA }),
    ).rejects.toThrow(frase);
    expect(b.escritas()).toEqual([]);
  });

  it('outra pessoa mudou a atividade entre a leitura e a escrita: recusa e não dispensa nada', async () => {
    const b = bancoFalso({ gravou: 0 });
    await expect(
      cancelarCompromissoEmTransacao(b.prisma, { id: ID, categoria: 'NAO_COMPARECEU', autorId: 'u-ana', agora: AGORA }),
    ).rejects.toThrow(FRASE_MUDOU_NO_MEIO);
    expect(b.achar('movimentacaoProcessual.updateMany')).toEqual([]);
  });
});

describe('AgendaService.cancelar passa pela função extraída', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.setSystemTime(AGORA);
  });
  afterEach(() => jest.useRealTimers());

  const montar = (opcoes: Parameters<typeof bancoFalso>[0] = {}) => {
    const b = bancoFalso(opcoes);
    const servico = new AgendaService(b.prisma as never, b.audit as never, {} as never);
    return { ...b, servico };
  };
  const ctx = {
    userId: 'u-ana',
    nome: 'Ana Paula',
    ip: '10.0.0.7',
    userAgent: 'navegador',
    leitor: { id: 'u-ana', role: UserRole.ADVOGADO, permissoes: null },
  };

  it('grava os mesmos campos, dispensa a movimentação, tudo na transação — e historia e audita depois', async () => {
    const m = montar();
    const cartao = await m.servico.cancelar(
      ID,
      { categoria: 'NAO_COMPARECEU', motivo: 'Avisou pelo WhatsApp às 8h que não viria.' },
      ctx,
    );

    expect(cartao).toEqual({ id: ID, titulo: TITULO, status: CANCELADO });
    const [gravacao] = m.achar('compromisso.updateMany');
    expect(gravacao.args.data).toEqual(GRAVADO_COM_MOTIVO);
    expect(m.achar('movimentacaoProcessual.updateMany').map((c) => c.args)).toEqual([DISPENSA_COM_MOTIVO]);

    // A gravação, a dispensa e a leitura do cartão dentro da transação; histórico e auditoria fora.
    expect(m.chamadas.map((c) => [c.chave, c.naTransacao])).toEqual([
      ['compromisso.findUnique', true],
      ['compromisso.updateMany', true],
      ['movimentacaoProcessual.updateMany', true],
      ['compromisso.findUniqueOrThrow', true],
      ['audit.registrar', false],
      ['compromissoHistorico.create', false],
    ]);

    expect(m.achar('audit.registrar')[0].args).toEqual({
      userId: 'u-ana',
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Compromisso',
      entidadeId: ID,
      descricao:
        'Compromisso CANCELADO: Consulta Jurídica — Maria da Silva — Filiado não compareceu: Avisou pelo WhatsApp às 8h que não viria.',
      ip: '10.0.0.7',
      userAgent: 'navegador',
      metadata: { de: PENDENTE, motivo: 'Avisou pelo WhatsApp às 8h que não viria.', categoria: 'NAO_COMPARECEU' },
    });
    expect(m.achar('compromissoHistorico.create')[0].args).toEqual({
      data: {
        compromissoId: ID,
        acao: 'CANCELADO',
        descricao: 'Cancelada — Filiado não compareceu. Avisou pelo WhatsApp às 8h que não viria.',
        autorId: 'u-ana',
        autorNome: 'Ana Paula',
        metadata: { de: PENDENTE, categoria: 'NAO_COMPARECEU', motivo: 'Avisou pelo WhatsApp às 8h que não viria.' },
      },
    });
  });

  it('a recusa continua com a frase de sempre, e nada é historiado nem auditado', async () => {
    const m = montar({ status: CONCLUIDO });
    await expect(m.servico.cancelar(ID, { categoria: 'NAO_COMPARECEU' }, ctx)).rejects.toThrow(FRASE_CONCLUIDA_REABRA);
    expect(m.achar('audit.registrar')).toEqual([]);
    expect(m.achar('compromissoHistorico.create')).toEqual([]);
  });

  it('o cancelamento pelo tribunal dispensa pela mesma função, sem autor', async () => {
    const m = montar();
    const prisma = m.prisma;
    prisma.compromisso.update = jest.fn(async () => ({}));
    await m.servico.cancelarPorSistema(ID, 'Audiência cancelada pelo juízo (DataJud).');
    expect(m.achar('movimentacaoProcessual.updateMany')[0].args).toEqual({
      where: { compromissoId: ID, dispensadoEm: null },
      data: { dispensadoEm: AGORA, dispensadoPor: null, dispensadoMotivo: 'Audiência cancelada pelo juízo (DataJud).' },
    });
    expect(m.achar('movimentacaoProcessual.updateMany')[0].naTransacao).toBe(true);
  });
});

describe('dispensarMovimentacaoLigada', () => {
  it('só dispensa o que ainda não estava dispensado, e conta quantas', async () => {
    const b = bancoFalso({ dispensadas: 2 });
    const n = await dispensarMovimentacaoLigada(b.prisma, ID, 'Atividade cancelada — Agendada por engano', 'u-ana', AGORA);
    expect(n).toBe(2);
    expect(b.achar('movimentacaoProcessual.updateMany')[0].args).toEqual({
      where: { compromissoId: ID, dispensadoEm: null },
      data: { dispensadoEm: AGORA, dispensadoPor: 'u-ana', dispensadoMotivo: 'Atividade cancelada — Agendada por engano' },
    });
  });
});

describe('AgendaService.registrarNoHistorico — para as outras frentes, depois do commit', () => {
  const montar = (create: jest.Mock) =>
    new AgendaService({ compromissoHistorico: { create } } as never, { registrar: jest.fn() } as never, {} as never);

  it('grava a linha com o nome congelado de quem agiu', async () => {
    const create = jest.fn(async () => ({}));
    await montar(create).registrarNoHistorico(ID, {
      acao: 'CANCELADO',
      descricao: 'Cancelada — Perdeu o objeto. Atendimento #14 concluído antes da consulta: resolvido por telefone.',
      metadata: { de: PENDENTE, categoria: 'PERDEU_OBJETO', atendimentoId: 'at-14' },
      autorId: 'u-bia',
      autorNome: 'Bia (Triagem)',
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        compromissoId: ID,
        acao: 'CANCELADO',
        descricao: 'Cancelada — Perdeu o objeto. Atendimento #14 concluído antes da consulta: resolvido por telefone.',
        autorId: 'u-bia',
        autorNome: 'Bia (Triagem)',
        metadata: { de: PENDENTE, categoria: 'PERDEU_OBJETO', atendimentoId: 'at-14' },
      },
    });
  });

  it('sem autor: nulos (não inventa pessoa)', async () => {
    const create = jest.fn(async () => ({}));
    await montar(create).registrarNoHistorico(ID, { acao: 'EDITADO', descricao: 'Passou da Dra. Shérad para o Dr. Murilo.' });
    expect(create).toHaveBeenCalledWith({
      data: {
        compromissoId: ID,
        acao: 'EDITADO',
        descricao: 'Passou da Dra. Shérad para o Dr. Murilo.',
        autorId: null,
        autorNome: null,
        metadata: undefined,
      },
    });
  });

  it('um histórico que falha não derruba quem chamou', async () => {
    const create = jest.fn(async () => {
      throw new Error('conexão perdida');
    });
    await expect(
      montar(create).registrarNoHistorico(ID, { acao: 'CANCELADO', descricao: 'Cancelada — Filiado desistiu.' }),
    ).resolves.toBeUndefined();
  });
});
