import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AcaoAuditoria, Prisma, StatusCompromisso, StatusProcesso,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TiposEventoService } from './tipos-evento.service';
import {
  acharDesfecho, desfechosDoTipo, categoriaCancelamentoValida,
  CATEGORIA_CANCELAMENTO_LABEL,
} from './desfechos.catalogo';
import { montarUrgencia, sincronizarEquipe } from './equipe.util';
import { normalizarCategoria } from '../processos/areas.catalogo';
import { PARTE_ORDER } from '../processos/partes.service';
import {
  CancelarCompromissoDto,
  ConcluirCompromissoDto,
  CreateCompromissoDto,
  ListCompromissosQueryDto,
  MudarStatusDto,
  RemarcarCompromissoDto,
  UpdateCompromissoDto,
} from './dto/agenda.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
  /** Nome de quem agiu — congelado no histórico da atividade. */
  nome?: string;
}

/** LGPD: nos cards da agenda expomos só o mínimo do filiado (nome/matrícula). */
const filiadoCard = { select: { id: true, nomeCompleto: true, matricula: true } } as const;
const responsavelSel = { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } } as const;
/** Quem REGISTROU a demanda — nome e foto, para o card creditar o autor. */
const criadorSel = { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } } as const;
/**
 * O PROCESSO NO CARTÃO — e por que ele carrega as PARTES.
 *
 * O defeito, visto numa tela real: dois cartões lado a lado, ambos
 * "Verificação de Intimação / Prazo", mesma hora, mesmo advogado, e NADA que
 * dissesse de qual processo cada um era. O título é uma categoria, não uma
 * identidade — e a categoria já está no selo, logo acima.
 *
 * A identidade que uma pessoa reconhece num relance é quem litiga contra quem.
 * Ninguém decora NPU; todo mundo lembra "aquele contra a Prefeitura de X".
 *
 * `PARTE_ORDER` põe a parte PRINCIPAL primeiro dentro de cada polo, então a
 * primeira ATIVO e a primeira PASSIVO são as que o cartão mostra — a mesma
 * regra de `agruparPorPolo`, sem reimplementá-la. Só `nome` e `polo`: o cartão
 * não precisa de mais, e uma agenda cheia carregaria o resto à toa.
 */
const processoSel = {
  select: {
    id: true,
    numeroCNJ: true,
    statusInterno: true,
    titulo: true,
    tipoAcao: true,
    partes: { select: { nome: true, polo: true }, orderBy: PARTE_ORDER },
  },
} as const;

/**
 * O responsável primeiro, depois quem entrou antes. Tipado explicitamente (e
 * não `as const`) porque o `as const` produz um array READONLY que o Prisma não
 * aceita em `orderBy` — mesmo motivo e mesma solução de `PARTE_ORDER`.
 */
const EQUIPE_ORDER: Prisma.CompromissoResponsavelOrderByWithRelationInput[] = [
  { principal: 'desc' },
  { createdAt: 'asc' },
];

/** Campos expostos nos cards (Kanban/Calendário/Alertas). */
const cardSelect = {
  id: true, titulo: true, tipo: true, status: true, inicio: true, fim: true,
  local: true, descricao: true, urgente: true, iniciadoEm: true, origemAutomatica: true,
  dataOriginal: true, atendimentoId: true, remarcacoes: true, remarcadoMotivo: true,
  desfecho: true, desfechoObs: true, concluidoEm: true,
  // A CATEGORIA é a explicação padronizada do cancelamento; o motivo em texto é
  // opcional, então sem ela o card ficaria sem dizer por que a atividade caiu.
  canceladoCategoria: true, canceladoMotivo: true, canceladoEm: true,
  // A URGÊNCIA vem inteira: sem o motivo, o selo na tela diz "Urgente" e não
  // diz por quê — que era o defeito que a coluna nova veio resolver.
  urgenteMotivo: true, urgenteEm: true,
  filiado: filiadoCard, responsavel: responsavelSel, criador: criadorSel, processo: processoSel,
  /**
   * A EQUIPE, com o responsável marcado. O card mostra os avatares empilhados;
   * sem isto, uma audiência com três advogados apareceria como se fosse de um.
   */
  equipe: { select: { principal: true, usuario: responsavelSel }, orderBy: EQUIPE_ORDER },
} as const;

/**
 * MÁQUINA DE ESTADOS da atividade.
 *
 * Antes, qualquer status ia para qualquer status (inclusive Concluído →
 * Cancelado, que não quer dizer nada). Aqui as transições ficam explícitas —
 * é o que impede o quadro de contar uma história impossível.
 *
 * CONCLUIDO e CANCELADO NÃO aparecem como destino: eles exigem informação
 * obrigatória (desfecho / motivo) e por isso têm rotas próprias
 * (`concluir` e `cancelar`). Voltar deles é "reabrir", que limpa o registro.
 */
const TRANSICOES: Record<StatusCompromisso, StatusCompromisso[]> = {
  PENDENTE: [StatusCompromisso.EM_ANDAMENTO],
  EM_ANDAMENTO: [StatusCompromisso.PENDENTE],
  CONCLUIDO: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO],
  CANCELADO: [StatusCompromisso.PENDENTE],
};


/** Data/hora no formato que o histórico mostra. */
const fmt = (d: Date) =>
  d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/**
 * Tipo do andamento interno gravado no processo quando a atividade é concluída.
 * Slugs de `tipos_movimentacao`; o que não estiver aqui cai em ATUALIZACAO.
 */
const TIPO_ANDAMENTO: Record<string, string> = {
  AUDIENCIA: 'AUDIENCIA',
  PERICIA: 'AUDIENCIA', // ato de instrução — a timeline trata igual
  PRAZO: 'PRAZO',
  DESPACHO: 'DESPACHO',
};

/**
 * Desfecho ruim entra no processo como URGENTE (vermelho na linha do tempo).
 * Prazo perdido não pode chegar ao advogado com a mesma cor de "peça protocolada".
 */
const tipoAndamento = (tipoAtividade: string, alerta?: boolean): string =>
  alerta ? 'URGENTE' : (TIPO_ANDAMENTO[tipoAtividade] ?? 'ATUALIZACAO');

/** Brasil sem horário de verão desde 2019 → offset fixo UTC-3. */
const OFFSET_BR_MS = 3 * 3_600_000;

/** 09:00 de Teresina, `dias` à frente — horário em que a equipe abre o sistema. */
function manhaDaqui(dias: number): Date {
  const br = new Date(Date.now() - OFFSET_BR_MS);
  const alvo = Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + dias, 9, 0, 0);
  return new Date(alvo + OFFSET_BR_MS);
}

@Injectable()
export class AgendaService {
  private readonly logger = new Logger(AgendaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tipos: TiposEventoService,
  ) {}

  /**
   * Usuários ativos que podem ser responsáveis por um compromisso.
   * Inclui `avatarUrl` porque esta lista alimenta seletores que mostram FOTO
   * (equipe do processo, atribuição de responsável) — sem ela, todo mundo
   * aparecia como uma inicial em círculo.
   */
  listarResponsaveis() {
    return this.prisma.user.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, role: true },
    });
  }

  // -------------------------------------------------------------------------
  // Criação
  // -------------------------------------------------------------------------

  async criar(dto: CreateCompromissoDto, ctx: Ctx) {
    await this.tipos.garantirSlugValido(dto.tipo);
    await this.validarVinculos(dto.responsavelId, dto.filiadoId, dto.atendimentoId, dto.processoId);
    // A equipe inteira é conferida ANTES de gravar: um id inválido no meio da
    // lista quebraria a FK dentro da transação, e o erro que chegaria à tela
    // seria de banco, não de formulário.
    const equipeIds = await this.validarEquipe(dto.responsavelId, dto.responsaveisIds);
    const inicio = new Date(dto.inicio);
    const fim = new Date(dto.fim);
    if (fim < inicio) throw new BadRequestException('O fim não pode ser antes do início.');

    const urgencia = montarUrgencia(dto.urgente, dto.urgenteMotivo, { userId: ctx.userId });

    const compromisso = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.compromisso.create({
        data: {
          titulo: dto.titulo.trim(),
          tipo: dto.tipo,
          status: dto.status ?? undefined,
          inicio,
          fim,
          local: dto.local?.trim() || null,
          descricao: dto.descricao?.trim() || null,
          observacoesInternas: dto.observacoesInternas?.trim() || null,
          urgente: false, // definido logo abaixo por `montarUrgencia`
          responsavelId: dto.responsavelId,
          filiadoId: dto.filiadoId || null,
          atendimentoId: dto.atendimentoId || null,
          processoId: dto.processoId || null,
          criadoPor: ctx.userId,
          ...urgencia,
        },
        select: { id: true },
      });
      // A equipe entra na MESMA transação: uma atividade que existisse sem
      // equipe, ainda que por um instante, teria o atalho apontando para uma
      // linha que não existe.
      await sincronizarEquipe(tx, criado.id, {
        principalId: dto.responsavelId,
        participantesIds: equipeIds,
      });
      return tx.compromisso.findUniqueOrThrow({ where: { id: criado.id }, select: cardSelect });
    });

    await this.auditar(AcaoAuditoria.CREATE, compromisso.id, `Compromisso criado: ${compromisso.titulo}`, ctx, {
      tipo: dto.tipo, inicio: inicio.toISOString(), equipe: equipeIds.length,
    });
    await this.historiar(compromisso.id, 'CRIADO', this.narrarCriacao(dto, equipeIds), ctx, {
      tipo: dto.tipo, inicio: inicio.toISOString(),
    });
    return compromisso;
  }

  /**
   * Confere que todo mundo da equipe existe e está ativo.
   *
   * Devolve a lista sem o responsável repetido — quem normaliza de verdade é
   * `normalizarEquipe`, aqui é só a checagem de existência.
   */
  private async validarEquipe(responsavelId: string, outros?: string[]): Promise<string[]> {
    const ids = [...new Set((outros ?? []).map((i) => i.trim()).filter(Boolean))]
      .filter((id) => id !== responsavelId);
    if (!ids.length) return [];
    const achados = await this.prisma.user.findMany({
      where: { id: { in: ids }, ativo: true },
      select: { id: true },
    });
    if (achados.length !== ids.length) {
      const validos = new Set(achados.map((u) => u.id));
      const faltando = ids.filter((i) => !validos.has(i));
      throw new BadRequestException(
        `Participante inválido ou inativo na equipe (${faltando.length}). ` +
          'Remova quem saiu do sistema e tente de novo.',
      );
    }
    return ids;
  }

  /** A narrativa do histórico já nasce dizendo quem ficou responsável. */
  private narrarCriacao(dto: CreateCompromissoDto, equipe: string[]): string {
    if (!equipe.length) return 'Atividade criada.';
    return `Atividade criada com equipe de ${equipe.length + 1} pessoas.`;
  }

  // -------------------------------------------------------------------------
  // Listagem (Kanban/Calendário) — filtros + intervalo por `inicio`
  // -------------------------------------------------------------------------

  /**
   * QUEM MAIS ESTÁ NA AGENDA DESSA PESSOA NESSE HORÁRIO.
   *
   * O BURACO, medido na produção em 27/08/2026: a Dra. Margareth tinha TRÊS
   * consultas encadeadas no dia 31/08 — 12:00–13:00, 12:40–13:40 e 13:20–14:20.
   * Alguém marcou de quarenta em quarenta minutos atendimentos de uma hora, e
   * nada no sistema disse nada. Um advogado não se divide em dois, e numa
   * audiência a consequência não é constrangimento: é revelia.
   *
   * NÃO BLOQUEIA, e a escolha é do mesmo tipo da desfiliação. Sobreposição
   * legítima existe — duas atividades curtas no mesmo bloco, uma que será
   * delegada, uma audiência que já se sabe que será adiada. Recusar obrigaria a
   * equipe a mentir a data para conseguir salvar. O que o sistema deve fazer é
   * MOSTRAR antes de gravar.
   *
   * A REGRA DE SOBREPOSIÇÃO é a canônica: dois intervalos se cruzam quando
   * `a.inicio < b.fim` E `b.inicio < a.fim`. Encostar não é cruzar — uma
   * atividade que termina 13:00 e outra que começa 13:00 convivem, e tratá-las
   * como choque encheria a tela de aviso falso na agenda de quem trabalha com
   * blocos colados.
   *
   * Olha a EQUIPE, não só o responsável: desde que a atividade passou a ter
   * equipe, o segundo advogado de uma audiência também tem o horário ocupado —
   * conferir só `responsavelId` repetiria o defeito que já escondeu audiência
   * do painel de quem acompanhava sem responder.
   */
  async conflitos(params: {
    responsavelId: string;
    inicio: string;
    fim: string;
    ignorarId?: string;
  }) {
    const inicio = new Date(params.inicio);
    const fim = new Date(params.fim);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new BadRequestException('Período inválido para conferir a agenda.');
    }
    if (fim <= inicio) return [];

    return this.prisma.compromisso.findMany({
      where: {
        // Só o que ainda vai acontecer: uma atividade concluída ou cancelada
        // não ocupa mais ninguém.
        status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        ...(params.ignorarId ? { id: { not: params.ignorarId } } : {}),
        OR: [
          { responsavelId: params.responsavelId },
          { equipe: { some: { usuarioId: params.responsavelId } } },
        ],
        inicio: { lt: fim },
        fim: { gt: inicio },
      },
      orderBy: { inicio: 'asc' },
      take: 10,
      select: {
        id: true, titulo: true, tipo: true, inicio: true, fim: true, local: true,
        filiado: filiadoCard,
      },
    });
  }

  async listar(q: ListCompromissosQueryDto) {
    const and: Prisma.CompromissoWhereInput[] = [];
    if (q.status) and.push({ status: q.status });
    if (q.tipo) and.push({ tipo: q.tipo });
    /**
     * "A agenda do fulano" passa a incluir o que ele ACOMPANHA, e não só o que
     * ele responde.
     *
     * É o ponto inteiro da equipe: o segundo advogado de uma audiência precisa
     * vê-la na própria agenda, senão a multivinculação não serve para nada — a
     * atividade existiria com duas pessoas e apareceria para uma.
     *
     * O atalho `responsavelId` continua no OR ao lado da tabela: ele é derivado
     * dela e a segunda condição bastaria, mas uma atividade que tenha perdido a
     * linha de equipe (correção manual, carga antiga) sumiria da agenda de quem
     * responde — e essa é a fila que ninguém pode perder. Mesmo cinto de
     * segurança usado na busca por filiado em `ProcessosService`.
     */
    if (q.responsavelId) {
      and.push({
        OR: [
          { responsavelId: q.responsavelId },
          { equipe: { some: { usuarioId: q.responsavelId } } },
        ],
      });
    }
    if (q.filiadoId) and.push({ filiadoId: q.filiadoId });
    const busca = q.busca?.trim();
    if (busca) {
      and.push({
        OR: [
          { titulo: { contains: busca, mode: 'insensitive' } },
          { filiado: { nomeCompleto: { contains: busca, mode: 'insensitive' } } },
        ],
      });
    }
    const range: Prisma.DateTimeFilter = {};
    if (q.dataInicio) range.gte = new Date(q.dataInicio);
    if (q.dataFim) range.lte = new Date(q.dataFim);
    if (range.gte || range.lte) and.push({ inicio: range });

    return this.prisma.compromisso.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: { inicio: 'asc' },
      take: 500,
      select: cardSelect,
    });
  }

  // -------------------------------------------------------------------------
  // Alertas: "Aguardando interação" (venceu há +3h e ainda em aberto) e
  //          "Próximas 24 horas" (agendados para o próximo dia).
  // -------------------------------------------------------------------------

  async alertas() {
    const agora = new Date();
    const menos3h = new Date(agora.getTime() - 3 * 3600 * 1000);
    const mais24h = new Date(agora.getTime() + 24 * 3600 * 1000);
    const abertos: Prisma.CompromissoWhereInput = {
      status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
    };

    const [aguardando, proximas24h] = await Promise.all([
      this.prisma.compromisso.findMany({
        where: { AND: [abertos, { inicio: { lt: menos3h } }] },
        orderBy: { inicio: 'asc' },
        take: 50,
        select: cardSelect,
      }),
      this.prisma.compromisso.findMany({
        where: { AND: [abertos, { inicio: { gte: agora, lte: mais24h } }] },
        orderBy: { inicio: 'asc' },
        take: 50,
        select: cardSelect,
      }),
    ]);
    return { aguardando, proximas24h };
  }

  async detalhe(id: string) {
    const compromisso = await this.prisma.compromisso.findUnique({
      where: { id },
      include: {
        // Detalhe expõe mais do filiado (contato) — a tela é de trabalho interno.
        filiado: {
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true,
            telefonePrincipal: true, email: true, formacao: true,
          },
        },
        responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, role: true } },
        // Quem REGISTROU a demanda — agora é uma FK, então vem com nome E FOTO
        // numa consulta só (antes era só um id solto, sem como exibir avatar).
        criador: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, role: true } },
        /**
         * O DETALHE MOSTRA OS POLOS INTEIROS, não só a parte principal.
         *
         * O cartão da lista tem espaço para uma linha e mostra o confronto
         * resumido ("Autor × Réu"); aqui há espaço para a verdade completa, que
         * é o que alguém abre o detalhe para ver. Litisconsórcio é comum em ação
         * coletiva — mostrar só o principal esconderia metade de quem litiga.
         *
         * `papel` vem junto porque nem todo ATIVO é "Autor": em execução é
         * "Exequente", em recurso é "Recorrente". O polo diz o lado; o papel diz
         * o que a pessoa é NAQUELA fase.
         */
        processo: {
          select: {
            id: true, numeroCNJ: true, classeProcessual: true, statusInterno: true, titulo: true,
            tipoAcao: true,
            partes: {
              select: { id: true, nome: true, polo: true, papel: true, principal: true },
              orderBy: PARTE_ORDER,
            },
          },
        },
        // Triagem de origem: canal, demanda e QUEM registrou (atendente).
        atendimento: {
          select: {
            id: true, numero: true, canal: true, desfecho: true, descricao: true, createdAt: true,
            atendente: { select: { id: true, nome: true, nomeExibicao: true } },
          },
        },
      },
    });
    if (!compromisso) throw new NotFoundException('Compromisso não encontrado.');

    // `criadoPorNome` continua na resposta por compatibilidade com quem já lia
    // esse campo; a fonte agora é a relação `criador` (que traz também a foto).
    const criadoPorNome =
      compromisso.criador?.nomeExibicao || compromisso.criador?.nome || null;
    return { ...compromisso, criadoPorNome };
  }

  // -------------------------------------------------------------------------
  // Edição — com TRAVA da data original na 1ª remarcação (auditoria de prazos)
  // -------------------------------------------------------------------------

  async atualizar(id: string, dto: UpdateCompromissoDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({ where: { id } });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');
    if (dto.tipo) await this.tipos.garantirSlugValido(dto.tipo);

    if (dto.responsavelId || dto.filiadoId !== undefined || dto.atendimentoId !== undefined || dto.processoId !== undefined) {
      await this.validarVinculos(
        dto.responsavelId ?? atual.responsavelId,
        dto.filiadoId === undefined ? undefined : dto.filiadoId,
        dto.atendimentoId === undefined ? undefined : dto.atendimentoId,
        dto.processoId === undefined ? undefined : dto.processoId,
      );
    }

    const novoInicio = dto.inicio ? new Date(dto.inicio) : atual.inicio;
    const novoFim = dto.fim ? new Date(dto.fim) : atual.fim;
    if (novoFim < novoInicio) throw new BadRequestException('O fim não pode ser antes do início.');

    // Remarcação: se a data de início mudou e ainda não há original, TRAVA a original.
    const remarcado = dto.inicio != null && novoInicio.getTime() !== atual.inicio.getTime();
    const dataOriginal = remarcado && !atual.dataOriginal ? atual.inicio : undefined;

    // A equipe só é mexida quando a requisição FALA dela. Campo ausente é "não
    // mexa" — sem esta distinção, um PATCH que só troca o título apagaria os
    // participantes, que é o defeito clássico de sincronização de lista.
    const mexeuNaEquipe = dto.responsaveisIds !== undefined || dto.responsavelId !== undefined;
    const equipeIds = mexeuNaEquipe
      ? await this.validarEquipe(dto.responsavelId ?? atual.responsavelId, dto.responsaveisIds)
      : [];

    const urgencia = montarUrgencia(dto.urgente, dto.urgenteMotivo, { userId: ctx.userId }, atual);

    const compromisso = await this.prisma.$transaction(async (tx) => {
      await tx.compromisso.update({
        where: { id },
        data: {
          titulo: dto.titulo?.trim(),
          tipo: dto.tipo,
          status: dto.status,
          inicio: dto.inicio ? novoInicio : undefined,
          fim: dto.fim ? novoFim : undefined,
          local: dto.local === undefined ? undefined : dto.local?.trim() || null,
          descricao: dto.descricao === undefined ? undefined : dto.descricao?.trim() || null,
          observacoesInternas: dto.observacoesInternas === undefined ? undefined : dto.observacoesInternas?.trim() || null,
          responsavelId: dto.responsavelId,
          filiadoId: dto.filiadoId === undefined ? undefined : dto.filiadoId || null,
          atendimentoId: dto.atendimentoId === undefined ? undefined : dto.atendimentoId || null,
          processoId: dto.processoId === undefined ? undefined : dto.processoId || null,
          ...(dataOriginal ? { dataOriginal } : {}),
          ...urgencia,
        },
      });
      if (mexeuNaEquipe) {
        await sincronizarEquipe(tx, id, {
          principalId: dto.responsavelId ?? atual.responsavelId,
          participantesIds: dto.responsaveisIds === undefined
            // Trocou só o responsável: preserva quem já participava.
            ? (await tx.compromissoResponsavel.findMany({
                where: { compromissoId: id },
                select: { usuarioId: true },
              })).map((e) => e.usuarioId)
            : equipeIds,
        });
      }
      return tx.compromisso.findUniqueOrThrow({ where: { id }, select: cardSelect });
    });

    // A troca de responsável é a mudança que mais gera dúvida depois ("quem
    // ficou com isso?"), então ela entra no histórico com nome e não só no
    // registro genérico de edição.
    if (dto.responsavelId && dto.responsavelId !== atual.responsavelId) {
      await this.historiar(id, 'EDITADO', 'Responsável alterado.', ctx, {
        de: atual.responsavelId, para: dto.responsavelId,
      });
    }

    if (remarcado) {
      // Trilha de auditoria da remarcação — nunca apagamos as datas antigas.
      await this.historiar(
        id,
        'REMARCADO',
        `Data alterada de ${fmt(atual.inicio)} para ${fmt(novoInicio)}.`,
        ctx,
        { de: atual.inicio.toISOString(), para: novoInicio.toISOString(), via: 'edicao' },
      );
      await this.auditar(AcaoAuditoria.UPDATE, id, `Compromisso REMARCADO: ${atual.inicio.toISOString()} → ${novoInicio.toISOString()}`, ctx, {
        de: atual.inicio.toISOString(),
        para: novoInicio.toISOString(),
        dataOriginal: (compromisso.dataOriginal ?? atual.inicio).toISOString(),
      });
    } else {
      await this.historiar(id, 'EDITADO', 'Dados da atividade alterados.', ctx, {});
      await this.auditar(AcaoAuditoria.UPDATE, id, `Compromisso atualizado: ${compromisso.titulo}`, ctx, {});
    }
    return compromisso;
  }

  // -------------------------------------------------------------------------
  // Avanço da atividade — transições validadas (ver TRANSICOES)
  // -------------------------------------------------------------------------

  /**
   * Passos que NÃO exigem informação extra: iniciar, voltar a pendente e
   * reabrir. Concluir e cancelar são recusados aqui de propósito — a mensagem
   * aponta a rota certa em vez de deixar o evento fechar sem resultado/motivo.
   */
  async mudarStatus(id: string, dto: MudarStatusDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({
      where: { id },
      select: { id: true, status: true, iniciadoEm: true, titulo: true },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');

    if (dto.status === atual.status) return this.cartao(id);

    if (dto.status === StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException(
        'Para concluir, registre o desfecho da atividade (o que aconteceu com a demanda).',
      );
    }
    if (dto.status === StatusCompromisso.CANCELADO) {
      throw new BadRequestException('Para cancelar, informe o motivo do cancelamento.');
    }
    this.garantirTransicao(atual.status, dto.status);

    const reabrindo =
      atual.status === StatusCompromisso.CONCLUIDO || atual.status === StatusCompromisso.CANCELADO;

    // Ao INICIAR, carimba o horário para o cronômetro — só na 1ª vez.
    // Ao voltar para PENDENTE, zera o cronômetro.
    let iniciadoEm: Date | null | undefined;
    if (dto.status === StatusCompromisso.EM_ANDAMENTO && !atual.iniciadoEm) iniciadoEm = new Date();
    else if (dto.status === StatusCompromisso.PENDENTE) iniciadoEm = null;

    const compromisso = await this.prisma.compromisso.update({
      where: { id },
      data: {
        status: dto.status,
        ...(iniciadoEm !== undefined ? { iniciadoEm } : {}),
        // Reabrir limpa o fechamento anterior: manter um desfecho antigo num
        // evento que voltou a estar aberto faria a tela mentir. O histórico
        // permanece na Auditoria.
        ...(reabrindo
          ? {
              desfecho: null, desfechoObs: null, concluidoEm: null, concluidoPor: null,
              canceladoMotivo: null, canceladoEm: null, canceladoPor: null,
            }
          : {}),
      },
      select: cardSelect,
    });

    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      reabrindo
        ? `Compromisso REABERTO (${atual.status} → ${dto.status}): ${atual.titulo}`
        : `Status do compromisso → ${dto.status}`,
      ctx,
      { de: atual.status, para: dto.status, reabertura: reabrindo },
    );

    // Reabrir apaga o desfecho/motivo do registro; o histórico é o único lugar
    // onde a decisão anterior continua visível para a equipe.
    const narrativa = reabrindo
      ? `Reaberta (estava ${atual.status === StatusCompromisso.CONCLUIDO ? 'concluída' : 'cancelada'}).`
      : dto.status === StatusCompromisso.EM_ANDAMENTO
        ? 'Iniciada.'
        : 'Voltou para pendente.';
    await this.historiar(
      id,
      reabrindo ? 'REABERTO' : dto.status === StatusCompromisso.EM_ANDAMENTO ? 'INICIADO' : 'EDITADO',
      narrativa,
      ctx,
      { de: atual.status, para: dto.status },
    );
    return compromisso;
  }

  /**
   * CONCLUIR com desfecho. É o fecho do ciclo da demanda, e o ponto em que ela
   * CONVERSA com o resto do sistema:
   *  - o desfecho vira ANDAMENTO INTERNO no processo vinculado — sem isso, uma
   *    audiência que terminou em acordo não deixava rastro nenhum na história do
   *    processo, que é justamente onde o advogado vai procurar;
   *  - VINCULADO_PROCESSO → liga a um processo existente, conferindo que ele é
   *    mesmo do filiado da atividade;
   *  - PROCESSO_CRIADO    → abre um caso PRÉ-PROCESSUAL (que já nasce com o
   *    primeiro andamento próprio, por isso não recebe outro aqui);
   *  - CRIAR_ATIVIDADE    → a pendência declarada no desfecho ("encaminhamentos",
   *    "laudo pendente", "prazo perdido") nasce como atividade com dono e data.
   *
   * Tudo numa transação: ou a atividade fecha com os efeitos completos, ou não
   * fecha. Um seguimento perdido no meio do caminho é pior do que erro na tela.
   */
  async concluir(id: string, dto: ConcluirCompromissoDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({
      where: { id },
      select: {
        id: true, status: true, titulo: true, descricao: true, tipo: true, inicio: true,
        filiadoId: true, processoId: true, responsavelId: true, atendimentoId: true,
        // A urgência viaja para o caso pré-processual — ver `criarPreProcessual`.
        urgente: true, urgenteMotivo: true,
      },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');
    if (atual.status === StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException('Esta atividade já está concluída.');
    }
    if (atual.status === StatusCompromisso.CANCELADO) {
      throw new BadRequestException('Atividade cancelada — reabra antes de concluir.');
    }

    // O desfecho tem de pertencer ao TIPO da atividade: uma audiência não se
    // conclui como "prazo perdido", e o catálogo é quem sabe disso.
    const opcao = acharDesfecho(atual.tipo, dto.desfecho);
    if (!opcao) {
      const validos = desfechosDoTipo(atual.tipo).map((d) => d.label).join(', ');
      throw new BadRequestException(
        `Desfecho inválido para este tipo de atividade. Opções: ${validos}.`,
      );
    }

    const obs = dto.desfechoObs?.trim() || null;
    if (opcao.exigeObs && !obs) {
      throw new BadRequestException(
        opcao.slug === 'DUVIDA_ESCLARECIDA'
          ? 'Descreva a orientação dada ao filiado.'
          : `Descreva o que aconteceu — "${opcao.label}" exige a observação.`,
      );
    }

    // ---- Vínculo com processo, conforme o encaminhamento do desfecho ----
    let processoId = atual.processoId;
    let preProcessualCriado: { id: string; titulo: string | null } | null = null;

    if (opcao.acao === 'VINCULAR_PROCESSO') {
      if (!dto.processoId) throw new BadRequestException('Selecione o processo a vincular.');
      processoId = await this.processoDoFiliado(dto.processoId, atual.filiadoId);
    }

    if (opcao.acao === 'CRIAR_PROCESSO') {
      preProcessualCriado = await this.criarPreProcessual(id, atual, dto, ctx);
      processoId = preProcessualCriado.id;
    }

    // ---- Atividade de seguimento (a pendência que o desfecho declara) ----
    const spec = opcao.acao === 'CRIAR_ATIVIDADE' ? opcao.seguimento : undefined;
    // Só o seguimento SUGERIDO pode ser dispensado; o obrigatório é o desfecho.
    const criarSeguimento = !!spec && (spec.obrigatorio || dto.criarSeguimento !== false);
    const responsavelSeguimento = dto.seguimento?.responsavelId || atual.responsavelId;
    if (criarSeguimento && dto.seguimento?.responsavelId) {
      const u = await this.prisma.user.findFirst({
        where: { id: dto.seguimento.responsavelId, ativo: true },
        select: { id: true },
      });
      if (!u) throw new BadRequestException('Responsável inválido para a atividade de seguimento.');
    }
    // Tipo desativado não pode travar a conclusão: cai no genérico e o histórico
    // registra a troca.
    const tipoSeguimento = criarSeguimento ? await this.tipoUsavel(spec!.tipo) : null;

    // O andamento no processo só é escrito quando NÃO houve rascunho: o rascunho
    // já nasce com a conversa como primeiro andamento (ver criarRascunho).
    const gravarAndamento = !!processoId && !preProcessualCriado;

    const { compromisso, seguimento } = await this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.compromisso.update({
        where: { id },
        data: {
          status: StatusCompromisso.CONCLUIDO,
          desfecho: dto.desfecho,
          desfechoObs: obs,
          concluidoEm: new Date(),
          concluidoPor: ctx.userId ?? null,
          processoId,
        },
        select: cardSelect,
      });

      if (gravarAndamento) {
        await tx.movimentacaoInterna.create({
          data: {
            processoId: processoId!,
            tipo: tipoAndamento(atual.tipo, opcao.alerta),
            descricao: `${atual.titulo} — ${opcao.label}.${obs ? `\n${obs}` : ''}`,
            // A audiência de quarta concluída na sexta pertence à quarta. É para
            // isto que `dataFato` existe.
            dataFato: atual.inicio,
            autorId: ctx.userId ?? null,
          },
        });
      }

      /**
       * CONCLUIR DUAS VEZES NÃO CRIA DOIS SEGUIMENTOS.
       *
       * O CASO REAL, na produção de 27/08/2026: o Dr. Murilo tinha DOIS
       * "Encaminhamento da reunião" idênticos, ambos das 12:00 às 13:00 do dia
       * 03/09, criados com dezesseis minutos de diferença e com textos que
       * descreviam o mesmo evento de duas formas. Alguém concluiu a reunião,
       * reabriu para corrigir o texto do desfecho e concluiu de novo — e cada
       * conclusão criava um seguimento, com o primeiro ficando para trás.
       *
       * A providência anterior é CANCELADA, e não reaproveitada, porque a
       * segunda conclusão pode ter escolhido OUTRO desfecho: "com
       * encaminhamentos" vira "sem deliberação" e aí não deve sobrar tarefa
       * nenhuma. Substituir garante que a agenda reflita o desfecho ATUAL, e
       * não a soma de todas as tentativas.
       *
       * Cancelar (em vez de apagar) preserva o histórico: fica registrado que
       * houve uma providência anterior e por que ela caiu. E vale mesmo quando
       * o novo desfecho não gera seguimento — por isso roda ANTES do `return`.
       */
      const anteriores = await tx.compromisso.findMany({
        where: {
          origemDesfechoId: id,
          status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        },
        select: { id: true },
      });
      for (const antigo of anteriores) {
        await tx.compromisso.update({
          where: { id: antigo.id },
          data: {
            status: StatusCompromisso.CANCELADO,
            canceladoCategoria: 'SUBSTITUIDA',
            canceladoMotivo: `A atividade de origem foi concluída de novo (${opcao.label}) e esta providência foi substituída.`,
            canceladoEm: new Date(),
          },
        });
        await tx.compromissoHistorico.create({
          data: {
            compromissoId: antigo.id,
            acao: 'CANCELADO',
            descricao: `Substituída: "${atual.titulo}" foi concluída novamente como "${opcao.label}".`,
            autorId: ctx.userId ?? null,
            autorNome: ctx.nome ?? null,
          },
        });
      }

      if (!criarSeguimento) return { compromisso: atualizado, seguimento: null };

      const inicio = dto.seguimento?.inicio
        ? new Date(dto.seguimento.inicio)
        : manhaDaqui(spec!.emDias);
      const novo = await tx.compromisso.create({
        data: {
          titulo: dto.seguimento?.titulo?.trim() || spec!.titulo,
          tipo: tipoSeguimento!,
          inicio,
          fim: new Date(inicio.getTime() + 3_600_000),
          descricao:
            dto.seguimento?.descricao?.trim() ||
            [obs, `Origem: "${atual.titulo}" (${opcao.label}).`].filter(Boolean).join('\n'),
          // Herda os vínculos para o seguimento não virar um registro solto que
          // alguém precisa adotar depois.
          responsavelId: responsavelSeguimento,
          filiadoId: atual.filiadoId,
          processoId,
          atendimentoId: atual.atendimentoId,
          // O VÍNCULO COM A ORIGEM — é ele que faz a próxima conclusão
          // reconhecer esta providência em vez de empilhar uma segunda.
          origemDesfechoId: id,
          // Desfecho de alerta (prazo perdido, contato sem sucesso) gera
          // seguimento urgente — e agora ele diz POR QUÊ. Antes nascia urgente
          // e mudo, e quem abria não sabia se era regra ou engano.
          urgente: !!opcao.alerta,
          ...(opcao.alerta
            ? {
                urgenteMotivo: `Desfecho "${opcao.label}" da atividade "${atual.titulo}".`,
                urgenteEm: new Date(),
                urgentePor: ctx.userId ?? null,
              }
            : {}),
          criadoPor: ctx.userId ?? null,
        },
        select: { id: true, titulo: true, inicio: true, tipo: true },
      });
      await tx.compromissoHistorico.create({
        data: {
          compromissoId: novo.id,
          acao: 'CRIADO',
          descricao: `Criada a partir do desfecho "${opcao.label}" da atividade "${atual.titulo}".`,
          autorId: ctx.userId ?? null,
          autorNome: ctx.nome ?? null,
          metadata: { origemCompromissoId: id, desfecho: dto.desfecho },
        },
      });
      return { compromisso: atualizado, seguimento: novo };
    });

    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      `Compromisso CONCLUÍDO (${opcao.label}): ${atual.titulo}`,
      ctx,
      {
        desfecho: dto.desfecho,
        processoId: processoId ?? null,
        preProcessualCriado: preProcessualCriado?.id ?? null,
        seguimentoCriado: seguimento?.id ?? null,
        andamentoNoProcesso: gravarAndamento,
      },
    );
    await this.historiar(
      id,
      'CONCLUIDO',
      `Concluída — ${opcao.label}.${obs ? ` ${obs}` : ''}` +
        (seguimento ? ` Seguimento agendado: "${seguimento.titulo}" para ${fmt(seguimento.inicio)}.` : '') +
        (tipoSeguimento && spec && tipoSeguimento !== spec.tipo
          ? ` (o tipo "${spec.tipo}" está desativado — a atividade foi criada como "${tipoSeguimento}")`
          : ''),
      ctx,
      {
        desfecho: dto.desfecho,
        de: atual.status,
        preProcessualCriado: preProcessualCriado?.id ?? null,
        seguimentoCriado: seguimento?.id ?? null,
      },
    );
    return {
      ...compromisso,
      preProcessualCriado,
      /** Nome antigo na resposta — a tela em produção ainda lê por ele. */
      rascunhoCriado: preProcessualCriado,
      seguimentoCriado: seguimento,
    };
  }

  /**
   * CANCELAR — a CATEGORIA é obrigatória; o texto é complemento.
   *
   * A categoria é o que responde "por que não aconteceu?" de forma padronizada
   * e mensurável. O texto livre continua aceito para o caso que ela não cobre,
   * mas exigi-lo só rendia frases repetindo o rótulo já escolhido.
   */
  async cancelar(id: string, dto: CancelarCompromissoDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({
      where: { id },
      select: { id: true, status: true, titulo: true },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');
    if (atual.status === StatusCompromisso.CANCELADO) {
      throw new BadRequestException('Esta atividade já está cancelada.');
    }
    if (atual.status === StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException('Atividade concluída — reabra antes de cancelar.');
    }

    // A categoria é o que torna o cancelamento mensurável ("quantas faltas de
    // filiado tivemos no mês?") — e é ela, agora, que carrega a explicação.
    if (!categoriaCancelamentoValida(dto.categoria)) {
      throw new BadRequestException('Informe por que a atividade não aconteceu.');
    }
    const rotuloCategoria = CATEGORIA_CANCELAMENTO_LABEL[dto.categoria];
    const motivo = dto.motivo?.trim() || null;

    const compromisso = await this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.compromisso.update({
        where: { id },
        data: {
          status: StatusCompromisso.CANCELADO,
          canceladoCategoria: dto.categoria,
          canceladoMotivo: motivo,
          canceladoEm: new Date(),
          canceladoPor: ctx.userId ?? null,
          // Cancelar interrompe o cronômetro: o tempo "em andamento" pararia de
          // fazer sentido num evento que não vai acontecer.
          iniciadoEm: null,
        },
        select: cardSelect,
      });

      // A movimentação que gerou a tarefa não pode ficar presa a ela — ver
      // `dispensarMovimentacaoLigada`. Na mesma transação: cancelar sem
      // dispensar deixaria o ato invisível, e dispensar sem cancelar tiraria o
      // alerta de algo que ainda tem tarefa viva.
      await this.dispensarMovimentacaoLigada(
        tx,
        id,
        `Atividade cancelada — ${rotuloCategoria}${motivo ? `: ${motivo}` : ''}`,
        ctx.userId,
      );
      return atualizado;
    });

    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      `Compromisso CANCELADO: ${atual.titulo} — ${rotuloCategoria}${motivo ? `: ${motivo}` : ''}`,
      ctx,
      { de: atual.status, motivo, categoria: dto.categoria },
    );
    await this.historiar(
      id,
      'CANCELADO',
      `Cancelada — ${rotuloCategoria}.${motivo ? ` ${motivo}` : ''}`,
      ctx,
      { de: atual.status, categoria: dto.categoria, motivo },
    );
    return compromisso;
  }

  /**
   * CANCELAMENTO PELO SISTEMA — o tribunal derrubou a pauta.
   *
   * Quando o DataJud traz "audiência cancelada" (ou uma redesignação, que é uma
   * data nova substituindo a antiga), o compromisso criado pela designação
   * anterior continuava PENDENTE na agenda, com a data velha. O robô só
   * ignorava a movimentação — e o advogado ia ao fórum.
   *
   * Não passa pela rota humana de propósito: não há usuário para atribuir e a
   * categoria é sempre a mesma (decisão externa). Só toca atividades ABERTAS —
   * uma audiência já concluída é história, não se cancela.
   *
   * @returns o id do compromisso cancelado, ou null se não havia o que cancelar.
   */
  async cancelarPorSistema(compromissoId: string, motivo: string): Promise<string | null> {
    const atual = await this.prisma.compromisso.findUnique({
      where: { id: compromissoId },
      select: { id: true, status: true, titulo: true },
    });
    if (!atual) return null;
    if (
      atual.status !== StatusCompromisso.PENDENTE &&
      atual.status !== StatusCompromisso.EM_ANDAMENTO
    ) {
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.compromisso.update({
        where: { id: compromissoId },
        data: {
          status: StatusCompromisso.CANCELADO,
          canceladoCategoria: 'ADIADA_JUIZO',
          canceladoMotivo: motivo,
          canceladoEm: new Date(),
          canceladoPor: null, // sem autor humano — veio do tribunal
          iniciadoEm: null,
        },
      });

      /**
       * A designação que gerou esta pauta também sai do radar.
       *
       * Aqui quem cancelou foi o TRIBUNAL, e a movimentação de designação está
       * carimbada com o compromisso que acaba de cair. Sem dispensá-la, ela
       * ficaria presa a uma tarefa cancelada — sem alerta, sem tarefa viva e
       * sem voltar ao radar. Ver `dispensarMovimentacaoLigada`.
       *
       * `dispensadoPor` nulo, como o `canceladoPor`: não houve pessoa.
       */
      await this.dispensarMovimentacaoLigada(tx, compromissoId, motivo);
    });

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Compromisso',
      entidadeId: compromissoId,
      descricao: `Compromisso CANCELADO pelo sistema (DataJud): ${atual.titulo}`,
      metadata: { motivo, origem: 'DATAJUD' },
    });
    await this.historiar(
      compromissoId,
      'CANCELADO',
      `Cancelada automaticamente — ${motivo}`,
      { nome: 'Sistema (DataJud)' },
      { categoria: 'ADIADA_JUIZO', origem: 'DATAJUD' },
    );
    return compromissoId;
  }

  /**
   * REMARCAR — ação própria, e não "abrir o evento inteiro para edição".
   * Mexe só em data/hora, preserva a duração quando o fim não é informado,
   * trava a data original na 1ª vez e conta quantas remarcações já houve.
   */
  async remarcar(id: string, dto: RemarcarCompromissoDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({
      where: { id },
      select: {
        id: true, status: true, titulo: true, inicio: true, fim: true,
        dataOriginal: true, remarcacoes: true,
      },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');
    if (atual.status === StatusCompromisso.CANCELADO) {
      throw new BadRequestException('Atividade cancelada — reabra antes de remarcar.');
    }
    if (atual.status === StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException('Atividade concluída — reabra antes de remarcar.');
    }

    const inicio = new Date(dto.inicio);
    if (Number.isNaN(inicio.getTime())) throw new BadRequestException('Data inválida.');
    if (inicio.getTime() === atual.inicio.getTime()) {
      throw new BadRequestException('A nova data é igual à atual.');
    }

    // Sem fim informado, preserva a DURAÇÃO — remarcar uma audiência de 1h não
    // pode transformá-la num evento instantâneo.
    const duracao = atual.fim.getTime() - atual.inicio.getTime();
    const fim = dto.fim ? new Date(dto.fim) : new Date(inicio.getTime() + duracao);
    if (fim < inicio) throw new BadRequestException('O fim não pode ser antes do início.');

    const motivo = dto.motivo?.trim() || null;
    const compromisso = await this.prisma.compromisso.update({
      where: { id },
      data: {
        inicio,
        fim,
        // A 1ª data agendada é gravada uma única vez e nunca mais muda.
        ...(atual.dataOriginal ? {} : { dataOriginal: atual.inicio }),
        remarcacoes: { increment: 1 },
        remarcadoMotivo: motivo,
        // Remarcar devolve o evento para PENDENTE: um compromisso que mudou de
        // data não continua "em andamento".
        status: StatusCompromisso.PENDENTE,
        iniciadoEm: null,
      },
      select: cardSelect,
    });

    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      `Compromisso REMARCADO (${atual.remarcacoes + 1}ª vez): ${atual.inicio.toISOString()} → ${inicio.toISOString()}${motivo ? ` — ${motivo}` : ''}`,
      ctx,
      {
        de: atual.inicio.toISOString(),
        para: inicio.toISOString(),
        dataOriginal: (atual.dataOriginal ?? atual.inicio).toISOString(),
        remarcacoes: atual.remarcacoes + 1,
        motivo,
      },
    );
    return compromisso;
  }

  async remover(id: string, ctx: Ctx) {
    const c = await this.prisma.compromisso.findUnique({ where: { id }, select: { id: true, titulo: true } });
    if (!c) throw new NotFoundException('Compromisso não encontrado.');
    await this.prisma.compromisso.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, id, `Compromisso excluído: ${c.titulo}`, ctx, {});
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * CANCELAR UMA TAREFA DO ROBÔ NÃO PODE DEIXAR A MOVIMENTAÇÃO EM LIMBO.
   *
   * O robô carimba `movimentacao.compromissoId` ao criar a tarefa — é a trava
   * de idempotência dele e, ao mesmo tempo, o que faz o selo "Prazo sem tarefa"
   * sair da lista e o radar de audiências parar de cobrar. Excluir a tarefa
   * limpa o carimbo sozinho (a FK é `SetNull`); CANCELAR não limpava nada.
   *
   * O resultado era um limbo silencioso: a movimentação ficava presa a uma
   * tarefa cancelada, sem tarefa viva, sem selo na lista e sem voltar ao radar.
   * O ato desaparecia — e o pior tipo de desaparecimento, o que não deixa
   * sintoma. (Medido em 27/08/2026: nenhum caso ainda. É buraco novo em folha,
   * fechado antes de morder.)
   *
   * POR QUE DISPENSAR, E NÃO SÓ LIMPAR O CARIMBO. Limpar faria o selo voltar
   * amanhã e o robô recriar a tarefa na varredura seguinte — um laço em que
   * cancelar não cancela nada. Dispensar registra o que de fato aconteceu:
   * uma PESSOA decidiu que aquilo não precisa de providência. É auditável
   * (guarda quem e por quê), aparece no radar como dispensado e é REVERSÍVEL
   * (`AudienciasService.restaurar`) — nada fica sem saída.
   *
   * Só vale para tarefa do ROBÔ: uma atividade criada à mão e depois cancelada
   * não tem movimentação para dispensar, e não deve inventar uma.
   */
  private async dispensarMovimentacaoLigada(
    tx: Prisma.TransactionClient,
    compromissoId: string,
    motivo: string,
    userId?: string,
  ) {
    await tx.movimentacaoProcessual.updateMany({
      where: { compromissoId, dispensadoEm: null },
      data: {
        dispensadoEm: new Date(),
        dispensadoPor: userId ?? null,
        dispensadoMotivo: motivo,
      },
    });
  }

  /** Recarrega o cartão (usado quando a ação é um no-op e nada foi escrito). */
  private async cartao(id: string) {
    const c = await this.prisma.compromisso.findUnique({ where: { id }, select: cardSelect });
    if (!c) throw new NotFoundException('Compromisso não encontrado.');
    return c;
  }

  /** Barra transições que não fazem sentido, com mensagem que ensina o caminho. */
  private garantirTransicao(de: StatusCompromisso, para: StatusCompromisso) {
    if (TRANSICOES[de]?.includes(para)) return;
    const rotulo: Record<StatusCompromisso, string> = {
      PENDENTE: 'Pendente',
      EM_ANDAMENTO: 'Em andamento',
      CONCLUIDO: 'Concluído',
      CANCELADO: 'Cancelado',
    };
    throw new BadRequestException(
      `Não é possível mover de "${rotulo[de]}" para "${rotulo[para]}".`,
    );
  }

  /**
   * Confere que o processo escolhido é MESMO do filiado da atividade.
   *
   * A tela já lista só os processos do filiado, mas a rota aceita qualquer id
   * de quem tem o módulo. Sem esta conferência dava para pendurar a consulta do
   * João no processo da Maria — e ninguém notaria, porque o vínculo só aparece
   * quando alguém abre a aba Agenda daquele processo.
   *
   * Processo SEM nenhum filiado vinculado passa: é o caso do rascunho recém-
   * criado e do processo de terceiro que a equipe acompanha.
   */
  private async processoDoFiliado(processoId: string, filiadoId: string | null): Promise<string> {
    const p = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        id: true,
        filiadoId: true,
        partes: { where: { filiadoId: { not: null } }, select: { filiadoId: true } },
      },
    });
    if (!p) throw new BadRequestException('Processo inválido.');
    if (!filiadoId) return p.id;

    const vinculados = new Set(
      [p.filiadoId, ...p.partes.map((x) => x.filiadoId)].filter((v): v is string => !!v),
    );
    if (vinculados.size > 0 && !vinculados.has(filiadoId)) {
      throw new BadRequestException(
        'Este processo não é do filiado desta atividade. Escolha um processo dele ou use "Virou processo novo".',
      );
    }
    return p.id;
  }

  /**
   * Slug de tipo que pode ser usado agora. Um tipo desativado (o catálogo de
   * desfechos aponta para ele, mas o Administrador o ocultou) não pode impedir
   * a conclusão — a atividade cai no tipo genérico e o histórico diz que caiu.
   */
  private async tipoUsavel(slug: string): Promise<string> {
    const tipo = await this.prisma.tipoCompromisso.findUnique({
      where: { slug },
      select: { ativo: true },
    });
    if (tipo?.ativo) return slug;
    this.logger.warn(`Tipo "${slug}" indisponível para seguimento — usando COMPROMISSO.`);
    return 'COMPROMISSO';
  }

  /**
   * Abre um CASO PRÉ-PROCESSUAL a partir do desfecho da atividade.
   *
   * O caso nasce SEM NPU de propósito: a consulta acabou de acontecer e nada foi
   * distribuído ainda. Ele fica na ABA PRÉ-PROCESSUAIS do módulo de Processos —
   * fora da lista padrão, que é a fila do que já corre em juízo — com o selo
   * `SeloPreProcessual` e o botão "Ajuizar", que pede o número e puxa do DataJud
   * ou deixa preencher à mão. Enquanto estiver nesta fase fica fora da varredura
   * noturna do CNJ, porque não há o que consultar.
   *
   * Herda o filiado e o advogado da atividade, para o caso já nascer na carteira
   * certa em vez de virar um registro solto que alguém precisa adotar.
   */
  private async criarPreProcessual(
    compromissoId: string,
    atividade: {
      titulo: string;
      descricao: string | null;
      filiadoId: string | null;
      responsavelId: string;
      atendimentoId: string | null;
      urgente?: boolean;
      urgenteMotivo?: string | null;
    },
    dto: ConcluirCompromissoDto,
    ctx: Ctx,
  ): Promise<{ id: string; titulo: string | null }> {
    const nova = dto.novoProcesso ?? {};
    const advogadoId = nova.advogadoId || atividade.responsavelId;

    if (nova.advogadoId) {
      const u = await this.prisma.user.findUnique({
        where: { id: nova.advogadoId },
        select: { id: true },
      });
      if (!u) throw new BadRequestException('Advogado inválido para o caso.');
    }
    // A EQUIPE DA ATIVIDADE VAI JUNTO por padrão. Quem conduziu a consulta a
    // dois continua a dois no caso — obrigar a remontar a equipe na tela
    // seguinte é o tipo de retrabalho que faz a informação se perder.
    const equipeCaso = await this.equipeParaOCaso(compromissoId, advogadoId, nova.advogadosIds);

    const titulo = nova.titulo?.trim() || atividade.titulo;
    const observacao = nova.observacao?.trim() || dto.desfechoObs?.trim() || atividade.descricao;
    // Validada contra o catálogo — aceitar texto livre aqui reproduziria o
    // defeito da etiqueta "Urgente", que virou quatro grafias e nenhum filtro.
    let categoria: string | null;
    try {
      categoria = normalizarCategoria(nova.categoria);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const processo = await this.prisma.$transaction(async (tx) => {
      const p = await tx.processo.create({
        data: {
          numeroCNJ: null, // ainda não ajuizado — é o que define o pré-processual
          titulo,
          assuntoPrincipal: nova.assunto?.trim() || null,
          categoria,
          statusInterno: StatusProcesso.PRE_PROCESSUAL,
          filiadoId: atividade.filiadoId,
          /**
           * SOLICITADO POR — o filiado que estava vinculado à atividade.
           *
           * É o que responde "de onde isto veio" numa tela onde `filiadoId`
           * pode mudar (o polo ativo vira litisconsórcio, ou a ação vira
           * institucional e deixa de ter filiado parte). O pedido nasceu de uma
           * pessoa, e essa pessoa não muda depois.
           */
          solicitadoPorId: atividade.filiadoId,
          advogadoId,
          origemCompromissoId: compromissoId,
          // A URGÊNCIA ATRAVESSA. Uma consulta marcada como urgente que vira
          // caso e chega ao advogado sem a marca perdeu no caminho justamente a
          // informação que fazia alguém correr.
          ...(atividade.urgente
            ? {
                urgente: true,
                urgenteMotivo:
                  atividade.urgenteMotivo ??
                  `Herdado da atividade urgente "${atividade.titulo}".`,
                urgenteEm: new Date(),
                urgentePor: ctx.userId ?? null,
              }
            : {}),
        },
        select: { id: true, titulo: true },
      });

      // O filiado da consulta entra como parte do polo ativo — o rascunho já
      // nasce sabendo quem é o autor.
      if (atividade.filiadoId) {
        const f = await tx.filiado.findUnique({
          where: { id: atividade.filiadoId },
          select: { nomeCompleto: true, cpf: true },
        });
        if (f) {
          await tx.parteProcesso.create({
            data: {
              processoId: p.id,
              polo: 'ATIVO',
              papel: 'Autor',
              principal: true,
              nome: f.nomeCompleto,
              documento: (f.cpf ?? '').replace(/\D/g, '') || null,
              filiadoId: atividade.filiadoId,
            },
          });
        }
      }
      // A equipe inteira, com o responsável marcado.
      for (const id of equipeCaso) {
        await tx.processoAdvogado.create({
          data: { processoId: p.id, advogadoId: id, principal: id === advogadoId },
        });
      }

      // A conversa que originou o processo vira o 1º andamento interno — sem
      // isso o advogado abriria o rascunho sem saber o que foi combinado.
      if (observacao) {
        await tx.movimentacaoInterna.create({
          data: {
            processoId: p.id,
            tipo: 'ATUALIZACAO',
            descricao: observacao,
            autorId: ctx.userId ?? null,
          },
        });
      }

      // A triagem de origem passa a apontar para o processo criado.
      if (atividade.atendimentoId) {
        await tx.atendimento.update({
          where: { id: atividade.atendimentoId },
          data: { processoId: p.id },
        });
      }
      return p;
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'Processo',
      entidadeId: processo.id,
      descricao: `Caso aberto em fase PRÉ-PROCESSUAL a partir da atividade "${atividade.titulo}"`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { compromissoId, rascunho: true },
    });
    return processo;
  }

  /**
   * Quem vai atuar no caso: a equipe da atividade, mais quem a tela acrescentou.
   *
   * A equipe da ATIVIDADE é o padrão porque foi ela que conduziu a consulta —
   * refazer a lista na tela seguinte é retrabalho, e retrabalho não feito vira
   * caso com um advogado só quando dois trabalharam nele.
   */
  private async equipeParaOCaso(
    compromissoId: string,
    responsavelId: string,
    extras?: string[],
  ): Promise<string[]> {
    const daAtividade = await this.prisma.compromissoResponsavel.findMany({
      where: { compromissoId },
      select: { usuarioId: true },
    });
    const ids = new Set<string>([responsavelId]);
    for (const e of daAtividade) ids.add(e.usuarioId);
    for (const e of extras ?? []) if (e?.trim()) ids.add(e.trim());
    // Só quem ainda está ativo — um advogado desligado não deve ser herdado
    // para um caso que está começando agora.
    const ativos = await this.prisma.user.findMany({
      where: { id: { in: [...ids] }, ativo: true },
      select: { id: true },
    });
    const validos = ativos.map((u) => u.id);
    // O responsável entra de qualquer forma: ele já foi validado acima e é a
    // FK que o caso exige.
    return validos.includes(responsavelId) ? validos : [responsavelId, ...validos];
  }

  private async validarVinculos(responsavelId?: string, filiadoId?: string, atendimentoId?: string, processoId?: string) {
    if (responsavelId) {
      const u = await this.prisma.user.findUnique({ where: { id: responsavelId }, select: { id: true } });
      if (!u) throw new BadRequestException('Responsável inválido.');
    }
    if (filiadoId) {
      const f = await this.prisma.filiado.findUnique({ where: { id: filiadoId }, select: { id: true } });
      if (!f) throw new BadRequestException('Filiado inválido.');
    }
    if (atendimentoId) {
      const a = await this.prisma.atendimento.findUnique({ where: { id: atendimentoId }, select: { id: true } });
      if (!a) throw new BadRequestException('Atendimento inválido.');
    }
    if (processoId) {
      const p = await this.prisma.processo.findUnique({ where: { id: processoId }, select: { id: true } });
      if (!p) throw new BadRequestException('Processo inválido.');
    }
  }

  /**
   * Linha do tempo da atividade — o que a tela de detalhe mostra.
   *
   * Separada da Auditoria global de propósito: aquela é técnica e do sistema
   * inteiro; esta é a narrativa de UM compromisso, escrita para ser lida.
   * Nunca derruba a operação: um histórico que falha não pode impedir que a
   * atividade seja concluída.
   */
  private async historiar(
    compromissoId: string,
    acao: string,
    descricao: string,
    ctx: Ctx,
    metadata?: Prisma.InputJsonValue,
  ) {
    try {
      await this.prisma.compromissoHistorico.create({
        data: {
          compromissoId,
          acao,
          descricao,
          autorId: ctx.userId ?? null,
          autorNome: ctx.nome ?? null,
          metadata,
        },
      });
    } catch (e) {
      this.logger.warn(`Falha ao registrar histórico do compromisso ${compromissoId}: ${e}`);
    }
  }

  /** Histórico de uma atividade, do mais recente para o mais antigo. */
  listarHistorico(compromissoId: string) {
    return this.prisma.compromissoHistorico.findMany({
      where: { compromissoId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, acao: true, descricao: true, autorNome: true,
        metadata: true, createdAt: true,
        // Sem foto de propósito: o histórico mostra só o nome de quem agiu, e
        // selecionar a chave do storage aqui era só vazá-la para o cliente.
        autor: { select: { nomeExibicao: true, nome: true } },
      },
    });
  }

  private auditar(acao: AcaoAuditoria, entidadeId: string, descricao: string, ctx: Ctx, metadata: Prisma.InputJsonValue) {
    return this.audit.registrar({
      userId: ctx.userId ?? null,
      acao,
      entidade: 'Compromisso',
      entidadeId,
      descricao,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata,
    });
  }
}
