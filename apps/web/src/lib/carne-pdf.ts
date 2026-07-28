import { jsPDF } from 'jspdf';
import {
  VERDE, CINZA, MARGEM, desenharCabecalho, desenharRodapeGeracao,
} from './pdf-senatepi';
import {
  ConfiguracaoSindicato,
  PixParcela,
  StatusParcela,
  TipoCobranca,
  TIPO_LABEL,
  STATUS_LABEL,
  formatBRL,
  formatData,
  statusExibicao,
} from './cobrancas';

/** Baixa uma imagem (URL) e converte para data URL, para embutir no PDF. Null em falha. */
async function urlParaDataUrl(url?: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface CarneParams {
  parcela: {
    numero: number;
    valor: number | string;
    dataCompetencia: string;
    dataVencimento: string;
    status: StatusParcela;
  };
  filiado: { nomeCompleto: string; matricula: string };
  tipo: TipoCobranca;
  pix: PixParcela;
  config: ConfiguracaoSindicato | null;
}

/** Gera e baixa o carnê (comprovante de cobrança) de UMA parcela, com QR PIX. */
export async function gerarCarnePdf(p: CarneParams): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const larguraUtil = doc.internal.pageSize.getWidth() - MARGEM * 2;
  let y = await desenharCabecalho(doc, 'Carnê de Pagamento');

  // Subtítulo: tipo + parcela
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...VERDE);
  doc.text(`${TIPO_LABEL[p.tipo]} — Parcela ${p.parcela.numero}`, MARGEM, y);
  y += 8;

  // Bloco Pagador
  doc.setDrawColor(220);
  doc.setFillColor(248, 250, 249);
  doc.roundedRect(MARGEM, y, larguraUtil, 18, 2, 2, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  doc.text('PAGADOR', MARGEM + 4, y + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(30);
  doc.text(p.filiado.nomeCompleto, MARGEM + 4, y + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  doc.text(`Matrícula ${p.filiado.matricula}`, MARGEM + 4, y + 16);
  y += 24;

  // Grade: Competência | Vencimento | Valor
  const colW = larguraUtil / 3;
  const celula = (rotulo: string, valor: string, x: number, destaque = false) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...CINZA);
    doc.text(rotulo, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(destaque ? 15 : 11);
    if (destaque) doc.setTextColor(...VERDE);
    else doc.setTextColor(30, 30, 30);
    doc.text(valor, x, y + 7);
  };
  const comp = p.parcela.dataCompetencia.slice(0, 7).split('-').reverse().join('/');
  celula('Competência', comp, MARGEM);
  celula('Vencimento', formatData(p.parcela.dataVencimento), MARGEM + colW);
  celula('Valor', formatBRL(p.parcela.valor), MARGEM + colW * 2, true);
  y += 12;

  const st = statusExibicao(p.parcela);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  if (st === 'PAGO') doc.setTextColor(...VERDE);
  else if (st === 'VENCIDO') doc.setTextColor(185, 28, 28);
  else doc.setTextColor(...CINZA);
  doc.text(`Situação: ${STATUS_LABEL[st]}`, MARGEM, y);
  y += 8;

  // Linha separadora
  doc.setDrawColor(225);
  doc.line(MARGEM, y, MARGEM + larguraUtil, y);
  y += 8;

  // Seção PIX: QR à esquerda, Copia e Cola à direita
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...VERDE);
  doc.text('Pague com PIX', MARGEM, y);
  y += 4;

  const qrLado = 42;
  try {
    doc.addImage(p.pix.qrDataUrl, 'PNG', MARGEM, y, qrLado, qrLado);
  } catch {
    /* QR indisponível — segue com o Copia e Cola */
  }

  const txtX = MARGEM + qrLado + 6;
  const txtW = larguraUtil - qrLado - 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  doc.text('PIX Copia e Cola', txtX, y + 4);
  doc.setFont('courier', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(40);
  const linhas = doc.splitTextToSize(p.pix.copiaECola, txtW);
  doc.text(linhas, txtX, y + 9);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...CINZA);
  doc.text(`Identificador: ${p.pix.identificador}`, txtX, y + qrLado);
  y += qrLado + 12;

  // Rodapé institucional (texto configurável)
  if (p.config?.textoRodapeCarne) {
    doc.setDrawColor(225);
    doc.line(MARGEM, y, MARGEM + larguraUtil, y);
    y += 6;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(...CINZA);
    doc.text(doc.splitTextToSize(p.config.textoRodapeCarne, larguraUtil), MARGEM, y);
    y += 12;
  }

  // Assinatura do presidente (imagem opcional) + linha
  const assinatura = await urlParaDataUrl(p.config?.assinaturaPresidenteUrl);
  y += 14;
  const assX = MARGEM + larguraUtil / 2 - 30;
  if (assinatura) {
    try {
      doc.addImage(assinatura, 'PNG', assX, y - 16, 60, 16);
    } catch {
      /* ignora imagem inválida */
    }
  }
  doc.setDrawColor(120);
  doc.line(assX, y, assX + 60, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...CINZA);
  doc.text('Presidência — SENATEPI', assX + 30, y + 5, { align: 'center' });

  desenharRodapeGeracao(doc);
  doc.save(`carne-${p.filiado.matricula}-parcela-${p.parcela.numero}.pdf`);
}
