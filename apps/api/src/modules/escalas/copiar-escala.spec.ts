import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EscalasService } from './escalas.service';
import {
  PlantaoDaCopia, chaveDaCopia, decidirDesfazerCopia, diaDaOcorrencia, fraseDosDiasSemNinguem, ocorrenciaNoMes,
  pessoaDepoisDeDe, planejarCopia,
} from './escalas.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * COPIAR A ESCALA DE UM MÊS PARA OUTRO (D15 da rodada 3, 14/09/2026).
 *
 * O padrão medido na produção em 13/09/2026: um advogado por dia fixo da
 * semana, sempre 09:00–12:00 (seg Margareth, ter Tiago, qua Morgana, qui
 * Shérad), com uma troca registrada — o Dr. Murilo na quinta 24/09.
 *
 * O calendário que decide os casos: setembro de 2026 começa numa terça e tem
 * 5 terças e 5 quartas; outubro começa numa quinta e tem 5 quintas e 5 sextas.
 */

const P = {
  margareth: { id: 'margareth', nome: 'Margareth Costa', nomeExibicao: 'Dra. Margareth', ativo: true },
  tiago: { id: 'tiago', nome: 'Tiago Rocha', nomeExibicao: 'Dr. Tiago', ativo: true },
  morgana: { id: 'morgana', nome: 'Morgana Reis', nomeExibicao: 'Dra. Morgana', ativo: true },
  sherad: { id: 'sherad', nome: 'Shérad Lima', nomeExibicao: 'Dra. Shérad', ativo: true },
  murilo: { id: 'murilo', nome: 'Murilo Sá', nomeExibicao: 'Dr. Murilo', ativo: true },
};
type Chave = keyof typeof P;

const plantao = (pessoa: Chave, data: string, horaInicio = '09:00', horaFim = '12:00', ativo = true): PlantaoDaCopia => ({
  id: `${pessoa}-${data}`,
  data,
  horaInicio,
  horaFim,
  advogadoId: P[pessoa].id,
  advogado: { ...P[pessoa], ativo },
});

/** Setembro de 2026 como a Coordenação cadastrou. */
const SETEMBRO: PlantaoDaCopia[] = [
  ...['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((d) => plantao('margareth', d)),
  ...['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].map((d) => plantao('tiago', d)),
  ...['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'].map((d) => plantao('morgana', d)),
  ...['2026-09-03', '2026-09-10', '2026-09-17'].map((d) => plantao('sherad', d)),
  plantao('murilo', '2026-09-24'),
];

const resumo = (plano: ReturnType<typeof planejarCopia>) => ({
  criar: plano.criar.map((i) => `${i.data} ${i.advogado.id}${i.marcado ? '' : ' (desmarcado)'}${i.nota ? ` · ${i.nota.texto}` : ''}`),
  fora: plano.fora.map((f) => `${f.origemData} ${f.advogado.id} — ${f.texto}`),
});

describe('o calendário da regra', () => {
  it('a ocorrência do dia no mês', () => {
    expect(ocorrenciaNoMes('2026-09-07')).toBe(1);
    expect(ocorrenciaNoMes('2026-09-14')).toBe(2);
    expect(ocorrenciaNoMes('2026-09-29')).toBe(5);
  });

  it('o dia da N-ésima ocorrência, ou nulo', () => {
    expect(diaDaOcorrencia('2026-10', 1, 1)).toBe('2026-10-05');
    expect(diaDaOcorrencia('2026-10', 1, 2)).toBe('2026-10-12');
    expect(diaDaOcorrencia('2026-10', 4, 5)).toBe('2026-10-29');
    expect(diaDaOcorrencia('2026-10', 5, 5)).toBe('2026-10-30');
    expect(diaDaOcorrencia('2026-10', 2, 5)).toBeNull();
    expect(diaDaOcorrencia('2027-02', 1, 5)).toBeNull();
    expect(diaDaOcorrencia('2026-09', 2, 1)).toBe('2026-09-01');
  });

  it('a preposição contrai com o artigo do tratamento', () => {
    expect(pessoaDepoisDeDe({ nome: 'Dra. Shérad' })).toBe('da Dra. Shérad');
    expect(pessoaDepoisDeDe({ nome: 'x', nomeExibicao: 'Dr. Murilo' })).toBe('do Dr. Murilo');
    expect(pessoaDepoisDeDe({ nome: 'Ana Souza' })).toBe('de Ana Souza');
  });
});

describe('planejarCopia — setembro para outubro de 2026', () => {
  const plano = planejarCopia({
    origem: '2026-09', destino: '2026-10', plantoesDaOrigem: SETEMBRO, plantoesDoDestino: [], hoje: '2026-09-14',
  });

  it('mesmo dia da semana, mesma ocorrência; a 5ª quinta de outubro repete a última de setembro; a troca ganha nota', () => {
    expect(resumo(plano)).toEqual({
      criar: [
        '2026-10-01 sherad',
        '2026-10-05 margareth',
        '2026-10-06 tiago',
        '2026-10-07 morgana',
        '2026-10-08 sherad',
        '2026-10-12 margareth',
        '2026-10-13 tiago',
        '2026-10-14 morgana',
        '2026-10-15 sherad',
        '2026-10-19 margareth',
        '2026-10-20 tiago',
        '2026-10-21 morgana',
        '2026-10-22 murilo · Nas outras quintas de setembro foi a Dra. Shérad',
        '2026-10-26 margareth',
        '2026-10-27 tiago',
        '2026-10-28 morgana',
        '2026-10-29 murilo · Repete a última quinta de setembro (24/09)',
      ],
      fora: [
        '2026-09-29 tiago — outubro não tem 5ª terça',
        '2026-09-30 morgana — outubro não tem 5ª quarta',
      ],
    });
  });

  it('cada item traz a origem e a faixa, e a chave distingue a mesma origem em dois dias', () => {
    const doMurilo = plano.criar.filter((i) => i.origemId === 'murilo-2026-09-24');
    expect(doMurilo.map((i) => [i.data, i.origemData, i.horaInicio, i.horaFim, i.nota?.tipo])).toEqual([
      ['2026-10-22', '2026-09-24', '09:00', '12:00', 'DIFERENTE_DO_RESTO'],
      ['2026-10-29', '2026-09-24', '09:00', '12:00', 'QUINTA_REPETIDA'],
    ]);
    expect(new Set(plano.criar.map(chaveDaCopia)).size).toBe(plano.criar.length);
    expect(plano.criar.every((i) => i.marcado)).toBe(true);
    expect(plano.criar[0].advogado).toEqual({ id: 'sherad', nome: 'Shérad Lima', nomeExibicao: 'Dra. Shérad' });
  });
});

describe('planejarCopia — o que fica de fora e o que vem desmarcado', () => {
  it('copiar para o mês corrente cria só de hoje em diante (hoje entra)', () => {
    const agosto = [
      ...['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].map((d) => plantao('margareth', d)),
      ...['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25'].map((d) => plantao('tiago', d)),
    ];
    const plano = planejarCopia({
      origem: '2026-08', destino: '2026-09', plantoesDaOrigem: agosto, plantoesDoDestino: [], hoje: '2026-09-14',
    });
    expect(resumo(plano)).toEqual({
      criar: [
        '2026-09-14 margareth',
        '2026-09-15 tiago',
        '2026-09-21 margareth',
        '2026-09-22 tiago',
        '2026-09-28 margareth',
        '2026-09-29 tiago · Repete a última terça de agosto (25/08)',
      ],
      fora: [
        '2026-08-03 margareth — 07/09 já passou',
        '2026-08-04 tiago — 01/09 já passou',
        '2026-08-11 tiago — 08/09 já passou',
        '2026-08-31 margareth — setembro não tem 5ª segunda',
      ],
    });
  });

  it('repetir a cópia não duplica: tudo o que já foi criado cai em "já está de plantão"', () => {
    const primeira = planejarCopia({
      origem: '2026-09', destino: '2026-10', plantoesDaOrigem: SETEMBRO, plantoesDoDestino: [], hoje: '2026-09-14',
    });
    const outubroGravado = primeira.criar.map((i) => ({
      ...plantao(i.advogado.id as Chave, i.data, i.horaInicio, i.horaFim),
      id: `gravado-${i.advogado.id}-${i.data}`,
    }));
    const segunda = planejarCopia({
      origem: '2026-09', destino: '2026-10', plantoesDaOrigem: SETEMBRO, plantoesDoDestino: outubroGravado, hoje: '2026-09-14',
    });
    expect(segunda.criar).toEqual([]);
    expect(segunda.fora.filter((f) => f.motivo === 'JA_ESTA_DE_PLANTAO')).toHaveLength(17);
    expect(segunda.fora.find((f) => f.origemId === 'margareth-2026-09-07')?.texto)
      .toBe('já está de plantão em 05/10, 09:00–12:00');
  });

  it('outra pessoa já cobre o dia: vem desmarcado, com quem está lá', () => {
    const plano = planejarCopia({
      origem: '2026-09',
      destino: '2026-10',
      plantoesDaOrigem: SETEMBRO.filter((p) => p.advogadoId === 'tiago'),
      plantoesDoDestino: [plantao('murilo', '2026-10-06', '10:00', '12:00')],
      hoje: '2026-09-14',
    });
    const dia6 = plano.criar.find((i) => i.data === '2026-10-06')!;
    expect(dia6.marcado).toBe(false);
    expect(dia6.nota).toEqual({ tipo: 'DIA_JA_COBERTO', texto: 'O dia já tem o Dr. Murilo das 10:00 às 12:00' });
    // O turno da tarde de outra pessoa não cobre a manhã.
    const tarde = planejarCopia({
      origem: '2026-09',
      destino: '2026-10',
      plantoesDaOrigem: SETEMBRO.filter((p) => p.advogadoId === 'tiago'),
      plantoesDoDestino: [plantao('murilo', '2026-10-06', '14:00', '17:00')],
      hoje: '2026-09-14',
    });
    expect(tarde.criar.find((i) => i.data === '2026-10-06')).toMatchObject({ marcado: true, nota: null });
  });

  it('pessoa desativada fica de fora, dizendo de quem é o cadastro', () => {
    const plano = planejarCopia({
      origem: '2026-09',
      destino: '2026-10',
      plantoesDaOrigem: [plantao('morgana', '2026-09-02', '09:00', '12:00', false)],
      plantoesDoDestino: [],
      hoje: '2026-09-14',
    });
    expect(resumo(plano)).toEqual({ criar: [], fora: ['2026-09-02 morgana — o cadastro da Dra. Morgana está inativo'] });
  });

  it('dois advogados todas as segundas: os dois são regulares e ninguém ganha nota', () => {
    const segundas = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
    const plano = planejarCopia({
      origem: '2026-09',
      destino: '2026-10',
      plantoesDaOrigem: [...segundas.map((d) => plantao('margareth', d)), ...segundas.map((d) => plantao('murilo', d))],
      plantoesDoDestino: [],
      hoje: '2026-09-14',
    });
    expect(plano.criar).toHaveLength(8);
    expect(plano.criar.every((i) => i.nota === null)).toBe(true);
  });

  it('fevereiro de 2027 não tem 5ª ocorrência nenhuma; sábado é "5º"', () => {
    const plano = planejarCopia({
      origem: '2027-01',
      destino: '2027-02',
      plantoesDaOrigem: [plantao('tiago', '2027-01-29'), plantao('murilo', '2027-01-30', '08:00', '11:00')],
      plantoesDoDestino: [],
      hoje: '2026-09-14',
    });
    expect(resumo(plano)).toEqual({
      criar: [],
      fora: [
        '2027-01-29 tiago — fevereiro não tem 5ª sexta',
        '2027-01-30 murilo — fevereiro não tem 5º sábado',
      ],
    });
  });

  it('a 5ª do destino repete a última ocorrência COM plantão (a última quinta pode ter sido feriado)', () => {
    const plano = planejarCopia({
      origem: '2026-09',
      destino: '2026-10',
      plantoesDaOrigem: [plantao('sherad', '2026-09-03'), plantao('sherad', '2026-09-17')],
      plantoesDoDestino: [],
      hoje: '2026-09-14',
    });
    expect(resumo(plano).criar).toEqual([
      '2026-10-01 sherad',
      '2026-10-15 sherad',
      '2026-10-29 sherad · Repete a última quinta de setembro (17/09)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// O serviço: prévia e gravação transacional
// ---------------------------------------------------------------------------

const dia = (t: string) => new Date(`${t}T00:00:00.000Z`);
const AGORA = new Date('2026-09-14T15:00:00.000Z');

function montar(iniciais: PlantaoDaCopia[]) {
  const linhas = iniciais.map((p) => ({
    id: p.id, advogadoId: p.advogadoId, data: dia(p.data), horaInicio: p.horaInicio, horaFim: p.horaFim,
    observacao: null as string | null, pessoa: p.advogado,
  }));
  const auditoria: any[] = [];
  const escalaAdvogado = {
    findMany: jest.fn(async ({ where }: any) =>
      linhas
        .filter((l) => l.data >= where.data.gte && l.data < where.data.lt)
        .sort((a, b) => a.data.getTime() - b.data.getTime() || a.horaInicio.localeCompare(b.horaInicio))
        .map((l) => ({ ...l, advogado: l.pessoa })),
    ),
    groupBy: jest.fn(async () => {
      const porDia = new Map<number, number>();
      for (const l of linhas) porDia.set(l.data.getTime(), (porDia.get(l.data.getTime()) ?? 0) + 1);
      return [...porDia.entries()].map(([t, n]) => ({ data: new Date(t), _count: { _all: n } }));
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) {
        const pessoa = Object.values(P).find((x) => x.id === d.advogadoId)!;
        linhas.push({ ...d, pessoa });
      }
      return { count: data.length };
    }),
  };
  const prisma: any = { escalaAdvogado };
  prisma.$transaction = jest.fn(async (fn: (tx: any) => unknown) => fn(prisma));
  const audit = { registrar: jest.fn(async (r: any) => { auditoria.push(r); }) };
  const service = new EscalasService(prisma, audit as never, {} as never);
  return { service, prisma, linhas, auditoria };
}

const ctx = { userId: 'coord', nome: 'Coordenação', ip: '127.0.0.1', userAgent: 'jest' };

describe('EscalasService.previaDaCopia', () => {
  it('devolve o plano com os textos prontos e os meses com plantões', async () => {
    const agosto = [plantao('margareth', '2026-08-24'), plantao('tiago', '2026-08-25')];
    const { service } = montar([...agosto, ...SETEMBRO, plantao('murilo', '2026-10-06', '10:00', '12:00')]);
    const r = await service.previaDaCopia({ origem: '2026-09', destino: '2026-10' }, AGORA);

    expect(r.origem).toBe('2026-09');
    expect(r.destino).toBe('2026-10');
    expect(r.mesesComPlantao).toEqual([
      { mes: '2026-10', plantoes: 1 },
      { mes: '2026-09', plantoes: 18 },
      { mes: '2026-08', plantoes: 2 },
    ]);
    expect(r.existentesNoDestino).toBe(1);
    expect(r.criar).toHaveLength(17);
    expect(r.criar.filter((i) => !i.marcado).map((i) => i.data)).toEqual(['2026-10-06']);
    expect(r.fora.map((f) => f.motivo)).toEqual(['SEM_OCORRENCIA', 'SEM_OCORRENCIA']);
  });

  it('a origem vazia (recesso) ainda traz os meses, para a tela trocar a origem sozinha', async () => {
    const { service } = montar(SETEMBRO);
    const r = await service.previaDaCopia({ origem: '2026-07', destino: '2026-10' }, AGORA);
    expect(r.criar).toEqual([]);
    expect(r.fora).toEqual([]);
    expect(r.mesesComPlantao).toEqual([{ mes: '2026-09', plantoes: 18 }]);
  });

  it('recusa o mesmo mês e mês que já passou em Teresina', async () => {
    const { service } = montar(SETEMBRO);
    await expect(service.previaDaCopia({ origem: '2026-09', destino: '2026-09' }, AGORA))
      .rejects.toThrow(new BadRequestException('Escolha um mês de origem diferente do destino.'));
    await expect(service.previaDaCopia({ origem: '2026-09', destino: '2026-08' }, AGORA))
      .rejects.toThrow('Não dá para copiar para um mês que já passou.');
    // 22h de 30/09 em Teresina (01:00 UTC de 01/10) ainda é setembro: dá para copiar para setembro.
    await expect(service.previaDaCopia({ origem: '2026-08', destino: '2026-09' }, new Date('2026-10-01T01:00:00.000Z')))
      .resolves.toMatchObject({ destino: '2026-09' });
  });
});

describe('EscalasService.copiar', () => {
  it('grava só os marcados, sem observação, e carimba o que ficou de fora e o que foi desmarcado', async () => {
    const { service, linhas, auditoria, prisma } = montar(SETEMBRO);
    const previa = await service.previaDaCopia({ origem: '2026-09', destino: '2026-10' }, AGORA);
    // A pessoa desmarca o feriado de 12/10 (segunda).
    const itens = previa.criar.filter((i) => i.data !== '2026-10-12').map((i) => ({ origemId: i.origemId, data: i.data }));

    const r = await service.copiar({ origem: '2026-09', destino: '2026-10', itens }, ctx, AGORA);

    expect(r.ok).toBe(true);
    expect(r.criadas).toBe(16);
    expect(r.ids).toHaveLength(16);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ids: string[] = r.ids;
    const criadas = linhas.filter((l) => ids.includes(l.id));
    expect(criadas.map((l) => l.data.toISOString().slice(0, 10))).toContain('2026-10-29');
    expect(criadas.map((l) => l.data.toISOString().slice(0, 10))).not.toContain('2026-10-12');
    expect(criadas.every((l) => l.observacao === null && l.horaInicio === '09:00')).toBe(true);
    expect(criadas.find((l) => l.data.toISOString().startsWith('2026-10-29'))?.advogadoId).toBe('murilo');

    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      acao: 'CREATE',
      entidade: 'EscalaAdvogado',
      entidadeId: '2026-10',
      userId: 'coord',
      descricao: 'Escala de setembro copiada para outubro: 16 plantões (3 ficaram de fora)',
    });
    expect(auditoria[0].metadata).toMatchObject({
      origem: '2026-09',
      destino: '2026-10',
      quantidade: 16,
      ids: r.ids,
      fora: [
        { origemId: 'tiago-2026-09-29', origemData: '2026-09-29', motivo: 'SEM_OCORRENCIA' },
        { origemId: 'morgana-2026-09-30', origemData: '2026-09-30', motivo: 'SEM_OCORRENCIA' },
      ],
      desmarcados: [{ origemId: 'margareth-2026-09-14', data: '2026-10-12' }],
    });
  });

  it('repetir o mesmo POST dá 409 e não duplica nada', async () => {
    const { service, linhas, prisma } = montar(SETEMBRO);
    const previa = await service.previaDaCopia({ origem: '2026-09', destino: '2026-10' }, AGORA);
    const itens = previa.criar.map((i) => ({ origemId: i.origemId, data: i.data }));
    await service.copiar({ origem: '2026-09', destino: '2026-10', itens }, ctx, AGORA);
    const depoisDaPrimeira = linhas.length;

    await expect(service.copiar({ origem: '2026-09', destino: '2026-10', itens }, ctx, AGORA))
      .rejects.toThrow(new ConflictException('A escala de outubro mudou enquanto você conferia.'));
    expect(linhas).toHaveLength(depoisDaPrimeira);
    expect(prisma.escalaAdvogado.createMany).toHaveBeenCalledTimes(1);
  });

  it('alguém cadastrou à mão entre a prévia e o salvar: 409 e NADA é gravado, nem o resto', async () => {
    const { service, linhas, prisma } = montar(SETEMBRO);
    const previa = await service.previaDaCopia({ origem: '2026-09', destino: '2026-10' }, AGORA);
    linhas.push({
      id: 'na-mao', advogadoId: 'tiago', data: dia('2026-10-13'), horaInicio: '09:00', horaFim: '12:00',
      observacao: null, pessoa: P.tiago,
    });
    const itens = previa.criar.map((i) => ({ origemId: i.origemId, data: i.data }));
    await expect(service.copiar({ origem: '2026-09', destino: '2026-10', itens }, ctx, AGORA))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.escalaAdvogado.createMany).not.toHaveBeenCalled();
  });

  it('item repetido no pedido e dia que não existe: 400 antes de abrir a transação', async () => {
    const { service, prisma } = montar(SETEMBRO);
    const item = { origemId: 'margareth-2026-09-07', data: '2026-10-05' };
    await expect(service.copiar({ origem: '2026-09', destino: '2026-10', itens: [item, item] }, ctx, AGORA))
      .rejects.toThrow('O pedido repete o mesmo plantão em 05/10.');
    await expect(service.copiar({ origem: '2026-09', destino: '2026-10', itens: [{ ...item, data: '2026-10-32' }] }, ctx, AGORA))
      .rejects.toThrow('A data 2026-10-32 não existe no calendário.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Rodada 4 (15/09/2026): a 5ª ocorrência, os buracos, o destino livre e o desfazer
// ---------------------------------------------------------------------------

describe('planejarCopia — a 5ª ocorrência pergunta se houve plantão nela', () => {
  /*
    Setembro de 2026 TEM a 5ª terça (29/09). A regra antiga via a data e pulava a
    repetição, mesmo com a terça 29 vazia: dezembro (5 terças) ficava sem ninguém
    em 29/12, sem nota.
  */
  it('terça 29/09 vazia: a 5ª terça de dezembro repete a última terça com plantão', () => {
    const tercas = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map((d) => plantao('tiago', d));
    const plano = planejarCopia({
      origem: '2026-09', destino: '2026-12', plantoesDaOrigem: tercas, plantoesDoDestino: [], hoje: '2026-09-14',
    });
    expect(resumo(plano).criar).toEqual([
      '2026-12-01 tiago',
      '2026-12-08 tiago',
      '2026-12-15 tiago',
      '2026-12-22 tiago',
      '2026-12-29 tiago · Repete a última terça de setembro (22/09)',
    ]);
    expect(plano.diasSemNinguem).toEqual([]);
  });

  it('com plantão na terça 29/09, a 5ª de dezembro vem pela regra ordinal, uma vez só e sem nota', () => {
    const tercas = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].map((d) => plantao('tiago', d));
    const plano = planejarCopia({
      origem: '2026-09', destino: '2026-12', plantoesDaOrigem: tercas, plantoesDoDestino: [], hoje: '2026-09-14',
    });
    expect(resumo(plano).criar).toEqual([
      '2026-12-01 tiago', '2026-12-08 tiago', '2026-12-15 tiago', '2026-12-22 tiago', '2026-12-29 tiago',
    ]);
  });
});

describe('planejarCopia — os dias úteis que ficam sem ninguém', () => {
  /** Setembro cadastrado só a partir de 14/09: segundas da Dra. Margareth e terças do Dr. Tiago. */
  const PARCIAL = [
    ...['2026-09-14', '2026-09-21', '2026-09-28'].map((d) => plantao('margareth', d)),
    ...['2026-09-15', '2026-09-22', '2026-09-29'].map((d) => plantao('tiago', d)),
  ];

  it('a 1ª segunda e as duas primeiras terças de outubro ficam vazias, e a frase diz quais', () => {
    const plano = planejarCopia({
      origem: '2026-09', destino: '2026-10', plantoesDaOrigem: PARCIAL, plantoesDoDestino: [], hoje: '2026-09-14',
    });
    expect(resumo(plano).criar).toEqual([
      '2026-10-12 margareth',
      '2026-10-19 margareth',
      '2026-10-20 tiago',
      '2026-10-26 margareth',
      '2026-10-27 tiago',
    ]);
    // Quarta, quinta e sexta não são do padrão desta origem: não viram aviso.
    expect(plano.diasSemNinguem).toEqual(['2026-10-05', '2026-10-06', '2026-10-13']);
    expect(fraseDosDiasSemNinguem('2026-10', plano.diasSemNinguem))
      .toBe('Dias de semana de outubro sem ninguém: 05/10, 06/10, 13/10.');
    expect(fraseDosDiasSemNinguem('2026-10', [])).toBeNull();
  });

  it('o que já está no destino cobre o dia, mesmo de outra pessoa e mesmo desmarcado', () => {
    const plano = planejarCopia({
      origem: '2026-09',
      destino: '2026-10',
      plantoesDaOrigem: PARCIAL,
      plantoesDoDestino: [plantao('murilo', '2026-10-05'), plantao('murilo', '2026-10-20', '10:00', '12:00')],
      hoje: '2026-09-14',
    });
    expect(plano.criar.find((i) => i.data === '2026-10-20')?.marcado).toBe(false);
    expect(plano.diasSemNinguem).toEqual(['2026-10-06', '2026-10-13']);
  });

  it('copiando para o mês corrente, os dias que já passaram não entram; o de fora traz o dia do destino', () => {
    const agosto = [
      ...['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'].map((d) => plantao('margareth', d)),
      ...['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25'].map((d) => plantao('tiago', d)),
    ];
    const plano = planejarCopia({
      origem: '2026-08', destino: '2026-09', plantoesDaOrigem: agosto, plantoesDoDestino: [], hoje: '2026-09-14',
    });
    expect(plano.diasSemNinguem).toEqual([]);
    expect(plano.fora.map((f) => [f.origemData, f.data, f.motivo])).toEqual([
      ['2026-08-03', '2026-09-07', 'DIA_PASSOU'],
      ['2026-08-04', '2026-09-01', 'DIA_PASSOU'],
      ['2026-08-11', '2026-09-08', 'DIA_PASSOU'],
      ['2026-08-31', null, 'SEM_OCORRENCIA'],
    ]);
  });

  it('a prévia do serviço entrega a lista e a frase prontas', async () => {
    const { service } = montar(PARCIAL);
    const r = await service.previaDaCopia({ origem: '2026-09', destino: '2026-10' }, AGORA);
    expect(r.diasSemNinguem).toEqual(['2026-10-05', '2026-10-06', '2026-10-13']);
    expect(r.fraseDiasSemNinguem).toBe('Dias de semana de outubro sem ninguém: 05/10, 06/10, 13/10.');
  });
});

describe('EscalasService — o destino é escolhível (V1) e o botão sabe os meses', () => {
  it('pula um mês e copia para trás: as únicas travas são o mesmo mês e o mês que já passou', async () => {
    const { service } = montar([...SETEMBRO, plantao('margareth', '2026-10-05')]);
    const novembro = await service.previaDaCopia({ origem: '2026-09', destino: '2026-11' }, AGORA);
    expect(novembro.destino).toBe('2026-11');
    expect(novembro.criar.length).toBeGreaterThan(0);

    const paraTras = await service.previaDaCopia({ origem: '2026-10', destino: '2026-09' }, AGORA);
    expect(paraTras.criar).toEqual([]);
    expect(paraTras.fora).toMatchObject([{ origemData: '2026-10-05', data: '2026-09-07', motivo: 'DIA_PASSOU' }]);
  });

  it('GET /escalas/meses: o mês de Teresina e os meses com plantões, sem pedir origem nem destino', async () => {
    const { service } = montar(SETEMBRO);
    await expect(service.mesesDaCopia(AGORA)).resolves.toEqual({
      mesAtual: '2026-09',
      mesesComPlantao: [{ mes: '2026-09', plantoes: 18 }],
    });
    // 22h de 30/09 em Teresina ainda é setembro.
    expect((await service.mesesDaCopia(new Date('2026-10-01T01:00:00.000Z'))).mesAtual).toBe('2026-09');
  });
});

/**
 * O DESFAZER DA CÓPIA — a exceção estreita à regra "só o Administrador apaga".
 *
 * O banco falso do `montar` ganha a auditoria (onde o lote mora), a exclusão
 * condicional e as consultas criadas depois da cópia.
 */
function montarDesfazer(consultas: Record<string, any>[] = []) {
  const m = montar(SETEMBRO);
  const { prisma, linhas, auditoria } = m;
  const lerPorData = prisma.escalaAdvogado.findMany.getMockImplementation();
  prisma.escalaAdvogado.findMany = jest.fn(async (args: any) =>
    args.where.id?.in
      ? linhas
        .filter((l) => args.where.id.in.includes(l.id))
        .map((l) => ({
          id: l.id, advogadoId: l.advogadoId, data: l.data, horaInicio: l.horaInicio, horaFim: l.horaFim,
          observacao: l.observacao,
        }))
      : lerPorData(args));
  prisma.escalaAdvogado.deleteMany = jest.fn(async ({ where }: any) => {
    const casa = (l: (typeof linhas)[number]) =>
      where.OR.some((c: any) =>
        c.id === l.id && c.advogadoId === l.advogadoId && c.horaInicio === l.horaInicio &&
        c.horaFim === l.horaFim && c.observacao === null && l.observacao === null);
    const antes = linhas.length;
    for (let i = linhas.length - 1; i >= 0; i--) if (casa(linhas[i])) linhas.splice(i, 1);
    return { count: antes - linhas.length };
  });
  prisma.auditoria = {
    findFirst: jest.fn(async ({ where }: any) => {
      const r = [...auditoria].reverse().find((a) =>
        a.acao === where.acao && a.entidade === where.entidade && a.metadata?.[where.metadata.path[0]] === where.metadata.equals);
      return r ? { userId: r.userId, createdAt: r.createdAt ?? AGORA, metadata: r.metadata } : null;
    }),
    findMany: jest.fn(async ({ where }: any) =>
      auditoria
        .filter((a) => a.acao === where.acao && a.entidade === where.entidade && where.entidadeId.in.includes(a.entidadeId))
        .map((a) => ({ entidadeId: a.entidadeId }))),
  };
  prisma.user = {
    findMany: jest.fn(async ({ where }: any) => Object.values(P).filter((p) => where.id.in.includes(p.id))),
  };
  /*
    O `where` lido como o banco lê, no pedaço que o desfazer usa (15/09/2026):
    datas com gte/lt, `in`, a equipe com `some`, e o AND/OR aninhados. Assim a
    consulta remarcada (criada antes, mexida depois) é pega pelo que a regra
    filtra, e não por um atalho do teste. Tipo e status não estão nas fixtures.
  */
  const casa = (c: Record<string, any>, where: Record<string, any>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'AND') return (v as any[]).every((w) => casa(c, w));
      if (k === 'OR') return (v as any[]).some((w) => casa(c, w));
      if (k === 'equipe') return (c.equipe ?? []).some((e: any) => v.some.usuarioId.in.includes(e.usuarioId));
      if (!(k in c)) return !['createdAt', 'updatedAt', 'responsavelId', 'inicio'].includes(k);
      if (v && typeof v === 'object' && 'in' in v) return v.in.includes(c[k]);
      if (v && typeof v === 'object' && ('gte' in v || 'lt' in v)) {
        return (v.gte === undefined || c[k] >= v.gte) && (v.lt === undefined || c[k] < v.lt);
      }
      return c[k] === v;
    });
  prisma.compromisso = {
    findMany: jest.fn(async ({ where }: any) => consultas.filter((c) => casa(c, where))),
  };
  return m;
}

const minutosDepois = (min: number) => new Date(AGORA.getTime() + min * 60_000);

async function copiarSetembroParaOutubro(consultas: Record<string, any>[] = []) {
  const m = montarDesfazer(consultas);
  const previa = await m.service.previaDaCopia({ origem: '2026-09', destino: '2026-10' }, AGORA);
  const itens = previa.criar.map((i) => ({ origemId: i.origemId, data: i.data }));
  const copia = await m.service.copiar({ origem: '2026-09', destino: '2026-10', itens }, ctx, AGORA);
  const deOutubro = () => m.linhas.filter((l) => l.data.toISOString().startsWith('2026-10'));
  const idDe = (data: string) => m.linhas.find((l) => l.data.toISOString().startsWith(data))!.id;
  return { ...m, copia, deOutubro, idDe };
}

describe('POST /escalas/copia devolve o lote para o desfazer', () => {
  it('loteId, até quando dá para desfazer, e a foto do que foi criado na auditoria', async () => {
    const { copia, auditoria } = await copiarSetembroParaOutubro();
    expect(copia.criadas).toBe(17);
    expect(copia.loteId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(copia.desfazerAte).toBe('2026-09-14T15:10:00.000Z');
    const meta = auditoria[0].metadata;
    expect(meta).toMatchObject({ loteId: copia.loteId, copiadaEm: '2026-09-14T15:00:00.000Z', ids: copia.ids });
    expect(meta.plantoes).toHaveLength(17);
    expect(meta.plantoes[0]).toEqual({
      id: copia.ids[0], advogadoId: 'sherad', data: '2026-10-01', horaInicio: '09:00', horaFim: '12:00',
    });
  });
});

describe('DELETE /escalas/copia/:loteId — desfazer', () => {
  it('quem copiou, cinco minutos depois: apaga os 17 de outubro, deixa setembro e registra', async () => {
    const { service, copia, deOutubro, linhas, auditoria } = await copiarSetembroParaOutubro();
    await expect(service.desfazerCopia(copia.loteId, ctx, minutosDepois(5)))
      .resolves.toEqual({ ok: true, apagados: 17, jaApagados: 0 });
    expect(deOutubro()).toHaveLength(0);
    expect(linhas).toHaveLength(18);
    expect(auditoria.at(-1)).toMatchObject({
      acao: 'DELETE',
      entidade: 'EscalaAdvogado',
      entidadeId: '2026-10',
      userId: 'coord',
      descricao: 'Cópia da escala de setembro para outubro desfeita: 17 plantões apagados',
      metadata: { loteId: copia.loteId, jaApagados: 0 },
    });
  });

  it('outra pessoa não desfaz, e depois de 10 minutos nem quem copiou', async () => {
    const { service, copia, deOutubro } = await copiarSetembroParaOutubro();
    const outra = await service.desfazerCopia(copia.loteId, { ...ctx, userId: 'tiago' }, minutosDepois(1)).catch((e) => e);
    expect(outra).toBeInstanceOf(ForbiddenException);
    expect(outra.message).toBe('Só quem copiou a escala pode desfazer a cópia. Para tirar os plantões, peça ao Administrador.');

    const tarde = await service.desfazerCopia(copia.loteId, ctx, new Date(minutosDepois(10).getTime() + 1_000)).catch((e) => e);
    expect(tarde).toBeInstanceOf(BadRequestException);
    expect(tarde.message).toBe('O tempo para desfazer a cópia acabou (10 minutos). Para tirar os plantões, peça ao Administrador.');
    expect(deOutubro()).toHaveLength(17);
  });

  it('plantão alterado depois (no banco ou só na auditoria): recusa dizendo quais, e nada sai', async () => {
    const { service, copia, deOutubro, linhas, auditoria, idDe } = await copiarSetembroParaOutubro();
    linhas.find((l) => l.id === idDe('2026-10-13'))!.horaInicio = '10:00';
    // A troca de pessoa e a volta, com o mesmo valor no fim: só a auditoria lembra.
    auditoria.push({ acao: 'UPDATE', entidade: 'EscalaAdvogado', entidadeId: idDe('2026-10-20'), metadata: {} });

    const erro = await service.desfazerCopia(copia.loteId, ctx, minutosDepois(4)).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe(
      'Não dá para desfazer: os plantões de 13/10 (Dr. Tiago) e 20/10 (Dr. Tiago) foram alterados depois da cópia. ' +
        'Para tirar os plantões, peça ao Administrador.',
    );
    expect(deOutubro()).toHaveLength(17);
  });

  it('consulta marcada com a pessoa no dia DEPOIS da cópia bloqueia; a de antes, ou de outro dia, não', async () => {
    const consulta = (id: string, criadaEm: Date, inicio: string, responsavelId: string) => ({
      id, createdAt: criadaEm, inicio: new Date(inicio), responsavelId, equipe: [],
    });
    const semBloqueio = await copiarSetembroParaOutubro([
      consulta('k-antiga', new Date('2026-09-10T12:00:00.000Z'), '2026-10-05T12:00:00.000Z', 'margareth'),
      consulta('k-dia-sem-plantao', minutosDepois(2), '2026-10-23T12:00:00.000Z', 'murilo'),
    ]);
    await expect(semBloqueio.service.desfazerCopia(semBloqueio.copia.loteId, ctx, minutosDepois(5)))
      .resolves.toMatchObject({ apagados: 17 });

    const comConsulta = await copiarSetembroParaOutubro([
      consulta('k-nova', minutosDepois(3), '2026-10-22T12:00:00.000Z', 'murilo'),
    ]);
    const erro = await comConsulta.service.desfazerCopia(comConsulta.copia.loteId, ctx, minutosDepois(5)).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe(
      'Não dá para desfazer: já há consulta marcada no plantão de 22/10 (Dr. Murilo). Para tirar os plantões, peça ao Administrador.',
    );
    expect(comConsulta.deOutubro()).toHaveLength(17);
  });

  /*
    A CONSULTA ANTIGA REMARCADA PARA O PLANTÃO NOVO (15/09/2026). Criada em
    01/09, remarcada às 10:04 para 22/10 com o Dr. Murilo: o remarcar é um
    update na mesma linha, o createdAt continua 01/09. O desfazer só olhava o
    createdAt e apagava o plantão.
  */
  it('consulta criada antes da cópia, mas remarcada ou passada para a pessoa depois dela, também bloqueia', async () => {
    const antiga = new Date('2026-09-01T12:00:00.000Z');
    const remarcada = await copiarSetembroParaOutubro([
      { id: 'k-remarcada', createdAt: antiga, updatedAt: minutosDepois(4), inicio: new Date('2026-10-22T12:30:00.000Z'), responsavelId: 'murilo', equipe: [] },
    ]);
    const erro = await remarcada.service.desfazerCopia(remarcada.copia.loteId, ctx, minutosDepois(6)).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe(
      'Não dá para desfazer: já há consulta marcada no plantão de 22/10 (Dr. Murilo). Para tirar os plantões, peça ao Administrador.',
    );
    expect(remarcada.deOutubro()).toHaveLength(17);

    // Passada para o Dr. Murilo pela equipe depois da cópia: a mesma trava pelo outro lado do OR.
    const naEquipe = await copiarSetembroParaOutubro([
      {
        id: 'k-equipe', createdAt: antiga, updatedAt: minutosDepois(2), inicio: new Date('2026-10-22T12:30:00.000Z'),
        responsavelId: 'margareth', equipe: [{ usuarioId: 'murilo', principal: false, origem: null }],
      },
    ]);
    await expect(naEquipe.service.desfazerCopia(naEquipe.copia.loteId, ctx, minutosDepois(6))).rejects.toBeInstanceOf(ConflictException);

    // A antiga que ninguém mexeu depois da cópia não trava.
    const parada = await copiarSetembroParaOutubro([
      { id: 'k-parada', createdAt: antiga, updatedAt: antiga, inicio: new Date('2026-10-22T12:30:00.000Z'), responsavelId: 'murilo', equipe: [] },
    ]);
    await expect(parada.service.desfazerCopia(parada.copia.loteId, ctx, minutosDepois(6))).resolves.toMatchObject({ apagados: 17 });
  });

  it('o Administrador já apagou um: desfaz o resto; a segunda vez diz que já foi desfeita', async () => {
    const { service, copia, linhas, idDe } = await copiarSetembroParaOutubro();
    linhas.splice(linhas.findIndex((l) => l.id === idDe('2026-10-07')), 1);
    await expect(service.desfazerCopia(copia.loteId, ctx, minutosDepois(2)))
      .resolves.toEqual({ ok: true, apagados: 16, jaApagados: 1 });
    await expect(service.desfazerCopia(copia.loteId, ctx, minutosDepois(3)))
      .rejects.toThrow(new ConflictException('Esta cópia já foi desfeita.'));
  });

  it('alguém trocou um plantão entre a leitura e a exclusão: 409 e nenhuma linha de auditoria', async () => {
    const { service, copia, prisma, auditoria } = await copiarSetembroParaOutubro();
    prisma.escalaAdvogado.deleteMany.mockResolvedValueOnce({ count: 16 });
    await expect(service.desfazerCopia(copia.loteId, ctx, minutosDepois(2)))
      .rejects.toThrow('A escala mudou enquanto você desfazia a cópia. Atualize a página e confira.');
    expect(auditoria.filter((a) => a.acao === 'DELETE')).toHaveLength(0);
  });

  it('lote desconhecido ou lixo na URL: 404', async () => {
    const { service } = await copiarSetembroParaOutubro();
    await expect(service.desfazerCopia('nao-e-um-lote', ctx, minutosDepois(1))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.desfazerCopia('3f2a9b1c-0000-4000-8000-000000000000', ctx, minutosDepois(1)))
      .rejects.toThrow('Não achei esta cópia. Atualize a página e confira a escala.');
  });

  it('a frase lista até três plantões e conta o resto', () => {
    const pl = (id: string, advogadoId: string, data: string) => ({ id, advogadoId, data, horaInicio: '09:00', horaFim: '12:00' });
    const plantoes = [
      pl('a', 'sherad', '2026-10-01'), pl('b', 'margareth', '2026-10-05'), pl('c', 'tiago', '2026-10-06'), pl('d', 'morgana', '2026-10-07'),
    ];
    const decisao = decidirDesfazerCopia({
      copia: { userId: 'coord', copiadaEm: AGORA.toISOString(), plantoes },
      usuarioId: 'coord',
      agora: minutosDepois(1),
      atuais: plantoes.map((p) => ({ ...p, observacao: 'Troca combinada' })),
      alteradosNaAuditoria: [],
      comConsultaNova: [],
      nomes: new Map([['sherad', 'Dra. Shérad'], ['margareth', 'Dra. Margareth'], ['tiago', 'Dr. Tiago']]),
    });
    expect(decisao).toEqual({
      ok: false,
      recusa: 'ALTERADO',
      motivo:
        'Não dá para desfazer: os plantões de 01/10 (Dra. Shérad), 05/10 (Dra. Margareth), 06/10 (Dr. Tiago) e mais 1 ' +
        'foram alterados depois da cópia. Para tirar os plantões, peça ao Administrador.',
    });
  });
});
