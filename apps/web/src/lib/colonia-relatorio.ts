import {
  FORMACAO_LABEL, formatarDataHoraLote, mascaraCpf, LotePainel, Ocupante,
} from './colonia';
import {
  VERDE, CINZA, MARGEM, carregarLogo, desenharCabecalhoSync, desenharRodapeGeracao,
} from './pdf-senatepi';

const slug = (s: string) => s.replace(/\s+/g, '-').replace(/[^\w-]/g, '').toLowerCase();

function origemLabel(o: Ocupante): string {
  return o.alocacaoManual ? 'Manual' : o.origem === 'SORTEIO' ? 'Sorteio' : 'Direta';
}
function quartoLabel(o: Ocupante): string {
  return `Q${o.quartoNumero} · ${o.climatizacao === 'AR_CONDICIONADO' ? 'Ar' : 'Ventilador'}`;
}

interface OpcoesRelatorio {
  titulo: string;
  subtitulo: string;
  totalLabel: string;
  head: string[];
  body: any[];
  arquivo: string;
}

/** Monta um relatório A4 paisagem: logo em todas as páginas + tabela + rodapé de geração. */
async function construir(opts: OpcoesRelatorio): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const logo = await carregarLogo('branco');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const colPresenca = opts.head.length - 1;

  autoTable(doc, {
    startY: 52,
    margin: { top: 40, left: MARGEM, right: MARGEM, bottom: 18 },
    head: [opts.head],
    body: opts.body.length
      ? opts.body
      : [[{ content: 'Nenhum hóspede registrado.', colSpan: opts.head.length, styles: { halign: 'center', textColor: CINZA } }]],
    theme: 'grid',
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: [30, 35, 40], cellPadding: 1.6 },
    alternateRowStyles: { fillColor: [246, 248, 250] },
    columnStyles: { [String(colPresenca)]: { cellWidth: 24 } }, // coluna "Presença" (marcação manual)
    // Cabeçalho institucional (logo) redesenhado em CADA página.
    didDrawPage: () => { desenharCabecalhoSync(doc, opts.titulo, logo); },
  });

  // Resumo na página 1, abaixo da faixa do cabeçalho.
  doc.setPage(1);
  doc.setTextColor(...CINZA);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(opts.subtitulo, MARGEM, 44, { maxWidth: pageW - MARGEM * 2 - 60 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(opts.totalLabel, pageW - MARGEM, 44, { align: 'right' });

  desenharRodapeGeracao(doc);
  doc.save(opts.arquivo);
}

/** Relatório completo: todos os hóspedes de todos os lotes da campanha. */
export async function gerarRelatorioCompletoPdf(campanha: string, lotes: LotePainel[]): Promise<void> {
  let total = 0;
  const body: any[] = [];
  lotes.forEach((l) => {
    l.ocupacao.forEach((o) => {
      total += 1;
      body.push([
        String(l.lote.numero),
        quartoLabel(o),
        o.nomeCompleto,
        mascaraCpf(o.cpf),
        o.coren ?? '—',
        FORMACAO_LABEL[o.formacao],
        o.telefone,
        origemLabel(o),
        '',
      ]);
    });
  });
  await construir({
    titulo: 'Relatório de Hóspedes',
    subtitulo: campanha,
    totalLabel: `Total de hóspedes: ${total}`,
    head: ['Lote', 'Quarto', 'Nome', 'CPF', 'COREN', 'Profissão', 'Telefone', 'Origem', 'Presença'],
    body,
    arquivo: `relatorio-colonia-${slug(campanha)}.pdf`,
  });
}

/** Relatório de um lote específico (ideal para a conferência física no check-in). */
export async function gerarRelatorioLotePdf(campanha: string, lote: LotePainel): Promise<void> {
  const body = lote.ocupacao.map((o) => [
    quartoLabel(o),
    o.nomeCompleto,
    mascaraCpf(o.cpf),
    o.coren ?? '—',
    FORMACAO_LABEL[o.formacao],
    o.telefone,
    origemLabel(o),
    '',
  ]);
  await construir({
    titulo: `Relatório do Lote ${lote.lote.numero}`,
    subtitulo: `${campanha} — Lote ${lote.lote.numero}: ${formatarDataHoraLote(lote.lote.dataInicio)} → ${formatarDataHoraLote(lote.lote.dataFim)}`,
    totalLabel: `Hóspedes no lote: ${lote.ocupacao.length}`,
    head: ['Quarto', 'Nome', 'CPF', 'COREN', 'Profissão', 'Telefone', 'Origem', 'Presença'],
    body,
    arquivo: `relatorio-colonia-lote-${lote.lote.numero}.pdf`,
  });
}
