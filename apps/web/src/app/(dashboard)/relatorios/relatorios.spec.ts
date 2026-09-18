import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ESCOLHAS_PADRAO, NOTA_DO_CNJ, planoDoPdf, secaoDisponivel,
  type BlocoDoPdf, type EscolhasDoPdf, type RotulosDoPdf,
} from '@/lib/relatorio-pdf';
import { foraDaFontePadrao } from '@/lib/pdf-graficos';
import {
  LEGENDA_PELA_CONSULTA, OUTROS_NA_FRASE, fraseDasSentencas, fraseDosOutrosAssuntos, hrefDaComarca, hrefDaParteContraria,
  hrefDoAssunto, rotuloDosConcluidos, type Relatorio,
} from '@/lib/relatorios';

const TELA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

const rotulos: RotulosDoPdf = {
  tipo: (s) => s, area: (s) => s, canal: (s) => s, assunto: (s) => s, setor: (s) => s,
  motivoDesfiliacao: (s) => s,
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

/**
 * E7 (15/09/2026): o atendimento encaminhado passa a fechar sozinho quando a
 * consulta nascida dele é registrada, e "concluídos" soma os dois caminhos.
 */
describe('os concluídos pela consulta', () => {
  // De 01/09 a 15/09/2026 inteiro: o fim, exclusivo, é a meia-noite de 16/09 em Teresina.
  const setembro = { de: '2026-09-01T03:00:00.000Z', ate: '2026-09-16T03:00:00.000Z' };
  const com = (concluidosPelaConsulta: number | undefined, periodo = setembro) => ({
    periodo,
    atendimentos: { ...base.atendimentos, concluidosPelaConsulta },
  });

  it('o rótulo diz quantos vieram pela consulta, e a legenda desde quando', () => {
    expect(rotuloDosConcluidos(com(3))).toEqual({ rotulo: 'Concluídos (pela consulta: 3)', legenda: LEGENDA_PELA_CONSULTA });
    expect(LEGENDA_PELA_CONSULTA).toContain('desde 15/09/2026');
    // Zero depois de 15/09 é número medido: sai.
    expect(rotuloDosConcluidos(com(0)).rotulo).toBe('Concluídos (pela consulta: 0)');
  });

  it('API de antes, ou período que termina antes de 15/09/2026: só "Concluídos", sem zero que ninguém mediu', () => {
    expect(rotuloDosConcluidos(com(undefined))).toEqual({ rotulo: 'Concluídos', legenda: null });
    const ate14 = { de: '2026-09-01T03:00:00.000Z', ate: '2026-09-15T03:00:00.000Z' };
    expect(rotuloDosConcluidos(com(0, ate14))).toEqual({ rotulo: 'Concluídos', legenda: null });
  });

  it('período até 14/09 com um fechado pela consulta: o rótulo sai, na tela e no PDF (15/09/2026)', () => {
    // O #14, criado em 14/09 e fechado pela consulta de 17/09, conta nos concluídos de 01 a 14/09.
    const ate14 = { de: '2026-09-01T03:00:00.000Z', ate: '2026-09-15T03:00:00.000Z' };
    expect(rotuloDosConcluidos(com(1, ate14))).toEqual({ rotulo: 'Concluídos (pela consulta: 1)', legenda: LEGENDA_PELA_CONSULTA });
    const blocos = planoDoPdf({ ...base, ...com(1, ate14) }, ESCOLHAS_PADRAO, rotulos, 2026);
    const i = blocos.findIndex((b) => b.tipo === 'secao' && b.titulo === 'Atendimento ao filiado');
    expect(blocos[i + 1]).toMatchObject({
      tipo: 'numeros',
      itens: expect.arrayContaining([expect.objectContaining({ rotulo: 'Concluídos (pela consulta: 1)' })]),
    });
    expect(blocos).toContainEqual(expect.objectContaining({ tipo: 'nota', texto: LEGENDA_PELA_CONSULTA }));
  });

  it('o PDF leva o rótulo e a legenda na seção do atendimento; sem o campo, sai como antes', () => {
    const r: Relatorio = { ...base, ...com(3) };
    const blocos = planoDoPdf(r, ESCOLHAS_PADRAO, rotulos, 2026);
    const i = blocos.findIndex((b) => b.tipo === 'secao' && b.titulo === 'Atendimento ao filiado');
    expect(blocos[i + 1]).toMatchObject({
      tipo: 'numeros',
      itens: expect.arrayContaining([{ rotulo: 'Concluídos (pela consulta: 3)', valor: '7' }]),
    });
    expect(blocos[i + 2]).toEqual({ tipo: 'nota', texto: LEGENDA_PELA_CONSULTA });
    expect(foraDaFontePadrao(JSON.stringify(blocos))).toEqual([]);
    const antigo = planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026);
    const j = antigo.findIndex((b) => b.tipo === 'secao' && b.titulo === 'Atendimento ao filiado');
    expect(antigo[j + 1]).toMatchObject({ itens: expect.arrayContaining([{ rotulo: 'Concluídos', valor: '7' }]) });
    expect(antigo).not.toContainEqual({ tipo: 'nota', texto: LEGENDA_PELA_CONSULTA });
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

  /** Movimento (13/09/2026): esqueleto na primeira carga, número que conta só no Resumo, barra de pessoa parada. */
  it('carrega com esqueleto, conta o Resumo e não anima a lista de atendentes', () => {
    expect(TELA).toContain('<Carregando texto="Somando o período…"');
    expect(TELA).not.toContain('>Somando o período…</p>');
    expect(TELA).toContain('<NumeroAnimado valor={valor} />');
    const atendente = TELA.slice(TELA.indexOf('titulo="Por atendente"'), TELA.indexOf('titulo="Por atendente"') + 200);
    expect(atendente).toContain('animar={false}');
  });
});

/**
 * O QUE HÁ DENTRO DE "OUTRO" — 13/09/2026. "Outro: 9" sozinho não deixa
 * ninguém decidir se falta a categoria "Aposentadoria". Só texto repetido tem
 * nome (a API já corta): texto único num PDF da diretoria pode identificar alguém.
 */
describe('os textos de "Outro"', () => {
  it('a frase nomeia os repetidos e conta os únicos', () => {
    expect(
      fraseDosOutrosAssuntos([{ texto: 'aposentadoria', total: 4 }, { texto: 'plano de saúde', total: 2 }], 3),
    ).toBe('Em “Outro”: aposentadoria (4), plano de saúde (2); 3 com texto único.');
    expect(fraseDosOutrosAssuntos([], 1)).toBe('Em “Outro”: 1 com texto único.');
  });

  it('lista longa resume o resto; nada a dizer, ou API antiga, é nulo', () => {
    const muitos = Array.from({ length: OUTROS_NA_FRASE + 2 }, (_, i) => ({ texto: `tema ${i}`, total: 2 }));
    expect(fraseDosOutrosAssuntos(muitos, 0)).toMatch(/mais 2 textos repetidos\.$/);
    expect(fraseDosOutrosAssuntos([], 0)).toBeNull();
    expect(fraseDosOutrosAssuntos(undefined, undefined)).toBeNull();
  });

  it('o PDF leva a frase ao lado do "por que procuraram", só quando há o que dizer', () => {
    const comOutros: Relatorio = {
      ...base,
      atendimentos: { ...base.atendimentos, outrosAssuntos: [{ texto: 'aposentadoria', total: 4 }], outrosUnicos: 3 },
    };
    const notas = (r: Relatorio) =>
      planoDoPdf(r, ESCOLHAS_PADRAO, rotulos, 2026).flatMap((b) => (b.tipo === 'nota' ? [b.texto] : []));
    expect(notas(comOutros)).toContain('Em “Outro”: aposentadoria (4); 3 com texto único.');
    expect(notas(base).some((t) => t.startsWith('Em “Outro”'))).toBe(false);
    expect(foraDaFontePadrao(JSON.stringify(planoDoPdf(comOutros, ESCOLHAS_PADRAO, rotulos, 2026)))).toEqual([]);
  });

  it('a tela usa a mesma frase', () => {
    expect(TELA).toContain('fraseDosOutrosAssuntos(data.atendimentos.outrosAssuntos, data.atendimentos.outrosUnicos)');
  });

  /** O atraso sai em âmbar no papel, como na tela. */
  it('as atrasadas do resumo saem com o alerta', () => {
    const resumo = planoDoPdf(base, ESCOLHAS_PADRAO, rotulos, 2026).find((b) => b.tipo === 'numeros') as Extract<
      BlocoDoPdf,
      { tipo: 'numeros' }
    >;
    expect(resumo.itens.find((i) => i.rotulo === 'Em aberto agora')!.linhas).toEqual([
      { texto: '3 atrasadas', alerta: true },
    ]);
  });
});

/**
 * AS INTIMACOES QUE CITARAM A PESSOA (18/09/2026).
 *
 * Pedido: colocar no relatorio individual de cada advogado as intimacoes que
 * ele teve e as acoes que tomou. O risco e o papel virar regua de produtividade
 * na mao de quem receber — por isso a ressalva nao e opcional.
 */
describe('intimações no espelho da pessoa', () => {
  const comIntimacoes = (
    over: Partial<NonNullable<Relatorio['minhasIntimacoes']>> = {},
  ): Relatorio => ({
    ...base,
    escopo: 'PESSOAL',
    minhasIntimacoes: {
      temOab: true, recebidas: 37, viraramTarefa: 21,
      tarefasConcluidas: 18, tarefasEmAberto: 3, oRoboDispensou: 12,
      ...over,
    },
  });
  const plano = (r: Relatorio) => JSON.stringify(planoDoPdf(r, TUDO_DETALHADO, rotulos, 2026));

  it('a seção só existe quando o bloco vem', () => {
    expect(secaoDisponivel(base, 'intimacoes')).toBe(false);
    expect(secaoDisponivel(comIntimacoes(), 'intimacoes')).toBe(true);
  });

  it('os quatro números entram no PDF', () => {
    const texto = plano(comIntimacoes());
    expect(texto).toContain('Intimações no período');
    expect(texto).toContain('Viraram tarefa');
    expect(texto).toContain('Tarefas concluídas');
    expect(texto).toContain('Ainda em aberto');
  });

  /** Um papel com "37" ao lado de um nome, sem a frase, vira placar. */
  it('a ressalva sai SEMPRE que a seção sai', () => {
    expect(plano(comIntimacoes())).toContain('ISTO NÃO MEDE PRODUTIVIDADE');
  });

  /** A dispensa é do robô: somá-la às ações humanas inventaria trabalho. */
  it('separa a decisão do robô, e diz de quem é', () => {
    expect(plano(comIntimacoes())).toContain('É decisão dele, não da pessoa.');
  });

  it('sem dispensa nenhuma, a frase do robô não aparece', () => {
    expect(plano(comIntimacoes({ oRoboDispensou: 0 }))).not.toContain('decisão dele');
  });

  /** Zero sem OAB é resultado; zero por falta de cadastro é outra coisa. */
  it('sem OAB, explica em vez de imprimir quatro zeros', () => {
    const texto = plano(comIntimacoes({ temOab: false }));
    expect(texto).toContain('Sem inscrição na OAB cadastrada');
    expect(texto).not.toContain('Intimações no período');
  });

  it('a tela também traz a ressalva, e não em letra miúda', () => {
    expect(TELA).toContain('Isto não mede produtividade');
    expect(TELA).toContain('mostrar o serviço');
  });

  it('a tela explica a falta de OAB em vez de mostrar zero', () => {
    const bloco = TELA.slice(TELA.indexOf('function SecaoMinhasIntimacoes'));
    expect(bloco.slice(0, 3000)).toContain('{!m.temOab ?');
    expect(bloco.slice(0, 3000)).toContain('inscrição na OAB cadastrada no sistema');
  });
});

/**
 * CONCORDANCIA — varrido renderizando a tela com 1 DE TUDO (18/09/2026).
 *
 * Sobraram tres frases no plural fixo: "1 processos ativos", "1 entraram no
 * sistema" e "1 concluidas" (as tarefas do robo). Numero 1 e o caso mais comum
 * num sindicato pequeno, e a frase errada tira a autoridade do relatorio.
 */
describe('o relatório concorda em número', () => {
  it('o acervo de hoje flexiona', () => {
    expect(TELA).toContain("data.processos.ativos === 1 ? 'processo ativo' : 'processos ativos'");
    expect(TELA).toContain("data.processos.encerrados === 1 ? 'encerrado' : 'encerrados'");
    expect(TELA).toContain("data.processos.cadastrados === 1 ? 'entrou' : 'entraram'");
  });

  it('as tarefas do robô flexionam', () => {
    expect(TELA).toContain("robo.concluidas === 1 ? 'concluída' : 'concluídas'");
    expect(TELA).toContain("? 'cancelada'");
  });

  /** Ternário com os dois lados iguais é defeito silencioso. */
  it('nenhum ternário de plural tem os dois lados iguais', () => {
    const iguais = [...TELA.matchAll(/\? '([^']+)' : '([^']+)'/g)].filter(([, a, b]) => a === b);
    expect(iguais.map((m) => m[0])).toEqual([]);
  });
});

/**
 * O QUADRO ASSOCIATIVO — a primeira pergunta de qualquer reuniao de diretoria,
 * e o relatorio nao respondia (18/09/2026).
 *
 * O painel mostrava entradas e saidas do MES num cartao; o documento que vai
 * para a assembleia nao tinha nada.
 */
describe('o quadro associativo', () => {
  const comQuadro = (over: Partial<NonNullable<Relatorio['quadro']>> = {}): Relatorio => ({
    ...base,
    quadro: {
      ativosHoje: 7139, novos: 12, saidas: 3, reativados: 1, saldo: 9,
      semDataDeFiliacao: 2378,
      porMotivo: [{ rotulo: 'APOSENTADORIA', total: 2 }, { rotulo: 'INADIMPLENCIA', total: 1 }],
      ...over,
    },
  });
  const plano = (r: Relatorio) => JSON.stringify(planoDoPdf(r, TUDO_DETALHADO, rotulos, 2026));

  it('a seção só existe quando o bloco vem', () => {
    expect(secaoDisponivel(base, 'quadro')).toBe(false);
    expect(secaoDisponivel(comQuadro(), 'quadro')).toBe(true);
  });

  /** Entrada sem saída ao lado é propaganda, não relatório. */
  it('a saída sai junto da entrada, sempre', () => {
    const texto = plano(comQuadro());
    expect(texto).toContain('Entraram no período');
    expect(texto).toContain('Saíram no período');
    expect(texto).toContain('Sócios ativos hoje');
    expect(texto).toContain('Saldo');
  });

  it('a reativação é dita à parte, para o saldo não parecer errado', () => {
    expect(plano(comQuadro())).toContain('já foi revertida');
    expect(plano(comQuadro({ reativados: 0 }))).not.toContain('revertida');
  });

  /** Sem isto, "entraram 12" numa base com 2.378 sem data parece o quadro inteiro. */
  it('avisa quantos ficam fora da conta por falta de data', () => {
    expect(plano(comQuadro())).toContain('sem data de filiação');
    expect(plano(comQuadro({ semDataDeFiliacao: 0 }))).not.toContain('sem data de filiação');
  });

  it('o motivo da saída sai em português, e não o enum', () => {
    const comRotulo = planoDoPdf(comQuadro(), TUDO_DETALHADO, {
      ...rotulos, motivoDesfiliacao: () => 'Aposentadoria',
    }, 2026);
    expect(JSON.stringify(comRotulo)).toContain('Aposentadoria');
  });

  it('a tela tem a seção e o rótulo em português', () => {
    expect(TELA).toContain('function SecaoQuadro');
    expect(TELA).toContain('MOTIVO_DESFILIACAO_LABEL');
    expect(TELA).toContain("id: 'quadro', texto: 'Quadro associativo'");
  });
});
