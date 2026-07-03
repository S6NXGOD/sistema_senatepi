import {
  Climatizacao,
  ESTRUTURA_QUARTO,
  AVISO_LEGAL_RESERVA,
  SECRETARIA,
  LABEL_CLIMATIZACAO,
  formatarDataHoraLote,
  mascaraCpf,
} from './colonia';
import {
  VERDE, CINZA, AMBAR_BG, AMBAR_BORDA, AMBAR_TXT, MARGEM, desenharCabecalho,
} from './pdf-senatepi';

/** Aviso de destaque exibido também na tela de sucesso. */
export const AVISO_APRESENTAR =
  'IMPORTANTE: Baixe e guarde este comprovante. Apresente-o (impresso ou no celular) na ' +
  'recepção da Colônia de Férias no dia do check-in.';

export interface ComprovanteInfo {
  protocolo: string;
  tipo: 'AR' | 'VENTILADOR' | 'SORTEIO';
  campanha: string;
  nome: string;
  cpf: string; // apenas dígitos
  loteNumero: number;
  dataInicio: string; // ISO
  dataFim: string; // ISO
  quartoNumero?: number;
  climatizacao?: Climatizacao;
}

/** Texto pronto para compartilhar no WhatsApp (usado pelo botão da tela de sucesso). */
export function montarTextoCompartilhamento(info: ComprovanteInfo, linkPublico?: string): string {
  const sorteio = info.tipo === 'SORTEIO';
  const linhas = [
    sorteio
      ? '✅ Inscrição no sorteio da Colônia de Férias SENATEPI confirmada!'
      : '✅ Reserva confirmada na Colônia de Férias SENATEPI!',
    '',
    `📌 ${info.campanha} — Lote ${info.loteNumero}`,
    `🟢 Check-in: ${formatarDataHoraLote(info.dataInicio)}`,
    `🔴 Check-out: ${formatarDataHoraLote(info.dataFim)}`,
  ];
  if (!sorteio && info.quartoNumero && info.climatizacao) {
    linhas.push(`🛏️ Quarto ${info.quartoNumero} — ${LABEL_CLIMATIZACAO[info.climatizacao]}`);
  } else if (sorteio) {
    linhas.push('🎟️ Quarto 6 (Ventilador) — a definir por sorteio');
  }
  linhas.push(ESTRUTURA_QUARTO);
  linhas.push(`🔖 Protocolo: ${info.protocolo}`);
  if (linkPublico) linhas.push('', linkPublico);
  return linhas.join('\n');
}

/** Gera e baixa o comprovante em PDF (A4) da reserva/inscrição.
 *  jsPDF é carregado dinamicamente (só no clique) para não ser avaliado no SSR. */
export async function gerarComprovantePdf(info: ComprovanteInfo): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const M = MARGEM;
  const contentW = pageW - M * 2;

  // ---- Cabeçalho institucional (logo SENATEPI) ----
  let y = await desenharCabecalho(doc, 'Comprovante de Reserva');

  // ---- Protocolo / emissão ----
  doc.setTextColor(...CINZA);
  doc.setFontSize(9);
  doc.text(`Protocolo: ${info.protocolo}`, M, y);
  const emissao = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  doc.text(`Emitido em ${emissao}`, pageW - M, y, { align: 'right' });
  y += 6;
  doc.setDrawColor(220, 224, 228);
  doc.line(M, y, pageW - M, y);
  y += 10;

  const secao = (titulo: string) => {
    doc.setTextColor(...VERDE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(titulo, M, y);
    y += 6;
    doc.setTextColor(30, 35, 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
  };
  const linha = (rotulo: string, valor: string) => {
    doc.setTextColor(...CINZA);
    doc.text(rotulo, M, y);
    doc.setTextColor(30, 35, 40);
    doc.text(valor, M + 42, y);
    y += 6;
  };

  // ---- Titular ----
  secao('Dados do titular');
  linha('Nome:', info.nome);
  linha('CPF:', mascaraCpf(info.cpf));
  y += 4;

  // ---- Reserva ----
  secao(info.tipo === 'SORTEIO' ? 'Inscrição no sorteio' : 'Detalhes da reserva');
  linha('Campanha:', info.campanha);
  linha('Lote:', `Lote ${info.loteNumero}`);
  linha('Check-in:', formatarDataHoraLote(info.dataInicio));
  linha('Check-out:', formatarDataHoraLote(info.dataFim));
  if (info.tipo === 'SORTEIO') {
    linha('Quarto:', 'Quarto 6 (Ventilador) — a definir por sorteio');
  } else if (info.quartoNumero && info.climatizacao) {
    linha('Quarto:', `Quarto ${info.quartoNumero} — ${LABEL_CLIMATIZACAO[info.climatizacao]}`);
  }
  y += 2;

  // ---- Destaque: apresentar na chegada ----
  {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    const linhas = doc.splitTextToSize(AVISO_APRESENTAR, contentW - 10) as string[];
    const h = linhas.length * 4.6 + 8;
    doc.setFillColor(241, 248, 233); // senatepi-50
    doc.setDrawColor(...VERDE);
    doc.setLineWidth(0.4);
    doc.roundedRect(M, y, contentW, h, 2, 2, 'FD');
    doc.setTextColor(...VERDE);
    let ny = y + 6;
    linhas.forEach((l) => { doc.text(l, M + 5, ny); ny += 4.6; });
    y += h + 8;
  }

  // ---- Estrutura do quarto ----
  doc.setTextColor(...CINZA);
  doc.setFontSize(9);
  doc.splitTextToSize(ESTRUTURA_QUARTO, contentW).forEach((l: string) => {
    doc.text(l, M, y);
    y += 5;
  });
  y += 6;

  // ---- Aviso legal (destaque) ----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const avisoLinhas = doc.splitTextToSize(AVISO_LEGAL_RESERVA, contentW - 10) as string[];
  const boxH = avisoLinhas.length * 4.6 + 12;
  doc.setFillColor(...AMBAR_BG);
  doc.setDrawColor(...AMBAR_BORDA);
  doc.setLineWidth(0.5);
  doc.roundedRect(M, y, contentW, boxH, 2, 2, 'FD');
  doc.setTextColor(...AMBAR_TXT);
  doc.text('AVISO IMPORTANTE', M + 5, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let ay = y + 12;
  avisoLinhas.forEach((l) => {
    doc.text(l, M + 5, ay);
    ay += 4.6;
  });
  y += boxH + 12;

  // ---- Rodapé: secretaria ----
  doc.setDrawColor(220, 224, 228);
  doc.line(M, y, pageW - M, y);
  y += 7;
  doc.setTextColor(...CINZA);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Secretaria SENATEPI', M, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  [SECRETARIA.endereco, `Telefone: ${SECRETARIA.telefone}`, SECRETARIA.horario].forEach((t) => {
    doc.splitTextToSize(t, contentW).forEach((l: string) => {
      doc.text(l, M, y);
      y += 4.6;
    });
  });

  doc.save(`comprovante-colonia-lote-${info.loteNumero}.pdf`);
}
