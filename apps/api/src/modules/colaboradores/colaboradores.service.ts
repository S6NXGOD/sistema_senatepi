import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TipoVinculo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateColaboradorDto,
  ListColaboradoresQueryDto,
  UpdateColaboradorDto,
} from './dto/colaborador.dto';

const INCLUDE = {
  cargo: { select: { id: true, nome: true } },
  departamento: { select: { id: true, nome: true } },
  empresa: { select: { id: true, razaoSocial: true, cnpj: true } },
} satisfies Prisma.ColaboradorInclude;

@Injectable()
export class ColaboradoresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Regras condicionais do vínculo. Normaliza os campos dinâmicos para manter os
   * dados coerentes (minimização — LGPD Lei 13.709/2018): guarda só o que o
   * vínculo exige.
   */
  private aplicarRegrasVinculo(
    tipo: TipoVinculo,
    dados: { empresaId?: string | null; vencimentoContrato?: Date | null; instituicaoEnsino?: string | null },
  ) {
    if (tipo === TipoVinculo.PJ || tipo === TipoVinculo.TERCEIRIZADO) {
      if (!dados.empresaId)
        throw new BadRequestException('Para vínculo PJ/Terceirizado, informe a Empresa.');
      dados.instituicaoEnsino = null; // não se aplica
    } else if (tipo === TipoVinculo.ESTAGIO) {
      if (!dados.instituicaoEnsino)
        throw new BadRequestException('Para Estágio, informe a Instituição de Ensino.');
      dados.empresaId = null;
    } else {
      // CLT: sem campos extras
      dados.empresaId = null;
      dados.vencimentoContrato = null;
      dados.instituicaoEnsino = null;
    }
    return dados;
  }

  private montarData(dto: CreateColaboradorDto, cpf: string) {
    const cond = this.aplicarRegrasVinculo(dto.tipoVinculo, {
      empresaId: dto.empresaId || null,
      vencimentoContrato: dto.vencimentoContrato ? new Date(dto.vencimentoContrato) : null,
      instituicaoEnsino: dto.instituicaoEnsino?.trim() || null,
    });
    return {
      nome: dto.nome.trim(),
      cpf,
      tipoVinculo: dto.tipoVinculo,
      status: dto.status,
      fotoUrl: dto.fotoUrl || null,
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
    };
  }

  private traduzir(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') throw new ConflictException('Já existe um colaborador com este CPF.');
      if (e.code === 'P2003')
        throw new BadRequestException('Cargo, departamento ou empresa informado não existe.');
      if (e.code === 'P2025') throw new NotFoundException('Colaborador não encontrado.');
    }
    throw e as Error;
  }

  async create(dto: CreateColaboradorDto) {
    const cpf = dto.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) throw new BadRequestException('CPF inválido.');
    try {
      return await this.prisma.colaborador.create({ data: this.montarData(dto, cpf), include: INCLUDE });
    } catch (e) {
      this.traduzir(e);
    }
  }

  async findAll(query: ListColaboradoresQueryDto) {
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

    const [data, total] = await this.prisma.$transaction([
      this.prisma.colaborador.findMany({
        where,
        include: INCLUDE,
        orderBy: { nome: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.colaborador.count({ where }),
    ]);
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findOne(id: string) {
    const c = await this.prisma.colaborador.findUnique({ where: { id }, include: INCLUDE });
    if (!c) throw new NotFoundException('Colaborador não encontrado.');
    return c;
  }

  async update(id: string, dto: UpdateColaboradorDto) {
    const atual = await this.findOne(id);
    // Mescla com o registro atual para reavaliar as regras do vínculo.
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
      return await this.prisma.colaborador.update({
        where: { id },
        data: {
          nome: dto.nome?.trim(),
          cpf,
          tipoVinculo,
          status: dto.status,
          fotoUrl: dto.fotoUrl !== undefined ? dto.fotoUrl || null : undefined,
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
    } catch (e) {
      this.traduzir(e);
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.colaborador.delete({ where: { id } });
    return { ok: true };
  }
}
