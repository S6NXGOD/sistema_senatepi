import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StatusColaborador,
  TipoHistoricoColaborador,
  TipoVinculo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { ImageService } from '../../common/storage/image.service';
import {
  AlterarStatusColaboradorDto,
  CreateColaboradorDto,
  ListColaboradoresQueryDto,
  UpdateColaboradorDto,
} from './dto/colaborador.dto';

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

@Injectable()
export class ColaboradoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly image: ImageService,
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
        data: { status: StatusColaborador.ATIVO, feriasRetornoEm: null },
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
          dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : null,
          telefone: dto.telefone || null,
          email: dto.email || null,
          dataAdmissao: dto.dataAdmissao ? new Date(dto.dataAdmissao) : null,
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
      include: { ...INCLUDE, historico: { orderBy: { createdAt: 'desc' } } },
    });
    if (!c) throw new NotFoundException('Colaborador não encontrado.');
    return this.resolverFoto(c);
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
          dataNascimento: dto.dataNascimento !== undefined ? (dto.dataNascimento ? new Date(dto.dataNascimento) : null) : undefined,
          telefone: dto.telefone !== undefined ? dto.telefone || null : undefined,
          email: dto.email !== undefined ? dto.email || null : undefined,
          dataAdmissao: dto.dataAdmissao !== undefined ? (dto.dataAdmissao ? new Date(dto.dataAdmissao) : null) : undefined,
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
    const atual = await this.prisma.colaborador.findUnique({ where: { id }, select: { fotoKey: true } });
    if (!atual) throw new NotFoundException('Colaborador não encontrado.');
    const fotoKey = await this.image.processarAvatar(arquivo, `colaboradores/${id}`);
    if (atual.fotoKey) void this.storage.delete(atual.fotoKey).catch(() => undefined);
    const c = await this.prisma.colaborador.update({
      where: { id },
      data: { fotoKey, fotoUrl: null },
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
        data.dataDesligamento = new Date(dto.dataDesligamento);
        if (dto.motivo?.trim()) data.statusMotivo = dto.motivo.trim();
        detalhe = ` Desligado em ${new Date(dto.dataDesligamento).toLocaleDateString('pt-BR')}.`;
        break;
      }
      case StatusColaborador.FERIAS: {
        const dias = Number(dto.diasFerias);
        if (!dias || dias < 1) throw new BadRequestException('Informe a quantidade de dias de férias.');
        const retorno = new Date();
        retorno.setDate(retorno.getDate() + dias);
        data.feriasRetornoEm = retorno;
        detalhe = ` ${dias} dia(s) — retorno automático em ${retorno.toLocaleDateString('pt-BR')}.`;
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
}
