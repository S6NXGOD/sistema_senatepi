import { Injectable, NotFoundException } from '@nestjs/common';
import { Importacao } from '@prisma/client';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { lerAsset } from '../../common/assets.util';

const VERDE_ESCURO = '#1B7F0A';

function fmtDuracao(ms?: number | null): string {
  if (!ms) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${s % 60}s`;
}

@Injectable()
export class RelatorioImportacaoService {
  constructor(private readonly prisma: PrismaService) {}

  private async carregar(id: string): Promise<Importacao> {
    const imp = await this.prisma.importacao.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException('Importação não encontrada');
    return imp;
  }

  async pdf(id: string): Promise<Buffer> {
    const imp = await this.carregar(id);
    const erros = await this.prisma.importacaoLinha.findMany({
      where: { importacaoId: id, valido: false },
      orderBy: { linha: 'asc' },
      take: 500,
    });

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, doc.page.width, 64).fill(VERDE_ESCURO);
      const logo = lerAsset('senatepi-horizontal-branco.png');
      if (logo) {
        try { doc.image(logo, 50, 18, { fit: [170, 26] }); } catch { doc.fillColor('#FFF').fontSize(16).text('SENATEPI', 50, 22); }
      } else {
        doc.fillColor('#FFF').fontSize(16).text('SENATEPI', 50, 22);
      }
      doc.fillColor('#FFFFFF').fontSize(9).text('Relatório de Importação de Filiados', 50, 44);

      doc.fillColor('#111827').fontSize(12).text('Resumo', 50, 86);
      doc.moveTo(50, 104).lineTo(doc.page.width - 50, 104).strokeColor('#E5E7EB').stroke();

      const linha = (label: string, valor: string, y: number) => {
        doc.fillColor('#6B7280').fontSize(10).text(label, 60, y);
        doc.fillColor('#111827').fontSize(10).text(valor, 300, y);
      };
      let y = 116;
      linha('Arquivo', imp.nomeArquivo, y); y += 20;
      linha('Total de registros', String(imp.total), y); y += 20;
      linha('Válidos', String(imp.validos), y); y += 20;
      linha('Com erro', String(imp.comErro), y); y += 20;
      linha('Duplicados (CPF já no sistema)', String(imp.duplicados), y); y += 20;
      linha('Importados (novos)', String(imp.importados), y); y += 20;
      linha('Atualizados', String(imp.atualizados), y); y += 20;
      linha('Ignorados', String(imp.ignorados), y); y += 20;
      linha('Dispensados (matrícula colidiu)', String(imp.dispensados), y); y += 20;
      linha('Estratégia p/ CPF duplicado', imp.estrategia, y); y += 20;
      linha('Estratégia p/ matrícula', imp.estrategiaMatricula, y); y += 20;
      linha('Tempo de execução', fmtDuracao(imp.duracaoMs), y); y += 20;
      linha('Data', imp.createdAt.toLocaleString('pt-BR'), y); y += 20;

      if (erros.length > 0) {
        y += 14;
        doc.fillColor('#111827').fontSize(12).text(`Registros com erro (${imp.comErro})`, 50, y);
        y += 8;
        doc.moveTo(50, y + 8).lineTo(doc.page.width - 50, y + 8).strokeColor('#E5E7EB').stroke();
        y += 16;
        doc.fontSize(8);
        for (const l of erros) {
          if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
          const msgs = Array.isArray(l.erros) ? (l.erros as string[]).join('; ') : '';
          doc.fillColor('#b91c1c').text(`Linha ${l.linha} — ${l.nome ?? '(sem nome)'} / CPF ${l.cpf ?? '-'}: `, 60, y, { continued: true });
          doc.fillColor('#374151').text(msgs);
          y += 14;
        }
      }

      doc.end();
    });
  }

  async excel(id: string): Promise<Buffer> {
    const imp = await this.carregar(id);
    const linhas = await this.prisma.importacaoLinha.findMany({
      where: { importacaoId: id },
      orderBy: { linha: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SENATEPI';

    const resumo = wb.addWorksheet('Resumo');
    resumo.columns = [
      { header: 'Indicador', key: 'k', width: 36 },
      { header: 'Valor', key: 'v', width: 40 },
    ];
    resumo.addRows([
      { k: 'Arquivo', v: imp.nomeArquivo },
      { k: 'Total de registros', v: imp.total },
      { k: 'Válidos', v: imp.validos },
      { k: 'Com erro', v: imp.comErro },
      { k: 'Duplicados (CPF já no sistema)', v: imp.duplicados },
      { k: 'Importados (novos)', v: imp.importados },
      { k: 'Atualizados', v: imp.atualizados },
      { k: 'Ignorados', v: imp.ignorados },
      { k: 'Dispensados (matrícula colidiu)', v: imp.dispensados },
      { k: 'Estratégia p/ CPF duplicado', v: imp.estrategia },
      { k: 'Estratégia p/ matrícula', v: imp.estrategiaMatricula },
      { k: 'Tempo de execução', v: fmtDuracao(imp.duracaoMs) },
      { k: 'Data', v: imp.createdAt.toLocaleString('pt-BR') },
    ]);
    resumo.getRow(1).font = { bold: true };

    const det = wb.addWorksheet('Registros');
    det.columns = [
      { header: 'Linha', key: 'linha', width: 8 },
      { header: 'Nome', key: 'nome', width: 30 },
      { header: 'CPF', key: 'cpf', width: 16 },
      { header: 'Matrícula', key: 'matricula', width: 18 },
      { header: 'Telefone', key: 'telefone', width: 16 },
      { header: 'Empresa', key: 'empresa', width: 26 },
      { header: 'Situação', key: 'situacao', width: 12 },
      { header: 'Válido', key: 'valido', width: 8 },
      { header: 'Duplicado', key: 'dup', width: 10 },
      { header: 'Resultado', key: 'resultado', width: 14 },
      { header: 'Erros', key: 'erros', width: 45 },
      { header: 'Avisos', key: 'avisos', width: 45 },
    ];
    det.getRow(1).font = { bold: true };
    for (const l of linhas) {
      det.addRow({
        linha: l.linha,
        nome: l.nome,
        cpf: l.cpf,
        matricula: l.matricula,
        telefone: l.telefone,
        empresa: l.empresa,
        situacao: l.situacao,
        valido: l.valido ? 'Sim' : 'Não',
        dup: l.duplicadoNoSistema ? 'Sim' : 'Não',
        resultado: l.resultado ?? '-',
        erros: Array.isArray(l.erros) ? (l.erros as string[]).join('; ') : '',
        avisos: Array.isArray(l.avisos) ? (l.avisos as string[]).join('; ') : '',
      });
    }

    const arr = await wb.xlsx.writeBuffer();
    return Buffer.from(arr);
  }
}
