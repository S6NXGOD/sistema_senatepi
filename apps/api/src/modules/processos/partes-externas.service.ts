import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, TipoParteExterna, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { partesParecidas } from './utils/similaridade.util';
import {
  AtualizarParteExternaDto, CriarParteExternaDto, ListParteExternaQueryDto,
} from './dto/partes.dto';

interface Ctx {
  userId?: string;
  role?: UserRole;
  ip?: string;
  userAgent?: string;
}

const SELECT = {
  id: true, tipo: true, nome: true, nomeFantasia: true, documento: true,
  email: true, telefone: true, cidade: true, uf: true, observacoes: true,
  ativo: true, createdAt: true, updatedAt: true,
} satisfies Prisma.ParteExternaSelect;

/**
 * PartesExternasService — cadastro das partes que não são filiados nem usuários:
 * a empresa ré (PRONTOCARE), o município, uma autarquia, uma pessoa física, e o
 * próprio sindicato quando é ele quem propõe a ação.
 *
 * POR QUE CADASTRO E NÃO TEXTO LIVRE: é o que transforma "temos um processo
 * contra a Prontocare" em "temos 14 processos contra a PRONTOCARE, somando
 * R$ X em valor de causa". Com o nome redigitado a cada processo
 * ("Prontocare", "PRONTO CARE LTDA", "Pronto-Care") nenhuma dessas perguntas
 * tem resposta.
 *
 * MAS O CADASTRO É OPCIONAL: uma parte pode existir só com o nome digitado na
 * própria `ParteProcesso`. Este cadastro é o caminho de quem se repete.
 */
@Injectable()
export class PartesExternasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listar(q: ListParteExternaQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const and: Prisma.ParteExternaWhereInput[] = [];

    if (q.tipo) and.push({ tipo: q.tipo });
    if (q.incluirInativas !== 'true') and.push({ ativo: true });

    const busca = q.busca?.trim();
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      and.push({
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          { nomeFantasia: { contains: busca, mode: 'insensitive' } },
          ...(digitos.length >= 3 ? [{ documento: { contains: digitos } }] : []),
        ],
      });
    }
    const where: Prisma.ParteExternaWhereInput = and.length ? { AND: and } : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.parteExterna.count({ where }),
      this.prisma.parteExterna.findMany({
        where,
        orderBy: { nome: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { ...SELECT, _count: { select: { participacoes: true } } },
      }),
    ]);

    return { items, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /**
   * Cadastros que podem SER a parte que alguém está digitando.
   *
   * Diferente da busca do autocomplete, que usa `contains` e só acha quem digita
   * MENOS do que está gravado: quem digita a razão social inteira não encontra o
   * apelido já cadastrado, e cadastra o segundo. Foi assim que "PRONTOCARE" e
   * "PRONTOCARE CLINICA E ATENDIMENTOS LTDA" passaram a conviver na base — e a
   * conta de "quantos processos contra esta empresa" deixou de valer.
   *
   * Compara PALAVRA a palavra, nos dois sentidos, ignorando forma societária e
   * termos genéricos do ramo (ver `similaridade.util.ts`, com testes).
   *
   * A LISTA INTEIRA vem para a memória de propósito: o cadastro de partes é
   * pequeno (dezenas), a comparação por palavra não é expressável em índice, e
   * um teto explícito é mais honesto que uma consulta que degrada em silêncio.
   * Se um dia passar de mil, o caminho é `pg_trgm` — e aí este comentário vira
   * o aviso de que chegou a hora.
   */
  async parecidas(nome: string, documento?: string) {
    const termo = (nome ?? '').trim();
    if (termo.length < 3) return [];

    const candidatos = await this.prisma.parteExterna.findMany({
      where: { ativo: true },
      select: {
        id: true, nome: true, nomeFantasia: true, documento: true, tipo: true,
        _count: { select: { participacoes: true } },
      },
      orderBy: { nome: 'asc' },
      take: 1000,
    });

    return partesParecidas(termo, documento, candidatos).map((s) => ({
      ...s.parte,
      motivo: s.motivo,
    }));
  }

  /**
   * Dossiê da parte: o cadastro + TODOS os processos em que ela figura.
   * É a tela que responde "o que temos contra a PRONTOCARE?".
   */
  async detalhe(id: string) {
    const parte = await this.prisma.parteExterna.findUnique({ where: { id }, select: SELECT });
    if (!parte) throw new NotFoundException('Parte não encontrada.');

    const participacoes = await this.prisma.parteProcesso.findMany({
      where: { parteExternaId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, polo: true, papel: true,
        processo: {
          select: {
            id: true, numeroCNJ: true, classeProcessual: true, assuntoPrincipal: true,
            tribunal: true, statusInterno: true, valorCausa: true, dataDistribuicao: true,
          },
        },
      },
    });

    // Valor total em causa: a pergunta que justifica existir este cadastro.
    const valorTotal = participacoes.reduce(
      (soma, p) => soma + Number(p.processo.valorCausa ?? 0),
      0,
    );
    const porStatus = participacoes.reduce<Record<string, number>>((acc, p) => {
      acc[p.processo.statusInterno] = (acc[p.processo.statusInterno] ?? 0) + 1;
      return acc;
    }, {});

    return {
      ...parte,
      participacoes,
      resumo: {
        processos: participacoes.length,
        comoReu: participacoes.filter((p) => p.polo === 'PASSIVO').length,
        comoAutor: participacoes.filter((p) => p.polo === 'ATIVO').length,
        valorTotalEmCausa: valorTotal,
        porStatus,
      },
    };
  }

  async criar(dto: CriarParteExternaDto, ctx: Ctx) {
    const documento = this.validarDocumento(dto.documento, dto.tipo);
    if (documento) await this.garantirDocumentoLivre(documento);

    const parte = await this.prisma.parteExterna.create({
      data: {
        tipo: dto.tipo,
        nome: dto.nome.trim(),
        nomeFantasia: dto.nomeFantasia?.trim() || null,
        documento,
        email: dto.email?.trim() || null,
        telefone: dto.telefone?.trim() || null,
        cidade: dto.cidade?.trim() || null,
        uf: dto.uf?.trim().toUpperCase() || null,
        observacoes: dto.observacoes?.trim() || null,
      },
      select: SELECT,
    });

    await this.auditar(AcaoAuditoria.CREATE, parte.id, ctx,
      `Parte "${parte.nome}" cadastrada (${this.rotuloTipo(parte.tipo)})`);
    return parte;
  }

  async atualizar(id: string, dto: AtualizarParteExternaDto, ctx: Ctx) {
    const atual = await this.prisma.parteExterna.findUnique({
      where: { id },
      select: { id: true, nome: true, tipo: true, documento: true },
    });
    if (!atual) throw new NotFoundException('Parte não encontrada.');

    const documento =
      dto.documento === undefined
        ? undefined
        : this.validarDocumento(dto.documento, dto.tipo ?? atual.tipo);
    if (documento && documento !== atual.documento) await this.garantirDocumentoLivre(documento);

    const parte = await this.prisma.parteExterna.update({
      where: { id },
      data: {
        tipo: dto.tipo,
        nome: dto.nome?.trim(),
        nomeFantasia: dto.nomeFantasia === undefined ? undefined : dto.nomeFantasia?.trim() || null,
        documento,
        email: dto.email === undefined ? undefined : dto.email?.trim() || null,
        telefone: dto.telefone === undefined ? undefined : dto.telefone?.trim() || null,
        cidade: dto.cidade === undefined ? undefined : dto.cidade?.trim() || null,
        uf: dto.uf === undefined ? undefined : dto.uf?.trim().toUpperCase() || null,
        observacoes: dto.observacoes === undefined ? undefined : dto.observacoes?.trim() || null,
        ativo: dto.ativo,
      },
      select: SELECT,
    });

    // O nome nos autos de cada processo é um SNAPSHOT e NÃO é reescrito de
    // propósito: se a empresa mudou de razão social, os processos antigos devem
    // continuar mostrando o nome sob o qual foram distribuídos.
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx, `Parte "${parte.nome}" atualizada`);
    return parte;
  }

  /**
   * Exclui o cadastro. Se a parte já figura em algum processo, BLOQUEIA e sugere
   * desativar — apagar viraria "parte não identificada" em processos reais.
   * (A regra global já restringe DELETE ao Administrador.)
   */
  async remover(id: string, ctx: Ctx) {
    const parte = await this.prisma.parteExterna.findUnique({
      where: { id },
      select: { id: true, nome: true, _count: { select: { participacoes: true } } },
    });
    if (!parte) throw new NotFoundException('Parte não encontrada.');

    if (parte._count.participacoes > 0) {
      throw new ConflictException(
        `"${parte.nome}" figura em ${parte._count.participacoes} processo(s). Desative o cadastro em vez de excluir para preservar o histórico.`,
      );
    }

    await this.prisma.parteExterna.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, id, ctx, `Parte "${parte.nome}" excluída do cadastro`);
    return { ok: true };
  }

  // -------------------------------------------------------------------------

  /**
   * CPF (11) para pessoa física, CNPJ (14) para PJ/órgão público. Validamos o
   * TAMANHO, não os dígitos verificadores: parte adversa costuma vir do próprio
   * documento processual e travar por DV impediria o cadastro de um dado
   * legítimo. O documento é opcional — muita parte só se conhece pelo nome.
   */
  private validarDocumento(v: string | undefined, tipo: TipoParteExterna): string | null {
    const d = (v ?? '').replace(/\D/g, '');
    if (!d) return null;
    if (tipo === TipoParteExterna.FISICA && d.length !== 11) {
      throw new BadRequestException('Pessoa física: informe um CPF com 11 dígitos.');
    }
    if (tipo !== TipoParteExterna.FISICA && d.length !== 14) {
      throw new BadRequestException('Pessoa jurídica/órgão público: informe um CNPJ com 14 dígitos.');
    }
    return d;
  }

  private async garantirDocumentoLivre(documento: string) {
    const existe = await this.prisma.parteExterna.findFirst({
      where: { documento },
      select: { id: true, nome: true },
    });
    if (existe) {
      throw new ConflictException(
        `Este CPF/CNPJ já está cadastrado em "${existe.nome}". Use o cadastro existente.`,
      );
    }
  }

  private rotuloTipo(tipo: TipoParteExterna): string {
    return tipo === 'FISICA' ? 'pessoa física'
      : tipo === 'JURIDICA' ? 'pessoa jurídica'
      : 'órgão público';
  }

  private auditar(acao: AcaoAuditoria, entidadeId: string, ctx: Ctx, descricao: string) {
    return this.audit.registrar({
      userId: ctx.userId ?? null, acao, entidade: 'ParteExterna', entidadeId, descricao,
      ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
  }
}
