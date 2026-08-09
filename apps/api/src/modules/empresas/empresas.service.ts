import { StorageService, apenasDigitosCnpj, cnpjValido, formatarCnpj } from '@core/infra';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

import { BrasilApiService } from './brasil-api.service';
import { CreateEmpresaDto, DadosCnpj, ListEmpresasQueryDto } from './dto/empresa.dto';

/** Custo do bcrypt — o mesmo usado nas senhas da equipe (auth.service). */
const BCRYPT_ROUNDS = 12;

/**
 * Campos lidos do banco. `senhaHash` entra aqui só para virar o booleano
 * `temAcessoPortal` em `apresentar()` — nunca sai da API como valor.
 * A seleção é explícita para que um campo sensível novo não vaze por descuido.
 */
const CAMPOS = {
  id: true,
  cnpj: true,
  razaoSocial: true,
  nomeFantasia: true,
  cep: true,
  logradouro: true,
  bairro: true,
  cidade: true,
  uf: true,
  senhaHash: true,
  primeiroAcesso: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EmpresaSelect;

type EmpresaBruta = Prisma.EmpresaGetPayload<{ select: typeof CAMPOS }>;

/**
 * Troca o hash por um indicador de estado.
 *
 * A tabela `empresas` também guarda empregadoras de colaboradores PJ, que
 * existem sem credencial. `temAcessoPortal` distingue as duas situações sem
 * expor nada da senha.
 */
function apresentar({ senhaHash, ...empresa }: EmpresaBruta) {
  return { ...empresa, temAcessoPortal: !!senhaHash };
}

interface Ctx {
  userId?: string;
  nome?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class EmpresasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly brasilApi: BrasilApiService,
    private readonly storage: StorageService,
  ) {}

  // =========================================================================
  // Consulta de CNPJ (auxílio ao preenchimento — não grava nada)
  // =========================================================================

  /**
   * Dados da Receita + aviso se a empresa já está no nosso cadastro.
   *
   * O `jaCadastrada` existe para a tela avisar ANTES de a secretaria preencher
   * o formulário inteiro e levar um 409 no fim.
   */
  async consultarCnpj(cnpjEntrada: string): Promise<DadosCnpj> {
    const dados = await this.brasilApi.consultar(cnpjEntrada);
    const existente = await this.prisma.empresa.findUnique({
      where: { cnpj: dados.cnpj },
      select: { id: true },
    });
    return { ...dados, jaCadastrada: !!existente };
  }

  // =========================================================================
  // CRUD
  // =========================================================================

  async create(dto: CreateEmpresaDto, ctx: Ctx) {
    const cnpj = apenasDigitosCnpj(dto.cnpj);
    if (!cnpjValido(cnpj)) {
      throw new BadRequestException(
        `CNPJ ${formatarCnpj(cnpj) || dto.cnpj} é inválido — confira os números digitados.`,
      );
    }

    const existente = await this.prisma.empresa.findUnique({
      where: { cnpj },
      select: { razaoSocial: true },
    });
    if (existente) {
      throw new ConflictException(
        `O CNPJ ${formatarCnpj(cnpj)} já está cadastrado (${existente.razaoSocial}).`,
      );
    }

    const empresa = await this.prisma.empresa.create({
      data: {
        cnpj,
        razaoSocial: dto.razaoSocial,
        nomeFantasia: dto.nomeFantasia || null,
        cep: dto.cep ? dto.cep.replace(/\D/g, '') || null : null,
        logradouro: dto.logradouro || null,
        bairro: dto.bairro || null,
        cidade: dto.cidade || null,
        uf: dto.uf || null,
        // Sem senha = empresa só de vínculo (empregadora de colaborador PJ):
        // fica cadastrada, sem acesso ao portal.
        senhaHash: dto.senhaProvisoria
          ? await bcrypt.hash(dto.senhaProvisoria, BCRYPT_ROUNDS)
          : null,
        // A empresa ainda vai trocar a senha no primeiro login do portal.
        primeiroAcesso: !!dto.senhaProvisoria,
      },
      select: CAMPOS,
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'Empresa',
      entidadeId: empresa.id,
      descricao:
        `Empresa cadastrada: ${empresa.razaoSocial} (${formatarCnpj(cnpj)})` +
        (dto.senhaProvisoria ? '' : ' — sem acesso ao portal (vínculo de colaborador)'),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      // A senha provisória NÃO entra no log — nem em claro, nem em hash.
      metadata: { cnpj, razaoSocial: empresa.razaoSocial, comPortal: !!dto.senhaProvisoria },
    });

    return apresentar(empresa);
  }

  async findAll(query: ListEmpresasQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 10;

    const termo = query.busca?.trim();
    const digitos = apenasDigitosCnpj(termo);
    const where: Prisma.EmpresaWhereInput = termo
      ? {
          OR: [
            { razaoSocial: { contains: termo, mode: 'insensitive' } },
            { nomeFantasia: { contains: termo, mode: 'insensitive' } },
            // Só busca por CNPJ quando o termo tem dígitos, senão `contains: ''`
            // casaria com todas as linhas.
            ...(digitos ? [{ cnpj: { contains: digitos } }] : []),
          ],
        }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.empresa.findMany({
        where,
        select: CAMPOS,
        orderBy: { razaoSocial: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.empresa.count({ where }),
    ]);

    return {
      data: data.map(apresentar),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  async findOne(id: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      select: CAMPOS,
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    return apresentar(empresa);
  }

  /**
   * Exclusão PERMANENTE da empresa (só Administrador — regra global do
   * PermissionsGuard).
   *
   * O que vai junto:
   *  • as contribuições patronais (FK em cascata) e os arquivos delas no
   *    storage — comprovantes e relações de trabalhadores, que contêm dado
   *    pessoal de terceiros e não podem ficar órfãos (LGPD);
   *  • o vínculo com colaboradores PJ é apenas DESFEITO (SetNull): a pessoa
   *    continua cadastrada, sem empregadora.
   *
   * Os lançamentos já feitos no caixa NÃO são apagados: são fato financeiro
   * consumado. Para desfazer um deles existe a exclusão do lançamento.
   */
  async remove(id: string, ctx: Ctx) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id },
      select: {
        id: true, cnpj: true, razaoSocial: true,
        _count: { select: { contribuicoes: true, colaboradores: true } },
      },
    });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');

    // Apaga os arquivos ANTES do registro: sem a linha no banco não haveria
    // como descobrir as chaves e eles ficariam para sempre no storage.
    const contribuicoes = await this.prisma.contribuicaoPatronal.findMany({
      where: { empresaId: id },
      select: { urlComprovantePix: true, urlRelacaoTrabalhadores: true },
    });
    for (const c of contribuicoes) {
      for (const chave of [c.urlComprovantePix, c.urlRelacaoTrabalhadores]) {
        if (chave) await this.storage.delete(chave).catch(() => undefined);
      }
    }
    // No driver local sobra a árvore de pastas vazias; no S3 não existe pasta,
    // então isto é um acabamento só do modo local.
    if (this.storage.isLocal) {
      await rm(join(this.storage.diretorioLocal, 'contribuicoes', id), {
        recursive: true, force: true,
      }).catch(() => undefined);
    }

    await this.prisma.empresa.delete({ where: { id } });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'Empresa',
      entidadeId: id,
      descricao:
        `Empresa excluída permanentemente: ${empresa.razaoSocial} ` +
        `(${formatarCnpj(empresa.cnpj)}) — ${empresa._count.contribuicoes} contribuição(ões) removida(s)`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        contribuicoesRemovidas: empresa._count.contribuicoes,
        colaboradoresDesvinculados: empresa._count.colaboradores,
      },
    });

    return {
      ok: true,
      contribuicoesRemovidas: empresa._count.contribuicoes,
      colaboradoresDesvinculados: empresa._count.colaboradores,
    };
  }
}
