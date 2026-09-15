import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CATEGORIA_CANCELAMENTO_LABEL } from '../agenda/desfechos.catalogo';
import { AtendimentosService } from './atendimentos.service';
import { filaDoAtendimento } from './encaminhamento.util';
import {
  FRASE_ATENDIMENTO_MUDOU, FRASE_CONSULTA_MUDOU, FRASE_EM_ANDAMENTO, FRASE_TELA_PROPRIA,
  planoDeFechamento,
} from './fechamento.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { EscalasService } from '../escalas/escalas.service';
import type { AgendaService } from '../agenda/agenda.service';

/**
 * CONCLUIR, CANCELAR, REABRIR E MUDAR A MODALIDADE — executando o serviço.
 *
 * O banco é falso mas tem estado, e a transação desfaz o que gravou quando
 * alguém lança dentro dela, como o Postgres. O cancelamento da consulta roda a
 * REGRA REAL da agenda (`cancelarCompromissoEmTransacao`): o que se afirma aqui
 * é o que fica gravado, não que uma linha existe no fonte.
 *
 * O mundo é o do balcão medido em 13/09/2026: o #14, PENDENTE, com a consulta
 * de quinta às 09:00 com a Dra. Shérad; a Triagem é o Julian Helton.
 */

/** Segunda, 14/09/2026, 10:00 em Teresina. */
const AGORA = new Date('2026-09-14T13:00:00.000Z');
/** Quinta, 17/09/2026, 09:00 em Teresina. */
const QUINTA_9H = new Date('2026-09-17T12:00:00.000Z');
/** Hoje, 09:00 em Teresina. */
const HOJE_9H = new Date('2026-09-14T12:00:00.000Z');

const JULIAN = { id: 'u-julian', nome: 'Julian Helton', nomeExibicao: null };
const SHERAD = {
  id: 'u-sherad', nome: 'Shérad Castro', nomeExibicao: 'Dra. Shérad', avatarUrl: null, avatarKey: 'usuarios/sherad.jpg',
};
const PESSOAS: Record<string, { id: string; nome: string; nomeExibicao: string | null }> = { 'u-julian': JULIAN };

const CTX = { userId: 'u-julian', nome: 'Julian Helton', ip: '10.0.0.7', userAgent: 'jest' };
const NOTA = 'A filiada ligou e a dúvida foi esclarecida por telefone.';

type Linha = Record<string, any>;

function consulta(parcial: Linha): Linha {
  return {
    id: 'c-14',
    titulo: 'Consulta Jurídica — Iraci Moura',
    tipo: 'CONSULTA_JURIDICA',
    atendimentoId: 'a-14',
    status: 'PENDENTE',
    inicio: QUINTA_9H,
    local: null,
    linkReuniao: null,
    origemDesfechoId: null,
    createdAt: new Date('2026-09-10T14:00:00.000Z'),
    iniciadoEm: null,
    canceladoEm: null, canceladoPor: null, canceladoCategoria: null, canceladoMotivo: null,
    responsavel: SHERAD,
    ...parcial,
  };
}

function atendimento(parcial: Linha = {}): Linha {
  return {
    id: 'a-14', numero: 14, status: 'PENDENTE', desfecho: 'ENCAMINHADO', desfechoObs: null,
    concluidoEm: null, concluidoPor: null, conclusaoObs: null, conclusaoOrigem: null, conclusaoConsultaId: null,
    canceladoEm: null, canceladoPor: null, canceladoCategoria: null, canceladoMotivo: null,
    ...parcial,
  };
}

const clonar = <T>(x: T): T => {
  if (x instanceof Date) return new Date(x.getTime()) as T;
  if (Array.isArray(x)) return x.map(clonar) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, clonar(v)])) as T;
  return x;
};

interface Banco {
  atendimento: Linha | null;
  compromissos: Linha[];
  movimentacoes: Linha[];
}

function montar(inicial: Banco, ganchos: { antesDaTransacao?: (bd: Banco) => void } = {}) {
  const estado = { bd: clonar(inicial) };
  const passos: string[] = [];

  /*
    O `where` como o Prisma o lê, no pedaço que o serviço usa: igualdade (data
    pelo instante), `in`, `notIn`, `not`, e o `none` da relação com as
    consultas. `undefined` não filtra, como no Prisma.
  */
  const confere = (linha: Linha, where: Linha): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      if (v instanceof Date) return linha[k] instanceof Date && linha[k].getTime() === v.getTime();
      if (v && typeof v === 'object') {
        if ('in' in v) return (v.in as unknown[]).includes(linha[k]);
        if ('notIn' in v) return !(v.notIn as unknown[]).includes(linha[k]);
        if ('not' in v) return linha[k] !== v.not;
        if (k === 'compromissos' && 'none' in v) {
          return !estado.bd.compromissos.some((c) => c.atendimentoId === linha.id && confere(c, v.none));
        }
      }
      return linha[k] === v;
    });

  const api = {
    atendimento: {
      findUnique: async ({ include, select }: any) => {
        const a = estado.bd.atendimento;
        if (!a) return null;
        if (include) {
          return {
            ...clonar(a),
            filiado: { id: 'f-1', nomeCompleto: 'Iraci Moura', telefonePrincipal: '(86) 99812-3344', telefoneSecundario: null },
            atendente: JULIAN,
            processo: null,
            compromissos: clonar(estado.bd.compromissos),
            concluidoPorUsuario: a.concluidoPor ? PESSOAS[a.concluidoPor] ?? null : null,
            canceladoPorUsuario: a.canceladoPor ? PESSOAS[a.canceladoPor] ?? null : null,
          };
        }
        const linha: Linha = clonar(a);
        if (select?.compromissos) linha.compromissos = clonar(estado.bd.compromissos.filter((c) => !c.origemDesfechoId));
        if (select?.filiado) linha.filiado = { id: 'f-1', nomeCompleto: 'Iraci Moura' };
        return linha;
      },
      findMany: async () => [],
      updateMany: async ({ where, data }: any) => {
        passos.push('atendimento.updateMany');
        const a = estado.bd.atendimento;
        if (!a || !confere(a, where)) return { count: 0 };
        Object.assign(a, data);
        return { count: 1 };
      },
      // Sem condição nenhuma, como o `update` por id: está aqui para o teste de
      // corrida cair pelo que grava, e não por falta do método.
      update: async ({ data }: any) => {
        passos.push('atendimento.update');
        Object.assign(estado.bd.atendimento!, data);
        return clonar(estado.bd.atendimento);
      },
    },
    user: {
      findMany: async () => [{ ...SHERAD, role: 'ADVOGADO', permissoes: null, ativo: true }],
    },
    compromissoResponsavel: {
      deleteMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
      upsert: async () => ({}),
      findFirst: async () => ({ usuarioId: SHERAD.id }),
    },
    compromisso: {
      findUnique: async ({ where }: any) => clonar(estado.bd.compromissos.find((c) => c.id === where.id) ?? null),
      count: async ({ where }: any) => estado.bd.compromissos.filter((c) => confere(c, where)).length,
      create: async ({ data }: any) => {
        passos.push('compromisso.create');
        const nova = consulta({ ...data, id: `c-nova-${estado.bd.compromissos.length}`, status: 'PENDENTE' });
        estado.bd.compromissos.push(nova);
        return { id: nova.id };
      },
      updateMany: async ({ where, data }: any) => {
        passos.push(`compromisso.updateMany:${where.id}`);
        const alvo = estado.bd.compromissos.filter((c) => confere(c, where));
        alvo.forEach((c) => Object.assign(c, data));
        return { count: alvo.length };
      },
      update: async ({ where, data }: any) => {
        passos.push(`compromisso.update:${where.id}`);
        const c = estado.bd.compromissos.find((x) => x.id === where.id)!;
        Object.assign(c, data);
        return clonar(c);
      },
    },
    movimentacaoProcessual: {
      updateMany: async ({ where, data }: any) => {
        passos.push(`movimentacao.updateMany:${where.compromissoId}`);
        const alvo = estado.bd.movimentacoes.filter((m) => confere(m, where));
        alvo.forEach((m) => Object.assign(m, data));
        return { count: alvo.length };
      },
    },
  };

  const prisma = {
    ...api,
    $transaction: async (fn: any) => {
      passos.push('transacao:inicio');
      ganchos.antesDaTransacao?.(estado.bd);
      const copia = clonar(estado.bd);
      try {
        const r = await fn(api);
        passos.push('transacao:commit');
        return r;
      } catch (e) {
        estado.bd = copia;
        passos.push('transacao:desfeita');
        throw e;
      }
    },
  } as unknown as PrismaService;

  const audit = { registrar: jest.fn(async (r: any) => { passos.push(`audit:${r.entidade}`); }) };
  const agenda = {
    registrarNoHistorico: jest.fn(async (id: string, _registro: Record<string, any>) => { passos.push(`historico:${id}`); }),
  };
  const escalas = { listarPlantao: jest.fn(async () => []) };
  const svc = new AtendimentosService(
    prisma, audit as unknown as AuditService, escalas as unknown as EscalasService, agenda as unknown as AgendaService,
  );
  return { svc, estado, passos, audit, agenda };
}

const MUNDO_14: Banco = {
  atendimento: atendimento(),
  compromissos: [consulta({})],
  movimentacoes: [],
};

async function recusa(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).message;
  }
  throw new Error('era para recusar');
}

describe('concluir', () => {
  it('#14 com a consulta futura: cancela junto como Perdeu o objeto, com a nota, na mesma transação', async () => {
    const m = montar(MUNDO_14);
    const r: any = await m.svc.concluir('a-14', { nota: `  ${NOTA}  `, consulta: 'CANCELAR' }, CTX, AGORA);

    expect(m.estado.bd.atendimento).toMatchObject({
      status: 'CONCLUIDO', concluidoEm: AGORA, concluidoPor: 'u-julian', conclusaoObs: NOTA,
      // O carimbo da triagem: o desfazer de uma consulta nunca devolve este atendimento.
      conclusaoOrigem: 'TRIAGEM', conclusaoConsultaId: null,
      canceladoEm: null, canceladoCategoria: null,
    });
    expect(m.estado.bd.compromissos[0]).toMatchObject({
      status: 'CANCELADO',
      canceladoCategoria: 'PERDEU_OBJETO',
      canceladoMotivo: `Atendimento #14 concluído antes da consulta: ${NOTA}`,
      canceladoEm: AGORA,
      canceladoPor: 'u-julian',
      iniciadoEm: null,
    });

    // Gravações dentro da transação; linha do tempo e auditoria depois do commit.
    expect(m.passos).toEqual([
      'transacao:inicio',
      'atendimento.updateMany',
      'compromisso.updateMany:c-14',
      'movimentacao.updateMany:c-14',
      'transacao:commit',
      'historico:c-14',
      'audit:Compromisso',
      'audit:Atendimento',
    ]);

    const rotulo = CATEGORIA_CANCELAMENTO_LABEL.PERDEU_OBJETO;
    expect(m.agenda.registrarNoHistorico).toHaveBeenCalledWith('c-14', {
      acao: 'CANCELADO',
      descricao: `Cancelada — ${rotulo}. Atendimento #14 concluído antes da consulta: ${NOTA}`,
      metadata: { de: 'PENDENTE', categoria: 'PERDEU_OBJETO', motivo: `Atendimento #14 concluído antes da consulta: ${NOTA}` },
      autorId: 'u-julian',
      autorNome: 'Julian Helton',
    });
    const [daConsulta, doAtendimento] = m.audit.registrar.mock.calls.map((c: any[]) => c[0]);
    expect(daConsulta).toMatchObject({
      entidade: 'Compromisso', entidadeId: 'c-14', userId: 'u-julian', ip: '10.0.0.7',
      metadata: { atendimentoId: 'a-14', categoria: 'PERDEU_OBJETO' },
    });
    expect(doAtendimento).toMatchObject({
      entidade: 'Atendimento', entidadeId: 'a-14',
      descricao: 'Atendimento #14: andamento de PENDENTE para CONCLUIDO',
      metadata: {
        alteracoes: [{ campo: 'status', label: 'Andamento', de: 'PENDENTE', para: 'CONCLUIDO' }],
        nota: NOTA, consulta: 'CANCELAR', via: 'TRIAGEM', consultasCanceladas: ['c-14'], copiasCanceladas: [],
      },
    });

    // A resposta diz o que o servidor FEZ, e traz o telefone para o WhatsApp.
    expect(r.efeitos).toEqual({ consultasCanceladas: [{ id: 'c-14', inicio: QUINTA_9H, responsavel: SHERAD, categoria: 'PERDEU_OBJETO' }] });
    expect(r.atendimento.filiado.telefonePrincipal).toBe('(86) 99812-3344');
    expect(r.atendimento.concluidoPor).toEqual(JULIAN);
  });

  it('#14 sem cancelar junto: recusa com quem e quando, sem abrir transação', async () => {
    const m = montar(MUNDO_14);
    expect(await recusa(m.svc.concluir('a-14', { nota: NOTA }, CTX, AGORA)))
      .toBe('A consulta com a Dra. Shérad ainda não aconteceu (qui, 17/09 às 09:00). Para concluir agora, cancele a consulta junto.');
    expect(m.passos).toEqual([]);
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('as cópias do laço antigo seguem o mesmo destino; em andamento, cancelada e seguimento ficam', async () => {
    const m = montar({
      atendimento: atendimento(),
      compromissos: [
        consulta({ id: 'c-a' }),
        consulta({ id: 'c-b', createdAt: new Date('2026-09-10T14:00:01.000Z') }),
        consulta({ id: 'c-velha', inicio: new Date('2026-09-08T12:00:00.000Z'), status: 'CANCELADO' }),
        consulta({ id: 'c-retorno', inicio: QUINTA_9H, origemDesfechoId: 'c-velha' }),
      ],
      movimentacoes: [],
    });
    const r: any = await m.svc.concluir('a-14', { nota: NOTA, consulta: 'CANCELAR' }, CTX, AGORA);
    const status = Object.fromEntries(m.estado.bd.compromissos.map((c) => [c.id, c.status]));
    expect(status).toEqual({ 'c-a': 'CANCELADO', 'c-b': 'CANCELADO', 'c-velha': 'CANCELADO', 'c-retorno': 'PENDENTE' });
    expect(m.estado.bd.compromissos.find((c) => c.id === 'c-velha')!.canceladoPor).toBeNull();
    expect(r.efeitos.consultasCanceladas.map((c: any) => c.id).sort()).toEqual(['c-a', 'c-b']);
  });

  /*
    E2 da rodada 4 (15/09/2026). O #13: consulta de hoje às 09:00 ainda sem
    registro às 10:00. A triagem não responde mais pelo advogado: "aconteceu"
    (o corpo do web antigo) é recusado e nada é gravado; quem registra é quem
    atendeu, e o atendimento fecha junto.
  */
  const SEM_REGISTRO =
    'A consulta com a Dra. Shérad de seg, 14/09 às 09:00 ainda não foi registrada. '
    + 'Se aconteceu, quem registra é quem atendeu, e o atendimento fecha sozinho. '
    + 'Para concluir sem ela, cancele a consulta junto.';

  it.each<[string, Linha]>([
    ['"aconteceu" (web antigo)', { consulta: 'MANTER' }],
    ['sem escolha', { nota: NOTA }],
  ])('a consulta já começou, %s: recusado com a frase de quem registra, sem abrir transação', async (_caso, corpo) => {
    const m = montar({ atendimento: atendimento(), compromissos: [consulta({ inicio: HOJE_9H })], movimentacoes: [] });
    expect(await recusa(m.svc.concluir('a-14', corpo, CTX, AGORA))).toBe(SEM_REGISTRO);
    expect(m.passos).toEqual([]);
    expect(m.estado.bd.atendimento!.status).toBe('PENDENTE');
  });

  it('a consulta já começou e a demanda se resolveu sem ela: cancela como perdeu o objeto, com a nota da triagem', async () => {
    const m = montar({ atendimento: atendimento(), compromissos: [consulta({ inicio: HOJE_9H })], movimentacoes: [] });
    await m.svc.concluir('a-14', { consulta: 'CANCELAR', nota: 'A filiada resolveu direto com o RH.' }, CTX, AGORA);
    expect(m.estado.bd.atendimento).toMatchObject({ status: 'CONCLUIDO', conclusaoOrigem: 'TRIAGEM' });
    expect(m.estado.bd.compromissos[0]).toMatchObject({
      status: 'CANCELADO',
      canceladoCategoria: 'PERDEU_OBJETO',
      canceladoMotivo: 'Atendimento #14 concluído pela triagem sem a consulta: A filiada resolveu direto com o RH.',
    });
  });

  it('a consulta em andamento: concluir é recusado, e o atendimento espera o registro', async () => {
    const m = montar({ atendimento: atendimento(), compromissos: [consulta({ inicio: HOJE_9H, status: 'EM_ANDAMENTO' })], movimentacoes: [] });
    expect(await recusa(m.svc.concluir('a-14', {}, CTX, AGORA)))
      .toBe('A consulta com a Dra. Shérad está em andamento. Quando for registrada, o atendimento é concluído sozinho.');
    expect(m.passos).toEqual([]);
  });

  it('a tarefa do robô ligada à consulta é dispensada junto, com quem e por quê', async () => {
    const m = montar({
      ...MUNDO_14,
      movimentacoes: [{ id: 'm-1', compromissoId: 'c-14', dispensadoEm: null, dispensadoPor: null, dispensadoMotivo: null }],
    });
    await m.svc.concluir('a-14', { nota: NOTA, consulta: 'CANCELAR' }, CTX, AGORA);
    expect(m.estado.bd.movimentacoes[0]).toMatchObject({
      dispensadoEm: AGORA,
      dispensadoPor: 'u-julian',
      dispensadoMotivo: `Atividade cancelada — ${CATEGORIA_CANCELAMENTO_LABEL.PERDEU_OBJETO}: Atendimento #14 concluído antes da consulta: ${NOTA}`,
    });
  });

  it('outra pessoa fechou o atendimento entre a leitura e a gravação: "abra de novo", e a consulta fica', async () => {
    const m = montar(MUNDO_14, { antesDaTransacao: (bd) => { bd.atendimento!.status = 'CANCELADO'; } });
    expect(await recusa(m.svc.concluir('a-14', { nota: NOTA, consulta: 'CANCELAR' }, CTX, AGORA))).toBe(FRASE_ATENDIMENTO_MUDOU);
    expect(m.estado.bd.compromissos[0].status).toBe('PENDENTE');
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('o advogado concluiu a consulta enquanto o modal estava aberto: tudo desfeito, com a frase do atendimento', async () => {
    const m = montar(MUNDO_14, { antesDaTransacao: (bd) => { bd.compromissos[0].status = 'CONCLUIDO'; } });
    expect(await recusa(m.svc.concluir('a-14', { nota: NOTA, consulta: 'CANCELAR' }, CTX, AGORA))).toBe(FRASE_CONSULTA_MUDOU);
    // A transação desfez o atendimento concluído: ele continua pendente.
    expect(m.estado.bd.atendimento).toMatchObject({ status: 'PENDENTE', concluidoEm: null, conclusaoObs: null });
    expect(m.passos).toContain('transacao:desfeita');
    expect(m.agenda.registrarNoHistorico).not.toHaveBeenCalled();
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });
});

/*
  DEADLOCK COM A AGENDA VIRA FRASE, NÃO 500 (15/09/2026). A triagem grava o
  atendimento antes da consulta, e a agenda agora trava na mesma ordem; se o
  banco ainda abortar a transação (P2034), o balcão ouve a frase de corrida e
  nada fica gravado.
*/
describe('o banco abortou a transação por corrida', () => {
  const deadlock = () =>
    new Prisma.PrismaClientKnownRequestError('deadlock detectado', { code: 'P2034', clientVersion: '5.20.0' });

  it('concluir e cancelar: a frase do atendimento, sem nada gravado e sem auditoria', async () => {
    const conclusao = montar(MUNDO_14, { antesDaTransacao: () => { throw deadlock(); } });
    expect(await recusa(conclusao.svc.concluir('a-14', { nota: NOTA, consulta: 'CANCELAR' }, CTX, AGORA))).toBe(FRASE_ATENDIMENTO_MUDOU);
    expect(conclusao.estado.bd).toEqual(MUNDO_14);
    expect(conclusao.audit.registrar).not.toHaveBeenCalled();

    const cancelamento = montar(MUNDO_14, { antesDaTransacao: () => { throw deadlock(); } });
    expect(await recusa(cancelamento.svc.cancelar(
      'a-14', { categoria: 'DESISTENCIA', motivo: 'Arranjou advogado próprio.', consulta: 'CANCELAR' }, CTX, AGORA,
    ))).toBe(FRASE_ATENDIMENTO_MUDOU);
    expect(cancelamento.estado.bd).toEqual(MUNDO_14);
    expect(cancelamento.audit.registrar).not.toHaveBeenCalled();
  });

  it('um erro que não é corrida continua o mesmo erro', async () => {
    const caiu = new Error('conexão caiu');
    const m = montar(MUNDO_14, { antesDaTransacao: () => { throw caiu; } });
    await expect(m.svc.concluir('a-14', { nota: NOTA, consulta: 'CANCELAR' }, CTX, AGORA)).rejects.toBe(caiu);
  });
});

describe('cancelar', () => {
  it('com "cancelar também": a consulta recebe a MESMA categoria e o motivo cita o atendimento', async () => {
    const m = montar(MUNDO_14);
    const r: any = await m.svc.cancelar(
      'a-14', { categoria: 'DESISTENCIA', motivo: ' Arranjou advogado próprio. ', consulta: 'CANCELAR' }, CTX, AGORA,
    );
    expect(m.estado.bd.atendimento).toMatchObject({
      status: 'CANCELADO', canceladoEm: AGORA, canceladoPor: 'u-julian',
      canceladoCategoria: 'DESISTENCIA', canceladoMotivo: 'Arranjou advogado próprio.',
      concluidoEm: null,
    });
    expect(m.estado.bd.compromissos[0]).toMatchObject({
      status: 'CANCELADO', canceladoCategoria: 'DESISTENCIA',
      canceladoMotivo: 'Atendimento #14 cancelado: Arranjou advogado próprio.',
    });
    expect(r.efeitos.consultasCanceladas).toHaveLength(1);
    const doAtendimento = m.audit.registrar.mock.calls.map((c: any[]) => c[0]).find((x: any) => x.entidade === 'Atendimento');
    expect(doAtendimento).toMatchObject({
      descricao: 'Atendimento #14: andamento de PENDENTE para CANCELADO',
      metadata: { categoria: 'DESISTENCIA', motivo: 'Arranjou advogado próprio.', consultasCanceladas: ['c-14'] },
    });
  });

  it('sem detalhe, o motivo da consulta é só a origem', async () => {
    const m = montar(MUNDO_14);
    await m.svc.cancelar('a-14', { categoria: 'NAO_COMPARECEU', consulta: 'CANCELAR' }, CTX, AGORA);
    expect(m.estado.bd.compromissos[0].canceladoMotivo).toBe('Atendimento #14 cancelado.');
    expect(m.estado.bd.atendimento!.canceladoMotivo).toBeNull();
  });

  it('duplicidade mantendo a consulta: a consulta fica, e nada vai para a linha do tempo dela', async () => {
    const m = montar(MUNDO_14);
    const r: any = await m.svc.cancelar('a-14', { categoria: 'DUPLICIDADE', consulta: 'MANTER' }, CTX, AGORA);
    expect(m.estado.bd.atendimento!.status).toBe('CANCELADO');
    expect(m.estado.bd.compromissos[0].status).toBe('PENDENTE');
    expect(r.efeitos).toEqual({ consultasCanceladas: [] });
    expect(m.agenda.registrarNoHistorico).not.toHaveBeenCalled();
  });

  it('concluído não vira cancelado sem reabrir', async () => {
    const m = montar({ ...MUNDO_14, atendimento: atendimento({ status: 'CONCLUIDO' }) });
    expect(await recusa(m.svc.cancelar('a-14', { categoria: 'DUPLICIDADE' }, CTX, AGORA)))
      .toBe('Atendimento concluído: reabra antes de cancelar.');
    expect(m.passos).toEqual([]);
  });
});

/**
 * A PRÉVIA LÊ A MESMA REGRA. O detalhe mostra ao modal o `fechamento`; a
 * gravação recusa exatamente o que ele diz. Se alguém mudar a regra num lado
 * só, este teste cai.
 */
describe('o detalhe e a gravação usam o mesmo plano', () => {
  const MUNDOS: [string, Banco][] = [
    ['#14 com consulta futura', MUNDO_14],
    ['consulta já começou', { atendimento: atendimento(), compromissos: [consulta({ inicio: HOJE_9H })], movimentacoes: [] }],
    ['consulta em andamento', { atendimento: atendimento(), compromissos: [consulta({ inicio: HOJE_9H, status: 'EM_ANDAMENTO' })], movimentacoes: [] }],
    ['sem desfecho', { atendimento: atendimento({ desfecho: null }), compromissos: [], movimentacoes: [] }],
    ['já concluído', { atendimento: atendimento({ status: 'CONCLUIDO' }), compromissos: [], movimentacoes: [] }],
    ['já cancelado', { atendimento: atendimento({ status: 'CANCELADO' }), compromissos: [], movimentacoes: [] }],
  ];

  it.each(MUNDOS)('%s', async (_nome, mundo) => {
    const m = montar(mundo);
    const { atendimento: lido } = (await m.svc.detalhe('a-14', AGORA)) as any;
    const nascidas = mundo.compromissos.filter((c) => !c.origemDesfechoId);
    expect(lido.fechamento).toEqual(planoDeFechamento(mundo.atendimento as any, nascidas as any, AGORA));
    // A fila da gaveta é a da lista e do painel (E3).
    expect(lido.fila).toEqual(filaDoAtendimento(mundo.atendimento as any, nascidas as any, AGORA));

    if (!lido.fechamento.concluir.permitido) {
      expect(await recusa(montar(mundo).svc.concluir('a-14', { nota: NOTA, consulta: 'CANCELAR' }, CTX, AGORA)))
        .toBe(lido.fechamento.concluir.recusa);
    }
    if (!lido.fechamento.cancelar.permitido) {
      expect(await recusa(montar(mundo).svc.cancelar('a-14', { categoria: 'DESISTENCIA', consulta: 'CANCELAR' }, CTX, AGORA)))
        .toBe(lido.fechamento.cancelar.recusa);
    }
    if (lido.fechamento.cancelar.permitido && lido.fechamento.cancelar.consulta === 'SO_MANTER') {
      expect(await recusa(montar(mundo).svc.cancelar('a-14', { categoria: 'DESISTENCIA', consulta: 'CANCELAR' }, CTX, AGORA)))
        .toBe(FRASE_EM_ANDAMENTO);
    }
  });

  it('#14 (consulta de quinta) e #13 (consulta de hoje): aguardando a consulta, e o atendimento fecha sozinho', async () => {
    const quatorze = (await montar(MUNDO_14).svc.detalhe('a-14', AGORA)) as any;
    expect(quatorze.atendimento.fila).toEqual({ fila: 'CONSULTA', motivo: 'AGUARDANDO' });
    expect(quatorze.atendimento.fechamento.fechaSozinho).toBe(true);

    const treze = (await montar({ atendimento: atendimento(), compromissos: [consulta({ inicio: HOJE_9H })], movimentacoes: [] })
      .svc.detalhe('a-14', AGORA)) as any;
    expect(treze.atendimento.fila).toEqual({ fila: 'CONSULTA', motivo: 'AGUARDANDO' });
    expect(treze.atendimento.fechamento.fechaSozinho).toBe(true);
  });
});

/**
 * AS CÓPIAS QUE SOBRARAM SAEM COMO DUPLICIDADE (15/09/2026, E4 da rodada 4;
 * auditoria do atendimento, defeito 1). A consulta da Dra. Shérad já foi
 * registrada e a cópia do Dr. Murilo, do laço antigo, continuava pendente na
 * agenda dele depois de o atendimento fechar.
 */
describe('as cópias que sobraram', () => {
  const MURILO = { id: 'u-murilo', nome: 'Murilo Sousa', nomeExibicao: 'Dr. Murilo', avatarUrl: null, avatarKey: null };
  const COM_COPIAS: Banco = {
    atendimento: atendimento(),
    compromissos: [
      consulta({ id: 'c-14', inicio: HOJE_9H, status: 'CONCLUIDO' }),
      consulta({ id: 'c-copia', inicio: HOJE_9H, responsavel: MURILO, createdAt: new Date('2026-09-10T13:59:00.000Z') }),
      consulta({ id: 'c-andando', inicio: HOJE_9H, status: 'EM_ANDAMENTO', createdAt: new Date('2026-09-10T13:58:00.000Z') }),
    ],
    movimentacoes: [],
  };
  const MOTIVO = 'a consulta com a Dra. Shérad de seg, 14/09 às 09:00 já foi registrada, e esta cópia sobrou.';

  it('concluir: a cópia pendente sai como duplicidade, a em andamento fica, e a resposta diz qual saiu', async () => {
    const m = montar(COM_COPIAS);
    const r: any = await m.svc.concluir('a-14', {}, CTX, AGORA);

    const porId = Object.fromEntries(m.estado.bd.compromissos.map((c) => [c.id, c]));
    expect(porId['c-14'].status).toBe('CONCLUIDO');
    expect(porId['c-andando'].status).toBe('EM_ANDAMENTO');
    expect(porId['c-copia']).toMatchObject({
      status: 'CANCELADO',
      canceladoCategoria: 'DUPLICIDADE',
      canceladoMotivo: `Atendimento #14 concluído: ${MOTIVO}`,
      canceladoPor: 'u-julian',
    });
    expect(m.estado.bd.atendimento).toMatchObject({ status: 'CONCLUIDO', conclusaoOrigem: 'TRIAGEM' });
    // A categoria vai na resposta: o web (`lib/atendimentos.ts`) separa a cópia DUPLICIDADE da consulta cancelada.
    expect(r.efeitos.consultasCanceladas).toEqual([{ id: 'c-copia', inicio: HOJE_9H, responsavel: MURILO, categoria: 'DUPLICIDADE' }]);
    expect(m.agenda.registrarNoHistorico).toHaveBeenCalledWith('c-copia', expect.objectContaining({ acao: 'CANCELADO' }));
    const doAtendimento = m.audit.registrar.mock.calls.map((c: any[]) => c[0]).find((x: any) => x.entidade === 'Atendimento');
    expect(doAtendimento.metadata).toMatchObject({ consultasCanceladas: ['c-copia'], copiasCanceladas: ['c-copia'] });
  });

  it('cancelar: a cópia sai do mesmo jeito, com o motivo do cancelamento', async () => {
    const m = montar(COM_COPIAS);
    await m.svc.cancelar('a-14', { categoria: 'DESISTENCIA' }, CTX, AGORA);
    const copia = m.estado.bd.compromissos.find((c) => c.id === 'c-copia')!;
    expect(copia).toMatchObject({ status: 'CANCELADO', canceladoCategoria: 'DUPLICIDADE', canceladoMotivo: `Atendimento #14 cancelado: ${MOTIVO}` });
    expect(m.estado.bd.atendimento).toMatchObject({ status: 'CANCELADO', canceladoCategoria: 'DESISTENCIA' });
  });

  it('o advogado iniciou a cópia no meio: tudo desfeito, com a frase da consulta', async () => {
    const m = montar(COM_COPIAS, { antesDaTransacao: (bd) => { bd.compromissos[1].status = 'EM_ANDAMENTO'; } });
    expect(await recusa(m.svc.concluir('a-14', {}, CTX, AGORA))).toBe(FRASE_CONSULTA_MUDOU);
    expect(m.estado.bd.atendimento).toMatchObject({ status: 'PENDENTE', conclusaoOrigem: null });
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });
});

describe('detalhe — o fechamento vira fato na ficha', () => {
  it('quem cancelou sai como pessoa, não como id; consulta nenhuma sai como nula', async () => {
    const m = montar({
      atendimento: atendimento({
        status: 'CANCELADO', canceladoEm: new Date('2026-09-13T13:12:00.000Z'), canceladoPor: 'u-julian',
        canceladoCategoria: 'DESISTENCIA', canceladoMotivo: 'Arranjou advogado próprio.',
      }),
      compromissos: [consulta({ status: 'CANCELADO' })],
      movimentacoes: [],
    });
    const { atendimento: lido } = (await m.svc.detalhe('a-14', AGORA)) as any;
    expect(lido).toMatchObject({
      canceladoPor: JULIAN, canceladoCategoria: 'DESISTENCIA', canceladoMotivo: 'Arranjou advogado próprio.',
      concluidoPor: null,
    });
    expect(lido).not.toHaveProperty('canceladoPorUsuario');
    expect(lido.fechamento.consulta).toBeNull();
  });

  it('registro antigo, de antes das colunas: tudo nulo, e a ficha não inventa bloco', async () => {
    const m = montar({ atendimento: atendimento({ status: 'CONCLUIDO' }), compromissos: [], movimentacoes: [] });
    const { atendimento: lido } = (await m.svc.detalhe('a-14', AGORA)) as any;
    expect(lido).toMatchObject({ concluidoEm: null, concluidoPor: null, conclusaoObs: null, canceladoPor: null });
  });
});

describe('mudarStatus — só o Reabrir', () => {
  it.each(['CONCLUIDO', 'CANCELADO'])('%s pelo /status: a frase manda atualizar, sem ler nem gravar', async (status) => {
    const m = montar(MUNDO_14);
    expect(await recusa(m.svc.mudarStatus('a-14', { status } as never, CTX))).toBe(FRASE_TELA_PROPRIA);
    expect(m.estado.bd.atendimento!.status).toBe('PENDENTE');
    expect(m.passos).toEqual([]);
  });

  it('reabrir o que já está pendente não grava nem audita', async () => {
    const m = montar(MUNDO_14);
    await m.svc.mudarStatus('a-14', { status: 'PENDENTE' } as never, CTX);
    expect(m.passos).toEqual([]);
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('reabrir o cancelado limpa as sete colunas, guarda o fechamento na auditoria e NÃO reabre a consulta', async () => {
    const m = montar({
      atendimento: atendimento({
        status: 'CANCELADO', canceladoEm: new Date('2026-09-13T13:12:00.000Z'), canceladoPor: 'u-julian',
        canceladoCategoria: 'DESISTENCIA', canceladoMotivo: 'Arranjou advogado próprio.',
      }),
      compromissos: [consulta({ status: 'CANCELADO', canceladoCategoria: 'DESISTENCIA' })],
      movimentacoes: [],
    });
    await m.svc.mudarStatus('a-14', { status: 'PENDENTE' } as never, CTX);
    expect(m.estado.bd.atendimento).toEqual(atendimento());
    expect(m.estado.bd.compromissos[0].status).toBe('CANCELADO');
    expect(m.audit.registrar.mock.calls[0][0]).toMatchObject({
      descricao: 'Atendimento #14: andamento de CANCELADO para PENDENTE',
      metadata: {
        fechamentoAnterior: {
          categoria: 'DESISTENCIA', motivo: 'Arranjou advogado próprio.',
          em: '2026-09-13T13:12:00.000Z', por: 'u-julian',
        },
      },
    });
  });

  it('reabrir o concluído leva a nota e a origem para a auditoria', async () => {
    const m = montar({
      atendimento: atendimento({
        status: 'CONCLUIDO', concluidoEm: AGORA, concluidoPor: 'u-julian', conclusaoObs: NOTA, conclusaoOrigem: 'TRIAGEM',
      }),
      compromissos: [],
      movimentacoes: [],
    });
    await m.svc.mudarStatus('a-14', { status: 'PENDENTE' } as never, CTX);
    expect(m.estado.bd.atendimento).toEqual(atendimento());
    expect(m.audit.registrar.mock.calls[0][0].metadata.fechamentoAnterior)
      .toEqual({ nota: NOTA, em: AGORA.toISOString(), por: 'u-julian', origem: 'TRIAGEM' });
  });

  /*
    O carimbo sai junto (15/09/2026). Se ficasse "pela consulta c-14", o desfazer
    daquela consulta devolveria de novo um atendimento que a triagem já reabriu.
  */
  it('reabrir o que a consulta fechou limpa o carimbo inteiro', async () => {
    const m = montar({
      atendimento: atendimento({
        status: 'CONCLUIDO', concluidoEm: AGORA, concluidoPor: 'u-sherad', conclusaoObs: 'Dúvida esclarecida.',
        conclusaoOrigem: 'CONSULTA', conclusaoConsultaId: 'c-14',
      }),
      compromissos: [consulta({ inicio: HOJE_9H, status: 'CONCLUIDO' })],
      movimentacoes: [],
    });
    await m.svc.mudarStatus('a-14', { status: 'PENDENTE' } as never, CTX);
    expect(m.estado.bd.atendimento).toEqual(atendimento());
    expect(m.estado.bd.compromissos[0].status).toBe('CONCLUIDO');
    expect(m.audit.registrar.mock.calls[0][0].metadata.fechamentoAnterior)
      .toEqual({ nota: 'Dúvida esclarecida.', em: AGORA.toISOString(), por: 'u-sherad', origem: 'CONSULTA' });
  });
});

/**
 * A CORRIDA ENTRE O DESFECHO E O FECHAMENTO (14/09/2026).
 *
 * O desfecho lia fora da transação e gravava com um `update` por id: dois
 * "Marcar consulta" de abas diferentes criavam duas consultas, e o cruzamento
 * com o concluir ou o cancelar deixava consulta viva em atendimento fechado.
 * O gancho `antesDaTransacao` faz o papel de quem comitou no intervalo.
 */
describe('corrida entre o desfecho e o fechamento', () => {
  const LIDO_EM = new Date('2026-09-14T12:59:00.000Z');
  const ENCAMINHAR = { resultado: 'ENCAMINHADO', tipoEncaminhamento: 'CONSULTA_NOVA', advogadoIds: ['u-sherad'] };
  /** O #14 com a consulta cancelada: o balcão pode marcar outra. */
  const SO_CANCELADA: Banco = {
    atendimento: atendimento({ updatedAt: LIDO_EM, urgente: false, urgenteMotivo: null }),
    compromissos: [consulta({ status: 'CANCELADO' })],
    movimentacoes: [],
  };
  const daOutraAba = () => consulta({ id: 'c-outra-aba', status: 'PENDENTE', inicio: new Date('2026-09-18T12:00:00.000Z') });
  const deDe = (bd: Banco) => bd.compromissos.filter((c) => !c.origemDesfechoId && c.status !== 'CANCELADO').map((c) => c.id);

  it.each<[string, (bd: Banco) => void]>([
    ['a consulta da outra aba já está gravada', (bd) => { bd.compromissos.push(daOutraAba()); }],
    ['a outra aba mudou o atendimento (o mesmo instante, em que a consulta ainda não aparece)', (bd) => {
      bd.atendimento!.updatedAt = new Date(LIDO_EM.getTime() + 40);
    }],
  ])('dois "Marcar consulta": %s — o segundo ouve "abra de novo" e não cria outra', async (_caso, outraAba) => {
    const m = montar(SO_CANCELADA, { antesDaTransacao: outraAba });
    expect(await recusa(m.svc.registrarDesfecho('a-14', ENCAMINHAR as never, CTX))).toBe(FRASE_ATENDIMENTO_MUDOU);
    expect(m.passos).not.toContain('compromisso.create');
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('o primeiro desfecho cruzou com o cancelar: nenhuma consulta nasce em atendimento cancelado', async () => {
    const m = montar(
      { atendimento: atendimento({ desfecho: null, updatedAt: LIDO_EM, urgente: false, urgenteMotivo: null }), compromissos: [], movimentacoes: [] },
      { antesDaTransacao: (bd) => { bd.atendimento!.status = 'CANCELADO'; } },
    );
    expect(await recusa(m.svc.registrarDesfecho('a-14', ENCAMINHAR as never, CTX))).toBe(FRASE_ATENDIMENTO_MUDOU);
    expect(m.estado.bd.compromissos).toEqual([]);
    expect(m.estado.bd.atendimento).toMatchObject({ status: 'CANCELADO', desfecho: null });
  });

  it('sem ninguém no meio, o novo encaminhamento passa e a consulta nasce', async () => {
    const m = montar(SO_CANCELADA);
    jest.spyOn(m.svc, 'detalhe').mockResolvedValue({} as never);
    await m.svc.registrarDesfecho('a-14', ENCAMINHAR as never, CTX);
    expect(deDe(m.estado.bd)).toHaveLength(1);
  });

  it.each<[string, (m: ReturnType<typeof montar>) => Promise<unknown>]>([
    ['concluir', (m) => m.svc.concluir('a-14', { nota: NOTA }, CTX, AGORA)],
    ['cancelar', (m) => m.svc.cancelar('a-14', { categoria: 'DESISTENCIA' }, CTX, AGORA)],
  ])('%s leu "nenhuma consulta" e a nova comitou antes: tudo desfeito, com a frase da consulta', async (_acao, fechar) => {
    const m = montar(SO_CANCELADA, { antesDaTransacao: (bd) => { bd.compromissos.push(daOutraAba()); } });
    expect(await recusa(fechar(m))).toBe(FRASE_CONSULTA_MUDOU);
    expect(m.estado.bd.atendimento).toMatchObject({ status: 'PENDENTE', concluidoEm: null, canceladoEm: null });
    expect(deDe(m.estado.bd)).toEqual(['c-outra-aba']);
    expect(m.passos).toContain('transacao:desfeita');
    expect(m.audit.registrar).not.toHaveBeenCalled();
  });

  it('a consulta lida e mantida não é "nova": cancelar com a consulta em andamento passa e a mantém', async () => {
    const m = montar({ atendimento: atendimento(), compromissos: [consulta({ inicio: HOJE_9H, status: 'EM_ANDAMENTO' })], movimentacoes: [] });
    await m.svc.cancelar('a-14', { categoria: 'DESISTENCIA' }, CTX, AGORA);
    expect(m.estado.bd.atendimento!.status).toBe('CANCELADO');
    expect(m.estado.bd.compromissos[0].status).toBe('EM_ANDAMENTO');
  });
});

describe('mudarModalidadeDaConsulta — "Mudar como vai ser"', () => {
  function comConsulta(parcial: Linha) {
    return montar({ atendimento: atendimento(), compromissos: [consulta(parcial)], movimentacoes: [] });
  }

  it('da sede para vídeo com o link: local da modalidade, link normalizado, auditoria e linha do tempo', async () => {
    const m = comConsulta({});
    await m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'VIDEO', linkReuniao: 'meet.google.com/abc-defg-hij' }, CTX);
    expect(m.estado.bd.compromissos[0]).toMatchObject({
      local: 'Por chamada de vídeo', linkReuniao: 'https://meet.google.com/abc-defg-hij',
    });
    const registro = m.audit.registrar.mock.calls[0][0];
    expect(registro).toMatchObject({ entidade: 'Compromisso', entidadeId: 'c-14', metadata: { atendimentoId: 'a-14' } });
    expect(registro.metadata.alteracoes).toEqual([
      { campo: 'local', label: 'Local', de: null, para: 'Por chamada de vídeo' },
      { campo: 'linkReuniao', label: 'Link da chamada', de: null, para: 'https://meet.google.com/abc-defg-hij' },
    ]);
    expect(m.agenda.registrarNoHistorico).toHaveBeenCalledWith('c-14', expect.objectContaining({
      acao: 'EDITADO',
      descricao: 'Modalidade trocada pelo atendimento #14: na sede → por vídeo, com o link da chamada.',
      autorId: 'u-julian',
      autorNome: 'Julian Helton',
    }));
  });

  it('o texto livre é sobrescrito, porque a escolha é explícita e o de→para fica guardado', async () => {
    const m = comConsulta({ local: 'SENATEPI' });
    await m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'TELEFONE' }, CTX);
    expect(m.estado.bd.compromissos[0].local).toBe('Por telefone');
    expect(m.agenda.registrarNoHistorico.mock.calls[0][1])
      .toMatchObject({ descricao: 'Modalidade trocada pelo atendimento #14: "SENATEPI" → por telefone.' });
  });

  it('sair do vídeo zera o link', async () => {
    const m = comConsulta({ local: 'Por chamada de vídeo', linkReuniao: 'https://meet.google.com/abc-defg-hij' });
    await m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'SEDE' }, CTX);
    expect(m.estado.bd.compromissos[0]).toMatchObject({ local: null, linkReuniao: null });
  });

  it('no vídeo sem mandar o link, o link que existe fica', async () => {
    const m = comConsulta({ local: 'Sala 2', linkReuniao: 'https://meet.google.com/abc-defg-hij' });
    await m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'VIDEO' }, CTX);
    expect(m.estado.bd.compromissos[0]).toMatchObject({
      local: 'Por chamada de vídeo', linkReuniao: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('só o link muda: a linha do tempo diz que o link foi trocado', async () => {
    const m = comConsulta({ local: 'Por chamada de vídeo', linkReuniao: 'https://meet.google.com/abc-defg-hij' });
    await m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'VIDEO', linkReuniao: 'https://zoom.us/j/123456' }, CTX);
    expect(m.agenda.registrarNoHistorico.mock.calls[0][1])
      .toMatchObject({ descricao: 'Link da chamada trocado pelo atendimento #14.' });
  });

  it('nada mudou: sem gravação, sem auditoria e sem linha do tempo', async () => {
    const m = comConsulta({ local: 'Por telefone' });
    await m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'TELEFONE' }, CTX);
    expect(m.passos).toEqual([]);
    expect(m.audit.registrar).not.toHaveBeenCalled();
    expect(m.agenda.registrarNoHistorico).not.toHaveBeenCalled();
  });

  it('link fora do vídeo é recusado com a frase de sempre', async () => {
    const m = comConsulta({});
    expect(await recusa(m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'TELEFONE', linkReuniao: 'https://meet.google.com/x' }, CTX)))
      .toBe('O link da chamada só vale para consulta por vídeo.');
  });

  it.each([
    ['CONCLUIDO', 'concluída'],
    ['CANCELADO', 'cancelada'],
  ])('consulta %s não muda', async (status, palavra) => {
    const m = comConsulta({ status });
    expect(await recusa(m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'VIDEO' }, CTX))).toContain(palavra);
    expect(m.passos).toEqual([]);
  });

  it('o seguimento que herdou o atendimento não é a consulta: 404', async () => {
    const m = comConsulta({ origemDesfechoId: 'c-0' });
    await expect(m.svc.mudarModalidadeDaConsulta('a-14', 'c-14', { modalidade: 'VIDEO' }, CTX))
      .rejects.toThrow('não nasceu deste atendimento');
  });
});
