import PDFDocument from 'pdfkit';
import { lerLogoDaMarca } from '../../common/assets.util';
import { tenant } from '../../tenant/tenant.config';
import type { SituacaoFiscal } from './leitura-fiscal.util';

/**
 * O QUE OS DOIS PDFs DE CONTAS PÚBLICAS DIVIDEM — cores, números e cabeçalho.
 *
 * Eram um só (o relatório geral). Com a ficha de negociação por ente, a faixa
 * verde, o formato de número e a cor de cada situação passariam a existir em
 * dois arquivos, e a primeira correção de um deles faria os dois papéis
 * discordarem sobre a mesma prefeitura.
 */

export type Documento = InstanceType<typeof PDFDocument>;

export const COR = {
  VERDE_ESCURO: '#1B7F0A',
  VERDE_MEDIO: '#4FA11B',
  TEXTO: '#111827',
  ROTULO: '#374151',
  SECUNDARIO: '#6B7280',
  FILETE: '#E5E7EB',
  FUNDO: '#F9FAFB',
  SOBRE_FAIXA: '#E8F5E3',
  VERMELHO: '#b91c1c',
  AMBAR: '#b45309',
} as const;

/** A cor de cada situação no papel — texto colorido, sem fundo, que gasta tinta e não imprime bem. */
export const COR_SITUACAO: Record<SituacaoFiscal, string> = {
  ACIMA_DO_TETO: COR.VERMELHO,
  PRUDENCIAL: COR.AMBAR,
  ALERTA: COR.AMBAR,
  REGULAR: COR.VERDE_ESCURO,
  INCONSISTENTE: COR.SECUNDARIO,
  SEM_DADO: COR.SECUNDARIO,
  NAO_CONSULTADO: COR.SECUNDARIO,
};

export const ROTULO_SITUACAO: Record<SituacaoFiscal, string> = {
  ACIMA_DO_TETO: 'acima do teto',
  PRUDENCIAL: 'no prudencial',
  ALERTA: 'em alerta',
  REGULAR: 'dentro do limite',
  INCONSISTENTE: 'declaração não fecha',
  SEM_DADO: 'não publicou',
  NAO_CONSULTADO: 'não consultado',
};

/**
 * NÚMERO NO FORMATO DAQUI, SEM `toLocaleString` — e a razão não é preciosismo.
 *
 * O projeto proíbe `toLocaleString` fora de `data-br.util`, e um teste global
 * reprova quem usar. A regra é cega de propósito: nasceu de 26 formatações de
 * DATA que saíam no fuso do contêiner (UTC), e uma regra com exceções deixa de
 * ser lida. Formatar número é inofensivo, mas abrir a exceção custaria mais que
 * estas seis linhas.
 */
export function numeroBR(n: number, casas: number): string {
  const [inteiro, decimal] = Math.abs(n).toFixed(casas).split('.');
  const comPontos = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}${comPontos}${decimal ? ',' + decimal : ''}`;
}

export const pctBR = (n: number | null | undefined) => (n == null ? '—' : `${numeroBR(n, 2)}%`);

/** Dinheiro público em escala legível: ninguém lê os dígitos do meio de R$ 1.798.591.840,56. */
export function dinheiroBR(n: number): string {
  const abs = Math.abs(n);
  const sinal = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sinal}R$ ${numeroBR(abs / 1e9, 2)} bi`;
  if (abs >= 1e6) return `${sinal}R$ ${numeroBR(abs / 1e6, 1)} mi`;
  if (abs >= 1e3) return `${sinal}R$ ${numeroBR(abs / 1e3, 0)} mil`;
  return `${sinal}R$ ${numeroBR(abs, 2)}`;
}

/**
 * COMO CHAMAR O ENTE numa frase. "Prefeitura" e não "Município" porque o
 * relatório lido é o do PODER EXECUTIVO (`co_poder=E`): a Câmara tem limite
 * próprio, de 6%, e não está nestes números.
 */
export function nomeDoEnte(e: { nome: string; uf: string; esfera: string }): string {
  if (e.esfera === 'M') return `Prefeitura de ${e.nome} (${e.uf})`;
  if (e.esfera === 'E') return `Governo do Estado — ${e.nome}`;
  return e.nome;
}

/** A faixa verde com a marca — a mesma de todo documento do sistema. */
export function desenharCabecalho(doc: Documento): void {
  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  doc.rect(0, 0, doc.page.width, 74).fill(COR.VERDE_ESCURO);
  const logo = lerLogoDaMarca();
  let desenhou = false;
  if (logo) {
    try {
      doc.image(logo, L, 18, { fit: [150, 38] });
      desenhou = true;
    } catch {
      /* logo corrompido — cai no nome */
    }
  }
  if (!desenhou) doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(16).text(tenant.sigla, L, 26);
  doc
    .fillColor(COR.SOBRE_FAIXA)
    .font('Helvetica')
    .fontSize(7.5)
    .text(`${tenant.nome}\nCNPJ: ${tenant.cnpj}`, R - 240, 22, { width: 240, align: 'right' });
  doc.rect(0, 74, doc.page.width, 4).fill(COR.VERDE_MEDIO);
}

/** Onde o conteúdo recomeça depois do cabeçalho. */
export const TOPO_DO_CONTEUDO = 96;
