/**
 * @jest-environment node
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { tenant } from '@/tenant.config';
import { montarDocumento, type BlocoDoPdf } from './pdf-documento';
import { foraDaFontePadrao } from './pdf-graficos';
import type { Concentracao, Dispersao, Historico, Panorama } from './panorama';
import {
  ESCOLHAS_PADRAO_DO_PANORAMA, LIMITES_DO_PANORAMA, anoEmTeresina, antesDeLer, arquivoDoPanorama,
  capaDoPanorama, nomeDoReu, planoDoPanorama, type EscolhasDoPanorama,
} from './panorama-pdf';

/**
 * O PDF DO PANORAMA — provado pela SAÍDA do plano, sem navegador.
 *
 * O papel sai com o logo do sindicato e vai para a mão da diretoria. O que ele
 * não pode fazer — opinar, identificar pessoa física, pôr o ano pela metade em
 * pé de igualdade com os fechados, sumir com o que não coube — é o que se trava
 * aqui, com valores, e não conferido a olho num PDF.
 */

const historico = (h: Partial<Historico> = {}): Historico => ({
  julgados: 5, procedentes: 2, parciais: 2, improcedentes: 1, comRecursoDepois: 0, ...h,
});

const concentracao = (c: Partial<Concentracao> = {}): Concentracao => ({
  parteExternaId: 'pe-1',
  adversario: 'Hapvida Assistência Médica',
  tipo: 'JURIDICA',
  processos: 5,
  individuais: 4,
  desde: '2021-03-01',
  julgados: 3, procedentes: 1, parciais: 2, improcedentes: 0,
  pedidos: [{ assunto: 'Indenização Relacionada ao Exercício do Direito de Greve', processos: 3 }],
  historico: historico(),
  leituras: ['COLETIVA_POSSIVEL'],
  ...c,
});

const dispersao = (d: Partial<Dispersao> = {}): Dispersao => ({
  assunto: 'Piso Salarial da Categoria',
  processos: 9,
  adversarios: 6,
  individuais: 2,
  desde: '2022-01-10',
  julgados: 4, procedentes: 2, parciais: 1, improcedentes: 1,
  historico: historico({ julgados: 7, procedentes: 3, parciais: 2, improcedentes: 2 }),
  porAno: [
    { ano: 2022, processos: 1 },
    { ano: 2023, processos: 1 },
    { ano: 2024, processos: 0 },
    { ano: 2025, processos: 5 },
    { ano: 2026, processos: 2 },
  ],
  ...d,
});

const panorama = (p: Partial<Panorama> = {}): Panorama => ({
  concentracoes: [concentracao()],
  dispersoes: [dispersao()],
  nossoPapel: { autor: 93, reu: 3, representando: 31 },
  acervoAtivo: 149,
  geradoEm: '2026-09-13T01:30:00.000Z',
  ...p,
});

const NADA: EscolhasDoPanorama = {
  lados: { incluir: false, detalhar: false },
  concentracoes: { incluir: false, detalhar: false },
  dispersoes: { incluir: false, detalhar: false },
};

const TUDO_DETALHADO: EscolhasDoPanorama = {
  lados: { incluir: true, detalhar: true },
  concentracoes: { incluir: true, detalhar: true },
  dispersoes: { incluir: true, detalhar: true },
};

const secoes = (plano: BlocoDoPdf[]) =>
  plano.filter((b): b is Extract<BlocoDoPdf, { tipo: 'secao' }> => b.tipo === 'secao').map((b) => b.titulo);

const de = <T extends BlocoDoPdf['tipo']>(plano: BlocoDoPdf[], tipo: T) =>
  plano.filter((b): b is Extract<BlocoDoPdf, { tipo: T }> => b.tipo === tipo);

/** Todo texto que o plano leva ao papel, para as varreduras. */
function textos(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor];
  if (Array.isArray(valor)) return valor.flatMap(textos);
  if (valor && typeof valor === 'object') return Object.values(valor).flatMap(textos);
  return [];
}

describe('o que abre o documento', () => {
  it('"Antes de ler" é o primeiro bloco, mesmo com tudo desmarcado', () => {
    const plano = planoDoPanorama(panorama(), NADA, 2026);
    expect(plano).toHaveLength(1);
    expect(plano[0]).toMatchObject({ tipo: 'destaque', rotulo: 'Antes de ler' });
  });

  it('continua primeiro com tudo marcado', () => {
    const plano = planoDoPanorama(panorama(), TUDO_DETALHADO, 2026);
    expect(plano[0]).toMatchObject({ tipo: 'destaque', rotulo: 'Antes de ler' });
    expect(secoes(plano)).toEqual(['De que lado estamos', 'O mesmo réu, o mesmo pedido', 'O mesmo pedido, muitos réus']);
  });

  it('diz que sentença não é resultado final e que o sistema não opina', () => {
    const texto = antesDeLer(panorama());
    expect(texto).toContain('Sentença não é resultado final');
    expect(texto).toContain('não opina');
    expect(texto).toContain('todas as ações ajuizadas');
  });

  /** Na janela de troca a API antiga não manda o histórico: o papel não pode afirmar o que não contou. */
  it('sem histórico da API, não fala em ajuizadas', () => {
    const semHistorico = panorama({
      concentracoes: [concentracao({ historico: undefined })],
      dispersoes: [dispersao({ historico: undefined })],
    });
    expect(antesDeLer(semHistorico)).not.toContain('ajuizadas');
    const plano = planoDoPanorama(semHistorico, TUDO_DETALHADO, 2026);
    expect(de(plano, 'barras')[0].unidade).toBe('ações ativas');
    // As julgadas saem das ativas: 3 (1 · 2 · 0).
    expect(de(plano, 'tabela')[0].linhas[0][3]).toBe('3 (1 · 2 · 0)');
  });
});

describe('as escolhas decidem o que entra', () => {
  it('seção desmarcada não entra', () => {
    const plano = planoDoPanorama(panorama(), { ...TUDO_DETALHADO, concentracoes: { incluir: false, detalhar: true } }, 2026);
    expect(secoes(plano)).not.toContain('O mesmo réu, o mesmo pedido');
    expect(textos(plano).join(' ')).not.toContain('Hapvida');
  });

  it('detalhar sem incluir não entra', () => {
    const plano = planoDoPanorama(panorama(), { ...NADA, dispersoes: { incluir: false, detalhar: true } }, 2026);
    expect(de(plano, 'colunas')).toHaveLength(0);
  });

  it('o padrão inclui tudo e não detalha nada', () => {
    const plano = planoDoPanorama(panorama(), ESCOLHAS_PADRAO_DO_PANORAMA, 2026);
    expect(secoes(plano)).toHaveLength(3);
    expect(de(plano, 'colunas')).toHaveLength(0);
    expect(de(plano, 'tabela').map((t) => t.titulo)).not.toContain('Os pedidos que se repetem');
  });

  it('sem gráficos, nenhuma barra nem coluna; o por ano sai em tabela', () => {
    const plano = planoDoPanorama(panorama(), TUDO_DETALHADO, 2026, { graficos: false });
    expect(de(plano, 'barras')).toHaveLength(0);
    expect(de(plano, 'colunas')).toHaveLength(0);
    const porAno = de(plano, 'tabela').find((t) => t.titulo === 'Ações ajuizadas por ano');
    expect(porAno?.linhas[0][1]).toBe('2022: 1 · 2023: 1 · 2024: 0 · 2025: 5 · 2026 (até agora): 2');
  });

  it('de que lado estamos leva a sigla da instalação e nunca diz que soma o acervo', () => {
    const plano = planoDoPanorama(panorama(), TUDO_DETALHADO, 2026);
    const numeros = de(plano, 'numeros')[0];
    expect(numeros.itens.map((i) => i.rotulo)).toEqual([
      `${tenant.sigla} é o autor`, 'Representamos o filiado', `${tenant.sigla} é réu`,
    ]);
    expect(numeros.itens.map((i) => i.valor)).toEqual(['93', '31', '3']);
    expect(textos(plano).join(' ')).not.toMatch(/somam o acervo/i);
  });
});

describe('o réu e o pedido', () => {
  it('a tabela de réus traz as julgadas do histórico e o título da leitura', () => {
    const plano = planoDoPanorama(panorama(), ESCOLHAS_PADRAO_DO_PANORAMA, 2026);
    const tabela = de(plano, 'tabela')[0];
    expect(tabela.cabecalho).toEqual(['Réu', 'Ações ativas', 'Individuais', 'Julgadas (p · pp · i)', 'Leitura']);
    expect(tabela.linhas[0]).toEqual([
      'Hapvida Assistência Médica', '5', '4', '5 (2 · 2 · 1)', 'São ações individuais pedindo a mesma coisa',
    ]);
  });

  /** Um papel da diretoria com o nome de uma pessoa física ao lado de "sempre contrário" expõe alguém. */
  it('réu pessoa física sai mascarado em todo o documento', () => {
    const plano = planoDoPanorama(
      panorama({ concentracoes: [concentracao({ adversario: 'Maria das Dores Silva', tipo: 'FISICA' })] }),
      TUDO_DETALHADO,
      2026,
    );
    const tudo = textos(plano).join(' ');
    expect(tudo).not.toContain('Maria das Dores');
    expect(tudo).toContain('Pessoa física');
    expect(nomeDoReu({ adversario: 'Empresa X', tipo: 'JURIDICA' })).toBe('Empresa X');
    expect(nomeDoReu({ adversario: 'Município de Teresina', tipo: null })).toBe('Município de Teresina');
  });

  it('as barras de desfecho mostram só réus com julgadas, com o total e as partes', () => {
    const plano = planoDoPanorama(
      panorama({
        concentracoes: [
          concentracao(),
          concentracao({ parteExternaId: 'pe-2', adversario: 'Unimed', historico: historico({ julgados: 0, procedentes: 0, parciais: 0, improcedentes: 0 }) }),
        ],
      }),
      ESCOLHAS_PADRAO_DO_PANORAMA,
      2026,
    );
    const barras = de(plano, 'barras')[0];
    expect(barras.itens).toEqual([
      { rotulo: 'Hapvida Assistência Médica', partes: [2, 2, 1], texto: '5 julgadas (2 · 2 · 1)' },
    ]);
  });

  it('o recurso julgado depois vira nota com a contagem', () => {
    const plano = planoDoPanorama(
      panorama({ concentracoes: [concentracao({ historico: historico({ comRecursoDepois: 3 }) })] }),
      ESCOLHAS_PADRAO_DO_PANORAMA,
      2026,
    );
    const notas = de(plano, 'nota').map((b) => b.texto);
    expect(notas).toContain(
      '3 ações julgadas tiveram recurso julgado depois da sentença: o resultado final pode ser outro. ' +
        'Para esses réus, a leitura de resultado uniforme não aparece.',
    );
  });

  it('o detalhe lista os pedidos e explica cada leitura presente uma vez só', () => {
    const plano = planoDoPanorama(
      panorama({
        concentracoes: [
          concentracao({ leituras: ['COLETIVA_POSSIVEL'] }),
          concentracao({ parteExternaId: 'pe-2', adversario: 'Unimed', leituras: ['COLETIVA_POSSIVEL', 'DESFECHO_SEMPRE_A_FAVOR'] }),
        ],
      }),
      TUDO_DETALHADO,
      2026,
    );
    const tabelas = de(plano, 'tabela');
    expect(tabelas.find((t) => t.titulo === 'Os pedidos que se repetem')?.linhas).toHaveLength(2);
    const leituras = tabelas.find((t) => t.titulo === 'O que cada leitura quer dizer');
    expect(leituras?.linhas.map((l) => l[0])).toEqual([
      'O resultado tem sido sempre favorável',
      'São ações individuais pedindo a mesma coisa',
    ]);
  });
});

describe('os limites do papel dizem o que ficou de fora', () => {
  it(`até ${LIMITES_DO_PANORAMA.reus} réus, e a nota diz quantos eram`, () => {
    const muitos = Array.from({ length: 25 }, (_, i) =>
      concentracao({ parteExternaId: `pe-${i}`, adversario: `Empresa ${i}` }),
    );
    const plano = planoDoPanorama(panorama({ concentracoes: muitos }), ESCOLHAS_PADRAO_DO_PANORAMA, 2026);
    expect(de(plano, 'tabela')[0].linhas).toHaveLength(20);
    expect(de(plano, 'nota').map((b) => b.texto)).toContain('A tabela mostra 20 de 25 réus, os de mais ações ativas.');
  });

  it(`até ${LIMITES_DO_PANORAMA.pedidos} pedidos por réu, com "e mais"`, () => {
    const pedidos = Array.from({ length: 15 }, (_, i) => ({ assunto: `Pedido ${i}`, processos: 3 }));
    const plano = planoDoPanorama(panorama({ concentracoes: [concentracao({ pedidos })] }), TUDO_DETALHADO, 2026);
    const linhas = de(plano, 'tabela').find((t) => t.titulo === 'Os pedidos que se repetem')!.linhas;
    expect(linhas).toHaveLength(13);
    expect(linhas[12][1]).toBe('e mais 3 pedidos');
  });

  it(`até ${LIMITES_DO_PANORAMA.graficos} gráficos de pedido`, () => {
    const muitas = Array.from({ length: 10 }, (_, i) => dispersao({ assunto: `Assunto ${i}` }));
    const plano = planoDoPanorama(panorama({ dispersoes: muitas }), TUDO_DETALHADO, 2026);
    expect(de(plano, 'colunas')).toHaveLength(8);
    expect(de(plano, 'nota').map((b) => b.texto)).toContain('Os gráficos mostram 8 de 10 pedidos, os de mais ações ativas.');
  });
});

describe('o ano corrente', () => {
  /** O ano vem de fora: o plano é puro e o teste não muda de resultado na virada do ano. */
  it('leva "até agora" embaixo do ano corrente, e "nenhuma" no ano zerado', () => {
    const plano = planoDoPanorama(panorama(), TUDO_DETALHADO, 2026);
    const colunas = de(plano, 'colunas')[0];
    expect(colunas.categorias).toEqual(['2022', '2023', '2024', '2025', '2026']);
    expect(colunas.detalhes).toEqual(['', '', 'nenhuma', '', 'até agora']);
  });

  it('com outro ano corrente, nenhum ano da série está pela metade', () => {
    const colunas = de(planoDoPanorama(panorama(), TUDO_DETALHADO, 2027), 'colunas')[0];
    expect(colunas.detalhes).not.toContain('até agora');
  });

  it('a tendência lê o ano passado como parâmetro', () => {
    // 2022+2023 = 2 contra 2024+2025 = 5 quando 2026 é o corrente: crescendo.
    expect(de(planoDoPanorama(panorama(), TUDO_DETALHADO, 2026), 'colunas')[0].unidade).toBe('ajuizadas · crescendo');
    // Com 2023 como corrente, só há um ano fechado: sem tendência.
    expect(de(planoDoPanorama(panorama(), TUDO_DETALHADO, 2023), 'colunas')[0].unidade).toBe('ajuizadas');
  });

  it('o ano de Teresina, e não o do UTC, na virada', () => {
    expect(anoEmTeresina(new Date('2027-01-01T02:00:00.000Z'))).toBe(2026);
    expect(anoEmTeresina(new Date('2027-01-01T03:00:00.000Z'))).toBe(2027);
  });
});

describe('lista vazia', () => {
  it('as seções saem com o texto de vazio, sem gráfico nem detalhe', () => {
    const plano = planoDoPanorama(panorama({ concentracoes: [], dispersoes: [] }), TUDO_DETALHADO, 2026);
    const tabelas = de(plano, 'tabela');
    expect(tabelas).toHaveLength(2);
    expect(tabelas[0].linhas).toEqual([]);
    expect(tabelas[0].vazio).toBe('Nenhum réu com três ou mais ações ativas repetindo o mesmo pedido.');
    expect(tabelas[1].vazio).toBe('Nenhum pedido repetido em seis ou mais ações ativas contra cinco ou mais réus.');
    expect(de(plano, 'barras')).toHaveLength(0);
    expect(de(plano, 'colunas')).toHaveLength(0);
  });
});

describe('a capa e o arquivo', () => {
  it('o retrato sai no dia e na hora de Teresina', () => {
    const capa = capaDoPanorama(panorama(), { emitidoPor: 'Ana' });
    expect(capa.faixa).toBe('Panorama do acervo · 12/09/2026');
    expect(capa.titulo).toBe(`Panorama do acervo do ${tenant.sigla}`);
    expect(capa.apoio).toBe('Retrato de 12/09/2026 às 22:30 · 149 processos ativos · Emitido por Ana');
    expect(capa.observacao).toBeUndefined();
  });

  it('título e observação digitados entram aparados', () => {
    const capa = capaDoPanorama(panorama(), { emitidoPor: 'Ana', titulo: '  Assembleia  ', observacao: ' Nota. ' });
    expect(capa.titulo).toBe('Assembleia');
    expect(capa.observacao).toBe('Nota.');
  });

  it('o arquivo leva o id da instalação e o dia do retrato', () => {
    expect(arquivoDoPanorama('2026-09-13T01:30:00.000Z')).toBe(`panorama-${tenant.id}-2026-09-12.pdf`);
  });
});

describe('o que o papel nunca leva', () => {
  it('nada que a fonte do PDF não saiba desenhar', () => {
    const plano = planoDoPanorama(panorama(), TUDO_DETALHADO, 2026);
    const capa = capaDoPanorama(panorama(), { emitidoPor: 'Ana' });
    expect(foraDaFontePadrao(JSON.stringify({ capa, plano }))).toEqual([]);
    expect(foraDaFontePadrao(JSON.stringify(planoDoPanorama(panorama(), TUDO_DETALHADO, 2026, { graficos: false })))).toEqual([]);
  });

  /**
   * NENHUM TEXTO RECOMENDA. Mira os textos do plano (a saída), não o fonte:
   * negativa em português bateria nos comentários.
   */
  it('nenhum texto do plano manda fazer ou aconselha', () => {
    const RECOMENDACAO =
      /(^|[^\p{L}])(vale rever|dev(e|em|eria|eriam)|recomend\p{L}*|suger\p{L}*|é preciso|ajuíze|proponha|desista|abandone|recorra)(?![\p{L}])/iu;
    const todas = [concentracao({ leituras: ['DESFECHO_SEMPRE_CONTRA', 'DESFECHO_SEMPRE_A_FAVOR', 'COLETIVA_POSSIVEL', 'REINCIDENCIA'] })];
    for (const graficos of [true, false]) {
      const plano = planoDoPanorama(panorama({ concentracoes: todas }), TUDO_DETALHADO, 2026, { graficos });
      for (const texto of textos(plano)) expect(texto).not.toMatch(RECOMENDACAO);
    }
  });
});

/**
 * O DESENHO AGUENTA O PLANO REAL — com o jsPDF de produção, sem navegador.
 * Coordenada inválida não avisa: sai escrita como "NaN" dentro do arquivo.
 */
describe('o documento desenhado', () => {
  function gerar(p: Panorama, escolhas: EscolhasDoPanorama, graficos = true) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    montarDocumento(doc, autoTable, capaDoPanorama(p, { emitidoPor: 'Ana', observacao: 'Para a reunião.' }), planoDoPanorama(p, escolhas, 2026, { graficos }), null);
    return doc;
  }

  it('tudo detalhado, com e sem gráficos, sem coordenada inválida', () => {
    const cheio = panorama({
      concentracoes: Array.from({ length: 22 }, (_, i) =>
        concentracao({ parteExternaId: `pe-${i}`, adversario: `Empresa ${i}`, tipo: i % 5 ? 'JURIDICA' : 'FISICA' }),
      ),
      dispersoes: Array.from({ length: 10 }, (_, i) =>
        dispersao({ assunto: `Assunto ${i}`, porAno: i === 3 ? [] : dispersao().porAno }),
      ),
    });
    for (const graficos of [true, false]) {
      const doc = gerar(cheio, TUDO_DETALHADO, graficos);
      expect(doc.getNumberOfPages()).toBeGreaterThan(1);
      expect(doc.output()).not.toContain('NaN');
    }
  });

  /** No SINDSERM o acervo pode não ter padrão: sai o aviso e os lados, sem página em branco. */
  it('panorama vazio cabe numa página só', () => {
    const doc = gerar(panorama({ concentracoes: [], dispersoes: [] }), TUDO_DETALHADO);
    expect(doc.getNumberOfPages()).toBe(1);
    const saida = doc.output();
    expect(saida).not.toContain('NaN');
    expect(saida).toContain('Nenhum pedido repetido');
  });
});
