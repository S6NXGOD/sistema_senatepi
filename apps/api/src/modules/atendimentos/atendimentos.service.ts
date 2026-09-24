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
import { AgendaService } from '../agenda/agenda.service';
import { CancelamentoFeito, cancelarCompromissoEmTransacao } from '../agenda/cancelamento-em-transacao';
import { EscalasService } from '../escalas/escalas.service';
import {
  diaBR, formatarDataHoraBR, instanteDoTextoBR, proximoHorarioUtilBR,
} from '../processos/utils/data-br.util';
import { assuntoGravavel, descreverAssunto, ROTULO_CANAL } from './assunto.util';
import {
  ConsultaDoEncaminhamento, ehConsultaDoAtendimento, filaDoAtendimento, LOCAL_DA_MODALIDADE, ModalidadeConsulta,
  modalidadeRemota, SELECT_CONSULTA_DO_ENCAMINHAMENTO, situacaoDoEncaminhamento,
} from './encaminhamento.util';
import {
  CATEGORIA_DA_CONSULTA_AO_CONCLUIR, CATEGORIA_DA_COPIA_QUE_SOBROU, consultasParaCancelar, copiasQueSobraram,
  decidirCancelar, decidirConcluir, FRASE_ATENDIMENTO_MUDOU, FRASE_CONSULTA_MUDOU, FRASE_TELA_PROPRIA,
  motivoDaConsultaCancelada, motivoDaCopiaCancelada, planoDeFechamento, PlanoDeFechamento,
} from './fechamento.util';
import { ORIGEM_DA_CONCLUSAO, comFraseDeCorrida } from './fechamento-pela-consulta';
import {
  AtualizarAssuntoDto, AtualizarLinkConsultaDto, CancelarAtendimentoDto, ConcluirAtendimentoDto,
  CreateAtendimentoDto, ListAtendimentosQueryDto,
  MudarModalidadeConsultaDto, MudarStatusAtendimentoDto, RegistrarDesfechoDto,
} from './dto/atendimentos.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
  /** Nome de quem agiu, congelado na linha do tempo da atividade quando a escrita toca a agenda. */
  nome?: string;
}

/** O responsável da consulta com a foto: o interceptor global troca `avatarKey` pela URL. */
const RESPONSAVEL_COM_FOTO = {
  select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true },
} as const;

/** "na sede" / "por vídeo" / "por telefone" / "“Sala 2”" — como a linha do tempo conta a modalidade. */
function modalidadeNaFrase(local: string | null | undefined): string {
  const texto = (local ?? '').trim();
  if (!texto) return 'na sede';
  if (texto === LOCAL_DA_MODALIDADE.VIDEO) return 'por vídeo';
  if (texto === LOCAL_DA_MODALIDADE.TELEFONE) return 'por telefone';
  return `"${texto}"`;
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
    // Só para a linha do tempo da consulta que o fechamento cancela ou muda.
    private readonly agenda: AgendaService,
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
        id: true, numero: true, desfecho: true, status: true, updatedAt: true,
        // A urgência da triagem é herdada pela consulta na agenda.
        urgente: true, urgenteMotivo: true,
        filiado: { select: { id: true, nomeCompleto: true } },
        // Só as consultas NASCIDAS dele (sem o seguimento), para saber se
        // todas caíram — ver "MARCAR NOVA CONSULTA" abaixo.
        compromissos: { where: { origemDesfechoId: null }, select: { id: true, status: true } },
      },
    });
    if (!at) throw new NotFoundException('Atendimento não encontrado.');
    /*
      MARCAR NOVA CONSULTA (14/09/2026, D13 da rodada 3).

      O desfecho se registrava uma vez só. Com a consulta cancelada (pelo
      advogado, ou pelo "cancelar junto" seguido de reabrir), a Triagem ficava
      sem ação: a frase "ninguém vai atender se não houver outra" apontava para
      uma porta que não existia, e só a coordenação criava a atividade à mão,
      sem o vínculo com o atendimento.

      Um novo ENCAMINHAMENTO passa quando as três coisas valem juntas: o
      atendimento está PENDENTE, o desfecho é ENCAMINHADO e TODAS as consultas
      nascidas dele estão canceladas. Com uma consulta de pé, encaminhar de novo
      criaria a duplicata que o laço antigo criava.
    */
    const nascidas = at.compromissos ?? [];
    const novoEncaminhamento =
      at.desfecho === DesfechoAtendimento.ENCAMINHADO
      && dto.resultado === DesfechoAtendimento.ENCAMINHADO
      && at.status === StatusAtendimento.PENDENTE
      && nascidas.length > 0
      && nascidas.every((c) => c.status === StatusCompromisso.CANCELADO);
    if (at.desfecho && !novoEncaminhamento) {
      throw new BadRequestException('O desfecho deste atendimento já foi registrado.');
    }
    /*
      A GRAVAÇÃO CONFERE O QUE A LEITURA VIU (14/09/2026). As condições acima
      saem de uma leitura feita fora da transação, e a gravação era um `update`
      por id. Dois "Marcar consulta" de abas diferentes criavam duas consultas
      iguais; e um desfecho que cruzava com o concluir ou o cancelar fazia nascer
      consulta viva em atendimento fechado. Agora a gravação é condicional e
      quem perde a corrida ouve "abra de novo", antes de criar qualquer consulta.

      No primeiro desfecho, `desfecho: null` e o `status` lido. No novo
      encaminhamento, além do `none` (nenhuma nascida de pé), o `updatedAt`
      lido: em READ COMMITTED a subconsulta do `none` enxerga o banco do começo
      do comando, e a consulta criada por quem comitou no mesmo instante não
      aparece nela. A coluna da própria linha é reconferida depois da trava, e o
      primeiro encaminhamento a mudou.
    */
    const ondeGravar: Prisma.AtendimentoWhereInput = novoEncaminhamento
      ? {
          id,
          status: StatusAtendimento.PENDENTE,
          desfecho: DesfechoAtendimento.ENCAMINHADO,
          updatedAt: at.updatedAt,
          compromissos: { none: { origemDesfechoId: null, status: { not: StatusCompromisso.CANCELADO } } },
        }
      : { id, desfecho: null, status: at.status };

    // --- Resolvido no ato ---
    if (dto.resultado === DesfechoAtendimento.RESOLVIDO_ATO) {
      const r = await this.prisma.atendimento.updateMany({
        where: ondeGravar,
        data: {
          desfecho: DesfechoAtendimento.RESOLVIDO_ATO,
          desfechoEm: new Date(),
          desfechoObs: dto.desfechoObs?.trim() || null,
        },
      });
      if (r.count !== 1) throw new BadRequestException(FRASE_ATENDIMENTO_MUDOU);
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
      const gravado = await tx.atendimento.updateMany({
        where: ondeGravar,
        data: {
          /*
            No NOVO encaminhamento, `desfecho` e `desfechoEm` ficam como estavam:
            o painel mede o tempo até a primeira resposta por `desfechoEm`, e o
            balcão respondeu no primeiro encaminhamento, não agora. A nota só é
            trocada quando vem uma nova; a antiga continua na consulta cancelada.
          */
          ...(novoEncaminhamento
            ? (dto.desfechoObs?.trim() ? { desfechoObs: dto.desfechoObs.trim() } : {})
            : {
                desfecho: DesfechoAtendimento.ENCAMINHADO,
                desfechoEm: new Date(),
                desfechoObs: dto.desfechoObs?.trim() || null,
              }),
          tipoEncaminhamento: dto.tipoEncaminhamento,
          processoId: processo?.id ?? null,
          setor: 'JURIDICO',
          responsavel: nomes.join(', '),
        },
      });
      if (gravado.count !== 1) throw new BadRequestException(FRASE_ATENDIMENTO_MUDOU);
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
      `Atendimento #${at.numero} encaminhado ${novoEncaminhamento ? 'de novo ' : ''}a ${nomes.join(', ')}: consulta em ${formatarDataHoraBR(inicio)}${comoSera}`,
      {
        // A consulta anterior foi cancelada: quem lê o log precisa saber que
        // este encaminhamento é o segundo, e qual consulta ele substitui.
        ...(novoEncaminhamento ? { novaConsulta: true, consultasCanceladasAntes: nascidas.map((c) => c.id) } : {}),
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
  // Fechamento: concluir e cancelar (rotas próprias) e reabrir (/status)
  // -------------------------------------------------------------------------

  /**
   * SÓ O REABRIR PASSA POR AQUI (14/09/2026, D9 da rodada 3).
   *
   * Até ali este PATCH aceitava qualquer situação vinda de qualquer outra:
   * concluído virava cancelado sem reabrir, o mesmo status era regravado e
   * auditado ("de PENDENTE para PENDENTE") e não havia trava de concorrência.
   * Concluir e cancelar ganharam rota própria, que decide o que acontece com a
   * consulta; esta porta aberta ao lado seria o jeito de fechar sem decidir.
   *
   * Reabrir limpa da ficha quem, quando e por quê — a auditoria leva o
   * fechamento anterior, porque a ficha o apaga — e NÃO reabre consulta: é
   * decisão de gente, e a agenda de quem atendia pode já estar ocupada.
   */
  async mudarStatus(id: string, dto: MudarStatusAtendimentoDto, ctx: Ctx) {
    if (dto.status !== StatusAtendimento.PENDENTE) throw new BadRequestException(FRASE_TELA_PROPRIA);

    const at = await this.prisma.atendimento.findUnique({
      where: { id },
      select: {
        id: true, numero: true, status: true,
        concluidoEm: true, concluidoPor: true, conclusaoObs: true, conclusaoOrigem: true,
        canceladoEm: true, canceladoPor: true, canceladoCategoria: true, canceladoMotivo: true,
      },
    });
    if (!at) throw new NotFoundException('Atendimento não encontrado.');

    // Um toque duplo não é ato de ninguém: sem gravação e sem linha no log.
    if (at.status === StatusAtendimento.PENDENTE) {
      marcarNadaMudou();
      return this.detalhe(id);
    }

    const r = await this.prisma.atendimento.updateMany({
      where: { id, status: at.status },
      data: {
        status: StatusAtendimento.PENDENTE,
        concluidoEm: null, concluidoPor: null, conclusaoObs: null,
        // O carimbo de quem fechou sai junto (15/09/2026): um atendimento reaberto
        // que guardasse "pela consulta X" seria devolvido de novo pelo desfazer
        // daquela consulta, por cima da decisão de quem reabriu.
        conclusaoOrigem: null, conclusaoConsultaId: null,
        canceladoEm: null, canceladoPor: null, canceladoCategoria: null, canceladoMotivo: null,
      },
    });
    if (r.count !== 1) throw new BadRequestException(FRASE_ATENDIMENTO_MUDOU);

    const fechamentoAnterior = at.status === StatusAtendimento.CANCELADO
      ? {
          categoria: at.canceladoCategoria, motivo: at.canceladoMotivo,
          em: at.canceladoEm?.toISOString() ?? null, por: at.canceladoPor,
        }
      : {
          nota: at.conclusaoObs, em: at.concluidoEm?.toISOString() ?? null, por: at.concluidoPor,
          origem: at.conclusaoOrigem ?? null,
        };
    /*
      DE ONDE PARA ONDE. "Atendimento #12 → CONCLUIDO" diz o destino e esconde
      a origem — e a pergunta que se faz é justamente "ele não estava
      concluído?". O `de` custa nada: o registro anterior já foi lido acima.
    */
    await this.auditar(
      AcaoAuditoria.UPDATE,
      id,
      ctx,
      `Atendimento #${at.numero}: andamento de ${at.status} para ${StatusAtendimento.PENDENTE}`,
      {
        alteracoes: [
          { campo: 'status', label: 'Andamento', de: at.status, para: StatusAtendimento.PENDENTE },
        ],
        fechamentoAnterior,
      },
    );
    return this.detalhe(id);
  }

  /**
   * CONCLUIR — com o que o plano manda decidir sobre a consulta.
   *
   * A regra é `planoDeFechamento`, a MESMA que o detalhe mostra ao modal; aqui
   * ela é recalculada com o relógio da gravação, porque o advogado pode ter
   * iniciado ou concluído a consulta enquanto o modal estava aberto.
   *
   * Tudo numa transação: o atendimento só fecha se a consulta cancelada junto
   * cancelar, e vice-versa. As duas gravações são condicionais à situação lida
   * (`updateMany` por status): quem chega segundo toma "abra de novo", e não
   * sobrescreve em silêncio o que o outro acabou de fazer.
   */
  async concluir(id: string, dto: ConcluirAtendimentoDto, ctx: Ctx, agora: Date = new Date()) {
    const at = await this.lerParaFechar(id);
    const plano = planoDeFechamento(at, at.compromissos, agora);
    const decisao = decidirConcluir(plano, dto);
    if (!decisao.ok) throw new BadRequestException(decisao.recusa);

    const aCancelar = decisao.consulta === 'CANCELAR' ? consultasParaCancelar(at.compromissos) : [];
    const motivo = motivoDaConsultaCancelada('CONCLUIR', at.numero, plano.consulta?.situacao ?? 'NENHUMA', decisao.texto);
    // E4: com a vigente já registrada, as cópias abertas do laço antigo saem como duplicidade.
    const copias = copiasQueSobraram(plano, at.compromissos);
    const motivoDasCopias = motivoDaCopiaCancelada('CONCLUIR', at.numero, plano.consulta);

    /*
      A PRIMEIRA GRAVAÇÃO É A DO ATENDIMENTO, e isso é a ordem das travas
      (15/09/2026): a agenda trava o atendimento antes da consulta pela mesma
      regra (`travarAtendimentoAntesDaConsulta`). Se o banco ainda abortar esta
      transação por deadlock, quem está no balcão ouve a frase de corrida, e não
      "Internal server error".
    */
    const { feitos, copiasFeitas } = await comFraseDeCorrida(FRASE_ATENDIMENTO_MUDOU, () => this.prisma.$transaction(async (tx) => {
      const r = await tx.atendimento.updateMany({
        where: { id, status: StatusAtendimento.PENDENTE },
        data: {
          status: StatusAtendimento.CONCLUIDO,
          concluidoEm: agora,
          concluidoPor: ctx.userId ?? null,
          conclusaoObs: decisao.texto,
          // Quem fechou foi a triagem (15/09/2026): o desfazer da consulta confere
          // este carimbo e nunca devolve um atendimento que a triagem concluiu.
          conclusaoOrigem: ORIGEM_DA_CONCLUSAO.TRIAGEM,
          conclusaoConsultaId: null,
        },
      });
      if (r.count !== 1) throw new BadRequestException(FRASE_ATENDIMENTO_MUDOU);
      await this.exigirQueNenhumaConsultaSurgiu(tx, id, at.compromissos);
      const feitos = await this.cancelarConsultasEmTransacao(tx, aCancelar, CATEGORIA_DA_CONSULTA_AO_CONCLUIR, motivo, ctx, agora);
      const copiasFeitas = await this.cancelarConsultasEmTransacao(
        tx, copias, CATEGORIA_DA_COPIA_QUE_SOBROU, motivoDasCopias, ctx, agora,
      );
      return { feitos, copiasFeitas };
    }));

    const todas = [...feitos, ...copiasFeitas];
    await this.registrarConsultasCanceladas(todas, id, ctx);
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx,
      `Atendimento #${at.numero}: andamento de ${at.status} para ${StatusAtendimento.CONCLUIDO}`,
      {
        alteracoes: [{ campo: 'status', label: 'Andamento', de: at.status, para: StatusAtendimento.CONCLUIDO }],
        nota: decisao.texto,
        consulta: decisao.consulta,
        via: ORIGEM_DA_CONCLUSAO.TRIAGEM,
        consultasCanceladas: todas.map((f) => f.id),
        copiasCanceladas: copiasFeitas.map((f) => f.id),
      });
    return this.respostaDoFechamento(id, todas, [...aCancelar, ...copias]);
  }

  /**
   * CANCELAR — a categoria é o motivo obrigatório, e a consulta de pé segue o
   * que a pessoa escolheu (a tela vem com "cancelar também" marcado). A
   * consulta cancelada junto recebe a MESMA categoria: é o mesmo slug do
   * catálogo da agenda.
   */
  async cancelar(id: string, dto: CancelarAtendimentoDto, ctx: Ctx, agora: Date = new Date()) {
    const at = await this.lerParaFechar(id);
    const plano = planoDeFechamento(at, at.compromissos, agora);
    const decisao = decidirCancelar(plano, dto);
    if (!decisao.ok) throw new BadRequestException(decisao.recusa);

    const aCancelar = decisao.consulta === 'CANCELAR' ? consultasParaCancelar(at.compromissos) : [];
    const motivo = motivoDaConsultaCancelada('CANCELAR', at.numero, plano.consulta?.situacao ?? 'NENHUMA', decisao.texto);
    /*
      As cópias que sobraram saem também no CANCELAR (15/09/2026, E4): com a
      vigente registrada, fechar o atendimento por qualquer porta deixaria a
      cópia pendente na agenda de alguém, esperando um filiado que não vem.
    */
    const copias = copiasQueSobraram(plano, at.compromissos);
    const motivoDasCopias = motivoDaCopiaCancelada('CANCELAR', at.numero, plano.consulta);

    // Atendimento antes da consulta, e deadlock vira a frase de corrida: ver `concluir` (15/09/2026).
    const { feitos, copiasFeitas } = await comFraseDeCorrida(FRASE_ATENDIMENTO_MUDOU, () => this.prisma.$transaction(async (tx) => {
      const r = await tx.atendimento.updateMany({
        where: { id, status: StatusAtendimento.PENDENTE },
        data: {
          status: StatusAtendimento.CANCELADO,
          canceladoEm: agora,
          canceladoPor: ctx.userId ?? null,
          canceladoCategoria: dto.categoria,
          canceladoMotivo: decisao.texto,
        },
      });
      if (r.count !== 1) throw new BadRequestException(FRASE_ATENDIMENTO_MUDOU);
      await this.exigirQueNenhumaConsultaSurgiu(tx, id, at.compromissos);
      const feitos = await this.cancelarConsultasEmTransacao(tx, aCancelar, dto.categoria, motivo, ctx, agora);
      const copiasFeitas = await this.cancelarConsultasEmTransacao(
        tx, copias, CATEGORIA_DA_COPIA_QUE_SOBROU, motivoDasCopias, ctx, agora,
      );
      return { feitos, copiasFeitas };
    }));

    const todas = [...feitos, ...copiasFeitas];
    await this.registrarConsultasCanceladas(todas, id, ctx);
    await this.auditar(AcaoAuditoria.UPDATE, id, ctx,
      `Atendimento #${at.numero}: andamento de ${at.status} para ${StatusAtendimento.CANCELADO}`,
      {
        alteracoes: [{ campo: 'status', label: 'Andamento', de: at.status, para: StatusAtendimento.CANCELADO }],
        categoria: dto.categoria,
        motivo: decisao.texto,
        consulta: decisao.consulta,
        consultasCanceladas: todas.map((f) => f.id),
        copiasCanceladas: copiasFeitas.map((f) => f.id),
      });
    return this.respostaDoFechamento(id, todas, [...aCancelar, ...copias]);
  }

  /** O que o fechamento precisa ler: a situação e as consultas NASCIDAS, com a foto de quem atende. */
  private async lerParaFechar(id: string) {
    const at = await this.prisma.atendimento.findUnique({
      where: { id },
      select: {
        id: true, numero: true, status: true, desfecho: true,
        compromissos: {
          where: { origemDesfechoId: null },
          select: { ...SELECT_CONSULTA_DO_ENCAMINHAMENTO, responsavel: RESPONSAVEL_COM_FOTO },
        },
      },
    });
    if (!at) throw new NotFoundException('Atendimento não encontrado.');
    return at;
  }

  /**
   * NENHUMA CONSULTA NASCEU NO MEIO (14/09/2026). O plano foi calculado com as
   * consultas lidas antes da transação. Se um "Marcar consulta" comitou nesse
   * intervalo, o `updateMany` por status não percebe, porque o desfecho não
   * mexe no status: o atendimento fecharia com uma consulta nova de pé, que
   * ninguém decidiu. Conta DEPOIS da gravação do atendimento, já com a linha
   * travada, para enxergar o que comitou antes.
   */
  private async exigirQueNenhumaConsultaSurgiu(
    tx: Prisma.TransactionClient,
    atendimentoId: string,
    lidas: { id: string }[],
  ) {
    const surgiram = await tx.compromisso.count({
      where: {
        atendimentoId,
        origemDesfechoId: null,
        status: { not: StatusCompromisso.CANCELADO },
        id: { notIn: lidas.map((c) => c.id) },
      },
    });
    if (surgiram > 0) throw new BadRequestException(FRASE_CONSULTA_MUDOU);
  }

  /**
   * A consulta é cancelada pela REGRA DA AGENDA (`cancelarCompromissoEmTransacao`),
   * dentro da transação do atendimento, e só se ainda estiver PENDENTE: a que
   * já começou é de quem está atendendo.
   *
   * A escrita cruzada é deliberada e estreita (D10): a Triagem tem a Agenda só
   * para ver, e por esta porta cancela SÓ a consulta que nasceu deste
   * atendimento, SÓ no gesto de fechá-lo, e com o nome dela no histórico.
   *
   * Se a consulta mudou entre a leitura e a gravação, a recusa da agenda fala de
   * "atividade" — quem está no balcão ouve a frase do atendimento, e a
   * transação inteira é desfeita.
   */
  private async cancelarConsultasEmTransacao(
    tx: Prisma.TransactionClient,
    consultas: ConsultaDoEncaminhamento[],
    categoria: string,
    motivo: string,
    ctx: Ctx,
    agora: Date,
  ): Promise<CancelamentoFeito[]> {
    const feitos: CancelamentoFeito[] = [];
    for (const c of consultas) {
      try {
        feitos.push(await cancelarCompromissoEmTransacao(tx, {
          id: c.id,
          categoria,
          motivo,
          autorId: ctx.userId ?? null,
          aceitarStatus: [StatusCompromisso.PENDENTE],
          agora,
        }));
      } catch (e) {
        if (e instanceof BadRequestException || e instanceof NotFoundException) {
          throw new BadRequestException(FRASE_CONSULTA_MUDOU);
        }
        throw e;
      }
    }
    return feitos;
  }

  /** Depois do commit: a linha do tempo de cada consulta e a auditoria dela, com o atendimento de origem. */
  private async registrarConsultasCanceladas(feitos: CancelamentoFeito[], atendimentoId: string, ctx: Ctx) {
    for (const f of feitos) {
      await this.agenda.registrarNoHistorico(f.id, {
        ...f.historico,
        autorId: ctx.userId ?? null,
        autorNome: ctx.nome ?? null,
      });
      await this.audit.registrar({
        ...f.auditoria,
        metadata: { ...f.auditoria.metadata, atendimentoId },
        userId: ctx.userId ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }
  }

  /**
   * O detalhe de sempre, mais o que o servidor FEZ com as consultas. A tela lê
   * daqui a confirmação ("a consulta de qui, 17/09 às 09:00 foi cancelada") e
   * não do que pediu: se o advogado fechou antes, nada foi cancelado e a tela
   * não afirma o contrário.
   */
  private async respostaDoFechamento(id: string, feitos: CancelamentoFeito[], consultas: ConsultaDoEncaminhamento[]) {
    const detalhe = await this.detalhe(id);
    const porId = new Map(consultas.map((c) => [c.id, c]));
    return {
      ...detalhe,
      efeitos: {
        consultasCanceladas: feitos.map((f) => {
          const c = porId.get(f.id);
          // `categoria`: a tela separa a cópia que saiu como DUPLICIDADE da consulta cancelada (E4).
          return { id: f.id, inicio: c ? new Date(c.inicio) : null, responsavel: c?.responsavel ?? null, categoria: f.categoria };
        }),
      },
    };
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
   * MUDAR COMO VAI SER A CONSULTA JÁ MARCADA (14/09/2026, D12 da rodada 3).
   *
   * O #14: a demanda dizia "chamada de vídeo" e a consulta estava na sede — a
   * advogada esperaria na sede e a filiada esperaria um link. A rota do link só
   * trocava o local quando ele estava vazio, e o botão só aparecia com a
   * consulta já por vídeo: consulta marcada na sede não tinha como virar vídeo
   * pela Triagem, que tem a Agenda só para ver.
   *
   * A mesma porta estreita do link: só a consulta que NASCEU deste atendimento
   * e só enquanto está de pé. O `local` passa a ser o da modalidade escolhida,
   * sobrescrevendo texto livre — a escolha é explícita e o de→para fica na
   * auditoria e na linha do tempo da atividade. Sair do vídeo zera o link; no
   * vídeo sem mandar o link, o link que já existe fica.
   */
  async mudarModalidadeDaConsulta(id: string, compromissoId: string, dto: MudarModalidadeConsultaDto, ctx: Ctx) {
    const [at, consulta] = await Promise.all([
      this.prisma.atendimento.findUnique({ where: { id }, select: { id: true, numero: true } }),
      this.prisma.compromisso.findUnique({
        where: { id: compromissoId },
        select: {
          id: true, status: true, atendimentoId: true, origemDesfechoId: true,
          linkReuniao: true, local: true,
        },
      }),
    ]);
    if (!at) throw new NotFoundException('Atendimento não encontrado.');
    if (!consulta || consulta.atendimentoId !== id || !ehConsultaDoAtendimento(consulta)) {
      throw new NotFoundException('Esta consulta não nasceu deste atendimento.');
    }
    if (consulta.status === StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException('Esta consulta já foi concluída: não dá mais para mudar como vai ser.');
    }
    if (consulta.status === StatusCompromisso.CANCELADO) {
      throw new BadRequestException('Esta consulta foi cancelada: não dá mais para mudar como vai ser.');
    }

    const modalidade: ModalidadeConsulta = dto.modalidade;
    const textoDoLink = typeof dto.linkReuniao === 'string' ? dto.linkReuniao.trim() : '';
    if (textoDoLink && modalidade !== 'VIDEO') {
      throw new BadRequestException('O link da chamada só vale para consulta por vídeo.');
    }

    const localAntes = consulta.local?.trim() ? consulta.local : null;
    const linkAntes = consulta.linkReuniao ?? null;
    const localNovo = LOCAL_DA_MODALIDADE[modalidade];
    const linkNovo = modalidade !== 'VIDEO'
      ? null
      : dto.linkReuniao === undefined
        ? linkAntes
        : textoDoLink ? linkParaGravar(textoDoLink) : null;

    const mudouLocal = localAntes !== localNovo;
    const mudouLink = linkAntes !== linkNovo;
    // Reenviar a mesma escolha não é ato de ninguém: sem gravação e sem linha no log.
    if (!mudouLocal && !mudouLink) {
      marcarNadaMudou();
      return this.detalhe(id);
    }

    await this.prisma.compromisso.update({
      where: { id: compromissoId },
      data: { local: localNovo, linkReuniao: linkNovo },
    });

    const alteracoes = [
      ...(mudouLocal ? [{ campo: 'local', label: 'Local', de: consulta.local ?? null, para: localNovo }] : []),
      ...(mudouLink ? [{ campo: 'linkReuniao', label: 'Link da chamada', de: linkAntes, para: linkNovo }] : []),
    ];
    const n = at.numero;
    const descricao = mudouLocal
      ? `Modalidade trocada pelo atendimento #${n}: ${modalidadeNaFrase(consulta.local)} → ${modalidadeNaFrase(localNovo)}`
        + `${linkNovo && mudouLink ? ', com o link da chamada' : ''}.`
      : !linkNovo
        ? `Link da chamada tirado pelo atendimento #${n}.`
        : linkAntes
          ? `Link da chamada trocado pelo atendimento #${n}.`
          : `Link da chamada colado pelo atendimento #${n}.`;

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Compromisso',
      entidadeId: compromissoId,
      descricao,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { atendimentoId: id, alteracoes },
    });
    // O advogado lê na linha do tempo da atividade quem mudou e de onde veio.
    await this.agenda.registrarNoHistorico(compromissoId, {
      acao: 'EDITADO',
      descricao,
      metadata: { atendimentoId: id, alteracoes },
      autorId: ctx.userId ?? null,
      autorNome: ctx.nome ?? null,
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

  async listar(q: ListAtendimentosQueryDto, usuarioId?: string | null, agora: Date = new Date()) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const busca = q.busca?.trim();

    const and: Prisma.AtendimentoWhereInput[] = [];
    /*
      "COMIGO" É O MESMO RECORTE DO NÚMERO DO BALCÃO (15/09/2026). O painel conta
      "Comigo, com a triagem" pelos atendimentos que a pessoa registrou
      (`atendentePorId`), e o link abria a fila TRIAGEM da casa inteira: 1 no
      número, 5 na lista. O filtro entra no `and`, antes do ramo da fila, que o
      reaproveita. Sem usuário no token não há "eu": nada casa, em vez de a lista
      virar a da casa em silêncio.
    */
    if (q.atendente === 'me') and.push({ atendentePorId: usuarioId || '__sem_usuario__' });
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

    const select = {
      id: true, numero: true, canal: true, assunto: true, assuntoOutro: true, desfecho: true, status: true,
      tipoEncaminhamento: true, descricao: true, responsavel: true, createdAt: true,
      /* A URGÊNCIA VAI PARA A LISTA desde 21/09/2026: ela existia no cadastro e
         só aparecia na gaveta — numa fila ordenada por data, o urgente de
         ontem ficava abaixo do comum de hoje sem nada que o distinguisse.

         E VAI COM O MOTIVO, sempre: selo que diz "Urgente" e não diz por quê é
         o defeito que a coluna `urgenteMotivo` existe para não repetir. Na
         lista ele é o `title` da chama. */
      urgente: true,
      urgenteMotivo: true,
      conclusaoOrigem: true, conclusaoConsultaId: true,
      filiado: filiadoLista,
      atendente: { select: { id: true, nome: true } },
      /*
        OS ARQUIVOS, CONTADOS NA LISTA (24/09/2026).

        "A atividade inclusive tinha 17 anexos, mas não tá avisando no card. E
        nem na triagem." Medido: o atendimento #23 tem DEZESSETE arquivos, e a
        linha dele na lista era igual à de um atendimento sem nenhum. Quem
        precisa decidir por onde começar não tinha como saber onde está o
        trabalho já reunido.

        `_count`, não a lista: a linha só precisa dizer que existem e quantos.
      */
      _count: { select: { anexos: true } },
      // Só para derivar o estado do encaminhamento e a fila; não sai na resposta.
      compromissos: {
        where: { origemDesfechoId: null },
        select: SELECT_CONSULTA_DO_ENCAMINHAMENTO,
      },
    } as const satisfies Prisma.AtendimentoSelect;
    type Lido = Prisma.AtendimentoGetPayload<{ select: typeof select }>;

    // O estado e a fila saem da MESMA leitura, com o mesmo relógio: a etiqueta e o filtro não discordam.
    const comEstado = ({ compromissos, ...item }: Lido) => {
      const encaminhamento = situacaoDoEncaminhamento(compromissos, agora);
      const fila = filaDoAtendimento(item, compromissos, agora);
      return { ...item, ...(encaminhamento ? { encaminhamento } : {}), fila };
    };
    const pagina = (total: number, items: ReturnType<typeof comEstado>[]) => ({
      items, total, page, pageSize,
      totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
    });

    /*
      COM A FILA, O FILTRO RODA DEPOIS DA LEITURA (15/09/2026, E3 da rodada 4).
      A fila depende do relógio e das consultas (2 dias úteis sem registro), e
      não existe como coluna para o banco filtrar. A leitura traz TODOS os
      pendentes do recorte, a regra separa e a página é cortada aqui. Medido em
      14/09: 10 atendimentos na base inteira, 2 pendentes; o custo é o de uma
      leitura pequena. Fila só existe em pendente: outro status dá lista vazia.
    */
    if (q.fila) {
      if (q.status && q.status !== StatusAtendimento.PENDENTE) return pagina(0, []);
      const todos = await this.prisma.atendimento.findMany({
        where: { AND: [...and, { status: StatusAtendimento.PENDENTE }] },
        orderBy: { createdAt: 'desc' },
        select,
      });
      const naFila = todos.map(comEstado).filter((i) => i.fila?.fila === q.fila);
      return pagina(naFila.length, naFila.slice((page - 1) * pageSize, page * pageSize));
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.atendimento.count({ where }),
      this.prisma.atendimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select,
      }),
    ]);
    return pagina(total, items.map(comEstado));
  }

  async detalhe(id: string, agora: Date = new Date()) {
    const lido = await this.prisma.atendimento.findUnique({
      where: { id },
      include: {
        atendente: { select: { id: true, nome: true } },
        processo: processoSel,
        // Quem fechou, como PESSOA: a ficha diz "por Julian Helton", não um id.
        concluidoPorUsuario: { select: { id: true, nome: true, nomeExibicao: true } },
        canceladoPorUsuario: { select: { id: true, nome: true, nomeExibicao: true } },
        compromissos: {
          orderBy: { inicio: 'asc' },
          // O select da regra do encaminhamento, mais o título — para a lista e
          // o estado lerem as mesmas colunas. O responsável leva a foto, que o
          // modal de fechamento mostra no aviso de "esta consulta é da Dra. X".
          select: { titulo: true, ...SELECT_CONSULTA_DO_ENCAMINHAMENTO, responsavel: RESPONSAVEL_COM_FOTO },
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
    if (!lido) throw new NotFoundException('Atendimento não encontrado.');
    // A coluna `concluidoPor` (o id) dá lugar à pessoa; registro antigo, ou de
    // usuário apagado (SET NULL), sai com nulo e a ficha não mostra o bloco.
    const { concluidoPorUsuario, canceladoPorUsuario, ...atendimento } = lido;

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
    const encaminhamento = situacaoDoEncaminhamento(consultas, agora);
    /*
      O PLANO DE FECHAMENTO sai na leitura, como o encaminhamento: o modal mostra
      o efeito e pergunta só o que falta decidir, e `concluir`/`cancelar` validam
      com a MESMA função. O web antigo ignora o campo. A listagem não o ganha:
      o modal busca este detalhe.
    */
    const fechamento: PlanoDeFechamento = planoDeFechamento(atendimento, consultas, agora);
    return {
      atendimento: {
        ...atendimento,
        concluidoPor: concluidoPorUsuario ?? null,
        canceladoPor: canceladoPorUsuario ?? null,
        consultas,
        ...(encaminhamento ? { encaminhamento } : {}),
        // A mesma regra da lista e do painel (E3): a gaveta não discorda da linha.
        fila: filaDoAtendimento(atendimento, consultas, agora),
        fechamento,
      },
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
