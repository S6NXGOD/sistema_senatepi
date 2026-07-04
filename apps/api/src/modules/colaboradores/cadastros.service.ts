import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CargoDto, DepartamentoDto, EmpresaDto } from './dto/cadastros.dto';

/**
 * CRUD dos "Cadastros Base" (parâmetros): Departamentos, Cargos e Empresas.
 * Tabelas de domínio específicas — integridade referencial via FKs (sem tabela
 * genérica). Exclusão bloqueada (409) quando o registro está em uso.
 */
@Injectable()
export class CadastrosService {
  constructor(private readonly prisma: PrismaService) {}

  private conflito(e: unknown, msgUnico: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') throw new ConflictException(msgUnico);
      if (e.code === 'P2025') throw new NotFoundException('Registro não encontrado.');
    }
    throw e as Error;
  }

  private aoRemover(e: unknown, label: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2003')
        throw new ConflictException(`${label} está em uso por colaboradores e não pode ser excluído.`);
      if (e.code === 'P2025') throw new NotFoundException(`${label} não encontrado.`);
    }
    throw e as Error;
  }

  // ---- Departamentos ----
  listarDepartamentos() {
    return this.prisma.departamento.findMany({ orderBy: { nome: 'asc' } });
  }
  async criarDepartamento(dto: DepartamentoDto) {
    try {
      return await this.prisma.departamento.create({ data: { nome: dto.nome.trim() } });
    } catch (e) {
      this.conflito(e, 'Já existe um departamento com este nome.');
    }
  }
  async atualizarDepartamento(id: string, dto: DepartamentoDto) {
    try {
      return await this.prisma.departamento.update({ where: { id }, data: { nome: dto.nome.trim() } });
    } catch (e) {
      this.conflito(e, 'Já existe um departamento com este nome.');
    }
  }
  async removerDepartamento(id: string) {
    try {
      await this.prisma.departamento.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      this.aoRemover(e, 'Departamento');
    }
  }

  // ---- Cargos ----
  listarCargos() {
    return this.prisma.cargo.findMany({ orderBy: { nome: 'asc' } });
  }
  async criarCargo(dto: CargoDto) {
    try {
      return await this.prisma.cargo.create({ data: { nome: dto.nome.trim() } });
    } catch (e) {
      this.conflito(e, 'Já existe um cargo com este nome.');
    }
  }
  async atualizarCargo(id: string, dto: CargoDto) {
    try {
      return await this.prisma.cargo.update({ where: { id }, data: { nome: dto.nome.trim() } });
    } catch (e) {
      this.conflito(e, 'Já existe um cargo com este nome.');
    }
  }
  async removerCargo(id: string) {
    try {
      await this.prisma.cargo.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      this.aoRemover(e, 'Cargo');
    }
  }

  // ---- Empresas ----
  listarEmpresas() {
    return this.prisma.empresa.findMany({ orderBy: { razaoSocial: 'asc' } });
  }
  async criarEmpresa(dto: EmpresaDto) {
    try {
      return await this.prisma.empresa.create({
        data: { razaoSocial: dto.razaoSocial.trim(), cnpj: this.normalizarCnpj(dto.cnpj) },
      });
    } catch (e) {
      this.conflito(e, 'Já existe uma empresa com este CNPJ.');
    }
  }
  async atualizarEmpresa(id: string, dto: EmpresaDto) {
    try {
      return await this.prisma.empresa.update({
        where: { id },
        data: { razaoSocial: dto.razaoSocial.trim(), cnpj: this.normalizarCnpj(dto.cnpj) },
      });
    } catch (e) {
      this.conflito(e, 'Já existe uma empresa com este CNPJ.');
    }
  }
  async removerEmpresa(id: string) {
    try {
      await this.prisma.empresa.delete({ where: { id } });
      return { ok: true };
    } catch (e) {
      this.aoRemover(e, 'Empresa');
    }
  }

  private normalizarCnpj(cnpj: string): string {
    const d = cnpj.replace(/\D/g, '');
    if (d.length !== 14) throw new ConflictException('CNPJ deve ter 14 dígitos.');
    return d;
  }
}
