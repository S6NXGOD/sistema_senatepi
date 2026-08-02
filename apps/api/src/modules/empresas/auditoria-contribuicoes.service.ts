import {
  BadRequestException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria, Prisma, StatusContribuicaoPatronal, TipoMovimentacao,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { apenasDigitosCnpj, formatarCnpj } from '../../common/utils/cnpj.util';
import {
  HomologarContribuicaoDto, ListarContribuicoesAdminQueryDto, RejeitarContribuicaoDto,
} from './dto/auditoria-contribuicao.dto';

interface Ctx {
  userId?: string;
  nome?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Conferência das contribuições patronais — lado do SINDICATO.
 *
 * O portal da empresa só leva a guia até EM_ANALISE. A decisão (homologar ou
 * rejeitar) mora aqui, junto com o lançamento no fluxo de caixa.
 */
@Injectable()
export class AuditoriaContribuicoesService {
  private readonly logger = new Logger(AuditoriaContribuicoesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // =========================================================================
  // Listagem
  // =========================================================================

  async listar(query: ListarContribuicoesAdminQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20;

    const termo = query.busca?.trim();
    const digitos = apenasDigitosCnpj(termo);
    const where: Prisma.ContribuicaoPatronalWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.mesReferencia ? { mesReferencia: query.mesReferencia } : {}),
      ...(termo
        ? {
            empresa: {
              OR: [
                { razaoSocial: { contains: termo, mode: 'insensitive' } },
                { nomeFantasia: { contains: termo, mode: 'insensitive' } },
                ...(digitos ? [{ cnpj: { contains: digitos } }] : []),
              ],
            },
          }
        : {}),
    };

    const porStatus = (s: StatusContribuicaoPatronal) =>
      this.prisma.contribuicaoPatronal.count({ where: { status: s } });

    const [linhas, total, aguardando, emAnalise, homologadas, rejeitadas, somaHomologada] =
      await this.prisma.$transaction([
      this.prisma.contribuicaoPatronal.findMany({
        where,
        include: {
          empresa: { select: { id: true, cnpj: true, razaoSocial: true, nomeFantasia: true } },
          analista: { select: { nome: true, nomeExibicao: true } },
        },
        // Quem está esperando conferência vem primeiro.
        orderBy: [{ enviadoEm: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contribuicaoPatronal.count({ where }),
      // Os contadores dos cartões ignoram os filtros de propósito: mostram a
      // situação do módulo inteiro, não a da busca em tela.
      porStatus(StatusContribuicaoPatronal.AGUARDANDO),
      porStatus(StatusContribuicaoPatronal.EM_ANALISE),
      porStatus(StatusContribuicaoPatronal.HOMOLOGADA),
      porStatus(StatusContribuicaoPatronal.REJEITADA),
      this.prisma.contribuicaoPatronal.aggregate({
        where: { status: StatusContribuicaoPatronal.HOMOLOGADA },
        _sum: { valorDeclarado: true },
      }),
    ]);

    return {
      data: linhas.map((c) => this.apresentar(c)),
      total,
      page,
      pageSize,
      totalPaginas: Math.ceil(total / pageSize) || 1,
      resumo: {
        aguardando,
        emAnalise,
        homologadas,
        rejeitadas,
        totalHomologado: Number(somaHomologada._sum.valorDeclarado ?? 0),
      },
    };
  }

  /**
   * Serve o PDF/imagem para a tela de auditoria.
   *
   * Igual ao portal: o arquivo passa por rota autenticada, e não pelo
   * `/uploads` estático — a relação de trabalhadores carrega dados pessoais
   * de terceiros (LGPD, Lei nº 13.709/2018).
   */
  async documento(id: string, tipo: 'comprovante' | 'relacao') {
    const c = await this.prisma.contribuicaoPatronal.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contribuição não encontrada.');

    const chave = tipo === 'comprovante' ? c.urlComprovantePix : c.urlRelacaoTrabalhadores;
    if (!chave) throw new NotFoundException('Documento não enviado.');

    const buffer = await this.storage.getBuffer(chave);
    if (!buffer) throw new NotFoundException('Documento indisponível.');

    const ext = chave.slice(chave.lastIndexOf('.')).toLowerCase();
    const contentType =
      ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';
    return { buffer, contentType, nome: `${tipo}-${c.mesReferencia}${ext}` };
  }

  // =========================================================================
  // Homologação
  // =========================================================================

  async homologar(id: string, dto: HomologarContribuicaoDto, ctx: Ctx) {
    const c = await this.carregarParaAnalise(id);

    // Fluxo de caixa é OPCIONAL: só lança se houver conta indicada ou uma
    // única conta ativa cadastrada. Sem isso, homologa mesmo assim e avisa.
    const conta = await this.resolverConta(dto.contaBancariaId);

    const descricao =
      `Contribuição patronal ${this.competencia(c.mesReferencia)} — ` +
      `${c.empresa.razaoSocial} (${formatarCnpj(c.empresa.cnpj)})`;

    const atualizada = await this.prisma.$transaction(async (tx) => {
      let movimentacaoId: string | null = null;

      if (conta) {
        const mov = await tx.movimentacao.create({
          data: {
            contaBancariaId: conta.id,
            tipo: TipoMovimentacao.ENTRADA,
            valor: c.valorDeclarado,
            descricao,
            origem: 'CONTRIBUICAO_PATRONAL',
            criadaPor: ctx.userId ?? null,
          },
          select: { id: true },
        });
        movimentacaoId = mov.id;
      }

      return tx.contribuicaoPatronal.update({
        where: { id: c.id },
        data: {
          status: StatusContribuicaoPatronal.HOMOLOGADA,
          motivoRejeicao: null, // limpa a recusa anterior, se houve
          analisadoEm: new Date(),
          analisadoPor: ctx.userId ?? null,
          movimentacaoId,
        },
        include: {
          empresa: { select: { id: true, cnpj: true, razaoSocial: true, nomeFantasia: true } },
          analista: { select: { nome: true, nomeExibicao: true } },
        },
      });
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ContribuicaoPatronal',
      entidadeId: c.id,
      descricao: `Contribuição patronal HOMOLOGADA — ${descricao}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        valor: Number(c.valorDeclarado),
        contaBancariaId: conta?.id ?? null,
        movimentacaoId: atualizada.movimentacaoId,
        observacao: dto.observacao ?? null,
      },
    });

    this.logger.log(
      `[PATRONAL] ${c.id} homologada` +
        (atualizada.movimentacaoId ? ` com entrada ${atualizada.movimentacaoId}` : ' sem lançamento'),
    );

    return {
      ...this.apresentar(atualizada),
      lancamento: conta
        ? { contaBancariaId: conta.id, conta: conta.nome, movimentacaoId: atualizada.movimentacaoId }
        : null,
      avisoFinanceiro: conta
        ? null
        : 'Homologada, mas sem lançamento no caixa: nenhuma conta bancária ativa foi informada.',
    };
  }

  // =========================================================================
  // Rejeição
  // =========================================================================

  async rejeitar(id: string, dto: RejeitarContribuicaoDto, ctx: Ctx) {
    const c = await this.carregarParaAnalise(id);

    const atualizada = await this.prisma.contribuicaoPatronal.update({
      where: { id: c.id },
      data: {
        status: StatusContribuicaoPatronal.REJEITADA,
        motivoRejeicao: dto.motivo,
        analisadoEm: new Date(),
        analisadoPor: ctx.userId ?? null,
      },
      include: {
        empresa: { select: { id: true, cnpj: true, razaoSocial: true, nomeFantasia: true } },
        analista: { select: { nome: true, nomeExibicao: true } },
      },
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ContribuicaoPatronal',
      entidadeId: c.id,
      descricao:
        `Contribuição patronal REJEITADA — ${c.empresa.razaoSocial}, ` +
        `${this.competencia(c.mesReferencia)}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { motivo: dto.motivo },
    });

    return this.apresentar(atualizada);
  }

  // =========================================================================
  // Exclusões (só Administrador — regra global do PermissionsGuard)
  // =========================================================================

  /**
   * Apaga a contribuição e os documentos dela.
   *
   * O lançamento no caixa NÃO é apagado junto: dinheiro que entrou é fato
   * financeiro, e removê-lo em silêncio estouraria a conciliação. Se a intenção
   * for desfazer também o valor, existe `removerLancamento`.
   */
  async remover(id: string, ctx: Ctx) {
    const c = await this.prisma.contribuicaoPatronal.findUnique({
      where: { id },
      include: { empresa: { select: { razaoSocial: true, cnpj: true } } },
    });
    if (!c) throw new NotFoundException('Contribuição não encontrada.');

    for (const chave of [c.urlComprovantePix, c.urlRelacaoTrabalhadores]) {
      if (chave) await this.storage.delete(chave).catch(() => undefined);
    }
    await this.prisma.contribuicaoPatronal.delete({ where: { id } });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'ContribuicaoPatronal',
      entidadeId: id,
      descricao:
        `Contribuição patronal excluída: ${c.empresa.razaoSocial} — ` +
        `${this.competencia(c.mesReferencia)} (${c.status})`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        cnpj: c.empresa.cnpj,
        valor: Number(c.valorDeclarado),
        statusNoMomento: c.status,
        // Fica registrado que o lançamento continuou de pé.
        movimentacaoPreservada: c.movimentacaoId,
      },
    });

    return {
      ok: true,
      lancamentoPreservado: c.movimentacaoId,
      aviso: c.movimentacaoId
        ? 'A entrada no caixa foi mantida. Exclua o lançamento se quiser desfazer o valor.'
        : null,
    };
  }

  /**
   * Apaga um lançamento do fluxo de caixa gerado por uma homologação.
   *
   * A contribuição continua HOMOLOGADA, apenas sem valor lançado — o vínculo
   * cai por SetNull e a tela passa a mostrar "sem lançamento".
   */
  async removerLancamento(movimentacaoId: string, ctx: Ctx) {
    const mov = await this.prisma.movimentacao.findUnique({
      where: { id: movimentacaoId },
      include: { conta: { select: { nome: true } } },
    });
    if (!mov) throw new NotFoundException('Lançamento não encontrado.');

    await this.prisma.movimentacao.delete({ where: { id: movimentacaoId } });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'Movimentacao',
      entidadeId: movimentacaoId,
      descricao:
        `Lançamento excluído do caixa: ${mov.tipo} de R$ ${mov.valor} em ` +
        `${mov.conta.nome} — "${mov.descricao}"`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        valor: Number(mov.valor),
        tipo: mov.tipo,
        origem: mov.origem,
        conta: mov.conta.nome,
      },
    });

    return { ok: true };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Só decide sobre o que está EM_ANALISE — o resto não tem o que conferir. */
  private async carregarParaAnalise(id: string) {
    const c = await this.prisma.contribuicaoPatronal.findUnique({
      where: { id },
      include: { empresa: { select: { id: true, cnpj: true, razaoSocial: true } } },
    });
    if (!c) throw new NotFoundException('Contribuição não encontrada.');

    if (c.status !== StatusContribuicaoPatronal.EM_ANALISE) {
      throw new BadRequestException(
        c.status === StatusContribuicaoPatronal.AGUARDANDO
          ? 'A empresa ainda não enviou os documentos desta contribuição.'
          : `Esta contribuição já foi ${c.status === 'HOMOLOGADA' ? 'homologada' : 'rejeitada'}.`,
      );
    }
    return c;
  }

  /**
   * Descobre em qual conta lançar.
   * Se o operador não escolheu e existe exatamente UMA conta ativa, usa ela —
   * é o caso da maioria dos sindicatos. Com várias, exige a escolha.
   */
  private async resolverConta(contaBancariaId?: string) {
    if (contaBancariaId) {
      const conta = await this.prisma.contaBancaria.findUnique({
        where: { id: contaBancariaId },
        select: { id: true, nome: true, ativo: true },
      });
      if (!conta) throw new BadRequestException('Conta bancária não encontrada.');
      if (!conta.ativo) throw new BadRequestException('Esta conta bancária está inativa.');
      return conta;
    }

    const ativas = await this.prisma.contaBancaria.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      take: 2,
    });
    return ativas.length === 1 ? ativas[0] : null;
  }

  private apresentar(c: {
    id: string; mesReferencia: string; valorDeclarado: Prisma.Decimal;
    status: StatusContribuicaoPatronal; urlComprovantePix: string | null;
    urlRelacaoTrabalhadores: string | null; motivoRejeicao: string | null;
    enviadoEm: Date | null; analisadoEm: Date | null; movimentacaoId: string | null;
    createdAt: Date;
    empresa: { id: string; cnpj: string; razaoSocial: string; nomeFantasia?: string | null };
    analista?: { nome: string; nomeExibicao: string | null } | null;
  }) {
    return {
      id: c.id,
      mesReferencia: c.mesReferencia,
      competencia: this.competencia(c.mesReferencia),
      valorDeclarado: Number(c.valorDeclarado),
      status: c.status,
      // Chaves do storage NÃO saem daqui — os arquivos vêm pela rota autenticada.
      temComprovante: !!c.urlComprovantePix,
      temRelacao: !!c.urlRelacaoTrabalhadores,
      motivoRejeicao: c.motivoRejeicao,
      enviadoEm: c.enviadoEm,
      analisadoEm: c.analisadoEm,
      analista: c.analista?.nomeExibicao || c.analista?.nome || null,
      movimentacaoId: c.movimentacaoId,
      createdAt: c.createdAt,
      empresa: {
        id: c.empresa.id,
        cnpj: c.empresa.cnpj,
        razaoSocial: c.empresa.razaoSocial,
        nomeFantasia: c.empresa.nomeFantasia ?? null,
      },
    };
  }

  private competencia(mesReferencia: string): string {
    const [ano, mes] = mesReferencia.split('-');
    const nomes = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ];
    return `${nomes[Number(mes) - 1] ?? mes}/${ano}`;
  }
}
