/**
 * @jest-environment node
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { montarDocumento, type BlocoDoPdf } from './pdf-documento';
import { PALETA } from './pdf-graficos';

const CAPA = {
  faixa: 'Relatorio de teste',
  titulo:
    'Relatório do sindicato — um título comprido o bastante para quebrar em duas linhas na capa do documento',
  apoio: 'Período: setembro de 2026 · Toda a equipe · Emitido por Ana',
  observacao: 'Números apresentados na assembleia.',
};

function gerar(blocos: BlocoDoPdf[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  montarDocumento(doc, autoTable, CAPA, blocos, null);
  return doc;
}

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
  { tipo: 'texto', texto: 'Em 2025, 29 de 34 sentenças foram a favor, ao menos em parte.' },
  { tipo: 'nota', texto: 'Uma nota pequena.' },
  {
    tipo: 'tabela', titulo: 'Por pessoa', cabecalho: ['Pessoa', 'Concluídas'],
    linhas: [['Dra. Ana\nAdvogada', '12']], numericas: [1],
  },
  { tipo: 'tabela', cabecalho: ['', 'Período anterior', 'Este período', 'Variação'], linhas: [] },
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
  },
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
      { tipo: 'faixa', marcas: [], legenda: '0 de 0 dias com uso' },
      { tipo: 'tabela', titulo: 'Vazia', cabecalho: ['A', 'B'], linhas: [] },
    ]).output();
    expect(saida).not.toContain('NaN');
    expect(saida).toContain('Nada registrado nesses meses.');
  });

  it('lista longa quebra a página e repete a faixa da casa em cada uma', () => {
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
  });

  it('seta e emoji não chegam ao papel', () => {
    const saida = gerar([{ tipo: 'texto', texto: 'subiu → 3 🎉' }]).output();
    expect(saida).toContain('subiu - 3');
  });
});
