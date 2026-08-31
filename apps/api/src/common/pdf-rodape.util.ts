/**
 * O RODAPÉ QUE CRIAVA UMA PÁGINA EM BRANCO.
 *
 * O defeito, visto no Termo de Desfiliação em 31/08/2026: o PDF saía com DUAS
 * folhas e a segunda inteiramente vazia — só com o rodapé repetido.
 *
 * A causa não estava no conteúdo do termo, e sim no próprio rodapé. Os três
 * documentos A4 do sistema nascem com `margin: 50`, ou seja, a área de texto
 * termina em `841,89 - 50 = 791,89`. O rodapé era escrito em
 * `page.height - 42 = 799,89` — OITO PONTOS ABAIXO da margem inferior. O
 * PDFKit, ao receber um `text()` que começa fora da área útil, faz a única
 * coisa que sabe: abre uma página nova e escreve lá. E como o laço percorre o
 * `bufferedPageRange()` capturado ANTES, a folha recém-criada nunca recebe
 * rodapé nenhum — fica em branco.
 *
 * Medido isoladamente, com o mesmo padrão dos três serviços: 2 páginas sem a
 * correção, 1 com ela.
 *
 * A correção é a idiomática do PDFKit: zerar a margem inferior enquanto se
 * carimba o rodapé e devolvê-la em seguida. Zerar é seguro porque aqui não há
 * fluxo de texto — é uma linha só, em posição absoluta, com `lineBreak: false`
 * para que nem um rodapé longo demais provoque a quebra de novo.
 */
type DocPdf = {
  page: { height: number; width: number; margins: { left: number; right: number; bottom: number } };
  bufferedPageRange(): { start: number; count: number };
  switchToPage(n: number): unknown;
  moveTo(x: number, y: number): DocPdf;
  lineTo(x: number, y: number): DocPdf;
  strokeColor(c: string): DocPdf;
  lineWidth(n: number): DocPdf;
  stroke(): DocPdf;
  font(f: string): DocPdf;
  fontSize(n: number): DocPdf;
  fillColor(c: string): DocPdf;
  text(t: string, x: number, y: number, o?: Record<string, unknown>): DocPdf;
};

export type EstiloRodape = {
  /** Distância da borda inferior. O padrão é o que os três documentos já usavam. */
  altura?: number;
  fonte?: string;
  corpo?: number;
  cor?: string;
  /** `null` desenha o documento sem o filete acima do rodapé. */
  corDaLinha?: string | null;
  espessuraDaLinha?: number;
  /**
   * Acrescenta "Página N de T" abaixo do rodapé.
   *
   * O total é contado DENTRO do laço, e não antes: era esse o segundo defeito
   * do dossiê de evento. Como o próprio rodapé abria uma página fantasma, o
   * total lido antes ficava defasado e o documento de duas folhas anunciava
   * "Página 1 de 1".
   */
  numerarPaginas?: boolean;
};

/**
 * Carimba o mesmo rodapé em TODAS as páginas já bufferizadas.
 *
 * Exige `bufferPages: true` no documento — sem isso o `switchToPage` não
 * existe e só a última página receberia o carimbo.
 */
export function carimbarRodape(doc: DocPdf, texto: string, estilo: EstiloRodape = {}): void {
  const {
    altura = 42,
    fonte = 'Helvetica',
    corpo = 6.5,
    cor = '#4b5563',
    corDaLinha = '#9ca3af',
    espessuraDaLinha = 0.5,
    numerarPaginas = false,
  } = estilo;

  const X = doc.page.margins.left;
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const total = doc.bufferedPageRange().count;
  const range = doc.bufferedPageRange();

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    const y = doc.page.height - altura;
    if (corDaLinha) {
      // O filete é vetorial: não passa pelo fluxo de texto e nunca pagina.
      doc.moveTo(X, y - 8).lineTo(X + W, y - 8).strokeColor(corDaLinha).lineWidth(espessuraDaLinha).stroke();
    }

    const margemOriginal = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    try {
      doc
        .font(fonte)
        .fontSize(corpo)
        .fillColor(cor)
        .text(texto, X, y, { align: 'center', width: W, lineBreak: false });
      if (numerarPaginas) {
        doc
          .fontSize(corpo + 0.5)
          .text(`Página ${i + 1} de ${total}`, X, y + 14, {
            align: 'center',
            width: W,
            lineBreak: false,
          });
      }
    } finally {
      // Devolver a margem importa: o documento pode continuar sendo escrito
      // depois, e uma margem zerada faria o texto seguinte invadir o rodapé.
      doc.page.margins.bottom = margemOriginal;
    }
  }
}
