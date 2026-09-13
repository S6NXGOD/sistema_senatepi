import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EscalasService, diaDoPlantao, rangeMes } from './escalas.service';

/**
 * O SERVIÇO DA ESCALA COM UM BANCO DE MENTIRA.
 *
 * Até 13/09/2026 a API não tinha nenhum teste deste módulo (a auditoria de
 * escalas registrou isso). O que se prova aqui é o que a Coordenação passa a
 * poder fazer — corrigir e trocar — e o que o sistema passa a recusar:
 * sobreposição da mesma pessoa, lote com data repetida, pessoa inativa.
 */

type Linha = {
  id: string; advogadoId: string; data: Date; horaInicio: string; horaFim: string;
  observacao: string | null; criadoPor?: string;
};
type Pessoa = { id: string; nome: string; nomeExibicao: string | null; ativo: boolean };

const PESSOAS: Pessoa[] = [
  { id: 'sherad', nome: 'Shérad Lima', nomeExibicao: 'Dra. Shérad', ativo: true },
  { id: 'murilo', nome: 'Murilo Sá', nomeExibicao: 'Dr. Murilo', ativo: true },
  { id: 'antiga', nome: 'Rosa Antiga', nomeExibicao: null, ativo: false },
];

const dia = (t: string) => new Date(`${t}T00:00:00.000Z`);

function montar(linhasIniciais: Linha[] = []) {
  const linhas = [...linhasIniciais];
  const auditoria: Array<Record<string, any>> = [];

  const comPessoa = (l: Linha) => {
    const p = PESSOAS.find((x) => x.id === l.advogadoId)!;
    return { ...l, advogado: { id: p.id, nome: p.nome, nomeExibicao: p.nomeExibicao } };
  };

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => PESSOAS.find((p) => p.id === where.id) ?? null),
    },
    escalaAdvogado: {
      findMany: jest.fn(async ({ where }: any) =>
        linhas
          .filter((l) => !where.advogadoId || l.advogadoId === where.advogadoId)
          .filter((l) => !where.data?.in || where.data.in.some((d: Date) => d.getTime() === l.data.getTime()))
          .map(comPessoa),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const l = linhas.find((x) => x.id === where.id);
        return l ? comPessoa(l) : null;
      }),
      createMany: jest.fn(async ({ data }: any) => {
        linhas.push(...data);
        return { count: data.length };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const l = linhas.find((x) => x.id === where.id)!;
        Object.assign(l, data);
        return comPessoa(l);
      }),
      delete: jest.fn(),
    },
  };
  const audit = { registrar: jest.fn(async (r: Record<string, any>) => { auditoria.push(r); }) };
  const service = new EscalasService(prisma as never, audit as never);
  return { service, prisma, linhas, auditoria };
}

const ctx = { userId: 'coord', ip: '127.0.0.1', userAgent: 'jest' };

const plantao = (id: string, advogadoId: string, data: string, horaInicio = '09:00', horaFim = '12:00'): Linha => ({
  id, advogadoId, data: dia(data), horaInicio, horaFim, observacao: null,
});

async function recusa(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as Error).message;
  }
  throw new Error('era para recusar');
}

describe('EscalasService.criar', () => {
  it('grava o dia como data pura e audita com os ids criados', async () => {
    const { service, linhas, auditoria } = montar();
    const r = await service.criar(
      {
        advogadoId: 'sherad',
        itens: [
          { data: '2026-09-15', horaInicio: '09:00', horaFim: '12:00', observacao: '  ' },
          { data: '2026-09-22', horaInicio: '09:00', horaFim: '12:00', observacao: 'Substitui o Dr. Murilo' },
        ],
      },
      ctx,
    );

    expect(r.criadas).toBe(2);
    expect(linhas.map((l) => l.data.toISOString())).toEqual([
      '2026-09-15T00:00:00.000Z',
      '2026-09-22T00:00:00.000Z',
    ]);
    expect(linhas.map((l) => l.observacao)).toEqual([null, 'Substitui o Dr. Murilo']);

    expect(auditoria).toHaveLength(1);
    const ids = linhas.map((l) => l.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 10)).toBe(true);
    expect(auditoria[0].metadata.ids).toEqual(ids);
    expect(r.ids).toEqual(ids);
    expect(auditoria[0].metadata.quantidade).toBe(2);
  });

  it('recusa sobreposição com plantão já gravado, dizendo dia, pessoa e horário', async () => {
    const { service, prisma } = montar([plantao('e1', 'sherad', '2026-09-15')]);
    const msg = await recusa(
      service.criar({ advogadoId: 'sherad', itens: [{ data: '2026-09-15', horaInicio: '11:00', horaFim: '13:00' }] }, ctx),
    );
    expect(msg).toBe('Em 15/09 a Dra. Shérad já está de plantão 09:00–12:00.');
    expect(prisma.escalaAdvogado.createMany).not.toHaveBeenCalled();
  });

  it('o plantão de OUTRA pessoa no mesmo horário não é sobreposição', async () => {
    const { service } = montar([plantao('e1', 'murilo', '2026-09-15')]);
    await expect(
      service.criar({ advogadoId: 'sherad', itens: [{ data: '2026-09-15', horaInicio: '09:00', horaFim: '12:00' }] }, ctx),
    ).resolves.toMatchObject({ criadas: 1 });
  });

  it('dois turnos no mesmo dia (manhã e tarde) continuam permitidos', async () => {
    const { service } = montar([plantao('e1', 'sherad', '2026-09-15')]);
    await expect(
      service.criar({ advogadoId: 'sherad', itens: [{ data: '2026-09-15', horaInicio: '14:00', horaFim: '17:00' }] }, ctx),
    ).resolves.toMatchObject({ criadas: 1 });
  });

  it('recusa o lote que repete a mesma data em horário sobreposto, sem gravar nada', async () => {
    const { service, prisma } = montar();
    const msg = await recusa(
      service.criar(
        {
          advogadoId: 'sherad',
          itens: [
            { data: '2026-09-15', horaInicio: '09:00', horaFim: '12:00' },
            { data: '2026-09-15', horaInicio: '09:00', horaFim: '12:00' },
          ],
        },
        ctx,
      ),
    );
    expect(msg).toBe('O pedido repete 15/09 em horários que se sobrepõem (09:00–12:00 e 09:00–12:00).');
    expect(prisma.escalaAdvogado.createMany).not.toHaveBeenCalled();
  });

  it('recusa pessoa inativa e pessoa que não existe', async () => {
    const { service } = montar();
    const item = [{ data: '2026-09-15', horaInicio: '09:00', horaFim: '12:00' }];
    expect(await recusa(service.criar({ advogadoId: 'antiga', itens: item }, ctx)))
      .toBe('O cadastro de Rosa Antiga está inativo; não dá para escalar quem não usa mais o sistema.');
    expect(await recusa(service.criar({ advogadoId: 'ninguem', itens: item }, ctx)))
      .toBe('Pessoa não encontrada para a escala.');
  });

  it('recusa fim antes do início e dia que não existe', async () => {
    const { service } = montar();
    expect(
      await recusa(service.criar({ advogadoId: 'sherad', itens: [{ data: '2026-09-15', horaInicio: '12:00', horaFim: '09:00' }] }, ctx)),
    ).toBe('Em 15/09, a hora de fim deve ser após a de início.');
    expect(
      await recusa(service.criar({ advogadoId: 'sherad', itens: [{ data: '2026-02-31', horaInicio: '09:00', horaFim: '12:00' }] }, ctx)),
    ).toBe('A data 2026-02-31 não existe no calendário.');
  });
});

describe('EscalasService.atualizar', () => {
  it('troca a pessoa: grava, e o log diz quem assumiu no lugar de quem, por nome', async () => {
    const { service, linhas, auditoria } = montar([plantao('e1', 'sherad', '2026-09-15')]);
    const r = await service.atualizar('e1', { advogadoId: 'murilo' }, ctx);

    expect(linhas[0].advogadoId).toBe('murilo');
    expect(r).toMatchObject({ id: 'e1', advogado: { id: 'murilo' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      acao: 'UPDATE',
      entidade: 'EscalaAdvogado',
      entidadeId: 'e1',
      descricao: 'O Dr. Murilo assumiu o plantão de 15/09 no lugar de Shérad Lima',
    });
    expect(auditoria[0].metadata).toMatchObject({
      troca: true,
      advogadoAnteriorId: 'sherad',
      advogadoId: 'murilo',
      alteracoes: [{ campo: 'advogadoId', label: 'Quem está de plantão', de: 'Shérad Lima', para: 'Murilo Sá' }],
    });
  });

  it('a troca recusa quem já está de plantão no mesmo horário', async () => {
    const { service, prisma } = montar([
      plantao('e1', 'sherad', '2026-09-15'),
      plantao('e2', 'murilo', '2026-09-15', '10:00', '12:00'),
    ]);
    expect(await recusa(service.atualizar('e1', { advogadoId: 'murilo' }, ctx)))
      .toBe('Em 15/09 o Dr. Murilo já está de plantão 10:00–12:00.');
    expect(prisma.escalaAdvogado.update).not.toHaveBeenCalled();
  });

  it('a troca recusa pessoa inativa', async () => {
    const { service } = montar([plantao('e1', 'sherad', '2026-09-15')]);
    expect(await recusa(service.atualizar('e1', { advogadoId: 'antiga' }, ctx)))
      .toContain('está inativo');
  });

  it('mudar o horário não colide com a própria linha, mas colide com o outro turno da pessoa', async () => {
    const { service, linhas, auditoria } = montar([
      plantao('e1', 'sherad', '2026-09-15'),
      plantao('e2', 'sherad', '2026-09-15', '14:00', '17:00'),
    ]);

    await service.atualizar('e1', { horaFim: '11:00' }, ctx);
    expect(linhas[0].horaFim).toBe('11:00');
    expect(auditoria[0].descricao).toBe('Escala de Shérad Lima em 15/09 alterada — fim do plantão: 12:00 → 11:00');
    expect(auditoria[0].metadata.alteracoes).toEqual([
      { campo: 'horaFim', label: 'Fim do plantão', de: '12:00', para: '11:00' },
    ]);

    expect(await recusa(service.atualizar('e1', { horaFim: '15:00' }, ctx)))
      .toBe('Em 15/09 a Dra. Shérad já está de plantão 14:00–17:00.');
  });

  /** Mandar só o início novo não pode passar por cima do fim que já existe. */
  it('confere fim depois do início com o valor que FICA, não só com o enviado', async () => {
    const { service } = montar([plantao('e1', 'sherad', '2026-09-15')]);
    expect(await recusa(service.atualizar('e1', { horaInicio: '13:00' }, ctx)))
      .toBe('Em 15/09, a hora de fim deve ser após a de início.');
  });

  it('salvar sem mudar nada não grava nem audita', async () => {
    const { service, prisma, auditoria } = montar([plantao('e1', 'sherad', '2026-09-15')]);
    await service.atualizar('e1', { horaInicio: '09:00', horaFim: '12:00', observacao: '' }, ctx);
    expect(prisma.escalaAdvogado.update).not.toHaveBeenCalled();
    expect(auditoria).toHaveLength(0);
  });

  it('observação: null apaga, e só a observação não passa pela checagem de horário', async () => {
    const linha = { ...plantao('e1', 'sherad', '2026-09-15'), observacao: 'Troca combinada' };
    const { service, linhas, prisma } = montar([linha]);
    await service.atualizar('e1', { observacao: null }, ctx);
    expect(linhas[0].observacao).toBeNull();
    // Uma leitura só (a da linha): a busca de plantões da pessoa não rodou.
    expect(prisma.escalaAdvogado.findMany).not.toHaveBeenCalled();
  });

  it('escala que não existe dá 404', async () => {
    const { service } = montar();
    await expect(service.atualizar('nada', { horaFim: '11:00' }, ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * O "HOJE" E O "MÊS ATUAL" SÃO OS DE TERESINA.
 *
 * Os dois liam o relógio em UTC: às 23h30 daqui (02:30 UTC do dia seguinte) a
 * triagem via o plantão de amanhã, e no último dia do mês, das 21h em diante,
 * a tela abria no mês seguinte.
 */
describe('fuso do plantão e do mês', () => {
  it('23h30 de 12/09 em Teresina ainda é 12/09', () => {
    const agora = new Date('2026-09-13T02:30:00.000Z');
    const { gte, lt } = diaDoPlantao(undefined, agora);
    expect(gte.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });

  it('00h30 de 13/09 em Teresina já é 13/09', () => {
    const { gte } = diaDoPlantao(undefined, new Date('2026-09-13T03:30:00.000Z'));
    expect(gte.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });

  it('data pedida é o próprio dia; data inválida cai em hoje', () => {
    const agora = new Date('2026-09-13T02:30:00.000Z');
    expect(diaDoPlantao('2026-09-15', agora).gte.toISOString()).toBe('2026-09-15T00:00:00.000Z');
    expect(diaDoPlantao('2026-02-31', agora).gte.toISOString()).toBe('2026-09-12T00:00:00.000Z');
  });

  it('22h de 30/09 em Teresina ainda é setembro', () => {
    const { gte, lt } = rangeMes(undefined, new Date('2026-10-01T01:00:00.000Z'));
    expect(gte.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(lt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('mês pedido vale como pedido, inclusive a virada do ano', () => {
    const { gte, lt } = rangeMes('2026-12');
    expect(gte.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('listarPlantao consulta o dia de Teresina e traz advogadoId e a chave da foto', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-13T02:30:00.000Z'));
    try {
      const { service, prisma } = montar();
      await service.listarPlantao();
      const arg = prisma.escalaAdvogado.findMany.mock.calls[0][0] as any;
      expect(arg.where.data.gte.toISOString()).toBe('2026-09-12T00:00:00.000Z');
      expect(arg.select.advogadoId).toBe(true);
      expect(arg.select.advogado.select).toMatchObject({ avatarUrl: true, avatarKey: true });
    } finally {
      jest.useRealTimers();
    }
  });
});
