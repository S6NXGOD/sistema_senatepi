import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { lerAsset } from '../../common/assets.util';
import { lerConfiguracoes } from './configuracoes-evento';

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';

/**
 * Certificado de participação (modo "curso").
 *
 * O CÓDIGO DE VERIFICAÇÃO
 * É um HMAC do par (evento, presença) truncado em 12 caracteres. Serve para
 * responder à única pergunta que importa num certificado: "este documento é
 * legítimo?".
 *
 * Não é aleatório de propósito — um código sorteado exigiria uma tabela nova só
 * para guardá-lo. Derivado, ele é reconstituível a partir dos dados que já
 * existem, e ainda assim impossível de forjar sem o segredo do servidor.
 *
 * Reusa QR_SIGNING_SECRET, o mesmo segredo que assina os QR Codes da
 * carteirinha: é a chave que o sistema já trata como sigilosa, e criar uma
 * segunda multiplicaria os lugares onde um vazamento faria estrago.
 */
@Injectable()
export class CertificadoService {
  constructor(private readonly prisma: PrismaService) {}

  private segredo(): string {
    return process.env.QR_SIGNING_SECRET ?? 'senatepi-dev-secret';
  }

  private codigo(eventoId: string, presencaId: string): string {
    return createHmac('sha256', this.segredo())
      .update(`certificado:${eventoId}:${presencaId}`)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase()
      .replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
  }

  /**
   * Confere um código sem exigir login.
   *
   * Certificado que ninguém de fora consegue conferir não vale como
   * comprovante: quem recebe o documento — hospital, universidade, banca de
   * concurso — precisa validar sem ter conta no sistema do sindicato.
   */
  async verificar(codigo: string) {
    const limpo = codigo.trim().toUpperCase();

    // Percorre as presenças de eventos com certificado habilitado e compara o
    // HMAC. São poucas centenas por evento; um índice por código exigiria
    // persistir o que já é derivável.
    const presencas = await this.prisma.presenca.findMany({
      where: { evento: { status: { in: ['REALIZADO', 'EM_ANDAMENTO'] } } },
      select: {
        id: true, eventoId: true, nomeSnapshot: true, registradoEm: true,
        evento: { select: { nome: true, dataInicio: true, configuracoes: true } },
      },
    });

    for (const p of presencas) {
      if (this.codigo(p.eventoId, p.id) !== limpo) continue;
      const cfg = lerConfiguracoes(p.evento.configuracoes);
      if (!cfg.gerarCertificado) continue;
      return {
        valido: true,
        participante: p.nomeSnapshot,
        evento: p.evento.nome,
        data: p.evento.dataInicio,
        cargaHoraria: cfg.cargaHoraria ?? null,
      };
    }
    return { valido: false as const };
  }

  async gerar(eventoId: string, presencaId: string): Promise<Buffer> {
    const presenca = await this.prisma.presenca.findFirst({
      where: { id: presencaId, eventoId },
      select: {
        id: true, nomeSnapshot: true,
        filiado: { select: { matricula: true, cpf: true } },
        evento: {
          select: {
            id: true, nome: true, dataInicio: true, dataFim: true,
            local: true, configuracoes: true,
          },
        },
      },
    });
    if (!presenca) throw new NotFoundException('Participação não encontrada neste evento.');

    const cfg = lerConfiguracoes(presenca.evento.configuracoes);
    if (!cfg.gerarCertificado) {
      throw new BadRequestException(
        'Este evento não emite certificado. Ative a opção nas configurações do evento.',
      );
    }

    const codigo = this.codigo(eventoId, presencaId);

    return new Promise<Buffer>((resolve, reject) => {
      // PAISAGEM: certificado é documento de parede, não de arquivo.
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const H = doc.page.height;

      // Moldura
      doc.rect(0, 0, W, 14).fill(VERDE_ESCURO);
      doc.rect(0, H - 14, W, 14).fill(VERDE_ESCURO);
      doc.rect(0, 14, 8, H - 28).fill(VERDE_MEDIO);
      doc.rect(W - 8, 14, 8, H - 28).fill(VERDE_MEDIO);

      // Faixa do cabeçalho — a logo do acervo é BRANCA e exige fundo escuro.
      doc.rect(8, 14, W - 16, 64).fill(VERDE_ESCURO);
      const logo = lerAsset('senatepi-horizontal-branco.png');
      if (logo) {
        try { doc.image(logo, 40, 28, { fit: [140, 36] }); } catch { /* segue sem logo */ }
      }
      doc.font('Helvetica').fontSize(7.5).fillColor('#E8F5E3').text(
        'SINDICATO DOS ENFERMEIROS, AUXILIARES E TÉCNICOS EM ENFERMAGEM DO ESTADO DO PIAUÍ\nCNPJ: 11.378.331/0001-86',
        W - 350, 34, { align: 'right', width: 300, lineGap: 2 },
      );

      doc.y = 120;
      doc.font('Times-Bold').fontSize(30).fillColor('#111827')
        .text('CERTIFICADO', 40, doc.y, { align: 'center', width: W - 80, characterSpacing: 3 });

      doc.moveDown(0.9);
      doc.font('Times-Roman').fontSize(12).fillColor('#374151')
        .text('Certificamos que', 40, doc.y, { align: 'center', width: W - 80 });

      doc.moveDown(0.5);
      doc.font('Times-Bold').fontSize(22).fillColor(VERDE_ESCURO)
        .text(presenca.nomeSnapshot, 40, doc.y, { align: 'center', width: W - 80 });

      doc.moveDown(0.6);
      const periodo = presenca.evento.dataFim
        ? `de ${presenca.evento.dataInicio.toLocaleDateString('pt-BR')} a ${presenca.evento.dataFim.toLocaleDateString('pt-BR')}`
        : `em ${presenca.evento.dataInicio.toLocaleDateString('pt-BR')}`;

      doc.font('Times-Roman').fontSize(12.5).fillColor('#111827').text(
        `participou de ${presenca.evento.nome}, realizado ${periodo}` +
        (cfg.cargaHoraria ? `, com carga horária de ${cfg.cargaHoraria} hora(s)` : '') +
        (presenca.evento.local ? `, em ${presenca.evento.local}` : '') + '.',
        90, doc.y, { align: 'center', width: W - 180, lineGap: 4 },
      );

      // Assinatura institucional
      const yAss = H - 130;
      doc.moveTo(W / 2 - 130, yAss).lineTo(W / 2 + 130, yAss)
        .strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
        .text('DIRETORIA DO SENATEPI', W / 2 - 130, yAss + 6, { align: 'center', width: 260 });

      // Código de verificação — é o que torna o documento conferível por quem
      // o recebe, sem precisar de acesso ao sistema.
      doc.font('Helvetica').fontSize(7.5).fillColor('#6B7280').text(
        `Código de verificação: ${codigo}`,
        40, H - 62, { align: 'center', width: W - 80 },
      );
      doc.fontSize(7).text(
        'A autenticidade deste certificado pode ser conferida junto ao SENATEPI ' +
        'mediante informação do código acima.',
        40, H - 50, { align: 'center', width: W - 80 },
      );

      doc.end();
    });
  }

  /** Lista de quem tem direito ao certificado — alimenta a tela da mesa. */
  async elegiveis(eventoId: string) {
    const evento = await this.prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) throw new NotFoundException('Evento não encontrado.');

    const cfg = lerConfiguracoes(evento.configuracoes);
    if (!cfg.gerarCertificado) return { habilitado: false, participantes: [] };

    const presencas = await this.prisma.presenca.findMany({
      where: { eventoId },
      orderBy: { nomeSnapshot: 'asc' },
      select: {
        id: true, nomeSnapshot: true,
        filiado: { select: { matricula: true } },
      },
    });

    return {
      habilitado: true,
      cargaHoraria: cfg.cargaHoraria ?? null,
      participantes: presencas.map((p) => ({
        presencaId: p.id,
        nome: p.nomeSnapshot,
        matricula: p.filiado?.matricula ?? '—',
        codigo: this.codigo(eventoId, p.id),
      })),
    };
  }
}
