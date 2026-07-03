import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SituacaoFiliado,
  TipoDocumento,
  TipoHistoricoFiliado,
  TipoPessoa,
} from '@prisma/client';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageService } from '../../common/storage/image.service';
import { StorageService } from '../../common/storage/storage.service';
import { QrCodeService } from '../../common/qrcode/qrcode.service';
import { gerarMatricula, mascararCpf } from '../../common/utils/matricula.util';
import { lerAsset } from '../../common/assets.util';
import {
  calcularIdade,
  dependenteValidoParaEvento,
} from '../dependentes/dependentes.module';
import {
  ChangeSituacaoDto,
  CreateFiliadoDto,
  ListFiliadosQueryDto,
  UpdateFiliadoDto,
} from './dto/filiado.dto';

const MIME_PERMITIDOS: Record<string, true> = {
  'application/pdf': true,
  'application/msword': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'image/jpeg': true,
  'image/png': true,
};

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';

@Injectable()
export class FiliadosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly image: ImageService,
    private readonly storage: StorageService,
    private readonly qr: QrCodeService,
  ) {}

  async registrarHistorico(
    filiadoId: string,
    tipo: TipoHistoricoFiliado,
    descricao: string,
    autor?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.filiadoHistorico.create({
      data: { filiadoId, tipo, descricao, autor, metadata },
    });
  }

  async create(dto: CreateFiliadoDto, autor?: string) {
    const cpf = dto.cpf.replace(/\D/g, '');
    if (await this.prisma.filiado.findUnique({ where: { cpf } }))
      throw new BadRequestException('Já existe filiado com este CPF');

    const total = await this.prisma.filiado.count();
    const { vinculos, ...dados } = dto;

    const filiado = await this.prisma.filiado.create({
      data: {
        ...dados,
        cpf,
        dataNascimento: new Date(dto.dataNascimento),
        dataAdmissao: dto.dataAdmissao ? new Date(dto.dataAdmissao) : undefined,
        matricula: gerarMatricula('SEN', total + 1),
        qrToken: this.qr.gerarToken(),
        vinculos: vinculos
          ? { create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })) }
          : undefined,
      },
      include: { vinculos: true },
    });

    await this.registrarHistorico(
      filiado.id,
      TipoHistoricoFiliado.FILIACAO,
      'Filiação registrada.',
      autor,
    );
    return filiado;
  }

  async findAll(query: ListFiliadosQueryDto) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    // CPF sempre por prefixo (só dígitos), respeitando máscara ou não.
    const buscaDigitos = query.busca ? query.busca.replace(/\D/g, '') : '';

    const where: Prisma.FiliadoWhereInput = {
      situacao: query.situacao,
      nomeCompleto: query.nome ? { contains: query.nome, mode: 'insensitive' } : undefined,
      cpf: query.cpf ? { startsWith: query.cpf.replace(/\D/g, '') } : undefined,
      numeroCoren: query.coren ? { contains: query.coren, mode: 'insensitive' } : undefined,
      cidade: query.cidade ? { contains: query.cidade, mode: 'insensitive' } : undefined,
      createdAt:
        query.dataInicio || query.dataFim
          ? {
              gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
              lte: query.dataFim ? new Date(query.dataFim + 'T23:59:59') : undefined,
            }
          : undefined,
      // Busca unificada: nome (contém), matrícula (contém) e CPF (começa com — só dígitos)
      OR: query.busca
        ? [
            { nomeCompleto: { contains: query.busca, mode: 'insensitive' } },
            { matricula: { contains: query.busca, mode: 'insensitive' } },
            ...(buscaDigitos ? [{ cpf: { startsWith: buscaDigitos } }] : []),
          ]
        : undefined,
    };

    const [registros, total] = await this.prisma.$transaction([
      this.prisma.filiado.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { dependentes: true } } },
      }),
      this.prisma.filiado.count({ where }),
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

  /**
   * Autocomplete do cadastro legado de Filiados para telas administrativas —
   * ex.: alocação manual da Colônia. Busca por nome (contém) ou CPF (prefixo, só
   * dígitos). Retorna o PERFIL COMPLETO (para preencher a reserva sem redigitação):
   * nome, CPF, COREN, formação, e-mail, telefone, cidade, estado e vínculos/locais
   * de trabalho. Máx. 10 resultados.
   */
  async buscarParaAutocomplete(q: string) {
    const termo = (q ?? '').trim();
    if (termo.length < 2) return [];
    const digitos = termo.replace(/\D/g, '');

    // Mapeia a formação do cadastro legado para o enum da Colônia (ENF/TEC/AUX).
    const MAP_FORMACAO: Record<string, 'ENFERMEIRO' | 'TECNICO' | 'AUXILIAR' | null> = {
      ENFERMEIRO: 'ENFERMEIRO',
      TECNICO_ENFERMAGEM: 'TECNICO',
      AUXILIAR_ENFERMAGEM: 'AUXILIAR',
      OUTRO: null,
    };

    const filiados = await this.prisma.filiado.findMany({
      where: {
        OR: [
          { nomeCompleto: { contains: termo, mode: 'insensitive' } },
          ...(digitos ? [{ cpf: { startsWith: digitos } }] : []),
        ],
      },
      select: {
        id: true,
        nomeCompleto: true,
        cpf: true,
        numeroCoren: true,
        formacao: true,
        email: true,
        telefonePrincipal: true,
        cidade: true,
        estado: true,
        vinculos: {
          select: { empresa: true, cargo: true, ordem: true },
          orderBy: { ordem: 'asc' },
        },
      },
      orderBy: { nomeCompleto: 'asc' },
      take: 10,
    });

    return filiados.map((f) => ({
      id: f.id,
      nome: f.nomeCompleto,
      cpf: f.cpf,
      cpfMascarado: mascararCpf(f.cpf),
      coren: f.numeroCoren,
      // Só os dígitos do COREN (o sufixo -ENF/-TE/-AE é derivado da formação no front).
      corenNumero: f.numeroCoren ? f.numeroCoren.replace(/\D/g, '').slice(0, 6) || null : null,
      formacao: f.formacao ? MAP_FORMACAO[f.formacao] ?? null : null,
      email: f.email,
      telefone: f.telefonePrincipal,
      cidade: f.cidade,
      estado: f.estado,
      // Locais de trabalho a partir dos vínculos (ordenados).
      localTrabalho1: f.vinculos[0]?.empresa ?? null,
      localTrabalho2: f.vinculos[1]?.empresa ?? null,
      vinculos: f.vinculos.map((v) => ({ empresa: v.empresa, cargo: v.cargo })),
    }));
  }

  async findOne(id: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id },
      include: { vinculos: { orderBy: { ordem: 'asc' } }, dependentes: true, carteirinha: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');
    return filiado;
  }

  /** Perfil completo com tudo que a tela de perfil precisa. */
  async perfil(id: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        dependentes: { orderBy: { createdAt: 'asc' } },
        carteirinha: true,
        documentos: { orderBy: { createdAt: 'desc' } },
        historico: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');

    const fotoUrl = filiado.fotoKey
      ? await this.storage.getSignedUrl(filiado.fotoKey).catch(() => null)
      : null;

    const dependentes = await Promise.all(
      filiado.dependentes.map(async (d) => ({
        ...d,
        idade: calcularIdade(d.dataNascimento),
        validoParaEvento: dependenteValidoParaEvento(d.tipo, d.dataNascimento),
        fotoUrl: d.fotoThumbKey
          ? await this.storage.getSignedUrl(d.fotoThumbKey).catch(() => null)
          : null,
      })),
    );

    const todosDocs = await Promise.all(
      filiado.documentos.map(async (d) => ({
        ...d,
        url: await this.storage.getSignedUrl(d.storageKey).catch(() => null),
      })),
    );
    const documentos = todosDocs.filter((d) => d.tipo !== TipoDocumento.TERMO_CONSENTIMENTO);
    const termos = todosDocs.filter((d) => d.tipo === TipoDocumento.TERMO_CONSENTIMENTO);

    return { ...filiado, fotoUrl, dependentes, documentos, termos };
  }

  async update(id: string, dto: UpdateFiliadoDto, autor?: string) {
    await this.findOne(id);
    const { vinculos, ...dados } = dto;

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        ...dados,
        cpf: dto.cpf ? dto.cpf.replace(/\D/g, '') : undefined,
        dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : undefined,
        dataAdmissao: dto.dataAdmissao ? new Date(dto.dataAdmissao) : undefined,
        // Substitui os vínculos quando enviados
        vinculos: vinculos
          ? {
              deleteMany: {},
              create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })),
            }
          : undefined,
      },
      include: { vinculos: true },
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.ALTERACAO,
      'Dados cadastrais atualizados.',
      autor,
      { campos: Object.keys(dados) },
    );
    return filiado;
  }

  async changeSituacao(id: string, dto: ChangeSituacaoDto, autor?: string) {
    const atual = await this.findOne(id);
    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        situacao: dto.situacao,
        aprovadoEm:
          dto.situacao === SituacaoFiliado.ATIVO && !atual.aprovadoEm
            ? new Date()
            : undefined,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.MUDANCA_STATUS,
      `Situação alterada de ${atual.situacao} para ${dto.situacao}.${dto.motivo ? ' Motivo: ' + dto.motivo : ''}`,
      autor,
    );
    return filiado;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.filiado.delete({ where: { id } });
    return { ok: true };
  }

  async atualizarFoto(id: string, arquivo: Buffer, autor?: string) {
    const filiado = await this.findOne(id);
    const { fotoKey, fotoThumbKey } = await this.image.processarFoto(
      arquivo,
      `filiados/${id}`,
    );
    if (filiado.fotoKey) void this.storage.delete(filiado.fotoKey).catch(() => undefined);
    if (filiado.fotoThumbKey) void this.storage.delete(filiado.fotoThumbKey).catch(() => undefined);
    const atualizado = await this.prisma.filiado.update({
      where: { id },
      data: { fotoKey, fotoThumbKey },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.ALTERACAO,
      'Foto do filiado atualizada.',
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
    const storageKey = `filiados/${id}/documentos/${Date.now()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);

    const documento = await this.prisma.documento.create({
      data: {
        tipo: TipoDocumento.DOCUMENTO_PESSOAL,
        titulo: titulo || arquivo.originalname,
        storageKey,
        mimeType: arquivo.mimetype,
        tamanhoBytes: arquivo.size,
        filiadoId: id,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.UPLOAD_DOCUMENTO,
      `Documento anexado: ${documento.titulo}.`,
      autor,
    );
    return documento;
  }

  async removeDocumento(filiadoId: string, documentoId: string) {
    const doc = await this.prisma.documento.findFirst({
      where: { id: documentoId, filiadoId },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    void this.storage.delete(doc.storageKey).catch(() => undefined);
    await this.prisma.documento.delete({ where: { id: documentoId } });
    return { ok: true };
  }

  // ---- QR Code ----
  async qrCode(id: string) {
    const filiado = await this.findOne(id);
    const payload = this.qr.montarPayload(filiado.id, TipoPessoa.FILIADO, filiado.qrToken);
    return { payload, imagem: await this.qr.gerarImagemDataUrl(payload) };
  }

  // ---- Histórico ----
  async historico(id: string) {
    await this.findOne(id);
    return this.prisma.filiadoHistorico.findMany({
      where: { filiadoId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- Termo de Consentimento e Filiação (PDF) ----
  async gerarTermoPdf(id: string, autor?: string): Promise<Buffer> {
    const f = await this.findOne(id);

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Cabeçalho
      doc.rect(0, 0, doc.page.width, 70).fill(VERDE_ESCURO);
      const logoTermo = lerAsset('senatepi-horizontal-branco.png');
      if (logoTermo) {
        try {
          doc.image(logoTermo, 50, 16, { fit: [190, 26] });
        } catch {
          doc.fillColor('#FFFFFF').fontSize(18).text('SENATEPI', 50, 22);
        }
      } else {
        doc.fillColor('#FFFFFF').fontSize(18).text('SENATEPI', 50, 22);
      }
      doc.fillColor('#FFFFFF').fontSize(9).text('Sindicato dos Enfermeiros, Auxiliares e Técnicos em Enfermagem do Piauí', 50, 48);
      doc.moveDown(2);

      doc.fillColor('#1f2937').fontSize(14).text('TERMO DE CONSENTIMENTO E FILIAÇÃO', 50, 95, {
        align: 'center',
        width: doc.page.width - 100,
      });
      doc.moveDown(1.5);

      const linha = (label: string, valor?: string | null) =>
        doc.fontSize(10).fillColor('#374151').text(`${label}: `, { continued: true }).fillColor('#111827').text(valor || '-');

      doc.fillColor(VERDE_ESCURO).fontSize(12).text('1. Dados Pessoais');
      doc.moveDown(0.3);
      linha('Nome completo', f.nomeCompleto);
      linha('CPF', mascararCpf(f.cpf));
      linha('RG', `${f.rg ?? '-'} ${f.ufRg ? '/ ' + f.ufRg : ''}`);
      linha('Data de nascimento', f.dataNascimento?.toLocaleDateString('pt-BR') ?? '-');
      linha('Matrícula sindical', f.matricula);
      doc.moveDown(0.8);

      doc.fillColor(VERDE_ESCURO).fontSize(12).text('2. Dados Profissionais');
      doc.moveDown(0.3);
      linha('Formação', f.formacao ?? '-');
      linha('Número COREN', f.numeroCoren);
      doc.moveDown(0.8);

      doc.fillColor(VERDE_ESCURO).fontSize(12).text('3. Autorização de Desconto Sindical');
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#374151').text(
        'Autorizo o desconto da contribuição sindical em folha de pagamento ou boleto, conforme estatuto e assembleia da categoria, em favor do SENATEPI.',
        { align: 'justify' },
      );
      doc.moveDown(0.8);

      doc.fillColor(VERDE_ESCURO).fontSize(12).text('4. Consentimento (LGPD - Lei nº 13.709/2018)');
      doc.moveDown(0.3);
      doc.fontSize(10).fillColor('#374151').text(
        'Declaro estar ciente e consinto, de forma livre e informada, com o tratamento dos meus dados pessoais pelo SENATEPI para as finalidades de filiação, representação sindical, emissão de carteirinha, controle de eventos e benefícios, nos termos da Lei Geral de Proteção de Dados.',
        { align: 'justify' },
      );
      doc.moveDown(2.5);

      const y = doc.y;
      doc.moveTo(80, y).lineTo(300, y).strokeColor('#9ca3af').stroke();
      doc.fontSize(9).fillColor('#374151').text('Assinatura do(a) Filiado(a)', 80, y + 5);
      doc.text(`Teresina/PI, ${new Date().toLocaleDateString('pt-BR')}`, 340, y + 5);

      doc.end();
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.GERACAO_TERMO,
      'Termo de Consentimento e Filiação gerado.',
      autor,
    );
    return pdf;
  }
}
