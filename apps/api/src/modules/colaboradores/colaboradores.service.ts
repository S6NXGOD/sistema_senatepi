import {
  ImageService,
  QrCodeService,
  StorageService,
  dataCalendario,
  dataCalendarioOuNulo,
  gerarMatricula,
} from '@core/infra';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  Prisma,
  StatusColaborador,
  TipoDocumento,
  TipoHistoricoColaborador,
  TipoPessoa,
  TipoVinculo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

import { lerAsset } from '../../common/assets.util';
import {
  AlterarStatusColaboradorDto,
  CreateColaboradorDto,
  ListColaboradoresQueryDto,
  UpdateColaboradorDto,
} from './dto/colaborador.dto';

import { tenant } from '../../tenant/tenant.config';

const INCLUDE = {
  cargo: { select: { id: true, nome: true } },
  departamento: { select: { id: true, nome: true } },
  empresa: { select: { id: true, razaoSocial: true, cnpj: true } },
} satisfies Prisma.ColaboradorInclude;

const STATUS_LABEL: Record<StatusColaborador, string> = {
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  AFASTADO: 'Afastado',
  FERIAS: 'Férias',
  DESLIGADO: 'Desligado',
};

/** Cores do crachá (as mesmas da carteirinha do filiado). */
const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';

@Injectable()
export class ColaboradoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
    private readonly qr: QrCodeService,
  ) {}

  // ---- Helpers ----
  private async resolverFoto<T extends { fotoKey: string | null; fotoUrl: string | null }>(c: T): Promise<T> {
    const fotoUrl = c.fotoKey
      ? await this.storage.getSignedUrl(c.fotoKey).catch(() => c.fotoUrl)
      : c.fotoUrl;
    return { ...c, fotoUrl };
  }

  private async registrarHistorico(
    colaboradorId: string,
    tipo: TipoHistoricoColaborador,
    descricao: string,
    autor?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.colaboradorHistorico.create({
      data: { colaboradorId, tipo, descricao, autor, metadata },
    });
  }

  /** Retorna à ATIVO os colaboradores cujas férias já venceram (automático). */
  private async reconciliarFerias() {
    const vencidas = await this.prisma.colaborador.findMany({
      where: { status: StatusColaborador.FERIAS, feriasRetornoEm: { lte: new Date() } },
      select: { id: true },
    });
    for (const c of vencidas) {
      await this.prisma.colaborador.update({
        where: { id: c.id },
        data: { status: StatusColaborador.ATIVO, feriasInicio: null, feriasRetornoEm: null },
      });
      await this.registrarHistorico(
        c.id,
        TipoHistoricoColaborador.MUDANCA_STATUS,
        'Retorno automático de férias — status alterado para ATIVO.',
        'Sistema',
      );
    }
  }

  private aplicarRegrasVinculo(
    tipo: TipoVinculo,
    dados: { empresaId?: string | null; vencimentoContrato?: Date | null; instituicaoEnsino?: string | null },
  ) {
    if (tipo === TipoVinculo.PJ || tipo === TipoVinculo.TERCEIRIZADO) {
      if (!dados.empresaId) throw new BadRequestException('Para vínculo PJ/Terceirizado, informe a Empresa.');
      dados.instituicaoEnsino = null;
    } else if (tipo === TipoVinculo.ESTAGIO) {
      if (!dados.instituicaoEnsino) throw new BadRequestException('Para Estágio, informe a Instituição de Ensino.');
      dados.empresaId = null;
    } else {
      dados.empresaId = null;
      dados.vencimentoContrato = null;
      dados.instituicaoEnsino = null;
    }
    return dados;
  }

  private traduzir(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') throw new ConflictException('Já existe um colaborador com este CPF.');
      if (e.code === 'P2003') throw new BadRequestException('Cargo, departamento ou empresa informado não existe.');
      if (e.code === 'P2025') throw new NotFoundException('Colaborador não encontrado.');
    }
    throw e as Error;
  }

  // ---- CRUD ----
  async create(dto: CreateColaboradorDto, autor?: string) {
    const cpf = dto.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) throw new BadRequestException('CPF inválido.');
    const cond = this.aplicarRegrasVinculo(dto.tipoVinculo, {
      empresaId: dto.empresaId || null,
      vencimentoContrato: dto.vencimentoContrato ? new Date(dto.vencimentoContrato) : null,
      instituicaoEnsino: dto.instituicaoEnsino?.trim() || null,
    });
    try {
      const c = await this.prisma.colaborador.create({
        data: {
          nome: dto.nome.trim(),
          cpf,
          tipoVinculo: dto.tipoVinculo,
          status: dto.status,
          dataNascimento: dataCalendarioOuNulo(dto.dataNascimento) ?? null,
          telefone: dto.telefone || null,
          email: dto.email || null,
          dataAdmissao: dataCalendarioOuNulo(dto.dataAdmissao) ?? null,
          cep: dto.cep || null,
          logradouro: dto.logradouro || null,
          numero: dto.numero || null,
          bairro: dto.bairro || null,
          cidade: dto.cidade || null,
          uf: dto.uf ? dto.uf.toUpperCase() : null,
          cargoId: dto.cargoId,
          departamentoId: dto.departamentoId,
          empresaId: cond.empresaId,
          vencimentoContrato: cond.vencimentoContrato,
          instituicaoEnsino: cond.instituicaoEnsino,
          // Identificação física: matrícula sequencial e token do QR de entrada.
          // Nascem com o cadastro para que emitir o crachá seja um clique, e não
          // um segundo cadastro noutra tela — que foi exatamente o que criou as
          // fichas duplicadas de Funcionário.
          matricula: await this.proximaMatricula(),
          qrToken: this.qr.gerarToken(),
        },
        include: INCLUDE,
      });
      await this.registrarHistorico(c.id, TipoHistoricoColaborador.CADASTRO, 'Colaborador cadastrado.', autor);
      return this.resolverFoto(c);
    } catch (e) {
      this.traduzir(e);
    }
  }

  async findAll(query: ListColaboradoresQueryDto) {
    await this.reconciliarFerias();
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const digitos = query.busca ? query.busca.replace(/\D/g, '') : '';

    const where: Prisma.ColaboradorWhereInput = {
      status: query.status,
      departamentoId: query.departamentoId,
      OR: query.busca
        ? [
            { nome: { contains: query.busca, mode: 'insensitive' } },
            ...(digitos ? [{ cpf: { startsWith: digitos } }] : []),
          ]
        : undefined,
    };

    const [registros, total] = await this.prisma.$transaction([
      this.prisma.colaborador.findMany({
        where,
        include: INCLUDE,
        orderBy: { nome: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.colaborador.count({ where }),
    ]);
    const data = await Promise.all(registros.map((c) => this.resolverFoto(c)));
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string) {
    await this.reconciliarFerias();
    const c = await this.prisma.colaborador.findUnique({
      where: { id },
      include: {
        ...INCLUDE,
        historico: { orderBy: { createdAt: 'desc' } },
        documentos: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Colaborador não encontrado.');
    const comFoto = await this.resolverFoto(c);
    const documentos = await Promise.all(
      c.documentos.map(async (d) => ({ ...d, url: await this.storage.getSignedUrl(d.storageKey).catch(() => null) })),
    );
    return { ...comFoto, documentos };
  }

  async update(id: string, dto: UpdateColaboradorDto, autor?: string) {
    const atual = await this.prisma.colaborador.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Colaborador não encontrado.');
    const tipoVinculo = dto.tipoVinculo ?? atual.tipoVinculo;
    const cpf = dto.cpf ? dto.cpf.replace(/\D/g, '') : atual.cpf;
    if (cpf.length !== 11) throw new BadRequestException('CPF inválido.');

    const cond = this.aplicarRegrasVinculo(tipoVinculo, {
      empresaId: dto.empresaId !== undefined ? dto.empresaId || null : atual.empresaId,
      vencimentoContrato:
        dto.vencimentoContrato !== undefined
          ? dto.vencimentoContrato ? new Date(dto.vencimentoContrato) : null
          : atual.vencimentoContrato,
      instituicaoEnsino:
        dto.instituicaoEnsino !== undefined ? dto.instituicaoEnsino?.trim() || null : atual.instituicaoEnsino,
    });

    try {
      const c = await this.prisma.colaborador.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          cpf,
          tipoVinculo,
          dataNascimento: dataCalendarioOuNulo(dto.dataNascimento),
          telefone: dto.telefone !== undefined ? dto.telefone || null : undefined,
          email: dto.email !== undefined ? dto.email || null : undefined,
          dataAdmissao: dataCalendarioOuNulo(dto.dataAdmissao),
          cep: dto.cep !== undefined ? dto.cep || null : undefined,
          logradouro: dto.logradouro !== undefined ? dto.logradouro || null : undefined,
          numero: dto.numero !== undefined ? dto.numero || null : undefined,
          bairro: dto.bairro !== undefined ? dto.bairro || null : undefined,
          cidade: dto.cidade !== undefined ? dto.cidade || null : undefined,
          uf: dto.uf !== undefined ? (dto.uf ? dto.uf.toUpperCase() : null) : undefined,
          cargoId: dto.cargoId,
          departamentoId: dto.departamentoId,
          empresaId: cond.empresaId,
          vencimentoContrato: cond.vencimentoContrato,
          instituicaoEnsino: cond.instituicaoEnsino,
        },
        include: INCLUDE,
      });
      await this.registrarHistorico(id, TipoHistoricoColaborador.ALTERACAO, 'Dados cadastrais atualizados.', autor);
      return this.resolverFoto(c);
    } catch (e) {
      this.traduzir(e);
    }
  }

  async remove(id: string) {
    const c = await this.prisma.colaborador.findUnique({ where: { id }, select: { fotoKey: true } });
    if (!c) throw new NotFoundException('Colaborador não encontrado.');
    if (c.fotoKey) void this.storage.delete(c.fotoKey).catch(() => undefined);
    await this.prisma.colaborador.delete({ where: { id } });
    return { ok: true };
  }

  // ---- Foto (upload) ----
  async atualizarFoto(id: string, arquivo: Buffer, autor?: string) {
    const atual = await this.prisma.colaborador.findUnique({
      where: { id },
      select: { fotoKey: true, fotoThumbKey: true },
    });
    if (!atual) throw new NotFoundException('Colaborador não encontrado.');
    // Miniatura junto: é ela que a portaria vê ao ler o QR, para conferir a
    // pessoa antes de liberar. Sem thumb, o check-in mostraria só o nome.
    const { fotoKey, fotoThumbKey } = await this.image.processarFoto(arquivo, `colaboradores/${id}`);
    if (atual.fotoKey) void this.storage.delete(atual.fotoKey).catch(() => undefined);
    if (atual.fotoThumbKey) void this.storage.delete(atual.fotoThumbKey).catch(() => undefined);
    const c = await this.prisma.colaborador.update({
      where: { id },
      data: { fotoKey, fotoThumbKey, fotoUrl: null },
      include: INCLUDE,
    });
    await this.registrarHistorico(id, TipoHistoricoColaborador.UPLOAD_FOTO, 'Foto do colaborador atualizada.', autor);
    return this.resolverFoto(c);
  }

  // ---- Status dinâmico ----
  async alterarStatus(id: string, dto: AlterarStatusColaboradorDto, autor?: string) {
    const atual = await this.prisma.colaborador.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Colaborador não encontrado.');

    const data: Prisma.ColaboradorUpdateInput = {
      status: dto.status,
      statusMotivo: null,
      dataDesligamento: null,
      feriasInicio: null,
      feriasRetornoEm: null,
    };
    let detalhe = '';

    switch (dto.status) {
      case StatusColaborador.INATIVO:
      case StatusColaborador.AFASTADO: {
        if (!dto.motivo?.trim()) throw new BadRequestException('Informe o motivo.');
        data.statusMotivo = dto.motivo.trim();
        detalhe = ` Motivo: ${dto.motivo.trim()}`;
        break;
      }
      case StatusColaborador.DESLIGADO: {
        if (!dto.dataDesligamento) throw new BadRequestException('Informe a data do desligamento.');
        data.dataDesligamento = dataCalendario(dto.dataDesligamento);
        if (dto.motivo?.trim()) data.statusMotivo = dto.motivo.trim();
        detalhe = ` Desligado em ${new Date(dto.dataDesligamento).toLocaleDateString('pt-BR')}.`;
        break;
      }
      case StatusColaborador.FERIAS: {
        if (!dto.feriasInicio || !dto.feriasFim)
          throw new BadRequestException('Informe as datas de início e fim das férias.');
        const inicio = new Date(dto.feriasInicio);
        const fim = new Date(dto.feriasFim);
        if (fim <= inicio) throw new BadRequestException('A data de fim deve ser posterior à de início.');
        data.feriasInicio = inicio;
        data.feriasRetornoEm = fim;
        detalhe = ` De ${inicio.toLocaleDateString('pt-BR')} a ${fim.toLocaleDateString('pt-BR')} — retorno automático a ATIVO.`;
        break;
      }
      default:
        break; // ATIVO — limpa tudo
    }

    const c = await this.prisma.colaborador.update({ where: { id }, data, include: INCLUDE });
    await this.registrarHistorico(
      id,
      TipoHistoricoColaborador.MUDANCA_STATUS,
      `Status alterado de ${STATUS_LABEL[atual.status]} para ${STATUS_LABEL[dto.status]}.${detalhe}`,
      autor,
      { de: atual.status, para: dto.status },
    );
    return this.resolverFoto(c);
  }

  async historico(id: string) {
    await this.prisma.colaborador.findUnique({ where: { id }, select: { id: true } }).then((c) => {
      if (!c) throw new NotFoundException('Colaborador não encontrado.');
    });
    return this.prisma.colaboradorHistorico.findMany({
      where: { colaboradorId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- Documentos ----
  async addDocumento(id: string, arquivo: Express.Multer.File, titulo: string, autor?: string) {
    const c = await this.prisma.colaborador.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFoundException('Colaborador não encontrado.');

    const ext = arquivo.originalname.split('.').pop() ?? 'bin';
    const storageKey = `colaboradores/${id}/documentos/${Date.now()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);

    const documento = await this.prisma.documento.create({
      data: {
        tipo: TipoDocumento.DOCUMENTO_PESSOAL,
        titulo: titulo?.trim() || arquivo.originalname,
        storageKey,
        mimeType: arquivo.mimetype,
        tamanhoBytes: arquivo.size,
        colaboradorId: id,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoColaborador.ALTERACAO,
      `Documento anexado: ${documento.titulo}.`,
      autor,
    );
    return { ...documento, url: await this.storage.getSignedUrl(storageKey).catch(() => null) };
  }

  async removeDocumento(id: string, documentoId: string) {
    const doc = await this.prisma.documento.findFirst({ where: { id: documentoId, colaboradorId: id } });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    void this.storage.delete(doc.storageKey).catch(() => undefined);
    await this.prisma.documento.delete({ where: { id: documentoId } });
    return { ok: true };
  }

  // =========================================================================
  // Identificação física — QR de entrada e crachá
  //
  // Vieram do módulo de Funcionários, que era o único lugar onde existiam. Como
  // aquele cadastro saiu do menu na unificação, na prática só se conseguia
  // emitir crachá pela URL escondida — e o QR apontava para um registro que
  // divergia do colaborador.
  // =========================================================================

  /** Payload assinado + imagem do QR de entrada em eventos. */
  async qrCode(id: string) {
    const c = await this.prisma.colaborador.findUnique({
      where: { id },
      select: { id: true, qrToken: true },
    });
    if (!c) throw new NotFoundException('Colaborador não encontrado.');
    const payload = this.qr.montarPayload(c.id, TipoPessoa.COLABORADOR, c.qrToken);
    return { payload, imagem: await this.qr.gerarImagemDataUrl(payload) };
  }

  /** Crachá em PDF (85×54mm), com foto, dados do vínculo e o QR de entrada. */
  async gerarCrachaPdf(id: string, autor?: string): Promise<Buffer> {
    const c = await this.prisma.colaborador.findUnique({ where: { id }, include: INCLUDE });
    if (!c) throw new NotFoundException('Colaborador não encontrado.');

    const payload = this.qr.montarPayload(c.id, TipoPessoa.COLABORADOR, c.qrToken);
    const qrImagem = await this.qr.gerarImagemDataUrl(payload);
    const fotoBuffer = c.fotoKey ? await this.baixarFoto(c.fotoKey) : null;

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: [340, 215], margin: 0 });
      const chunks: Buffer[] = [];
      doc.on('data', (p) => chunks.push(p));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.rect(0, 0, 340, 50).fill(VERDE_ESCURO);
      const logo = lerAsset('senatepi-horizontal-branco.png');
      if (logo) {
        try {
          doc.image(logo, 16, 9, { fit: [130, 24] });
        } catch {
          doc.fillColor('#FFFFFF').fontSize(14).text(tenant.sigla, 16, 12);
        }
      } else {
        doc.fillColor('#FFFFFF').fontSize(14).text(tenant.sigla, 16, 12);
      }
      doc.fillColor('#FFFFFF').fontSize(7).text('Crachá de Identificação Interna', 16, 36);

      if (fotoBuffer) {
        try {
          doc.image(fotoBuffer, 16, 62, { width: 70, height: 70 });
        } catch {
          /* foto inválida não pode impedir a emissão do crachá */
        }
      }

      const x = fotoBuffer ? 98 : 16;
      doc.fillColor('#1f2937').fontSize(11).text(c.nome, x, 64, { width: 150 });
      doc.fontSize(8).fillColor('#4b5563');
      doc.text(`Cargo: ${c.cargo?.nome ?? '-'}`, x, 88);
      doc.text(`Depto: ${c.departamento?.nome ?? '-'}`, x, 102);
      doc.text(`Matrícula: ${c.matricula ?? '-'}`, x, 116);
      doc.text(`Vínculo: ${c.tipoVinculo}`, x, 130);
      doc.text(`Status: ${STATUS_LABEL[c.status]}`, x, 144);

      doc.image(Buffer.from(qrImagem.split(',')[1], 'base64'), 254, 70, { width: 70, height: 70 });

      doc.rect(0, 200, 340, 15).fill(VERDE_MEDIO);
      doc.fillColor('#FFFFFF').fontSize(6).text(`${tenant.sigla} — Uso interno`, 16, 204);
      doc.end();
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoColaborador.ALTERACAO,
      'Crachá digital gerado.',
      autor,
    );
    return pdf;
  }

  /**
   * Próxima matrícula (FUNC-000001…).
   *
   * Conta os registros existentes, como o cadastro antigo fazia. É sequencial e
   * não à prova de corrida — dois cadastros simultâneos podem disputar o mesmo
   * número. O índice único recusa o segundo, então o pior caso é um erro visível
   * na tela, e não uma matrícula repetida circulando em dois crachás.
   */
  private async proximaMatricula(): Promise<string> {
    const total = await this.prisma.colaborador.count();
    return gerarMatricula('FUNC', total + 1);
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
