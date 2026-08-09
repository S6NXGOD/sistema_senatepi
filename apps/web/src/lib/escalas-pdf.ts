import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  carregarLogo, desenharCabecalhoSync, desenharRodapeGeracao, MARGEM, VERDE,
} from './pdf-institucional';
import { Escala } from './escalas';

/** Exporta a grade de escalas do mês como PDF (cabeçalho institucional + tabela). */
export async function exportarEscalasPdf(mesLabel: string, escalas: Escala[]): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const logo = await carregarLogo('branco');

  const body = escalas.map((e) => [
    new Date(e.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', weekday: 'short', timeZone: 'UTC' }),
    e.advogado.nomeExibicao || e.advogado.nome,
    `${e.horaInicio} – ${e.horaFim}`,
    e.observacao || '—',
  ]);

  autoTable(doc, {
    head: [['Data', 'Advogado', 'Horário', 'Observação']],
    body,
    startY: 44,
    margin: { top: 44, left: MARGEM, right: MARGEM },
    styles: { fontSize: 9, cellPadding: 2.5, valign: 'middle' },
    headStyles: { fillColor: VERDE, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 245] },
    columnStyles: { 0: { cellWidth: 34 }, 2: { cellWidth: 30 } },
    didDrawPage: () => { desenharCabecalhoSync(doc, `Escalas dos Advogados — ${mesLabel}`, logo); },
  });

  desenharRodapeGeracao(doc);
  doc.save(`escalas-${mesLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
