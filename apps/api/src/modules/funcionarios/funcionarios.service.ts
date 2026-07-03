import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StatusFuncionario,
  TipoDocumento,
  TipoHistoricoFuncionario,
  TipoPessoa,
} from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageService } from '../../common/storage/image.service';
import { StorageService } from '../../common/storage/storage.service';
import { QrCodeService } from '../../common/qrcode/qrcode.service';
import { gerarMatricula } from '../../common/utils/matricula.util';
import { lerAsset } from '../../common/assets.util';
import {
  ChangeStatusDto,
  CreateFuncionarioDto,
  ListFuncionariosQueryDto,
  UpdateFuncionarioDto,
} from './dto/funcionario.dto';

const MIME_PERMITIDOS: Record<string, true> = {
  'application/pdf': true,
  'application/msword': true, // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true, // .docx
  'image/jpeg': true,
  'image/png': true,
};

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';

@Injectable()
export class FuncionariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly image: ImageService,
    private readonly storage: StorageService,
    private readonly qr: QrCodeService,
  ) {}

  private async registrarHistorico(
    funcionarioId: string,
    tipo: TipoHistoricoFuncionario,
    descricao: string,
    autor?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.funcionarioHistorico.create({
      data: { funcionarioId, tipo, descricao, autor, metadata },
    });
  }

  async create(dto: CreateFuncionarioDto, autor?: string) {
    const cpf = dto.cpf.replace(/\D/g, '');
    if (await this.prisma.funcionario.findUnique({ where: { cpf } }))
      throw new BadRequestException('Já existe funcionário com este CPF');

    const total = await this.prisma.funcionario.count();
    const funcionario = await this.prisma.funcionario.create({
      data: {
        ...dto,
        cpf,
        dataNascimento: new Date(dto.dataNascimento),
        dataAdmissao: new Date(dto.dataAdmissao),
        matricula: gerarMatricula('FUNC', total + 1),
        qrToken: this.qr.gerarToken(),
      },
    });

    await this.registrarHistorico(
      funcionario.id,
      TipoHistoricoFuncionario.CADASTRO,
      `Funcionário cadastrado (${funcionario.tipo}).`,
      autor,
    );
    return funcionario;
  }

  async findAll(query: ListFuncionariosQueryDto) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const where: Prisma.FuncionarioWhereInput = {
      tipo: query.tipo,
      status: query.status,
      nome: query.nome ? { contains: query.nome, mode: 'insensitive' } : undefined,
      cpf: query.cpf ? { contains: query.cpf.replace(/\D/g, '') } : undefined,
      cargo: query.cargo ? { contains: query.cargo, mode: 'insensitive' } : undefined,
      departamento: query.departamento
        ? { contains: query.departamento, mode: 'insensitive' }
        : undefined,
    };

    const [registros, total] = await this.prisma.$transaction([
      this.prisma.funcionario.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { nome: 'asc' },
      }),
      this.prisma.funcionario.count({ where }),
    ]);

    const data = await Promise.all(
      registros.map(async (f) => ({
        ...f,
        fotoUrl: f.fotoThumbKey
          ? await this.storage.getSignedUrl(f.fotoThumbKey).catch(() => null)
          : null,
      })),
    );

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string) {
    const f = await this.prisma.funcionario.findUnique({
      where: { id },
      include: {
        documentos: { orderBy: { createdAt: 'desc' } },
        historico: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!f) throw new NotFoundException('Funcionário não encontrado');
    return f;
  }

  /** Perfil completo com URLs assinadas de foto e documentos. */
  async perfil(id: string) {
    const f = await this.findOne(id);
    const fotoUrl = f.fotoKey
      ? await this.storage.getSignedUrl(f.fotoKey).catch(() => null)
      : null;
    const documentos = await Promise.all(
      f.documentos.map(async (d) => ({
        ...d,
        url: await this.storage.getSignedUrl(d.storageKey).catch(() => null),
      })),
    );
    return { ...f, fotoUrl, documentos };
  }

  async update(id: string, dto: UpdateFuncionarioDto, autor?: string) {
    await this.findOne(id);
    const funcionario = await this.prisma.funcionario.update({
      where: { id },
      data: {
        ...dto,
        cpf: dto.cpf ? dto.cpf.replace(/\D/g, '') : undefined,
        dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : undefined,
        dataAdmissao: dto.dataAdmissao ? new Date(dto.dataAdmissao) : undefined,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFuncionario.ALTERACAO,
      'Dados cadastrais atualizados.',
      autor,
      { campos: Object.keys(dto) },
    );
    return funcionario;
  }

  async changeStatus(id: string, dto: ChangeStatusDto, autor?: string) {
    const atual = await this.findOne(id);
    const funcionario = await this.prisma.funcionario.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFuncionario.MUDANCA_STATUS,
      `Status alterado de ${atual.status} para ${dto.status}.${dto.motivo ? ' Motivo: ' + dto.motivo : ''}`,
      autor,
    );
    return funcionario;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.funcionario.delete({ where: { id } });
    return { ok: true };
  }

  async atualizarFoto(id: string, arquivo: Buffer, autor?: string) {
    const f = await this.findOne(id);
    const { fotoKey, fotoThumbKey } = await this.image.processarFoto(
      arquivo,
      `funcionarios/${id}`,
    );
    if (f.fotoKey) void this.storage.delete(f.fotoKey).catch(() => undefined);
    if (f.fotoThumbKey) void this.storage.delete(f.fotoThumbKey).catch(() => undefined);
    const atualizado = await this.prisma.funcionario.update({
      where: { id },
      data: { fotoKey, fotoThumbKey },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFuncionario.ALTERACAO,
      'Foto do colaborador atualizada.',
      autor,
    );
    return atualizado;
  }

  // ---- Documentos ----
  async addDocumento(
    id: string,
    arquivo: Express.Multer.File,
    titulo: string,
    autor?: string,
  ) {
    await this.findOne(id);
    if (!MIME_PERMITIDOS[arquivo.mimetype])
      throw new BadRequestException('Formato não permitido. Use PDF, DOC, DOCX, JPG ou PNG.');

    const ext = arquivo.originalname.split('.').pop() ?? 'bin';
    const storageKey = `funcionarios/${id}/documentos/${Date.now()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);

    const documento = await this.prisma.documento.create({
      data: {
        tipo: TipoDocumento.DOCUMENTO_PESSOAL,
        titulo: titulo || arquivo.originalname,
        storageKey,
        mimeType: arquivo.mimetype,
        tamanhoBytes: arquivo.size,
        funcionarioId: id,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFuncionario.UPLOAD_DOCUMENTO,
      `Documento anexado: ${documento.titulo}.`,
      autor,
    );
    return documento;
  }

  async removeDocumento(funcionarioId: string, documentoId: string) {
    const doc = await this.prisma.documento.findFirst({
      where: { id: documentoId, funcionarioId },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    void this.storage.delete(doc.storageKey).catch(() => undefined);
    await this.prisma.documento.delete({ where: { id: documentoId } });
    return { ok: true };
  }

  // ---- QR Code ----
  async qrCode(id: string) {
    const f = await this.findOne(id);
    const payload = this.qr.montarPayload(f.id, TipoPessoa.FUNCIONARIO, f.qrToken);
    return { payload, imagem: await this.qr.gerarImagemDataUrl(payload) };
  }

  // ---- Histórico (timeline) ----
  async historico(id: string) {
    await this.findOne(id);
    return this.prisma.funcionarioHistorico.findMany({
      where: { funcionarioId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- Carteirinha (PDF) ----
  async gerarCarteirinhaPdf(id: string, autor?: string): Promise<Buffer> {
    const f = await this.findOne(id);
    const payload = this.qr.montarPayload(f.id, TipoPessoa.FUNCIONARIO, f.qrToken);
    const qrImagem = await this.qr.gerarImagemDataUrl(payload);
    const fotoBuffer = f.fotoKey ? await this.baixarFoto(f.fotoKey) : null;

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: [340, 215], margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, 340, 50).fill(VERDE_ESCURO);
      const logoCracha = lerAsset('senatepi-horizontal-branco.png');
      if (logoCracha) {
        try {
          doc.image(logoCracha, 16, 9, { fit: [130, 24] });
        } catch {
          doc.fillColor('#FFFFFF').fontSize(14).text('SENATEPI', 16, 12);
        }
      } else {
        doc.fillColor('#FFFFFF').fontSize(14).text('SENATEPI', 16, 12);
      }
      doc.fillColor('#FFFFFF').fontSize(7).text('Crachá de Identificação Interna', 16, 36);

      if (fotoBuffer) {
        try {
          doc.image(fotoBuffer, 16, 62, { width: 70, height: 70 });
        } catch {
          /* ignora foto inválida */
        }
      }

      const x = fotoBuffer ? 98 : 16;
      doc.fillColor('#1f2937').fontSize(11).text(f.nome, x, 64, { width: 150 });
      doc.fontSize(8).fillColor('#4b5563');
      doc.text(`Cargo: ${f.cargo ?? '-'}`, x, 88);
      doc.text(`Depto: ${f.departamento ?? '-'}`, x, 102);
      doc.text(`Matrícula: ${f.matricula}`, x, 116);
      doc.text(`Status: ${f.status}`, x, 130);

      const qrBase64 = qrImagem.split(',')[1];
      doc.image(Buffer.from(qrBase64, 'base64'), 254, 70, { width: 70, height: 70 });

      doc.rect(0, 200, 340, 15).fill(VERDE_MEDIO);
      doc.fillColor('#FFFFFF').fontSize(6).text('SENATEPI — Uso interno', 16, 204);
      doc.end();
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFuncionario.GERACAO_CARTEIRINHA,
      'Carteirinha digital gerada.',
      autor,
    );
    return pdf;
  }

  private async baixarFoto(key: string): Promise<Buffer | null> {
    try {
      const url = await this.storage.getSignedUrl(key);
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}
