import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { dataParaNome, nomeDeArquivo, type DocumentoGerado } from '@core/infra';
import { PrismaService } from '../../prisma/prisma.service';
import { lerLogoDaMarca } from '../../common/assets.util';
import { carimbarRodape } from '../../common/pdf-rodape.util';
import { tenant, rodapeInstitucional } from '../../tenant/tenant.config';
import { NpuUtils } from './utils/npu.util';

/**
 * O DOSSIÊ DO PROCESSO — o papel que se entrega a quem perguntou.
 *
 * O filiado liga e pergunta "como está o meu processo?". Hoje a resposta é uma
 * pessoa lendo a tela em voz alta pelo telefone, ou um print de celular. Este é
 * o documento que responde: o que se pede, contra quem, em que fase está, o que
 * andou e o que o escritório fez.
 *
 * O QUE ELE NÃO LEVA, e cada ausência é decisão:
 *
 *  - NOTA INTERNA. `notaInterna` é o que a equipe escreve para a equipe —
 *    estratégia, dúvida sobre a tese, avaliação do caso. Nada disso vai num
 *    papel que sai do escritório.
 *  - PROGNÓSTICO. Nenhuma linha diz se vai ganhar ou quanto tempo falta. O
 *    dossiê relata o que ACONTECEU; opinar sobre desfecho em documento entregue
 *    ao filiado é criar expectativa que ninguém pode honrar.
 *  - O TEOR INTEGRAL das publicações. São até 22 mil caracteres cada; o dossiê
 *    lista os atos e suas datas, e quem quiser o inteiro teor pede a peça.
 *
 * A ADVERTÊNCIA SOBRE A FONTE é obrigatória e vai no rodapé do documento: os
 * andamentos vêm da base pública do CNJ, que ATRASA — mediana de 41 dias
 * medida neste acervo. Um dossiê que se apresenta como espelho do processo
 * mente por omissão no dia em que o tribunal ainda não alimentou o índice.
 */

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';
const RODAPE = rodapeInstitucional();

/** Quantos andamentos entram. Acima disso vira listagem, não dossiê. */
const MAX_ANDAMENTOS = 25;

const FONTE_CNJ =
  'Os andamentos aqui reproduzidos foram obtidos da base pública de dados processuais do ' +
  'Conselho Nacional de Justiça (DataJud) e do Diário de Justiça Eletrônico Nacional (DJEN). ' +
  'Essas bases têm atraso de alimentação pelos tribunais: a ausência de um ato nesta relação ' +
  'não significa que ele não tenha ocorrido. Este documento é informativo e não substitui a ' +
  'consulta aos autos.';

@Injectable()
export class DossieProcessoService {
  constructor(private readonly prisma: PrismaService) {}

  async gerar(processoId: string, autor?: string | null): Promise<DocumentoGerado> {
    const p = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        numeroCNJ: true, titulo: true, classeProcessual: true, assuntoPrincipal: true,
        tribunal: true, orgaoJulgador: true, dataDistribuicao: true, statusInterno: true,
        categoria: true, grau: true, createdAt: true,
        filiado: { select: { nomeCompleto: true } },
        advogado: { select: { nome: true, nomeExibicao: true, oab: true, oabUf: true } },
        partes: {
          select: { nome: true, polo: true, principal: true },
          orderBy: [{ polo: 'asc' }, { principal: 'desc' }],
        },
        movimentacoes: {
          orderBy: { dataMovimento: 'desc' },
          take: MAX_ANDAMENTOS,
          select: { dataMovimento: true, descricao: true, detalhe: true },
        },
        /**
         * SÓ O QUE NÃO É NOTA INTERNA. O filtro é aqui, na consulta, e não na
         * montagem: nota interna que chega até o gerador é nota interna que
         * alguém pode vazar para o PDF numa alteração distraída.
         */
        movimentacoesInternas: {
          where: { notaInterna: false, origemSistema: false },
          orderBy: { createdAt: 'desc' },
          take: MAX_ANDAMENTOS,
          select: { dataFato: true, createdAt: true, descricao: true, tipo: true },
        },
      },
    });
    if (!p) throw new NotFoundException('Processo não encontrado.');

    const npu = NpuUtils.formatar(p.numeroCNJ ?? '') || p.titulo || 'Processo';
    const pdf = await this.desenhar(p, npu, autor);
    return {
      pdf,
      nomeArquivo: nomeDeArquivo(['dossie', npu, dataParaNome(new Date())], 'pdf'),
    };
  }

  private desenhar(
    p: Awaited<ReturnType<DossieProcessoService['carregar']>>,
    npu: string,
    autor?: string | null,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const X = doc.page.margins.left;
      const W = doc.page.width - X - doc.page.margins.right;
      const data = (v: Date | null) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—');

      // ---- Faixa institucional (a logo é branca; exige fundo escuro) ----
      const ALT = 74;
      doc.rect(0, 0, doc.page.width, ALT).fill(VERDE_ESCURO);
      const logo = lerLogoDaMarca();
      if (logo) {
        try {
          doc.image(logo, X, 18, { fit: [150, 38] });
        } catch {
          /* segue sem logo */
        }
      }
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#E8F5E3')
        .text(`${tenant.nome}\nCNPJ: ${tenant.cnpj}`, X + W - 230, 20, {
          align: 'right',
          width: 230,
          lineGap: 1.5,
        });
      doc.rect(0, ALT, doc.page.width, 4).fill(VERDE_MEDIO);

      // ---- Capa ----
      doc.y = ALT + 30;
      doc
        .font('Times-Bold')
        .fontSize(16)
        .fillColor('#111827')
        .text('ACOMPANHAMENTO PROCESSUAL', X, doc.y, { align: 'center', width: W });
      doc.moveDown(0.3);
      doc
        .font('Times-Roman')
        .fontSize(12)
        .fillColor('#374151')
        .text(npu, X, doc.y, { align: 'center', width: W });
      doc.moveDown(1);

      const linha = (rotulo: string, valor: string | null | undefined) => {
        if (!valor) return;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(`${rotulo}: `, {
          continued: true,
        });
        doc.font('Helvetica').fillColor('#111827').text(valor);
      };

      const ativos = p.partes.filter((x) => x.polo === 'ATIVO').map((x) => x.nome);
      const passivos = p.partes.filter((x) => x.polo === 'PASSIVO').map((x) => x.nome);

      linha('Autor', ativos.join('; ') || '—');
      linha('Réu', passivos.join('; ') || '—');
      if (p.filiado) linha('Filiado', p.filiado.nomeCompleto);
      linha('Classe', p.classeProcessual);
      linha('Assunto', p.assuntoPrincipal);
      linha('Tribunal', [p.tribunal, p.grau].filter(Boolean).join(' · '));
      linha('Órgão julgador', p.orgaoJulgador);
      linha('Distribuído em', p.dataDistribuicao ? data(p.dataDistribuicao) : null);
      linha('Situação', String(p.statusInterno).replace(/_/g, ' '));
      if (p.advogado) {
        const oab = p.advogado.oab ? ` (OAB ${p.advogado.oab}/${p.advogado.oabUf ?? ''})` : '';
        linha('Advogado responsável', `${p.advogado.nomeExibicao || p.advogado.nome}${oab}`);
      }
      linha('Emitido em', new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }));
      if (autor) linha('Emitido por', autor);

      // ---- Andamentos do tribunal ----
      this.secao(doc, X, W, 'ANDAMENTOS NO TRIBUNAL');
      if (!p.movimentacoes.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B7280')
          .text('Nenhum andamento registrado na base pública até esta data.', X, doc.y, { width: W });
      } else {
        for (const m of p.movimentacoes) {
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151')
            .text(data(m.dataMovimento), X, doc.y, { continued: true, width: W });
          doc.font('Helvetica').fillColor('#111827')
            .text(`  ${[m.descricao, m.detalhe].filter(Boolean).join(' — ')}`, { width: W });
          doc.moveDown(0.25);
        }
      }

      // ---- O que o sindicato fez ----
      this.secao(doc, X, W, 'ATUAÇÃO DO SINDICATO');
      if (!p.movimentacoesInternas.length) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B7280')
          .text('Sem registros de atuação lançados até esta data.', X, doc.y, { width: W });
      } else {
        for (const m of p.movimentacoesInternas) {
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151')
            .text(data(m.dataFato ?? m.createdAt), X, doc.y, { continued: true, width: W });
          doc.font('Helvetica').fillColor('#111827').text(`  ${m.descricao}`, { width: W });
          doc.moveDown(0.25);
        }
      }

      // ---- Advertência sobre a fonte ----
      doc.moveDown(0.8);
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#6B7280')
        .text(FONTE_CNJ, X, doc.y, { width: W, align: 'justify', lineGap: 1 });

      const paginas = doc.bufferedPageRange();
      for (let i = 0; i < paginas.count; i++) {
        doc.switchToPage(paginas.start + i);
        carimbarRodape(doc, `${RODAPE}  ·  página ${i + 1} de ${paginas.count}`);
      }
      doc.end();
    });
  }

  /** Título de seção, no mesmo desenho do dossiê de evento. */
  private secao(doc: PDFKit.PDFDocument, x: number, w: number, titulo: string): void {
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(VERDE_ESCURO).text(titulo, x, doc.y, { width: w });
    doc.moveTo(x, doc.y + 2).lineTo(x + w, doc.y + 2).lineWidth(0.7).strokeColor(VERDE_MEDIO).stroke();
    doc.moveDown(0.6);
  }

  /** Só para o TypeScript inferir o tipo da consulta acima. */
  private async carregar(id: string) {
    return this.prisma.processo.findUniqueOrThrow({
      where: { id },
      select: {
        numeroCNJ: true, titulo: true, classeProcessual: true, assuntoPrincipal: true,
        tribunal: true, orgaoJulgador: true, dataDistribuicao: true, statusInterno: true,
        categoria: true, grau: true, createdAt: true,
        filiado: { select: { nomeCompleto: true } },
        advogado: { select: { nome: true, nomeExibicao: true, oab: true, oabUf: true } },
        partes: { select: { nome: true, polo: true, principal: true } },
        movimentacoes: { select: { dataMovimento: true, descricao: true, detalhe: true } },
        movimentacoesInternas: {
          select: { dataFato: true, createdAt: true, descricao: true, tipo: true },
        },
      },
    });
  }
}
