import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AcaoAuditoria, DesfechoAtendimento, Prisma, StatusAtendimento,
  TipoEncaminhamento,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { montarUrgencia, sincronizarEquipe } from '../agenda/equipe.util';
import {
  CreateAtendimentoDto, ListAtendimentosQueryDto,
  MudarStatusAtendimentoDto, RegistrarDesfechoDto,
} from './dto/atendimentos.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

const filiadoLista = {
  select: { id: true, nomeCompleto: true, matricula: true, telefonePrincipal: true },
} as const;
const processoSel = { select: { id: true, numeroCNJ: true, classeProcessual: true } } as const;

@Injectable()
export class AtendimentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Criação — só filiado + canal + descrição. Nasce PENDENTE, sem desfecho.
  // -------------------------------------------------------------------------

  async criar(dto: CreateAtendimentoDto, ctx: Ctx) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: dto.filiadoId },
      select: { id: true, nomeCompleto: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');

    const urgencia = montarUrgencia(dto.urgente, dto.urgenteMotivo, { userId: ctx.userId });

    const atendimento = await this.prisma.atendimento.create({
      data: {
        filiadoId: filiado.id,
        atendentePorId: ctx.userId!,
        canal: dto.canal,
        assunto: dto.assunto ?? null,
        descricao: dto.descricao.trim(),
        ...urgencia,
      },
      include: { filiado: filiadoLista, atendente: { select: { id: true, nome: true } } },
    });

    await this.auditar(AcaoAuditoria.CREATE, atendimento.id, ctx,
      `Atendimento #${atendimento.numero} (${dto.canal}) registrado para ${filiado.nomeCompleto}`,
      { filiadoId: filiado.id, canal: dto.canal });
    return atendimento;
  }

  // -------------------------------------------------------------------------
  // Registro do DESFECHO (resultado). NÃO conclui — a demanda segue PENDENTE
  // até ser marcada como concluída. Em ENCAMINHADO, cria UMA consulta na agenda
  // com a equipe inteira (era uma cópia por advogado — ver o comentário abaixo).
  // -------------------------------------------------------------------------

  async registrarDesfecho(id: string, dto: RegistrarDesfechoDto, ctx: Ctx) {
    const at = await this.prisma.atendimento.findUnique({
      where: { id },
      select: {
        id: true, numero: true, desfecho: true,
        // A urgência da triagem é herdada pela consulta na agenda.
        urgente: true, urgenteMotivo: true,
        filiado: { select: { id: true, nomeCompleto: true } },
      },
    });
    if (!at) throw new NotFoundException('Atendimento não encontrado.');
    if (at.desfecho) throw new BadRequestException('O desfecho deste atendimento já foi registrado.');

    // --- Resolvido no ato ---
    if (dto.resultado === DesfechoAtendimento.RESOLVIDO_ATO) {
      await this.prisma.atendimento.update({
        where: { id },
        data: {
          desfecho: DesfechoAtendimento.RESOLVIDO_ATO,
          desfechoEm: new Date(),
          desfechoObs: dto.desfechoObs?.trim() || null,
        },
      });
      await this.auditar(AcaoAuditoria.UPDATE, id, ctx, `Atendimento #${at.numero} resolvido no ato`, {});
      return this.detalhe(id);
    }

    // --- Encaminhado para advogado(s) ---
    const advogadoIds = [...new Set(dto.advogadoIds ?? [])];
    if (advogadoIds.length === 0) throw new BadRequestException('Selecione ao menos um advogado.');
    const advogados = await this.prisma.user.findMany({
      where: { id: { in: advogadoIds }, ativo: true },
      select: { id: true, nome: true, nomeExibicao: true },
    });
    if (advogados.length !== advogadoIds.length) throw new BadRequestException('Advogado(s) inválido(s).');

    // NPU é opcional (processo administrativo não tem número único do CNJ).
    let processo: { id: string; numeroCNJ: string | null } | null = null;
    if (dto.tipoEncaminhamento === TipoEncaminhamento.ANDAMENTO_PROCESSO) {
      processo = await this.prisma.processo.findUnique({
        where: { id: dto.processoId },
        select: { id: true, numeroCNJ: true },
      });
      if (!processo) throw new BadRequestException('Processo inválido.');
    }

    // Data da consulta: informada ou amanhã às 09:00.
    const inicio = dto.dataConsulta
      ? new Date(dto.dataConsulta)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          d.setHours(9, 0, 0, 0);
          return d;
        })();
    const fim = new Date(inicio.getTime() + 3600_000);
    const tituloBase =
      dto.tipoEncaminhamento === TipoEncaminhamento.ANDAMENTO_PROCESSO
        ? `Andamento processual — ${at.filiado.nomeCompleto}`
        : `Consulta Jurídica — ${at.filiado.nomeCompleto}`;
    const nomes = advogados.map((a) => a.nomeExibicao || a.nome);

    await this.prisma.$transaction(async (tx) => {
      await tx.atendimento.update({
        where: { id },
        data: {
          desfecho: DesfechoAtendimento.ENCAMINHADO,
          desfechoEm: new Date(),
          desfechoObs: dto.desfechoObs?.trim() || null,
          tipoEncaminhamento: dto.tipoEncaminhamento,
          processoId: processo?.id ?? null,
          setor: 'JURIDICO',
          responsavel: nomes.join(', '),
        },
      });
      /**
       * UMA consulta com a equipe inteira — e não uma cópia por advogado.
       *
       * ERA UM LAÇO CRIANDO N ATIVIDADES IGUAIS, porque a agenda só aceitava um
       * responsável. O efeito colateral era diário: encaminhada a três, a
       * demanda virava três cards idênticos; o primeiro que atendesse concluía o
       * seu, e os outros dois ficavam PENDENTES para sempre — entrando na
       * contagem de atrasadas, no alerta do painel e na cobrança de gente que já
       * tinha resolvido o assunto junto.
       *
       * Agora é uma atividade só: o PRIMEIRO advogado da lista responde por
       * ela, os demais entram como participantes e a veem na própria agenda.
       * Concluir uma vez fecha para todos, porque é uma coisa só — que é o que
       * ela sempre foi.
       */
      const [responsavel, ...participantes] = advogados;
      const consulta = await tx.compromisso.create({
        data: {
          titulo: tituloBase,
          tipo: 'CONSULTA_JURIDICA', // slug do tipo (TipoCompromisso cadastrável)
          inicio,
          fim,
          descricao: dto.desfechoObs?.trim() || null,
          responsavelId: responsavel.id,
          filiadoId: at.filiado.id,
          atendimentoId: id,
          processoId: processo?.id ?? null,
          criadoPor: ctx.userId,
          // A urgência declarada na TRIAGEM viaja para a agenda: quem marcou no
          // balcão não deveria precisar remarcar no card seguinte.
          ...(at.urgente
            ? {
                urgente: true,
                urgenteMotivo: at.urgenteMotivo ?? `Herdado da triagem #${at.numero}.`,
                urgenteEm: new Date(),
                urgentePor: ctx.userId ?? null,
              }
            : {}),
        },
        select: { id: true },
      });
      if (participantes.length) {
        await sincronizarEquipe(tx, consulta.id, {
          principalId: responsavel.id,
          participantesIds: participantes.map((a) => a.id),
        });
      }
    });

    await this.auditar(AcaoAuditoria.UPDATE, id, ctx,
      `Atendimento #${at.numero} encaminhado a ${nomes.join(', ')} (${advogados.length} consulta[s] na agenda)`,
      { advogados: advogadoIds, tipoEncaminhamento: dto.tipoEncaminhamento, processoId: processo?.id ?? null });
    return this.detalhe(id);
  }

  // -------------------------------------------------------------------------
  // Situação da demanda: concluir / cancelar / reabrir
  // -------------------------------------------------------------------------

  async mudarStatus(id: string, dto: MudarStatusAtendimentoDto, ctx: Ctx) {
    const at = await this.prisma.atendimento.findUnique({
      where: { id },
      select: { id: true, numero: true, desfecho: true, status: true },
    });
    if (!at) throw new NotFoundException('Atendimento não encontrado.');

    if (dto.status === StatusAtendimento.CONCLUIDO && !at.desfecho) {
      throw new BadRequestException('Registre o desfecho antes de concluir o atendimento.');
    }

    await this.prisma.atendimento.update({ where: { id }, data: { status: dto.status } });
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx, `Atendimento #${at.numero} → ${dto.status}`, { status: dto.status });
    return this.detalhe(id);
  }

  /**
   * Exclui o atendimento — só Administrador (regra global de exclusão).
   * Cascata: anexos são removidos; as consultas já criadas na Agenda são
   * PRESERVADAS (apenas perdem o vínculo com a triagem de origem).
   */
  async remover(id: string, ctx: Ctx) {
    const at = await this.prisma.atendimento.findUnique({
      where: { id },
      select: {
        id: true, numero: true, filiado: { select: { nomeCompleto: true } },
        _count: { select: { compromissos: true, anexos: true } },
      },
    });
    if (!at) throw new NotFoundException('Atendimento não encontrado.');

    await this.prisma.atendimento.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, id, ctx,
      `Atendimento #${at.numero} (${at.filiado.nomeCompleto}) excluído`,
      { anexos: at._count.anexos, consultasNaAgenda: at._count.compromissos });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Listagem
  // -------------------------------------------------------------------------

  async listar(q: ListAtendimentosQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const busca = q.busca?.trim();

    const and: Prisma.AtendimentoWhereInput[] = [];
    if (q.desfecho) and.push({ desfecho: q.desfecho });
    if (q.status) and.push({ status: q.status });
    if (q.canal) and.push({ canal: q.canal });
    if (q.assunto) and.push({ assunto: q.assunto });
    if (busca) {
      and.push({
        OR: [
          { descricao: { contains: busca, mode: 'insensitive' } },
          {
            filiado: {
              OR: [
                { nomeCompleto: { contains: busca, mode: 'insensitive' } },
                { matricula: { contains: busca, mode: 'insensitive' } },
                { cpf: { contains: busca.replace(/\D/g, '') || busca } },
              ],
            },
          },
        ],
      });
    }
    const range = this.intervaloDatas(q.dataInicio, q.dataFim);
    if (range) and.push({ createdAt: range });
    const where: Prisma.AtendimentoWhereInput = and.length ? { AND: and } : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.atendimento.count({ where }),
      this.prisma.atendimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, numero: true, canal: true, desfecho: true, status: true,
          tipoEncaminhamento: true, descricao: true, responsavel: true, createdAt: true,
          filiado: filiadoLista,
          atendente: { select: { id: true, nome: true } },
        },
      }),
    ]);
    return { items, total, page, pageSize, totalPaginas: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async detalhe(id: string) {
    const atendimento = await this.prisma.atendimento.findUnique({
      where: { id },
      include: {
        atendente: { select: { id: true, nome: true } },
        processo: processoSel,
        compromissos: {
          orderBy: { inicio: 'asc' },
          select: {
            id: true, titulo: true, tipo: true, status: true, inicio: true,
            responsavel: { select: { id: true, nome: true } },
          },
        },
        filiado: {
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true, situacao: true,
            telefonePrincipal: true, telefoneSecundario: true, email: true,
            cep: true, endereco: true, numero: true, complemento: true, bairro: true,
            cidade: true, estado: true,
          },
        },
      },
    });
    if (!atendimento) throw new NotFoundException('Atendimento não encontrado.');

    const historico = await this.prisma.atendimento.findMany({
      where: { filiadoId: atendimento.filiado.id, id: { not: id } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, numero: true, canal: true, desfecho: true, status: true, descricao: true, createdAt: true,
        atendente: { select: { nome: true } },
      },
    });
    return { atendimento, historico };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private auditar(acao: AcaoAuditoria, entidadeId: string, ctx: Ctx, descricao: string, metadata: Prisma.InputJsonValue) {
    return this.audit.registrar({
      userId: ctx.userId ?? null, acao, entidade: 'Atendimento', entidadeId, descricao,
      ip: ctx.ip, userAgent: ctx.userAgent, metadata,
    });
  }

  private intervaloDatas(inicio?: string, fim?: string): Prisma.DateTimeFilter | null {
    const range: Prisma.DateTimeFilter = {};
    if (inicio && /^\d{4}-\d{2}-\d{2}$/.test(inicio)) range.gte = new Date(`${inicio}T00:00:00.000Z`);
    if (fim && /^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      const d = new Date(`${fim}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      range.lt = d;
    }
    return range.gte || range.lt ? range : null;
  }
}
