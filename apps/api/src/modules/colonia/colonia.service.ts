import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria,
  ColoniaReserva,
  ColoniaTemporada,
  FormacaoColonia,
  FormacaoProfissional,
  OrigemReserva,
  Prisma,
  SituacaoFiliado,
  StatusReserva,
  StatusSorteioInscricao,
  StatusTemporada,
  TipoHistoricoFiliado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { mascararCpf } from '../../common/utils/matricula.util';
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

  /**
   * Regra de bloqueio: um filiado DESFILIADO não pode se inscrever na Colônia de
   * Férias (benefício exclusivo de associados ativos). O checkout é público e
   * aceita não-filiados normalmente; o bloqueio (403) só dispara quando o CPF
   * pertence a um cadastro cuja situação é DESFILIADO.
   */
  private async garantirFiliadoNaoDesfiliado(tx: Tx, cpf: string): Promise<void> {
    const filiado = await tx.filiado.findUnique({
      where: { cpf },
      select: { situacao: true },
    });
    if (filiado && filiado.situacao === SituacaoFiliado.DESFILIADO)
      throw new ForbiddenException(
        'Este CPF pertence a um filiado DESFILIADO e não pode se inscrever na Colônia de Férias.',
      );
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
      temporada: {
        id: temporada.id,
        nome: temporada.nome,
        ano: temporada.ano,
        slug: temporada.slug,
        dataSorteio: temporada.dataSorteio,
      },
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
        await this.garantirFiliadoNaoDesfiliado(tx, cpf);

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
        await this.garantirFiliadoNaoDesfiliado(tx, cpf);

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

      // Q6 é a vaga do SORTEIO público: se já há gente inscrita aguardando o
      // sorteio, a alocação manual não pode "furar a fila". Realize o sorteio.
      if (quarto.numero === 6) {
        const inscritosSorteio = await tx.coloniaSorteioInscricao.count({
          where: { loteId: lote.id, status: StatusSorteioInscricao.INSCRITO },
        });
        if (inscritosSorteio > 0)
          throw new ConflictException(
            'Há inscritos no sorteio público do Quarto 6 deste lote. Realize o sorteio para definir o ocupante — a alocação manual não pode furar a fila.',
          );
      }

      await this.garantirCpfLivre(tx, lote.temporadaId, cpf);
      await this.garantirFiliadoNaoDesfiliado(tx, cpf);

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

  /**
   * Promove o próximo da FILA DE SUPLENTES para o quarto liberado (respeitando a
   * ordem `posicaoSuplente`). Pula suplentes que já conseguiram uma reserva
   * CONFIRMADA por outro meio. Retorna o suplente promovido ou null se a fila
   * estiver vazia. Executado dentro da transação de cancelamento.
   */
  private async promoverProximoSuplente(tx: Tx, cancelada: ColoniaReserva, ctx: Ctx) {
    const suplentes = await tx.coloniaSorteioInscricao.findMany({
      where: {
        loteId: cancelada.loteId,
        status: StatusSorteioInscricao.NAO_SORTEADO,
        posicaoSuplente: { not: null },
        reservaId: null,
      },
      orderBy: { posicaoSuplente: 'asc' },
    });

    for (const s of suplentes) {
      // Suplente já pode ter conseguido vaga por outro meio: pula, mantém a fila.
      const jaTemReserva = await tx.coloniaReserva.findFirst({
        where: { temporadaId: cancelada.temporadaId, cpf: s.cpf, status: StatusReserva.CONFIRMADA },
        select: { id: true },
      });
      if (jaTemReserva) continue;

      const nova = await tx.coloniaReserva.create({
        data: {
          temporadaId: cancelada.temporadaId,
          loteId: cancelada.loteId,
          quartoId: cancelada.quartoId,
          origem: OrigemReserva.SORTEIO,
          nomeCompleto: s.nomeCompleto,
          cpf: s.cpf,
          telefone: s.telefone,
          coren: s.coren,
          email: s.email,
          formacao: s.formacao,
          localTrabalho1: s.localTrabalho1,
          localTrabalho2: s.localTrabalho2,
          cidade: s.cidade,
          estado: s.estado,
          aceiteTermoNoShow: s.aceiteTermoNoShow,
          consentimentoLgpd: s.consentimentoLgpd,
          consentimentoEm: s.consentimentoEm,
          ipConsentimento: s.ipInscricao,
          criadaPor: ctx.userId,
        },
      });
      await tx.coloniaSorteioInscricao.update({
        where: { id: s.id },
        data: { status: StatusSorteioInscricao.SORTEADO, reservaId: nova.id },
      });
      return {
        reservaId: nova.id,
        nomeCompleto: s.nomeCompleto,
        cpf: s.cpf,
        posicaoSuplente: s.posicaoSuplente,
      };
    }
    return null;
  }

  /**
   * Cancelamento pela diretoria: soft-delete que devolve a vaga ao público na
   * hora. Se a reserva veio do SORTEIO, o próximo suplente da fila entra
   * automaticamente no lugar (fila de suplentes respeitada).
   */
  async cancelarReserva(id: string, motivo: string | undefined, ctx: Ctx) {
    const { atualizada, promovido } = await this.prisma
      .$transaction(async (tx) => {
        const reserva = await tx.coloniaReserva.findUnique({ where: { id }, include: { quarto: true } });
        if (!reserva) throw new NotFoundException('Reserva não encontrada.');
        if (reserva.status === StatusReserva.CANCELADA_ADMIN)
          throw new BadRequestException('Reserva já está cancelada.');

        const atualizada = await tx.coloniaReserva.update({
          where: { id },
          data: {
            status: StatusReserva.CANCELADA_ADMIN,
            canceladaEm: new Date(),
            canceladaPor: ctx.userId,
            motivoCancelamento: motivo,
          },
        });

        // Ao liberar o Quarto 6 (vaga do sorteio), o próximo da FILA DE
        // SUPLENTES assume automaticamente — não importa se a reserva cancelada
        // veio do sorteio ou de alocação manual. As demais vagas (reserva
        // direta) simplesmente voltam a ficar disponíveis ao público.
        const promovido =
          reserva.quarto.numero === 6
            ? await this.promoverProximoSuplente(tx, reserva, ctx)
            : null;

        return { atualizada, promovido };
      })
      .catch((e) => {
        throw this.traduzir(e);
      });

    await this.auditar(AcaoAuditoria.DELETE, `Reserva cancelada pela diretoria (vaga liberada)`, ctx, {
      reservaId: id, motivo, suplentePromovido: promovido?.reservaId ?? null,
    });
    if (promovido)
      await this.auditar(
        AcaoAuditoria.CREATE,
        `Suplente promovido automaticamente (posição ${promovido.posicaoSuplente})`,
        ctx,
        { reservaId: promovido.reservaId, cpf: promovido.cpf, origem: 'cancelamento-sorteio' },
      );

    return { ...atualizada, suplentePromovido: promovido };
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
      // Persiste a FILA DE SUPLENTES em ordem (posicaoSuplente 1..n): status
      // NAO_SORTEADO, mas ordenados para promoção automática caso a reserva do
      // contemplado seja cancelada. A ordem é a mesma exibida ao público.
      for (let i = 0; i < restantes.length; i++) {
        await tx.coloniaSorteioInscricao.update({
          where: { id: restantes[i].id },
          data: {
            status: StatusSorteioInscricao.NAO_SORTEADO,
            posicaoSuplente: i + 1,
          },
        });
      }
      return { reserva: novaReserva, vencedor: escolhido, suplentes: restantes };
    }).catch((e) => { throw this.traduzir(e); });

    await this.auditar(AcaoAuditoria.CREATE, `Sorteio auditável realizado (reserva ${reserva.id})`, ctx, {
      ok: true, loteId, reservaId: reserva.id, cpfVencedor: vencedor.cpf, totalInscritos: suplentes.length + 1,
    });
    return {
      vencedor: { nomeCompleto: vencedor.nomeCompleto, cpf: vencedor.cpf, coren: vencedor.coren, formacao: vencedor.formacao, reservaId: reserva.id },
      suplentes: suplentes.map((s, i) => ({ posicao: i + 1, nomeCompleto: s.nomeCompleto, cpf: s.cpf, coren: s.coren, formacao: s.formacao })),
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

  /** Define (ou limpa) a data/hora do sorteio público da temporada. */
  async definirDataSorteio(id: string, dataSorteio: string | null | undefined, ctx: Ctx) {
    const t = await this.prisma.coloniaTemporada.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Temporada não encontrada.');
    const atualizada = await this.prisma.coloniaTemporada.update({
      where: { id },
      data: { dataSorteio: dataSorteio ? new Date(dataSorteio) : null },
    });
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ColoniaTemporada',
      entidadeId: id,
      ip: ctx.ip,
      descricao: `Data do sorteio público ${dataSorteio ? 'definida' : 'removida'} — "${t.nome}".`,
    });
    return atualizada;
  }

  // Formação da Colônia (ENF/TEC/AUX) → cadastro + sufixo do COREN + rótulo.
  private mapFormacaoColonia(f: FormacaoColonia) {
    const M: Record<FormacaoColonia, { formacao: FormacaoProfissional; suf: string; label: string }> = {
      ENFERMEIRO: { formacao: FormacaoProfissional.ENFERMEIRO, suf: 'ENF', label: 'Enfermeiro(a)' },
      TECNICO: { formacao: FormacaoProfissional.TECNICO_ENFERMAGEM, suf: 'TEC', label: 'Técnico(a) em Enfermagem' },
      AUXILIAR: { formacao: FormacaoProfissional.AUXILIAR_ENFERMAGEM, suf: 'AUX', label: 'Auxiliar de Enfermagem' },
    };
    return M[f];
  }

  /**
   * Carrega o registro da Colônia e resolve o Filiado correspondente:
   *  1) por `filiadoId` explícito (escolhido pela diretoria); senão
   *  2) por CPF; senão
   *  3) por NOME exatamente igual (case-insensitive) — só quando houver UM único.
   * Retorna o filiado possivelmente nulo (o chamador decide se é obrigatório).
   */
  private async carregarParaSync(fonte: 'reserva' | 'inscricao', id: string, filiadoId?: string) {
    const dados =
      fonte === 'reserva'
        ? await this.prisma.coloniaReserva.findUnique({ where: { id } })
        : await this.prisma.coloniaSorteioInscricao.findUnique({ where: { id } });
    if (!dados) throw new NotFoundException('Registro não encontrado.');

    const cpf = dados.cpf.replace(/\D/g, '');
    const inc = { vinculos: { orderBy: { ordem: 'asc' as const } } };

    let filiado = filiadoId
      ? await this.prisma.filiado.findUnique({ where: { id: filiadoId }, include: inc })
      : await this.prisma.filiado.findUnique({ where: { cpf }, include: inc });

    // Fallback por nome exatamente igual (apenas quando há um único correspondente).
    if (!filiado && !filiadoId) {
      const porNome = await this.prisma.filiado.findMany({
        where: { nomeCompleto: { equals: dados.nomeCompleto.trim(), mode: 'insensitive' } },
        include: inc,
        take: 2,
      });
      if (porNome.length === 1) filiado = porNome[0];
    }
    return { dados, filiado, cpf };
  }

  /** Filiados com NOME exatamente igual ao do registro (para o seletor de comparação). */
  async candidatosPorNome(fonte: 'reserva' | 'inscricao', id: string) {
    const dados =
      fonte === 'reserva'
        ? await this.prisma.coloniaReserva.findUnique({ where: { id }, select: { nomeCompleto: true } })
        : await this.prisma.coloniaSorteioInscricao.findUnique({ where: { id }, select: { nomeCompleto: true } });
    if (!dados) throw new NotFoundException('Registro não encontrado.');
    const filiados = await this.prisma.filiado.findMany({
      where: { nomeCompleto: { equals: dados.nomeCompleto.trim(), mode: 'insensitive' } },
      select: { id: true, nomeCompleto: true, cpf: true, matricula: true, cidade: true, estado: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    return filiados.map((f) => ({
      id: f.id,
      nome: f.nomeCompleto,
      cpfMascarado: f.cpf ? mascararCpf(f.cpf) : null,
      matricula: f.matricula,
      cidade: f.cidade,
      estado: f.estado,
    }));
  }

  /**
   * Monta a comparação campo a campo (valor ATUAL no cadastro × valor NOVO da
   * Colônia). Só inclui campos em que a Colônia tem valor (evita sobrescrever
   * com vazio). `diferente` pré-seleciona no front apenas o que mudou.
   */
  private construirCampos(
    dados: {
      nomeCompleto: string; cpf: string; telefone: string; email: string | null; coren: string | null;
      formacao: FormacaoColonia; localTrabalho1: string; localTrabalho2: string | null;
      cidade: string; estado: string;
    },
    filiado: { nomeCompleto: string; cpf: string | null; telefonePrincipal: string | null; email: string | null;
      numeroCoren: string | null; formacao: FormacaoProfissional | null; cidade: string | null;
      estado: string | null; vinculos: { empresa: string; ordem: number }[] },
  ) {
    const LABEL_FORM: Record<string, string> = {
      ENFERMEIRO: 'Enfermeiro(a)', TECNICO_ENFERMAGEM: 'Técnico(a) em Enfermagem',
      AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem', OUTRO: 'Outro',
    };
    const m = this.mapFormacaoColonia(dados.formacao);
    const corenDigitos = (dados.coren ?? '').replace(/\D/g, '').slice(0, 6);
    const corenNovo = corenDigitos ? `COREN-PI ${corenDigitos}-${m.suf}` : null;
    const fmtCpf = (v?: string | null) => {
      const d = (v ?? '').replace(/\D/g, '');
      return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : v ?? null;
    };
    const v1 = filiado.vinculos[0];
    const v2 = filiado.vinculos[1];
    const norm = (v: unknown) => (v == null ? '' : String(v).trim());
    const campo = (chave: string, label: string, atual?: string | null, novo?: string | null) => ({
      campo: chave,
      label,
      atual: atual ?? null,
      novo: novo ?? null,
      diferente: norm(atual) !== norm(novo),
    });

    const lista = [
      campo('nomeCompleto', 'Nome completo', filiado.nomeCompleto, dados.nomeCompleto),
      campo('cpf', 'CPF', fmtCpf(filiado.cpf), fmtCpf(dados.cpf)),
      campo('telefonePrincipal', 'Telefone', filiado.telefonePrincipal, dados.telefone),
      campo('email', 'E-mail', filiado.email, dados.email),
      campo('numeroCoren', 'COREN', filiado.numeroCoren, corenNovo),
      campo('formacao', 'Formação', filiado.formacao ? LABEL_FORM[filiado.formacao] ?? filiado.formacao : null, m.label),
      campo('cidade', 'Cidade', filiado.cidade, dados.cidade),
      campo('estado', 'UF', filiado.estado, dados.estado),
      campo('localTrabalho1', 'Local de trabalho 1', v1?.empresa, dados.localTrabalho1),
      campo('localTrabalho2', 'Local de trabalho 2', v2?.empresa, dados.localTrabalho2),
    ];
    // Só oferece campos em que a Colônia trouxe um valor.
    return lista.filter((c) => norm(c.novo) !== '');
  }

  /** Prévia (antes/depois) do que a Colônia pode subir para o cadastro do filiado. */
  async preverSincronizacao(fonte: 'reserva' | 'inscricao', id: string, filiadoId?: string) {
    const { dados, filiado, cpf } = await this.carregarParaSync(fonte, id, filiadoId);

    // Já sincronizado → apenas consulta (usa o filiado registrado; não recompara).
    if (dados.filiadoSincronizadoEm) {
      const alvo =
        filiado ??
        (dados.filiadoSincronizadoId
          ? await this.prisma.filiado.findUnique({
              where: { id: dados.filiadoSincronizadoId },
              select: { id: true, nomeCompleto: true, matricula: true },
            })
          : null);
      return {
        filiadoId: alvo?.id ?? null,
        filiadoNome: alvo?.nomeCompleto ?? null,
        matricula: alvo?.matricula ?? null,
        cpf,
        sincronizadoEm: dados.filiadoSincronizadoEm,
        sincronizacao: dados.filiadoSincronizacao,
        campos: [],
      };
    }

    if (!filiado)
      throw new NotFoundException('Nenhum filiado correspondente para atualizar o cadastro.');
    return {
      filiadoId: filiado.id,
      filiadoNome: filiado.nomeCompleto,
      matricula: filiado.matricula,
      cpf,
      sincronizadoEm: null,
      sincronizacao: null,
      campos: this.construirCampos(dados, filiado),
    };
  }

  /**
   * Aplica no cadastro do filiado APENAS os campos escolhidos pela diretoria
   * (`campos`). Inclui os locais de trabalho (vínculos), preservando cargo e
   * matrícula. A situação do filiado NÃO é alterada. Registra o histórico.
   */
  async sincronizarFiliado(
    fonte: 'reserva' | 'inscricao',
    id: string,
    campos: string[],
    ctx: Ctx,
    autor?: string,
    filiadoId?: string,
  ) {
    const { dados, filiado } = await this.carregarParaSync(fonte, id, filiadoId);
    // Trava: cada registro só sincroniza UMA vez (depois é apenas consulta).
    if (dados.filiadoSincronizadoEm)
      throw new ConflictException('Este cadastro já foi atualizado a partir deste registro.');
    if (!filiado)
      throw new NotFoundException('Nenhum filiado correspondente para atualizar o cadastro.');

    const disponiveis = this.construirCampos(dados, filiado);
    const validos = new Set(disponiveis.map((c) => c.campo));
    const sel = new Set((campos ?? []).filter((c) => validos.has(c)));
    if (sel.size === 0)
      throw new BadRequestException('Selecione ao menos um campo para atualizar.');

    // Snapshot do que será atualizado (antes → depois), para consulta futura.
    const snapshot = disponiveis
      .filter((c) => sel.has(c.campo))
      .map((c) => ({ campo: c.campo, label: c.label, de: c.atual, para: c.novo }));

    const m = this.mapFormacaoColonia(dados.formacao);
    const corenDigitos = (dados.coren ?? '').replace(/\D/g, '').slice(0, 6);

    const cpfDigitos = (dados.cpf ?? '').replace(/\D/g, '');

    const data: Prisma.FiliadoUpdateInput = {};
    if (sel.has('nomeCompleto')) data.nomeCompleto = dados.nomeCompleto;
    if (sel.has('cpf') && cpfDigitos) data.cpf = cpfDigitos;
    if (sel.has('telefonePrincipal')) data.telefonePrincipal = dados.telefone;
    if (sel.has('email') && dados.email) data.email = dados.email;
    if (sel.has('numeroCoren') && corenDigitos) data.numeroCoren = `COREN-PI ${corenDigitos}-${m.suf}`;
    if (sel.has('formacao')) data.formacao = m.formacao;
    if (sel.has('cidade')) data.cidade = dados.cidade;
    if (sel.has('estado')) data.estado = dados.estado;

    await this.prisma.$transaction(async (tx) => {
      // CPF é único: bloqueia (com mensagem clara) se já for de outro filiado.
      if (data.cpf) {
        const colisao = await tx.filiado.findFirst({
          where: { cpf: cpfDigitos, id: { not: filiado.id } },
          select: { nomeCompleto: true, matricula: true },
        });
        if (colisao)
          throw new ConflictException(
            `O CPF informado já pertence a outro filiado: ${colisao.nomeCompleto} (matrícula ${colisao.matricula}).`,
          );
      }
      if (Object.keys(data).length > 0)
        await tx.filiado.update({ where: { id: filiado.id }, data });

      // Locais de trabalho → vínculos (preserva cargo/matrícula do vínculo).
      const aplicarVinculo = async (ordem: number, empresa: string) => {
        const existente = filiado.vinculos.find((v) => v.ordem === ordem) ?? filiado.vinculos[ordem - 1];
        if (existente)
          await tx.vinculoProfissional.update({ where: { id: existente.id }, data: { empresa } });
        else await tx.vinculoProfissional.create({ data: { filiadoId: filiado.id, empresa, ordem } });
      };
      if (sel.has('localTrabalho1') && dados.localTrabalho1) await aplicarVinculo(1, dados.localTrabalho1);
      if (sel.has('localTrabalho2') && dados.localTrabalho2) await aplicarVinculo(2, dados.localTrabalho2);

      await tx.filiadoHistorico.create({
        data: {
          filiadoId: filiado.id,
          tipo: TipoHistoricoFiliado.ALTERACAO,
          descricao: `Cadastro atualizado a partir da Colônia de Férias (${fonte}). Campos: ${[...sel].join(', ')}.`,
          autor,
          metadata: { origem: 'colonia', fonte, campos: [...sel] },
        },
      });

      // Marca o registro da Colônia como sincronizado (trava + snapshot p/ consulta).
      const marca = {
        filiadoSincronizadoEm: new Date(),
        filiadoSincronizacao: snapshot as Prisma.InputJsonValue,
        filiadoSincronizadoId: filiado.id,
      };
      if (fonte === 'reserva') await tx.coloniaReserva.update({ where: { id }, data: marca });
      else await tx.coloniaSorteioInscricao.update({ where: { id }, data: marca });
    });

    return { filiadoId: filiado.id, nome: filiado.nomeCompleto, alterados: [...sel] };
  }

  /** Painel completo por temporada: lotes, ocupantes (checkout), inscritos e flags. */
  async painelAdmin(temporadaId?: string) {
    const temporadas = await this.prisma.coloniaTemporada.findMany({ orderBy: { createdAt: 'desc' } });
    const temporada = temporadaId
      ? temporadas.find((t) => t.id === temporadaId)
      : temporadas.find((t) => t.status === StatusTemporada.ATIVA) ?? temporadas[0];
    if (!temporada) return { temporadas, temporada: null, lotes: [] };

    const [lotes, reservas, inscritos, suplentes] = await Promise.all([
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
      // Fila de suplentes já sorteada (aguardando promoção), em ordem.
      this.prisma.coloniaSorteioInscricao.findMany({
        where: {
          temporadaId: temporada.id,
          status: StatusSorteioInscricao.NAO_SORTEADO,
          posicaoSuplente: { not: null },
          reservaId: null,
        },
        orderBy: { posicaoSuplente: 'asc' },
      }),
    ]);

    // Cruzamento com o cadastro de Filiados por CPF: permite "subir" os dados do
    // checkout para o cadastro (atualização de informações). Uma consulta só.
    const cpfs = Array.from(
      new Set([
        ...reservas.map((r) => r.cpf),
        ...inscritos.map((i) => i.cpf),
        ...suplentes.map((s) => s.cpf),
      ].filter(Boolean)),
    );
    const filiados = cpfs.length
      ? await this.prisma.filiado.findMany({
          where: { cpf: { in: cpfs } },
          select: { id: true, cpf: true },
        })
      : [];
    const filiadoPorCpf = new Map(filiados.map((f) => [f.cpf, f.id]));

    // Fallback por NOME exatamente igual, apenas para quem não casou por CPF.
    const norm = (s: string) => s.trim().toLowerCase();
    const semCpf = [...reservas, ...inscritos, ...suplentes].filter((x) => !filiadoPorCpf.has(x.cpf));
    const nomes = Array.from(new Set(semCpf.map((x) => x.nomeCompleto.trim()).filter(Boolean)));
    const porNome = nomes.length
      ? await this.prisma.filiado.findMany({
          where: { OR: nomes.map((n) => ({ nomeCompleto: { equals: n, mode: 'insensitive' as const } })) },
          select: { id: true, nomeCompleto: true },
        })
      : [];
    const filiadosPorNome = new Map<string, string[]>();
    for (const f of porNome) {
      const k = norm(f.nomeCompleto);
      filiadosPorNome.set(k, [...(filiadosPorNome.get(k) ?? []), f.id]);
    }
    // Resolve o match de um registro: CPF > nome único > (vários) candidatos.
    const resolver = (cpf: string, nome: string): { filiadoId: string | null; filiadoCandidatos: number } => {
      const porCpf = filiadoPorCpf.get(cpf);
      if (porCpf) return { filiadoId: porCpf, filiadoCandidatos: 0 };
      const ids = filiadosPorNome.get(norm(nome)) ?? [];
      if (ids.length === 1) return { filiadoId: ids[0], filiadoCandidatos: 1 };
      return { filiadoId: null, filiadoCandidatos: ids.length };
    };

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
            email: r.email,
            localTrabalho1: r.localTrabalho1,
            localTrabalho2: r.localTrabalho2,
            cidade: r.cidade,
            estado: r.estado,
            createdAt: r.createdAt,
            // Cadastro de filiado correspondente (CPF > nome único > candidatos).
            ...resolver(r.cpf, r.nomeCompleto),
            // Já sincronizou este registro com o cadastro? (trava re-atualização)
            sincronizadoEm: r.filiadoSincronizadoEm,
          })),
        inscritos: inscritos
          .filter((i) => i.loteId === lote.id)
          .map((i) => ({
            id: i.id, nomeCompleto: i.nomeCompleto, cpf: i.cpf, coren: i.coren,
            formacao: i.formacao, createdAt: i.createdAt,
            ...resolver(i.cpf, i.nomeCompleto),
            sincronizadoEm: i.filiadoSincronizadoEm,
          })),
        // Fila de suplentes (ordem de promoção), com match de filiado.
        suplentes: suplentes
          .filter((s) => s.loteId === lote.id)
          .map((s) => ({
            id: s.id, posicao: s.posicaoSuplente, nomeCompleto: s.nomeCompleto, cpf: s.cpf,
            coren: s.coren, formacao: s.formacao,
            ...resolver(s.cpf, s.nomeCompleto),
            sincronizadoEm: s.filiadoSincronizadoEm,
          })),
        sorteioHabilitado: diretasDisponiveis === 0 && !q6Ocupado,
        esgotado: diretasDisponiveis === 0 && q6Ocupado,
        quarto6AlocadoManualmente: q6Manual,
      };
    });

    return {
      temporadas: temporadas.map((t) => ({ id: t.id, nome: t.nome, slug: t.slug, ano: t.ano, status: t.status })),
      temporada: {
        id: temporada.id, nome: temporada.nome, slug: temporada.slug, ano: temporada.ano,
        status: temporada.status, dataSorteio: temporada.dataSorteio,
      },
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
