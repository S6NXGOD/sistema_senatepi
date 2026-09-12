import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chaveOab,
  mesclarAdvogadosDaParte,
  oabUtilizavel,
  separarAdvogadosDoAto,
  type AdvogadoCitado,
} from './utils/advogados-do-ato.util';
import { VinculoDeAdvogadoService } from './vinculo-de-advogado.service';

/**
 * OS ADVOGADOS DO ATO — com os dados que o CNJ realmente manda.
 *
 * A publicação usada aqui é real (processo 0001340-33.2023.5.22.0002, lida na
 * origem em 11/09/2026): nove advogados num array só, três nossos e seis de
 * fora, e NENHUM campo dizendo de quem cada um é. É esse o fato que manda no
 * desenho inteiro.
 */

/** Nossos oito advogados, como estão no cadastro da produção. */
const NOSSOS = new Map<string, string>([
  ['PI-3778', 'u-carlos'],
  ['PI-17660', 'u-icaro'],
  ['PI-9226', 'u-murilo'],
  ['PI-11301', 'u-sherad'],
  ['PI-20092', 'u-tiago'],
]);

const ato = (...advs: Array<[string, string, string]>): AdvogadoCitado[] =>
  advs.map(([nome, numeroOab, ufOab]) => ({ nome, numeroOab, ufOab }));

/** A publicação real, na ordem em que o CNJ devolveu. */
const PUBLICACAO_REAL = ato(
  ['CAROLINE VASCONCELOS DE OLIVEIRA LOPES DA SILVA', '11632', 'PI'],
  ['CLARICE CASTELO BRANCO LEITE', '11946', 'PI'],
  ['THIAGO FRANCISCO DE OLIVEIRA MOURA', '13531', 'PI'],
  ['LETICIA ALMENDRA FREITAS MENDES DE CARVALHO', '3775', 'PI'],
  ['TIAGO ALMEIDA DE OLIVEIRA VELOSO', '20092', 'PI'],
  ['FRANCISCO SOARES CAMPELO FILHO', '2734', 'PI'],
  ['CARLOS HENRIQUE DE ALENCAR VIEIRA', '3778', 'PI'],
  ['ANDRESSA TAIULA RODRIGUES MENEZES NOLETO', '18238', 'PI'],
  ['ICARO SOL ALMONDES SANTOS', '17660', 'PI'],
);

describe('quem é nosso e quem é de fora, num ato do Diário', () => {
  it('separa pela OAB, nunca pelo nome', () => {
    const { nossos, outros } = separarAdvogadosDoAto(PUBLICACAO_REAL, NOSSOS);
    expect(nossos.sort()).toEqual(['u-carlos', 'u-icaro', 'u-tiago']);
    expect(outros).toHaveLength(6);
    expect(outros.map((o) => o.numeroOab)).toContain('11632');
  });

  /**
   * O tribunal escreve "ICARO SOL ALMONDES SANTOS" e o cadastro tem "Ícaro Sol
   * Almondes Santos". Casar por nome erraria os dois lados.
   */
  it('acento e caixa do nome não interferem', () => {
    const { nossos } = separarAdvogadosDoAto(
      ato(['icaro sol almondes santos', '17660', 'pi']),
      NOSSOS,
    );
    expect(nossos).toEqual(['u-icaro']);
  });

  it('o mesmo advogado em vinte publicações entra uma vez só', () => {
    const repetido = [...PUBLICACAO_REAL, ...PUBLICACAO_REAL, ...PUBLICACAO_REAL];
    const { nossos, outros } = separarAdvogadosDoAto(repetido, NOSSOS);
    expect(nossos).toHaveLength(3);
    expect(outros).toHaveLength(6);
  });

  /** Sem número de OAB não dá para casar nem para reconhecer depois. */
  it('advogado sem OAB utilizável não entra', () => {
    const { outros } = separarAdvogadosDoAto(
      ato(['FULANO SEM OAB', '', 'PI'], ['SICRANO SEM UF', '12345', ''], ['OK', '4321', 'MA']),
      NOSSOS,
    );
    expect(outros.map((o) => o.nome)).toEqual(['OK']);
    expect(oabUtilizavel('', 'PI')).toBe(false);
    expect(oabUtilizavel('4321', 'MA')).toBe(true);
    expect(chaveOab(' 4.321 ', 'ma')).toBe('MA-4321');
  });

  it('lista vazia ou lixo não quebram nada', () => {
    expect(separarAdvogadosDoAto(null, NOSSOS)).toEqual({ nossos: [], outros: [] });
    expect(separarAdvogadosDoAto('texto', NOSSOS)).toEqual({ nossos: [], outros: [] });
  });
});

describe('juntar os advogados de fora na parte contrária', () => {
  const AGORA = '2026-09-11T12:00:00.000Z';
  const novos = ato(['CAROLINE VASCONCELOS', '11632', 'PI'], ['CLARICE CASTELO', '11946', 'PI']);

  it('grava os que faltam, com a origem à mostra', () => {
    const lista = mesclarAdvogadosDaParte(null, novos, AGORA);
    expect(lista).toHaveLength(2);
    expect(lista![0]).toMatchObject({ numeroOab: '11632', origem: 'DJEN', vistoEm: AGORA });
  });

  /**
   * O QUE UMA PESSOA ESCREVEU FICA. Ela pode ter corrigido o nome, o número, ou
   * anotado o advogado certo depois de ler os autos — a varredura de amanhã não
   * desfaz isso.
   */
  it('não reescreve entrada manual, nem o nome', () => {
    const manual = [
      { nome: 'Caroline Vasconcelos de O. L. da Silva', numeroOab: '11632', ufOab: 'PI', origem: 'MANUAL' },
    ];
    const lista = mesclarAdvogadosDaParte(manual, novos, AGORA);
    expect(lista).toHaveLength(2);
    const caroline = lista!.find((a) => a.numeroOab === '11632')!;
    expect(caroline.nome).toBe('Caroline Vasconcelos de O. L. da Silva');
    expect(caroline.origem).toBe('MANUAL');
  });

  it('sem novidade, não manda gravar (nada de auditoria vazia)', () => {
    const jaEsta = [{ nome: 'CAROLINE VASCONCELOS', numeroOab: '11632', ufOab: 'PI', origem: 'DJEN', vistoEm: AGORA }];
    expect(mesclarAdvogadosDaParte(jaEsta, [novos[0]], AGORA)).toBeNull();
  });

  /** Quem saiu do caso continua na lista: é história de quem atuou. */
  it('nunca remove ninguém', () => {
    const antigo = [{ nome: 'ADVOGADO ANTIGO', numeroOab: '999', ufOab: 'PI', origem: 'DJEN', vistoEm: '2026-01-01T00:00:00.000Z' }];
    const lista = mesclarAdvogadosDaParte(antigo, novos, AGORA);
    expect(lista!.map((a) => a.numeroOab)).toContain('999');
    expect(lista).toHaveLength(3);
  });
});

// ------------------------------------------------------------------ o serviço

describe('o que a varredura grava no processo', () => {
  const publicacoes = [{ advogados: PUBLICACAO_REAL }];

  /** Um Prisma de mentira que devolve o processo pedido e anota o que foi escrito. */
  function fingirPrisma(processo: Record<string, unknown>) {
    const escrito = { equipe: [] as unknown[], parte: null as unknown };
    return {
      escrito,
      prisma: {
        user: { findMany: jest.fn(async () => []) },
        processo: { findUnique: jest.fn(async () => processo) },
        comunicacaoDjen: { findMany: jest.fn(async () => publicacoes) },
        processoAdvogado: {
          createMany: jest.fn(async (a: { data: unknown[] }) => {
            escrito.equipe = a.data;
            return { count: a.data.length };
          }),
        },
        parteProcesso: {
          update: jest.fn(async (a: { data: { advogados: unknown } }) => {
            escrito.parte = a.data.advogados;
            return {};
          }),
        },
      },
    };
  }

  const parte = (over: Record<string, unknown>) => ({
    id: 'p1',
    polo: 'ATIVO',
    nome: 'FULANO',
    advogados: null,
    filiadoId: null,
    parteExterna: null,
    ...over,
  });

  it('põe os nossos na equipe e os de fora na parte contrária', async () => {
    const { prisma, escrito } = fingirPrisma({
      id: 'proc-1',
      advogados: [{ advogadoId: 'u-icaro' }],
      advogadosDispensados: [],
      partes: [
        parte({ id: 'autor', polo: 'ATIVO', filiadoId: 'f1' }),
        parte({ id: 'reu', polo: 'PASSIVO', nome: 'CLINICA SANTA FE LTDA' }),
      ],
    });
    const svc = new VinculoDeAdvogadoService(prisma as never);
    const r = await svc.aplicarNoProcesso('proc-1', NOSSOS);

    // Ícaro já estava; entram Carlos e Tiago, e nunca como responsável.
    expect(r.equipe).toBe(2);
    // A ordem é a do ato; o que importa é QUEM entrou e COMO.
    expect(escrito.equipe).toHaveLength(2);
    expect((escrito.equipe as { advogadoId: string }[]).map((e) => e.advogadoId).sort()).toEqual([
      'u-carlos',
      'u-tiago',
    ]);
    for (const linha of escrito.equipe as Record<string, unknown>[]) {
      expect(linha).toMatchObject({ processoId: 'proc-1', principal: false, origem: 'DJEN' });
    }
    expect(r.naParte).toBe(6);
    expect(prisma.parteProcesso.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'reu' } }),
    );
  });

  /** A lápide é decisão de gente: o robô não recoloca quem foi tirado à mão. */
  it('não recoloca quem foi dispensado da equipe', async () => {
    const { prisma, escrito } = fingirPrisma({
      id: 'proc-1',
      advogados: [],
      advogadosDispensados: [{ advogadoId: 'u-carlos' }, { advogadoId: 'u-tiago' }],
      partes: [parte({ filiadoId: 'f1' }), parte({ id: 'reu', polo: 'PASSIVO' })],
    });
    const svc = new VinculoDeAdvogadoService(prisma as never);
    const r = await svc.aplicarNoProcesso('proc-1', NOSSOS);
    expect(r.equipe).toBe(1);
    expect(escrito.equipe).toEqual([
      { processoId: 'proc-1', advogadoId: 'u-icaro', principal: false, origem: 'DJEN' },
    ]);
  });

  /**
   * DUAS PARTES DO OUTRO LADO = SEM DONO. O CNJ não diz de quem é cada
   * advogado; escolher uma das duas seria inventar. Fica contado como "sem
   * lado" para a tela pedir a conferência.
   */
  it('com dois réus, não atribui advogado a nenhum', async () => {
    const { prisma } = fingirPrisma({
      id: 'proc-1',
      advogados: [],
      advogadosDispensados: [],
      partes: [
        parte({ filiadoId: 'f1' }),
        parte({ id: 'reu1', polo: 'PASSIVO', nome: 'HAPVIDA' }),
        parte({ id: 'reu2', polo: 'PASSIVO', nome: 'HOSPITAL RIO POTY' }),
      ],
    });
    const svc = new VinculoDeAdvogadoService(prisma as never);
    const r = await svc.aplicarNoProcesso('proc-1', NOSSOS);
    expect(r.naParte).toBe(0);
    expect(r.semLado).toBe(6);
    expect(prisma.parteProcesso.update).not.toHaveBeenCalled();
  });

  /** Sem saber qual é o nosso lado (nenhum filiado, nada institucional), não grava. */
  it('sem reconhecer o nosso lado, não atribui nada', async () => {
    const { prisma } = fingirPrisma({
      id: 'proc-1',
      advogados: [],
      advogadosDispensados: [],
      partes: [parte({ id: 'a', polo: 'ATIVO' }), parte({ id: 'b', polo: 'PASSIVO' })],
    });
    const svc = new VinculoDeAdvogadoService(prisma as never);
    const r = await svc.aplicarNoProcesso('proc-1', NOSSOS);
    expect(r.naParte).toBe(0);
    expect(prisma.parteProcesso.update).not.toHaveBeenCalled();
  });

  it('processo sem publicação não vira escrita nenhuma', async () => {
    const { prisma } = fingirPrisma({ id: 'p', advogados: [], advogadosDispensados: [], partes: [] });
    prisma.comunicacaoDjen.findMany = jest.fn(async () => []);
    const svc = new VinculoDeAdvogadoService(prisma as never);
    expect(await svc.aplicarNoProcesso('p', NOSSOS)).toEqual({ equipe: 0, naParte: 0, semLado: 0 });
    expect(prisma.processoAdvogado.createMany).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ a migração

describe('a migração dos advogados do ato', () => {
  const SQL = readFileSync(
    join(__dirname, '../../../prisma/migrations/20260911160000_advogados_do_ato/migration.sql'),
    'utf8',
  ).replace(/--.*$/gm, '');

  it('é aditiva e idempotente', () => {
    expect(SQL).toMatch(/ALTER TABLE "processos_advogados" ADD COLUMN IF NOT EXISTS "origem" TEXT/);
    expect(SQL).toMatch(/ALTER TABLE "compromisso_responsaveis" ADD COLUMN IF NOT EXISTS "origem" TEXT/);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS "processos_advogados_dispensados"/);
    for (const proibido of [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /RENAME/i, /ALTER\s+COLUMN/i]) {
      expect(SQL).not.toMatch(proibido);
    }
  });

  /** Coluna nova em tabela viva não pode ser NOT NULL: o contêiner antigo insere sem citá-la. */
  it('as colunas novas são nuláveis', () => {
    for (const linha of SQL.match(/ADD COLUMN[^;]+;/gi) ?? []) {
      expect(linha).not.toMatch(/NOT NULL/i);
    }
  });

  /**
   * A RESERVA ENTRA PELO GATILHO — são oito lugares que criam atividade, e o
   * nono não lembraria de chamar o ajudante (é o que o comentário do gatilho
   * original já dizia).
   */
  it('o gatilho põe a equipe do caso como reserva, só em tarefa de robô', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION senatepi_equipe_do_compromisso/);
    expect(SQL).toMatch(/IF NEW\."origem_automatica" AND NEW\."processo_id" IS NOT NULL THEN/);
    expect(SQL).toMatch(/'AUTOMATICA'/);
    // Nunca o próprio responsável, e nunca advogado desligado.
    expect(SQL).toMatch(/pa\."advogado_id" <> NEW\."responsavel_id"/);
    expect(SQL).toMatch(/AND u\."ativo"/);
  });
});
