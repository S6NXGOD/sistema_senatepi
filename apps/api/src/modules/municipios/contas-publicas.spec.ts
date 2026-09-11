import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { chaveDeEnte } from './chave-de-ente.util';
import {
  avisoDoCalendario,
  CICLOS_ELEITORAIS,
  comparavel,
  folgaAtePrudencial,
  mediana,
  oQueIssoSignifica,
  situacaoFiscal,
} from './leitura-fiscal.util';
import { ondeAtuamos, presencaPorEnte, PRESENCA_VAZIA, type Presenca } from './presenca.util';
import { montarLista, type EnteDaLista, type LeituraDaLista } from './lista-de-entes.util';
import { sugerirMunicipios, distancia, type EnteDoCatalogo } from './sugestoes-de-cidade.util';
import { argumentosDaMesa, RESPOSTA, respostaDaFicha, type DadosDaFicha } from './ficha-do-ente.service';
import { presencaNoPapel } from './relatorio-entes.service';
import { LigarCidadeDto, ListarMunicipiosQueryDto } from './dto/municipios.dto';
import { MunicipiosService } from './municipios.service';
import { guiasVistosDe, CHAVE_DE_GUIA } from '../profile/guias.util';
import { PRE_PROCESSUAIS } from '../processos/processos.service';

/**
 * CONTAS PÚBLICAS — as decisões que a tela mostra, cobradas com o que existe.
 *
 * Os nomes, grafias e percentuais saíram da produção do SENATEPI em 11/09/2026.
 * Os códigos, fora o de Teresina, são ilustrativos — o que se testa é a regra,
 * e a regra não depende do número do IBGE.
 */

const LIMITES = { limiteAlerta: 48.6, limitePrudencial: 51.3, limiteMaximo: 54 };
const leitura = (pct: number | null): LeituraDaLista => ({
  percentualRcl: pct,
  ...LIMITES,
  exercicio: 2026,
  quadrimestre: 1,
});
const consultado = new Date('2026-09-10T12:00:00Z');
const ente = (codigo: number, nome: string, uf: string, extra: Partial<EnteDaLista> = {}): EnteDaLista => ({
  codigo,
  nome,
  uf,
  nomeNormalizado: chaveDeEnte(nome),
  regiaoImediata: null,
  populacao: null,
  siconfiConsultadoEm: consultado,
  ...extra,
});
const presenca = (p: Partial<Presenca>): Presenca => ({ ...PRESENCA_VAZIA, ...p });

// ---------------------------------------------------------------- presença

describe('o que é "onde o sindicato atua"', () => {
  /**
   * BRASÍLIA ENTRAVA PELA COMARCA — 12 ações que tramitam lá, nenhum filiado,
   * nenhuma ação contra o Distrito Federal. Tramitar num fórum não é relação
   * com a prefeitura daquela cidade.
   */
  it('a comarca sozinha não põe ninguém na lista', () => {
    const m = new Map<number, Presenca>([
      [5300108, presenca({ naComarca: 12 })],
      [2211001, presenca({ moram: 2639, naComarca: 68 })],
    ]);
    expect([...ondeAtuamos(m)]).toEqual([2211001]);
  });

  /** Quem trabalha para o ente, quem é réu e organização cadastrada também contam. */
  it('morar, trabalhar, ser réu ou ter organização ligada — qualquer um basta', () => {
    const m = new Map<number, Presenca>([
      [22, presenca({ trabalham: 16 })],
      [2200509, presenca({ acoesContra: 4 })],
      [2207702, presenca({ organizacoes: 1 })],
      [9999999, presenca({})],
    ]);
    expect([...ondeAtuamos(m)].sort()).toEqual([22, 2200509, 2207702].sort());
  });

  /**
   * AS CINCO AGREGAÇÕES CHEGAM NO ENTE CERTO. O falso Prisma devolve o que a
   * produção devolveria para o Governo do Piauí e para Teresina.
   */
  it('junta as cinco contagens por ente e deixa o pré-processual fora da comarca', async () => {
    const chamadas: Record<string, unknown> = {};
    const prisma = {
      filiado: {
        groupBy: jest.fn(async (a: { where: unknown }) => {
          chamadas.filiado = a.where;
          return [{ municipioCodigo: 2211001, _count: { _all: 2639 } }];
        }),
      },
      parteExterna: {
        groupBy: jest.fn(async () => [{ enteCodigo: 22, _count: { _all: 2 } }]),
      },
      processo: {
        groupBy: jest.fn(async (a: { where: unknown }) => {
          chamadas.processo = a.where;
          return [{ municipioIBGE: 2211001, _count: { _all: 68 } }];
        }),
      },
      $queryRaw: jest.fn(async (partes: TemplateStringsArray) => {
        const sql = partes.join('?');
        if (sql.includes('vinculos_profissionais')) return [{ codigo: 22, n: 16 }];
        if (sql.includes('partes_processo')) return [{ codigo: 22, n: 8 }];
        return [];
      }),
    };
    const m = await presencaPorEnte(prisma as never);
    expect(m.get(22)).toEqual({ moram: 0, trabalham: 16, organizacoes: 2, acoesContra: 8, naComarca: 0 });
    expect(m.get(2211001)).toEqual({ moram: 2639, trabalham: 0, organizacoes: 0, acoesContra: 0, naComarca: 68 });
    /* Morar conta só ATIVO — desfiliado não é presença do sindicato. */
    expect(chamadas.filiado).toMatchObject({ situacao: 'ATIVO' });
    /* O número vira link para Processos, cuja lista padrão não mostra pré-processual. */
    expect(chamadas.processo).toMatchObject({ statusInterno: { notIn: PRE_PROCESSUAIS } });
  });
});

// ------------------------------------------------------------------- lista

describe('a lista de Contas Públicas', () => {
  const entes = [
    ente(2211001, 'Teresina', 'PI'),
    ente(2200400, 'Altos', 'PI'),
    ente(2112209, 'Timon', 'MA'),
    ente(5300108, 'Brasília', 'DF'),
    ente(2200202, 'Agricolândia', 'PI', { siconfiConsultadoEm: null }),
    ente(2203701, 'Esperantina', 'PI'),
    ente(2206654, 'Monte Alegre do Piauí', 'PI'),
    ente(1504703, 'Monte Alegre', 'PA'),
    ente(2407807, 'Monte Alegre', 'RN'),
  ];
  const pessoal = new Map<number, LeituraDaLista>([
    [2211001, leitura(43.29)], // Teresina — dentro do limite
    [2200400, leitura(56.52)], // Altos — acima do teto
    [2112209, leitura(53.59)], // Timon — prudencial
    [2203701, leitura(360.24)], // Esperantina — declaração que não fecha
  ]);
  const mapaPresenca = new Map<number, Presenca>([
    [2211001, presenca({ moram: 2639, naComarca: 68 })],
    [2112209, presenca({ moram: 28 })],
    [2206654, presenca({ moram: 20 })],
    [2200400, presenca({ moram: 12 })],
    [2203701, presenca({ moram: 3 })],
    [5300108, presenca({ naComarca: 12 })],
  ]);
  const listar = (f: Partial<Parameters<typeof montarLista>[0]['filtros']> = {}) =>
    montarLista({
      entes,
      pessoal,
      saude: new Map(),
      presenca: mapaPresenca,
      atuacao: ondeAtuamos(mapaPresenca),
      ufDaCasa: 'PI',
      filtros: { escopo: 'atuacao', ordem: 'presenca', page: 1, pageSize: 25, ...f },
    });

  it('abre em "onde atuamos", com quem tem mais gente primeiro — e sem Brasília', () => {
    const r = listar();
    expect(r.items.map((i) => i.nome)).toEqual([
      'Teresina',
      'Timon',
      'Monte Alegre do Piauí',
      'Altos',
      'Esperantina',
    ]);
  });

  /**
   * O ESTADO DA CASA PRIMEIRO. A ordem antiga era UF e depois nome, e "DF" e
   * "MA" vêm antes de "PI": Brasília, Caxias e Timon abriam a tela.
   */
  it('em ordem alfabética, o Piauí vem antes dos outros estados', () => {
    const r = listar({ ordem: 'nome' });
    expect(r.items.map((i) => `${i.nome}/${i.uf}`)).toEqual([
      'Altos/PI',
      'Esperantina/PI',
      'Monte Alegre do Piauí/PI',
      'Teresina/PI',
      'Timon/MA',
    ]);
    expect(r.items.find((i) => i.uf === 'MA')?.foraDaUF).toBe(true);
    expect(r.items.find((i) => i.uf === 'PI')?.foraDaUF).toBe(false);
  });

  it('"Piauí" traz o estado inteiro, inclusive quem ainda não foi consultado', () => {
    const r = listar({ escopo: 'uf', ordem: 'nome' });
    expect(r.items.map((i) => i.nome)).toEqual([
      'Agricolândia',
      'Altos',
      'Esperantina',
      'Monte Alegre do Piauí',
      'Teresina',
    ]);
    expect(r.items[0].fiscal.situacao).toBe('NAO_CONSULTADO');
  });

  it('"Brasil" aceita a UF como sub-filtro', () => {
    expect(listar({ escopo: 'brasil', uf: 'MA' }).items.map((i) => i.nome)).toEqual(['Timon']);
  });

  /** Os chips de recorte respeitam a busca: dizem ONDE está o que se procura. */
  it('com busca, cada chip de recorte conta o que achou nele', () => {
    const r = listar({ busca: 'monte' });
    expect(r.contagens.escopos).toEqual({ atuacao: 1, uf: 1, brasil: 3 });
  });

  /**
   * QUATRO CHIPS DE SITUAÇÃO, contados dentro do recorte. Prudencial e acima do
   * teto dão a mesma resposta à mesa ("não pode dar aumento"), e as três
   * ausências também ("não há número").
   */
  it('os chips de situação somam o recorte e filtram pelo grupo', () => {
    const r = listar();
    expect(r.contagens.situacao).toEqual({ todas: 5, impedidos: 2, alerta: 0, regular: 1, sem_numero: 2 });
    expect(listar({ situacao: 'impedidos' }).items.map((i) => i.nome)).toEqual(['Timon', 'Altos']);
  });

  /** Declaração impossível não disputa o topo com quem estourou de verdade. */
  it('"mais perto do limite" põe os números válidos antes das ausências', () => {
    const r = listar({ ordem: 'percentual' });
    expect(r.items.map((i) => i.nome)).toEqual([
      'Altos',
      'Timon',
      'Teresina',
      'Esperantina',
      'Monte Alegre do Piauí',
    ]);
  });

  it('página além do fim cai na última, não numa lista vazia', () => {
    const r = listar({ pageSize: 2, page: 99 });
    expect(r.page).toBe(3);
    expect(r.totalPaginas).toBe(3);
    expect(r.items).toHaveLength(1);
  });

  /** O navegador com a versão anterior lê `vinculos` durante a troca do deploy. */
  it('mantém `vinculos` para a tela antiga na janela de troca', () => {
    const teresina = listar().items[0];
    expect(teresina.vinculos).toEqual({ filiados: 2639, organizacoes: 0, processos: 0 });
  });
});

// ------------------------------------------------------------ a régua fiscal

describe('a folga até o limite prudencial', () => {
  it('diz quanto a folha pode crescer — até o prudencial, não até o teto', () => {
    const f = folgaAtePrudencial(
      { percentualRcl: 43.29, limitePrudencial: 51.3, despesaPessoal: 1_000_000_000 },
      'REGULAR',
    );
    expect(f?.percentualDaFolha).toBeCloseTo((51.3 / 43.29 - 1) * 100, 6);
    expect(f?.valor).toBeCloseTo(1_000_000_000 * (51.3 / 43.29 - 1), 0);
    /* Até o teto seriam 24,7% — o número antigo do PDF, que exagerava. */
    expect(f?.percentualDaFolha).toBeLessThan((54 / 43.29 - 1) * 100);
  });

  it('acima do prudencial, a folga é negativa: quanto teria de cair', () => {
    const f = folgaAtePrudencial(
      { percentualRcl: 53.59, limitePrudencial: 51.3, despesaPessoal: 100_000_000 },
      'PRUDENCIAL',
    );
    expect(f!.valor).toBeLessThan(0);
    expect(f!.percentualDaFolha).toBeCloseTo((51.3 / 53.59 - 1) * 100, 6);
  });

  it('declaração que não fecha e ausência de número não têm folga', () => {
    const l = { percentualRcl: 360.24, limitePrudencial: 51.3, despesaPessoal: 112_109_827.61 };
    expect(folgaAtePrudencial(l, 'INCONSISTENTE')).toBeNull();
    expect(folgaAtePrudencial({ ...l, percentualRcl: null }, 'SEM_DADO')).toBeNull();
  });
});

describe('a comparação com os vizinhos', () => {
  it('a mediana aguenta lista par, ímpar e vazia', () => {
    expect(mediana([46.4, 42.31, 48.37])).toBe(46.4);
    expect(mediana([40, 50])).toBe(45);
    expect(mediana([])).toBeNull();
  });

  /** Esperantina declarou 360% da receita em folha — não entra em comparação nenhuma. */
  it('só compara declaração que fecha', () => {
    expect(comparavel({ percentualRcl: 360.24, ...LIMITES })).toBe(false);
    expect(comparavel({ percentualRcl: 56.52, ...LIMITES })).toBe(true);
    expect(comparavel({ percentualRcl: null, ...LIMITES })).toBe(false);
  });
});

/**
 * AS EXCEÇÕES DO ART. 22. A frase antiga dizia "proibido de conceder aumento
 * ... exceto reposição em saúde" e omitia a revisão geral anual — exatamente o
 * que a prefeitura omite na mesa.
 */
describe('o que o limite prudencial proíbe — e o que ele NÃO proíbe', () => {
  it('a explicação cita a revisão geral anual e o que vem de sentença ou lei', () => {
    const t = oQueIssoSignifica('PRUDENCIAL');
    expect(t).toContain('proibido de conceder aumento');
    expect(t).toContain('revisão geral anual');
    expect(t).toContain('art. 37, X');
    expect(t).toMatch(/sentença judicial ou de lei/);
  });

  it('acima do teto, as mesmas exceções continuam valendo', () => {
    expect(oQueIssoSignifica('ACIMA_DO_TETO')).toContain('revisão geral anual');
  });
});

// ------------------------------------------------- a ficha para a negociação

describe('a ficha para a mesa de negociação', () => {
  const base = (fiscal: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ({
      nome: 'Teresina',
      uf: 'PI',
      esfera: 'M',
      fiscal: { explicacao: '', ...LIMITES, exercicio: 2026, quadrimestre: 1, ...fiscal },
      comparacao: null,
      ...extra,
    }) as unknown as DadosDaFicha;

  it('toda situação tem uma resposta curta, e ela começa por SIM, NÃO ou SEM RESPOSTA', () => {
    for (const r of Object.values(RESPOSTA)) expect(r).toMatch(/^(SIM|NÃO|SEM RESPOSTA)/);
  });

  it('dentro do limite, diz quanto cabe — e lembra que a categoria pesa menos que a folha', () => {
    const folga = folgaAtePrudencial(
      { percentualRcl: 43.29, limitePrudencial: 51.3, despesaPessoal: 1_200_000_000 },
      'REGULAR',
    );
    const a = argumentosDaMesa(base({ situacao: 'REGULAR', percentualRcl: 43.29, folga }));
    expect(a.join(' ')).toMatch(/pode crescer 18,5%/);
    expect(a.join(' ')).toMatch(/só da categoria/);
    /* Nunca oferece a exceção do prudencial a quem não está nele. */
    expect(a.join(' ')).not.toMatch(/revisão geral anual/);
  });

  it('no prudencial, a ficha traz as exceções e quanto a folha teria de cair', () => {
    const folga = folgaAtePrudencial(
      { percentualRcl: 53.59, limitePrudencial: 51.3, despesaPessoal: 180_000_000 },
      'PRUDENCIAL',
    );
    const a = argumentosDaMesa(base({ situacao: 'PRUDENCIAL', percentualRcl: 53.59, folga })).join(' ');
    expect(a).toMatch(/revisão geral anual/);
    expect(a).toMatch(/teria de cair 4,3%/);
    expect(a).not.toMatch(/pode crescer/);
  });

  it('a comparação diz com quantos municípios foi feita', () => {
    const a = argumentosDaMesa(
      base(
        { situacao: 'REGULAR', percentualRcl: 43.29, folga: null },
        { comparacao: { uf: { uf: 'PI', mediana: 46.4, n: 55 }, regiao: null } },
      ),
    ).join(' ');
    expect(a).toMatch(/abaixo da mediana dos 55 municípios do PI com dado \(46,40%\)/);
  });

  /** Declaração que não fecha não vira comparação: seria legitimar o número. */
  it('declaração que não fecha não entra na comparação', () => {
    const a = argumentosDaMesa(
      base(
        { situacao: 'INCONSISTENTE', percentualRcl: 360.24, folga: null },
        { comparacao: { uf: { uf: 'PI', mediana: 46.4, n: 55 }, regiao: null } },
      ),
    ).join(' ');
    expect(a).not.toMatch(/mediana/);
    expect(a).toMatch(/não fecha/);
  });

  it('quem não publicou não pode alegar limite — e a ficha diz', () => {
    const a = argumentosDaMesa(base({ situacao: 'SEM_DADO', percentualRcl: null })).join(' ');
    expect(a).toMatch(/irregularidade/);
  });

  /**
   * "SIM — A LRF NÃO IMPEDE" ERA FALSO para o Governo do Piauí em setembro de
   * 2026: 37%, dentro do limite, e nos 180 dias antes do fim do mandato, em que
   * o art. 21 anula o aumento.
   */
  it('no fim do mandato, "sim pelos limites" vira "só em parte"', () => {
    const fim = { calendario: { fimDeMandato: true, texto: 'Fim de mandato…' }, esfera: 'E' };
    expect(respostaDaFicha(base({ situacao: 'REGULAR', percentualRcl: 37 }, fim))).toMatch(/^SÓ EM PARTE/);
    expect(respostaDaFicha(base({ situacao: 'ALERTA', percentualRcl: 45 }, fim))).toMatch(/^SÓ EM PARTE/);
    expect(respostaDaFicha(base({ situacao: 'PRUDENCIAL', percentualRcl: 47 }, fim))).toMatch(/^NÃO/);
    expect(respostaDaFicha(base({ situacao: 'REGULAR', percentualRcl: 37 }))).toBe('SIM — os limites da LRF não impedem.');
  });

  /** A folga continua verdadeira, mas é do próximo governo — e o art. 21 também anula parcela para depois. */
  it('no fim do mandato, a folga é dita como do próximo governo', () => {
    const folga = folgaAtePrudencial({ percentualRcl: 37, limitePrudencial: 46.55, despesaPessoal: 7e9 }, 'REGULAR');
    const a = argumentosDaMesa(
      base({ situacao: 'REGULAR', percentualRcl: 37, folga }, { calendario: { fimDeMandato: true, texto: '' } }),
    ).join(' ');
    expect(a).toMatch(/vale o art\. 21: o espaço é do próximo governo/);
  });

  /** A União não é lida por esta integração — e a ficha não pode acusá-la. */
  it('a União não é acusada de não publicar', () => {
    expect(respostaDaFicha(base({ situacao: 'SEM_DADO', percentualRcl: null }, { esfera: 'U' }))).toMatch(
      /não lê a LRF da União/,
    );
  });
});

// ---------------------------------------------------------------- o calendário

describe('o calendário que os limites não dizem', () => {
  const em = (iso: string) => new Date(iso);

  it('Governo do Estado em setembro de 2026: fim de mandato, art. 21 e art. 73', () => {
    const a = avisoDoCalendario('E', em('2026-09-11T12:00:00Z'));
    expect(a?.fimDeMandato).toBe(true);
    expect(a?.texto).toMatch(/art\. 21, II/);
    expect(a?.texto).toMatch(/art\. 73, VIII/);
    expect(a?.texto).toContain('10/07/2026');
    expect(a?.texto).toContain('06/01/2027');
  });

  it('em maio de 2026, só a regra eleitoral da revisão geral', () => {
    const a = avisoDoCalendario('E', em('2026-05-01T12:00:00Z'));
    expect(a?.fimDeMandato).toBe(false);
    expect(a?.texto).toMatch(/^Ano de eleição/);
  });

  it('fora das janelas, nenhum aviso', () => {
    expect(avisoDoCalendario('E', em('2026-03-01T12:00:00Z'))).toBeNull();
    expect(avisoDoCalendario('E', em('2027-01-06T12:00:00Z'))).toBeNull();
  });

  /** 2026 é eleição geral; a das prefeituras é 2028. */
  it('prefeituras: nada em 2026, fim de mandato no segundo semestre de 2028', () => {
    expect(avisoDoCalendario('M', em('2026-09-11T12:00:00Z'))).toBeNull();
    const a = avisoDoCalendario('M', em('2028-08-01T12:00:00Z'));
    expect(a?.fimDeMandato).toBe(true);
    expect(a?.texto).toContain('01/01/2029');
  });

  it('a União não entra', () => {
    expect(avisoDoCalendario('U', em('2026-09-11T12:00:00Z'))).toBeNull();
  });

  /**
   * A TABELA É ESCRITA À MÃO — calendário eleitoral se consulta, não se
   * calcula. Este teste reprova quando faltarem menos de dois anos de tabela,
   * para ninguém descobrir no meio da janela que o aviso sumiu.
   */
  it('a tabela de eleições cobre pelo menos os próximos dois anos', () => {
    const daquiADoisAnos = Date.now() + 2 * 365 * 86_400_000;
    for (const esfera of ['E', 'M'] as const) {
      const ultima = Math.max(...CICLOS_ELEITORAIS[esfera].map((c) => c.posse));
      expect(ultima).toBeGreaterThan(daquiADoisAnos);
    }
  });
});

// ------------------------------------------------ mudar a cidade desliga

describe('mudar a cidade do filiado desliga o município', () => {
  const sql = readFileSync(
    join(__dirname, '../../../prisma/migrations/20260911130000_mudar_a_cidade_desliga_o_municipio/migration.sql'),
    'utf8',
  ).replace(/--.*$/gm, '');

  /**
   * NO BANCO, E NÃO EM CADA SERVIÇO: há ao menos cinco portas que gravam cidade
   * de filiado. A ligação MANUAL feita em Contas Públicas congelaria o
   * município de quem se muda; o gatilho a desfaz para a madrugada ligar de
   * novo pelo texto novo.
   */
  it('dispara só quando cidade ou estado estão no UPDATE', () => {
    expect(sql).toMatch(/BEFORE UPDATE OF cidade, estado ON "filiados"/);
  });

  it('apaga a ligação só se o texto MUDOU e a ligação não veio junto', () => {
    expect(sql).toMatch(/NEW\.cidade IS DISTINCT FROM OLD\.cidade/);
    expect(sql).toMatch(/NEW\.estado IS DISTINCT FROM OLD\.estado/);
    expect(sql).toMatch(/NEW\.municipio_codigo IS NOT DISTINCT FROM OLD\.municipio_codigo/);
    expect(sql).toMatch(/NEW\.municipio_codigo := NULL/);
    expect(sql).toMatch(/NEW\.municipio_origem := NULL/);
  });

  it('é idempotente e não destrói nada', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS filiados_mudou_a_cidade ON "filiados"/);
    for (const proibido of [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /ALTER\s+COLUMN/i, /RENAME/i]) {
      expect(sql).not.toMatch(proibido);
    }
  });
});

// --------------------------------------------- palpites para a grafia torta

describe('palpites para a cidade que o casamento não reconheceu', () => {
  const nomes: Array<[number, string, string]> = [
    [2211001, 'Teresina', 'PI'],
    [2206654, 'Monte Alegre do Piauí', 'PI'],
    [1504703, 'Monte Alegre', 'PA'],
    [2407807, 'Monte Alegre', 'RN'],
    [2206720, 'Morro Cabeça no Tempo', 'PI'],
    [2206753, 'Morro do Chapéu do Piauí', 'PI'],
    [2207108, "Olho D'Água do Piauí", 'PI'],
    [2107308, "Olho d'Água das Cunhãs", 'MA'],
    [2112209, 'Timon', 'MA'],
    [2101301, 'Barão de Grajaú', 'MA'],
    [2202851, 'Colônia do Gurguéia', 'PI'],
    [2202901, 'Colônia do Piauí', 'PI'],
    [2202174, 'Cajazeiras do Piauí', 'PI'],
    [2503704, 'Cajazeiras', 'PB'],
    [2103000, 'Caxias', 'MA'],
    [2202703, 'Caxingó', 'PI'],
    [2106904, 'Montes Altos', 'MA'],
  ];
  const catalogo: EnteDoCatalogo[] = nomes.map(([codigo, nome, uf]) => ({
    codigo,
    nome,
    uf,
    nomeNormalizado: chaveDeEnte(nome),
  }));
  const primeiro = (cidade: string, estado: string | null) =>
    sugerirMunicipios(cidade, estado, catalogo, 'PI')[0];

  /** 20 filiados. No Piauí não existe "Monte Alegre" — existe Monte Alegre do Piauí. */
  it('"Monte Alegre" sem estado sugere primeiro o do Piauí, e mostra os homônimos depois', () => {
    const s = sugerirMunicipios('Monte Alegre', null, catalogo, 'PI');
    expect(s[0]).toMatchObject({ nome: 'Monte Alegre do Piauí', uf: 'PI', motivo: 'COMECA_IGUAL' });
    expect(s.slice(1).map((x) => x.uf).sort()).toEqual(['PA', 'RN']);
  });

  it.each([
    ['MORRO CABEÇA DO TEMPO', 'PI', 'Morro Cabeça no Tempo', 'PI'],
    ["OLHO D'ÁGUA", 'PI', "Olho D'Água do Piauí", 'PI'],
    ['TERSINA', 'PI', 'Teresina', 'PI'],
    ['TEESINA', 'PI', 'Teresina', 'PI'],
    ['TERESIN', 'PI', 'Teresina', 'PI'],
    ['TERESIINA', 'PI', 'Teresina', 'PI'],
    ['Colônia do Gurgéia', null, 'Colônia do Gurguéia', 'PI'],
    ['CAZAJEIRAS', 'PI', 'Cajazeiras do Piauí', 'PI'],
  ] as Array<[string, string | null, string, string]>)(
    '"%s/%s" → %s/%s',
    (cidade, estado, nome, uf) => {
      expect(primeiro(cidade, estado)).toMatchObject({ nome, uf });
    },
  );

  /** O nome existe; a UF digitada é que está errada. */
  it.each([
    ['TIMON', 'PI', 'Timon', 'MA'],
    ['BARÃO DE GRAJAÚ', 'PI', 'Barão de Grajaú', 'MA'],
    ['TERESINA', 'MA', 'Teresina', 'PI'],
    ['TERESINA', 'PE', 'Teresina', 'PI'],
  ] as Array<[string, string, string, string]>)('"%s/%s" → %s/%s', (cidade, estado, nome, uf) => {
    expect(primeiro(cidade, estado)).toMatchObject({ nome, uf, motivo: 'MESMO_NOME_EM_OUTRA_UF' });
  });

  /** Grafia torta com UF de fora: a cidade pode ser da casa. */
  it('"TERSINA/CE" cai em Teresina, não numa cidade do Ceará', () => {
    expect(primeiro('TERSINA', 'CE')).toMatchObject({ nome: 'Teresina', uf: 'PI' });
  });

  /** Nome curto não tolera erro: "CAXIA" a uma letra de "caxin" viraria Caxingó. */
  it('não inventa palpite para nome curto', () => {
    expect(sugerirMunicipios('CAXIA', 'PI', catalogo, 'PI')).toEqual([]);
  });

  it('a distância de edição respeita o teto', () => {
    expect(distancia('tersina', 'teresina')).toBe(1);
    expect(distancia('abc', 'xyzxyzxyz', 2)).toBe(3);
  });
});

// ------------------------------------------------------- os dois botões novos

describe('ligar uma grafia a um município e dizer o governo de um órgão', () => {
  const auditoria = () => ({ registrar: jest.fn(async () => undefined) });

  /**
   * SÓ OS CAMPOS DERIVADOS, só quem ainda não tem município, e MANUAL. É o que
   * impede que EDITAR em Contas Públicas vire porta para reescrever endereço.
   */
  it('liga a grafia exata, só em quem está sem município, como MANUAL', async () => {
    const updateMany = jest.fn(async () => ({ count: 20 }));
    const prisma = {
      ente: { findUnique: jest.fn(async () => ({ codigo: 2206654, nome: 'Monte Alegre do Piauí', uf: 'PI', esfera: 'M' })) },
      filiado: { updateMany },
    };
    const audit = auditoria();
    const svc = new MunicipiosService(prisma as never, audit as never);
    const r = await svc.ligarCidade({ cidade: 'Monte Alegre', estado: null, codigo: 2206654 }, 'u1');
    expect(r.ligados).toBe(20);
    expect(updateMany).toHaveBeenCalledWith({
      where: { cidade: 'Monte Alegre', estado: null, municipioCodigo: null },
      data: { municipioCodigo: 2206654, municipioOrigem: 'MANUAL' },
    });
    expect(audit.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', descricao: expect.stringContaining('Monte Alegre do Piauí') }),
    );
  });

  /** Filiado mora em município — o CHECK do banco recusaria, e a mensagem diria menos. */
  it('recusa ligar filiado a um Estado', async () => {
    const prisma = {
      ente: { findUnique: jest.fn(async () => ({ codigo: 22, nome: 'Piauí', uf: 'PI', esfera: 'E' })) },
      filiado: { updateMany: jest.fn() },
    };
    const svc = new MunicipiosService(prisma as never, auditoria() as never);
    await expect(svc.ligarCidade({ cidade: 'Piauí', codigo: 22 }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.filiado.updateMany).not.toHaveBeenCalled();
  });

  it('o órgão ganha o ente como MANUAL — e só se ainda não tiver governo', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      parteExterna: {
        findUnique: jest.fn(async () => ({ id: 'hgv', nome: 'HOSPITAL GETÚLIO VARGAS', ativo: true })),
        updateMany,
      },
      ente: { findUnique: jest.fn(async () => ({ codigo: 22, nome: 'Piauí', uf: 'PI', esfera: 'E' })) },
    };
    const svc = new MunicipiosService(prisma as never, auditoria() as never);
    await svc.ligarOrganizacao({ parteExternaId: 'hgv', enteCodigo: 22 }, 'u1');
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'hgv', ativo: true, enteCodigo: null },
      data: { enteCodigo: 22, enteOrigem: 'MANUAL' },
    });

    /*
      QUEM JÁ TEM GOVERNO NÃO É TROCADO POR ESTA PORTA. Sem a condição, a
      pendência trocaria o governo que alguém escolheu em Organizações — e, com
      uma matriz que edita Contas Públicas mas não Organizações, seria uma
      escrita no cadastro da organização por uma porta lateral.
    */
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.ligarOrganizacao({ parteExternaId: 'hgv', enteCodigo: 22 }, 'u1')).rejects.toBeInstanceOf(
      ConflictException,
    );

    prisma.parteExterna.findUnique = jest.fn(async () => ({ id: 'x', nome: 'X', ativo: false }));
    await expect(svc.ligarOrganizacao({ parteExternaId: 'x', enteCodigo: 22 }, 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ------------------------------------------------------------ o contrato HTTP

describe('o que a rota aceita', () => {
  /** O `ValidationPipe` global recusa campo não declarado — cada filtro novo precisa de linha no DTO. */
  it('aceita recorte, situação e ordem conhecidos e recusa os outros', async () => {
    const ok = plainToInstance(ListarMunicipiosQueryDto, { escopo: 'uf', situacao: 'impedidos', ordem: 'percentual' });
    expect(await validate(ok)).toHaveLength(0);
    const ruim = plainToInstance(ListarMunicipiosQueryDto, { escopo: 'mundo', situacao: 'quebrado', ordem: 'aleatoria' });
    expect((await validate(ruim)).map((e) => e.property).sort()).toEqual(['escopo', 'ordem', 'situacao']);
  });

  /** A tela anterior, durante a troca do deploy, ainda manda estes dois. */
  it('continua aceitando os filtros da tela anterior', async () => {
    const antigo = plainToInstance(ListarMunicipiosQueryDto, { soComVinculo: 'true', soAcimaDoLimite: 'true' });
    expect(await validate(antigo)).toHaveLength(0);
  });

  it('ligar cidade aceita estado nulo e recusa código que não é de município', async () => {
    const nulo = plainToInstance(LigarCidadeDto, { cidade: 'Monte Alegre', estado: null, codigo: 2206654 });
    expect(await validate(nulo)).toHaveLength(0);
    const estado = plainToInstance(LigarCidadeDto, { cidade: 'Piauí', codigo: 22 });
    expect((await validate(estado)).map((e) => e.property)).toEqual(['codigo']);
  });
});

// ------------------------------------------------ o guia de primeiro acesso

describe('o guia de primeiro acesso', () => {
  it('lê as chaves já vistas e ignora qualquer forma estranha', () => {
    expect(guiasVistosDe({ guias: { 'contas-publicas': '2026-09-11T03:00:00Z' } })).toEqual(['contas-publicas']);
    expect(guiasVistosDe(null)).toEqual([]);
    expect(guiasVistosDe({ guias: ['contas-publicas'] })).toEqual([]);
    expect(guiasVistosDe('texto')).toEqual([]);
  });

  it('a chave não aceita nada que vire caminho, SQL ou HTML', () => {
    expect(CHAVE_DE_GUIA.test('contas-publicas')).toBe(true);
    for (const ruim of ['../x', "a'; drop", '<b>', 'A', 'x'.repeat(41)]) {
      expect(CHAVE_DE_GUIA.test(ruim)).toBe(false);
    }
  });

  /** Ver a mesma regra da migração dos entes: o contêiner antigo cria usuário sem citar a coluna. */
  it('a migração é aditiva, nulável e idempotente', () => {
    const sql = readFileSync(
      join(__dirname, '../../../prisma/migrations/20260911120000_preferencias_do_usuario/migration.sql'),
      'utf8',
    ).replace(/--.*$/gm, '');
    expect(sql).toMatch(/ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferencias" JSONB/);
    for (const proibido of [/NOT NULL/i, /DROP/i, /RENAME/i, /ALTER\s+COLUMN/i]) {
      expect(sql).not.toMatch(proibido);
    }
  });
});

/**
 * O PAPEL FALA COMO A TELA. A primeira impressão saiu com "1 moram", e
 * Palmeirais — na lista por ter organização cadastrada — com um "—".
 */
describe('a presença no relatório em PDF', () => {
  it('singular e plural certos', () => {
    expect(presencaNoPapel({ moram: 1, trabalham: 0, acoesContra: 1, organizacoes: 0 })).toBe('1 mora · 1 ação');
    expect(presencaNoPapel({ moram: 2632, trabalham: 0, acoesContra: 0, organizacoes: 0 })).toBe('2.632 moram');
    expect(presencaNoPapel({ moram: 0, trabalham: 16, acoesContra: 8, organizacoes: 2 })).toBe('16 trabalham · 8 ações');
  });

  it('organização aparece quando é a única presença, e nunca some em "—"', () => {
    expect(presencaNoPapel({ moram: 0, trabalham: 0, acoesContra: 0, organizacoes: 1 })).toBe('1 organização');
    expect(presencaNoPapel({ moram: 3, trabalham: 0, acoesContra: 0, organizacoes: 1 })).toBe('3 moram');
  });
});

/** Uma última trava: a situação que a lista usa é a mesma da regra da LRF. */
it('a lista e a régua classificam igual', () => {
  expect(situacaoFiscal(leitura(53.59), consultado)).toBe('PRUDENCIAL');
});
