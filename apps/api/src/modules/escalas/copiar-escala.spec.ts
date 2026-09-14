import { BadRequestException, ConflictException } from '@nestjs/common';
import { EscalasService } from './escalas.service';
import {
  PlantaoDaCopia, chaveDaCopia, diaDaOcorrencia, ocorrenciaNoMes, pessoaDepoisDeDe, planejarCopia,
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
