import type { jsPDF } from 'jspdf';

// Paleta institucional para os documentos.
export const VERDE: [number, number, number] = [27, 127, 10]; // senatepi-800
export const CINZA: [number, number, number] = [90, 100, 110];
export const AMBAR_BG: [number, number, number] = [255, 247, 237];
export const AMBAR_BORDA: [number, number, number] = [245, 158, 11];
export const AMBAR_TXT: [number, number, number] = [146, 64, 14];

interface LogoData {
  dataUrl: string;
  ratio: number; // largura / altura
}

const cacheLogo: Record<string, LogoData | null> = {};

/**
 * Carrega a logo oficial de /public e devolve como data URL (base64) + proporção.
 * Same-origin (sem CORS). Cacheado. Retorna null se indisponível (fallback textual).
 */
export async function carregarLogo(cor: 'verde' | 'branco'): Promise<LogoData | null> {
  if (cor in cacheLogo) return cacheLogo[cor];
  try {
    const res = await fetch(`/senatepi-horizontal-${cor}.png`);
    if (!res.ok) throw new Error('logo indisponível');
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const ratio = await new Promise<number>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth / img.naturalHeight || 3.2);
      img.onerror = () => resolve(3.2);
      img.src = dataUrl;
    });
    cacheLogo[cor] = { dataUrl, ratio };
    return cacheLogo[cor];
  } catch {
    cacheLogo[cor] = null;
    return null;
  }
}

export const MARGEM = 16;
const BAND_H = 30;

/**
 * Desenha o cabeçalho institucional (faixa verde + logo branca + título à direita)
 * usando uma logo JÁ carregada. Síncrono — pode ser chamado dentro do hook
 * `didDrawPage` do autotable (por página). Retorna o Y do início do conteúdo.
 */
export function desenharCabecalhoSync(doc: jsPDF, titulo: string, logo: LogoData | null): number {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(...VERDE);
  doc.rect(0, 0, pageW, BAND_H, 'F');

  if (logo) {
    const h = 13;
    const w = Math.min(h * logo.ratio, 70);
    doc.addImage(logo.dataUrl, 'PNG', MARGEM, (BAND_H - h) / 2, w, h);
  } else {
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('SENATEPI', MARGEM, 18);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(titulo, pageW - MARGEM, 18, { align: 'right', maxWidth: pageW - MARGEM - 80 });

  return BAND_H + 10;
}

/** Versão assíncrona: carrega a logo e desenha o cabeçalho. Retorna o Y do conteúdo. */
export async function desenharCabecalho(doc: jsPDF, titulo: string): Promise<number> {
  const logo = await carregarLogo('branco');
  return desenharCabecalhoSync(doc, titulo, logo);
}

/**
 * Desenha, em TODAS as páginas, o rodapé com a data/hora de geração e a paginação
 * (prova de integridade da lista). Chame por último, após todo o conteúdo.
 */
export function desenharRodapeGeracao(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  const emissao = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(220, 224, 228);
    doc.line(MARGEM, pageH - 12, pageW - MARGEM, pageH - 12);
    doc.setTextColor(...CINZA);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Documento gerado em ${emissao} — SENATEPI`, MARGEM, pageH - 7);
    doc.text(`Página ${i} de ${total}`, pageW - MARGEM, pageH - 7, { align: 'right' });
  }
}
