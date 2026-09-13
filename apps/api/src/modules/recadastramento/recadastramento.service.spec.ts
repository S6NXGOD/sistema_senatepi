import { NotFoundException } from '@nestjs/common';
import { RecadastramentoService } from './recadastramento.service';

/**
 * CONFERÊNCIA E LISTA DE RECADASTRAMENTOS — comportamento, com prisma de mentira.
 */

const ONLINE = 'Recadastramento ONLINE feito pelo próprio filiado (link).';

function linha(p: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    filiadoId: 'f1',
    status: 'PENDENTE',
    observacao: ONLINE,
    createdAt: new Date('2026-09-12T13:00:00.000Z'),
    revisadoEm: null,
    revisor: null,
    dadosAnteriores: { cidade: 'Teresina', telefonePrincipal: null },
    dadosNovos: { cidade: 'Parnaíba', telefonePrincipal: '(86) 99999-8888' },
    filiado: { nomeCompleto: 'MARIA DA SILVA' },
    ...p,
  };
}

function montar(opts: { antes?: Record<string, unknown> | null; depois?: Record<string, unknown>; count?: number } = {}) {
  const prisma = {
    recadastramento: {
      findUnique: jest.fn().mockResolvedValue(opts.antes === undefined ? linha() : opts.antes),
      updateMany: jest.fn().mockResolvedValue({ count: opts.count ?? 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(
        opts.depois ?? linha({
          status: 'APROVADO', revisor: { id: 'u1', nome: 'ANA' },
          revisadoEm: new Date('2026-09-13T17:04:00.000Z'),
        }),
      ),
      findMany: jest.fn(),
    },
  };
  const audit = { registrar: jest.fn().mockResolvedValue(undefined) };
  const service = new RecadastramentoService(prisma as never, audit as never);
  return { service, prisma, audit };
}

describe('conferir', () => {
  it('PENDENTE vira APROVADO com revisor e data, numa troca condicional, e fica na auditoria', async () => {
    const { service, prisma, audit } = montar();
    const r = await service.conferir('r1', { userId: 'u1', ip: '1.2.3.4' });

    const troca = prisma.recadastramento.updateMany.mock.calls[0][0];
    expect(troca.where).toEqual({ id: 'r1', status: 'PENDENTE' });
    expect(troca.data).toMatchObject({ status: 'APROVADO', revisorId: 'u1' });
    expect(troca.data.revisadoEm).toBeInstanceOf(Date);

    const registro = audit.registrar.mock.calls[0][0];
    expect(registro).toMatchObject({
      userId: 'u1', acao: 'UPDATE', entidade: 'Recadastramento', entidadeId: 'r1',
      descricao: 'Recadastramento de MARIA DA SILVA conferido (feito pelo próprio filiado, pelo link)',
      metadata: {
        filiadoId: 'f1',
        alteracoes: [{ campo: 'status', label: 'Andamento', de: 'PENDENTE', para: 'APROVADO' }],
        camposConferidos: 2,
      },
    });

    expect(r).toEqual({
      id: 'r1', status: 'APROVADO', origem: 'ONLINE',
      createdAt: new Date('2026-09-12T13:00:00.000Z'),
      revisadoEm: new Date('2026-09-13T17:04:00.000Z'),
      revisor: { id: 'u1', nome: 'ANA' },
      alteracoes: [
        { campo: 'telefonePrincipal', rotulo: 'Telefone', de: null, para: '(86) 99999-8888' },
        { campo: 'cidade', rotulo: 'Cidade', de: 'Teresina', para: 'Parnaíba' },
      ],
    });
  });

  it('já conferido: diz por quem e quando (no fuso de Teresina), sem gravar nada', async () => {
    const { service, prisma, audit } = montar({
      antes: linha({
        status: 'APROVADO', revisor: { id: 'u2', nome: 'BIA' },
        revisadoEm: new Date('2026-09-12T17:04:00.000Z'),
      }),
    });
    await expect(service.conferir('r1', { userId: 'u1' })).rejects.toThrow(
      /já foi conferido por BIA em 12\/09\/2026.*14:04/,
    );
    expect(prisma.recadastramento.updateMany).not.toHaveBeenCalled();
    expect(audit.registrar).not.toHaveBeenCalled();
  });

  it('dois cliques ao mesmo tempo: o segundo perde a troca e lê quem conferiu', async () => {
    const { service, audit } = montar({
      count: 0,
      depois: linha({ status: 'APROVADO', revisor: { id: 'u2', nome: 'BIA' }, revisadoEm: new Date() }),
    });
    await expect(service.conferir('r1', { userId: 'u1' })).rejects.toThrow(/já foi conferido por BIA/);
    expect(audit.registrar).not.toHaveBeenCalled();
  });

  it('presencial (nasce APROVADO, sem revisor) e recusado têm frase própria', async () => {
    await expect(
      montar({ antes: linha({ status: 'APROVADO', observacao: null }) }).service.conferir('r1', {}),
    ).rejects.toThrow('Este recadastramento foi feito pela equipe e já nasceu conferido.');
    await expect(
      montar({ antes: linha({ status: 'REJEITADO' }) }).service.conferir('r1', {}),
    ).rejects.toThrow(/foi recusado/);
  });

  it('inexistente: 404', async () => {
    await expect(montar({ antes: null }).service.conferir('x', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('listar', () => {
  it('cada item vem com origem, revisor e de→para — sem os JSONs crus', async () => {
    const { service, prisma } = montar();
    prisma.recadastramento.findMany.mockResolvedValue([
      linha(),
      linha({
        id: 'r0', observacao: null, status: 'APROVADO',
        revisor: null, dadosAnteriores: { cidade: 'A' }, dadosNovos: { cidade: 'A' },
      }),
    ]);
    const itens = await service.listar('f1');
    expect(itens.map((i) => [i.id, i.origem, i.status, i.alteracoes.length])).toEqual([
      ['r1', 'ONLINE', 'PENDENTE', 2],
      ['r0', 'PRESENCIAL', 'APROVADO', 0],
    ]);
    expect(Object.keys(itens[0]).sort()).toEqual(
      ['alteracoes', 'createdAt', 'id', 'origem', 'revisadoEm', 'revisor', 'status'],
    );
  });
});

describe('recadastro presencial — a porta de situação', () => {
  function montarPresencial(situacaoAtual: string) {
    const prisma = {
      filiado: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'f1', situacao: situacaoAtual, cpf: null, rg: null, ufRg: null,
          dataNascimento: null, naturalidade: null, dataAdmissao: null, vinculos: [], dependentes: [],
        }),
        update: jest.fn().mockResolvedValue({ id: 'f1' }),
      },
      recadastramento: { create: jest.fn().mockResolvedValue({}) },
      filiadoHistorico: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return { service: new RecadastramentoService(prisma as never, {} as never), prisma };
  }

  it('não reativa um desfiliado por fora da ação "Reativar"', async () => {
    const { service, prisma } = montarPresencial('DESFILIADO');
    await expect(service.submeter('f1', { situacao: 'ATIVO' } as never, 'ANA')).rejects.toThrow(
      /Para reativar, use a ação "Reativar"/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('não desfilia por fora da ação "Desfiliar"', async () => {
    const { service } = montarPresencial('ATIVO');
    await expect(service.submeter('f1', { situacao: 'DESFILIADO' } as never, 'ANA')).rejects.toThrow(
      /Para desfiliar, use a ação "Desfiliar"/,
    );
  });

  it('a situação que o formulário reenvia igual, ou ATIVO ↔ INATIVO, segue passando', async () => {
    const desfiliado = montarPresencial('DESFILIADO');
    await desfiliado.service.submeter('f1', { situacao: 'DESFILIADO', cidade: 'X' } as never, 'ANA');
    expect(desfiliado.prisma.$transaction).toHaveBeenCalledTimes(1);

    const inativo = montarPresencial('INATIVO');
    await inativo.service.submeter('f1', { situacao: 'ATIVO' } as never, 'ANA');
    expect(inativo.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
