/**
 * AS CONTAS DOS GRÁFICOS DO PDF — sem desenho e sem jsPDF.
 *
 * Tudo o que decide um número no eixo, o texto de uma comparação ou o que cabe
 * numa barra mora aqui, em função pura: é o que se prova em teste. O desenho
 * (`pdf-documento.ts`) só obedece.
 */

import { tenant } from '@/tenant.config';
import { hexParaRgb } from './iniciais';

export type Cor = [number, number, number];

/** As cores da casa que o papel usa. */
export interface CoresDaInstalacao {
  /** A cor institucional (tom 800): faixa, títulos, barra principal. */
  principal: Cor;
  /** O tom médio (400): a segunda parte de uma barra empilhada. */
  media: Cor;
  /**
   * O tom claro (300): o topo da coluna empilhada do PDF do uso ("depois do
   * dia marcado"), em 14/09/2026. Contra o 800 da base continua distinto no
   * papel impresso em preto e branco, nas duas paletas.
   */
  clara: Cor;
  /** O fundo mais claro (50): a caixa do destaque. */
  fundo: Cor;
  /** O fundo claro (100): o cabeçalho das tabelas. */
  fundoForte: Cor;
}

/**
 * A COR DA INSTALAÇÃO, e não o verde do SENATEPI cravado.
 *
 * O PDF do SINDSERM saía verde. A paleta é a mesma que o Tailwind lê, então o
 * papel e a tela passam a ter a mesma cor. Tom ausente ou escrito errado cai no
 * tom do SENATEPI de antes: o PDF nunca sai com NaN por causa de uma paleta.
 * O âmbar NÃO vem daqui — atenção tem a mesma cor em qualquer sindicato.
 */
export function corDaInstalacao(paleta: Record<string, string>): CoresDaInstalacao {
  return {
    principal: hexParaRgb(paleta['800']) ?? [27, 127, 10],
    media: hexParaRgb(paleta['400']) ?? [132, 190, 112],
    clara: hexParaRgb(paleta['300']) ?? [181, 210, 104],
    fundo: hexParaRgb(paleta['50']) ?? [243, 247, 244],
    fundoForte: hexParaRgb(paleta['100']) ?? [238, 243, 240],
  };
}

export const CASA = corDaInstalacao(tenant.paleta);

/**
 * A PALETA DOS GRÁFICOS. `verde` é a cor da casa — o nome ficou porque outros
 * PDFs o leem; no SINDSERM, ele é azul. O âmbar aparece só onde a tela também o
 * usa (sentença improcedente); vermelho não entra — no sistema, vermelho quer
 * dizer "faça algo agora", e papel de relatório não pede isso.
 */
export const PALETA = {
  verde: CASA.principal,
  verdeClaro: CASA.media,
  ambar: [214, 146, 32] as Cor,
  petroleo: [14, 116, 144] as Cor,
  argila: [168, 120, 78] as Cor,
};

export const numero = (v: number) => v.toLocaleString('pt-BR');

/**
 * O EIXO COM NÚMEROS REDONDOS — 0, 10, 20, 30, 40, e não 0, 9,25, 18,5.
 *
 * No máximo quatro intervalos, passos de 1, 2 ou 5 vezes uma potência de dez,
 * e nunca fração: aqui só se conta coisa inteira.
 */
export function escalaDoEixo(maximo: number): { max: number; passos: number[] } {
  if (!(maximo > 0)) return { max: 1, passos: [0, 1] };
  const bruto = maximo / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const fracao = bruto / potencia;
  const base = fracao <= 1 ? 1 : fracao <= 2 ? 2 : fracao <= 5 ? 5 : 10;
  const passo = Math.max(1, Math.round(base * potencia));
  const max = Math.ceil(maximo / passo) * passo;
  const passos: number[] = [];
  for (let v = 0; v <= max; v += passo) passos.push(v);
  return { max, passos };
}

/** Abaixo disto, a variação sai em unidades: de 2 para 3 é "+1", e não "+50%". */
export const BASE_MINIMA_PARA_PORCENTAGEM = 10;

/**
 * QUANTO MUDOU — "+12%", "-3", "igual".
 *
 * Base pequena não vira porcentagem: num papel de assembleia, "+50%" sobre dois
 * atendimentos soa como explosão. Sem seta e sem cor: subir nem sempre é bom
 * (atraso sobe, atendimento também), e o PDF não julga.
 */
export function variacao(atual: number, anterior: number): string {
  if (atual === anterior) return 'igual';
  const diferenca = Math.abs(atual - anterior);
  const sinal = atual > anterior ? '+' : '-';
  if (anterior < BASE_MINIMA_PARA_PORCENTAGEM) return `${sinal}${numero(diferenca)}`;
  const porcento = Math.round((diferenca / anterior) * 100);
  // 1.000 para 1.003 arredonda para 0% — e "igual" seria mentira.
  return porcento === 0 ? `${sinal}${numero(diferenca)}` : `${sinal}${porcento}%`;
}

/** "antes 34 · +12%" — a linha que cabe embaixo de um número. */
export function textoDaComparacao(atual: number, anterior: number): string {
  return `antes ${numero(anterior)} · ${variacao(atual, anterior)}`;
}

/**
 * LISTA LONGA VIRA "OUTROS": as primeiras barras e a soma do resto numa só.
 * O total não muda — a cauda só deixa de ocupar a página.
 */
export function agruparResto(
  itens: { rotulo: string; total: number }[],
  limite: number,
): { rotulo: string; total: number }[] {
  const limpos = itens.map(({ rotulo, total }) => ({ rotulo, total }));
  if (limpos.length <= limite) return limpos;
  const resto = limpos.slice(limite - 1);
  return [
    ...limpos.slice(0, limite - 1),
    { rotulo: `${resto.length} outros`, total: resto.reduce((soma, i) => soma + i.total, 0) },
  ];
}

/** Mistura a cor com o papel: 1 é a cor cheia, 0 é branco. É o tom das semanas na faixa. */
export function clarear(cor: Cor, intensidade: number): Cor {
  const t = Math.max(0, Math.min(1, intensidade));
  return cor.map((c) => Math.round(255 - (255 - c) * t)) as Cor;
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-09" vira "set" — ou "set/26", quando os meses atravessam o ano. */
export function rotulosDosMeses(meses: string[]): string[] {
  const variosAnos = new Set(meses.map((m) => m.slice(0, 4))).size > 1;
  return meses.map((m) => {
    const curto = MESES_CURTOS[Number(m.slice(5, 7)) - 1] ?? m;
    return variosAnos ? `${curto}/${m.slice(2, 4)}` : curto;
  });
}

/** De quantas em quantas colunas vai um rótulo, para que nenhum encoste no vizinho. */
export function passoDosRotulos(larguraDaColuna: number, larguraDoRotulo: number): number {
  if (!(larguraDaColuna > 0)) return 1;
  return Math.max(1, Math.ceil(larguraDoRotulo / larguraDaColuna));
}

/**
 * AS LETRAS QUE A FONTE PADRÃO DO PDF SABE DESENHAR.
 *
 * O jsPDF, sem fonte embutida, escreve em WinAnsi: acento, "·", "—" e aspas
 * curvas passam; seta, sinal de menos tipográfico e emoji viram lixo no papel
 * — em silêncio. Os planos dos PDFs passam por aqui em teste.
 */
const EXTRAS_DO_WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';

export function foraDaFontePadrao(texto: string): string[] {
  return [...new Set([...texto].filter((c) => {
    const codigo = c.codePointAt(0) ?? 0;
    if (codigo === 10 || (codigo >= 32 && codigo <= 126) || (codigo >= 160 && codigo <= 255)) return false;
    return !EXTRAS_DO_WINANSI.includes(c);
  }))];
}

const TROCAS: Record<string, string> = { '−': '-', '→': '-', '←': '-', '\t': ' ', '\r': '' };

/** O que não se desenha vira o parente mais próximo (o menos vira hífen) ou some. */
export function paraAFontePadrao(texto: string): string {
  return [...texto]
    .map((c) => (c in TROCAS ? TROCAS[c] : foraDaFontePadrao(c).length ? '' : c))
    .join('');
}
