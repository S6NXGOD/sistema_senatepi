import { BadRequestException } from '@nestjs/common';
import { StatusCompromisso } from '@prisma/client';
import { AgendaService } from './agenda.service';
import { dadosDaRemarcacao, mesmoMinuto, recusarRemarcacaoParaOPassado } from './remarcacao.util';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * REMARCAR NUM CAMINHO SÓ.
 *
 * Medido na produção em 12/09/2026: 7 remarcações pelo botão e 8 só pela edição
 * — e os dois caminhos gravavam coisas diferentes (contador, motivo, histórico,
 * situação). Aqui a regra é provada com valores, e os dois caminhos do serviço
 * são comparados entre si.
 */
const br = (local: string) => new Date(`${local}-03:00`);

const aberta = {
  status: StatusCompromisso.EM_ANDAMENTO,
  inicio: br('2026-09-15T09:00:00'),
  fim: br('2026-09-15T10:30:00'),
  dataOriginal: null,
  remarcacoes: 0,
};

describe('dadosDaRemarcacao', () => {
  it('grava contador, data original, PENDENTE e cronômetro zerado — e preserva a duração', () => {
    const r = dadosDaRemarcacao(aberta, { inicio: br('2026-09-17T14:00:00'), motivo: '  juiz adiou ', via: 'remarcar' })!;
    expect(r.data).toEqual({
      inicio: br('2026-09-17T14:00:00'),
      fim: br('2026-09-17T15:30:00'),
      dataOriginal: aberta.inicio,
      remarcacoes: 1,
      remarcadoMotivo: 'juiz adiou',
      status: StatusCompromisso.PENDENTE,
      iniciadoEm: null,
    });
    expect(r.historico.metadata).toEqual({
      de: aberta.inicio.toISOString(),
      para: br('2026-09-17T14:00:00').toISOString(),
      via: 'remarcar',
      remarcacoes: 1,
      dataOriginal: aberta.inicio.toISOString(),
      motivo: 'juiz adiou',
    });
    expect(r.historico.descricao).toMatch(/^Remarcada de .+ para .+ — juiz adiou\.$/);
  });

  it('na segunda vez a data original não é regravada, e o contador soma', () => {
    const r = dadosDaRemarcacao(
      { ...aberta, dataOriginal: br('2026-09-10T09:00:00'), remarcacoes: 2 },
      { inicio: br('2026-09-18T09:00:00'), via: 'edicao' },
    )!;
    expect(r.data).not.toHaveProperty('dataOriginal');
    expect(r.data.remarcacoes).toBe(3);
    expect(r.historico.metadata.dataOriginal).toBe(br('2026-09-10T09:00:00').toISOString());
    expect(r.data.remarcadoMotivo).toBeNull();
  });

  /** A tarefa do robô nasce com segundos; o formulário devolve sem eles. */
  it('ao minuto: o mesmo minuto não é remarcação', () => {
    const comSegundos = { ...aberta, inicio: new Date(aberta.inicio.getTime() + 37_000) };
    expect(dadosDaRemarcacao(comSegundos, { inicio: aberta.inicio, via: 'edicao' })).toBeNull();
    expect(mesmoMinuto(new Date('2026-09-15T12:00:59Z'), new Date('2026-09-15T12:00:00Z'))).toBe(true);
    expect(mesmoMinuto(new Date('2026-09-15T12:01:00Z'), new Date('2026-09-15T12:00:59Z'))).toBe(false);
  });

  it('fim informado é respeitado; fim antes do início é recusado', () => {
    const r = dadosDaRemarcacao(aberta, { inicio: br('2026-09-17T14:00:00'), fim: br('2026-09-17T14:20:00'), via: 'edicao' })!;
    expect(r.data.fim).toEqual(br('2026-09-17T14:20:00'));
    expect(() =>
      dadosDaRemarcacao(aberta, { inicio: br('2026-09-17T14:00:00'), fim: br('2026-09-17T13:00:00'), via: 'edicao' }),
    ).toThrow('O fim não pode ser antes do início.');
  });

  it('fechada não se remarca', () => {
    const pedido = { inicio: br('2026-09-17T14:00:00'), via: 'remarcar' as const };
    expect(() => dadosDaRemarcacao({ ...aberta, status: StatusCompromisso.CONCLUIDO }, pedido)).toThrow('reabra antes');
    expect(() => dadosDaRemarcacao({ ...aberta, status: StatusCompromisso.CANCELADO }, pedido)).toThrow('reabra antes');
  });
});

describe('o botão Remarcar não aceita dia que já passou', () => {
  const agora = br('2026-09-12T15:00:00');

  it('hora passada de HOJE vale; dia anterior, não', () => {
    expect(() => recusarRemarcacaoParaOPassado(br('2026-09-12T08:00:00'), agora)).not.toThrow();
    expect(() => recusarRemarcacaoParaOPassado(br('2026-09-11T23:59:00'), agora)).toThrow(BadRequestException);
    expect(() => recusarRemarcacaoParaOPassado(br('2026-09-11T23:59:00'), agora)).toThrow('Essa data já passou');
  });

  /** Às 22h daqui o dia UTC já é o seguinte — e hoje de manhã continua valendo. */
  it('o dia é o de Teresina, não o do contêiner', () => {
    const noite = br('2026-09-12T22:00:00');
    expect(noite.toISOString().slice(0, 10)).toBe('2026-09-13');
    expect(() => recusarRemarcacaoParaOPassado(br('2026-09-12T10:00:00'), noite)).not.toThrow();
  });
});

/* ------------------------------------------------------------------------ */

function montar(atual: Record<string, unknown>) {
  const update = jest.fn(async (_a: any) => ({ id: 'c1', titulo: 'Audiência' }));
  const historico = jest.fn(async (_a: any) => ({}));
  const tx = {
    compromisso: {
      update,
      findUniqueOrThrow: jest.fn(async () => ({ id: 'c1', titulo: 'Audiência' })),
    },
  };
  const prisma = {
    compromisso: { findUnique: jest.fn(async () => atual), update },
    compromissoHistorico: { create: historico },
    $transaction: async (cb: (t: unknown) => unknown) => cb(tx),
  };
  const audit = { registrar: jest.fn(async () => ({})) };
  const servico = new AgendaService(prisma as never, audit as never, { garantirSlugValido: jest.fn() } as never);
  return { servico, update, historico, audit };
}

const ctx = { userId: 'u1', nome: 'Ana' };
const minuto = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);

function atividade(extra: Record<string, unknown> = {}) {
  const inicio = new Date(minuto(new Date(Date.now() + 86_400_000)).getTime() + 37_000);
  return {
    id: 'c1', titulo: 'Audiência', tipo: 'AUDIENCIA', status: StatusCompromisso.EM_ANDAMENTO,
    inicio, fim: new Date(inicio.getTime() + 3_600_000), dataOriginal: null, remarcacoes: 0,
    iniciadoEm: new Date(), local: null, linkReuniao: null, descricao: null, responsavelId: 'u1',
    filiadoId: null, processoId: null, atendimentoId: null, urgente: false, urgenteMotivo: null,
    urgenteEm: null, urgentePor: null,
    ...extra,
  };
}

describe('os dois caminhos gravam a mesma remarcação', () => {
  it('Remarcar e Editar a data: mesmos dados, e os dois escrevem REMARCADO no histórico', async () => {
    const atual = atividade();
    const novo = new Date(minuto(atual.inicio).getTime() + 2 * 86_400_000);

    const botao = montar(atual);
    await botao.servico.remarcar('c1', { inicio: novo.toISOString(), motivo: 'pedido do filiado' }, ctx);
    const edicao = montar(atual);
    await edicao.servico.atualizar('c1', { inicio: novo.toISOString(), motivo: undefined } as never, ctx);

    const esperado = {
      inicio: novo,
      fim: new Date(novo.getTime() + 3_600_000),
      dataOriginal: atual.inicio,
      remarcacoes: 1,
      status: StatusCompromisso.PENDENTE,
      iniciadoEm: null,
    };
    expect(botao.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ ...esperado, remarcadoMotivo: 'pedido do filiado' }));
    expect(edicao.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ ...esperado, remarcadoMotivo: null }));

    for (const caminho of [botao, edicao]) {
      const acoes = caminho.historico.mock.calls.map((c) => c[0].data.acao);
      expect(acoes).toContain('REMARCADO');
    }
    expect(botao.historico.mock.calls[0][0].data.metadata.via).toBe('remarcar');
    expect(edicao.historico.mock.calls.find((c) => c[0].data.acao === 'REMARCADO')![0].data.metadata.via).toBe('edicao');
  });

  it('editar só o título (o formulário reenvia o início sem os segundos) não remarca', async () => {
    const atual = atividade();
    const m = montar(atual);
    await m.servico.atualizar('c1', { titulo: 'Audiência de instrução', inicio: minuto(atual.inicio).toISOString() } as never, ctx);

    const data = m.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('remarcacoes');
    expect(data).not.toHaveProperty('inicio');
    expect(data.titulo).toBe('Audiência de instrução');
    expect(m.historico.mock.calls.map((c) => c[0].data.acao)).not.toContain('REMARCADO');
  });

  it('atividade concluída: a edição CORRIGE a data, sem reabrir nem contar remarcação', async () => {
    const atual = atividade({ status: StatusCompromisso.CONCLUIDO, iniciadoEm: null });
    const corrigido = new Date(minuto(atual.inicio).getTime() - 86_400_000);
    const m = montar(atual);
    await m.servico.atualizar('c1', { inicio: corrigido.toISOString() } as never, ctx);

    const data = m.update.mock.calls[0][0].data;
    expect(data.inicio).toEqual(corrigido);
    expect(data).not.toHaveProperty('remarcacoes');
    expect(data).not.toHaveProperty('status');
    const editado = m.historico.mock.calls.find((c) => c[0].data.acao === 'EDITADO');
    expect(JSON.stringify(editado![0].data.metadata)).toContain('inicio');
  });

  it('o botão recusa dia que já passou, sem gravar', async () => {
    const m = montar(atividade());
    const ontem = new Date(Date.now() - 3 * 86_400_000);
    await expect(m.servico.remarcar('c1', { inicio: ontem.toISOString() }, ctx)).rejects.toThrow('Essa data já passou');
    expect(m.update).not.toHaveBeenCalled();
  });
});
