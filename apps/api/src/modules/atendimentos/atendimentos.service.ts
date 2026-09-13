import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AcaoAuditoria, DesfechoAtendimento, Prisma, StatusAtendimento,
  StatusCompromisso, TipoEncaminhamento, UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { marcarNadaMudou } from '../../common/audit/audit.contexto';
import { diferencaDeCampos } from '../../common/audit/audit.diff';
import { nivelEfetivo } from '../../common/permissions/permissoes.constants';
import { linkReuniaoParaGravar } from '../../common/link-reuniao.util';
import { montarUrgencia, sincronizarEquipe } from '../agenda/equipe.util';
import { EscalasService } from '../escalas/escalas.service';
import {
  diaBR, formatarDataHoraBR, instanteDoTextoBR, proximoHorarioUtilBR,
} from '../processos/utils/data-br.util';
import { assuntoGravavel, descreverAssunto, ROTULO_CANAL } from './assunto.util';
import {
  ehConsultaDoAtendimento, LOCAL_DA_MODALIDADE, modalidadeRemota,
  SELECT_CONSULTA_DO_ENCAMINHAMENTO, situacaoDoEncaminhamento,
} from './encaminhamento.util';
import {
  AtualizarAssuntoDto, AtualizarLinkConsultaDto,
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

/**
 * QUANDO A CONSULTA CAI SE NINGUÉM ESCOLHER A DATA: nove da manhã daqui do
 * próximo dia útil a partir de amanhã (ver o comentário em `registrarDesfecho`
 * sobre o `setHours` que marcava às 06:00).
 *
 * Função própria porque tem DOIS leitores que não podem discordar: o desfecho,
 * que grava, e a rota de opções, que mostra o plantão desse dia. Quando a tela
 * recalculava por conta própria, destacava o plantão de hoje para uma consulta
 * que nascia na segunda.
 */
export function inicioPadraoDaConsulta(agora: Date = new Date()): Date {
  return proximoHorarioUtilBR(new Date(agora.getTime() + 24 * 3_600_000), agora);
}

/**
 * O link que vai ao banco, pela regra única de `normalizarLinkReuniao` — a
 * mesma da agenda e do espelho no web. Texto que não vira link https válido é
 * recusado com a frase dela (400), nunca gravado cru; vazio vira nulo.
 */
function linkParaGravar(texto: string | null | undefined): string | null {
  return linkReuniaoParaGravar(texto ?? null) ?? null;
}

@Injectable()
export class AtendimentosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly escalas: EscalasService,
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
    // A mesma regra da reclassificação: Outro exige o texto; os demais o descartam.
    const classificacao = assuntoGravavel(dto.assunto, dto.assuntoOutro);

    const atendimento = await this.prisma.atendimento.create({
      data: {
        filiadoId: filiado.id,
        atendentePorId: ctx.userId!,
        canal: dto.canal,
        assunto: classificacao.assunto,
        assuntoOutro: classificacao.assuntoOutro,
        descricao: dto.descricao.trim(),
        ...urgencia,
      },
      include: { filiado: filiadoLista, atendente: { select: { id: true, nome: true } } },
    });

    await this.auditar(AcaoAuditoria.CREATE, atendimento.id, ctx,
      `Atendimento #${atendimento.numero} (${ROTULO_CANAL[dto.canal]}) registrado para ${filiado.nomeCompleto}`,
      {
        filiadoId: filiado.id,
        canal: dto.canal,
        assunto: classificacao.assunto,
        assuntoOutro: classificacao.assuntoOutro,
      });
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
    const encontrados = await this.prisma.user.findMany({
      where: { id: { in: advogadoIds }, ativo: true },
      select: { id: true, nome: true, nomeExibicao: true, role: true, permissoes: true },
    });
    if (encontrados.length !== advogadoIds.length) {
      throw new BadRequestException('Advogado(s) inválido(s) ou inativo(s).');
    }
    /*
      A ORDEM É A DA ESCOLHA, não a do banco.

      "O primeiro da lista responde pela consulta" — mas a lista era a do
      `findMany` com `in`, que volta na ordem que o Postgres quiser. Quem tocava
      primeiro na Dra. Ana podia ver a consulta nascer no nome do Dr. Bruno.
    */
    const porId = new Map(encontrados.map((u) => [u.id, u]));
    const advogados = advogadoIds.map((aid) => porId.get(aid)!);

    /*
      QUEM NÃO VÊ A AGENDA NÃO VÊ A CONSULTA.

      A lista de "advogados" era todo usuário ativo, e aqui só se conferia
      `ativo`. Dava para encaminhar a quem tem a Agenda SEM_ACESSO: a atividade
      existiria e ninguém a veria. A régua é a matriz (`nivelEfetivo`), a mesma
      que o guard usa — não o perfil, porque há coordenador que advoga.
    */
    const semAgenda = advogados.filter(
      (a) => nivelEfetivo(a.role, a.permissoes, 'agenda') === 'SEM_ACESSO',
    );
    if (semAgenda.length) {
      const quem = semAgenda.map((a) => a.nomeExibicao || a.nome).join(', ');
      throw new BadRequestException(
        semAgenda.length === 1
          ? `${quem} não tem acesso à Agenda e não veria a consulta. Escolha outra pessoa.`
          : `${quem} não têm acesso à Agenda e não veriam a consulta. Escolha outras pessoas.`,
      );
    }

    /*
      COMO VAI SER A CONSULTA. Vídeo e telefone moram no `local` (ver
      `LOCAL_DA_MODALIDADE`); o link, na coluna própria da atividade. O DTO já
      barra o remoto sem data — a conferência se repete aqui porque o serviço é
      a regra, e o DTO só a porta da frente.
    */
    const modalidade = dto.modalidade ?? null;
    if (modalidadeRemota(modalidade) && !dto.dataConsulta) {
      throw new BadRequestException('Consulta por vídeo ou por telefone precisa de dia e hora combinados.');
    }
    const textoDoLink = dto.linkReuniao?.trim() || '';
    if (textoDoLink && modalidade !== 'VIDEO') {
      throw new BadRequestException('O link da chamada só vale para consulta por vídeo.');
    }
    const linkReuniao = textoDoLink ? linkParaGravar(textoDoLink) : null;
    const local = modalidade ? LOCAL_DA_MODALIDADE[modalidade] : null;

    // NPU é opcional (processo administrativo não tem número único do CNJ).
    let processo: { id: string; numeroCNJ: string | null } | null = null;
    if (dto.tipoEncaminhamento === TipoEncaminhamento.ANDAMENTO_PROCESSO) {
      processo = await this.prisma.processo.findUnique({
        where: { id: dto.processoId },
        select: { id: true, numeroCNJ: true },
      });
      if (!processo) throw new BadRequestException('Processo inválido.');
    }

    /*
      "AMANHÃ ÀS 09:00" ERA ÀS 06:00 — e o comentário aqui jurava que não.

      `setHours(9)` resolve no fuso do PROCESSO, e o contêiner do Railway roda em
      UTC: nove da manhã lá são seis da manhã aqui. Medido na produção em
      07/09/2026: 16 compromissos gravados às 06:00 de Brasília, quatro deles
      "Consulta Jurídica" nascidas por esta linha. O advogado chega às oito e a
      consulta já está duas horas atrasada na agenda.

      Este defeito já tinha sido diagnosticado e corrigido nos robôs do DJEN em
      03/09 — `data-br.util` nasceu disso. Este caminho passou batido, e o teste
      que proíbe `setHours(9` só olhava dois arquivos.

      `proximoHorarioUtilBR` faz as três coisas: nove da manhã DAQUI, nunca no
      fim de semana (consulta marcada para sábado é consulta que ninguém atende)
      e nunca no passado. Data escolhida à mão passa intacta: aí quem marcou foi
      gente.
    */
    const inicio = dto.dataConsulta ? new Date(dto.dataConsulta) : inicioPadraoDaConsulta();
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
          // "Por chamada de vídeo" / "Por telefone" / nulo na sede — e o link
          // já normalizado, quando veio.
          local,
          linkReuniao,
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
      /*
        A EQUIPE SEMPRE, mesmo com uma pessoa só. Era só quando havia
        participantes: a consulta de um advogado nascia sem a linha `principal`
        em `compromisso_responsaveis`, com o atalho `responsavelId` apontando
        para uma linha que não existe — o contrário do que a agenda faz ao
        criar (agenda.service, "a equipe entra na MESMA transação").
      */
      await sincronizarEquipe(tx, consulta.id, {
        principalId: responsavel.id,
        participantesIds: participantes.map((a) => a.id),
      });
    });

    // "(2 consulta[s] na agenda)" contava advogados, não consultas — é uma só
    // desde que o laço saiu. A frase agora diz o que quem lê o log procura:
    // para quem, quando e como.
    const comoSera = modalidade === 'VIDEO' ? ' por vídeo' : modalidade === 'TELEFONE' ? ' por telefone' : '';
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx,
      `Atendimento #${at.numero} encaminhado a ${nomes.join(', ')}: consulta em ${formatarDataHoraBR(inicio)}${comoSera}`,
      {
        advogados: advogadoIds,
        tipoEncaminhamento: dto.tipoEncaminhamento ?? null,
        processoId: processo?.id ?? null,
        inicio: inicio.toISOString(),
        modalidade,
        comLink: !!linkReuniao,
      });
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
    /*
      DE ONDE PARA ONDE. "Atendimento #12 → CONCLUIDO" diz o destino e esconde
      a origem — e a pergunta que se faz é justamente "ele não estava
      concluído?". O `de` custa nada: o registro anterior já foi lido acima.
    */
    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      ctx,
      `Atendimento #${at.numero}: andamento de ${at.status} para ${dto.status}`,
      {
        alteracoes: [
          { campo: 'status', label: 'Andamento', de: at.status, para: dto.status },
        ],
      },
    );
    return this.detalhe(id);
  }

  // -------------------------------------------------------------------------
  // Assunto: classificar depois
  // -------------------------------------------------------------------------

  /**
   * RECLASSIFICAR O ASSUNTO — o "depois" que "Não informar agora" prometia.
   *
   * Até 13/09/2026 o assunto só existia na criação: a gaveta exibia, o desfecho
   * não perguntava e não havia rota para mudar. O momento em que o atendente
   * mais sabe do que se trata é depois da conversa, e ali o campo não existia —
   * `assuntoNaoInformado` só crescia.
   *
   * EDITAR de atendimentos (balcão, coordenação, administrador). O advogado só
   * vê; se o sindicato quiser que ele classifique, a mudança é na matriz.
   */
  async atualizarAssunto(id: string, dto: AtualizarAssuntoDto, ctx: Ctx) {
    const at = await this.prisma.atendimento.findUnique({
      where: { id },
      select: { id: true, numero: true, assunto: true, assuntoOutro: true },
    });
    if (!at) throw new NotFoundException('Atendimento não encontrado.');

    const novo = assuntoGravavel(dto.assunto, dto.assuntoOutro);
    const alteracoes = diferencaDeCampos(
      { assunto: at.assunto, assuntoOutro: at.assuntoOutro },
      novo,
    ).map((a) => (a.campo === 'assuntoOutro' ? { ...a, label: 'Qual assunto' } : a));

    // Reenviar o mesmo assunto não é ato de ninguém: sem gravação e sem linha no log.
    if (alteracoes.length === 0) {
      marcarNadaMudou();
      return this.detalhe(id);
    }

    await this.prisma.atendimento.update({ where: { id }, data: novo });
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx,
      `Atendimento #${at.numero}: assunto de "${descreverAssunto(at.assunto, at.assuntoOutro)}" para "${descreverAssunto(novo.assunto, novo.assuntoOutro)}"`,
      { alteracoes } as unknown as Prisma.InputJsonValue);
    return this.detalhe(id);
  }

  // -------------------------------------------------------------------------
  // Encaminhamento: plantão, advogados e o link da consulta
  // -------------------------------------------------------------------------

  /**
   * O QUE O DESFECHO PRECISA PARA ENCAMINHAR — lido pela rota de atendimentos.
   *
   * O modal lia `/escalas/plantao` e `/escalas/advogados`, do módulo escalas. O
   * preset da Triagem tem escalas SEM_ACESSO: o balcão, justamente quem
   * encaminha, tomaria 403 — e a tela mostraria "Ninguém de plantão neste dia"
   * e um seletor vazio. Medido em 12/09/2026: toda Triagem ativa tinha matriz
   * própria com escalas liberada, então o defeito estava latente, não ativo.
   * Aqui quem pode registrar o desfecho alcança, por construção, o que o
   * desfecho precisa.
   *
   * E O DIA É O DA CONSULTA. O modal destacava o plantão de HOJE enquanto a
   * consulta sem data nascia no próximo dia útil: na sexta, escolhia-se o
   * plantonista de sexta para uma consulta de segunda. `dataPadrao` sai de
   * `inicioPadraoDaConsulta`, a mesma função que o desfecho grava.
   */
  async opcoesDoEncaminhamento(data?: string, agora: Date = new Date()) {
    const dataPadrao = diaBR(inicioPadraoDaConsulta(agora));
    const dia = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : dataPadrao;

    const [plantao, usuarios] = await Promise.all([
      this.escalas.listarPlantao(dia),
      this.prisma.user.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        select: {
          id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true,
          role: true, permissoes: true,
        },
      }),
    ]);

    /*
      Quem pode receber = quem veria a consulta: ativo e com a Agenda acessível
      pela matriz — a mesma régua que `registrarDesfecho` usa para recusar.
      Perfil ADVOGADO primeiro, os demais depois (há coordenador que advoga, e
      por isso agrupar em vez de esconder). Dentro de cada grupo, a ordem
      alfabética do banco — `sort` é estável.
    */
    const advogados = usuarios
      .filter((u) => nivelEfetivo(u.role, u.permissoes, 'agenda') !== 'SEM_ACESSO')
      .sort((a, b) => Number(b.role === UserRole.ADVOGADO) - Number(a.role === UserRole.ADVOGADO))
      .map((u) => ({
        id: u.id,
        nome: u.nome,
        nomeExibicao: u.nomeExibicao,
        // `avatarKey` vai junto para o AvataresInterceptor trocar pela foto
        // enviada; ele remove a chave da resposta.
        avatarUrl: u.avatarUrl,
        avatarKey: u.avatarKey,
        role: u.role,
      }));
    const elegiveis = new Map(advogados.map((u) => [u.id, u]));

    /*
      Plantonista que o desfecho recusaria (sem Agenda, ou desativado depois de
      escalado) não vira ficha: oferecer um toque que termina em erro é pior do
      que não oferecer.
    */
    const doDia = plantao
      .filter((p) => elegiveis.has(p.advogado.id))
      .map((p) => {
        const u = elegiveis.get(p.advogado.id)!;
        return {
          id: p.id,
          advogadoId: u.id,
          advogado: {
            id: u.id, nome: u.nome, nomeExibicao: u.nomeExibicao,
            avatarUrl: u.avatarUrl, avatarKey: u.avatarKey,
          },
          horaInicio: p.horaInicio,
          horaFim: p.horaFim,
        };
      });

    return { dataPadrao, dia, plantao: doDia, advogados };
  }

  /**
   * COLAR O LINK DEPOIS — pela rota de atendimentos, e não pela da agenda.
   *
   * O link do Meet costuma chegar depois do encaminhamento: o advogado cria a
   * sala e manda ao balcão. A Triagem tem Agenda VISUALIZAR, e editar a
   * atividade é PATCH na agenda: 403. Esta porta é estreita de propósito — só a
   * consulta que NASCEU deste atendimento, só o link, só enquanto a consulta
   * está de pé.
   */
  async atualizarLinkDaConsulta(id: string, compromissoId: string, dto: AtualizarLinkConsultaDto, ctx: Ctx) {
    const [at, consulta] = await Promise.all([
      this.prisma.atendimento.findUnique({ where: { id }, select: { id: true, numero: true } }),
      this.prisma.compromisso.findUnique({
        where: { id: compromissoId },
        select: {
          id: true, titulo: true, status: true, atendimentoId: true, origemDesfechoId: true,
          linkReuniao: true, local: true,
        },
      }),
    ]);
    if (!at) throw new NotFoundException('Atendimento não encontrado.');
    // O seguimento herda `atendimentoId` na agenda; ele não é a consulta.
    if (!consulta || consulta.atendimentoId !== id || !ehConsultaDoAtendimento(consulta)) {
      throw new NotFoundException('Esta consulta não nasceu deste atendimento.');
    }
    if (consulta.status === StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException('Esta consulta já foi concluída: o link não serve mais.');
    }
    if (consulta.status === StatusCompromisso.CANCELADO) {
      throw new BadRequestException('Esta consulta foi cancelada: o link não serve mais.');
    }

    const novo = linkParaGravar(dto.linkReuniao);
    if ((consulta.linkReuniao ?? null) === novo) {
      marcarNadaMudou();
      return this.detalhe(id);
    }

    // Link colado em consulta sem local é consulta por vídeo. Local escrito por
    // alguém ("Sala 2 da sede") não é trocado: pode ser híbrida.
    const local = novo && !consulta.local ? LOCAL_DA_MODALIDADE.VIDEO : null;
    await this.prisma.compromisso.update({
      where: { id: compromissoId },
      data: { linkReuniao: novo, ...(local ? { local } : {}) },
    });

    const alteracoes = [
      { campo: 'linkReuniao', label: 'Link da chamada', de: consulta.linkReuniao ?? null, para: novo },
      ...(local ? [{ campo: 'local', label: 'Local', de: consulta.local ?? null, para: local }] : []),
    ];
    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Compromisso',
      entidadeId: compromissoId,
      descricao: !novo
        ? `Link da chamada tirado da consulta do atendimento #${at.numero}`
        : consulta.linkReuniao
          ? `Link da chamada trocado na consulta do atendimento #${at.numero}`
          : `Link da chamada colado na consulta do atendimento #${at.numero}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { atendimentoId: id, alteracoes },
    });
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
          { assuntoOutro: { contains: busca, mode: 'insensitive' } },
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
          id: true, numero: true, canal: true, assunto: true, assuntoOutro: true, desfecho: true, status: true,
          tipoEncaminhamento: true, descricao: true, responsavel: true, createdAt: true,
          filiado: filiadoLista,
          atendente: { select: { id: true, nome: true } },
          // Só para derivar o estado do encaminhamento; não sai na resposta.
          compromissos: {
            where: { origemDesfechoId: null },
            select: SELECT_CONSULTA_DO_ENCAMINHAMENTO,
          },
        },
      }),
    ]);

    const agora = new Date();
    const comEstado = items.map(({ compromissos, ...item }) => {
      const encaminhamento = situacaoDoEncaminhamento(compromissos, agora);
      return encaminhamento ? { ...item, encaminhamento } : item;
    });
    return {
      items: comEstado, total, page, pageSize,
      totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async detalhe(id: string) {
    const atendimento = await this.prisma.atendimento.findUnique({
      where: { id },
      include: {
        atendente: { select: { id: true, nome: true } },
        processo: processoSel,
        compromissos: {
          orderBy: { inicio: 'asc' },
          // O select da regra do encaminhamento, mais o título — para a lista e
          // o estado lerem as mesmas colunas.
          select: { titulo: true, ...SELECT_CONSULTA_DO_ENCAMINHAMENTO },
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
        id: true, numero: true, canal: true, assunto: true, assuntoOutro: true, desfecho: true, status: true, descricao: true, createdAt: true,
        atendente: { select: { nome: true } },
      },
    });
    /*
      `compromissos` continua inteiro (o web antigo lê dele). `consultas` é o
      recorte que o encaminhamento usa — sem o seguimento que herdou o
      atendimento — e é dele que sai o estado.
    */
    const consultas = atendimento.compromissos.filter(ehConsultaDoAtendimento);
    const encaminhamento = situacaoDoEncaminhamento(consultas);
    return {
      atendimento: { ...atendimento, consultas, ...(encaminhamento ? { encaminhamento } : {}) },
      historico,
    };
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
    return intervaloDeCriacaoBR(inicio, fim);
  }
}

/**
 * "DE 13/08 A 12/09" NA LISTA É DIA DE TERESINA — o mesmo recorte dos Relatórios.
 *
 * A listagem cortava à meia-noite UTC (`AAAA-MM-DDT00:00Z`), que é 21h da véspera
 * aqui: o atendimento das 22h do dia 12 entrava no dia 13. Os Relatórios
 * corrigiram o mesmo defeito em 12/09/2026 (`instanteDoTextoBR`); a tela de
 * atendimentos passa a ler `?dataInicio=&dataFim=` da URL para abrir o recorte
 * que um número contou, e dois cortes diferentes fariam a lista discordar do
 * número por três horas em cada ponta.
 *
 * `fim` é inclusivo: o filtro fecha no instante em que o dia seguinte começa.
 */
export function intervaloDeCriacaoBR(inicio?: string, fim?: string): Prisma.DateTimeFilter | null {
  const dia = /^\d{4}-\d{2}-\d{2}$/;
  const range: Prisma.DateTimeFilter = {};
  if (inicio && dia.test(inicio)) range.gte = instanteDoTextoBR(inicio);
  if (fim && dia.test(fim)) range.lt = new Date(instanteDoTextoBR(fim).getTime() + 24 * 3_600_000);
  return range.gte || range.lt ? range : null;
}
