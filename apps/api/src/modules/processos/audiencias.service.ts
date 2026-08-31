import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusCompromisso, StatusProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AgendaService } from '../agenda/agenda.service';
import { AutomacaoPrazosService } from './automacao-prazos.service';
import { AgendarAudienciaDto } from './dto/audiencias.dto';
import { classificarAudiencia, classificarMovimentacao } from './utils/audiencia.util';
import { diaBR, inicioDoDiaBR } from './utils/data-br.util';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/** Slugs de tipo de evento usados pelo radar (semeados na migração dos tipos). */
const TIPO_AUDIENCIA = 'AUDIENCIA';
/**
 * Perícia divide a fila com a audiência (também é pauta a confirmar), mas NÃO
 * o tipo: uma perícia agendada como audiência oferecia "houve acordo" na hora
 * de concluir, em vez de "laudo entregue".
 */
const TIPO_PERICIA = 'PERICIA';
const TIPOS_PAUTA = [TIPO_AUDIENCIA, TIPO_PERICIA];

/** Janela do item 1 da regra: movimentações dos últimos 30 dias continuam válidas. */
const JANELA_MOVIMENTACAO_DIAS = 30;

const DIA_MS = 24 * 3_600_000;

const alertaSelect = {
  id: true,
  descricao: true,
  dataMovimento: true,
  codigoMovimento: true,
  audienciaData: true,
  processo: {
    select: {
      id: true,
      numeroCNJ: true,
      classeProcessual: true,
      orgaoJulgador: true,
      tribunal: true,
      filiado: { select: { id: true, nomeCompleto: true } },
      advogado: { select: { id: true, nome: true } },
    },
  },
} satisfies Prisma.MovimentacaoProcessualSelect;

type AlertaBruto = Prisma.MovimentacaoProcessualGetPayload<{ select: typeof alertaSelect }>;

/**
 * Radar de "Audiências a Agendar".
 *
 * Cruza as movimentações do DataJud já classificadas como designação de pauta
 * (ver utils/audiencia.util.ts) com a Agenda: o que ainda não virou compromisso
 * e não foi dispensado aparece como alerta acionável.
 */
@Injectable()
export class AudienciasService {
  private readonly logger = new Logger(AudienciasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly agenda: AgendaService,
    private readonly automacao: AutomacaoPrazosService,
  ) {}

  // -------------------------------------------------------------------------
  // Consulta
  // -------------------------------------------------------------------------

  /**
   * Filtro do alerta (as três regras que sustentam o radar):
   *  1. é designação de audiência (classificador TPU + texto);
   *  2. ainda está em aberto — sem evento na agenda e sem dispensa;
   *  3. está VIGENTE: a audiência é de hoje em diante OU a movimentação chegou
   *     nos últimos 30 dias. Isso é o que descarta publicação velha (2025) que
   *     antes poluía o painel.
   */
  private where(advogadoId?: string): Prisma.MovimentacaoProcessualWhereInput {
    const hoje = inicioDoDiaBR();
    const limiteMovimentacao = new Date(Date.now() - JANELA_MOVIMENTACAO_DIAS * DIA_MS);

    return {
      ehAudiencia: true,
      dispensadoEm: null,
      compromissoId: null,
      processo: {
        statusInterno: StatusProcesso.ATIVO,
        ...(advogadoId ? { advogadoId } : {}),
      },
      OR: [
        { audienciaData: { gte: hoje } },
        { dataMovimento: { gte: limiteMovimentacao } },
      ],
    };
  }

  /** Quantidade de audiências pendentes de agendamento (KPI/cron). */
  contarPendentes(advogadoId?: string): Promise<number> {
    return this.prisma.movimentacaoProcessual.count({ where: this.where(advogadoId) });
  }

  /** Lista os alertas abertos, do mais urgente (audiência mais próxima) ao resto. */
  async listar(opcoes: { advogadoId?: string; limite?: number } = {}) {
    const limite = Math.min(100, Math.max(1, opcoes.limite ?? 20));
    const where = this.where(opcoes.advogadoId);

    const [total, brutos] = await this.prisma.$transaction([
      this.prisma.movimentacaoProcessual.count({ where }),
      this.prisma.movimentacaoProcessual.findMany({
        where,
        // Audiência com data conhecida vem primeiro (é o que tem prazo correndo);
        // as sem data caem no fim, ordenadas pela movimentação mais recente.
        orderBy: [
          { audienciaData: { sort: 'asc', nulls: 'last' } },
          { dataMovimento: 'desc' },
        ],
        take: limite,
        select: alertaSelect,
      }),
    ]);

    return { total, items: await this.montar(brutos) };
  }

  /**
   * Enriquece os alertas com o que a tela precisa para decidir sem abrir o
   * processo — inclusive o aviso de POSSÍVEL DUPLICIDADE: já existe evento de
   * audiência no mesmo processo e no mesmo dia (agendado à mão, antes do radar).
   */
  private async montar(brutos: AlertaBruto[]) {
    const comData = brutos.filter((m) => m.audienciaData);
    const eventos = comData.length
      ? await this.prisma.compromisso.findMany({
          where: {
            processoId: { in: [...new Set(comData.map((m) => m.processo.id))] },
            tipo: { in: TIPOS_PAUTA },
            status: { not: StatusCompromisso.CANCELADO },
          },
          select: { id: true, processoId: true, inicio: true, titulo: true },
        })
      : [];

    const agora = Date.now();
    const hoje = inicioDoDiaBR().getTime();

    return brutos.map((m) => {
      const data = m.audienciaData;
      const duplicado = data
        ? eventos.find((e) => e.processoId === m.processo.id && diaBR(e.inicio) === diaBR(data))
        : undefined;

      return {
        id: m.id,
        descricao: m.descricao,
        dataMovimento: m.dataMovimento,
        codigoMovimento: m.codigoMovimento,
        audienciaData: data,
        /** Sem hora no texto → o classificador grava meia-noite (BRT). */
        horaDefinida: !!data && data.getTime() !== inicioDoDiaBR(data).getTime(),
        /** Data designada já passou — chegou tarde, exige conferência. */
        dataNoPassado: !!data && data.getTime() < hoje,
        /** Dias até a audiência (negativo = já passou; null = sem data no texto). */
        diasAteAudiencia: data ? Math.ceil((data.getTime() - agora) / DIA_MS) : null,
        processo: m.processo,
        eventoExistente: duplicado
          ? { id: duplicado.id, titulo: duplicado.titulo, inicio: duplicado.inicio }
          : null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Ações
  // -------------------------------------------------------------------------

  /**
   * "Dispensar": grava a decisão NO BANCO (não no navegador). A varredura
   * noturna nunca reabre o alerta — a movimentação já existe localmente e a
   * sincronização só insere movimentações ausentes, sem tocar nesta coluna.
   */
  async dispensar(id: string, motivo: string | undefined, ctx: Ctx) {
    const mov = await this.carregar(id);
    if (mov.dispensadoEm) {
      throw new ConflictException('Este alerta já foi dispensado.');
    }
    if (mov.compromissoId) {
      throw new ConflictException('Esta audiência já foi agendada — não há alerta para dispensar.');
    }

    await this.prisma.movimentacaoProcessual.update({
      where: { id },
      data: {
        dispensadoEm: new Date(),
        dispensadoPor: ctx.userId ?? null,
        dispensadoMotivo: motivo?.trim() || null,
      },
    });

    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      `Alerta de audiência dispensado (processo ${mov.processo.numeroCNJ})`,
      ctx,
      { numeroCNJ: mov.processo.numeroCNJ, motivo: motivo?.trim() || null, descricao: mov.descricao },
    );
    return { ok: true, dispensado: true };
  }

  /** Desfaz a dispensa (o alerta volta a aparecer se ainda estiver vigente). */
  async restaurar(id: string, ctx: Ctx) {
    const mov = await this.carregar(id);
    if (!mov.dispensadoEm) throw new ConflictException('Este alerta não está dispensado.');

    await this.prisma.movimentacaoProcessual.update({
      where: { id },
      data: { dispensadoEm: null, dispensadoPor: null, dispensadoMotivo: null },
    });
    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      `Alerta de audiência restaurado (processo ${mov.processo.numeroCNJ})`,
      ctx,
      { numeroCNJ: mov.processo.numeroCNJ },
    );
    return { ok: true, dispensado: false };
  }

  /**
   * Cria o evento na Agenda e amarra o alerta a ele — numa única chamada, para
   * não existir estado intermediário em que o evento foi criado e o alerta
   * continua pendente (ou vice-versa).
   */
  async agendar(id: string, dto: AgendarAudienciaDto, ctx: Ctx) {
    const mov = await this.carregar(id);
    if (mov.compromissoId) throw new ConflictException('Esta audiência já foi agendada.');

    const inicio = new Date(dto.inicio);
    const fim = dto.fim ? new Date(dto.fim) : new Date(inicio.getTime() + 3_600_000);
    const classe = mov.processo.classeProcessual?.trim();

    // O tipo sai do classificador, não de uma constante: o radar acumula
    // audiência E perícia, e cada uma tem os seus desfechos.
    const gatilho = classificarMovimentacao(mov.descricao, mov.codigoMovimento);
    const ehPericia = gatilho.tipo === 'PERICIA';
    const rotulo = ehPericia ? 'Perícia' : 'Audiência';

    const compromisso = await this.agenda.criar(
      {
        titulo: dto.titulo?.trim() || `${rotulo} — ${classe || mov.processo.numeroCNJ}`,
        tipo: ehPericia ? TIPO_PERICIA : TIPO_AUDIENCIA,
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
        local: dto.local?.trim() || mov.processo.orgaoJulgador || undefined,
        // A descrição carrega o texto do DataJud: o advogado vê no evento
        // exatamente o que o tribunal publicou.
        descricao: `[DataJud] ${mov.descricao}`,
        observacoesInternas: dto.observacoesInternas?.trim() || undefined,
        // A urgência segue com o MOTIVO. `AgendaService.criar` exige um de quem
        // marca — mandar a marca sozinha é o que fazia isto voltar 400.
        urgente: dto.urgente ?? false,
        urgenteMotivo: dto.urgenteMotivo?.trim() || undefined,
        responsavelId: dto.responsavelId,
        filiadoId: mov.processo.filiado?.id || undefined,
        processoId: mov.processo.id,
      },
      ctx,
    );

    await this.prisma.movimentacaoProcessual.update({
      where: { id },
      data: { compromissoId: compromisso.id, dispensadoEm: null, dispensadoPor: null, dispensadoMotivo: null },
    });

    /**
     * O LEMBRETE QUE MANDAVA FAZER ISTO SAI DA FILA.
     *
     * "Confirmar data da audiência designada" e este radar cobrem o mesmo
     * trabalho em duas telas — o robô cria a tarefa para quem vive na Agenda, o
     * radar atende quem vive em Processos. Faltava fechar o circuito: agendar
     * por aqui resolvia o problema e deixava a tarefa aberta cobrando para
     * sempre, e (depois da escalada por tempo cego) ela ainda viraria urgente
     * quinze dias depois, por um trabalho já feito.
     */
    await this.automacao.fecharConfirmacaoDeData(
      mov.processo.id,
      `${rotulo} agendada para ${inicio.toLocaleString('pt-BR')} a partir do radar.`,
    );

    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      `Audiência agendada a partir do DataJud (processo ${mov.processo.numeroCNJ})`,
      ctx,
      { numeroCNJ: mov.processo.numeroCNJ, compromissoId: compromisso.id, inicio: inicio.toISOString() },
    );
    return compromisso;
  }

  // -------------------------------------------------------------------------
  // Manutenção
  // -------------------------------------------------------------------------

  /**
   * Reaplica o classificador sobre TODO o histórico local — é o caminho para
   * ampliar a lista de códigos TPU sem migração e sem re-importar processos.
   * Nunca mexe em dispensa nem em vínculo com a agenda (decisões humanas).
   */
  async reclassificar(ctx: Ctx) {
    const LOTE = 1000;
    let cursor: string | undefined;
    let lidas = 0;
    let alteradas = 0;

    for (;;) {
      const pagina = await this.prisma.movimentacaoProcessual.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: LOTE,
        orderBy: { id: 'asc' },
        select: {
          id: true, descricao: true, detalhe: true, codigoMovimento: true, dataMovimento: true,
          complementos: true, ehAudiencia: true, audienciaData: true,
        },
      });
      if (!pagina.length) break;

      for (const m of pagina) {
        // Mesma entrada do momento da gravação (`paraLinha`): texto completo e
        // complementos. Reclassificar com menos informação faria a varredura
        // DESMARCAR audiências que a sincronização tinha marcado certo.
        const textoCompleto = [m.descricao, m.detalhe].filter(Boolean).join(' — ');
        const novo = classificarAudiencia(
          textoCompleto,
          m.codigoMovimento,
          m.dataMovimento,
          m.complementos as { descricao?: string | null; nome?: string | null }[] | null,
        );
        const mudouFlag = novo.ehAudiencia !== m.ehAudiencia;
        const mudouData =
          (novo.audienciaData?.getTime() ?? null) !== (m.audienciaData?.getTime() ?? null);
        if (mudouFlag || mudouData) {
          await this.prisma.movimentacaoProcessual.update({
            where: { id: m.id },
            data: { ehAudiencia: novo.ehAudiencia, audienciaData: novo.audienciaData },
          });
          alteradas++;
        }
      }

      lidas += pagina.length;
      cursor = pagina[pagina.length - 1].id;
      if (pagina.length < LOTE) break;
    }

    this.logger.log(`[RADAR-AUDIENCIAS] Reclassificação: ${lidas} movimentação(ões) lidas, ${alteradas} atualizada(s).`);
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'MovimentacaoProcessual',
      entidadeId: 'reclassificacao-audiencias',
      descricao: `Radar de audiências reclassificado: ${alteradas} de ${lidas} movimentação(ões) atualizadas`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { lidas, alteradas },
    });
    return { lidas, alteradas };
  }

  // -------------------------------------------------------------------------

  private async carregar(id: string) {
    const mov = await this.prisma.movimentacaoProcessual.findUnique({
      where: { id },
      select: {
        id: true,
        descricao: true,
        codigoMovimento: true,
        ehAudiencia: true,
        dispensadoEm: true,
        compromissoId: true,
        processo: {
          select: {
            id: true,
            numeroCNJ: true,
            classeProcessual: true,
            orgaoJulgador: true,
            filiado: { select: { id: true } },
          },
        },
      },
    });
    if (!mov) throw new NotFoundException('Movimentação não encontrada.');
    if (!mov.ehAudiencia) {
      throw new ConflictException('Esta movimentação não é uma designação de audiência.');
    }
    return mov;
  }

  private auditar(
    acao: AcaoAuditoria,
    entidadeId: string,
    descricao: string,
    ctx: Ctx,
    metadata: Prisma.InputJsonValue,
  ) {
    return this.audit.registrar({
      userId: ctx.userId ?? null,
      acao,
      entidade: 'MovimentacaoProcessual',
      entidadeId,
      descricao,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata,
    });
  }
}
