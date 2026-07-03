import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria,
  ColoniaTemporada,
  FormacaoColonia,
  OrigemReserva,
  Prisma,
  StatusReserva,
  StatusSorteioInscricao,
  StatusTemporada,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  AlocacaoManualDto,
  CheckoutDto,
  CreateReservaDiretaDto,
  EntrarSorteioDto,
} from './dto/colonia.dto';

type Tx = Prisma.TransactionClient;

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

@Injectable()
export class ColoniaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /** Temporada ATIVA (controle de acesso público). 403 se não houver. */
  private async temporadaAtiva(db: Tx | PrismaService = this.prisma): Promise<ColoniaTemporada> {
    const t = await db.coloniaTemporada.findFirst({
      where: { status: StatusTemporada.ATIVA },
      orderBy: { createdAt: 'desc' },
    });
    if (!t) throw new ForbiddenException('As reservas estão encerradas');
    return t;
  }

  /**
   * Campanha por slug (link público). Exige que exista E esteja ATIVA — usado
   * no checkout público para blindar reservas em campanhas encerradas/inexistentes.
   */
  private async temporadaAtivaPorSlug(
    slug: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<ColoniaTemporada> {
    const t = await db.coloniaTemporada.findUnique({ where: { slug } });
    if (!t) throw new NotFoundException('Campanha não encontrada.');
    if (t.status !== StatusTemporada.ATIVA)
      throw new ForbiddenException('As reservas desta campanha estão encerradas.');
    return t;
  }

  /** Lock pessimista por chave (liberado no fim da transação). */
  private async lock(tx: Tx, chave: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`;
  }

  /**
   * Trava de CPF: no máx. 1 reserva CONFIRMADA OU 1 inscrição INSCRITO por
   * temporada. Verificado dentro da transação (os índices únicos parciais são
   * o backstop final).
   */
  private async garantirCpfLivre(tx: Tx, temporadaId: string, cpf: string): Promise<void> {
    const reserva = await tx.coloniaReserva.findFirst({
      where: { temporadaId, cpf, status: StatusReserva.CONFIRMADA },
      select: { id: true },
    });
    if (reserva) throw new ConflictException('Este CPF já possui uma reserva ativa nesta temporada.');
    const inscricao = await tx.coloniaSorteioInscricao.findFirst({
      where: { temporadaId, cpf, status: StatusSorteioInscricao.INSCRITO },
      select: { id: true },
    });
    if (inscricao) throw new ConflictException('Este CPF já está na fila de sorteio desta temporada.');
  }

  private validarConsentimento(dto: CheckoutDto): void {
    if (!dto.aceiteTermoNoShow)
      throw new BadRequestException('É necessário aceitar o Termo de No-Show.');
    if (!dto.consentimentoLgpd)
      throw new BadRequestException('É necessário o consentimento de tratamento de dados (LGPD).');
  }

  private dadosCheckout(dto: CheckoutDto, ctx: Ctx) {
    return {
      nomeCompleto: dto.nomeCompleto.trim(),
      cpf: dto.cpf.replace(/\D/g, ''),
      telefone: dto.telefone,
      coren: dto.coren,
      email: dto.email,
      formacao: dto.formacao as FormacaoColonia,
      localTrabalho1: dto.localTrabalho1,
      localTrabalho2: dto.localTrabalho2,
      cidade: dto.cidade,
      estado: dto.estado,
      aceiteTermoNoShow: dto.aceiteTermoNoShow,
      termoVersao: dto.termoVersao,
      consentimentoLgpd: dto.consentimentoLgpd,
      consentimentoEm: new Date(),
    };
  }

  /** Auditoria de toda TENTATIVA de reserva (Marco Civil: data/hora + IP). */
  private async auditar(
    acao: AcaoAuditoria,
    descricao: string,
    ctx: Ctx,
    metadata: Prisma.InputJsonValue,
  ) {
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao,
      entidade: 'ColoniaReserva',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      descricao,
      metadata,
    });
  }

  /** Converte erros de banco em exceções HTTP claras. */
  private traduzir(e: unknown): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002')
        return new ConflictException(
          'A vaga acabou de ser ocupada por outra pessoa (ou já existe registro ativo para este CPF). Tente novamente.',
        );
      if (e.code === 'P2034')
        return new ConflictException('Conflito de concorrência. Tente novamente.');
    }
    return e as Error;
  }

  // ==========================================================================
  // Público — disponibilidade
  // ==========================================================================

  async disponibilidade(slug?: string) {
    // Se um slug for informado, a vitrine é a daquela campanha (deve estar ATIVA);
    // senão, a campanha ativa corrente.
    const temporada = slug
      ? await this.temporadaAtivaPorSlug(slug)
      : await this.temporadaAtiva();
    // Quartos agora são POR LOTE (6 por lote) — trazidos junto de cada lote.
    const lotes = await this.prisma.coloniaLote.findMany({
      where: { temporadaId: temporada.id },
      orderBy: { numero: 'asc' },
      include: { quartos: { where: { ativo: true }, orderBy: { numero: 'asc' } } },
    });
    const reservas = await this.prisma.coloniaReserva.findMany({
      where: { temporadaId: temporada.id, status: StatusReserva.CONFIRMADA },
      select: { loteId: true, quartoId: true, alocacaoManual: true, quarto: { select: { numero: true, modoReserva: true } } },
    });

    const data = lotes.map((lote) => {
      const doLote = reservas.filter((r) => r.loteId === lote.id);
      const ocupados = new Set(doLote.map((r) => r.quartoId));
      const q6Ocupado = doLote.some((r) => r.quarto.numero === 6);
      const q6Manual = doLote.some((r) => r.quarto.numero === 6 && r.alocacaoManual);

      const quartosLote = lote.quartos.map((q) => ({
        id: q.id,
        numero: q.numero,
        climatizacao: q.climatizacao,
        modoReserva: q.modoReserva,
        disponivel: q.modoReserva === 'RESERVA_DIRETA' && !ocupados.has(q.id),
      }));
      const arDisponivel = quartosLote.some((q) => q.climatizacao === 'AR_CONDICIONADO' && q.disponivel);
      const ventiladorDiretoDisponivel = quartosLote.some((q) => q.climatizacao === 'VENTILADOR' && q.modoReserva === 'RESERVA_DIRETA' && q.disponivel);
      const diretasDisponiveis = quartosLote.filter((q) => q.disponivel).length;

      return {
        lote: { id: lote.id, numero: lote.numero, dataInicio: lote.dataInicio, dataFim: lote.dataFim },
        quartos: quartosLote,
        arDisponivel,
        ventiladorDiretoDisponivel,
        // Sorteio abre quando os 5 diretos esgotam E o quarto 6 está livre.
        sorteioHabilitado: diretasDisponiveis === 0 && !q6Ocupado,
        // Esgotado: diretos cheios e quarto 6 ocupado (inclui bypass por alocação manual).
        esgotado: diretasDisponiveis === 0 && q6Ocupado,
        quarto6AlocadoManualmente: q6Manual,
      };
    });

    return {
      temporada: { id: temporada.id, nome: temporada.nome, ano: temporada.ano, slug: temporada.slug },
      lotes: data,
    };
  }

  // ==========================================================================
  // Público — reserva direta (atômica)
  // ==========================================================================

  async criarReservaDireta(dto: CreateReservaDiretaDto, ctx: Ctx) {
    this.validarConsentimento(dto);
    const cpf = dto.cpf.replace(/\D/g, '');
    try {
      const reserva = await this.prisma.$transaction(async (tx) => {
        // Campanha precisa existir e estar ATIVA (validação do slug).
        const temporada = await this.temporadaAtivaPorSlug(dto.slug, tx);
        // Serializa concorrentes para ESTA vaga (lote+quarto)
        await this.lock(tx, `reserva:${dto.loteId}:${dto.quartoId}`);

        const lote = await tx.coloniaLote.findFirst({ where: { id: dto.loteId, temporadaId: temporada.id } });
        if (!lote) throw new NotFoundException('Lote não encontrado nesta temporada.');
        const quarto = await tx.coloniaQuarto.findUnique({ where: { id: dto.quartoId } });
        if (!quarto || !quarto.ativo) throw new NotFoundException('Quarto não encontrado.');
        if (quarto.loteId !== dto.loteId)
          throw new BadRequestException('Este quarto não pertence ao lote informado.');
        if (quarto.modoReserva !== 'RESERVA_DIRETA')
          throw new BadRequestException('Este quarto só é liberado por sorteio ou alocação manual.');

        await this.garantirCpfLivre(tx, temporada.id, cpf);

        const jaOcupado = await tx.coloniaReserva.findFirst({
          where: { loteId: dto.loteId, quartoId: dto.quartoId, status: StatusReserva.CONFIRMADA },
          select: { id: true },
        });
        if (jaOcupado) throw new ConflictException('Este quarto já está reservado para este lote.');

        return tx.coloniaReserva.create({
          data: {
            temporadaId: temporada.id,
            loteId: dto.loteId,
            quartoId: dto.quartoId,
            origem: OrigemReserva.RESERVA_DIRETA,
            ...this.dadosCheckout(dto, ctx),
            ipConsentimento: ctx.ip,
          },
        });
      });

      // Marco Civil (Lei 12.965/2014): registro de data/hora + IP da requisição.
      await this.auditar(AcaoAuditoria.CREATE, `Reserva direta CONFIRMADA (lote ${dto.loteId})`, ctx, {
        ok: true, reservaId: reserva.id, loteId: dto.loteId, quartoId: dto.quartoId, cpf,
        ip: ctx.ip, em: new Date().toISOString(), marcoCivil: 'Lei 12.965/2014',
      });
      return reserva;
    } catch (e) {
      const err = this.traduzir(e);
      await this.auditar(AcaoAuditoria.CREATE, `Reserva direta NEGADA: ${err.message}`, ctx, {
        ok: false, loteId: dto.loteId, quartoId: dto.quartoId, cpf,
      });
      throw err;
    }
  }

  // ==========================================================================
  // Público — fila de sorteio (quarto 6)
  // ==========================================================================

  /**
   * Sorteio só abre se os 5 quartos diretos estão 100% ocupados E o quarto 6
   * está livre (não alocado manualmente pela diretoria nem já sorteado).
   */
  private async sorteioHabilitado(tx: Tx, loteId: string): Promise<boolean> {
    // Quartos de reserva direta ATIVOS do lote (regra fixa: 3 ar-condicionado + 2 ventilador = 5).
    const diretos = await tx.coloniaQuarto.findMany({
      where: { loteId, ativo: true, modoReserva: 'RESERVA_DIRETA' },
      select: { id: true },
    });
    if (diretos.length === 0) return false;

    const diretosOcupados = await tx.coloniaReserva.count({
      where: {
        loteId,
        status: StatusReserva.CONFIRMADA,
        quartoId: { in: diretos.map((d) => d.id) },
      },
    });

    // O 6º quarto (ventilador) precisa estar LIVRE. Qualquer reserva confirmada nele
    // fecha a fila — inclusive a alocação manual da diretoria (alocacao_manual_diretoria = true).
    const q6Ocupado = await tx.coloniaReserva.findFirst({
      where: { loteId, status: StatusReserva.CONFIRMADA, quarto: { numero: 6 } },
      select: { id: true },
    });

    return diretosOcupados >= diretos.length && !q6Ocupado;
  }

  async entrarNoSorteio(dto: EntrarSorteioDto, ctx: Ctx) {
    this.validarConsentimento(dto);
    const cpf = dto.cpf.replace(/\D/g, '');
    try {
      const inscricao = await this.prisma.$transaction(async (tx) => {
        // Campanha precisa existir e estar ATIVA (validação do slug).
        const temporada = await this.temporadaAtivaPorSlug(dto.slug, tx);
        await this.lock(tx, `sorteio:${dto.loteId}`);

        const lote = await tx.coloniaLote.findFirst({ where: { id: dto.loteId, temporadaId: temporada.id } });
        if (!lote) throw new NotFoundException('Lote não encontrado nesta temporada.');
        if (!(await this.sorteioHabilitado(tx, dto.loteId)))
          throw new BadRequestException(
            'A fila de sorteio ainda não está aberta: os 5 quartos de reserva direta precisam estar ocupados e o quarto 6 não pode estar alocado manualmente.',
          );

        await this.garantirCpfLivre(tx, temporada.id, cpf);

        return tx.coloniaSorteioInscricao.create({
          data: {
            temporadaId: temporada.id,
            loteId: dto.loteId,
            ...this.dadosCheckout(dto, ctx),
            ipInscricao: ctx.ip,
          },
        });
      });

      // Marco Civil (Lei 12.965/2014): registro de data/hora + IP da requisição.
      await this.auditar(AcaoAuditoria.CREATE, `Inscrição no sorteio (lote ${dto.loteId})`, ctx, {
        ok: true, inscricaoId: inscricao.id, loteId: dto.loteId, cpf,
        ip: ctx.ip, em: new Date().toISOString(), marcoCivil: 'Lei 12.965/2014',
      });
      return inscricao;
    } catch (e) {
      const err = this.traduzir(e);
      await this.auditar(AcaoAuditoria.CREATE, `Inscrição no sorteio NEGADA: ${err.message}`, ctx, {
        ok: false, loteId: dto.loteId, cpf,
      });
      throw err;
    }
  }

  // ==========================================================================
  // Admin — alocação manual, cancelamento, sorteio
  // ==========================================================================

  async alocacaoManual(dto: AlocacaoManualDto, ctx: Ctx) {
    this.validarConsentimento(dto);
    const cpf = dto.cpf.replace(/\D/g, '');
    const reserva = await this.prisma.$transaction(async (tx) => {
      const lote = await tx.coloniaLote.findUnique({ where: { id: dto.loteId } });
      if (!lote) throw new NotFoundException('Lote não encontrado.');
      // Quarto 6 do lote por padrão (exclusivo sorteio/manual)
      const quarto = dto.quartoId
        ? await tx.coloniaQuarto.findUnique({ where: { id: dto.quartoId } })
        : await tx.coloniaQuarto.findFirst({ where: { loteId: lote.id, numero: 6 } });
      if (!quarto) throw new NotFoundException('Quarto não encontrado.');
      if (quarto.loteId !== lote.id)
        throw new BadRequestException('Este quarto não pertence ao lote informado.');

      await this.lock(tx, `reserva:${lote.id}:${quarto.id}`);
      await this.garantirCpfLivre(tx, lote.temporadaId, cpf);

      const ocupado = await tx.coloniaReserva.findFirst({
        where: { loteId: lote.id, quartoId: quarto.id, status: StatusReserva.CONFIRMADA },
        select: { id: true },
      });
      if (ocupado) throw new ConflictException('Este quarto já está reservado para este lote.');

      return tx.coloniaReserva.create({
        data: {
          temporadaId: lote.temporadaId,
          loteId: lote.id,
          quartoId: quarto.id,
          origem: OrigemReserva.ALOCACAO_MANUAL,
          alocacaoManual: true,
          ...this.dadosCheckout(dto, ctx),
          ipConsentimento: ctx.ip,
          criadaPor: ctx.userId,
        },
      });
    }).catch((e) => { throw this.traduzir(e); });

    await this.auditar(AcaoAuditoria.CREATE, `Alocação manual pela diretoria (reserva ${reserva.id})`, ctx, {
      ok: true, reservaId: reserva.id, cpf,
    });
    return reserva;
  }

  /** Cancelamento pela diretoria: soft-delete que devolve a vaga ao público na hora. */
  async cancelarReserva(id: string, motivo: string | undefined, ctx: Ctx) {
    const reserva = await this.prisma.coloniaReserva.findUnique({ where: { id } });
    if (!reserva) throw new NotFoundException('Reserva não encontrada.');
    if (reserva.status === StatusReserva.CANCELADA_ADMIN)
      throw new BadRequestException('Reserva já está cancelada.');

    const atualizada = await this.prisma.coloniaReserva.update({
      where: { id },
      data: {
        status: StatusReserva.CANCELADA_ADMIN,
        canceladaEm: new Date(),
        canceladaPor: ctx.userId,
        motivoCancelamento: motivo,
      },
    });
    await this.auditar(AcaoAuditoria.DELETE, `Reserva cancelada pela diretoria (vaga liberada)`, ctx, {
      reservaId: id, motivo,
    });
    return atualizada;
  }

  /** Sorteio auditável do quarto 6 de um lote: sorteia um contemplado e lista os suplentes. */
  async realizarSorteio(loteId: string, ctx: Ctx) {
    const { reserva, vencedor, suplentes } = await this.prisma.$transaction(async (tx) => {
      const lote = await tx.coloniaLote.findUnique({ where: { id: loteId } });
      if (!lote) throw new NotFoundException('Lote não encontrado.');
      const quarto6 = await tx.coloniaQuarto.findFirst({ where: { loteId, numero: 6 } });
      if (!quarto6) throw new NotFoundException('Quarto 6 não configurado.');

      await this.lock(tx, `reserva:${loteId}:${quarto6.id}`);

      const jaOcupado = await tx.coloniaReserva.findFirst({
        where: { loteId, quartoId: quarto6.id, status: StatusReserva.CONFIRMADA },
        select: { id: true },
      });
      if (jaOcupado) throw new ConflictException('O quarto 6 já está ocupado neste lote.');

      const inscritos = await tx.coloniaSorteioInscricao.findMany({
        where: { loteId, status: StatusSorteioInscricao.INSCRITO },
        orderBy: { createdAt: 'asc' },
      });
      if (inscritos.length === 0) throw new BadRequestException('Não há inscritos na fila de sorteio deste lote.');

      const idxVencedor = Math.floor(Math.random() * inscritos.length);
      const escolhido = inscritos[idxVencedor];
      // Suplentes = demais inscritos em ordem aleatória (fila de espera)
      const restantes = inscritos.filter((_, i) => i !== idxVencedor).sort(() => Math.random() - 0.5);

      const novaReserva = await tx.coloniaReserva.create({
        data: {
          temporadaId: lote.temporadaId,
          loteId,
          quartoId: quarto6.id,
          origem: OrigemReserva.SORTEIO,
          nomeCompleto: escolhido.nomeCompleto,
          cpf: escolhido.cpf,
          telefone: escolhido.telefone,
          coren: escolhido.coren,
          email: escolhido.email,
          formacao: escolhido.formacao,
          localTrabalho1: escolhido.localTrabalho1,
          localTrabalho2: escolhido.localTrabalho2,
          cidade: escolhido.cidade,
          estado: escolhido.estado,
          aceiteTermoNoShow: escolhido.aceiteTermoNoShow,
          consentimentoLgpd: escolhido.consentimentoLgpd,
          consentimentoEm: escolhido.consentimentoEm,
          ipConsentimento: escolhido.ipInscricao,
          criadaPor: ctx.userId,
        },
      });

      await tx.coloniaSorteioInscricao.update({
        where: { id: escolhido.id },
        data: { status: StatusSorteioInscricao.SORTEADO, reservaId: novaReserva.id },
      });
      await tx.coloniaSorteioInscricao.updateMany({
        where: { loteId, status: StatusSorteioInscricao.INSCRITO },
        data: { status: StatusSorteioInscricao.NAO_SORTEADO },
      });
      return { reserva: novaReserva, vencedor: escolhido, suplentes: restantes };
    }).catch((e) => { throw this.traduzir(e); });

    await this.auditar(AcaoAuditoria.CREATE, `Sorteio auditável realizado (reserva ${reserva.id})`, ctx, {
      ok: true, loteId, reservaId: reserva.id, cpfVencedor: vencedor.cpf, totalInscritos: suplentes.length + 1,
    });
    return {
      vencedor: { nomeCompleto: vencedor.nomeCompleto, cpf: vencedor.cpf, formacao: vencedor.formacao, reservaId: reserva.id },
      suplentes: suplentes.map((s, i) => ({ posicao: i + 1, nomeCompleto: s.nomeCompleto, cpf: s.cpf, formacao: s.formacao })),
    };
  }

  async listarReservas(temporadaId?: string) {
    return this.prisma.coloniaReserva.findMany({
      where: { temporadaId },
      orderBy: { createdAt: 'desc' },
      include: { lote: { select: { numero: true } }, quarto: { select: { numero: true, climatizacao: true } } },
    });
  }

  // ==========================================================================
  // Admin — gestão de temporadas e painel
  // ==========================================================================

  /** Lista de campanhas para o dashboard mestre: link, status e vagas totais/ocupadas. */
  async listarTemporadas() {
    const temporadas = await this.prisma.coloniaTemporada.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { lotes: true } } },
    });
    return Promise.all(
      temporadas.map(async (t) => {
        const [totalVagas, ocupadas] = await Promise.all([
          this.prisma.coloniaQuarto.count({ where: { ativo: true, lote: { temporadaId: t.id } } }),
          this.prisma.coloniaReserva.count({ where: { temporadaId: t.id, status: StatusReserva.CONFIRMADA } }),
        ]);
        return {
          id: t.id,
          nome: t.nome,
          slug: t.slug,
          ano: t.ano,
          status: t.status,
          createdAt: t.createdAt,
          totalLotes: t._count.lotes,
          totalVagas,
          ocupadas,
        };
      }),
    );
  }

  /** Ativa/desativa o link público da temporada. Ativar deixa apenas 1 ativa. */
  async definirStatusTemporada(id: string, status: StatusTemporada, ctx: Ctx) {
    const t = await this.prisma.coloniaTemporada.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Temporada não encontrada.');
    if (status === StatusTemporada.ATIVA) {
      await this.prisma.coloniaTemporada.updateMany({
        where: { id: { not: id }, status: StatusTemporada.ATIVA },
        data: { status: StatusTemporada.INATIVA },
      });
    }
    const atualizada = await this.prisma.coloniaTemporada.update({ where: { id }, data: { status } });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ColoniaTemporada',
      entidadeId: id,
      ip: ctx.ip,
      descricao: `Temporada "${t.nome}" ${status === StatusTemporada.ATIVA ? 'ATIVADA' : 'DESATIVADA'} (link público).`,
    });
    return atualizada;
  }

  /** Painel completo por temporada: lotes, ocupantes (checkout), inscritos e flags. */
  async painelAdmin(temporadaId?: string) {
    const temporadas = await this.prisma.coloniaTemporada.findMany({ orderBy: { createdAt: 'desc' } });
    const temporada = temporadaId
      ? temporadas.find((t) => t.id === temporadaId)
      : temporadas.find((t) => t.status === StatusTemporada.ATIVA) ?? temporadas[0];
    if (!temporada) return { temporadas, temporada: null, lotes: [] };

    const [lotes, reservas, inscritos] = await Promise.all([
      this.prisma.coloniaLote.findMany({
        where: { temporadaId: temporada.id },
        orderBy: { numero: 'asc' },
        include: { quartos: { where: { ativo: true }, orderBy: { numero: 'asc' } } },
      }),
      this.prisma.coloniaReserva.findMany({
        where: { temporadaId: temporada.id, status: StatusReserva.CONFIRMADA },
        include: { quarto: { select: { numero: true, climatizacao: true } } },
      }),
      this.prisma.coloniaSorteioInscricao.findMany({
        where: { temporadaId: temporada.id, status: StatusSorteioInscricao.INSCRITO },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const data = lotes.map((lote) => {
      const rLote = reservas.filter((r) => r.loteId === lote.id);
      const ocupados = new Set(rLote.map((r) => r.quartoId));
      const q6Ocupado = rLote.some((r) => r.quarto.numero === 6);
      const q6Manual = rLote.some((r) => r.quarto.numero === 6 && r.alocacaoManual);
      const diretasDisponiveis = lote.quartos.filter((q) => q.modoReserva === 'RESERVA_DIRETA' && !ocupados.has(q.id)).length;

      return {
        lote: { id: lote.id, numero: lote.numero, dataInicio: lote.dataInicio, dataFim: lote.dataFim },
        quartos: lote.quartos.map((q) => ({
          id: q.id, numero: q.numero, climatizacao: q.climatizacao, modoReserva: q.modoReserva,
          ocupado: ocupados.has(q.id),
        })),
        ocupacao: rLote
          .sort((a, b) => a.quarto.numero - b.quarto.numero)
          .map((r) => ({
            reservaId: r.id,
            quartoNumero: r.quarto.numero,
            climatizacao: r.quarto.climatizacao,
            origem: r.origem,
            alocacaoManual: r.alocacaoManual,
            nomeCompleto: r.nomeCompleto,
            cpf: r.cpf,
            coren: r.coren,
            formacao: r.formacao,
            telefone: r.telefone,
            localTrabalho1: r.localTrabalho1,
            localTrabalho2: r.localTrabalho2,
            cidade: r.cidade,
            estado: r.estado,
            createdAt: r.createdAt,
          })),
        inscritos: inscritos
          .filter((i) => i.loteId === lote.id)
          .map((i) => ({ id: i.id, nomeCompleto: i.nomeCompleto, cpf: i.cpf, formacao: i.formacao, createdAt: i.createdAt })),
        sorteioHabilitado: diretasDisponiveis === 0 && !q6Ocupado,
        esgotado: diretasDisponiveis === 0 && q6Ocupado,
        quarto6AlocadoManualmente: q6Manual,
      };
    });

    return {
      temporadas: temporadas.map((t) => ({ id: t.id, nome: t.nome, slug: t.slug, ano: t.ano, status: t.status })),
      temporada: { id: temporada.id, nome: temporada.nome, slug: temporada.slug, ano: temporada.ano, status: temporada.status },
      lotes: data,
    };
  }

  /** CSV com toda a base coletada nos checkouts da temporada (reservas + inscrições). */
  async relatorioCsv(temporadaId?: string): Promise<{ nome: string; conteudo: string }> {
    const temporada = temporadaId
      ? await this.prisma.coloniaTemporada.findUnique({ where: { id: temporadaId } })
      : await this.prisma.coloniaTemporada.findFirst({ where: { status: StatusTemporada.ATIVA }, orderBy: { createdAt: 'desc' } });
    if (!temporada) throw new NotFoundException('Temporada não encontrada.');

    const [reservas, inscritos] = await Promise.all([
      this.prisma.coloniaReserva.findMany({
        where: { temporadaId: temporada.id },
        orderBy: [{ lote: { numero: 'asc' } }, { createdAt: 'asc' }],
        include: { lote: { select: { numero: true } }, quarto: { select: { numero: true, climatizacao: true } } },
      }),
      this.prisma.coloniaSorteioInscricao.findMany({
        where: { temporadaId: temporada.id },
        orderBy: [{ lote: { numero: 'asc' } }, { createdAt: 'asc' }],
        include: { lote: { select: { numero: true } } },
      }),
    ]);

    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cols = [
      'Tipo', 'Lote', 'Quarto', 'Categoria', 'Origem', 'Status', 'Nome', 'CPF', 'COREN', 'Formacao',
      'Telefone', 'Email', 'LocalTrabalho1', 'LocalTrabalho2', 'Cidade', 'Estado',
      'AceiteTermoNoShow', 'ConsentimentoLGPD', 'ConsentimentoEm', 'IP', 'CriadoEm',
    ];
    const linhas: string[] = [cols.join(';')];

    for (const r of reservas) {
      linhas.push([
        'RESERVA', r.lote.numero, r.quarto.numero, r.quarto.climatizacao, r.origem, r.status,
        r.nomeCompleto, r.cpf, r.coren, r.formacao, r.telefone, r.email, r.localTrabalho1, r.localTrabalho2,
        r.cidade, r.estado, r.aceiteTermoNoShow ? 'Sim' : 'Nao', r.consentimentoLgpd ? 'Sim' : 'Nao',
        r.consentimentoEm?.toISOString() ?? '', r.ipConsentimento, r.createdAt.toISOString(),
      ].map(esc).join(';'));
    }
    for (const i of inscritos) {
      linhas.push([
        'INSCRICAO_SORTEIO', i.lote.numero, '6', 'VENTILADOR', 'SORTEIO', i.status,
        i.nomeCompleto, i.cpf, i.coren, i.formacao, i.telefone, i.email, i.localTrabalho1, i.localTrabalho2,
        i.cidade, i.estado, i.aceiteTermoNoShow ? 'Sim' : 'Nao', i.consentimentoLgpd ? 'Sim' : 'Nao',
        i.consentimentoEm?.toISOString() ?? '', i.ipInscricao, i.createdAt.toISOString(),
      ].map(esc).join(';'));
    }

    // BOM para acentos no Excel
    const conteudo = '﻿' + linhas.join('\r\n');
    return { nome: `colonia-${temporada.nome.replace(/\s+/g, '-').toLowerCase()}.csv`, conteudo };
  }
}
