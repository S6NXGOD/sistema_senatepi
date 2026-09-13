import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ESCOLHAS_PADRAO, NOTA_DO_CNJ, planoDoPdf, secaoDisponivel,
  type BlocoDoPdf, type EscolhasDoPdf, type RotulosDoPdf,
} from '@/lib/relatorio-pdf';
import { foraDaFontePadrao } from '@/lib/pdf-graficos';
import {
  fraseDasSentencas, hrefDaComarca, hrefDaParteContraria, hrefDoAssunto, type Relatorio,
} from '@/lib/relatorios';

const TELA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

const rotulos: RotulosDoPdf = {
  tipo: (s) => s, area: (s) => s, canal: (s) => s, assunto: (s) => s, setor: (s) => s,
};

/** Um mês parecido com o de 12/09/2026 — nomes de pessoas inventados. */
const base: Relatorio = {
  periodo: { de: '2026-08-13T03:00:00.000Z', ate: '2026-09-13T03:00:00.000Z' },
  escopo: 'GLOBAL',
  focoUsuario: null,
  equipe: [
    {
      usuarioId: 'u1', nome: 'Dra. Ana', papel: 'ADVOGADO',
      concluidas: 12, abertas: 3, atrasadas: 1, medianaMinutos: 20, cronometradas: 4,
    },
    {
      usuarioId: 'u2', nome: 'Dr. Bruno', papel: 'ADVOGADO',
      concluidas: 0, abertas: 2, atrasadas: 2, medianaMinutos: null, cronometradas: 0,
    },
  ],
  atividades: {
    concluidas: 12, canceladas: 2, abertas: 5, atrasadas: 3, porDesfecho: [],
    porTipo: [{ rotulo: 'PRAZO', total: 5 }], automaticas: 4, manuais: 8,
  },
  processos: {
    cadastrados: 3, distribuidos: 1, ativos: 149, encerrados: 29, semDataDeDistribuicao: 1,
    porArea: [], porTribunal: [],
  },
  atendimentos: {
    registrados: 9, concluidos: 7, filiadosAtendidos: 7, porCanal: [], porAtendente: [],
    porAssunto: [], assuntoNaoInformado: 6, porSetor: [],
  },
  justica: {
    nossoPapel: { autor: 117, representando: 26, reu: 6 },
    institucionais: 117,
    individuais: 32,
    sentencasPorAno: [
      { ano: 2025, procedentes: 9, parciais: 20, improcedentes: 5 },
      { ano: 2026, procedentes: 6, parciais: 13, improcedentes: 8 },
    ],
    ajuizadasPorAno: [
      { ano: 2025, processos: 40 },
      { ano: 2026, processos: 36 },
    ],
    sentencasNoPeriodo: [],
    totalSentencasNoPeriodo: 0,
    adversarios: [],
    comarcas: [],
    temas: [],
  },
  proximos: { dias: 30, audiencias: [], totalAudiencias: 2, prazos: [], totalPrazos: 6 },
  publicacoes: { recebidas: 102, viraramTarefa: 28, dispensadas: 66, esperandoDecisao: 7 },
  robo: { criadas: 39, concluidas: 15, canceladasPeloRobo: 14, canceladasPorPessoas: 2, abertas: 8 },
  geradoEm: '2026-09-12T12:00:00.000Z',
};

const titulos = (blocos: BlocoDoPdf[]) =>
  blocos.flatMap((b) =>
    (b.tipo === 'secao' || b.tipo === 'tabela' || b.tipo === 'barras' || b.tipo === 'colunas') && b.titulo
      ? [b.titulo]
      : [],
  );

/** O tipo do bloco que tem este título — barra, coluna ou tabela. */
const tipoDe = (blocos: BlocoDoPdf[], titulo: string) =>
  blocos.find((b) => 'titulo' in b && b.titulo === titulo)?.tipo;

const TUDO_DETALHADO = Object.fromEntries(
  Object.keys(ESCOLHAS_PADRAO).map((k) => [k, { incluir: true, detalhar: true }]),
) as EscolhasDoPdf;

const com = (mudar: Partial<EscolhasDoPdf>): EscolhasDoPdf => ({ ...ESCOLHAS_PADRAO, ...mudar });

/**
 * "NÃO SERIA INTERESSANTE BAIXAR EM PDF, MARCANDO O QUE QUER DETALHAR?" — pedido
 * de 12/09/2026. A regra de O QUE entra é função pura, e é ela que se prova aqui.
 */
describe('o PDF do relatório', () => {
  it('o resumo entra sempre, mesmo sem nenhuma seção marcada', () => {
    const nada = Object.fromEntries(
      Object.keys(ESCOLHAS_PADRAO).map((k) => [k, { incluir: false, detalhar: false }]),
    ) as EscolhasDoPdf;
    expect(titulos(planoDoPdf(base, nada, rotulos, 2026))).toEqual(['Resumo do período']);
  });

  /**
   * A TABELA POR PESSOA COMEÇA DESLIGADA — a decisão de não fazer placar
   * aplicada ao papel que sai da sala. A coordenação liga quando quer.
   */
  it('a tabela por pessoa só sai quando alguém pede o detalhe da equipe', () => {
    expect(ESCOLHAS_PADRAO.equipe).toEqual({ incluir: true, detalhar: false });
    expect(titulos(planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026))).not.toContain(
      'Por pessoa, em ordem alfabética',
    );
    const detalhado = planoDoPdf(base, com({ equipe: { incluir: true, detalhar: true } }), rotulos, 2026);
    expect(titulos(detalhado)).toContain('Por pessoa, em ordem alfabética');
  });

  it('detalhar sem incluir não põe nada', () => {
    const blocos = planoDoPdf(base, com({ justica: { incluir: false, detalhar: true } }), rotulos, 2026);
    expect(titulos(blocos)).not.toContain('O sindicato na Justiça');
    expect(titulos(blocos)).not.toContain('Contra quem');
  });

  /** O papel sai da sala sem quem saberia explicar os meses fracos: o aviso vai junto. */
  it('a Justiça leva a frase do ano, as tabelas e o aviso do CNJ', () => {
    const blocos = planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026);
    expect(titulos(blocos)).toEqual(
      expect.arrayContaining(['O sindicato na Justiça', 'Sentenças por ano', 'Ações ajuizadas por ano']),
    );
    expect(blocos).toContainEqual({ tipo: 'nota', texto: NOTA_DO_CNJ });
    expect(blocos).toContainEqual({
      tipo: 'texto',
      texto: fraseDasSentencas(base.justica!.sentencasPorAno, 2026),
    });
  });

  /** Seção que a API não mandou não vira escolha, nem página vazia. */
  it('o advogado não recebe publicações, e o PDF não inventa a seção', () => {
    const doAdvogado: Relatorio = { ...base, escopo: 'PESSOAL', publicacoes: null, robo: null };
    expect(secaoDisponivel(doAdvogado, 'publicacoes')).toBe(false);
    const blocos = planoDoPdf(doAdvogado, ESCOLHAS_PADRAO, rotulos, 2026);
    expect(titulos(blocos)).not.toContain('Publicações e robô');
    expect(titulos(blocos)).toContain('Os seus números');
  });

  it('diz de onde vem o prazo: da agenda, e não do tribunal', () => {
    const blocos = planoDoPdf(base, com({ proximos: { incluir: true, detalhar: true } }), rotulos, 2026);
    const notas = blocos.flatMap((b) => (b.tipo === 'nota' ? [b.texto] : []));
    expect(notas.some((t) => t.includes('não o prazo processual'))).toBe(true);
  });

  /**
   * "SINTA-SE LIVRE PARA COLOCAR GRÁFICOS" — 12/09/2026. As contagens viram
   * barras; as listas de gente, não: barra por pessoa é pódio desenhado.
   */
  it('com gráficos, contagem vira barra — e lista de pessoas continua tabela', () => {
    const r: Relatorio = {
      ...base,
      justica: { ...base.justica!, adversarios: [{ chave: 'pi', rotulo: 'Estado do Piauí', total: 12 }] },
      atendimentos: { ...base.atendimentos, porAtendente: [{ rotulo: 'Ivo', total: 4 }] },
    };
    const blocos = planoDoPdf(r, TUDO_DETALHADO, rotulos, 2026);
    expect(tipoDe(blocos, 'Sentenças por ano')).toBe('barras');
    expect(tipoDe(blocos, 'Contra quem')).toBe('barras');
    expect(tipoDe(blocos, 'Por pessoa, em ordem alfabética')).toBe('tabela');
    expect(tipoDe(blocos, 'Por atendente')).toBe('tabela');
  });

  it('sem gráficos, sai em tabela como antes', () => {
    const blocos = planoDoPdf(base, TUDO_DETALHADO, rotulos, 2026, { graficos: false });
    expect(tipoDe(blocos, 'Sentenças por ano')).toBe('tabela');
    expect(blocos.some((b) => b.tipo === 'barras' || b.tipo === 'colunas')).toBe(false);
  });

  /** A barra não esconde número: o total e as três partes, na ordem da legenda. */
  it('cada ano de sentença leva o total e as três partes', () => {
    const barras = planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026).find(
      (b) => b.tipo === 'barras' && b.titulo === 'Sentenças por ano',
    );
    expect(barras).toMatchObject({
      series: [{ nome: 'Procedentes' }, { nome: 'Em parte' }, { nome: 'Improcedentes' }],
      itens: [
        { rotulo: '2025', partes: [9, 20, 5], texto: '34 (9 · 20 · 5)' },
        { rotulo: '2026 (até agora)', partes: [6, 13, 8], texto: '27 (6 · 13 · 8)' },
      ],
    });
  });
});

describe('o PDF comparado com o período anterior', () => {
  const anterior: Relatorio = {
    ...base,
    atividades: { ...base.atividades, concluidas: 9, abertas: 99, atrasadas: 50 },
    atendimentos: { ...base.atendimentos, registrados: 3, filiadosAtendidos: 3 },
    publicacoes: { recebidas: 80, viraramTarefa: 20, dispensadas: 50, esperandoDecisao: 1 },
  };
  const extras = { anterior: { relatorio: anterior, periodo: { de: '2026-07-13', ate: '2026-08-12' } } };
  const tabelaDaComparacao = (blocos: BlocoDoPdf[]) => {
    const i = blocos.findIndex((b) => b.tipo === 'secao' && b.titulo === 'Comparado com o período anterior');
    return i < 0 ? null : (blocos[i + 1] as Extract<BlocoDoPdf, { tipo: 'tabela' }>);
  };

  it('vem colada no resumo, com antes, agora e quanto mudou', () => {
    const blocos = planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026, extras);
    expect(titulos(blocos).slice(0, 2)).toEqual(['Resumo do período', 'Comparado com o período anterior']);
    const linhas = tabelaDaComparacao(blocos)!.linhas;
    expect(linhas).toContainEqual(['Atividades concluídas', '9', '12', '+3']);
    expect(linhas).toContainEqual(['Publicações recebidas', '80', '102', '+28%']);
    expect(linhas).toContainEqual(['Pessoas atendidas', '3', '7', '+4']);
  });

  /** Retrato de hoje pedido para o mês passado volta igual — e "igual" seria mentira. */
  it('só compara o que se conta dentro do período', () => {
    const rotulosDasLinhas = tabelaDaComparacao(planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026, extras))!
      .linhas.map((l) => l[0]);
    expect(rotulosDasLinhas.some((r) => /aberto|atrasad|ativos|esperando|encerrad/i.test(r))).toBe(false);
  });

  it('seção desmarcada não entra na comparação', () => {
    const blocos = planoDoPdf(base, com({ publicacoes: { incluir: false, detalhar: false } }), rotulos, 2026, extras);
    expect(tabelaDaComparacao(blocos)!.linhas.map((l) => l[0])).not.toContain('Publicações recebidas');
  });

  it('sem período anterior, não há comparação', () => {
    expect(tabelaDaComparacao(planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026))).toBeNull();
  });

  it('nada no plano que a fonte do PDF não saiba desenhar', () => {
    const plano = planoDoPdf(base, TUDO_DETALHADO, rotulos, 2026, extras);
    expect(foraDaFontePadrao(JSON.stringify(plano))).toEqual([]);
  });
});

describe('a frase do ano', () => {
  /** "A favor" soma procedente e parcial, mas mostra as duas partes. */
  it('usa o último ano fechado e mostra as duas procedências', () => {
    expect(fraseDasSentencas(base.justica!.sentencasPorAno, 2026)).toBe(
      'Em 2025, 29 de 34 sentenças foram a favor, ao menos em parte (9 por inteiro e 20 em parte).',
    );
  });

  it('sem ano fechado com sentença, não inventa frase', () => {
    expect(
      fraseDasSentencas([{ ano: 2026, procedentes: 3, parciais: 0, improcedentes: 0 }], 2026),
    ).toBeNull();
  });
});

describe('a tela de relatórios', () => {
  /** O sistema conhece a data da agenda, não o prazo processual. */
  it('não escreve mais "com prazo vencido"', () => {
    expect(TELA).not.toContain('com prazo vencido');
  });

  it('o PDF abre a escolha de seções, e a planilha continua', () => {
    expect(TELA).toContain('<EscolherPdf');
    expect(TELA).toContain('Baixar PDF');
    expect(TELA).toContain('baixarCsvDaEquipe(de, ate, foco || undefined)');
    expect(TELA).toContain("onChange={() => alternar(s.chave, 'detalhar')}");
  });

  /** Com o foco numa pessoa, a API manda uma linha só — e o seletor sumia junto. */
  it('o seletor de pessoa não some quando há foco', () => {
    expect(TELA).toContain("if (data && data.escopo === 'GLOBAL' && !data.focoUsuario) {");
    expect(TELA).toContain("{aba === 'sindicato' && !pessoal && pessoas.length > 1 && (");
  });

  /** Número que muda quando se clica nele é pior que número nenhum. */
  it('as linhas do acervo abrem a lista com o recorte que contaram', () => {
    expect(TELA).toContain('href="/processos?nossoPapel=AUTOR&status=ATIVO"');
    expect(TELA).toContain('href={hrefDaParteContraria}');
    expect(TELA).toContain('href={hrefDaComarca}');
    expect(TELA).toContain('href={hrefDoAssunto}');
    expect(hrefDaComarca({ chave: '2211001', rotulo: 'Teresina', total: 68 })).toBe(
      '/processos?comarca=2211001&comarcaNome=Teresina&status=ATIVO',
    );
    expect(hrefDaParteContraria({ chave: 'abc', rotulo: 'HAPVIDA', total: 7 })).toBe(
      '/processos?parteExternaId=abc&status=ATIVO',
    );
    expect(hrefDoAssunto({ rotulo: 'Piso Salarial', total: 16 })).toBe(
      '/processos?assunto=Piso%20Salarial&status=ATIVO',
    );
  });

  it('a fila de publicações leva à busca já filtrada', () => {
    expect(TELA).toContain('href="/publicacoes?situacao=SEM_DECISAO"');
  });
});
