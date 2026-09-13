/**
 * @jest-environment node
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TOPO_DAS_PAGINAS_SEGUINTES, montarDocumento, pareceJpeg, type BlocoDoPdf } from './pdf-documento';
import { PALETA } from './pdf-graficos';

const CAPA = {
  faixa: 'Relatorio de teste',
  titulo:
    'Relatório do sindicato — um título comprido o bastante para quebrar em duas linhas na capa do documento',
  periodo: '1º a 30 de setembro de 2026',
  apoio: 'Toda a equipe · Emitido por Ana em 13/09/2026',
  observacao: 'Números apresentados na assembleia.',
};

/** Uma miniatura JPEG de verdade (16 px), do mesmo formato que a API manda. */
const JPEG_PEQUENO =
  'data:image/jpeg;base64,/9j/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/ALABjT//2Q==';

function gerar(blocos: BlocoDoPdf[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const desenho = montarDocumento(doc, autoTable, CAPA, blocos, null);
  return Object.assign(doc, { desenho });
}

const PESSOA = {
  tipo: 'pessoa' as const,
  nome: 'Dra. Ana Lima',
  linha: 'Advogada · último acesso há 3 dias',
  iniciais: 'AL',
  cor: { fundo: [208, 226, 158] as [number, number, number], texto: [20, 94, 7] as [number, number, number] },
};

const TODOS_OS_BLOCOS: BlocoDoPdf[] = [
  { tipo: 'destaque', rotulo: 'Antes de ler', texto: 'Estes números mostram o que foi registrado no sistema.' },
  { tipo: 'secao', titulo: 'Resumo', subtitulo: 'Um subtítulo.' },
  {
    tipo: 'numeros',
    itens: [
      {
        rotulo: 'Atividades concluídas', valor: '1.234',
        nota: '10 no dia marcado · 3 em aberto, 1 atrasada · criou 5', comparacao: 'antes 1.100 · +12%',
      },
      { rotulo: 'Em aberto', valor: '5' },
      { rotulo: 'Atendimentos', valor: '0', comparacao: 'antes 0 · igual' },
      { rotulo: 'Pessoas', valor: '3 de 9', nota: 'todos entraram na última semana' },
      { rotulo: 'Quinto cartão, que abre outra fileira', valor: '7' },
    ],
  },
  PESSOA,
  { ...PESSOA, nome: 'Ivo', iniciais: 'I', foto: JPEG_PEQUENO },
  {
    tipo: 'faixa',
    marcas: Array.from({ length: 62 }, (_, i) => ({ intensidade: i % 3 ? 1 : 0, fimDeSemana: i % 7 === 5 })),
    legenda: '20 dias com uso · o período tem 45 dias de semana · antes 15',
    inicio: '13/07',
    fim: '12/09',
    chave: 'cheio = usou · claro = fim de semana',
  },
  {
    tipo: 'numeros',
    porFileira: 3,
    itens: [
      {
        grupo: 'Agenda', rotulo: 'concluídas', valor: '12', comparacao: 'antes 9 · +3',
        linhas: [
          { texto: '10 no dia marcado' },
          { texto: '4 em aberto, 1 atrasada', alerta: true },
          { texto: 'criou 3' },
          { texto: 'uma quarta linha comprida o bastante para quebrar e passar do limite do quadro' },
        ],
      },
      { grupo: 'Publicações', rotulo: 'decididas', valor: '5', linhas: [{ texto: '2 esperando decisão', alerta: true }] },
      { grupo: 'Processos', rotulo: 'andamentos internos', valor: '0' },
    ],
  },
  { tipo: 'texto', texto: 'Em 2025, 29 de 34 sentenças foram a favor, ao menos em parte.' },
  { tipo: 'nota', texto: 'Uma nota pequena.' },
  {
    tipo: 'tabela', titulo: 'Por pessoa', cabecalho: ['Pessoa', 'Concluídas'],
    linhas: [['Dra. Ana\nAdvogada', '12']], numericas: [1],
  },
  { tipo: 'tabela', cabecalho: ['', 'Período anterior', 'Este período', 'Variação'], linhas: [] },
  {
    tipo: 'tabela',
    cabecalho: ['Número', 'O que conta', 'Retrato'],
    linhas: [['Dias com uso', 'Dias do período em que a pessoa entrou no sistema.', 'Período']],
    fonte: 7.5,
    larguras: { 0: 34, 2: 16 },
  },
  {
    tipo: 'barras',
    titulo: 'Sentenças por ano',
    series: [
      { nome: 'Procedentes', cor: PALETA.verde },
      { nome: 'Em parte', cor: PALETA.verdeClaro },
      { nome: 'Improcedentes', cor: PALETA.ambar },
    ],
    itens: [
      { rotulo: '2025', partes: [9, 20, 5], texto: '34 (9 · 20 · 5)' },
      { rotulo: '2026 (até agora)', partes: [0, 0, 0], texto: '0 (0 · 0 · 0)' },
    ],
  },
  {
    tipo: 'barras',
    titulo: 'Contra quem',
    unidade: 'processos ativos',
    series: [{ nome: 'Processos ativos', cor: PALETA.verde }],
    itens: [{
      rotulo: 'Município de Teresina — Secretaria Municipal de Saúde e de Assistência Social, com nome enorme',
      partes: [12],
      texto: '12',
    }],
  },
  {
    tipo: 'colunas',
    titulo: 'Mês a mês',
    series: [
      { nome: 'Concluídas', cor: PALETA.verde },
      { nome: 'Andamentos', cor: PALETA.petroleo },
    ],
    categorias: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
    valores: [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]],
    detalhes: Array.from({ length: 12 }, (_, i) => `${i} pessoas`),
  },
  {
    tipo: 'faixa',
    marcas: Array.from({ length: 31 }, (_, i) => ({ intensidade: i % 3 ? 1 : 0, fimDeSemana: i % 7 === 5 })),
    legenda: '20 de 31 dias com uso',
  },
  {
    tipo: 'faixa',
    marcas: Array.from({ length: 53 }, (_, i) => ({ intensidade: (i % 8) / 7 })),
    legenda: 'cada traço é uma semana',
    inicio: '01/01',
    fim: '31/12',
    chave: 'mais escuro = mais dias com uso na semana',
  },
  { tipo: 'faixa', marcas: [{ intensidade: 1 }, { intensidade: 0 }], legenda: '1 dia com uso', inicio: '11/09', fim: '12/09' },
];

/**
 * O DESENHO RODA DE VERDADE — com o jsPDF de produção, sem navegador.
 *
 * Os planos são provados em função pura; isto prova que o desenho aguenta o que
 * eles mandam. Coordenada inválida no jsPDF não avisa: sai escrita como "NaN"
 * dentro do arquivo, e o PDF abre torto ou em branco na mão de quem gerou.
 */
describe('o documento desenhado', () => {
  it('desenha todos os tipos de bloco sem coordenada inválida', () => {
    const doc = gerar(TODOS_OS_BLOCOS);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.output()).not.toContain('NaN');
  });

  it('zero em tudo e lista vazia dizem "nada", em vez de um gráfico torto', () => {
    const saida = gerar([
      { tipo: 'barras', titulo: 'Contra quem', series: [{ nome: 'Processos', cor: PALETA.verde }], itens: [] },
      {
        tipo: 'colunas', titulo: 'Mês a mês', series: [], categorias: ['jul', 'ago'], valores: [],
        vazio: 'Nada registrado nesses meses.',
      },
      {
        tipo: 'colunas', titulo: 'Zerado', series: [{ nome: 'Concluídas', cor: PALETA.verde }],
        categorias: ['jul', 'ago'], valores: [[0, 0]],
      },
      { tipo: 'faixa', marcas: [], legenda: '0 dias com uso', inicio: '01/09', fim: '12/09', chave: 'cheio = usou' },
      { tipo: 'tabela', titulo: 'Vazia', cabecalho: ['A', 'B'], linhas: [] },
    ]).output();
    expect(saida).not.toContain('NaN');
    expect(saida).toContain('Nada registrado nesses meses.');
  });

  /**
   * A FAIXA DA CASA EM TODA PÁGINA — cheia (30 mm) na primeira, compacta
   * (14 mm) nas seguintes, desde 13/09/2026. O texto dela aparece uma vez por
   * página, e o conteúdo das páginas seguintes começa logo abaixo da compacta.
   */
  it('lista longa quebra a página e repete a faixa da casa em cada uma — compacta depois da primeira', () => {
    const doc = gerar([{
      tipo: 'barras',
      titulo: 'Ações por ano',
      series: [{ nome: 'Ações', cor: PALETA.verde }],
      itens: Array.from({ length: 90 }, (_, i) => ({ rotulo: String(1940 + i), partes: [i], texto: String(i) })),
    }]);
    const paginas = doc.getNumberOfPages();
    expect(paginas).toBeGreaterThan(1);
    const saida = doc.output();
    expect(saida.split('Relatorio de teste').length - 1).toBe(paginas);
    expect(saida).not.toContain('NaN');
    expect(doc.desenho.topos).toHaveLength(paginas);
    expect(doc.desenho.topos[0]).toBe(40);
    expect(doc.desenho.topos.slice(1).every((t) => t === TOPO_DAS_PAGINAS_SEGUINTES)).toBe(true);
  });

  /** A tabela abre as próprias páginas pelo plugin: a faixa não pode sair em dobro nem faltar. */
  it('tabela longa: uma faixa por página, nem duas nem nenhuma', () => {
    const doc = gerar([{
      tipo: 'tabela',
      titulo: 'Muitas linhas',
      cabecalho: ['Pessoa', 'Concluídas'],
      linhas: Array.from({ length: 140 }, (_, i) => [`Pessoa ${i}`, String(i)]),
      numericas: [1],
    }]);
    const paginas = doc.getNumberOfPages();
    expect(paginas).toBeGreaterThan(2);
    expect(doc.output().split('Relatorio de teste').length - 1).toBe(paginas);
    expect(doc.desenho.topos).toHaveLength(paginas);
  });

  it('a primeira página traz o período por extenso', () => {
    expect(gerar([]).output()).toContain('30 de setembro de 2026');
  });

  it('seta e emoji não chegam ao papel', () => {
    const saida = gerar([{ tipo: 'texto', texto: 'subiu → 3 🎉' }]).output();
    expect(saida).toContain('subiu - 3');
  });
});

/** A foto recortada em círculo, ou as iniciais. O PDF nunca falha por causa de foto. */
describe('o cartão da pessoa', () => {
  const imagens = (saida: string) => (saida.match(/\/Subtype \/Image/g) ?? []).length;

  it('com foto: uma imagem no documento, recortada, sem NaN', () => {
    const saida = gerar([{ ...PESSOA, foto: JPEG_PEQUENO }]).output();
    expect(imagens(saida)).toBe(1);
    expect(saida).not.toContain('NaN');
    expect(saida).toContain('Dra. Ana Lima');
  });

  it('sem foto: as iniciais, e nenhuma imagem', () => {
    const saida = gerar([PESSOA]).output();
    expect(imagens(saida)).toBe(0);
    expect(saida).toContain('(AL)');
    expect(saida).not.toContain('NaN');
  });

  it('foto que não abre cai nas iniciais, sem derrubar o documento', () => {
    const saida = gerar([{ ...PESSOA, foto: 'data:image/jpeg;base64,bm90LWEtanBlZw==' }]).output();
    expect(saida).toContain('(AL)');
    expect(saida).not.toContain('NaN');
  });

  /** "Uma página por pessoa": a primeira página é a do título, e cada cartão abre a sua. */
  it('cartões em páginas próprias não quebram o desenho', () => {
    const blocos: BlocoDoPdf[] = Array.from({ length: 4 }, (_, i) => ({
      ...PESSOA, nome: `Pessoa ${i}`, foto: JPEG_PEQUENO, novaPagina: true,
    }));
    const doc = gerar(blocos);
    expect(doc.getNumberOfPages()).toBe(5);
    expect(doc.output()).not.toContain('NaN');
  });

  it('só JPEG de verdade é tratado como foto', () => {
    expect(pareceJpeg(JPEG_PEQUENO)).toBe(true);
    expect(pareceJpeg('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(pareceJpeg('data:image/jpeg;base64,bm90LWEtanBlZw==')).toBe(false);
    expect(pareceJpeg('')).toBe(false);
  });
});
