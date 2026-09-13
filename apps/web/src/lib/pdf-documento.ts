import type { jsPDF } from 'jspdf';
import type autoTableDoPlugin from 'jspdf-autotable';
import {
  CINZA, MARGEM, VERDE, carregarLogo, desenharCabecalhoSync, desenharRodapeGeracao,
} from './pdf-institucional';
import {
  clarear, escalaDoEixo, numero, paraAFontePadrao, passoDosRotulos, type Cor,
} from './pdf-graficos';

/**
 * O DOCUMENTO — a tipografia comum dos PDFs dos Relatórios.
 *
 * Os dois PDFs (o do sindicato e o do uso do sistema) decidem O QUE entra em
 * funções puras e entregam aqui uma lista de blocos. Este arquivo só desenha:
 * a faixa da casa em toda página, títulos, cartões de número, tabelas, barras,
 * colunas e a faixa dos dias. Um jeito de desenhar gráfico, e não dois.
 */

export interface Serie {
  nome: string;
  cor: Cor;
}

export interface ItemDeNumero {
  rotulo: string;
  valor: string;
  nota?: string;
  /** "antes 34 · +12%" — só para contagem do período. */
  comparacao?: string;
}

export type BlocoDoPdf =
  | { tipo: 'secao'; titulo: string; subtitulo?: string; novaPagina?: boolean }
  | { tipo: 'numeros'; itens: ItemDeNumero[] }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'nota'; texto: string }
  | { tipo: 'destaque'; rotulo: string; texto: string }
  | {
      tipo: 'tabela';
      titulo?: string;
      cabecalho: string[];
      linhas: string[][];
      /** Índices das colunas de número, alinhadas à direita. */
      numericas?: number[];
      vazio?: string;
    }
  | {
      /** Barras deitadas, uma por linha: cabem nomes longos. Várias partes se empilham. */
      tipo: 'barras';
      titulo: string;
      /** O que se conta, em cinza ao lado do título. */
      unidade?: string;
      series: Serie[];
      itens: { rotulo: string; partes: number[]; texto: string }[];
      vazio?: string;
    }
  | {
      /** Colunas em pé, lado a lado por categoria: o tempo corre da esquerda para a direita. */
      tipo: 'colunas';
      titulo: string;
      unidade?: string;
      series: Serie[];
      categorias: string[];
      /** [série][categoria]. */
      valores: number[][];
      /** Uma segunda linha embaixo de cada categoria. */
      detalhes?: string[];
      vazio?: string;
    }
  | {
      /** A faixa dos dias: um traço por dia (ou semana), mais forte quanto mais uso. */
      tipo: 'faixa';
      marcas: { intensidade: number; fimDeSemana?: boolean }[];
      legenda: string;
    };

export interface CapaDoDocumento {
  /** O texto da faixa verde, à direita. */
  faixa: string;
  titulo: string;
  /** Período, recorte e quem emitiu. */
  apoio: string;
  /** A observação de quem emitiu, em caixa, antes de tudo. */
  observacao?: string;
}

type AutoTable = typeof autoTableDoPlugin;
type Logo = Parameters<typeof desenharCabecalhoSync>[2];
type De<T extends BlocoDoPdf['tipo']> = Extract<BlocoDoPdf, { tipo: T }>;

const TINTA: Cor = [30, 35, 40];
const TRILHO: Cor = [236, 240, 237];
const GRADE: Cor = [226, 230, 233];
const DIA_SEM_USO: Cor = [224, 229, 232];
const FIM_DE_SEMANA: Cor = [245, 247, 246];

/** Altura de uma linha de texto, em mm: o jsPDF usa 1,15 de entrelinha. */
const entrelinha = (pontos: number) => pontos * 0.3528 * 1.15;
const somar = (partes: number[]) => partes.reduce((soma, v) => soma + Math.max(0, v), 0);

/**
 * Toda string do plano passa pelo filtro da fonte — inclusive o título que a
 * pessoa digitou e o nome que veio do cadastro. Seta e emoji sairiam como lixo.
 */
function sanear<T>(valor: T): T {
  if (typeof valor === 'string') return paraAFontePadrao(valor) as T;
  if (Array.isArray(valor)) return valor.map((v) => sanear(v)) as T;
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, sanear(v)])) as T;
  }
  return valor;
}

/**
 * DESENHA NUM DOCUMENTO JÁ ABERTO. Separado de `baixarDocumento` para rodar sem
 * navegador — é assim que o teste prova que o desenho aguenta lista vazia,
 * zero em tudo e cem linhas.
 */
export function montarDocumento(
  doc: jsPDF,
  autoTable: AutoTable,
  capaPedida: CapaDoDocumento,
  blocosPedidos: BlocoDoPdf[],
  logo: Logo,
): void {
  const capa = sanear(capaPedida);
  const blocos = sanear(blocosPedidos);
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const largura = larguraPagina - MARGEM * 2;
  const limite = alturaPagina - 20;

  let y = desenharCabecalhoSync(doc, capa.faixa, logo);
  const inicioDaPagina = y;

  const novaPagina = () => {
    doc.addPage();
    y = desenharCabecalhoSync(doc, capa.faixa, logo);
  };
  /** Quebra antes de começar o que não cabe — a não ser que já estejamos no topo. */
  const cabe = (altura: number) => {
    if (y + altura > limite && y > inicioDaPagina + 0.5) novaPagina();
  };
  const fonte = (pontos: number, peso: 'normal' | 'bold' = 'normal', cor: Cor = TINTA) => {
    doc.setFont('helvetica', peso);
    doc.setFontSize(pontos);
    doc.setTextColor(cor[0], cor[1], cor[2]);
  };
  const preencher = (cor: Cor) => doc.setFillColor(cor[0], cor[1], cor[2]);
  /** Corta com reticências: nome de parte contrária não pode empurrar a barra para fora. */
  const caber = (texto: string, max: number) => {
    if (doc.getTextWidth(texto) <= max) return texto;
    let corte = texto;
    while (corte.length > 1 && doc.getTextWidth(`${corte}…`) > max) corte = corte.slice(0, -1);
    return `${corte.trimEnd()}…`;
  };

  // A CAPA: título, a linha de apoio e, se houver, a observação de quem emitiu.
  fonte(16, 'bold');
  const linhasDoTitulo = doc.splitTextToSize(capa.titulo, largura) as string[];
  doc.text(linhasDoTitulo, MARGEM, y + 4);
  y += 4 + (linhasDoTitulo.length - 1) * entrelinha(16);
  fonte(9, 'normal', CINZA);
  const linhasDoApoio = doc.splitTextToSize(capa.apoio, largura) as string[];
  doc.text(linhasDoApoio, MARGEM, y + 6);
  y += 6 + (linhasDoApoio.length - 1) * entrelinha(9) + 6;
  if (capa.observacao) destaque('Observação', capa.observacao);

  for (const bloco of blocos) {
    switch (bloco.tipo) {
      case 'secao':
        secao(bloco);
        break;
      case 'numeros':
        numeros(bloco);
        break;
      case 'texto':
        paragrafo(bloco.texto, 10, TINTA);
        break;
      case 'nota':
        paragrafo(bloco.texto, 7.5, CINZA);
        break;
      case 'destaque':
        destaque(bloco.rotulo, bloco.texto);
        break;
      case 'tabela':
        tabela(bloco);
        break;
      case 'barras':
        barras(bloco);
        break;
      case 'colunas':
        colunas(bloco);
        break;
      case 'faixa':
        faixa(bloco);
        break;
    }
  }

  desenharRodapeGeracao(doc);

  function secao(b: De<'secao'>) {
    if (b.novaPagina && y > inicioDaPagina + 0.5) novaPagina();
    cabe(b.subtitulo ? 30 : 24);
    y += 4;
    fonte(12, 'bold', VERDE);
    doc.text(caber(b.titulo, largura), MARGEM, y);
    doc.setDrawColor(VERDE[0], VERDE[1], VERDE[2]);
    doc.setLineWidth(0.3);
    doc.line(MARGEM, y + 1.8, MARGEM + largura, y + 1.8);
    y += 7;
    if (b.subtitulo) {
      fonte(8.5, 'normal', CINZA);
      const linhas = doc.splitTextToSize(b.subtitulo, largura) as string[];
      doc.text(linhas, MARGEM, y);
      y += (linhas.length - 1) * entrelinha(8.5) + 5;
    }
  }

  function numeros(b: De<'numeros'>) {
    const porLinha = Math.max(1, Math.min(4, b.itens.length));
    const vao = 3;
    const w = (largura - vao * (porLinha - 1)) / porLinha;
    for (let i = 0; i < b.itens.length; i += porLinha) {
      const fileira = b.itens.slice(i, i + porLinha);
      fonte(7);
      // Até três linhas de nota: a caixa cresce junto, e a fileira inteira acompanha.
      const notas = fileira.map((item) =>
        item.nota ? (doc.splitTextToSize(item.nota, w - 6) as string[]).slice(0, 3) : [],
      );
      const linhasDeNota = Math.max(0, ...notas.map((l) => l.length));
      const comComparacao = fileira.some((item) => item.comparacao);
      const h = Math.max(18, 14.5 + linhasDeNota * entrelinha(7) + (comComparacao ? 4.5 : 0));
      cabe(h + vao);
      fileira.forEach((item, k) => {
        const x = MARGEM + k * (w + vao);
        doc.setDrawColor(222, 226, 230);
        doc.setFillColor(248, 250, 249);
        doc.setLineWidth(0.2);
        doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
        fonte(14, 'bold');
        doc.text(caber(item.valor, w - 6), x + 3, y + 7.5);
        fonte(7.5, 'normal', CINZA);
        doc.text(caber(item.rotulo, w - 6), x + 3, y + 12);
        if (notas[k].length) {
          fonte(7, 'normal', CINZA);
          doc.text(notas[k], x + 3, y + 15.5);
        }
        if (item.comparacao) {
          fonte(7, 'bold', CINZA);
          doc.text(caber(item.comparacao, w - 6), x + 3, y + h - 2.6);
        }
      });
      y += h + vao;
    }
  }

  function paragrafo(texto: string, pontos: number, cor: Cor) {
    fonte(pontos, 'normal', cor);
    const linhas = doc.splitTextToSize(texto, largura) as string[];
    const altura = linhas.length * entrelinha(pontos);
    cabe(altura + 3);
    doc.text(linhas, MARGEM, y + pontos * 0.35);
    y += altura + 3;
  }

  /** A caixa clara com a barra verde: a observação de quem emitiu, e o aviso que abre o PDF do uso. */
  function destaque(rotulo: string, texto: string) {
    fonte(9);
    const linhas = doc.splitTextToSize(texto, largura - 10) as string[];
    const altura = 11 + (linhas.length - 1) * entrelinha(9) + 2.5;
    cabe(altura + 5);
    doc.setFillColor(243, 247, 244);
    doc.rect(MARGEM, y, largura, altura, 'F');
    preencher(VERDE);
    doc.rect(MARGEM, y, 1.2, altura, 'F');
    fonte(7, 'bold', VERDE);
    doc.text(rotulo.toUpperCase(), MARGEM + 5, y + 4.8);
    fonte(9);
    doc.text(linhas, MARGEM + 5, y + 9.5);
    y += altura + 5;
  }

  function tabela(b: De<'tabela'>) {
    cabe(b.titulo ? 26 : 20);
    if (b.titulo) {
      fonte(9, 'bold');
      doc.text(caber(b.titulo, largura), MARGEM, y + 3);
      y += 5;
    }
    autoTable(doc, {
      startY: y,
      margin: { top: inicioDaPagina, left: MARGEM, right: MARGEM, bottom: 18 },
      head: [b.cabecalho],
      body: b.linhas.length
        ? b.linhas
        : [[{
            content: b.vazio ?? 'Nada no período.',
            colSpan: b.cabecalho.length,
            styles: { halign: 'center', textColor: CINZA },
          }]],
      theme: 'plain',
      headStyles: { fillColor: [238, 243, 240], textColor: TINTA, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: TINTA, cellPadding: 1.6 },
      alternateRowStyles: { fillColor: [250, 251, 250] },
      columnStyles: Object.fromEntries(
        (b.numericas ?? []).map((coluna) => [coluna, { halign: 'right' as const }]),
      ),
      // O cabeçalho da coluna de número acompanha o número, à direita.
      didParseCell: (celula) => {
        if (celula.section === 'head' && b.numericas?.includes(celula.column.index)) {
          celula.cell.styles.halign = 'right';
        }
      },
      didDrawPage: () => {
        desenharCabecalhoSync(doc, capa.faixa, logo);
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  function tituloDeGrafico(titulo: string, series: Serie[], unidade?: string) {
    fonte(9, 'bold');
    const texto = caber(titulo, largura);
    doc.text(texto, MARGEM, y + 3);
    if (unidade) {
      const x = MARGEM + doc.getTextWidth(texto) + 2;
      fonte(7.5, 'normal', CINZA);
      doc.text(caber(unidade, MARGEM + largura - x), x, y + 3);
    }
    y += 7;
    // Legenda só quando há mais de uma série: com uma, o título já diz o que é.
    if (series.length > 1) {
      fonte(7, 'normal', CINZA);
      let x = MARGEM;
      for (const serie of series) {
        preencher(serie.cor);
        doc.rect(x, y - 2.3, 2.6, 2.6, 'F');
        doc.text(serie.nome, x + 3.6, y);
        x += 3.6 + doc.getTextWidth(serie.nome) + 5;
      }
      y += 4;
    }
  }

  function semNada(texto: string | undefined) {
    fonte(8, 'normal', CINZA);
    doc.text(texto ?? 'Nada no período.', MARGEM, y + 1);
    y += 7;
  }

  function barras(b: De<'barras'>) {
    const LINHA = 6;
    const vazio = !b.itens.some((item) => somar(item.partes) > 0);
    // O título nunca fica sozinho no pé da página: vai junto com as primeiras linhas.
    cabe(7 + (b.series.length > 1 ? 4 : 0) + (vazio ? 7 : Math.min(b.itens.length, 5) * LINHA) + 4);
    tituloDeGrafico(b.titulo, b.series, b.unidade);
    if (vazio) {
      semNada(b.vazio);
      return;
    }
    fonte(7.5);
    const larguraDoRotulo = Math.min(
      largura * 0.38,
      Math.max(18, ...b.itens.map((item) => doc.getTextWidth(item.rotulo) + 3)),
    );
    fonte(7.5, 'bold');
    const larguraDoTexto = Math.min(
      largura * 0.3,
      Math.max(8, ...b.itens.map((item) => doc.getTextWidth(item.texto) + 3)),
    );
    const area = largura - larguraDoRotulo - larguraDoTexto;
    const maximo = Math.max(...b.itens.map((item) => somar(item.partes)));
    for (const item of b.itens) {
      cabe(LINHA);
      const x0 = MARGEM + larguraDoRotulo;
      fonte(7.5);
      doc.text(caber(item.rotulo, larguraDoRotulo - 3), MARGEM, y + 4);
      preencher(TRILHO);
      doc.rect(x0, y + 1.4, area, 3.6, 'F');
      let x = x0;
      item.partes.forEach((parte, i) => {
        if (!(parte > 0)) return;
        const w = (area * parte) / maximo;
        preencher(b.series[i]?.cor ?? VERDE);
        doc.rect(x, y + 1.4, w, 3.6, 'F');
        x += w;
      });
      fonte(7.5, 'bold');
      doc.text(caber(item.texto, larguraDoTexto - 2), x0 + area + 2, y + 4);
      y += LINHA;
    }
    y += 4;
  }

  function colunas(b: De<'colunas'>) {
    const ALTURA = 40;
    const maximo = Math.max(0, ...b.valores.flat());
    const vazio = !b.categorias.length || !(maximo > 0);
    cabe(7 + (b.series.length > 1 ? 4 : 0) + (vazio ? 7 : 3 + ALTURA + (b.detalhes ? 10 : 7)) + 3);
    tituloDeGrafico(b.titulo, b.series, b.unidade);
    if (vazio) {
      semNada(b.vazio);
      return;
    }
    const { max, passos } = escalaDoEixo(maximo);
    fonte(6.5, 'normal', CINZA);
    const eixo = Math.max(...passos.map((p) => doc.getTextWidth(numero(p)))) + 2.5;
    const x0 = MARGEM + eixo;
    const w = largura - eixo;
    const base = y + 3 + ALTURA;
    doc.setLineWidth(0.15);
    doc.setDrawColor(GRADE[0], GRADE[1], GRADE[2]);
    for (const passo of passos) {
      const altura = base - (ALTURA * passo) / max;
      doc.line(x0, altura, x0 + w, altura);
      doc.text(numero(passo), x0 - 1.5, altura + 0.9, { align: 'right' });
    }
    const slot = w / b.categorias.length;
    const grupo = slot * (b.series.length > 1 ? 0.8 : 0.56);
    const coluna = grupo / b.series.length;
    // Número em cima da coluna só quando cabe; senão, o eixo é quem conta.
    const cabeONumero = coluna >= 4.5;
    b.categorias.forEach((_, c) => {
      const xDoGrupo = x0 + c * slot + (slot - grupo) / 2;
      b.series.forEach((serie, s) => {
        const valor = b.valores[s]?.[c] ?? 0;
        if (!(valor > 0)) return;
        const h = (ALTURA * valor) / max;
        preencher(serie.cor);
        doc.rect(xDoGrupo + s * coluna + 0.2, base - h, Math.max(0.4, coluna - 0.4), h, 'F');
        if (cabeONumero) {
          fonte(6, 'bold');
          doc.text(numero(valor), xDoGrupo + s * coluna + coluna / 2, base - h - 1, { align: 'center' });
        }
      });
    });
    doc.setDrawColor(150, 158, 165);
    doc.setLineWidth(0.25);
    doc.line(x0, base, x0 + w, base);
    fonte(7);
    const salto = passoDosRotulos(slot, Math.max(...b.categorias.map((t) => doc.getTextWidth(t))) + 1.5);
    b.categorias.forEach((categoria, c) => {
      if (c % salto) return;
      const centro = x0 + c * slot + slot / 2;
      fonte(7);
      doc.text(categoria, centro, base + 4, { align: 'center' });
      const detalhe = b.detalhes?.[c];
      if (detalhe) {
        fonte(6, 'normal', CINZA);
        doc.text(caber(detalhe, slot * salto - 1), centro, base + 7.3, { align: 'center' });
      }
    });
    y = base + (b.detalhes ? 10 : 7) + 3;
  }

  function faixa(b: De<'faixa'>) {
    cabe(13);
    const quantas = b.marcas.length;
    if (quantas) {
      const vao = quantas > 40 ? 0.35 : 0.6;
      const w = Math.min(5, (largura - vao * (quantas - 1)) / quantas);
      b.marcas.forEach((marca, i) => {
        // Fim de semana sem uso é quase papel: ninguém deve nada ao sábado.
        const cor =
          marca.intensidade > 0
            ? clarear(VERDE, 0.3 + 0.7 * Math.min(1, marca.intensidade))
            : marca.fimDeSemana
              ? FIM_DE_SEMANA
              : DIA_SEM_USO;
        preencher(cor);
        doc.roundedRect(MARGEM + i * (w + vao), y, w, 4, 0.4, 0.4, 'F');
      });
    }
    fonte(7.5, 'normal', CINZA);
    doc.text(caber(b.legenda, largura), MARGEM, y + 8.2);
    y += 13;
  }
}

/** Abre o jsPDF só na hora (é pesado), desenha e baixa. */
export async function baixarDocumento(
  capa: CapaDoDocumento,
  blocos: BlocoDoPdf[],
  arquivo: string,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const logo = await carregarLogo('branco');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  montarDocumento(doc, autoTable, capa, blocos, logo);
  doc.save(arquivo);
}
