import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { formatarDataHoraBR } from '../../modules/processos/utils/data-br.util';
import {
  AcaoAuditoria, Prisma, StatusCompromisso, StatusProcesso,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { diferencaDeCampos, fraseDaAlteracao } from '../../common/audit/audit.diff';
import { marcarNadaMudou } from '../../common/audit/audit.contexto';
import { TiposEventoService } from './tipos-evento.service';
import {
  acharDesfecho, desfechosDoTipo, DESFECHO_LABEL, sugeridoParaOSeguimento, tituloDoSeguimento,
} from './desfechos.catalogo';
import {
  NAO_E_RESERVA, ausenciaDe, daPessoa, montarUrgencia, ondeSouReserva, sincronizarEquipe,
} from './equipe.util';
import {
  LIMITE_SEM_PAGINA, TIPOS_COM_HORA, filtroDaBusca, lerCursor, ordemDaListagem, recorteAberto,
  recorteAtencao, recorteAtrasadas, recorteHoje, recorteSeteDias, recorteTodos, sentidoDaJanela,
  whereDaJanela, whereDoCursor, whereDoRecorte, type ContagemDosRecortes,
} from './recortes.util';
import {
  FRASE_MUDOU_NO_MEIO, cancelarCompromissoEmTransacao, dispensarMovimentacaoLigada,
} from './cancelamento-em-transacao';
import {
  comFraseDeCorrida, concluirAtendimentoPelaConsulta, reabrirAtendimentoFechadoPelaConsulta,
  travarAtendimentoAntesDaConsulta, type AtendimentoMexido,
} from '../atendimentos/fechamento-pela-consulta';
import { dadosDaRemarcacao, mesmoMinuto, recusarRemarcacaoParaOPassado } from './remarcacao.util';
import {
  FRASE_CANCELAR_PELA_ROTA, FRASE_CONCLUIR_PELA_ROTA, statusDaCriacao, statusPelaEdicao,
} from './porta-do-status.util';
import { andamentoDaConclusao, podeDesfazerConclusao, type RegistroDaConclusao } from './desfazer-conclusao.util';
import { linkReuniaoParaGravar } from '../../common/link-reuniao.util';
/**
 * QUANTOS DIAS ENTRE UM LEMBRETE DE ATRASADAS E O SEGUINTE.
 *
 * Sete: o dono pediu "ao menos 1 vez por semana", e mais que isso vira
 * cabeçalho. Fica exportado porque o teste cobra os dois lados do corte.
 */
export const DIAS_ENTRE_AVISOS = 7;

import { nivelEfetivo } from '../../common/permissions/permissoes.constants';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ultimosUsosReais } from '../dashboard/ultimo-acesso.util';
import { normalizarCategoria } from '../processos/areas.catalogo';
import { PARTE_ORDER } from '../processos/partes.service';
import {
  CancelarCompromissoDto,
  ConcluirCompromissoDto,
  CorrigirDesfechoDto,
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
  /**
   * Quem agiu, como LEITOR da resposta: a atividade que volta de uma escrita é
   * um cartão, e o cartão de quem não vê Processos sai sem as partes. Vem do
   * usuário do controller, sem consulta a mais. Sem leitor (chamada interna,
   * como a audiência que o radar agenda), vale tudo.
   */
  leitor?: Leitor;
}

/** Quem está lendo — o que a matriz deixa ver de Processos decide o que vem junto. */
export type Leitor = Pick<AuthUser, 'id' | 'role' | 'permissoes'>;

/** O que o caso pré-processual herda da atividade concluída. */
interface AtividadeDoCaso {
  titulo: string;
  descricao: string | null;
  filiadoId: string | null;
  responsavelId: string;
  atendimentoId: string | null;
  urgente?: boolean;
  urgenteMotivo?: string | null;
}

/** O que foi validado FORA da transação, para o caso nascer dentro dela (15/09/2026). */
interface PreparoDoCaso {
  advogadoId: string;
  equipeCaso: string[];
  titulo: string;
  observacao: string | null;
  categoria: string | null;
  assunto: string | null;
}

/** `{ id, numero }` do atendimento mexido pela consulta, para o aviso da tela; nulo quando nada mudou. */
function resumoDoAtendimento(mexido: AtendimentoMexido | null): { id: string; numero: number } | null {
  return mexido ? { id: mexido.atendimentoId, numero: mexido.numero } : null;
}

/**
 * QUEM NÃO TEM O MÓDULO DE PROCESSOS NÃO RECEBE DADO DE PROCESSO PELA AGENDA.
 *
 * O painel já cortava isso no backend (dashboard.module.ts, `veProcessos`); a
 * agenda não. A Triagem — processos SEM_ACESSO e agenda VISUALIZAR no preset —
 * recebia pela gaveta o TEOR INTEGRAL das publicações e as partes com papel, e
 * pela listagem as partes de cada cartão. Esconder na tela seria conforto, não
 * controle de acesso.
 *
 * Fica o que identifica a atividade: NPU e título do processo. Sem leitor
 * (chamada interna) vale tudo, como antes.
 */
export function leitorVeProcessos(leitor?: Leitor | null): boolean {
  return !leitor || nivelEfetivo(leitor.role, leitor.permissoes, 'processos') !== 'SEM_ACESSO';
}

/**
 * `origem` do andamento que a CONCLUSÃO escreve no processo. Literal igual ao
 * da migração `20260913010300_origem_do_andamento`, que marcou as antigas: os
 * Relatórios contam como "andamento interno" só o que tem origem nula.
 */
export const ORIGEM_ANDAMENTO_CONCLUSAO = 'CONCLUSAO' as const;
/** A conversa que abre o caso pré-processual — idem. */
export const ORIGEM_ANDAMENTO_CONVERSAO = 'CONVERSAO' as const;

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
    /*
      DE QUE LADO ESTAMOS vai junto com o nome.

      O cartão mostrava "SINDICATO DOS EN... × MUNICIPIO DE ELESBÃO VELOSO" e
      quem batia o olho não sabia se a tarefa era nossa ou do município — o
      cabeçalho de um processo não diz de quem é o prazo. `institucional`
      marca a parte que É o sindicato; `filiadoId` marca a parte que é
      filiado nosso. Um dos dois responde a pergunta em toda ação do acervo.
    */
    partes: {
      select: {
        nome: true,
        polo: true,
        filiadoId: true,
        parteExterna: { select: { institucional: true } },
      },
      orderBy: PARTE_ORDER,
    },
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
  // O link da chamada vai no cartão: o ícone de vídeo abre a sala sem passar pela gaveta.
  local: true, linkReuniao: true, descricao: true, urgente: true, iniciadoEm: true, origemAutomatica: true,
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
  // `origem` viaja: a tela precisa distinguir quem foi escolhido por gente de
  // quem o robô anexou como reserva da equipe do caso.
  equipe: { select: { principal: true, origem: true, usuario: responsavelSel }, orderBy: EQUIPE_ORDER },
  /**
   * O CLIPE NO CARTÃO — 21/09/2026.
   *
   * "Existe alguma maneira de sinalizar que a atividade tem anexo ao advogado
   * (...)? Para ao clicar na atividade para detalhar, ele já veja o mais
   * importante primeiro e que não seja obrigado a rolar até embaixo para ver se
   * existem anexos."
   *
   * Os anexos moram no rodapé da gaveta, depois de responsável, equipe, triagem
   * e processo — para saber SE existem era preciso rolar a gaveta inteira. A
   * contagem vem no cartão, então dá para ver antes de abrir: é `_count`, não a
   * lista, porque o cartão só precisa saber se há e quantos.
   */
  _count: { select: { anexos: true } },
  /**
   * O QUE A TRIAGEM ESCREVEU, no cartão.
   *
   * A demanda é a razão de a consulta existir e vivia a dois cliques ("Ver
   * triagem de origem" → gaveta → rolar). Uma linha dela no cartão responde
   * "do que se trata" sem abrir nada. Só os campos da prévia; a triagem inteira
   * continua onde estava.
   */
  atendimento: {
    select: { id: true, numero: true, descricao: true, assunto: true, assuntoOutro: true },
  },
} as const;

/** O cartão de quem não vê Processos: o processo se identifica, as partes não vêm. */
const processoSelSemPartes = {
  select: { id: true, numeroCNJ: true, statusInterno: true, titulo: true, tipoAcao: true },
};
const cardSelectSemPartes = { ...cardSelect, processo: processoSelSemPartes };

/**
 * O CARTÃO QUE ESTE LEITOR PODE RECEBER — para toda resposta que não é a listagem.
 *
 * O corte chegou à listagem e ao detalhe e parou ali: a rota de alertas (que
 * saiu em 14/09/2026) e a resposta de criar, editar, mudar status, concluir,
 * cancelar, remarcar e desfazer seguiam com `cardSelect` inteiro (revisão de
 * 13/09/2026). A Triagem
 * do preset é só VISUALIZAR na agenda, mas uma matriz com agenda EDITAR e
 * processos SEM_ACESSO recebia as partes a cada gesto.
 */
const cardSelectPara = (leitor?: Leitor | null) =>
  leitorVeProcessos(leitor) ? cardSelect : cardSelectSemPartes;

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
  formatarDataHoraBR(d);

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
    // Nasce PENDENTE ou EM_ANDAMENTO — fechar é pelas rotas que pedem desfecho e motivo.
    const situacao = statusDaCriacao(dto.status);
    const linkReuniao = linkReuniaoParaGravar(dto.linkReuniao) ?? null;

    const compromisso = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.compromisso.create({
        data: {
          titulo: dto.titulo.trim(),
          tipo: dto.tipo,
          ...situacao,
          inicio,
          fim,
          local: dto.local?.trim() || null,
          linkReuniao,
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
        participantesIds: equipeIds.map((e) => e.id),
      });
      return tx.compromisso.findUniqueOrThrow({ where: { id: criado.id }, select: cardSelectPara(ctx.leitor) });
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
  private async validarEquipe(
    responsavelId: string,
    outros?: string[],
  ): Promise<{ id: string; nome: string }[]> {
    const ids = [...new Set((outros ?? []).map((i) => i.trim()).filter(Boolean))]
      .filter((id) => id !== responsavelId);
    if (!ids.length) return [];
    const achados = await this.prisma.user.findMany({
      where: { id: { in: ids }, ativo: true },
      // O NOME vem junto porque o histórico nomeia quem entrou — ver
      // `narrarCriacao`. É a mesma consulta; não custa uma ida a mais.
      select: { id: true, nome: true, nomeExibicao: true },
    });
    if (achados.length !== ids.length) {
      const validos = new Set(achados.map((u) => u.id));
      const faltando = ids.filter((i) => !validos.has(i));
      throw new BadRequestException(
        `Participante inválido ou inativo na equipe (${faltando.length}). ` +
          'Remova quem saiu do sistema e tente de novo.',
      );
    }
    // Preserva a ordem em que vieram do formulário.
    const porId = new Map(achados.map((u) => [u.id, u.nomeExibicao || u.nome]));
    return ids.map((id) => ({ id, nome: porId.get(id)! }));
  }

  /**
   * A NARRATIVA NOMEIA QUEM ENTROU — antes só contava.
   *
   * "Atividade criada com equipe de 2 pessoas" não diz QUEM, e o histórico é o
   * único lugar onde isso fica: a equipe muda depois (há na produção um
   * registro de "3 pessoas" numa atividade que hoje tem 2). Quem abrir o
   * histórico para entender uma decisão antiga encontrava um número.
   *
   * Registros antigos não se reescrevem — log é log. Isto vale de agora em
   * diante.
   */
  private narrarCriacao(dto: CreateCompromissoDto, equipe: { nome: string }[]): string {
    if (!equipe.length) return 'Atividade criada.';
    const nomes = equipe.map((e) => e.nome).join(', ');
    return `Atividade criada com equipe de ${equipe.length + 1} pessoas — também atuam: ${nomes}.`;
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
   *
   * MAS NÃO OLHA O RUÍDO (12/09/2026). Dois avisos falsos ensinavam a ignorar o
   * verdadeiro:
   *  · a RESERVA do robô — marcar audiência às 09:30 para um advogado que é
   *    reserva de um "Elaborar manifestação" das 09:00 dizia "já há uma
   *    atividade nesse horário". Reserva não ocupa ninguém (`NAO_E_RESERVA`);
   *  · a TAREFA do robô sem hora marcada — as 9h dela são convenção, não
   *    compromisso com alguém do outro lado. Audiência que o robô cria a partir
   *    do tribunal TEM hora, e continua contando (`TIPOS_COM_HORA`).
   *
   * E OLHA TODO MUNDO DO FORMULÁRIO: `pessoas=id1,id2` soma responsável e quem
   * foi posto para atuar junto — antes só o responsável era conferido.
   */
  async conflitos(params: {
    responsavelId?: string;
    pessoas?: string;
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
    const ids = [
      ...new Set(
        [params.responsavelId, ...(params.pessoas?.split(',') ?? [])]
          .map((x) => x?.trim())
          .filter(Boolean) as string[],
      ),
    ];
    if (!ids.length) return [];

    return this.prisma.compromisso.findMany({
      where: {
        AND: [
          // Só o que ainda vai acontecer: uma atividade concluída ou cancelada
          // não ocupa mais ninguém.
          { status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] } },
          ...(params.ignorarId ? [{ id: { not: params.ignorarId } }] : []),
          {
            OR: ids.flatMap((id) => [
              { responsavelId: id },
              { equipe: { some: { usuarioId: id, ...NAO_E_RESERVA } } },
            ]),
          },
          { NOT: { origemAutomatica: true, tipo: { notIn: [...TIPOS_COM_HORA] } } },
          { inicio: { lt: fim } },
          { fim: { gt: inicio } },
        ],
      },
      orderBy: { inicio: 'asc' },
      take: 10,
      select: {
        id: true, titulo: true, tipo: true, inicio: true, fim: true, local: true,
        filiado: filiadoCard,
        // Com várias pessoas conferidas, o aviso precisa dizer DE QUEM é o choque.
        responsavel: { select: { id: true, nome: true, nomeExibicao: true } },
      },
    });
  }

  async listar(q: ListCompromissosQueryDto, leitor?: Leitor) {
    // Um relógio só para a aba e a janela: às 23h59 as duas não podem discordar do dia.
    const agora = new Date();
    const and = this.filtrosDaListagem(q, leitor);
    // A aba é resolvida AQUI, pela mesma função que o painel usa para contar.
    if (q.recorte) and.push(whereDoRecorte(q.recorte, agora));
    /*
      PRÓXIMAS | ANTERIORES E "CARREGAR MAIS" (14/09/2026, D20 da rodada 3).

      A janela reparte a aba; o cursor continua depois do último item recebido,
      no sentido da janela (Anteriores é decrescente). Tudo entra no mesmo AND,
      e é por isso que `/recortes` conta o mesmo conjunto. Sem os parâmetros, a
      listagem de sempre — crescente e até 500 —, só que agora com o id como
      desempate: o robô grava muitas às 9h em ponto.
    */
    if (q.janela) and.push(whereDaJanela(q.janela, agora));
    if (q.cursor) {
      const cursor = lerCursor(q.cursor);
      if (!cursor) throw new BadRequestException('Cursor inválido.');
      and.push(whereDoCursor(cursor, sentidoDaJanela(q.janela)));
    }

    return this.prisma.compromisso.findMany({
      where: and.length ? { AND: and } : {},
      orderBy: ordemDaListagem(q.janela),
      take: q.limite ?? LIMITE_SEM_PAGINA,
      select: leitorVeProcessos(leitor) ? cardSelect : cardSelectSemPartes,
    });
  }

  /**
   * UM `count()` POR ABA, COM OS MESMOS FILTROS DA LISTA.
   *
   * O contador da aba contava a lista que o navegador tinha recebido — cortada
   * em 500 e sem os filtros do servidor. Aqui cada número sai da mesma função
   * que monta a aba, sobre os mesmos filtros: o número e a lista não podem
   * discordar.
   */
  async contarRecortes(q: ListCompromissosQueryDto, leitor?: Leitor): Promise<ContagemDosRecortes> {
    const agora = new Date();
    const base = this.filtrosDaListagem({ ...q, recorte: undefined }, leitor);
    // Vários pedaços entram LADO A LADO no AND — a mesma forma que `listar`
    // monta com aba + janela, para o número e a lista serem o mesmo conjunto.
    const contar = (...recortes: Prisma.CompromissoWhereInput[]) =>
      this.prisma.compromisso.count({ where: { AND: [...base, ...recortes] } });
    const [hoje, atrasadas, atencao, seteDias, aberto, todos, urgentes, todosAdiante, todosAnteriores] =
      await Promise.all([
        contar(recorteHoje(agora)),
        contar(recorteAtrasadas(agora)),
        contar(recorteAtencao(agora)),
        contar(recorteSeteDias(agora)),
        contar(recorteAberto()),
        contar(recorteTodos(agora)),
        contar({ AND: [recorteAberto(), { urgente: true }] }),
        // As duas metades de Todas, para o seletor "Próximas | Anteriores" (14/09/2026).
        contar(recorteTodos(agora), whereDaJanela('adiante', agora)),
        contar(recorteTodos(agora), whereDaJanela('anteriores', agora)),
      ]);
    return { hoje, atrasadas, atencao, seteDias, aberto, todos, urgentes, todosAdiante, todosAnteriores };
  }

  /** `eu` é quem pede; sem usuário, casa ninguém — nunca a agenda inteira. */
  private quem(valor: string | undefined, usuarioId: string | undefined): string | null {
    const v = valor?.trim();
    if (!v) return null;
    if (v === 'eu') return usuarioId ?? '__sem_usuario__';
    return v;
  }

  /** Os filtros da listagem, sem a aba — `listar` e `contarRecortes` leem os mesmos. */
  private filtrosDaListagem(q: ListCompromissosQueryDto, leitor?: Leitor): Prisma.CompromissoWhereInput[] {
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
    /*
      UM OU VÁRIOS — a mesma regra, aplicada à lista inteira.

      `responsaveis=id1,id2` responde "o que está na mão do Murilo OU da
      Shérad", que é a pergunta de quem coordena e precisa comparar duas
      carteiras sem trocar de filtro duas vezes.
    */
    const pessoas = [
      ...new Set(
        [q.responsavelId, ...(q.responsaveis?.split(',') ?? [])]
          .map((x) => x?.trim())
          .filter(Boolean) as string[],
      ),
    ];
    /*
      SÓ QUEM RESPONDE — "Esperando por: Fulano 4" e a Carga da equipe contam
      por `responsavelId`. Sem este recorte, o link abria responsável OU
      equipe (reserva do robô inclusive) e quem clicava no 4 via 9.
    */
    const somenteResponsavel = q.somenteResponsavel === '1' || q.somenteResponsavel === 'true';
    if (pessoas.length && somenteResponsavel) {
      and.push({ responsavelId: { in: pessoas } });
    } else if (pessoas.length) {
      and.push({
        OR: pessoas.flatMap((id) => [
          { responsavelId: id },
          { equipe: { some: { usuarioId: id } } },
        ]),
      });
    }
    /*
      A RÉGUA DO QUE É DA PESSOA — a mesma do painel e da faixa. O filtro de
      responsável acima continua "pelas duas portas", reserva inclusive, porque
      a coordenação usa para ver tudo em que alguém aparece; "Minhas" é esta.
    */
    const pessoa = this.quem(q.pessoa, leitor?.id);
    if (pessoa) and.push(daPessoa(pessoa));
    const reserva = this.quem(q.reservaDe, leitor?.id);
    if (reserva) and.push(ondeSouReserva(reserva));
    if (q.urgente === 'true') and.push({ urgente: true });
    if (q.filiadoId) and.push({ filiadoId: q.filiadoId });
    const busca = q.busca?.trim();
    if (busca) and.push(filtroDaBusca(busca, { processos: leitorVeProcessos(leitor) }));
    const range: Prisma.DateTimeFilter = {};
    if (q.dataInicio) range.gte = new Date(q.dataInicio);
    if (q.dataFim) range.lte = new Date(q.dataFim);
    if (range.gte || range.lte) and.push({ inicio: range });
    return and;
  }

  async detalhe(id: string, leitor?: Leitor) {
    // Ver `leitorVeProcessos`: sem o módulo, nem o teor da publicação nem as partes.
    const verProcessos = leitorVeProcessos(leitor);
    const compromisso = await this.prisma.compromisso.findUnique({
      where: { id },
      include: {
        /* A contagem vai junto para a gaveta poder dizer "3 anexos" no TOPO, sem
           esperar a seção de documentos carregar lá embaixo (21/09/2026). */
        _count: { select: { anexos: true } },
        // Detalhe expõe mais do filiado (contato) — a tela é de trabalho interno.
        filiado: {
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true,
            telefonePrincipal: true, email: true, formacao: true,
          },
        },
        responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, role: true } },
        /*
          A EQUIPE — e a falta dela aqui fazia o DETALHE mostrar MENOS que a
          lista, que é o contrário do que se espera de uma tela de detalhe.

          `compromissoSelect` (a listagem) pede `equipe`; este `include` não
          pedia. O cartão da agenda empilhava os avatares certos e a gaveta, ao
          abrir o MESMO compromisso, mostrava só o responsável — porque
          `c.equipe` chegava `undefined` e o bloco "Também atuam" nunca
          renderizava. O componente estava pronto; o dado é que não vinha.

          Medido na produção em 10/09/2026: das 89 atividades, **9 têm alguém na
          equipe além do responsável** — nove pessoas que sumiam ao abrir o
          detalhe. O comentário do select da lista já avisava: "sem isto, uma
          audiência com três advogados apareceria como se fosse de um".

          Regra que fica: relação que a LISTA devolve, o DETALHE também devolve.
          Conferi as outras (`filiado`, `responsavel`, `criador`, `processo`) —
          `equipe` era a única que faltava.
        */
        equipe: {
          select: { principal: true, origem: true, usuario: responsavelSel },
          orderBy: EQUIPE_ORDER,
        },
        // Quem REGISTROU a demanda — agora é uma FK, então vem com nome E FOTO
        // numa consulta só (antes era só um id solto, sem como exibir avatar).
        criador: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, role: true } },
        /*
          QUEM FECHOU — e por que estas duas faltavam.

          `concluido_por` e `cancelado_por` guardavam o id desde sempre, mas sem
          FK não havia como trazer o nome; o desfecho aparecia na tela como
          "Peça protocolada às 16:52", sem autor. Num histórico jurídico isso é
          um registro pela metade: dá para saber o QUE foi feito e não POR QUEM.

          `avatarKey` entra junto porque o interceptor global só resolve a foto
          de quem carrega a chave — selecionar só a URL devolveria rosto vazio,
          erro que este módulo já cometeu antes.
        */
        concluidoPorUsuario: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, role: true } },
        canceladoPorUsuario: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, role: true } },
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
            ...(verProcessos
              ? {
                  partes: {
                    select: { id: true, nome: true, polo: true, papel: true, principal: true },
                    orderBy: PARTE_ORDER,
                  },
                }
              : {}),
          },
        },
        /**
         * A PUBLICAÇÃO QUE ORIGINOU OU ENRIQUECEU ESTA ATIVIDADE.
         *
         * Quando o robô cria "Verificação de Intimação / Prazo", a descrição
         * diz o rótulo do ato — "Publicação", "Expedição de documento" — porque
         * é só isso que o DataJud entrega. O TEOR está na publicação do DJEN,
         * que a correlação já vinculou a esta atividade.
         *
         * Sem isto o advogado lia "confira o prazo aplicável" e tinha de abrir
         * o processo, achar a aba Publicações e procurar qual das publicações
         * era aquela. O texto que ele precisa ler para decidir estava a três
         * cliques de distância, ligado no banco e invisível na tela.
         */
        ...(verProcessos
          ? {
        origemComunicacoes: {
          orderBy: { dataDisponibilizacao: 'desc' },
          select: {
            id: true, texto: true, tipoComunicacao: true, nomeOrgao: true,
            dataDisponibilizacao: true, providencia: true, prazoMencionadoDias: true,
            link: true, processoId: true,
            /**
             * QUEM foi intimado, e por qual OAB.
             *
             * O DJEN manda uma cópia por destinatário, e é esta lista que
             * permite dizer "mesma publicação, enviada a 8 advogados" em vez
             * de repetir o teor oito vezes na gaveta. O `link` acima é a chave
             * que agrupa; esta é a informação que o agrupamento resume.
             */
            advogados: true,
          },
        },
            }
          : {}),
        /*
          Triagem de origem: canal, demanda e QUEM registrou (atendente).

          O ASSUNTO veio junto em 13/09/2026: o advogado abria a consulta e só
          via "Consulta Jurídica — NOME"; para saber do que se tratava tinha de
          tocar em "Abrir triagem completa", que é justamente o que não se faz
          no celular na hora da chamada.
        */
        atendimento: {
          select: {
            id: true, numero: true, canal: true, desfecho: true, descricao: true, createdAt: true,
            assunto: true, assuntoOutro: true,
            /*
              O ADVOGADO É AVISADO NO PRÓPRIO LUGAR (15/09/2026, E5 da rodada 4):
              "Ao registrar esta consulta, o atendimento #13 é concluído junto", e
              depois "foi concluído junto com esta consulta". A gaveta precisa da
              situação do atendimento e do carimbo de quem o fechou para dizer
              qual das duas frases vale, sem adivinhar.
            */
            status: true, conclusaoOrigem: true, conclusaoConsultaId: true,
            atendente: { select: { id: true, nome: true, nomeExibicao: true } },
            /*
              OS ARQUIVOS DA TRIAGEM, CONTADOS (24/09/2026).

              "A atividade inclusive tinha 17 anexos, mas não tá avisando no
              card. E nem na triagem."

              Medido: a consulta da EDILENE tem ZERO anexos — os 17 estão no
              ATENDIMENTO #23, que a originou. A gaveta já contava os anexos da
              própria atividade (`_count.anexos`) e mostrava "0", correto e
              inútil: o advogado abria a consulta sem saber que dezessete
              documentos estavam a um clique, dentro da triagem de origem.

              É `_count`, não a lista: o bloco só precisa dizer que existem e
              quantos, e quem quiser abre a triagem completa.
            */
            _count: { select: { anexos: true } },
          },
        },
      },
    });
    if (!compromisso) throw new NotFoundException('Compromisso não encontrado.');

    // `criadoPorNome` continua na resposta por compatibilidade com quem já lia
    // esse campo; a fonte agora é a relação `criador` (que traz também a foto).
    const criadoPorNome =
      compromisso.criador?.nomeExibicao || compromisso.criador?.nome || null;

    /*
      O RESPONSÁVEL ESTÁ POR AQUI? — a pergunta que a gaveta não respondia.

      "Elaborar manifestação", com três advogados de reserva, abria mostrando o
      responsável como se tudo estivesse sob controle — e ele não entrava no
      sistema havia 39 dias. Quem abre a atividade precisa saber disso ali, antes
      de decidir se assume. Só para atividade aberta: da fechada, já não importa.
    */
    const aberta =
      compromisso.status === StatusCompromisso.PENDENTE ||
      compromisso.status === StatusCompromisso.EM_ANDAMENTO;
    const ausenciaDoResponsavel = aberta
      ? ausenciaDe(
          (await ultimosUsosReais(this.prisma, [compromisso.responsavelId])).get(compromisso.responsavelId),
          new Date(),
        )
      : null;

    return { ...compromisso, criadoPorNome, ausenciaDoResponsavel };
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

    /*
      REMARCAÇÃO PELA EDIÇÃO — pela MESMA função do botão (`dadosDaRemarcacao`):
      contador, motivo, data original, volta a PENDENTE e zera o cronômetro.
      Ao minuto, porque o formulário reenvia o início sem os segundos e editar
      só o título de uma tarefa do robô virava remarcação falsa.
    */
    const pedidoInicio = dto.inicio ? new Date(dto.inicio) : null;
    const pedidoFim = dto.fim ? new Date(dto.fim) : null;
    if (
      (pedidoInicio && Number.isNaN(pedidoInicio.getTime())) ||
      (pedidoFim && Number.isNaN(pedidoFim.getTime()))
    ) {
      throw new BadRequestException('Data inválida.');
    }
    const inicioMudou = !!pedidoInicio && !mesmoMinuto(pedidoInicio, atual.inicio);
    /*
      ATIVIDADE FECHADA NÃO SE REMARCA — mas a data dela ainda se CORRIGE.

      Remarcar devolve a PENDENTE e soma o contador: numa audiência concluída
      isso reabriria o que foi fechado com desfecho. A edição sempre permitiu
      acertar o dia de uma atividade já encerrada (lançada com a data errada),
      e é o caminho que a mensagem do botão Remarcar indica. Aqui ela continua:
      grava a data, entra no "o que mudou", e não conta como remarcação.
    */
    const fechada =
      atual.status === StatusCompromisso.CONCLUIDO || atual.status === StatusCompromisso.CANCELADO;
    const remarcacao =
      pedidoInicio && inicioMudou && !fechada
        ? dadosDaRemarcacao(atual, { inicio: pedidoInicio, fim: pedidoFim, via: 'edicao' })
        : null;
    const inicioCorrigido = pedidoInicio && inicioMudou && fechada ? pedidoInicio : null;
    const fimMudou = !remarcacao && !!pedidoFim && !mesmoMinuto(pedidoFim, atual.fim);
    const novoInicio = remarcacao?.data.inicio ?? inicioCorrigido ?? atual.inicio;
    const novoFim = remarcacao?.data.fim ?? (fimMudou && pedidoFim ? pedidoFim : atual.fim);
    if (novoFim < novoInicio) throw new BadRequestException('O fim não pode ser antes do início.');

    // Concluir, cancelar e reabrir não passam por aqui — ver `porta-do-status.util.ts`.
    const situacao = statusPelaEdicao(atual, dto.status);
    const linkReuniao = linkReuniaoParaGravar(dto.linkReuniao);

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
          // Remarcou: a remarcação decide a situação (PENDENTE). Senão, a porta do status.
          ...(remarcacao
            ? remarcacao.data
            : {
                ...situacao,
                ...(inicioCorrigido ? { inicio: inicioCorrigido } : {}),
                ...(fimMudou ? { fim: novoFim } : {}),
              }),
          local: dto.local === undefined ? undefined : dto.local?.trim() || null,
          ...(linkReuniao !== undefined ? { linkReuniao } : {}),
          descricao: dto.descricao === undefined ? undefined : dto.descricao?.trim() || null,
          observacoesInternas: dto.observacoesInternas === undefined ? undefined : dto.observacoesInternas?.trim() || null,
          responsavelId: dto.responsavelId,
          filiadoId: dto.filiadoId === undefined ? undefined : dto.filiadoId || null,
          atendimentoId: dto.atendimentoId === undefined ? undefined : dto.atendimentoId || null,
          processoId: dto.processoId === undefined ? undefined : dto.processoId || null,
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
            : equipeIds.map((e) => e.id),
        });
      }
      return tx.compromisso.findUniqueOrThrow({ where: { id }, select: cardSelectPara(ctx.leitor) });
    });

    // A troca de responsável é a mudança que mais gera dúvida depois ("quem
    // ficou com isso?"), então ela entra no histórico com nome e não só no
    // registro genérico de edição.
    if (dto.responsavelId && dto.responsavelId !== atual.responsavelId) {
      /*
        COM OS DOIS NOMES (14/09/2026). "Responsável alterado." respondia QUE
        mudou e não de quem para quem — justamente a pergunta que traz alguém
        ao histórico. A troca de plantão escreve "Passou da Dra. Shérad para o
        Dr. Murilo" pela mesma linha do tempo; a edição à mão não podia dizer
        menos. Sem o nome (conta apagada), fica a frase de antes.
      */
      const pessoas = await this.prisma.user.findMany({
        where: { id: { in: [atual.responsavelId, dto.responsavelId] } },
        select: { id: true, nome: true, nomeExibicao: true },
      });
      const nomeDe = (uid: string) => {
        const p = pessoas.find((x) => x.id === uid);
        return p ? p.nomeExibicao?.trim() || p.nome : null;
      };
      const deNome = nomeDe(atual.responsavelId);
      const paraNome = nomeDe(dto.responsavelId);
      await this.historiar(
        id,
        'EDITADO',
        deNome && paraNome ? `Responsável alterado: passou de ${deNome} para ${paraNome}.` : 'Responsável alterado.',
        ctx,
        { de: atual.responsavelId, para: dto.responsavelId, deNome, paraNome },
      );
    }

    if (remarcacao) {
      // Trilha da remarcação — a mesma frase e os mesmos dados do botão Remarcar.
      await this.historiar(id, 'REMARCADO', remarcacao.historico.descricao, ctx, remarcacao.historico.metadata);
      await this.auditar(AcaoAuditoria.UPDATE, id, remarcacao.auditoria.descricao, ctx, remarcacao.historico.metadata);
    } else {
      /*
        O QUE MUDOU, CAMPO A CAMPO.

        "Compromisso atualizado: Audiência de instrução" dizia QUE alguém
        mexeu e nada sobre o quê — e essa é a metade da pergunta que traz
        alguém à auditoria. Agora sai "atividade alterada — título e local",
        com os valores no detalhe.

        Nada mudou de verdade? Não vira registro. Salvar o formulário sem
        editar nada não é um fato auditável.
      */
      const alteracoes = diferencaDeCampos(
        atual as unknown as Record<string, unknown>,
        {
          titulo: dto.titulo?.trim(),
          tipo: dto.tipo,
          status: situacao.status,
          local: dto.local,
          linkReuniao,
          descricao: dto.descricao,
          urgente: dto.urgente,
          urgenteMotivo: dto.urgenteMotivo,
          responsavelId: dto.responsavelId,
          filiadoId: dto.filiadoId,
          processoId: dto.processoId,
          inicio: inicioCorrigido ?? undefined,
          fim: fimMudou ? novoFim : undefined,
        },
      );
      await this.historiar(
        id, 'EDITADO', fraseDaAlteracao('Dados da atividade alterados', alteracoes), ctx, { alteracoes },
      );
      if (!alteracoes.length) marcarNadaMudou();
      if (alteracoes.length) {
        await this.auditar(
          AcaoAuditoria.UPDATE,
          id,
          fraseDaAlteracao(`Atividade "${compromisso.titulo}" alterada`, alteracoes),
          ctx,
          { alteracoes },
        );
      }
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
      select: {
        id: true, status: true, iniciadoEm: true, titulo: true,
        // Para devolver o atendimento que esta consulta fechou (ver `reabrirAtendimentoFechadoPelaConsulta`).
        atendimentoId: true, concluidoEm: true,
      },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');

    if (dto.status === atual.status) return this.cartao(id, ctx.leitor);

    // As mesmas frases da edição — as duas portas recusam igual (porta-do-status.util.ts).
    if (dto.status === StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException(FRASE_CONCLUIR_PELA_ROTA);
    }
    if (dto.status === StatusCompromisso.CANCELADO) {
      throw new BadRequestException(FRASE_CANCELAR_PELA_ROTA);
    }
    this.garantirTransicao(atual.status, dto.status);

    const reabrindo =
      atual.status === StatusCompromisso.CONCLUIDO || atual.status === StatusCompromisso.CANCELADO;

    // Ao INICIAR, carimba o horário para o cronômetro — só na 1ª vez.
    // Ao voltar para PENDENTE, zera o cronômetro.
    let iniciadoEm: Date | null | undefined;
    if (dto.status === StatusCompromisso.EM_ANDAMENTO && !atual.iniciadoEm) iniciadoEm = new Date();
    else if (dto.status === StatusCompromisso.PENDENTE) iniciadoEm = null;

    /*
      NUMA TRANSAÇÃO, E CONDICIONAL (15/09/2026, E1 da rodada 4). Reabrir a
      consulta concluída devolve o atendimento que ela fechou sozinha, e as duas
      gravações andam juntas: consulta reaberta com o atendimento concluído por
      ela deixaria a triagem sem nada na fila e o advogado sem o atendimento. A
      gravação confere a situação lida, como o desfazer e o cancelar já faziam:
      quem chega segundo ouve "abra de novo", e não regrava por cima.
    */
    const { compromisso, atendimentoReaberto } = await comFraseDeCorrida(FRASE_MUDOU_NO_MEIO, () => this.prisma.$transaction(async (tx) => {
      // Reabrir a concluída mexe no atendimento: trava ele antes da consulta, na ordem da triagem (15/09/2026).
      if (atual.status === StatusCompromisso.CONCLUIDO) await travarAtendimentoAntesDaConsulta(tx, atual.atendimentoId);
      const r = await tx.compromisso.updateMany({
        where: { id, status: atual.status },
        data: {
          status: dto.status,
          ...(iniciadoEm !== undefined ? { iniciadoEm } : {}),
          // Reabrir limpa o fechamento anterior: manter um desfecho antigo num
          // evento que voltou a estar aberto faria a tela mentir. O histórico
          // permanece na Auditoria. A CATEGORIA também sai: ela ficava para trás
          // e a atividade reaberta seguia contada em "cancelada por quê" nos
          // relatórios.
          ...(reabrindo
            ? {
                desfecho: null, desfechoObs: null, concluidoEm: null, concluidoPor: null,
                canceladoCategoria: null, canceladoMotivo: null, canceladoEm: null, canceladoPor: null,
              }
            : {}),
        },
      });
      if (r.count !== 1) throw new BadRequestException(FRASE_MUDOU_NO_MEIO);
      const atendimentoReaberto = atual.status === StatusCompromisso.CONCLUIDO
        ? await reabrirAtendimentoFechadoPelaConsulta(tx, {
            compromissoId: id, atendimentoId: atual.atendimentoId, concluidoEm: atual.concluidoEm,
          })
        : null;
      const compromisso = await tx.compromisso.findUniqueOrThrow({ where: { id }, select: cardSelectPara(ctx.leitor) });
      return { compromisso, atendimentoReaberto };
    }));

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
    const motivo = dto.motivo?.trim() || null;
    const narrativa = reabrindo
      ? `Reaberta (estava ${atual.status === StatusCompromisso.CONCLUIDO ? 'concluída' : 'cancelada'})` +
        (motivo ? `: ${motivo}` : '.')
      : dto.status === StatusCompromisso.EM_ANDAMENTO
        ? 'Iniciada.'
        : 'Voltou para pendente.';
    await this.historiar(
      id,
      reabrindo ? 'REABERTO' : dto.status === StatusCompromisso.EM_ANDAMENTO ? 'INICIADO' : 'EDITADO',
      narrativa,
      ctx,
      {
        de: atual.status,
        para: dto.status,
        ...(motivo ? { motivo } : {}),
        ...(atendimentoReaberto ? { atendimentoReaberto: atendimentoReaberto.atendimentoId } : {}),
      },
    );
    await this.auditarAtendimento(atendimentoReaberto, ctx);
    return { ...compromisso, atendimentoReaberto: resumoDoAtendimento(atendimentoReaberto) };
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
        // O seguimento herda `atendimentoId` e não fecha o atendimento — ver `concluirAtendimentoPelaConsulta`.
        origemDesfechoId: true,
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

    if (opcao.acao === 'VINCULAR_PROCESSO') {
      if (!dto.processoId) throw new BadRequestException('Selecione o processo a vincular.');
      processoId = await this.processoDoFiliado(dto.processoId, atual.filiadoId);
    }

    /*
      O CASO PRÉ-PROCESSUAL NASCE DENTRO DA TRANSAÇÃO DA CONCLUSÃO (15/09/2026).
      Ele nascia antes, numa transação própria que já comitava. Se a triagem
      cancelava a consulta nesse meio tempo, a gravação condicional abaixo recusava
      ("abra de novo") e o processo ficava no acervo, ligado ao filiado e ao
      atendimento, com a consulta cancelada e sem conclusão. Dois toques em "Virou
      processo novo" criavam dois processos. Aqui só se valida (advogado, equipe,
      categoria); a criação vem depois de a consulta ser gravada, e cai junto.
    */
    const preparoDoCaso = opcao.acao === 'CRIAR_PROCESSO' ? await this.prepararPreProcessual(id, atual, dto) : null;

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
    const gravarAndamento = !!processoId && !preparoDoCaso;
    const agora = new Date();

    /*
      RECONCLUIR SUBSTITUI O ANDAMENTO, EM VEZ DE EMPILHAR.

      Reabrir e concluir de novo gravava um segundo "X — Houve acordo" na linha
      do tempo do processo, às vezes com outro texto. O cuidado que o seguimento
      já tinha (substituir, não empilhar) não tinha chegado ao andamento. A
      conclusão anota no histórico o id do andamento que escreveu; a seguinte
      reescreve aquele — ou o apaga, se o novo desfecho não escreve andamento.
      Só toca a nota com origem CONCLUSAO: o que alguém lançou à mão não é eco.
    */
    const andamentoAnteriorId = andamentoDaConclusao(await this.ultimaConclusao(id));

    const { compromisso, seguimento, substituidas, andamentoId, andamentoSubstituido, atendimento, preProcessualCriado } =
      await comFraseDeCorrida(FRASE_MUDOU_NO_MEIO, () => this.prisma.$transaction(async (tx) => {
      /*
        PRIMEIRO O ATENDIMENTO, DEPOIS A CONSULTA (15/09/2026), a mesma ordem do
        fechamento pela triagem: ver `travarAtendimentoAntesDaConsulta`. Vale
        também para o seguimento, que não fecha o atendimento mas pode gravar nele
        o processo criado.
      */
      await travarAtendimentoAntesDaConsulta(tx, atual.atendimentoId);
      /*
        A GRAVAÇÃO CONFERE A SITUAÇÃO LIDA (15/09/2026). Era um `update` por id: a
        triagem que cancelava a consulta no mesmo instante perdia o cancelamento
        em silêncio, e agora o cancelamento de lá também decide o atendimento.
        Quem chega segundo ouve "abra de novo".
      */
      const gravada = await tx.compromisso.updateMany({
        where: { id, status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] } },
        data: {
          status: StatusCompromisso.CONCLUIDO,
          desfecho: dto.desfecho,
          desfechoObs: obs,
          concluidoEm: agora,
          concluidoPor: ctx.userId ?? null,
          processoId,
        },
      });
      if (gravada.count !== 1) throw new BadRequestException(FRASE_MUDOU_NO_MEIO);

      // Só com a consulta gravada o caso nasce, e na mesma transação: recusa acima, nenhum processo.
      const preProcessualCriado = preparoDoCaso ? await this.criarPreProcessual(tx, id, atual, preparoDoCaso, ctx) : null;
      if (preProcessualCriado) {
        processoId = preProcessualCriado.id;
        await tx.compromisso.update({ where: { id }, data: { processoId } });
      }

      /*
        O ATENDIMENTO DE ORIGEM FECHA JUNTO (15/09/2026, E1 da rodada 4), com o
        MESMO instante gravado na consulta, que é o carimbo do desfazer. A regra
        nunca lança: se o atendimento não pode fechar, a consulta fecha assim
        mesmo e o motivo vai para o histórico abaixo.
      */
      const atendimento = await concluirAtendimentoPelaConsulta(tx, {
        consulta: { id, atendimentoId: atual.atendimentoId, origemDesfechoId: atual.origemDesfechoId },
        desfecho: dto.desfecho,
        rotuloDesfecho: opcao.label,
        desfechoObs: obs,
        autorId: ctx.userId ?? null,
        agora,
      });
      const atualizado = await tx.compromisso.findUniqueOrThrow({ where: { id }, select: cardSelectPara(ctx.leitor) });

      const andamentoAntigo = andamentoAnteriorId
        ? await tx.movimentacaoInterna.findFirst({
            where: { id: andamentoAnteriorId, origem: ORIGEM_ANDAMENTO_CONCLUSAO },
            select: { id: true },
          })
        : null;
      let andamentoId: string | null = null;
      if (gravarAndamento) {
        const andamento = {
          processoId: processoId!,
          tipo: tipoAndamento(atual.tipo, opcao.alerta),
          descricao: `${atual.titulo} — ${opcao.label}.${obs ? `\n${obs}` : ''}`,
          // A audiência de quarta concluída na sexta pertence à quarta. É para
          // isto que `dataFato` existe.
          dataFato: atual.inicio,
          autorId: ctx.userId ?? null,
        };
        if (andamentoAntigo) {
          await tx.movimentacaoInterna.update({ where: { id: andamentoAntigo.id }, data: andamento });
          andamentoId = andamentoAntigo.id;
        } else {
          const criado = await tx.movimentacaoInterna.create({
            // Eco da conclusão, não lançamento de gente: fora do "andamentos internos" dos Relatórios.
            // O literal fica escrito aqui (a varredura dos Relatórios lê o ponto de escrita); o
            // `satisfies` amarra à constante que o desfazer e a reconclusão usam para achar a nota.
            data: { ...andamento, origem: 'CONCLUSAO' satisfies typeof ORIGEM_ANDAMENTO_CONCLUSAO },
            select: { id: true },
          });
          andamentoId = criado.id;
        }
      } else if (andamentoAntigo) {
        await tx.movimentacaoInterna.delete({ where: { id: andamentoAntigo.id } });
      }
      const andamentoSubstituido = !!andamentoAntigo;

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

      const substituidas = anteriores.map((a) => a.id);
      if (!criarSeguimento) return { compromisso: atualizado, seguimento: null, substituidas, andamentoId, andamentoSubstituido, atendimento, preProcessualCriado };

      // Dia útil, nove da manhã de Teresina — a mesma conta que a prévia mostrou.
      const inicio = dto.seguimento?.inicio
        ? new Date(dto.seguimento.inicio)
        : sugeridoParaOSeguimento(spec!.emDias, agora);
      const novo = await tx.compromisso.create({
        data: {
          titulo: dto.seguimento?.titulo?.trim() || tituloDoSeguimento(spec!.titulo, atual.titulo),
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
      /*
        O SEGUIMENTO LEVA QUEM ESTAVA NA ATIVIDADE — não só o responsável.

        Uma reunião feita a dois gerava tarefa de um. Entra quem foi posto na
        atividade por gente; a reserva do robô, não (ela não é da pessoa, ver
        `daPessoa`), nem quem saiu do sistema.
      */
      const participantes = await tx.compromissoResponsavel.findMany({
        where: { compromissoId: id, principal: false, ...NAO_E_RESERVA, usuario: { ativo: true } },
        select: { usuarioId: true },
      });
      await sincronizarEquipe(tx, novo.id, {
        principalId: responsavelSeguimento,
        participantesIds: participantes.map((p) => p.usuarioId),
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
      return { compromisso: atualizado, seguimento: novo, substituidas, andamentoId, andamentoSubstituido, atendimento, preProcessualCriado };
    }));

    // A auditoria do caso, depois do commit: nunca registra um processo que a transação desfez.
    if (preProcessualCriado) {
      await this.audit.registrar({
        userId: ctx.userId ?? null,
        acao: AcaoAuditoria.CREATE,
        entidade: 'Processo',
        entidadeId: preProcessualCriado.id,
        descricao: `Caso aberto em fase PRÉ-PROCESSUAL a partir da atividade "${atual.titulo}"`,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { compromissoId: id, rascunho: true },
      });
    }

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
        origem: dto.origem ?? null,
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
      /*
        O QUE ESTA CONCLUSÃO FEZ — é daqui que o desfazer decide se pode (e o
        que desfaz), e daqui que a próxima conclusão acha o andamento para
        substituir. `concluidoEm` repete o carimbo gravado na atividade: é a
        prova de que este registro é o da conclusão vigente.
      */
      {
        desfecho: dto.desfecho,
        de: atual.status,
        origem: dto.origem ?? null,
        concluidoEm: agora.toISOString(),
        preProcessualCriado: preProcessualCriado?.id ?? null,
        seguimentoCriado: seguimento?.id ?? null,
        processoAntes: atual.processoId ?? null,
        processoDepois: processoId ?? null,
        substituidas,
        andamentoId,
        andamentoSubstituido,
        /*
          O QUE ACONTECEU COM O ATENDIMENTO, carimbado (E1). "Não fechou" também
          é decisão, com o motivo: sem ele, a triagem que encontra o atendimento
          aberto depois de uma consulta registrada não saberia se foi regra ou
          defeito (memória "carimbe toda decisão").
        */
        atendimento: !atendimento
          ? null
          : 'naoFechou' in atendimento
            ? { fechado: false, motivo: atendimento.naoFechou }
            : { fechado: true, id: atendimento.atendimentoId, numero: atendimento.numero },
      },
    );
    const atendimentoConcluido = atendimento && 'auditoria' in atendimento ? atendimento : null;
    await this.auditarAtendimento(atendimentoConcluido, ctx);
    return {
      ...compromisso,
      preProcessualCriado,
      /** Nome antigo na resposta — a tela em produção ainda lê por ele. */
      rascunhoCriado: preProcessualCriado,
      seguimentoCriado: seguimento,
      /** O atendimento da triagem que fechou junto ("Atendimento #13 concluído junto."), ou nulo. */
      atendimentoConcluido: resumoDoAtendimento(atendimentoConcluido),
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
    /*
      A CONFERÊNCIA E A ESCRITA moram em `cancelarCompromissoEmTransacao` desde
      14/09/2026 (D20 da rodada 3): o fechamento do atendimento cancela a
      consulta pela MESMA regra, dentro da transação dele. Aqui ficam só o que é
      desta rota — o cartão pelo leitor, e o histórico e a auditoria depois do
      commit. As recusas e as frases continuam as de sempre.
    */
    const { compromisso, feito } = await this.prisma.$transaction(async (tx) => {
      const feito = await cancelarCompromissoEmTransacao(tx, {
        id,
        categoria: dto.categoria,
        motivo: dto.motivo,
        autorId: ctx.userId ?? null,
      });
      const compromisso = await tx.compromisso.findUniqueOrThrow({ where: { id }, select: cardSelectPara(ctx.leitor) });
      return { compromisso, feito };
    });

    await this.auditar(AcaoAuditoria.UPDATE, id, feito.auditoria.descricao, ctx, feito.auditoria.metadata);
    await this.historiar(id, feito.historico.acao, feito.historico.descricao, ctx, feito.historico.metadata);
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
      await dispensarMovimentacaoLigada(tx, compromissoId, motivo);
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

    // A mesma regra da edição: contador, motivo, data original, PENDENTE, cronômetro zerado.
    const inicio = new Date(dto.inicio);
    const remarcacao = dadosDaRemarcacao(atual, {
      inicio,
      fim: dto.fim ? new Date(dto.fim) : null,
      motivo: dto.motivo,
      via: 'remarcar',
    });
    if (!remarcacao) throw new BadRequestException('A nova data é igual à atual.');
    recusarRemarcacaoParaOPassado(inicio);

    const compromisso = await this.prisma.compromisso.update({
      where: { id },
      data: remarcacao.data,
      select: cardSelectPara(ctx.leitor),
    });

    await this.auditar(AcaoAuditoria.UPDATE, id, remarcacao.auditoria.descricao, ctx, remarcacao.historico.metadata);
    // O botão não escrevia no histórico: a gaveta dizia "Remarcado" e não dizia quando nem quem.
    await this.historiar(id, 'REMARCADO', remarcacao.historico.descricao, ctx, remarcacao.historico.metadata);
    return compromisso;
  }

  async remover(id: string, ctx: Ctx) {
    const c = await this.prisma.compromisso.findUnique({ where: { id }, select: { id: true, titulo: true } });
    if (!c) throw new NotFoundException('Compromisso não encontrado.');
    await this.prisma.compromisso.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, id, `Compromisso excluído: ${c.titulo}`, ctx, {});
    return { ok: true };
  }

  /**
   * DESFAZER A CONCLUSÃO — as regras moram em `podeDesfazerConclusao`.
   *
   * Devolve a situação de antes, limpa o desfecho e apaga o andamento que ESTA
   * conclusão escreveu no processo (só o de origem CONCLUSAO). A atualização
   * confere de novo, dentro da transação, que a atividade continua concluída
   * por quem pede: dois toques em "Desfazer" não desfazem duas vezes.
   */
  async desfazerConclusao(id: string, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({
      where: { id },
      select: {
        id: true, status: true, titulo: true, desfecho: true, concluidoEm: true, concluidoPor: true,
        atendimentoId: true,
      },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');

    const decisao = podeDesfazerConclusao(atual, await this.ultimaConclusao(id), ctx.userId);
    if (!decisao.ok) throw new BadRequestException(decisao.motivo);

    const { compromisso, atendimentoReaberto } = await comFraseDeCorrida(FRASE_MUDOU_NO_MEIO, () => this.prisma.$transaction(async (tx) => {
      // O desfazer devolve o atendimento: trava ele antes da consulta, na ordem da triagem (15/09/2026).
      await travarAtendimentoAntesDaConsulta(tx, atual.atendimentoId);
      const r = await tx.compromisso.updateMany({
        where: { id, status: StatusCompromisso.CONCLUIDO, concluidoPor: ctx.userId },
        data: {
          status: decisao.voltarPara,
          desfecho: null,
          desfechoObs: null,
          concluidoEm: null,
          concluidoPor: null,
        },
      });
      if (r.count !== 1) throw new BadRequestException('Esta atividade não está mais concluída.');
      if (decisao.andamentoId) {
        await tx.movimentacaoInterna.deleteMany({
          where: { id: decisao.andamentoId, origem: ORIGEM_ANDAMENTO_CONCLUSAO },
        });
      }
      // O atendimento que esta conclusão fechou volta a aguardar a consulta — só se o carimbo bater (E1).
      const atendimentoReaberto = await reabrirAtendimentoFechadoPelaConsulta(tx, {
        compromissoId: id, atendimentoId: atual.atendimentoId, concluidoEm: atual.concluidoEm,
      });
      const compromisso = await tx.compromisso.findUniqueOrThrow({ where: { id }, select: cardSelectPara(ctx.leitor) });
      return { compromisso, atendimentoReaberto };
    }));

    const rotulo = DESFECHO_LABEL[atual.desfecho ?? ''] ?? atual.desfecho ?? 'sem desfecho';
    const metadata = {
      via: 'desfazer',
      desfecho: atual.desfecho,
      de: StatusCompromisso.CONCLUIDO,
      para: decisao.voltarPara,
      andamentoRemovido: decisao.andamentoId,
      atendimentoReaberto: atendimentoReaberto?.atendimentoId ?? null,
    };
    await this.auditar(AcaoAuditoria.UPDATE, id, `Conclusão desfeita (${rotulo}): ${atual.titulo}`, ctx, metadata);
    // REABERTO, e não uma ação nova: a linha do tempo da tela já sabe mostrar
    // reabertura; o `via` distingue o desfazer de quem reabriu pela gaveta.
    await this.historiar(id, 'REABERTO', `Conclusão desfeita logo depois de registrada (${rotulo}).`, ctx, metadata);
    await this.auditarAtendimento(atendimentoReaberto, ctx);
    return { ...compromisso, atendimentoReaberto: resumoDoAtendimento(atendimentoReaberto) };
  }

  /**
   * A auditoria do atendimento que a consulta fechou ou devolveu, depois do
   * commit e com quem agiu. Vai para a entidade Atendimento, e não para a
   * atividade: é na ficha do atendimento que se procura "quem fechou o #13".
   */
  private async auditarAtendimento(mexido: AtendimentoMexido | null, ctx: Ctx) {
    if (!mexido) return;
    /*
      Depois do commit a consulta já está registrada. Uma falha ao gravar a
      auditoria do ATENDIMENTO não pode virar erro na tela do advogado, que
      concluiria de novo uma consulta já concluída. Fica no log.
    */
    try {
      await this.audit.registrar({
        ...mexido.auditoria,
        userId: ctx.userId ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    } catch (e) {
      this.logger.warn(`Auditoria do atendimento ${mexido.atendimentoId} não gravada: ${(e as Error).message}`);
    }
  }

  /** O registro da última conclusão desta atividade, como o histórico guardou. */
  private async ultimaConclusao(compromissoId: string): Promise<RegistroDaConclusao | null> {
    const h = await this.prisma.compromissoHistorico.findFirst({
      where: { compromissoId, acao: 'CONCLUIDO' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (!h) return null;
    const metadata = h.metadata && typeof h.metadata === 'object' && !Array.isArray(h.metadata)
      ? (h.metadata as RegistroDaConclusao['metadata'])
      : null;
    return { metadata };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /*
    `dispensarMovimentacaoLigada` mora em `cancelamento-em-transacao.ts` desde
    14/09/2026, com o porquê inteiro: o fechamento do atendimento cancela a
    consulta pela mesma regra, e duas cópias divergiriam.
  */

  /** Recarrega o cartão (usado quando a ação é um no-op e nada foi escrito). */
  private async cartao(id: string, leitor?: Leitor) {
    const c = await this.prisma.compromisso.findUnique({ where: { id }, select: cardSelectPara(leitor) });
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
   *
   * Em duas metades desde 15/09/2026: `prepararPreProcessual` valida e lê fora da
   * transação; `criarPreProcessual` grava DENTRO da transação da conclusão, depois
   * da gravação condicional da consulta (ver `concluir`).
   */
  private async prepararPreProcessual(
    compromissoId: string,
    atividade: AtividadeDoCaso,
    dto: ConcluirCompromissoDto,
  ): Promise<PreparoDoCaso> {
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
    return { advogadoId, equipeCaso, titulo, observacao, categoria, assunto: nova.assunto?.trim() || null };
  }

  /** A metade que grava: sempre com o `tx` da conclusão, que desfaz tudo se a consulta recusar. */
  private async criarPreProcessual(
    tx: Prisma.TransactionClient,
    compromissoId: string,
    atividade: AtividadeDoCaso,
    preparo: PreparoDoCaso,
    ctx: Ctx,
  ): Promise<{ id: string; titulo: string | null }> {
    const { advogadoId, equipeCaso, titulo, observacao, categoria } = preparo;
      const p = await tx.processo.create({
        data: {
          numeroCNJ: null, // ainda não ajuizado — é o que define o pré-processual
          titulo,
          assuntoPrincipal: preparo.assunto,
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
            // A conversa que abriu o caso, não um andamento lançado pela ficha.
            origem: 'CONVERSAO' satisfies typeof ORIGEM_ANDAMENTO_CONVERSAO,
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
   * CORRIGIR O DESFECHO SEM REABRIR — 21/09/2026.
   *
   * "Quero que para reabrir, abra um modal e não somente reabra. Se eu tiver
   * reaberto, no caso, eu tenho que dá uma conclusão de novo ou tem opção
   * melhor?" — o dono. Tem, e é esta.
   *
   * REABRIR E CORRIGIR SÃO COISAS DIFERENTES. Reabrir é para quando o TRABALHO
   * voltou: a atividade sai de "Concluído", volta para a fila e `mudarStatus`
   * limpa `desfecho`, `desfechoObs`, `concluidoEm` e `concluidoPor` — de
   * propósito, porque um evento aberto com desfecho velho faria a tela mentir.
   * Só que quem errou o RÓTULO não quer nada disso: quer trocar a palavra e
   * seguir. Pelo caminho antigo ele perdia a data e o autor da conclusão
   * original, o item voltava para a fila de alguém e, sendo consulta, o
   * atendimento que ela fechou reabria junto.
   *
   * O QUE ESTA ROTA NÃO TOCA, e é o ponto: status, `concluidoEm`,
   * `concluidoPor`, e todo efeito que a conclusão já produziu — o seguimento
   * criado, o processo aberto, o atendimento fechado. Esses são FATOS. O
   * desfecho é o rótulo que se deu a eles, e rótulo se corrige.
   *
   * E NÃO DISPARA EFEITO NOVO: trocar para um desfecho que CRIA seguimento não
   * cria seguimento nenhum. Quem quiser o efeito conclui de novo, pela porta
   * que existe para isso. Sem essa trava, corrigir um rótulo abriria trabalho
   * para outra pessoa em silêncio.
   */
  async corrigirDesfecho(id: string, dto: CorrigirDesfechoDto, ctx: Ctx) {
    const atual = await this.prisma.compromisso.findUnique({
      where: { id },
      select: { id: true, tipo: true, status: true, titulo: true, desfecho: true, desfechoObs: true },
    });
    if (!atual) throw new NotFoundException('Compromisso não encontrado.');
    if (atual.status !== StatusCompromisso.CONCLUIDO) {
      throw new BadRequestException('Só dá para corrigir o desfecho de uma atividade concluída.');
    }

    // A MESMA validação da conclusão: o desfecho pertence ao TIPO da atividade.
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
        `Descreva o que aconteceu — "${opcao.label}" exige a observação.`,
      );
    }
    if (opcao.slug === atual.desfecho && obs === (atual.desfechoObs ?? null)) {
      return this.cartao(id, ctx.leitor);
    }

    /*
      GRAVAÇÃO CONDICIONAL, como o resto do módulo: se alguém reabriu a
      atividade enquanto este modal estava aberto, a correção não pode cair
      sobre um evento que já voltou a estar aberto.
    */
    const r = await this.prisma.compromisso.updateMany({
      where: { id, status: StatusCompromisso.CONCLUIDO },
      data: { desfecho: opcao.slug, desfechoObs: obs },
    });
    if (r.count !== 1) throw new BadRequestException(FRASE_MUDOU_NO_MEIO);

    const antes = DESFECHO_LABEL[atual.desfecho ?? ''] ?? atual.desfecho ?? 'sem desfecho';
    await this.historiar(
      id,
      'DESFECHO_CORRIGIDO',
      `Desfecho corrigido: "${antes}" passou a "${opcao.label}".`,
      ctx,
      { de: atual.desfecho, para: opcao.slug, obsAnterior: atual.desfechoObs ?? null },
    );
    return this.cartao(id, ctx.leitor);
  }

  /**
   * O LEMBRETE SEMANAL DO QUE FICOU PARA TRÁS — 21/09/2026.
   *
   * "Queria uma animação bem bonita e suave para os advogados que estão com
   * atividades atrasadas, que aparecesse ao menos 1 vez por semana. Como se
   * fosse um POP-UP assim que ele loga no sistema listando as atividades dele
   * que estão atrasadas e dizendo que eles devem concluir." — o dono.
   *
   * QUATRO REGRAS, e três delas existem para o lembrete não virar cabeçalho:
   *
   * 1. SÓ QUEM TEM ATRASADA. Nada atrasado, nada na tela. Um pop-up que abre
   *    todo dia para dizer "está tudo bem" é o que ensina a fechar sem ler.
   * 2. UMA VEZ POR SEMANA, por PESSOA (`avisoAtrasadasEm`). Ver o lembrete
   *    carimba a data; sete dias depois ele volta, se ainda houver atraso.
   * 3. É O ESCOPO DELA. A mesma régua `daPessoa` da agenda e do painel: o que
   *    ela responde ou o que a equipe dela responde com ela dentro. Ninguém é
   *    cobrado pelo atraso de outro.
   * 4. QUEM NÃO VÊ AGENDA NÃO RECEBE. O corte é no servidor, como todo o resto.
   *
   * E ELE NÃO ACUSA PERDA DE PRAZO. O sistema conhece a data que alguém marcou
   * na agenda, não o prazo processual — "ficou para trás" é o que o dado diz, e
   * é a mesma palavra que o resto do sistema usa.
   */
  async avisoDeAtrasadas(user: AuthUser) {
    const vazio = { mostrar: false, total: 0, itens: [] as unknown[] };
    if (nivelEfetivo(user.role, user.permissoes, 'agenda') === 'SEM_ACESSO') return vazio;

    const eu = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { avisoAtrasadasEm: true },
    });
    const agora = new Date();
    const visto = eu?.avisoAtrasadasEm;
    const naSemana =
      !!visto && agora.getTime() - visto.getTime() < DIAS_ENTRE_AVISOS * 24 * 3_600_000;
    if (naSemana) return vazio;

    const meu = daPessoa(user.id);
    const where = { ...meu, ...recorteAtrasadas(agora) };
    const [total, itens] = await Promise.all([
      this.prisma.compromisso.count({ where }),
      this.prisma.compromisso.findMany({
        where,
        orderBy: { inicio: 'asc' },
        // Cinco linhas: o suficiente para reconhecer o trabalho, e pouco o
        // bastante para caber num telefone sem virar uma lista para rolar.
        take: 5,
        select: {
          id: true, titulo: true, tipo: true, inicio: true, urgente: true,
          filiado: { select: { nomeCompleto: true } },
          processo: { select: { numeroCNJ: true } },
        },
      }),
    ]);
    if (!total) return vazio;
    return { mostrar: true, total, itens };
  }

  /**
   * "JÁ VI" — e é o próprio ato de mostrar que carimba, não um botão.
   *
   * Se o carimbo dependesse de a pessoa clicar em algum lugar, fechar no X ou
   * no Esc faria o lembrete voltar no próximo login, todo dia, até alguém
   * acertar o botão certo. O que ele promete é "uma vez por semana", e é isso
   * que a data grava.
   */
  async marcarAvisoDeAtrasadasVisto(user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { avisoAtrasadasEm: new Date() },
    });
    return { ok: true };
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

  /**
   * A PORTA DO HISTÓRICO PARA QUEM ESCREVE NA AGENDA DE FORA DELA (14/09/2026).
   *
   * O fechamento do atendimento cancela a consulta e a troca de plantão passa
   * a consulta a outra pessoa — escritas na agenda que moram em outros módulos.
   * A linha do tempo da atividade tem de contar as duas, com o nome de quem
   * agiu congelado, e pelo mesmo `historiar` desta classe: nunca derruba quem
   * chamou, e por isso vai DEPOIS do commit, fora da transação.
   */
  async registrarNoHistorico(
    compromissoId: string,
    registro: {
      acao: string;
      descricao: string;
      metadata?: Prisma.InputJsonValue;
      autorId?: string | null;
      autorNome?: string | null;
    },
  ): Promise<void> {
    await this.historiar(
      compromissoId,
      registro.acao,
      registro.descricao,
      { userId: registro.autorId ?? undefined, nome: registro.autorNome ?? undefined },
      registro.metadata,
    );
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
