import { inflateSync } from 'node:zlib';
import { PoloProcesso, StatusProcesso, TipoAcaoProcesso } from '@prisma/client';
import { rodapeInstitucional, tenant } from '../../tenant/tenant.config';
import { PartesService } from './partes.service';
import {
  DossieProcessoService,
  GRAFITE,
  MAX_ANDAMENTOS,
  avisoDoCorte,
  corInstitucional,
  ordenarAtuacao,
  planejarDossie,
  rotuloDaSituacao,
  rotuloDoGrau,
  sanear,
  tempoDeTramitacao,
  type ProcessoDoDossie,
} from './dossie-processo.service';

/**
 * O DOSSIÊ, DESENHADO DE VERDADE.
 *
 * Nenhum teste renderizava este PDF — e era por isso que o rodapé saía
 * carimbado quatro vezes por folha sem ninguém ver. `toContain` no fonte prova
 * que a linha existe, não que ela acerta; então aqui o PDF é gerado, o
 * conteúdo de cada página é extraído do arquivo e as asserções são sobre o que
 * o filiado leria no papel.
 *
 * COMO O TEXTO É LIDO. O PDFKit escreve cada página num objeto `stream`
 * comprimido (Flate), e dentro dele o texto sai em vetores `[<hex> kern <hex>] TJ`
 * — o kerning parte a palavra em pedaços, todos dentro do MESMO vetor. Basta
 * descomprimir, juntar os pedaços de cada vetor e decodificar em WinAnsi (que é
 * a codificação das fontes padrão). Um stream por página, na ordem das páginas.
 */

/**
 * WinAnsi 0x80–0x9F, a faixa em que ela NÃO coincide com o Latin-1.
 *
 * É onde moram o travessão e as reticências — e sem esta tabela o teste lia
 * "Ganho  Execução" e dava o rótulo por errado, quando quem estava errado era
 * o leitor.
 */
const WIN_ANSI_ALTO: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

const deWinAnsi = (bytes: Buffer): string =>
  [...bytes].map((b) => WIN_ANSI_ALTO[b] ?? String.fromCharCode(b)).join('');

interface PaginaLida {
  /** Cada `text()` que a página desenhou, na ordem em que saiu. */
  textos: string[];
  /** Tudo junto, uma linha desenhada por linha de texto. */
  tudo: string;
  /**
   * A mesma página em fluxo corrido. Cada LINHA desenhada é um vetor próprio no
   * arquivo, então uma frase que o parágrafo quebrou ao meio não existe em
   * `tudo` — e procurá-la ali reprovaria um texto que está impresso e certo.
   */
  corrido: string;
  /** As cores de preenchimento usadas na página, em hexadecimal. */
  cores: string[];
}

function lerPdf(pdf: Buffer): PaginaLida[] {
  const bruto = pdf.toString('latin1');
  const paginas: PaginaLida[] = [];
  const marcador = /stream\r?\n/g;
  let achado: RegExpExecArray | null;
  while ((achado = marcador.exec(bruto))) {
    const inicio = achado.index + achado[0].length;
    const fim = bruto.indexOf('endstream', inicio);
    if (fim < 0) continue;
    let conteudo: string;
    try {
      conteudo = inflateSync(pdf.subarray(inicio, fim)).toString('latin1');
    } catch {
      continue; // não é um fluxo de conteúdo (fonte embutida, metadados…)
    }
    const textos = [...conteudo.matchAll(/\[((?:\s*(?:<[0-9a-fA-F]*>|-?[\d.]+)\s*)*)\]\s*TJ/g)].map((v) =>
      [...v[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => deWinAnsi(Buffer.from(h[1], 'hex'))).join(''),
    );
    if (!textos.length && !/\b(?:rg|scn)\b/.test(conteudo)) continue;
    // O PDFKit 0.15 escreve a cor como `/DeviceRGB cs … scn`; versões antigas,
    // como `… rg`. As duas formas contam.
    const cores = [...conteudo.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:rg|scn)\b/g)].map(
      (c) =>
        '#' +
        [c[1], c[2], c[3]]
          .map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, '0').toUpperCase())
          .join(''),
    );
    paginas.push({
      textos,
      tudo: textos.join('\n'),
      corrido: textos.join(' ').replace(/\s+/g, ' '),
      cores,
    });
  }
  return paginas;
}

/** Quantas vezes o trecho aparece na página. */
const vezes = (pagina: PaginaLida, trecho: string) =>
  pagina.textos.filter((t) => t.includes(trecho)).length;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const NPU = '00108235920255220001';
const NPU_FORMATADO = '0010823-59.2025.5.22.0001';

const dia = (iso: string) => new Date(`${iso}T14:00:00.000Z`);

function processoBase(): ProcessoDoDossie {
  return {
    numeroCNJ: NPU,
    titulo: null,
    classeProcessual: 'Ação Trabalhista - Rito Ordinário',
    assuntoPrincipal: 'Adicional de Insalubridade',
    tribunal: 'TRT22',
    orgaoJulgador: '2ª Vara do Trabalho de Teresina',
    dataDistribuicao: dia('2024-05-14'),
    statusInterno: 'GANHO_EXECUCAO' as StatusProcesso,
    categoria: 'Trabalhista',
    grau: 'G1',
    formato: 'Eletrônico',
    nivelSigilo: 0,
    segredoJustica: false,
    tipoAcao: 'INDIVIDUAL' as TipoAcaoProcesso,
    ultimoMovimentoEm: dia('2026-09-02'),
    createdAt: dia('2024-05-20'),
    filiado: { nomeCompleto: 'Maria das Graças Oliveira', matricula: '0042' },
    solicitadoPor: null,
    instancias: [
      { grau: 'G1', tribunal: 'TRT22', baixada: false, orgaoJulgador: '2ª Vara do Trabalho de Teresina' },
      { grau: 'G2', tribunal: 'TRT22', baixada: true, orgaoJulgador: 'Tribunal Pleno' },
    ],
    advogados: [
      {
        principal: true,
        advogado: { nome: 'Shérad Almeida', nomeExibicao: 'Dra. Shérad', oab: '12345', oabUf: 'PI' },
      },
      {
        principal: false,
        advogado: { nome: 'João Pedro Pinto', nomeExibicao: null, oab: '54321', oabUf: 'PI' },
      },
    ],
    partes: [
      {
        nome: 'Maria das Graças Oliveira',
        polo: 'ATIVO' as PoloProcesso,
        papel: null,
        principal: true,
        filiadoId: 'fil-1',
        parteExterna: null,
      },
      {
        nome: 'HOSPITAL GETÚLIO VARGAS',
        polo: 'PASSIVO' as PoloProcesso,
        papel: null,
        principal: true,
        filiadoId: null,
        parteExterna: { institucional: false },
      },
      {
        nome: 'MINISTÉRIO PÚBLICO DO TRABALHO',
        polo: 'TERCEIRO' as PoloProcesso,
        papel: 'Custos legis',
        principal: false,
        filiadoId: null,
        parteExterna: { institucional: false },
      },
    ],
    movimentacoes: [
      {
        dataMovimento: dia('2026-09-02'),
        descricao: 'Conclusão',
        detalhe: 'para despacho',
        instancia: { grau: 'G1' },
      },
      {
        dataMovimento: dia('2026-07-11'),
        descricao: 'Publicação de acórdão',
        detalhe: null,
        instancia: { grau: 'G2' },
      },
    ],
    movimentacoesInternas: [
      {
        // Lançada DEPOIS, mas o fato é mais antigo: é o par que expunha a ordem.
        dataFato: dia('2026-06-02'),
        createdAt: dia('2026-08-30'),
        descricao: 'Audiência de instrução realizada na 2ª Vara',
        tipo: 'audiencia',
      },
      {
        dataFato: dia('2026-08-20'),
        createdAt: dia('2026-08-20'),
        descricao: 'Petição de cumprimento de sentença protocolada',
        tipo: 'peticao',
      },
    ],
  };
}

interface Cenario {
  processo?: Partial<ProcessoDoDossie>;
  totalAndamentos?: number;
  totalAtuacao?: number;
  execucao?: number;
  cor?: string | null;
  autor?: string | null;
}

/**
 * O serviço inteiro, com um Prisma de mentira. Não é mock de método do próprio
 * serviço: o que entra é dado, e o que sai é o PDF que a rota devolveria.
 */
function servico(c: Cenario = {}) {
  const processo = { ...processoBase(), ...c.processo };
  const prisma = {
    processo: { findUnique: jest.fn().mockResolvedValue(processo) },
    movimentacaoProcessual: {
      count: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(where.codigoMovimento ? (c.execucao ?? 1) : (c.totalAndamentos ?? processo.movimentacoes.length)),
      ),
    },
    movimentacaoInterna: {
      count: jest.fn().mockResolvedValue(c.totalAtuacao ?? processo.movimentacoesInternas.length),
    },
    tipoAndamento: {
      findMany: jest.fn().mockResolvedValue([
        { slug: 'audiencia', nome: 'Audiência' },
        { slug: 'peticao', nome: 'Petição' },
      ]),
    },
    identidadeVisual: {
      findUnique: jest.fn().mockResolvedValue(c.cor === undefined ? null : { corPrimaria: c.cor }),
    },
  };
  const partes = new PartesService(prisma as never, {} as never);
  return { service: new DossieProcessoService(prisma as never, partes), prisma, processo };
}

async function gerar(c: Cenario = {}) {
  const { service } = servico(c);
  const doc = await service.gerar('proc-1', c.autor ?? 'Dra. Shérad');
  return { ...doc, paginas: lerPdf(doc.pdf) };
}

/** Um acervo grande o bastante para o documento passar de uma folha. */
function muitosAndamentos(n: number): ProcessoDoDossie['movimentacoes'] {
  return Array.from({ length: n }, (_, i) => ({
    dataMovimento: new Date(Date.UTC(2026, 8, 1, 14) - i * 86_400_000 * 3),
    descricao: 'Expedição de documento',
    detalhe: `Intimação nº ${1000 + i} — remessa dos autos à contadoria judicial para cálculo`,
    instancia: { grau: i % 2 === 0 ? 'G1' : 'G2' },
  }));
}

// ---------------------------------------------------------------------------

describe('o dossiê carimba o rodapé UMA VEZ por página', () => {
  it('um documento de várias folhas tem um rodapé e uma numeração em cada uma', async () => {
    const { paginas } = await gerar({
      processo: { movimentacoes: muitosAndamentos(MAX_ANDAMENTOS) },
      totalAndamentos: MAX_ANDAMENTOS,
    });

    expect(paginas.length).toBeGreaterThan(1);
    const total = paginas.length;

    for (const [i, pagina] of paginas.entries()) {
      // O texto institucional do rodapé, uma vez só. Quatro chamadas por folha
      // (o defeito antigo) imprimiam quatro linhas sobrepostas.
      expect(`folha ${i + 1}: ${vezes(pagina, `DIRETORIA ${tenant.sigla}`)}`).toBe(`folha ${i + 1}: 1`);
      expect(`folha ${i + 1}: ${vezes(pagina, `Página ${i + 1} de ${total}`)}`).toBe(`folha ${i + 1}: 1`);
    }
  });

  /**
   * O rodapé do SENATEPI tem endereço, dois telefones e e-mail: em 6,5pt ele
   * não cabe em 495 pontos e o PDFKit quebrava em duas linhas — a segunda em
   * cima do "Página N de T", escrito 14 pontos abaixo. `lineBreak: false` não
   * impede a quebra; quem impede é a letra encolher até caber.
   */
  it('o rodapé sai numa linha só, sem atropelar a numeração', async () => {
    const { paginas } = await gerar();
    const inteiro = rodapeInstitucional();
    for (const [i, pagina] of paginas.entries()) {
      // O rodapé INTEIRO num único desenho de texto. Em duas linhas, o endereço
      // ficaria num pedaço e os contatos noutro — e o segundo em cima do
      // "Página N de T".
      expect(`folha ${i + 1}: ${pagina.textos.filter((t) => t === inteiro).length}`).toBe(
        `folha ${i + 1}: 1`,
      );
    }
  });

  it('a numeração conta o total certo — nenhuma folha diz "de 1" num documento de várias', async () => {
    const { paginas } = await gerar({
      processo: { movimentacoes: muitosAndamentos(MAX_ANDAMENTOS) },
      totalAndamentos: 203,
    });
    const total = paginas.length;
    const numeracoes = paginas.flatMap((p) => p.textos.filter((t) => t.startsWith('Página ')));
    expect(numeracoes).toEqual(paginas.map((_, i) => `Página ${i + 1} de ${total}`));
  });
});

describe('toda página tem identidade', () => {
  it('o documento passa de uma folha e todas trazem sindicato e número do processo', async () => {
    const { paginas } = await gerar({
      processo: { movimentacoes: muitosAndamentos(MAX_ANDAMENTOS) },
      totalAndamentos: 203,
    });

    expect(paginas.length).toBeGreaterThan(1);
    for (const [i, pagina] of paginas.entries()) {
      expect(`folha ${i + 1} tem o NPU: ${pagina.tudo.includes(NPU_FORMATADO)}`).toBe(
        `folha ${i + 1} tem o NPU: true`,
      );
      expect(`folha ${i + 1} tem a sigla: ${pagina.tudo.includes(tenant.sigla)}`).toBe(
        `folha ${i + 1} tem a sigla: true`,
      );
    }
  });

  it('o segredo de justiça é marcado na capa E nas folhas seguintes', async () => {
    const { paginas } = await gerar({
      processo: { segredoJustica: true, movimentacoes: muitosAndamentos(MAX_ANDAMENTOS) },
      totalAndamentos: MAX_ANDAMENTOS,
    });
    expect(paginas.length).toBeGreaterThan(1);
    for (const [i, pagina] of paginas.entries()) {
      expect(`folha ${i + 1}: ${pagina.tudo.includes('SEGREDO DE JUSTIÇA')}`).toBe(`folha ${i + 1}: true`);
    }
  });

  it('processo público não ganha a tarja', async () => {
    const { paginas } = await gerar();
    expect(paginas.some((p) => p.tudo.includes('SEGREDO DE JUSTIÇA'))).toBe(false);
  });

  it('nivelSigilo acima de zero vale tanto quanto a flag', async () => {
    const { paginas } = await gerar({ processo: { nivelSigilo: 2, segredoJustica: false } });
    expect(paginas[0].tudo).toContain('SEGREDO DE JUSTIÇA');
  });
});

describe('o filiado lê português, não enum', () => {
  it('a situação sai por extenso', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('Ganho — Execução');
    expect(tudo).not.toContain('GANHO_EXECUCAO');
    expect(tudo).not.toContain('GANHO EXECUCAO');
  });

  it('o caso ainda não ajuizado sai como "Pré-processual" nos DOIS rótulos do banco', async () => {
    for (const status of ['PRE_PROCESSUAL', 'RASCUNHO']) {
      const { paginas } = await gerar({
        processo: { statusInterno: status as StatusProcesso, numeroCNJ: null, titulo: 'Caso do adicional noturno' },
      });
      const tudo = paginas.map((p) => p.tudo).join('\n');
      expect(`${status}: ${tudo.includes('Pré-processual')}`).toBe(`${status}: true`);
      expect(`${status}: ${tudo.includes('PRE PROCESSUAL')}`).toBe(`${status}: false`);
      expect(`${status}: ${tudo.includes('RASCUNHO')}`).toBe(`${status}: false`);
    }
  });

  it('o grau do andamento sai como "1º grau", não como "G1"', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('1º grau');
    expect(tudo).toContain('2º grau');
    // "TRT22 · G1" era o que ia impresso na linha do tribunal.
    expect(tudo).not.toContain('· G1');
    expect(tudo).not.toContain('TRT22 · G1');
  });

  it('o tipo do registro da equipe sai com o nome cadastrado, não com o slug', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('Audiência');
    expect(tudo).toContain('Petição');
    expect(tudo).not.toContain('peticao');
  });
});

describe('o corte não é silencioso', () => {
  it('avisa quantos andamentos ficaram de fora e até que data vai a relação', async () => {
    const { paginas } = await gerar({
      processo: { movimentacoes: muitosAndamentos(MAX_ANDAMENTOS) },
      totalAndamentos: 203,
    });
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain(`Há mais ${203 - MAX_ANDAMENTOS} andamentos antes de`);
    expect(tudo).toContain(`Esta relação traz os ${MAX_ANDAMENTOS} mais recentes`);
  });

  it('avisa também quando o que ficou de fora é a atuação da casa', async () => {
    const { paginas } = await gerar({ totalAtuacao: 9 });
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('Há mais 7 registros de atuação antes de');
  });

  it('nada a avisar quando o documento traz tudo', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).not.toContain('Há mais');
  });

  it('o aviso é uma frase, e conta certo o caso de um só', () => {
    expect(avisoDoCorte(2, 1, '01/01/2026', { singular: 'andamento', plural: 'andamentos' })).toContain(
      'Há mais 1 andamento antes de 01/01/2026',
    );
    expect(avisoDoCorte(1, 1, '01/01/2026', { singular: 'andamento', plural: 'andamentos' })).toBeNull();
    expect(avisoDoCorte(0, 0, '', { singular: 'andamento', plural: 'andamentos' })).toBeNull();
  });
});

describe('as partes de TODOS os polos', () => {
  it('o terceiro interessado aparece — era ele que sumia', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('MINISTÉRIO PÚBLICO DO TRABALHO');
    expect(tudo).toContain('Terceiros e intervenientes');
    expect(tudo).toContain('Custos legis');
  });

  it('quem é o filiado e quem é o sindicato vem escrito ao lado do nome', async () => {
    const { paginas } = await gerar({
      processo: {
        partes: [
          {
            nome: tenant.nome,
            polo: 'ATIVO' as PoloProcesso,
            papel: null,
            principal: true,
            filiadoId: null,
            parteExterna: { institucional: true },
          },
          {
            nome: 'Maria das Graças Oliveira',
            polo: 'PASSIVO' as PoloProcesso,
            papel: null,
            principal: true,
            filiadoId: 'fil-1',
            parteExterna: null,
          },
        ],
      },
    });
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain(`(o ${tenant.sigla})`);
    expect(tudo).toContain(`(${tenant.vocabulario.filiado})`);
  });

  it('processo sem partes vira UMA LINHA, não uma seção vazia', async () => {
    const { paginas } = await gerar({ processo: { partes: [] } });
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('Nenhuma parte cadastrada neste processo até esta data.');
    expect(tudo).not.toContain('Polo ativo');
  });
});

describe('quem responde pelo caso', () => {
  it('o responsável é o principal da equipe, e o resto da equipe aparece junto', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('Advogado responsável');
    expect(tudo).toContain('Dra. Shérad (OAB 12345/PI)');
    expect(tudo).toContain('João Pedro Pinto (OAB 54321/PI)');
  });

  it('o principal vence a ordem em que os advogados chegaram', async () => {
    const plano = planejarDossie({
      processo: {
        ...processoBase(),
        advogados: [
          { principal: false, advogado: { nome: 'Primeiro Citado', nomeExibicao: null, oab: null, oabUf: null } },
          { principal: true, advogado: { nome: 'Dona do Caso', nomeExibicao: null, oab: null, oabUf: null } },
        ],
      },
      polos: { ativo: [], passivo: [], terceiros: [] },
      totalAndamentos: 0,
      totalAtuacao: 0,
      temMovimentoDeExecucao: false,
      nomeDosTipos: new Map(),
      agora: dia('2026-09-18'),
    });
    expect(plano.equipe[0]).toEqual({ rotulo: 'Advogado responsável', valor: 'Dona do Caso' });
  });
});

describe('a atuação sai na ordem em que o papel a mostra', () => {
  it('ordena pela data do FATO, não pela do registro', () => {
    const lista = [
      { dataFato: null, createdAt: dia('2026-01-05'), n: 'sem data do fato' },
      { dataFato: dia('2026-03-01'), createdAt: dia('2026-01-02'), n: 'fato de março' },
      { dataFato: dia('2026-02-01'), createdAt: dia('2026-09-09'), n: 'fato de fevereiro' },
    ];
    expect(ordenarAtuacao(lista).map((x) => x.n)).toEqual([
      'fato de março',
      'fato de fevereiro',
      'sem data do fato',
    ]);
  });

  it('no PDF, a linha de agosto vem antes da de junho', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    const agosto = tudo.indexOf('Petição de cumprimento de sentença protocolada');
    const junho = tudo.indexOf('Audiência de instrução realizada na 2ª Vara');
    expect(agosto).toBeGreaterThanOrEqual(0);
    expect(junho).toBeGreaterThan(agosto);
  });

  it('a data impressa é a do fato', async () => {
    const { paginas } = await gerar();
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('02/06/2026'); // dataFato
    expect(tudo).not.toContain('30/08/2026'); // createdAt
  });
});

describe('a capa responde em cinco segundos', () => {
  it('traz situação, fase, tempo de tramitação e último movimento', async () => {
    const { paginas } = await gerar();
    const capa = paginas[0].tudo;
    expect(capa).toContain('SITUAÇÃO NO SINDICATO');
    expect(capa).toContain('FASE NO TRIBUNAL');
    expect(capa).toContain('TRAMITA HÁ');
    expect(capa).toContain('ÚLTIMO MOVIMENTO');
    expect(capa).toContain('ACOMPANHAMENTO PROCESSUAL');
    expect(capa).toContain(NPU_FORMATADO);
  });

  it('sem distribuição, a célula conta desde o cadastro em vez de mostrar um traço', async () => {
    const { paginas } = await gerar({
      processo: {
        statusInterno: 'PRE_PROCESSUAL' as StatusProcesso,
        numeroCNJ: null,
        titulo: 'Insalubridade — negociação com a FMS',
        dataDistribuicao: null,
        createdAt: dia('2026-06-18'),
      },
    });
    expect(paginas[0].tudo).toContain('NO SINDICATO HÁ');
    expect(paginas[0].tudo).not.toContain('TRAMITA HÁ');

    // O valor da célula, com o relógio fixo (a data de hoje não pode reprovar).
    const plano = planejarDossie({
      processo: { ...processoBase(), dataDistribuicao: null, createdAt: dia('2026-06-18') },
      polos: { ativo: [], passivo: [], terceiros: [] },
      totalAndamentos: 0,
      totalAtuacao: 0,
      temMovimentoDeExecucao: false,
      nomeDosTipos: new Map(),
      agora: dia('2026-09-18'),
    });
    expect(plano.resumo[2]).toEqual({ rotulo: 'No sindicato há', valor: '3 meses' });
  });

  it('o tempo de tramitação é dito em português', () => {
    expect(tempoDeTramitacao(dia('2024-05-14'), dia('2026-09-18'))).toBe('2 anos e 4 meses');
    expect(tempoDeTramitacao(dia('2025-09-18'), dia('2026-09-18'))).toBe('1 ano');
    expect(tempoDeTramitacao(dia('2026-07-18'), dia('2026-09-18'))).toBe('2 meses');
    expect(tempoDeTramitacao(dia('2026-09-10'), dia('2026-09-18'))).toBe('8 dias');
    expect(tempoDeTramitacao(dia('2026-09-18'), dia('2026-09-18'))).toBe('hoje');
    expect(tempoDeTramitacao(null, dia('2026-09-18'))).toBe('—');
  });

  /**
   * O contêiner roda em UTC (o jest também — ver `jest.config.js`). Um processo
   * distribuído às 22h de Teresina é 01:00 do dia seguinte em UTC: contar em
   * milissegundos crus daria um dia a mais de tramitação.
   */
  it('o dia é o de Teresina, não o do contêiner', () => {
    const noiteDaqui = new Date('2026-09-17T23:30:00-03:00'); // 17/09 aqui, 18/09 em UTC
    expect(tempoDeTramitacao(noiteDaqui, new Date('2026-09-18T12:00:00-03:00'))).toBe('1 dia');
  });

  it('a fase de execução é reconhecida pelos andamentos do CNJ', async () => {
    const { paginas } = await gerar({ execucao: 3 });
    expect(paginas[0].tudo).toContain('Execução');
  });
});

describe('a cor é da instalação, nunca a do primeiro cliente', () => {
  /**
   * A QUEDA É A COR DA CASA, NÃO UM CINZA — conserto do mesmo dia (18/09/2026).
   *
   * A primeira versão caía no grafite quando não havia linha em
   * `identidade_visual`, com o argumento de que documento sem cor é problema
   * visível e documento na cor errada passa despercebido. O argumento vale
   * contra CRAVAR o verde do primeiro cliente — e não contra ler a cor do
   * `tenant.config` do cliente que está rodando.
   *
   * O que decidiu foi o dado: a produção do SENATEPI NÃO TEM linha em
   * `identidade_visual`. Com o grafite, o efeito real seria o dossiê perder o
   * verde que sempre teve, sem ninguém ter pedido.
   */
  it('sem cor gravada, a faixa usa a cor DA CASA que está rodando', async () => {
    const { paginas } = await gerar({ cor: null });
    expect(paginas[0].cores).toContain(tenant.corInstitucional.toUpperCase());
    expect(paginas[0].cores).not.toContain(GRAFITE);
  });

  /** E nunca a de OUTRO cliente: é o defeito que abriu este bloco. */
  it('a cor de outro sindicato não aparece no papel deste', async () => {
    const outra = tenant.id === 'senatepi' ? '#0F4C81' : '#1B7F0A';
    const { paginas } = await gerar({ cor: null });
    expect(paginas[0].cores).not.toContain(outra);
  });

  it('a cor escolhida na tela chega ao papel', async () => {
    const { paginas } = await gerar({ cor: '#0F4C81' });
    expect(paginas[0].cores).toContain('#0F4C81');
    expect(paginas[0].cores).not.toContain(GRAFITE);
  });

  it('cor clara demais é escurecida — a faixa leva logo e texto BRANCOS', () => {
    expect(corInstitucional('#FFE066')).not.toBe('#FFE066');
    const escurecida = corInstitucional('#FFE066');
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(escurecida.slice(i, i + 2), 16));
    expect((0.299 * r + 0.587 * g + 0.114 * b) / 255).toBeLessThanOrEqual(0.56);
  });

  it('cor escura passa intacta, e lixo cai na cor da casa', () => {
    expect(corInstitucional('#0F4C81')).toBe('#0F4C81');
    expect(corInstitucional('0f4c81')).toBe('#0F4C81');
    // Sem escolha e com lixo dão o mesmo: a casa. O grafite é a última rede,
    // para uma instalação futura que não declare cor nenhuma.
    expect(corInstitucional(null)).toBe(tenant.corInstitucional.toUpperCase());
    expect(corInstitucional('verde')).toBe(tenant.corInstitucional.toUpperCase());
    expect(GRAFITE).toBe('#1F2937');
  });

  it('a consulta da cor pode falhar sem derrubar o dossiê', async () => {
    const { service, prisma } = servico();
    prisma.identidadeVisual.findUnique.mockRejectedValue(new Error('banco fora do ar'));
    const doc = await service.gerar('proc-1', null);
    expect(lerPdf(doc.pdf)[0].cores).toContain(GRAFITE);
  });
});

describe('o que o dossiê NUNCA leva', () => {
  it('nota interna e papelada do robô ficam de fora já na consulta', async () => {
    const { prisma, service } = servico();
    await service.gerar('proc-1', null);
    const select = prisma.processo.findUnique.mock.calls[0][0].select;
    expect(select.movimentacoesInternas.where).toEqual({ notaInterna: false, origemSistema: false });
  });

  it('a advertência sobre o atraso do CNJ fecha o documento', async () => {
    const { paginas } = await gerar();
    const corrido = paginas.map((p) => p.corrido).join(' ');
    expect(corrido).toContain('a ausência de um ato nesta relação não significa que ele não tenha ocorrido');
    expect(corrido).toContain('não contém a avaliação interna da equipe sobre o caso');
  });
});

describe('o documento curto continua curto', () => {
  it('processo sem andamento nenhum cabe numa folha e diz que não há', async () => {
    const { paginas } = await gerar({
      processo: { movimentacoes: [], movimentacoesInternas: [] },
      totalAndamentos: 0,
      totalAtuacao: 0,
    });
    expect(paginas).toHaveLength(1);
    expect(paginas[0].tudo).toContain('Nenhum andamento registrado na base pública até esta data.');
    expect(paginas[0].tudo).toContain('Sem registros de atuação lançados até esta data.');
  });

  it('o nome do arquivo leva o número do processo', async () => {
    const { nomeArquivo } = await gerar();
    expect(nomeArquivo).toContain('dossie');
    expect(nomeArquivo.endsWith('.pdf')).toBe(true);
  });
});

describe('texto que a fonte do PDF não sabe desenhar', () => {
  it('acento passa; seta e emoji não somem em silêncio', () => {
    expect(sanear('Adicional de insalubridade — 2ª Vara')).toBe('Adicional de insalubridade — 2ª Vara');
    expect(sanear('remessa → contadoria')).toBe('remessa -> contadoria');
    expect(sanear('prazo ✅ cumprido')).toBe('prazo cumprido');
    expect(sanear('linha um\nlinha dois')).toBe('linha um linha dois');
    expect(sanear(null)).toBe('');
  });

  it('a descrição do tribunal com emoji não deixa um buraco na tabela', async () => {
    const { paginas } = await gerar({
      processo: {
        movimentacoes: [
          {
            dataMovimento: dia('2026-09-02'),
            descricao: '✅ Juntada de petição',
            detalhe: 'remessa → contadoria',
            instancia: { grau: 'G1' },
          },
        ],
      },
    });
    const tudo = paginas.map((p) => p.tudo).join('\n');
    expect(tudo).toContain('Juntada de petição — remessa -> contadoria');
  });
});

describe('rótulos, um a um', () => {
  it('a situação desconhecida não vira grito de enum', () => {
    expect(rotuloDaSituacao('ATIVO')).toBe('Ativo');
    expect(rotuloDaSituacao('COISA_NOVA')).toBe('coisa nova');
    expect(rotuloDaSituacao(null)).toBe('—');
  });

  it('o grau desconhecido volta como veio, para avisar que apareceu coisa nova', () => {
    expect(rotuloDoGrau('G1')).toBe('1º grau');
    expect(rotuloDoGrau('g2')).toBe('2º grau');
    expect(rotuloDoGrau('TR')).toBe('Turma Recursal');
    expect(rotuloDoGrau('XYZ')).toBe('XYZ');
    expect(rotuloDoGrau(null)).toBe('');
  });
});
