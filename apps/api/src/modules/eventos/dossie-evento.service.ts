import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { ModoVotacao, StatusPauta } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { lerAsset } from '../../common/assets.util';
import { mascararCpf } from '../../common/utils/matricula.util';
import { VotacaoService } from './votacao.service';
import { lerConfiguracoes } from './configuracoes-evento';
import { tenant, enderecoEmLinha } from '../../tenant/tenant.config';

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';

const RODAPE =
  `DIRETORIA ${tenant.sigla} - ${enderecoEmLinha()} | ` +
  'CONTATOS: (86) 3303-1426; (86) 99421-1117; e-mail: senatepienfermagem@outlook.com';

/**
 * Base legal citada no dossiê e na tela de check-in — o MESMO texto nos dois
 * lugares, para não haver versão "de tela" e versão "de documento".
 */
const TEXTO_LGPD =
  'Os dados pessoais constantes deste documento — nome, CPF, endereço IP e ' +
  'registro de data e hora — foram coletados para comprovar a participação e a ' +
  'apuração do quórum deste evento associativo, e são tratados em conformidade ' +
  'com a Lei Geral de Proteção de Dados Pessoais (LGPD), Lei nº 13.709, de 14 de ' +
  'agosto de 2018 (Fonte: Diário Oficial da União). O titular foi informado da ' +
  'coleta no momento do registro de presença. Este documento contém dados ' +
  'pessoais: sua circulação deve ser restrita às finalidades associativas e ' +
  'legais que motivaram sua emissão.';

/**
 * Advertência sobre a natureza probatória do registro.
 *
 * Vai no documento de propósito. Um dossiê que se apresenta como "assinatura
 * digital" atribui a si um valor que não tem, e é o primeiro ponto que a parte
 * contrária ataca. Dizer exatamente o que o registro prova — e o que não prova
 * — é o que o torna defensável.
 */
const TEXTO_NATUREZA =
  'O registro de presença aqui reproduzido consiste em evidência eletrônica de ' +
  'acesso: CPF informado pelo participante, endereço IP de origem e carimbo de ' +
  'tempo do servidor, com verificação do vínculo associativo no momento do ' +
  'acesso. NÃO constitui assinatura digital nos termos da Medida Provisória nº ' +
  '2.200-2, de 24 de agosto de 2001 (ICP-Brasil), por não empregar certificado ' +
  'digital nem chave privada do signatário.';

@Injectable()
export class DossieEventoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly votacao: VotacaoService,
  ) {}

  /**
   * Gera o dossiê e o ARQUIVA no storage.
   *
   * Arquivar, e não gerar sob demanda a cada consulta, é o que o torna um
   * registro: um documento que se refaz a cada clique muda quando os dados
   * mudam, e aí não comprova o que aconteceu — comprova o que está acontecendo.
   * O hash SHA-256 impresso na última página permite conferir depois que o
   * arquivo em mãos é o mesmo que foi emitido.
   */
  async gerar(eventoId: string, autor?: string) {
    const evento = await this.prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const [presencas, pautas, sorteios] = await Promise.all([
      this.prisma.presenca.findMany({
        where: { eventoId },
        orderBy: { registradoEm: 'asc' },
        select: {
          nomeSnapshot: true, registradoEm: true, ip: true, origem: true,
          cpfInformado: true, tipoPessoa: true,
          filiado: { select: { matricula: true } },
        },
      }),
      this.prisma.pautaVotacao.findMany({
        where: { eventoId, status: StatusPauta.ENCERRADA },
        orderBy: [{ ordem: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.sorteioEvento.findMany({
        where: { eventoId },
        orderBy: { realizadoEm: 'asc' },
      }),
    ]);

    const apuracoes = await Promise.all(pautas.map((p) => this.votacao.apurar(p.id)));
    const cfg = lerConfiguracoes(evento.configuracoes);

    const pdf = await this.montarPdf({
      evento, cfg, presencas, apuracoes, sorteios, autor,
    });

    const key = `eventos/${eventoId}/dossie.pdf`;
    await this.storage.upload(key, pdf, 'application/pdf');
    await this.prisma.evento.update({
      where: { id: eventoId },
      data: { dossiePdfKey: key, dossieGeradoEm: new Date() },
    });

    return { key, tamanho: pdf.length, hash: this.hash(pdf) };
  }

  /** Baixa o dossiê já emitido; gera na hora se ainda não existir. */
  async baixar(eventoId: string): Promise<Buffer> {
    const evento = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: { dossiePdfKey: true },
    });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    if (evento.dossiePdfKey) {
      const existente = await this.storage.getBuffer(evento.dossiePdfKey).catch(() => null);
      if (existente) return existente;
      // Chave gravada mas arquivo ausente é o sintoma clássico de disco
      // efêmero: o registro do banco sobrevive ao deploy, o arquivo não.
      // Regerar é melhor do que falhar no dia da conferência.
    }
    await this.gerar(eventoId);
    const atualizado = await this.prisma.evento.findUnique({
      where: { id: eventoId },
      select: { dossiePdfKey: true },
    });
    const buf = await this.storage.getBuffer(atualizado!.dossiePdfKey!);
    if (!buf) throw new NotFoundException('Não foi possível recuperar o dossiê emitido.');
    return buf;
  }

  private hash(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }

  // =========================================================================

  private montarPdf(d: {
    evento: any;
    cfg: ReturnType<typeof lerConfiguracoes>;
    presencas: any[];
    apuracoes: any[];
    sorteios: any[];
    autor?: string;
  }): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const X = doc.page.margins.left;
      const W = doc.page.width - X - doc.page.margins.right;
      const dataHora = (v: Date | string | null) =>
        v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

      // ---- Faixa institucional (a logo é branca; exige fundo escuro) ----
      const ALT = 74;
      doc.rect(0, 0, doc.page.width, ALT).fill(VERDE_ESCURO);
      const logo = lerAsset('senatepi-horizontal-branco.png');
      if (logo) {
        try { doc.image(logo, X, 18, { fit: [150, 38] }); } catch { /* segue sem logo */ }
      }
      doc.font('Helvetica').fontSize(7.5).fillColor('#E8F5E3').text(
        `${tenant.nome}\nCNPJ: ${tenant.cnpj}`,
        X + W - 230, 20, { align: 'right', width: 230, lineGap: 1.5 },
      );
      doc.rect(0, ALT, doc.page.width, 4).fill(VERDE_MEDIO);

      // ---- 1) Capa ----
      doc.y = ALT + 30;
      doc.font('Times-Bold').fontSize(16).fillColor('#111827')
        .text('DOSSIÊ DE EVENTO ASSOCIATIVO', X, doc.y, { align: 'center', width: W });
      doc.moveDown(0.3);
      doc.font('Times-Roman').fontSize(11).fillColor('#374151')
        .text(d.evento.nome, X, doc.y, { align: 'center', width: W });
      doc.moveDown(1);

      const linha = (rotulo: string, valor: string) => {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151')
          .text(`${rotulo}: `, { continued: true });
        doc.font('Helvetica').fillColor('#111827').text(valor);
      };
      linha('Natureza', String(d.evento.tipo).replace(/_/g, ' '));
      linha('Início', dataHora(d.evento.dataInicio));
      if (d.evento.dataFim) linha('Encerramento', dataHora(d.evento.dataFim));
      linha('Modalidade', d.evento.linkReuniao ? 'Virtual (videoconferência)' : 'Presencial');
      linha('Situação', String(d.evento.status).replace(/_/g, ' '));
      if (d.cfg.exigeAdimplencia) {
        linha('Habilitação', 'Exigida contribuição associativa em dia para ingresso');
      }
      if (d.autor) linha('Emitido por', d.autor);
      linha('Emitido em', dataHora(new Date()));

      // ---- 2) Quórum ----
      this.secao(doc, X, W, 'QUÓRUM E COMPARECIMENTO');
      const porOrigem = d.presencas.reduce<Record<string, number>>((acc, p) => {
        acc[p.origem] = (acc[p.origem] ?? 0) + 1;
        return acc;
      }, {});
      linha('Total de presentes', String(d.presencas.length));
      for (const [origem, n] of Object.entries(porOrigem)) {
        linha(`  ${origem.replace(/_/g, ' ').toLowerCase()}`, String(n));
      }
      if (d.presencas.length > 0) {
        linha('Primeiro registro', dataHora(d.presencas[0].registradoEm));
        linha('Último registro', dataHora(d.presencas[d.presencas.length - 1].registradoEm));
      }

      // ---- 3) Lista de presença ----
      this.secao(doc, X, W, 'REGISTRO DE PRESENÇA');
      if (d.presencas.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B7280')
          .text('Nenhuma presença registrada.');
      } else {
        const cols = [
          { t: 'Nome', w: W * 0.34 },
          { t: 'Matrícula', w: W * 0.14 },
          { t: 'CPF', w: W * 0.18 },
          { t: 'Data/hora', w: W * 0.18 },
          { t: 'IP', w: W * 0.16 },
        ];
        const cabecalho = () => {
          let x = X;
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#374151');
          for (const c of cols) { doc.text(c.t, x, doc.y, { width: c.w, continued: false }); x += c.w; }
          doc.moveUp();
          doc.y += 12;
          doc.moveTo(X, doc.y - 3).lineTo(X + W, doc.y - 3).strokeColor('#D1D5DB').lineWidth(0.5).stroke();
        };
        cabecalho();

        for (const p of d.presencas) {
          // Quebra de página preservando o cabeçalho: tabela sem cabeçalho na
          // página 3 é tabela que ninguém lê.
          if (doc.y > doc.page.height - 90) {
            doc.addPage();
            doc.y = 60;
            cabecalho();
          }
          const y = doc.y;
          let x = X;
          const celula = (txt: string, w: number) => {
            doc.font('Helvetica').fontSize(7.5).fillColor('#111827')
              .text(txt, x, y, { width: w - 4, ellipsis: true, lineBreak: false });
            x += w;
          };
          celula(p.nomeSnapshot, cols[0].w);
          celula(p.filiado?.matricula ?? '—', cols[1].w);
          // CPF MASCARADO no documento: o dossiê circula, e o CPF completo não
          // precisa circular junto para provar presença.
          celula(p.cpfInformado ? mascararCpf(p.cpfInformado) : '—', cols[2].w);
          celula(dataHora(p.registradoEm), cols[3].w);
          celula(p.ip ?? '—', cols[4].w);
          doc.y = y + 11;
        }
      }

      // ---- 4) Deliberações ----
      this.secao(doc, X, W, 'DELIBERAÇÕES');
      if (d.apuracoes.length === 0) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B7280')
          .text('Nenhuma pauta encerrada neste evento.');
      } else {
        for (const a of d.apuracoes) {
          if (doc.y > doc.page.height - 150) { doc.addPage(); doc.y = 60; }
          doc.moveDown(0.4);
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(a.titulo);
          doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(
            `Modalidade: votação ${a.modo === ModoVotacao.SECRETA ? 'SECRETA' : 'NOMINAL'} · ` +
            `${a.totalVotantes} votante(s) de ${a.presentes} presente(s)` +
            (a.quorumMinimo != null
              ? ` · quórum mínimo ${a.quorumMinimo}: ${a.quorumAtingido ? 'ATINGIDO' : 'NÃO ATINGIDO'}`
              : ''),
          );
          doc.moveDown(0.2);
          for (const r of a.resultado) {
            doc.font(r.opcaoId === a.vencedora?.opcaoId ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(9).fillColor('#111827')
              .text(`   ${r.rotulo}: ${r.votos} voto(s) (${r.percentual}%)`);
          }
          doc.font('Helvetica-Bold').fontSize(9).fillColor(VERDE_ESCURO).text(
            a.empate ? '   Resultado: EMPATE' : `   Resultado: ${a.vencedora?.rotulo ?? '—'}`,
          );
        }
      }

      // ---- 5) Sorteios ----
      if (d.sorteios.length > 0) {
        this.secao(doc, X, W, 'SORTEIOS');
        for (const s of d.sorteios) {
          if (doc.y > doc.page.height - 120) { doc.addPage(); doc.y = 60; }
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(s.titulo);
          const ganhadores = (s.resultado ?? []) as { nome: string; matricula: string }[];
          for (const g of ganhadores) {
            doc.font('Helvetica').fontSize(9).text(`   ${g.nome} (${g.matricula})`);
          }
          // A semente é impressa PARA SER CONFERIDA: com ela e a lista de
          // presença acima, qualquer pessoa refaz o sorteio e chega ao mesmo
          // resultado. É o que separa sorteio auditável de sorteio alegado.
          doc.font('Helvetica').fontSize(6.5).fillColor('#6B7280')
            .text(`   Semente de verificação (HMAC-SHA256): ${s.seed}`, { width: W });
          doc.moveDown(0.3);
        }
      }

      // ---- 6) Ata ----
      if (d.evento.textoAta?.trim()) {
        this.secao(doc, X, W, 'ATA');
        doc.font('Times-Roman').fontSize(10).fillColor('#111827')
          .text(d.evento.textoAta.trim(), { align: 'justify', width: W, lineGap: 2 });
      }

      // ---- 7) Anexos e base legal ----
      if (doc.y > doc.page.height - 260) { doc.addPage(); doc.y = 60; }
      this.secao(doc, X, W, 'REGISTROS COMPLEMENTARES E BASE LEGAL');
      if (d.evento.linkReuniao) linha('Sala da reunião', d.evento.linkReuniao);
      if (d.evento.urlVideoDrive) linha('Gravação', d.evento.urlVideoDrive);

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151')
        .text('Natureza do registro de presença');
      doc.font('Helvetica').fontSize(8).fillColor('#111827')
        .text(TEXTO_NATUREZA, { align: 'justify', width: W, lineGap: 1.5 });

      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151')
        .text('Proteção de dados pessoais');
      doc.font('Helvetica').fontSize(8).fillColor('#111827')
        .text(TEXTO_LGPD, { align: 'justify', width: W, lineGap: 1.5 });

      // ---- Rodapé e numeração em todas as páginas ----
      const total = doc.bufferedPageRange().count;
      for (let i = 0; i < total; i++) {
        doc.switchToPage(i);
        const yr = doc.page.height - 42;
        doc.font('Helvetica').fontSize(6).fillColor('#6B7280')
          .text(RODAPE, X, yr, { width: W, align: 'center' });
        doc.fontSize(7).text(`Página ${i + 1} de ${total}`, X, yr + 14, { width: W, align: 'center' });
      }

      doc.end();
    });
  }

  private secao(doc: PDFKit.PDFDocument, X: number, W: number, titulo: string) {
    if (doc.y > doc.page.height - 120) { doc.addPage(); doc.y = 60; }
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(VERDE_ESCURO).text(titulo, X, doc.y);
    doc.moveTo(X, doc.y + 2).lineTo(X + W, doc.y + 2)
      .strokeColor(VERDE_ESCURO).lineWidth(0.8).stroke();
    doc.moveDown(0.6);
  }
}
