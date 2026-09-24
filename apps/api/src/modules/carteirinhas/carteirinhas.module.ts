import { QrCodeService, StorageService, mascararCpf } from '@core/infra';
import { anoBR, daquiAUmAnoBR, formatarDataBR } from '../../modules/processos/utils/data-br.util';
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  conteudoDisposto, nomeDeArquivo, type DocumentoGerado,
} from '@core/infra';
import PDFDocument from 'pdfkit';
import {
  SituacaoFiliado,
  StatusCarteirinha,
  TipoHistoricoFiliado,
  TipoPessoa,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { lerLogoDaMarca } from '../../common/assets.util';
import { Roles } from '../../common/decorators/roles.decorator';
import { tenant } from '../../tenant/tenant.config';
import { coresDaCarteirinha } from './cor-da-carteirinha.util';
import { ModuloTenant } from '../../common/tenant/modulo-tenant.decorator';
import { Modulo } from '../../common/permissions/modulo.decorator';

/*
  AS CORES SÃO DA CASA, NÃO DO SENATEPI (24/09/2026).

  Estavam cravadas aqui — e com elas o nome, duas linhas abaixo. A carteirinha
  do SINDSERM sairia VERDE, com o nome do sindicato dos enfermeiros. Ver
  `cor-da-carteirinha.util`: as duas saem de `tenant.corInstitucional`, e o tom
  claro derivado reproduz o par que estava à mão (#1B7F0A → #5E9F4D, contra o
  #4FA11B de antes).
*/
const { forte: COR_FORTE, clara: COR_CLARA } = coresDaCarteirinha(tenant.corInstitucional);

@Injectable()
export class CarteirinhasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly storage: StorageService,
  ) {}

  /** Emite (ou retorna) a carteirinha após aprovação da filiação. */
  async emitir(filiadoId: string) {
    const filiado = await this.prisma.filiado.findUnique({ where: { id: filiadoId } });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');
    if (filiado.situacao !== SituacaoFiliado.ATIVO)
      throw new BadRequestException('Carteirinha só pode ser emitida para filiado ATIVO');

    const existente = await this.prisma.carteirinha.findUnique({ where: { filiadoId } });
    if (existente) return existente;

    const total = await this.prisma.carteirinha.count();
    /* Um ano pelo calendário DAQUI — `setFullYear` lê o relógio do contêiner,
       que às 21h de 31/12 já virou o ano. Ver `daquiAUmAnoBR`. */
    const validaAte = daquiAUmAnoBR();

    const carteirinha = await this.prisma.carteirinha.create({
      data: {
        filiadoId,
        numero: `CART-${anoBR()}-${String(total + 1).padStart(6, '0')}`,
        validaAte,
        status: StatusCarteirinha.ATIVA,
      },
    });

    await this.prisma.filiadoHistorico.create({
      data: {
        filiadoId,
        tipo: TipoHistoricoFiliado.GERACAO_CARTEIRINHA,
        descricao: `Carteirinha digital emitida (${carteirinha.numero}).`,
      },
    });
    return carteirinha;
  }

  /** Dados para a versão mobile/JSON da carteirinha. */
  async dados(filiadoId: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      include: { carteirinha: true },
    });
    if (!filiado || !filiado.carteirinha)
      throw new NotFoundException('Carteirinha não emitida');

    const payload = this.qr.montarPayload(filiado.id, TipoPessoa.FILIADO, filiado.qrToken);
    const fotoUrl = filiado.fotoKey
      ? await this.storage.getSignedUrl(filiado.fotoKey).catch(() => null)
      : null;

    return {
      nome: filiado.nomeCompleto,
      cpfMascarado: mascararCpf(filiado.cpf),
      matricula: filiado.matricula,
      categoria: filiado.formacao,
      numero: filiado.carteirinha.numero,
      emitidaEm: filiado.carteirinha.emitidaEm,
      validaAte: filiado.carteirinha.validaAte,
      status: filiado.carteirinha.status,
      fotoUrl,
      qrImagem: await this.qr.gerarImagemDataUrl(payload),
    };
  }

  /**
   * Gera o PDF da carteirinha (formato cartão, estilo institucional).
   *
   * Devolve o NOME junto com o conteúdo. O controller sozinho só tem o id, e o
   * nome do arquivo saía `carteirinha-<uuid>.pdf` — doze carteirinhas baixadas
   * numa tarde viravam doze arquivos indistinguíveis na pasta. Quem já carregou
   * o filiado para desenhar o cartão é quem sabe como ele se chama.
   */
  async gerarPdf(filiadoId: string): Promise<DocumentoGerado> {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      include: { carteirinha: true },
    });
    if (!filiado || !filiado.carteirinha)
      throw new NotFoundException('Carteirinha não emitida');

    const carteirinha = filiado.carteirinha;
    const payload = this.qr.montarPayload(filiado.id, TipoPessoa.FILIADO, filiado.qrToken);
    const qrImagem = await this.qr.gerarImagemDataUrl(payload);
    const fotoBuffer = filiado.fotoKey ? await this.storage.getBuffer(filiado.fotoKey) : null;

    // Dimensões do cartão (paisagem)
    const W = 520;
    const H = 320;
    const PANEL = 150; // largura do painel lateral verde
    const dataFiliacao = formatarDataBR(filiado.aprovadoEm ?? filiado.createdAt);

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: [W, H], margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Fundo branco + borda
      doc.rect(0, 0, W, H).fill('#FFFFFF');

      // Faixa superior fina (verde)
      doc.rect(0, 0, W - PANEL, 8).fill(COR_CLARA);

      // ----- Cabeçalho (lado esquerdo) -----
      const x = 24;
      /*
        O NOME É O DO CLIENTE. Estava escrito em duas linhas fixas com o nome do
        SENATEPI; `nomeCurto` do tenant já existia e cabe nas mesmas duas linhas
        (o PDFKit quebra sozinho dentro da largura), com `height` para nenhum
        nome comprido invadir o corpo do cartão.
      */
      doc.fillColor(COR_FORTE).font('Helvetica-Bold').fontSize(13);
      doc.text(tenant.nomeCurto, x, 26, { width: W - PANEL - 40, height: 32, ellipsis: true });
      doc.moveTo(x, 64).lineTo(W - PANEL - 16, 64).strokeColor('#D1D5DB').lineWidth(1).stroke();
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11).text('CARTEIRA DE ASSOCIADO', x, 72);

      // ----- Campos -----
      const campo = (label: string, valor: string, cx: number, cy: number, w = 220) => {
        doc.fillColor(COR_CLARA).font('Helvetica').fontSize(6.5).text(label.toUpperCase(), cx, cy);
        doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10).text(valor || '-', cx, cy + 9, { width: w });
      };

      let y = 98;
      campo('Profissional associado(a)', filiado.nomeCompleto, x, y, W - PANEL - 40);
      y += 34;
      campo('Categoria', filiado.formacao ?? '-', x, y, 140);
      campo('Situação', filiado.situacao, x + 150, y, 80);
      campo('UF', filiado.estado ?? 'PI', x + 240, y, 40);
      y += 34;
      campo('Data de filiação', dataFiliacao, x, y, 140);
      campo('Matrícula', filiado.matricula, x + 150, y, 130);
      y += 34;
      campo('RG', `${filiado.rg ?? '-'}${filiado.ufRg ? ' - ' + filiado.ufRg : ''}`, x, y, 140);
      campo('CPF', mascararCpf(filiado.cpf), x + 150, y, 130);

      // ----- Assinatura -----
      const sy = H - 40;
      doc.moveTo(x, sy).lineTo(x + 180, sy).strokeColor('#9CA3AF').lineWidth(0.8).stroke();
      doc.fillColor('#6B7280').font('Helvetica').fontSize(7).text('Assinatura do(a) Presidente', x, sy + 4);
      doc.fillColor('#9CA3AF').fontSize(6).text(`Nº ${carteirinha.numero}  ·  Válida até ${formatarDataBR(carteirinha.validaAte)}`, x, sy + 16);

      // ----- Painel lateral (verde) -----
      doc.rect(W - PANEL, 0, PANEL, H).fill(COR_FORTE);

      // Foto no topo do painel
      const fw = 110;
      const fh = 132;
      const fx = W - PANEL + (PANEL - fw) / 2;
      const fy = 22;
      doc.save();
      doc.roundedRect(fx, fy, fw, fh, 6).clip();
      if (fotoBuffer) {
        try {
          doc.image(fotoBuffer, fx, fy, { width: fw, height: fh, align: 'center', valign: 'center' });
        } catch {
          doc.rect(fx, fy, fw, fh).fill('#FFFFFF');
        }
      } else {
        doc.rect(fx, fy, fw, fh).fill('#E5E7EB');
      }
      doc.restore();

      // Logo (imagem branca) com fallback textual
      const logo = lerLogoDaMarca();
      if (logo) {
        try {
          doc.image(logo, W - PANEL + 20, fy + fh + 10, {
            fit: [PANEL - 40, 34],
            align: 'center',
            valign: 'center',
          });
        } catch {
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text(tenant.sigla, W - PANEL, fy + fh + 14, { width: PANEL, align: 'center' });
        }
      } else {
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text(tenant.sigla, W - PANEL, fy + fh + 14, { width: PANEL, align: 'center' });
      }

      // QR Code no painel
      const qrSize = 92;
      const qx = W - PANEL + (PANEL - qrSize) / 2;
      const qy = fy + fh + 44;
      doc.rect(qx - 5, qy - 5, qrSize + 10, qrSize + 10).fill('#FFFFFF');
      const qrBase64 = qrImagem.split(',')[1];
      doc.image(Buffer.from(qrBase64, 'base64'), qx, qy, { width: qrSize, height: qrSize });

      doc.end();
    });

    return {
      pdf,
      nomeArquivo: nomeDeArquivo(['Carteirinha', filiado.nomeCompleto], 'pdf'),
    };
  }
}

@ApiTags('carteirinhas')
@ApiBearerAuth()
@ModuloTenant('filiados')
@Modulo('filiados')
@Controller('filiados/:filiadoId/carteirinha')
class CarteirinhasController {
  constructor(private readonly service: CarteirinhasService) {}

  @Post('emitir') @Roles(UserRole.ADMINISTRADOR, UserRole.COORDENACAO)
  emitir(@Param('filiadoId') filiadoId: string) {
    return this.service.emitir(filiadoId);
  }

  @Get()
  dados(@Param('filiadoId') filiadoId: string) {
    return this.service.dados(filiadoId);
  }

  @Get('pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('filiadoId') filiadoId: string, @Res() res: Response) {
    const { pdf, nomeArquivo } = await this.service.gerarPdf(filiadoId);
    res.setHeader('Content-Disposition', conteudoDisposto(nomeArquivo));
    res.send(pdf);
  }
}

@Module({
  controllers: [CarteirinhasController],
  providers: [CarteirinhasService],
  exports: [CarteirinhasService],
})
export class CarteirinhasModule {}
