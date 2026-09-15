import type { jsPDF } from 'jspdf';
import type autoTableDoPlugin from 'jspdf-autotable';
import { tenant } from '@/tenant.config';
import {
  AMBAR_TXT, CINZA, MARGEM, VERDE, carregarLogo, desenharCabecalhoSync, desenharRodapeGeracao,
} from './pdf-institucional';
import {
  CASA, clarear, escalaDoEixo, numero, paraAFontePadrao, passoDosRotulos, type Cor,
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
  /** Uma frase cinza embaixo do número. Continua aceita; `linhas` tem precedência. */
  nota?: string;
  /**
   * As linhas embaixo do número, uma por frase. A de `alerta` sai em âmbar —
   * é a mesma cor que a tela usa no mesmo lugar, e ela não se perde no papel.
   */
  linhas?: { texto: string; alerta?: boolean }[];
  /**
   * O nome do grupo, pequeno, ACIMA do número ("AGENDA"). Com ele o rótulo
   * ("concluídas") vai ao lado do número, e o quadro lê como frase.
   */
  grupo?: string;
  /** "antes 34 · +12%" — só para contagem do período. */
  comparacao?: string;
}

/** O rosto no cartão da pessoa: foto recortada em círculo, ou as iniciais na cor da tela. */
export interface CorDoRosto {
  fundo: Cor;
  texto: Cor;
}

/*
  OS BLOCOS DE 14/09/2026 — grade dos dias, caixas lado a lado, tabela com
  grupos e colunas empilhadas — nasceram para o PDF do uso do sistema caber
  numa folha por pessoa. São SÓ acréscimos: nenhum bloco que o PDF do
  sindicato e o do panorama usam muda de desenho sem os campos novos
  (`paginas-dos-pdfs.spec.ts` confere o número de páginas dos dois).
*/

/** Um dia na grade do uso. */
export interface DiaDaGrade {
  /** O dia do mês, que vai dentro da célula quando ela é grande o bastante. */
  dia: number;
  usou: boolean;
  fimDeSemana: boolean;
}

/** A grade de semanas × dias: uma coluna por semana, de segunda a domingo. */
export interface GradeDoPdf {
  /** `rotulo` vai acima da coluna ("10/08", "ago" ou vazio); `null` é dia fora do período, e não se desenha. */
  semanas: { rotulo: string; dias: (DiaDaGrade | null)[] }[];
  /** O nome de cada linha ("seg", "", "qua"…); o tamanho diz quantas linhas a grade tem. */
  linhas: string[];
  /**
   * A menor célula, em mm, com que a grade ainda vai AO LADO do texto (padrão
   * 4,2). Acréscimo de 15/09/2026: entre 11 e 15 semanas a grade descia para
   * baixo do texto e a caixa crescia uns 10 mm — era o que levava a folha da
   * pessoa com a conta criada no meio de "Últimos 90 dias" para a página 2.
   */
  celulaMinimaAoLado?: number;
}

/**
 * UM MÊS NA FILEIRA DOS DIAS COM USO (15/09/2026) — o que a caixa do período
 * desenha no lugar da grade quando o período passa de 14 semanas. Num ano a
 * grade tinha células de 1,4 mm e, entre 11 e 43 semanas, descia para baixo do
 * texto e ficava mais alta que a de um ano: a folha da pessoa passava para a
 * página 2. A fileira é uma linha só, qualquer que seja o período.
 */
export interface MesDaCaixa {
  /** "jan", ou "set/25" quando o período atravessa o ano. */
  rotulo: string;
  /** Dias com uso no mês; nulo quando nenhum dia do mês conta (a conta ainda não existia). */
  dias: number | null;
  /** A barrinha, de 0 a 1: os dias com uso contra os dias de semana do próprio mês. */
  proporcao: number;
}

/** O que vai dentro de uma caixa, de cima para baixo. */
export type LinhaDaCaixa =
  /** O número da caixa, em 14 pt ("19 dias com uso"). */
  | { tipo: 'grande'; texto: string }
  /** Frase cinza de 8 pt, quebrada na largura. */
  | { tipo: 'texto'; texto: string }
  /** Rótulo cinza e valor em negrito; `abaixo` é a segunda linha ("1 atrasada"). O âmbar só onde `alerta`. */
  | {
      tipo: 'par';
      rotulo: string;
      valor: string;
      alerta?: boolean;
      abaixo?: { texto: string; alerta?: boolean };
    }
  /** Como ler as cores da grade, com os quadradinhos DESENHADOS — caractere de quadrado some na fonte. */
  | { tipo: 'chave'; itens: { texto: string; cor: 'cheia' | 'vazia' | 'fimDeSemana' }[] }
  /** O pé, em 6,5 pt. */
  | { tipo: 'pe'; texto: string };

export interface CaixaDoPdf {
  /** Pequeno, em maiúsculas, no topo ("AGORA · 13/09/2026, 16:37"). */
  rotulo: string;
  linhas: LinhaDaCaixa[];
  /** Fundo cinza claro — a caixa do "agora", que não é do período. */
  fundo?: boolean;
}

export type BlocoDoPdf =
  | {
      tipo: 'secao';
      titulo: string;
      subtitulo?: string;
      novaPagina?: boolean;
      /** Título de 10 pt e menos espaço em volta: a seção que precisa caber na folha da pessoa. */
      compacta?: boolean;
      /**
       * Quanto de página, em mm, a seção precisa para começar ali — senão vai
       * para a próxima (15/09/2026). É o "começa na mesma página QUANDO
       * COUBER" da tabela pessoa por pessoa: o título não fica sozinho com uma
       * linha no pé da folha.
       */
      minimoNaPagina?: number;
    }
  | {
      tipo: 'numeros';
      itens: ItemDeNumero[];
      /** Quadros por fileira (padrão 4). A página da pessoa usa 3: são os três blocos do perfil. */
      porFileira?: number;
    }
  | {
      /**
       * O CARTÃO DA PESSOA — círculo de 14 mm, nome e a linha de apoio.
       * `foto` é um JPEG pequeno em data URL (a miniatura da API); sem ela, ou
       * se ela não abrir, saem as iniciais. O PDF nunca falha por causa de foto.
       */
      tipo: 'pessoa';
      nome: string;
      linha: string;
      iniciais: string;
      cor: CorDoRosto;
      foto?: string | null;
      novaPagina?: boolean;
    }
  | { tipo: 'texto'; texto: string }
  | { tipo: 'nota'; texto: string }
  | {
      tipo: 'destaque';
      rotulo: string;
      texto: string;
      /** Tamanho da letra (padrão 9). */
      fonte?: number;
    }
  | {
      tipo: 'tabela';
      titulo?: string;
      cabecalho: string[];
      linhas: string[][];
      /** Índices das colunas de número, alinhadas à direita. */
      numericas?: number[];
      vazio?: string;
      /** Tamanho da letra, em pontos (padrão 8). A legenda do uso sai em 7,5. */
      fonte?: number;
      /** Largura fixa de algumas colunas, em mm, pelo índice. As outras dividem o resto. */
      larguras?: Record<number, number>;
      /**
       * Cabeçalho em DUAS linhas: os grupos em cima ("No período", "Agora"),
       * cada um sobre `colunas` colunas; texto vazio deixa o grupo em branco.
       */
      grupos?: { texto: string; colunas: number }[];
      /** Letra por coluna, pelo índice: negrito, cinza, tamanho. */
      estilos?: Record<number, { negrito?: boolean; cinza?: boolean; fonte?: number }>;
      /**
       * Linhas especiais, pelo índice em `linhas`:
       *  · 'grupo' — a linha tem um texto só, em maiúsculas, mesclado na largura toda, no tom 100;
       *  · 'mesclada' — da coluna `de` em diante, uma célula só, em cinza.
       */
      especiais?: Record<number, { tipo: 'grupo' } | { tipo: 'mesclada'; de: number }>;
      /** Células em âmbar, como `[linha, coluna]` — só onde a tela também pede atenção. */
      alertas?: [number, number][];
      /** Folga dentro da célula, em mm (padrão 1,6). */
      folga?: number;
      /** Sem as listras alternadas: com linhas de grupo, a listra vira ruído. */
      semListras?: boolean;
      /** Sem a linha de cabeçalho (a legenda de duas colunas embaixo de outra tabela). */
      semCabecalho?: boolean;
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
      /**
       * As séries umas SOBRE as outras, numa coluna por categoria, com o total
       * em cima: a primeira série é a base. É o subconjunto por cor e ordem
       * ("no dia marcado" dentro das concluídas), nunca num segundo gráfico.
       */
      empilhar?: boolean;
      /** Altura do desenho, em mm (padrão 40). */
      altura?: number;
    }
  | {
      /**
       * DUAS CAIXAS LADO A LADO — à esquerda o período (com a grade dos dias),
       * à direita o retrato de agora. Mesma altura, a da mais alta.
       */
      tipo: 'caixas';
      /** `meses` só vale sem `grade`: é a fileira de meses que a substitui nos períodos longos. */
      esquerda: CaixaDoPdf & { grade?: GradeDoPdf; meses?: MesDaCaixa[] };
      direita: CaixaDoPdf;
    }
  | {
      /** A faixa dos dias: um traço por dia (ou semana), mais forte quanto mais uso. */
      tipo: 'faixa';
      marcas: { intensidade: number; fimDeSemana?: boolean }[];
      legenda: string;
      /** A data curta das pontas ("13/07" e "12/09"). */
      inicio?: string;
      fim?: string;
      /** Como ler as cores: "cheio = usou · claro = fim de semana". */
      chave?: string;
    };

export interface CapaDoDocumento {
  /** O texto da faixa da casa, à direita — em toda página. */
  faixa: string;
  titulo: string;
  /** O período por extenso, em destaque logo abaixo do título ("1º a 31 de agosto de 2026"). */
  periodo?: string;
  /** O recorte e quem emitiu. */
  apoio: string;
  /** A observação de quem emitiu, em caixa, antes de tudo. */
  observacao?: string;
  /**
   * O DOCUMENTO DE UMA PESSOA (14/09/2026): o círculo de 16 mm à esquerda do
   * título, com a foto ou as iniciais. O título é o nome, e o cartão separado
   * deixa de repetir o nome embaixo.
   */
  pessoa?: { iniciais: string; cor: CorDoRosto; foto?: string | null };
}

type AutoTable = typeof autoTableDoPlugin;
type Logo = Parameters<typeof desenharCabecalhoSync>[2];
type De<T extends BlocoDoPdf['tipo']> = Extract<BlocoDoPdf, { tipo: T }>;

const TINTA: Cor = [30, 35, 40];
const TRILHO: Cor = [236, 240, 237];
const GRADE: Cor = [226, 230, 233];
const DIA_SEM_USO: Cor = [224, 229, 232];
const FIM_DE_SEMANA: Cor = [245, 247, 246];
/** O contorno do sábado e do domingo na grade: sem ele, o quase-branco some na impressão. */
const CONTORNO_DO_FIM_DE_SEMANA: Cor = [230, 233, 236];
const ANEL: Cor = [210, 215, 220];
const BORDA: Cor = [222, 226, 230];
const FUNDO_DO_AGORA: Cor = [246, 247, 248];

/** Altura de uma linha de texto, em mm: o jsPDF usa 1,15 de entrelinha. */
const entrelinha = (pontos: number) => pontos * 0.3528 * 1.15;
const somar = (partes: number[]) => partes.reduce((soma, v) => soma + Math.max(0, v), 0);

/** A altura da fileira dos meses na caixa do período, em mm: nome, número e barrinha. */
const ALTURA_DOS_MESES = 8.4;

/** Até quantas linhas cabem embaixo do número; a última cortada ganha reticências. */
const LINHAS_POR_QUADRO = 4;

/**
 * A FAIXA COMPACTA — 14 mm, nas páginas depois da primeira.
 *
 * A faixa de 30 mm em toda folha comia perto de 11% da altura útil de cada
 * página no "uma página por pessoa". A primeira página continua com a faixa
 * cheia; as seguintes levam o logo pequeno e o mesmo texto à direita.
 * `pdf-institucional.ts` fica como está: os outros PDFs do sistema não mudam.
 */
export const ALTURA_DA_FAIXA_COMPACTA = 14;
export const TOPO_DAS_PAGINAS_SEGUINTES = ALTURA_DA_FAIXA_COMPACTA + 8;

/**
 * Toda string do plano passa pelo filtro da fonte — inclusive o título que a
 * pessoa digitou e o nome que veio do cadastro. Seta e emoji sairiam como lixo.
 * A foto é a exceção: é imagem em base64, e não texto que vai ao papel.
 */
function sanear<T>(valor: T): T {
  if (typeof valor === 'string') return paraAFontePadrao(valor) as T;
  if (Array.isArray(valor)) return valor.map((v) => sanear(v)) as T;
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([k, v]) => [k, k === 'foto' ? v : sanear(v)]),
    ) as T;
  }
  return valor;
}

/** O que o desenho devolve: onde o conteúdo começa em cada página (a prova da faixa compacta). */
export interface DesenhoDoDocumento {
  topos: number[];
  /** Onde o conteúdo terminou, em mm, na última página: é a folga que o teste da folha única mede. */
  fim: number;
  /** Quantas páginas o documento teve. */
  paginas: number;
  /**
   * A página em que cada bloco de `blocos` TERMINOU, pelo índice. Acréscimo de
   * 14/09/2026: é por aqui que o PDF do uso descobre QUAL pessoa passou da
   * folha dela, e aperta só essa.
   */
  paginaDoBloco: number[];
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
): DesenhoDoDocumento {
  const capa = sanear(capaPedida);
  const blocos = sanear(blocosPedidos);
  const larguraPagina = doc.internal.pageSize.getWidth();
  const alturaPagina = doc.internal.pageSize.getHeight();
  const largura = larguraPagina - MARGEM * 2;
  const limite = alturaPagina - 20;

  /*
    UMA FAIXA POR PÁGINA, e só uma. A tabela chama `didDrawPage` também na
    página em que começa; sem este registro, a faixa seria desenhada duas vezes
    ali (e o texto dela, contado duas vezes).
  */
  const topos: number[] = [];
  const faixaDaPagina = (): number => {
    const pagina = doc.getCurrentPageInfo().pageNumber;
    if (topos[pagina - 1] === undefined) {
      topos[pagina - 1] =
        pagina === 1
          ? desenharCabecalhoSync(doc, capa.faixa, logo)
          : faixaCompacta(doc, capa.faixa, logo);
    }
    return topos[pagina - 1];
  };

  let y = faixaDaPagina();
  /** Onde começa o conteúdo da página em que estamos. */
  let topo = y;

  const novaPagina = () => {
    doc.addPage();
    y = faixaDaPagina();
    topo = y;
  };
  /** Quebra antes de começar o que não cabe — a não ser que já estejamos no topo. */
  const cabe = (altura: number) => {
    if (y + altura > limite && y > topo + 0.5) novaPagina();
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

  /*
    A PRIMEIRA PÁGINA, sem página de capa: título, o PERÍODO por extenso na cor
    da casa (é a primeira pergunta de quem pega o papel), o recorte e quem
    emitiu em cinza, e uma regra fina. Depois, se houver, a observação.
  */
  if (capa.pessoa) {
    capaDaPessoa(capa.pessoa);
  } else {
    fonte(18, 'bold');
    const linhasDoTitulo = doc.splitTextToSize(capa.titulo, largura) as string[];
    doc.text(linhasDoTitulo, MARGEM, y + 5);
    y += 5 + (linhasDoTitulo.length - 1) * entrelinha(18);
    if (capa.periodo) {
      fonte(11, 'bold', VERDE);
      const linhasDoPeriodo = doc.splitTextToSize(capa.periodo, largura) as string[];
      doc.text(linhasDoPeriodo, MARGEM, y + 6.5);
      y += 6.5 + (linhasDoPeriodo.length - 1) * entrelinha(11);
    }
    fonte(8.5, 'normal', CINZA);
    const linhasDoApoio = doc.splitTextToSize(capa.apoio, largura) as string[];
    doc.text(linhasDoApoio, MARGEM, y + 5);
    y += 5 + (linhasDoApoio.length - 1) * entrelinha(8.5);
    doc.setDrawColor(222, 226, 230);
    doc.setLineWidth(0.2);
    doc.line(MARGEM, y + 3.5, MARGEM + largura, y + 3.5);
    y += 3.5 + 6;
  }
  if (capa.observacao) destaque('Observação', capa.observacao);

  const paginaDoBloco: number[] = [];
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
        destaque(bloco.rotulo, bloco.texto, bloco.fonte);
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
      case 'pessoa':
        pessoa(bloco);
        break;
      case 'caixas':
        caixas(bloco);
        break;
    }
    paginaDoBloco.push(doc.getCurrentPageInfo().pageNumber);
  }

  desenharRodapeGeracao(doc);
  return { topos: [...topos], fim: y, paginas: doc.getNumberOfPages(), paginaDoBloco };

  /**
   * O TOPO DO DOCUMENTO DE UMA PESSOA: o círculo e, ao lado, o nome, o
   * período na cor da casa e o perfil com quem emitiu. O nome comprido diminui
   * a letra antes de ganhar reticências — nome de gente não se corta à toa.
   */
  function capaDaPessoa(rosto: NonNullable<CapaDoDocumento['pessoa']>) {
    const raio = 8;
    const cx = MARGEM + raio;
    const cy = y + raio;
    if (!(rosto.foto && fotoNoCirculo(rosto.foto, cx, cy, raio))) {
      preencher(rosto.cor.fundo);
      doc.circle(cx, cy, raio, 'F');
      fonte(12, 'bold', rosto.cor.texto);
      doc.text(rosto.iniciais || '?', cx, cy + 1.5, { align: 'center' });
    }
    doc.setDrawColor(ANEL[0], ANEL[1], ANEL[2]);
    doc.setLineWidth(0.3);
    doc.circle(cx, cy, raio, 'S');
    const x = MARGEM + 2 * raio + 4.5;
    const w = MARGEM + largura - x;
    let pontos = 18;
    fonte(pontos, 'bold');
    while (pontos > 13 && doc.getTextWidth(capa.titulo) > w) {
      pontos -= 0.5;
      fonte(pontos, 'bold');
    }
    doc.text(caber(capa.titulo, w), x, y + 6);
    if (capa.periodo) {
      fonte(11, 'bold', VERDE);
      doc.text(caber(capa.periodo, w), x, y + 11.6);
    }
    fonte(8.5, 'normal', CINZA);
    doc.text(caber(capa.apoio, w), x, y + 16.2);
    doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]);
    doc.setLineWidth(0.2);
    doc.line(MARGEM, y + 19.5, MARGEM + largura, y + 19.5);
    y += 19.5 + 5;
  }

  function secao(b: De<'secao'>) {
    if (b.novaPagina && y > topo + 0.5) novaPagina();
    if (b.compacta) {
      cabe(Math.max(22, b.minimoNaPagina ?? 0));
      y += 3;
      fonte(10, 'bold', VERDE);
      doc.text(caber(b.titulo, largura), MARGEM, y);
      doc.setDrawColor(VERDE[0], VERDE[1], VERDE[2]);
      doc.setLineWidth(0.3);
      doc.line(MARGEM, y + 1.6, MARGEM + largura, y + 1.6);
      y += 5;
      if (b.subtitulo) {
        fonte(8, 'normal', CINZA);
        const linhas = doc.splitTextToSize(b.subtitulo, largura) as string[];
        doc.text(linhas, MARGEM, y + 1);
        y += linhas.length * entrelinha(8) + 1.5;
      }
      return;
    }
    cabe(Math.max(b.subtitulo ? 30 : 24, b.minimoNaPagina ?? 0));
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

  /**
   * As linhas embaixo do número, já quebradas na largura do quadro. Cada frase
   * guarda o próprio `alerta`; passando do limite, a última ganha reticências
   * — cortar sem avisar deixava a frase parecer completa.
   */
  function linhasDoQuadro(item: ItemDeNumero, max: number): { texto: string; alerta?: boolean }[] {
    const frases = item.linhas?.length ? item.linhas : item.nota ? [{ texto: item.nota }] : [];
    const saida: { texto: string; alerta?: boolean }[] = [];
    for (const frase of frases) {
      fonte(7, frase.alerta ? 'bold' : 'normal');
      for (const texto of doc.splitTextToSize(frase.texto, max) as string[]) {
        saida.push({ texto, alerta: frase.alerta });
      }
    }
    if (saida.length <= LINHAS_POR_QUADRO) return saida;
    const cortadas = saida.slice(0, LINHAS_POR_QUADRO);
    const ultima = cortadas[LINHAS_POR_QUADRO - 1];
    fonte(7, ultima.alerta ? 'bold' : 'normal');
    cortadas[LINHAS_POR_QUADRO - 1] = { ...ultima, texto: caber(`${ultima.texto}…`, max) };
    return cortadas;
  }

  function numeros(b: De<'numeros'>) {
    const porLinha = Math.max(1, Math.min(b.porFileira ?? 4, b.itens.length));
    const vao = 3;
    const w = (largura - vao * (porLinha - 1)) / porLinha;
    for (let i = 0; i < b.itens.length; i += porLinha) {
      const fileira = b.itens.slice(i, i + porLinha);
      // As linhas crescem a caixa, e a fileira inteira acompanha a mais alta.
      const linhas = fileira.map((item) => linhasDoQuadro(item, w - 6));
      const quantasLinhas = Math.max(0, ...linhas.map((l) => l.length));
      const comComparacao = fileira.some((item) => item.comparacao);
      // Com o nome do grupo em cima, tudo desce 4 mm.
      const acima = fileira.some((item) => item.grupo) ? 4 : 0;
      const h = Math.max(
        18 + acima,
        14.5 + acima + quantasLinhas * entrelinha(7) + (comComparacao ? 4.5 : 0),
      );
      cabe(h + vao);
      fileira.forEach((item, k) => {
        const x = MARGEM + k * (w + vao);
        doc.setDrawColor(222, 226, 230);
        doc.setFillColor(248, 250, 249);
        doc.setLineWidth(0.2);
        doc.roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
        if (item.grupo) {
          fonte(6.5, 'bold', CINZA);
          doc.text(caber(item.grupo.toUpperCase(), w - 6), x + 3, y + 4.6);
          fonte(16, 'bold');
          const valor = caber(item.valor, (w - 6) * 0.6);
          doc.text(valor, x + 3, y + acima + 7.8);
          const larguraDoValor = doc.getTextWidth(valor);
          fonte(8, 'normal', CINZA);
          doc.text(
            caber(item.rotulo, Math.max(4, w - 6 - larguraDoValor - 1.8)),
            x + 3 + larguraDoValor + 1.8,
            y + acima + 7.8,
          );
        } else {
          fonte(14, 'bold');
          doc.text(caber(item.valor, w - 6), x + 3, y + 7.5);
          fonte(7.5, 'normal', CINZA);
          doc.text(caber(item.rotulo, w - 6), x + 3, y + 12);
        }
        linhas[k].forEach((linha, j) => {
          fonte(7, linha.alerta ? 'bold' : 'normal', linha.alerta ? AMBAR_TXT : CINZA);
          doc.text(linha.texto, x + 3, y + acima + 15.5 + j * entrelinha(7));
        });
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
  function destaque(rotulo: string, texto: string, pontos = 9) {
    fonte(pontos);
    const linhas = doc.splitTextToSize(texto, largura - 10) as string[];
    const altura = 11 + (linhas.length - 1) * entrelinha(pontos) + 2.5;
    cabe(altura + 5);
    preencher(CASA.fundo);
    doc.rect(MARGEM, y, largura, altura, 'F');
    preencher(VERDE);
    doc.rect(MARGEM, y, 1.2, altura, 'F');
    fonte(7, 'bold', VERDE);
    doc.text(rotulo.toUpperCase(), MARGEM + 5, y + 4.8);
    fonte(pontos);
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
    const letra = b.fonte ?? 8;
    const numericas = b.numericas ?? [];
    const larguras = b.larguras ?? {};
    const estilos = b.estilos ?? {};
    const colunas = [
      ...new Set([...numericas, ...Object.keys(larguras).map(Number), ...Object.keys(estilos).map(Number)]),
    ];
    const total = b.cabecalho.length;
    // Cabeçalho em duas linhas só com `grupos`; sem eles, a linha de sempre.
    const cabecalho = b.grupos?.length
      ? [
          b.grupos.map((g) => ({ content: g.texto, colSpan: g.colunas, styles: { halign: 'center' as const } })),
          b.cabecalho,
        ]
      : [b.cabecalho];
    const alertas = new Set((b.alertas ?? []).map(([linha, coluna]) => `${linha}:${coluna}`));
    const corpo = b.linhas.map((linha, i) => {
      const especial = b.especiais?.[i];
      if (!especial) return linha;
      if (especial.tipo === 'grupo') {
        return [{
          content: (linha[0] ?? '').toUpperCase(),
          colSpan: total,
          styles: { fillColor: CASA.fundoForte, fontStyle: 'bold' as const, fontSize: Math.max(6, letra - 0.5) },
        }];
      }
      return [
        ...linha.slice(0, especial.de),
        {
          content: linha[especial.de] ?? '',
          colSpan: Math.max(1, total - especial.de),
          styles: { textColor: CINZA, fontSize: Math.max(6, letra - 1), halign: 'left' as const },
        },
      ];
    });
    autoTable(doc, {
      startY: y,
      // Nas páginas que a tabela abre, o conteúdo começa logo abaixo da faixa compacta.
      margin: { top: TOPO_DAS_PAGINAS_SEGUINTES, left: MARGEM, right: MARGEM, bottom: 18 },
      head: b.semCabecalho ? [] : cabecalho,
      body: b.linhas.length
        ? corpo
        : [[{
            content: b.vazio ?? 'Nada no período.',
            colSpan: b.cabecalho.length,
            styles: { halign: 'center', textColor: CINZA },
          }]],
      theme: 'plain',
      headStyles: { fillColor: CASA.fundoForte, textColor: TINTA, fontStyle: 'bold', fontSize: letra },
      bodyStyles: { fontSize: letra, textColor: TINTA, cellPadding: b.folga ?? 1.6 },
      alternateRowStyles: b.semListras ? {} : { fillColor: [250, 251, 250] },
      columnStyles: Object.fromEntries(
        colunas.map((coluna) => [
          coluna,
          {
            ...(numericas.includes(coluna) ? { halign: 'right' as const } : {}),
            ...(larguras[coluna] > 0 ? { cellWidth: larguras[coluna] } : {}),
            ...(estilos[coluna]?.negrito ? { fontStyle: 'bold' as const } : {}),
            ...(estilos[coluna]?.cinza ? { textColor: CINZA } : {}),
            ...(estilos[coluna]?.fonte ? { fontSize: estilos[coluna].fonte } : {}),
          },
        ]),
      ),
      // O cabeçalho da coluna de número acompanha o número, à direita.
      didParseCell: (celula) => {
        if (
          celula.section === 'head' &&
          celula.row.index === cabecalho.length - 1 &&
          numericas.includes(celula.column.index)
        ) {
          celula.cell.styles.halign = 'right';
        }
        // O cabeçalho não herda o cinza nem a letra miúda da coluna.
        if (celula.section === 'head' && estilos[celula.column.index]) {
          celula.cell.styles.textColor = TINTA;
          celula.cell.styles.fontSize = letra;
          celula.cell.styles.fontStyle = 'bold';
        }
        if (celula.section === 'body' && alertas.has(`${celula.row.index}:${celula.column.index}`)) {
          celula.cell.styles.textColor = AMBAR_TXT;
          celula.cell.styles.fontStyle = 'bold';
        }
      },
      didDrawPage: () => {
        faixaDaPagina();
      },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    topo = topos[doc.getCurrentPageInfo().pageNumber - 1] ?? topo;
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
    if (b.empilhar) {
      colunasEmpilhadas(b);
      return;
    }
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

  /**
   * AS COLUNAS EMPILHADAS — uma coluna por categoria, a primeira série na base.
   * Função própria, e não um `if` no meio de `colunas`: o gráfico do PDF do
   * sindicato e o do panorama continuam no desenho de antes, linha por linha.
   */
  function colunasEmpilhadas(b: De<'colunas'>) {
    const ALTURA = b.altura ?? 40;
    const totais = b.categorias.map((_, c) => somar(b.series.map((__, s) => b.valores[s]?.[c] ?? 0)));
    const maximo = Math.max(0, ...totais);
    const vazio = !b.categorias.length || !(maximo > 0);
    cabe(7 + (b.series.length > 1 ? 4 : 0) + (vazio ? 7 : 3 + ALTURA + (b.detalhes ? 10 : 7)) + 3);
    if (vazio || !legendaNaLinhaDoTitulo(b)) tituloDeGrafico(b.titulo, b.series, b.unidade);
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
    const coluna = Math.min(slot * 0.56, 14);
    const cabeONumero = coluna >= 3.5;
    b.categorias.forEach((_, c) => {
      const x = x0 + c * slot + (slot - coluna) / 2;
      let topoDaPilha = base;
      b.series.forEach((serie, s) => {
        const valor = b.valores[s]?.[c] ?? 0;
        if (!(valor > 0)) return;
        const h = (ALTURA * valor) / max;
        preencher(serie.cor);
        doc.rect(x, topoDaPilha - h, coluna, h, 'F');
        topoDaPilha -= h;
      });
      if (cabeONumero && totais[c] > 0) {
        fonte(6, 'bold');
        doc.text(numero(totais[c]), x + coluna / 2, topoDaPilha - 1, { align: 'center' });
      }
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

  /**
   * O título, a unidade e a legenda NUMA LINHA SÓ, com a legenda à direita —
   * quando cabem. Ganha os 4 mm da linha da legenda, que na folha da pessoa
   * decidiam entre uma e duas páginas. Devolve false (e não desenha nada)
   * quando não cabe: aí vale o título de sempre, com a legenda embaixo.
   */
  function legendaNaLinhaDoTitulo(b: De<'colunas'>): boolean {
    if (b.series.length < 2) return false;
    fonte(9, 'bold');
    const larguraDoTitulo = doc.getTextWidth(b.titulo);
    fonte(7.5, 'normal');
    const larguraDaUnidade = b.unidade ? doc.getTextWidth(b.unidade) + 2 : 0;
    fonte(7, 'normal');
    const itens = b.series.map((s) => 3.6 + doc.getTextWidth(s.nome));
    const larguraDaLegenda = itens.reduce((soma, v) => soma + v, 0) + 5 * (itens.length - 1);
    if (larguraDoTitulo + larguraDaUnidade + 6 + larguraDaLegenda > largura) return false;
    fonte(9, 'bold');
    doc.text(b.titulo, MARGEM, y + 3);
    if (b.unidade) {
      fonte(7.5, 'normal', CINZA);
      doc.text(b.unidade, MARGEM + larguraDoTitulo + 2, y + 3);
    }
    fonte(7, 'normal', CINZA);
    let x = MARGEM + largura - larguraDaLegenda;
    b.series.forEach((serie, i) => {
      preencher(serie.cor);
      doc.rect(x, y + 0.7, 2.6, 2.6, 'F');
      doc.text(serie.nome, x + 3.6, y + 3);
      x += itens[i] + 5;
    });
    y += 7;
    return true;
  }

  /**
   * AS DUAS CAIXAS — o período à esquerda, o agora à direita.
   *
   * A grade dos dias mora na caixa da esquerda. Até cerca de dez semanas ela
   * vai AO LADO do texto, com células de ~5 mm e o dia do mês dentro; acima
   * disso não sobra largura para a frase ("o período tem 64 dias de semana"),
   * e a grade ocupa a caixa de lado a lado com o texto EMBAIXO, em duas
   * colunas. A folha da pessoa não cabia de outro jeito: medido com o jsPDF
   * real em 14/09/2026 (`paginas-dos-pdfs.spec.ts`).
   */
  function caixas(b: De<'caixas'>) {
    const VAO = 4;
    const LARGURA_DA_DIREITA = 70;
    const FOLGA = 3;
    const TOPO = 6.2;
    const larguraDaEsquerda = largura - LARGURA_DA_DIREITA - VAO;
    const grade = b.esquerda.grade;
    const semanas = grade?.semanas.length ?? 0;
    const linhasDaGrade = grade?.linhas.length ?? 0;
    const temGrade = semanas > 0 && linhasDaGrade > 0;
    // A fileira de meses (15/09/2026) ocupa o lugar da grade, de lado a lado, com o texto embaixo.
    const meses = temGrade ? [] : (b.esquerda.meses ?? []);
    const temMeses = meses.length > 0;
    const temDesenho = temGrade || temMeses;
    const ROTULOS = temGrade ? 5.5 : 0;
    const util = larguraDaEsquerda - 2 * FOLGA;
    const TEXTO_AO_LADO = 46;
    const passoAoLado = temGrade ? Math.min(4.8, (util - ROTULOS - 3 - TEXTO_AO_LADO) / semanas) : 0;
    const aoLado = temGrade && passoAoLado >= (grade?.celulaMinimaAoLado ?? 4.2);
    const passoX = !temGrade ? 0 : aoLado ? passoAoLado : Math.min(4.8, (util - ROTULOS) / semanas);
    const passoY = !temGrade ? 0 : aoLado ? passoX : Math.min(passoX, 2.6);
    const alturaDaGrade = temGrade ? 3 + linhasDaGrade * passoY : temMeses ? ALTURA_DOS_MESES : 0;

    // Mede antes de desenhar, com a MESMA função: medida e desenho não divergem.
    const x0 = MARGEM + FOLGA;
    const larguraDoTextoAoLado = util - ROTULOS - semanas * passoX - 3;
    const doTexto = (l: LinhaDaCaixa) => l.tipo === 'grande' || l.tipo === 'texto' || l.tipo === 'par';
    const primeiraColuna = aoLado || !temDesenho ? b.esquerda.linhas : b.esquerda.linhas.filter(doTexto);
    const segundaColuna = aoLado || !temDesenho ? [] : b.esquerda.linhas.filter((l) => !doTexto(l));
    const larguraDaPrimeira = !temDesenho ? util : aoLado ? larguraDoTextoAoLado : util * 0.52;
    const larguraDaSegunda = util - larguraDaPrimeira - 3;
    const alturaDaPrimeira = linhasDaCaixa(primeiraColuna, 0, 0, larguraDaPrimeira, false);
    const alturaDaSegunda = linhasDaCaixa(segundaColuna, 0, 0, larguraDaSegunda, false);
    const alturaDoTexto = Math.max(alturaDaPrimeira, alturaDaSegunda);
    const alturaDaEsquerda =
      TOPO + (aoLado ? Math.max(alturaDaGrade, alturaDoTexto) : alturaDaGrade + (temDesenho ? 3 : 0) + alturaDoTexto) + 2.5;
    const larguraDaDireitaUtil = LARGURA_DA_DIREITA - 2 * FOLGA;
    const alturaDaDireita = TOPO + linhasDaCaixa(b.direita.linhas, 0, 0, larguraDaDireitaUtil, false) + 2.5;
    const h = Math.max(30, alturaDaEsquerda, alturaDaDireita);
    cabe(h + VAO);

    const xDireita = MARGEM + larguraDaEsquerda + VAO;
    doc.setLineWidth(0.2);
    doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]);
    doc.roundedRect(MARGEM, y, larguraDaEsquerda, h, 1.5, 1.5, 'S');
    if (b.direita.fundo) preencher(FUNDO_DO_AGORA);
    doc.roundedRect(xDireita, y, LARGURA_DA_DIREITA, h, 1.5, 1.5, b.direita.fundo ? 'FD' : 'S');
    for (const [caixa, x, w] of [
      [b.esquerda, MARGEM, larguraDaEsquerda],
      [b.direita, xDireita, LARGURA_DA_DIREITA],
    ] as const) {
      fonte(6.5, 'bold', CINZA);
      doc.text(caber(caixa.rotulo.toUpperCase(), w - 2 * FOLGA), x + FOLGA, y + 4.3);
    }
    const yConteudo = y + TOPO;
    if (temGrade && grade) desenharGrade(grade, x0, yConteudo, passoX, passoY, ROTULOS);
    if (temMeses) desenharMeses(meses, x0, yConteudo, util);
    if (aoLado) {
      linhasDaCaixa(primeiraColuna, x0 + ROTULOS + semanas * passoX + 3, yConteudo, larguraDaPrimeira, true);
    } else {
      const yTexto = yConteudo + alturaDaGrade + (temDesenho ? 3 : 0);
      linhasDaCaixa(primeiraColuna, x0, yTexto, larguraDaPrimeira, true);
      linhasDaCaixa(segundaColuna, x0 + larguraDaPrimeira + 3, yTexto, larguraDaSegunda, true);
    }
    linhasDaCaixa(b.direita.linhas, xDireita + FOLGA, yConteudo, larguraDaDireitaUtil, true);
    y += h + VAO;
  }

  /**
   * A FILEIRA DOS MESES: o nome, os dias com uso em negrito e uma barrinha da
   * própria pessoa (dias com uso contra os dias de semana do mês). Nunca de
   * gente contra gente. Mês em que a conta ainda não existia leva só o nome e
   * um traço.
   */
  function desenharMeses(ms: MesDaCaixa[], x: number, y0: number, w: number) {
    const passo = w / ms.length;
    const larguraDaBarra = passo - Math.min(1.2, passo * 0.18);
    ms.forEach((m, i) => {
      const xm = x + i * passo;
      fonte(6, 'normal', CINZA);
      doc.text(caber(m.rotulo, larguraDaBarra), xm, y0 + 2.2);
      if (m.dias === null) {
        fonte(7.5, 'normal', CINZA);
        doc.text('—', xm, y0 + 5.6);
        return;
      }
      fonte(7.5, 'bold');
      doc.text(caber(numero(m.dias), larguraDaBarra), xm, y0 + 5.6);
      preencher(DIA_SEM_USO);
      doc.rect(xm, y0 + 6.8, larguraDaBarra, 1.4, 'F');
      const cheia = Math.max(0, Math.min(1, m.proporcao));
      if (cheia > 0) {
        preencher(VERDE);
        doc.rect(xm, y0 + 6.8, larguraDaBarra * cheia, 1.4, 'F');
      }
    });
  }

  /** A grade: rótulo das semanas em cima, das linhas à esquerda, e uma célula por dia. */
  function desenharGrade(g: GradeDoPdf, x: number, y0: number, passoX: number, passoY: number, rotulos: number) {
    const vaoX = passoX > 3 ? 0.6 : passoX * 0.16;
    const vaoY = passoY > 3 ? 0.6 : passoY * 0.16;
    const w = passoX - vaoX;
    const h = passoY - vaoY;
    const xCelulas = x + rotulos;
    const yCelulas = y0 + 3;
    // O rótulo de cima só sai se não encostar no anterior ("ago" numa semana de 1,7 mm).
    fonte(6, 'normal', CINZA);
    let livreAPartirDe = -Infinity;
    g.semanas.forEach((semana, s) => {
      if (!semana.rotulo) return;
      const xr = xCelulas + s * passoX;
      if (xr < livreAPartirDe) return;
      doc.text(semana.rotulo, xr, y0 + 2);
      livreAPartirDe = xr + doc.getTextWidth(semana.rotulo) + 0.8;
    });
    fonte(passoY < 2.6 ? 5.5 : 6.5, 'normal', CINZA);
    g.linhas.forEach((rotulo, l) => {
      if (rotulo) doc.text(rotulo, x, yCelulas + l * passoY + h / 2 + 0.9);
    });
    const comDia = w >= 4 && h >= 3.6;
    g.semanas.forEach((semana, s) => {
      semana.dias.forEach((dia, l) => {
        if (!dia) return;
        const xc = xCelulas + s * passoX;
        const yc = yCelulas + l * passoY;
        const r = Math.min(0.5, w / 6);
        if (dia.usou) {
          preencher(VERDE);
          doc.roundedRect(xc, yc, w, h, r, r, 'F');
        } else if (dia.fimDeSemana) {
          preencher(FIM_DE_SEMANA);
          doc.setDrawColor(CONTORNO_DO_FIM_DE_SEMANA[0], CONTORNO_DO_FIM_DE_SEMANA[1], CONTORNO_DO_FIM_DE_SEMANA[2]);
          doc.setLineWidth(0.1);
          doc.roundedRect(xc, yc, w, h, r, r, 'FD');
        } else {
          preencher(DIA_SEM_USO);
          doc.roundedRect(xc, yc, w, h, r, r, 'F');
        }
        if (comDia) {
          fonte(5.5, 'normal', dia.usou ? ([255, 255, 255] as Cor) : CINZA);
          doc.text(String(dia.dia), xc + w / 2, yc + h / 2 + 0.7, { align: 'center' });
        }
      });
    });
  }

  /**
   * O conteúdo de uma caixa, de cima para baixo. Com `desenhar` falso só mede —
   * é a mesma conta nos dois casos, e a altura da caixa não mente.
   */
  function linhasDaCaixa(linhas: LinhaDaCaixa[], x: number, y0: number, w: number, desenhar: boolean): number {
    let cy = y0;
    linhas.forEach((linha, i) => {
      if (i > 0 && linha.tipo === 'par') cy += 1.4;
      switch (linha.tipo) {
        case 'grande': {
          fonte(14, 'bold');
          if (desenhar) doc.text(caber(linha.texto, w), x, cy + 4.6);
          cy += 6.4;
          break;
        }
        case 'texto': {
          fonte(8, 'normal', CINZA);
          const partes = doc.splitTextToSize(linha.texto, w) as string[];
          if (desenhar) doc.text(partes, x, cy + 2.8);
          cy += partes.length * entrelinha(8) + 0.4;
          break;
        }
        case 'par': {
          fonte(7, 'normal', CINZA);
          const larguraDoRotulo = doc.getTextWidth(linha.rotulo);
          fonte(9.5, 'bold');
          const larguraDoValor = doc.getTextWidth(linha.valor);
          const naMesmaLinha = larguraDoRotulo + 3 + larguraDoValor <= w;
          const corDoValor = linha.alerta ? AMBAR_TXT : TINTA;
          if (naMesmaLinha) {
            if (desenhar) {
              fonte(7, 'normal', CINZA);
              doc.text(linha.rotulo, x, cy + 3.6);
              fonte(9.5, 'bold', corDoValor);
              doc.text(linha.valor, x + w, cy + 3.6, { align: 'right' });
            }
            cy += 4.9;
          } else {
            if (desenhar) {
              fonte(7, 'normal', CINZA);
              doc.text(caber(linha.rotulo, w), x, cy + 2.6);
              fonte(9.5, 'bold', corDoValor);
              doc.text(caber(linha.valor, w), x, cy + 6.6);
            }
            cy += 7.9;
          }
          if (linha.abaixo) {
            fonte(8.5, 'bold', linha.abaixo.alerta ? AMBAR_TXT : CINZA);
            if (desenhar) {
              const texto = caber(linha.abaixo.texto, w);
              if (naMesmaLinha) doc.text(texto, x + w, cy + 2.9, { align: 'right' });
              else doc.text(texto, x, cy + 2.9);
            }
            cy += 3.9;
          }
          break;
        }
        case 'chave': {
          fonte(6.5, 'normal', CINZA);
          const QUADRADO = 2.4;
          let cx = x;
          let fileira = 0;
          linha.itens.forEach((item, k) => {
            const largo = QUADRADO + 1 + doc.getTextWidth(item.texto);
            if (k > 0 && cx + largo > x + w) {
              cx = x;
              fileira += 1;
            }
            const yc = cy + fileira * 3.4;
            if (desenhar) {
              const cor = item.cor === 'cheia' ? VERDE : item.cor === 'vazia' ? DIA_SEM_USO : FIM_DE_SEMANA;
              preencher(cor);
              if (item.cor === 'fimDeSemana') {
                doc.setDrawColor(CONTORNO_DO_FIM_DE_SEMANA[0], CONTORNO_DO_FIM_DE_SEMANA[1], CONTORNO_DO_FIM_DE_SEMANA[2]);
                doc.setLineWidth(0.1);
                doc.rect(cx, yc + 0.4, QUADRADO, QUADRADO, 'FD');
              } else {
                doc.rect(cx, yc + 0.4, QUADRADO, QUADRADO, 'F');
              }
              fonte(6.5, 'normal', CINZA);
              doc.text(item.texto, cx + QUADRADO + 1, yc + 2.5);
            }
            cx += largo + 3;
          });
          cy += (fileira + 1) * 3.4 + 0.4;
          break;
        }
        case 'pe': {
          fonte(6.5, 'normal', CINZA);
          const partes = doc.splitTextToSize(linha.texto, w) as string[];
          if (desenhar) doc.text(partes, x, cy + 2.4);
          cy += partes.length * entrelinha(6.5) + 0.4;
          break;
        }
      }
    });
    return cy - y0;
  }

  function faixa(b: De<'faixa'>) {
    const quantas = b.marcas.length;
    const vao = quantas > 40 ? 0.35 : 0.6;
    const w = quantas ? Math.min(5, (largura - vao * (quantas - 1)) / quantas) : 0;
    const fimDaFaixa = quantas ? MARGEM + quantas * w + (quantas - 1) * vao : MARGEM + largura;
    const comDatas = !!(b.inicio && b.fim) && quantas > 0;
    const linhaDaLegenda = comDatas ? 11.4 : 8.2;
    // A chave vai à direita da legenda quando cabe; senão, na linha de baixo.
    fonte(7.5);
    const larguraDaLegenda = doc.getTextWidth(b.legenda);
    fonte(7);
    const chaveAoLado = !!b.chave && larguraDaLegenda + 5 + doc.getTextWidth(b.chave) <= largura;
    const altura = linhaDaLegenda + 4.8 + (b.chave && !chaveAoLado ? 3.8 : 0);
    cabe(altura);
    if (quantas) {
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
    if (comDatas) {
      // As datas nas pontas; faixa curta demais para as duas leva "13/07 a 19/07" à esquerda.
      fonte(6.5, 'normal', CINZA);
      const inicio = b.inicio as string;
      const fim = b.fim as string;
      if (fimDaFaixa - MARGEM >= doc.getTextWidth(inicio) + doc.getTextWidth(fim) + 4) {
        doc.text(inicio, MARGEM, y + 7.2);
        doc.text(fim, fimDaFaixa, y + 7.2, { align: 'right' });
      } else {
        doc.text(`${inicio} a ${fim}`, MARGEM, y + 7.2);
      }
    }
    fonte(7.5, 'normal', CINZA);
    doc.text(caber(b.legenda, largura), MARGEM, y + linhaDaLegenda);
    if (b.chave) {
      fonte(7, 'normal', CINZA);
      if (chaveAoLado) doc.text(b.chave, MARGEM + largura, y + linhaDaLegenda, { align: 'right' });
      else doc.text(caber(b.chave, largura), MARGEM, y + linhaDaLegenda + 3.8);
    }
    y += altura;
  }

  /**
   * O CARTÃO DA PESSOA. A foto entra recortada num círculo vetorial (JPEG com
   * `clip`, e não PNG redondo com transparência: 3 a 4 vezes mais leve e borda
   * nítida na impressão). Qualquer falha ao abrir a foto cai nas iniciais.
   */
  function pessoa(b: De<'pessoa'>) {
    if (b.novaPagina && y > topo + 0.5) novaPagina();
    const raio = 7;
    cabe(2 * raio + 8);
    const cx = MARGEM + raio;
    const cy = y + raio;
    if (!(b.foto && fotoNoCirculo(b.foto, cx, cy, raio))) {
      preencher(b.cor.fundo);
      doc.circle(cx, cy, raio, 'F');
      fonte(11, 'bold', b.cor.texto);
      doc.text(b.iniciais || '?', cx, cy + 1.4, { align: 'center' });
    }
    doc.setDrawColor(ANEL[0], ANEL[1], ANEL[2]);
    doc.setLineWidth(0.3);
    doc.circle(cx, cy, raio, 'S');
    const x = MARGEM + 2 * raio + 4;
    fonte(13, 'bold');
    doc.text(caber(b.nome, MARGEM + largura - x), x, y + 6.2);
    fonte(8.5, 'normal', CINZA);
    doc.text(caber(b.linha, MARGEM + largura - x), x, y + 11.4);
    y += 2 * raio + 5;
  }

  /** Desenha a foto dentro do círculo. Devolve false se ela não abrir — e o estado gráfico volta sempre. */
  function fotoNoCirculo(foto: string, cx: number, cy: number, r: number): boolean {
    /*
      O jsPDF aceita lixo em silêncio: sem esta conferência, uma foto que não
      abre deixava o círculo vazio, sem foto e sem iniciais. Só passa JPEG de
      verdade (assinatura FF D8 FF) que o próprio jsPDF consegue ler.
    */
    if (!pareceJpeg(foto)) return false;
    try {
      const propriedades = doc.getImageProperties(foto);
      if (!(propriedades.width > 0 && propriedades.height > 0)) return false;
    } catch {
      return false;
    }
    doc.saveGraphicsState();
    try {
      doc.circle(cx, cy, r, null);
      doc.clip();
      doc.discardPath();
      doc.addImage(foto, 'JPEG', cx - r, cy - r, 2 * r, 2 * r);
      return true;
    } catch {
      return false;
    } finally {
      doc.restoreGraphicsState();
    }
  }
}

/**
 * É um JPEG de verdade? A assinatura FF D8 FF, em base64, começa por "/9j/".
 * Qualquer outra coisa (PNG, texto, resposta torta) sai com as iniciais.
 */
export function pareceJpeg(foto: string): boolean {
  return /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(foto);
}

/** A faixa de 14 mm das páginas seguintes: logo pequeno (ou a sigla) e o texto da faixa à direita. */
function faixaCompacta(doc: jsPDF, texto: string, logo: Logo): number {
  const larguraPagina = doc.internal.pageSize.getWidth();
  doc.setFillColor(VERDE[0], VERDE[1], VERDE[2]);
  doc.rect(0, 0, larguraPagina, ALTURA_DA_FAIXA_COMPACTA, 'F');
  if (logo) {
    const h = 6.5;
    doc.addImage(logo.dataUrl, 'PNG', MARGEM, (ALTURA_DA_FAIXA_COMPACTA - h) / 2, Math.min(h * logo.ratio, 34), h);
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(tenant.sigla, MARGEM, 9.2);
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(texto, larguraPagina - MARGEM, 9, { align: 'right', maxWidth: larguraPagina - MARGEM - 60 });
  return TOPO_DAS_PAGINAS_SEGUINTES;
}

/** Desenha num documento descartável e devolve a medida — nada é baixado. */
export type MedidorDeDocumento = (capa: CapaDoDocumento, blocos: BlocoDoPdf[]) => DesenhoDoDocumento;

/**
 * O MEDIDOR (14/09/2026): o mesmo `montarDocumento`, num documento que se joga
 * fora, para saber se o que foi pedido cabe ANTES de baixar. Sem logo: a faixa
 * tem a mesma altura com ou sem ele, e a medida não muda.
 */
export async function abrirMedidorDeDocumento(): Promise<MedidorDeDocumento> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  return (capa, blocos) =>
    montarDocumento(new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' }), autoTable, capa, blocos, null);
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
