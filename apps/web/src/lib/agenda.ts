import { api } from './api';
import { CORES_PALETA, PALETA, type ClassesCor, type CorPaleta } from './paleta-cores';
import { V } from '@/lib/vocabulario';
import { rotuloCurtoDoDia } from './dia-curto';

/** Mora em lib/dia-curto desde 15/09/2026, para Agenda e Escala lerem a mesma. */
export { rotuloCurtoDoDia };

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** O tipo é um slug de TipoEvento (cadastrável) — texto livre. */
export type TipoCompromisso = string;
export type StatusCompromisso = 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO';

/** Tipo de evento cadastrável (config da Agenda). */
export interface TipoEventoItem {
  id: string;
  slug: string;
  nome: string;
  cor: string; // chave de paleta
  ordem: number;
  ativo: boolean;
  sistema: boolean;
}

export interface FiliadoCard {
  id: string;
  nomeCompleto: string;
  matricula: string;
}
export interface Responsavel {
  id: string;
  nome: string;
  nomeExibicao?: string | null;
  role?: string;
  avatarUrl?: string | null;
}
/**
 * O QUE JÁ OCUPA A AGENDA DE ALGUÉM NUM INTERVALO.
 *
 * Consultado enquanto o formulário é preenchido — descobrir o choque depois de
 * salvar significa voltar, apagar e refazer. Não bloqueia: sobreposição
 * legítima existe, e recusar obrigaria a equipe a mentir a data para conseguir
 * gravar.
 */
export interface ChoqueDeAgenda {
  id: string;
  titulo: string;
  tipo: string;
  inicio: string;
  fim: string;
  local: string | null;
  filiado: { id: string; nomeCompleto: string; matricula: string | null } | null;
}

export async function conflitosDeAgenda(p: {
  responsavelId: string;
  inicio: string;
  fim: string;
  ignorarId?: string;
  /**
   * Responsável e participantes, separados por vírgula. Quem vai "atuar junto"
   * também tem agenda: conferir só o responsável deixava passar o choque do
   * segundo advogado. A API antiga ignora o campo e confere `responsavelId`.
   */
  pessoas?: string;
}): Promise<ChoqueDeAgenda[]> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) if (v) params[k] = String(v);
  return (await api.get('/compromissos/conflitos', { params })).data;
}

export interface ProcessoRef {
  id: string;
  /** Nulo em processos RASCUNHO (ainda sem NPU). */
  numeroCNJ: string | null;
  statusInterno?: string;
  titulo?: string | null;
  tipoAcao?: 'INDIVIDUAL' | 'INSTITUCIONAL';
  /**
   * Partes do processo, JÁ ORDENADAS com a principal de cada polo primeiro
   * (`PARTE_ORDER` no back). É esse contrato que permite ao cartão pegar
   * `find(polo === 'ATIVO')` sem reimplementar a regra de qual parte é a
   * principal — se a ordenação mudar lá, o cartão passa a mostrar outra parte.
   */
  partes?: {
    nome: string;
    polo: 'ATIVO' | 'PASSIVO' | 'TERCEIRO';
    /** Preenchido quando a parte é um filiado nosso. */
    filiadoId?: string | null;
    /** `institucional` marca a parte que É o próprio sindicato. */
    parteExterna?: { institucional: boolean } | null;
  }[];
}

/**
 * Slug do desfecho. Deixou de ser união fechada: as opções dependem do TIPO da
 * atividade e vêm de GET /compromissos/desfechos/:tipo.
 */
export type DesfechoCompromisso = string;

/**
 * Atividade de seguimento que o desfecho gera — a pendência declarada ("com
 * encaminhamentos", "laudo pendente") vira tarefa com dono e data em vez de
 * morrer num campo de texto.
 */
export interface SeguimentoSpec {
  tipo: string;
  titulo: string;
  /** Prazo sugerido, em dias corridos a partir de hoje. */
  emDias: number;
  /** Quando true, a criação não pode ser desmarcada. */
  obrigatorio?: boolean;
  /**
   * O TÍTULO PADRÃO É UM EXEMPLO, NÃO UM TÍTULO — a tela abre o campo VAZIO.
   *
   * Das cinco atividades atrasadas da produção em 21/09/2026, duas eram
   * "Encaminhamento da reunião" com o padrão intacto. Título que não diz o que
   * fazer não é tarefa, é eco da reunião.
   */
  pedeTituloProprio?: boolean;
  /** O que escrever no lugar — vira o placeholder do campo. */
  exemplo?: string;
  /**
   * A DATA QUE O SERVIDOR VAI USAR (ISO), já em dia útil às 9h de Teresina.
   *
   * A tela mostra esta, e não soma `emDias` no navegador: somar dias corridos
   * aqui caía no sábado enquanto o servidor gravava na segunda, e a prévia
   * mentia. Opcional pela janela de troca — sem ela, a tela não promete dia.
   */
  sugeridoPara?: string;
}

/** Opção de desfecho, como a API descreve. */
export interface DesfechoOpcao {
  slug: string;
  label: string;
  ajuda: string;
  exigeObs?: boolean;
  /** Resultado ruim (prazo perdido, diligência infrutífera) — destaque na tela. */
  alerta?: boolean;
  acao?: 'VINCULAR_PROCESSO' | 'CRIAR_PROCESSO' | 'CRIAR_ATIVIDADE';
  /** Preenchido quando `acao` é CRIAR_ATIVIDADE. */
  seguimento?: SeguimentoSpec;
}

export interface CategoriaCancelamento {
  slug: string;
  label: string;
  ajuda: string;
}

export interface Compromisso {
  id: string;
  titulo: string;
  tipo: TipoCompromisso;
  status: StatusCompromisso;
  inicio: string;
  fim: string;
  local: string | null;
  /**
   * Endereço da chamada (Meet, Zoom, Teams, Jitsi…), já normalizado pela API.
   * Opcional pela janela de troca: a API antiga não manda.
   */
  linkReuniao?: string | null;
  descricao: string | null;
  urgente: boolean;
  /** POR QUE é urgente. Nulo em registros antigos, migrados da etiqueta. */
  urgenteMotivo: string | null;
  /** Desde quando — o que permite revisar a fila de urgências. */
  urgenteEm: string | null;
  iniciadoEm: string | null;
  /** Gerado pelo robô de prazos a partir de uma movimentação do DataJud. */
  origemAutomatica?: boolean;
  dataOriginal: string | null;
  /** Quantas vezes já foi remarcado — remarcar 4x é sinal de gestão. */
  remarcacoes: number;
  remarcadoMotivo: string | null;
  // ---- Fechamento ----
  desfecho: DesfechoCompromisso | null;
  desfechoObs: string | null;
  concluidoEm: string | null;
  /** Explicação padronizada do cancelamento (o texto abaixo é complemento). */
  canceladoCategoria: string | null;
  canceladoMotivo: string | null;
  canceladoEm: string | null;
  atendimentoId: string | null;
  /**
   * QUANTOS ANEXOS — no cartão, antes de abrir (21/09/2026).
   *
   * Os anexos moram no rodapé da gaveta; para saber SE existem era preciso
   * rolar tudo. É só a contagem: a lista continua na gaveta.
   */
  _count?: { anexos: number };
  /**
   * A PRÉVIA DA TRIAGEM — o que o filiado pediu, em uma linha.
   *
   * O detalhe traz o bloco inteiro (`atendimento` na gaveta, com atendente,
   * canal e data); aqui vêm só os campos que cabem num cartão.
   */
  atendimento?: {
    id: string;
    numero: number;
    descricao: string | null;
    assunto?: string | null;
    assuntoOutro?: string | null;
    /**
     * Quantos arquivos a TRIAGEM juntou — e não esta atividade.
     *
     * A consulta da EDILENE tinha zero anexos próprios e dezessete no
     * atendimento que a originou. O advogado abria sem saber que existiam.
     * Opcional: só o detalhe manda, e a API da janela de troca não manda.
     */
    _count?: { anexos: number };
  } | null;
  /** Seguimento de uma conclusão: herda `atendimentoId` e não fecha o atendimento. Só o detalhe manda. */
  origemDesfechoId?: string | null;
  /**
   * A PUBLICAÇÃO DO DJEN QUE ORIGINOU OU ENRIQUECEU ESTA ATIVIDADE.
   *
   * Só vem no DETALHE (a gaveta), nunca no cartão: é o teor integral de uma
   * intimação, e uma coluna de kanban com quatro cartões carregaria quatro
   * textos que ninguém vai ler dali.
   */
  origemComunicacoes?: {
    id: string;
    texto: string;
    tipoComunicacao: string | null;
    nomeOrgao: string | null;
    dataDisponibilizacao: string;
    providencia: string | null;
    prazoMencionadoDias: number | null;
    link: string | null;
    processoId: string | null;
    /** Quem o tribunal intimou. O DJEN manda uma cópia por destinatário. */
    advogados: { nome: string | null; numeroOab: string | null; ufOab: string | null }[] | null;
  }[];
  filiado: FiliadoCard | null;
  responsavel: Responsavel;
  /**
   * A EQUIPE da atividade, com o responsável marcado (`principal`).
   *
   * `responsavel` acima é o atalho para a linha principal — continua valendo e
   * é o que a maior parte da tela lê. Esta lista é o que permite mostrar os
   * avatares de quem mais atua.
   */
  equipe?: {
    principal: boolean;
    /**
     * COMO essa pessoa foi parar aqui. `AUTOMATICA` = reserva posta pelo robô
     * (advogado do caso que não é o dono da tarefa); vazio = gente escolheu.
     *
     * A distinção é o que impede o mesmo prazo de virar aviso de quatro
     * pessoas — e é o que a tela precisa dizer, senão "também atuam" vira uma
     * lista de nomes que ninguém sabe se combinou de atuar.
     */
    origem?: string | null;
    usuario: Responsavel;
  }[];
  /** Quem REGISTROU a demanda (com foto). Nulo em eventos do robô. */
  criador: Responsavel | null;
  /**
   * O RESPONSÁVEL SUMIU? Só no detalhe, e só para atividade aberta: sem entrar no
   * sistema há uma semana ou mais (`diasSemEntrar`), nunca entrou (nulo) ou saiu
   * dele (`inativo`). Nulo quando está por perto; opcional pela janela de troca.
   */
  ausenciaDoResponsavel?: { diasSemEntrar: number | null; inativo: boolean } | null;
  /**
   * QUEM FECHOU a atividade — com nome e foto.
   *
   * As colunas guardavam o id desde sempre; sem a chave estrangeira a API não
   * conseguia trazer o nome, e o desfecho aparecia na tela sem autor ("Peça
   * protocolada às 16:52", por quem ninguém sabia). Num histórico jurídico isso
   * é registro pela metade.
   *
   * `null` quando quem fechou foi o robô — e aí a tela DIZ que foi o sistema,
   * em vez de deixar o espaço em branco.
   */
  concluidoPorUsuario?: Responsavel | null;
  canceladoPorUsuario?: Responsavel | null;
  processo: ProcessoRef | null;
}

export interface CompromissoDetalhe extends Compromisso {
  observacoesInternas: string | null;
  /** Quando o evento foi registrado no sistema (≠ da data agendada). */
  createdAt: string;
  /** Mantido por compatibilidade — a fonte agora é `criador` (que traz a foto). */
  criadoPorNome: string | null;
  filiado: (FiliadoCard & {
    cpf: string | null;
    telefonePrincipal: string | null;
    email: string | null;
    formacao: string | null;
  }) | null;
  responsavel: Responsavel & { nomeExibicao?: string | null; role?: string };
  /**
   * No DETALHE as partes vêm completas — com `papel` e `principal` — porque é
   * aqui que se mostram os polos inteiros. No cartão da lista basta nome e
   * polo, que é o que `ProcessoRef.partes` carrega.
   */
  processo: (Omit<ProcessoRef, 'partes'> & {
    classeProcessual: string | null;
    partes?: {
      id: string;
      nome: string;
      polo: 'ATIVO' | 'PASSIVO' | 'TERCEIRO';
      papel: string | null;
      principal: boolean;
    }[];
  }) | null;
  atendimento: {
    id: string;
    numero: number;
    canal: string;
    desfecho: string | null;
    /** O que o filiado veio pedir — a demanda escrita na triagem. */
    descricao: string;
    /** Slug do assunto do atendimento. Opcional pela janela de troca. */
    assunto?: string | null;
    /** Texto de "Qual assunto?" quando o assunto é OUTRO. */
    assuntoOutro?: string | null;
    createdAt: string;
    atendente: { id: string; nome: string; nomeExibicao: string | null };
    /**
     * Quantos arquivos a TRIAGEM juntou — e não esta atividade.
     *
     * A consulta da EDILENE tinha zero anexos próprios e DEZESSETE no
     * atendimento que a originou: o advogado abria sem saber que existiam.
     * Opcional pela janela de troca.
     */
    _count?: { anexos: number };
    /**
     * O ATENDIMENTO FECHA SOZINHO COM A CONSULTA (15/09/2026). A gaveta da
     * consulta diz ao advogado que registrar conclui o atendimento junto, e
     * depois diz que concluiu. Opcionais pela janela de troca: a API antiga não
     * manda, e a gaveta então não afirma nada.
     */
    status?: 'PENDENTE' | 'CONCLUIDO' | 'CANCELADO';
    /** 'TRIAGEM' | 'CONSULTA'; nulo nos fechados antes de 15/09/2026. */
    conclusaoOrigem?: string | null;
    /** A consulta que fechou o atendimento, quando foi ela. */
    conclusaoConsultaId?: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Rótulos e cores
// ---------------------------------------------------------------------------

// A paleta é COMPARTILHADA com os tipos de movimentação dos Processos.
// Fonte única em lib/paleta-cores.ts (as classes precisam ser literais para o
// Tailwind gerá-las). Reexportado aqui pelos consumidores já existentes.
export type ClassesTipo = ClassesCor;
export const CORES_TIPO = CORES_PALETA;
export type CorTipo = CorPaleta;
export const PALETA_TIPO = PALETA;

/** Fallback dos tipos "sistema" (quando a lista dinâmica ainda não carregou). */
export const TIPO_PADRAO: Record<string, { nome: string; cor: CorTipo }> = {
  AUDIENCIA: { nome: 'Audiência', cor: 'sky' },
  PRAZO: { nome: 'Prazo', cor: 'red' },
  CONSULTA_JURIDICA: { nome: 'Consulta Jurídica', cor: 'purple' },
  REUNIAO: { nome: 'Reunião', cor: 'emerald' },
  DILIGENCIA: { nome: 'Diligência', cor: 'teal' },
  DESPACHO: { nome: 'Despacho', cor: 'slate' },
  PERICIA: { nome: 'Perícia', cor: 'pink' },
  COMPROMISSO: { nome: 'Compromisso', cor: 'orange' },
  CONTATO: { nome: 'Contato', cor: 'cyan' },
  ACOMPANHAMENTO: { nome: 'Acompanhamento', cor: 'indigo' },
};

/** Rótulo de um tipo (lista dinâmica → fallback padrão → o próprio slug). */
export function rotuloTipo(slug: string, tipos?: TipoEventoItem[]): string {
  return tipos?.find((t) => t.slug === slug)?.nome ?? TIPO_PADRAO[slug]?.nome ?? slug;
}
/** Classes de cor de um tipo (lista dinâmica → fallback padrão → slate). */
export function corDeTipo(slug: string, tipos?: TipoEventoItem[]): ClassesTipo {
  const key = tipos?.find((t) => t.slug === slug)?.cor ?? TIPO_PADRAO[slug]?.cor ?? 'slate';
  return PALETA_TIPO[key] ?? PALETA_TIPO.slate;
}

export const STATUS_LABEL: Record<StatusCompromisso, string> = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};
export const STATUS_ORDEM: StatusCompromisso[] = ['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'];

/*
  CANCELADA É UM FIM, NÃO UM ERRO (15/09/2026). O selo saía riscado, e riscar
  diz "isto não vale" sobre uma atividade que a equipe cancelou de propósito
  (o filiado desistiu, o juízo adiou). Neutro, legível, sem riscado.
*/
export const STATUS_COR: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  EM_ANDAMENTO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  CONCLUIDO: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400',
  CANCELADO: 'bg-muted text-muted-foreground',
};

// ---------------------------------------------------------------------------
// Desfecho
// ---------------------------------------------------------------------------

/**
 * Rótulos conhecidos. A tela usa o label vindo da API; este mapa serve para
 * exibir registros antigos (REALIZADO, OUTRO, NAO_COMPARECEU) e para os casos
 * em que só temos o slug guardado no compromisso.
 */
export const DESFECHO_LABEL: Record<string, string> = {
  // Encaminhamentos (valem para vários tipos)
  DUVIDA_ESCLARECIDA: 'Dúvida esclarecida',
  VINCULADO_PROCESSO: 'Vinculado a processo',
  PROCESSO_CRIADO: 'Virou processo novo',
  CONCLUIDA: 'Concluída',
  // Audiência
  AUDIENCIA_ACORDO: 'Houve acordo',
  AUDIENCIA_SEM_ACORDO: 'Realizada, sem acordo',
  AUDIENCIA_INSTRUCAO: 'Instrução encerrada',
  // Prazo
  PRAZO_CUMPRIDO: 'Peça protocolada',
  PRAZO_PERDIDO: 'Prazo perdido',
  PRAZO_SEM_PECA: 'Analisado — nada a protocolar',
  // Reunião
  REUNIAO_COM_ENCAMINHAMENTOS: 'Com encaminhamentos',
  REUNIAO_SEM_DELIBERACAO: 'Sem deliberação',
  // Diligência
  DILIGENCIA_CUMPRIDA: 'Cumprida',
  DILIGENCIA_INFRUTIFERA: 'Infrutífera',
  // Despacho
  DESPACHO_OBTIDO: 'Despacho obtido',
  DESPACHO_NAO_ATENDIDO: 'Não atendido',
  // Perícia
  PERICIA_REALIZADA: 'Realizada — laudo pendente',
  PERICIA_LAUDO_ENTREGUE: 'Laudo entregue',
  // Contato com o filiado (tarefa de aviso da secretaria)
  CONTATO_CONFIRMADO: 'Confirmou presença',
  CONTATO_NAO_COMPARECERA: 'Avisou que não vai',
  CONTATO_SEM_SUCESSO: 'Não conseguimos contato',
  // Acompanhamento (a pendência que veio de outro desfecho)
  ACOMPANHAMENTO_CUMPRIDO: 'Cumprido',
  ACOMPANHAMENTO_PENDENTE: 'Ainda pendente',
  ACOMPANHAMENTO_SEM_OBJETO: 'Perdeu o objeto',
  // Legado (antes da conclusão por tipo)
  REALIZADO: 'Realizado',
  OUTRO: 'Outro',
  NAO_COMPARECEU: 'Não compareceu',
};

/** Desfechos que sinalizam problema — pintados de vermelho na tela. */
const DESFECHOS_ALERTA = new Set([
  'PRAZO_PERDIDO', 'DILIGENCIA_INFRUTIFERA', 'DESPACHO_NAO_ATENDIDO',
  'CONTATO_NAO_COMPARECERA', 'CONTATO_SEM_SUCESSO', 'ACOMPANHAMENTO_PENDENTE',
]);

export function corDesfecho(slug?: string | null): string {
  if (!slug) return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  if (DESFECHOS_ALERTA.has(slug)) return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  if (slug === 'VINCULADO_PROCESSO') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300';
  if (slug === 'PROCESSO_CRIADO') return 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300';
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
}

export const rotuloDesfecho = (slug?: string | null): string =>
  slug ? (DESFECHO_LABEL[slug] ?? slug) : '';

export const CATEGORIA_CANCELAMENTO_LABEL: Record<string, string> = {
  /**
   * Só o sistema grava (reconclusão da atividade de origem). Sem o rótulo aqui a
   * gaveta mostrava o código cru "SUBSTITUIDA". Mesmo texto do catálogo da API.
   */
  SUBSTITUIDA: 'Substituída por nova conclusão',
  NAO_COMPARECEU: `${V.Filiado} não compareceu`,
  DESISTENCIA: `${V.Filiado} desistiu`,
  ADIADA_JUIZO: 'Adiada pelo juízo/órgão',
  INDISPONIBILIDADE: 'Indisponibilidade do sindicato',
  DUPLICIDADE: 'Agendada por engano',
  PERDEU_OBJETO: 'Perdeu o objeto',
};

/** Opções de desfecho do tipo da atividade. */
export async function listarDesfechos(tipo: string): Promise<DesfechoOpcao[]> {
  return (await api.get(`/compromissos/desfechos/${tipo}`)).data;
}

export async function listarCategoriasCancelamento(): Promise<CategoriaCancelamento[]> {
  return (await api.get('/compromissos/categorias-cancelamento')).data;
}

/** Linha do tempo da atividade. */
export interface MovimentacaoCompromisso {
  id: string;
  acao: string;
  descricao: string;
  autorNome: string | null;
  autor?: { nome: string; nomeExibicao: string | null } | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export async function listarHistoricoCompromisso(id: string): Promise<MovimentacaoCompromisso[]> {
  return (await api.get(`/compromissos/${id}/historico`)).data;
}



/**
 * Transições permitidas — espelha a máquina de estados da API para a tela só
 * oferecer o que o servidor aceita. Concluir e cancelar não estão aqui: são
 * ações próprias, com dados obrigatórios (desfecho / motivo).
 */
export const TRANSICOES: Record<StatusCompromisso, StatusCompromisso[]> = {
  PENDENTE: ['EM_ANDAMENTO'],
  EM_ANDAMENTO: ['PENDENTE'],
  CONCLUIDO: ['PENDENTE', 'EM_ANDAMENTO'],
  CANCELADO: ['PENDENTE'],
};

/**
 * O QUE UM ARRASTO NO QUADRO PODE FAZER — e por que NÃO é `TRANSICOES`.
 *
 * "O drag and drop não está funcionando? Tentei arrastar uma atividade para
 * concluída e não aconteceu nada." — o dono, 21/09/2026. Não acontecia mesmo,
 * e o motivo estava escrito duas linhas acima: `TRANSICOES` é o mapa da rota
 * `PATCH /:id/status`, que RECUSA `CONCLUIDO` e `CANCELADO` de propósito —
 * concluir e cancelar têm rotas próprias porque exigem desfecho e motivo.
 *
 * O quadro usava esse mapa para decidir se a coluna aceitava o cartão. Como
 * nenhuma transição leva a "Concluído", a coluna nunca aceitava, o `onDragOver`
 * nem chamava `preventDefault` (então o navegador recusava o drop) e o código
 * que abriria o diálogo de conclusão era INALCANÇÁVEL:
 *
 *     if (!card || !aceita(destino)) return;        // <- parava aqui, sempre
 *     if (destino === 'CONCLUIDO') return onConcluir(card);   // <- nunca rodava
 *
 * São duas perguntas diferentes e por isso são dois mapas:
 *  · `TRANSICOES` ...... o que a rota de status grava sozinha;
 *  · este ............... o que soltar o cartão ali PROPÕE, mesmo que o
 *                         caminho seja abrir um diálogo.
 *
 * Soltar em "Concluído" abre o modal de desfecho; em "Cancelado", o de motivo;
 * em "Pendente"/"Em andamento", a partir de um cartão fechado, abre o de
 * reabertura. Nenhum arrasto grava decisão sem passar por uma pergunta.
 */
export const DESTINOS_DO_ARRASTO: Record<StatusCompromisso, StatusCompromisso[]> = {
  PENDENTE: ['EM_ANDAMENTO', 'CONCLUIDO', 'CANCELADO'],
  EM_ANDAMENTO: ['PENDENTE', 'CONCLUIDO', 'CANCELADO'],
  /* Reabrir é permitido, e desde 21/09/2026 passa por um diálogo. */
  CONCLUIDO: ['PENDENTE', 'EM_ANDAMENTO'],
  CANCELADO: ['PENDENTE', 'EM_ANDAMENTO'],
};

export function oArrastoPodeSoltar(
  origem: StatusCompromisso,
  destino: StatusCompromisso,
): boolean {
  if (origem === destino) return false;
  return DESTINOS_DO_ARRASTO[origem]?.includes(destino) ?? false;
}

/** Um evento fechado (concluído/cancelado) precisa ser reaberto para mudar. */
export function estaFechado(status: StatusCompromisso): boolean {
  return status === 'CONCLUIDO' || status === 'CANCELADO';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
/**
 * HÁ QUANTOS DIAS A DATA PASSOU — em dias de CALENDÁRIO, nunca em horas.
 *
 * "Ficou para trás ontem às 9h" e "ficou para trás ontem às 18h" são a mesma
 * coisa para quem vai resolver hoje: 1 dia. Dividir milissegundos por 86.400.000
 * diria 0 para a segunda, e um item atrasado aparecendo como "0 dias" é o tipo
 * de número que faz a pessoa desconfiar da tela inteira.
 *
 * A conta é no fuso daqui: o dia vira às 00h de Teresina, não às 00h UTC.
 */
export function diasDeAtraso(iso: string, agora: Date = new Date()): number {
  const OFFSET_BR = 3 * 3_600_000;
  const diaDe = (d: Date) => {
    const br = new Date(d.getTime() - OFFSET_BR);
    return Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate());
  };
  const dias = Math.round((diaDe(agora) - diaDe(new Date(iso))) / 86_400_000);
  return Math.max(0, dias);
}

export function formatData(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function formatHora(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * EM QUE PÉ ESTÁ O PRAZO — uma palavra, um significado, em toda a aplicação.
 *
 * O SISTEMA SE CONTRADIZIA. Havia DUAS definições de "atrasada" no ar ao mesmo
 * tempo, e elas discordavam na cara do usuário:
 *
 *   sino (`pendencias.service.ts`) ... aberta de DIA ANTERIOR      → 0 hoje
 *   painel / agenda / KPI ........... aberta com a HORA passada    → 8 hoje
 *
 * A mesma pessoa, no mesmo instante, via "8 atrasadas" no painel e um sino
 * calado. Duas telas discordando sobre a palavra mais grave do sistema é o jeito
 * mais rápido de ensinar alguém a não confiar em nenhuma das duas — e aí o
 * alarme que importa passa junto com o resto.
 *
 * QUAL DAS DUAS VENCEU, E POR QUÊ. A do sino, que é a que separa as coisas:
 *
 *  · `ATRASADA` — aberta e o DIA já virou. Não há discussão possível: ninguém
 *    defende que uma tarefa de ontem ainda por fazer esteja em dia. É o alarme,
 *    e por isso nunca pode ser truncada nem calada.
 *
 *  · `PASSOU_DA_HORA` — aberta, é de HOJE, e o horário marcado já passou. É
 *    informação, não falha. O robô agenda "Cadastrar ação do Diário" para as
 *    15:00 do próprio dia (foram 7 das 8 medidas em 08/09/2026): às 15:01 elas
 *    viravam "atrasada" em vermelho. Uma tarefa nascida de manhã e vencida à
 *    tarde não é prazo perdido — é o relógio que o robô escolheu.
 *
 *  · `EM_DIA` — o resto: hoje ainda por vir, e os próximos dias.
 *
 * O GANHO NÃO É SEMÂNTICO, É DE CONFIANÇA. Com as duas coladas, todo fim de
 * tarde o painel ficava vermelho e a pessoa aprendia que vermelho é o normal.
 * Separadas, o alarme só toca quando alguma coisa REALMENTE ficou para trás — e
 * aí ele é levado a sério.
 *
 * O dia é o de Teresina, como todo o resto: o contêiner roda em UTC e viraria o
 * dia às 21h, marcando de atrasado o que ainda é de hoje.
 */
export type EstadoDoPrazo = 'ATRASADA' | 'PASSOU_DA_HORA' | 'EM_DIA';

/** O dia de calendário de Teresina, para comparar dia com dia. */
function diaBR(instante: number): string {
  return new Date(instante - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 'AAAA-MM-DD' do dia de Teresina em que o instante cai. Teresina não tem
 * horário de verão: UTC−3 fixo. Cortar o ISO em UTC (`toISOString().slice`)
 * trocava o dia depois das 21h — a gaveta buscava o plantão de amanhã.
 */
export function diaBRDe(instante: string | number | Date): string {
  const t = instante instanceof Date ? instante.getTime() : typeof instante === 'number' ? instante : new Date(instante).getTime();
  return diaBR(t);
}

/** Milissegundos do início (00:00 de Teresina) do dia em que `agora` cai. */
export function inicioDoDiaBRMs(agora: number = Date.now()): number {
  return new Date(`${diaBR(agora)}T00:00:00-03:00`).getTime();
}

const FUSO_BR_MS = 3 * 3_600_000;

/** A data da atividade é de um dia que já passou (em Teresina)? */
export function dataJaPassou(iso: string, agora: number = Date.now()): boolean {
  return diaBR(new Date(iso).getTime()) < diaBR(agora);
}

/**
 * O NOVO INÍCIO DE UM ATALHO DO REMARCAR ("Amanhã", "Em 3 dias"…).
 *
 * Somava à data ANTIGA: a tarefa de 02/09 remarcada em 12/09 com "Amanhã" ia
 * para 03/09 — continuava atrasada, ganhava +1 no contador, e a pessoa achava
 * que tinha resolvido. E quem remarca é justamente quem está atrasado.
 *
 * Agora: se o dia marcado já passou, os dias contam a partir de HOJE. A HORA
 * da atividade se mantém (a audiência das 9h continua às 9h). Tudo no relógio
 * de Teresina, que é fixo em UTC−3, para não depender do fuso do navegador.
 */
export function novoInicioPorAtalho(inicioIso: string, dias: number, agora: number = Date.now()): string {
  const inicio = new Date(inicioIso).getTime();
  // Com o deslocamento, os campos UTC deste Date SÃO o relógio de Teresina.
  const relogio = new Date(inicio - FUSO_BR_MS);
  const dia = dataJaPassou(inicioIso, agora) ? new Date(agora - FUSO_BR_MS) : relogio;
  const alvo = Date.UTC(
    dia.getUTCFullYear(),
    dia.getUTCMonth(),
    dia.getUTCDate() + dias,
    relogio.getUTCHours(),
    relogio.getUTCMinutes(),
  );
  return new Date(alvo + FUSO_BR_MS).toISOString();
}

/**
 * O servidor recusa remarcar para antes do INÍCIO DE HOJE (Teresina). Hora que
 * já passou hoje continua valendo: remarcar para "hoje às 8h" às 10h é registrar
 * o que aconteceu, não um erro.
 */
export function remarcacaoPermitida(novoInicioIso: string, agora: number = Date.now()): boolean {
  const t = new Date(novoInicioIso).getTime();
  return Number.isFinite(t) && t >= inicioDoDiaBRMs(agora);
}

export function estadoDoPrazo(c: {
  inicio: string;
  status: StatusCompromisso;
}): EstadoDoPrazo {
  return estadoDoPrazoEm(c, Date.now());
}

/**
 * A MESMA RÉGUA, com o relógio passado de fora — para função pura que agrupa
 * (a lista por dia) poder ser testada com uma data de 2026 fixa. Fica separada,
 * e não como segundo parâmetro de `estadoDoPrazo`, porque `estaAtrasado` é
 * passado direto a `.filter`/`.sort` e um parâmetro novo receberia o índice.
 */
export function estadoDoPrazoEm(c: { inicio: string; status: StatusCompromisso }, agora: number): EstadoDoPrazo {
  if (c.status === 'CONCLUIDO' || c.status === 'CANCELADO') return 'EM_DIA';
  const inicio = new Date(c.inicio).getTime();
  if (diaBR(inicio) < diaBR(agora)) return 'ATRASADA';
  return inicio < agora ? 'PASSOU_DA_HORA' : 'EM_DIA';
}

/**
 * Atrasado = FICOU PARA TRÁS, o dia já virou.
 *
 * Era "a hora passou", e mudou junto com a separação acima. Quem quiser o
 * antigo comportamento quer, na verdade, `estadoDoPrazo(c) !== 'EM_DIA'` — e
 * deve dizer isso, para a tela poder distinguir os dois tons.
 */
export function estaAtrasado(c: { inicio: string; status: StatusCompromisso }): boolean {
  return estadoDoPrazo(c) === 'ATRASADA';
}

/** Precisa de atenção AGORA: ficou para trás ou já passou da hora marcada. */
export function pedeAtencao(c: { inicio: string; status: StatusCompromisso }): boolean {
  return estadoDoPrazo(c) !== 'EM_DIA';
}

/** ISO → valor de <input type="datetime-local"> (horário local). */
export function paraInputLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function listarResponsaveis(): Promise<Responsavel[]> {
  return (await api.get('/compromissos/responsaveis')).data;
}

export interface CriarCompromissoInput {
  titulo: string;
  tipo: TipoCompromisso;
  status?: StatusCompromisso;
  inicio: string;
  fim: string;
  local?: string;
  descricao?: string;
  observacoesInternas?: string;
  urgente?: boolean;
  /** Obrigatório ao marcar urgente pela tela. */
  urgenteMotivo?: string;
  responsavelId: string;
  /** Demais advogados/colaboradores que atuam nesta atividade. */
  responsaveisIds?: string[];
  filiadoId?: string;
  atendimentoId?: string;
  processoId?: string;
  /** Link da chamada. `null` apaga; a API normaliza e recusa o que não é https. */
  linkReuniao?: string | null;
}
export async function criarCompromisso(dto: CriarCompromissoInput) {
  return (await api.post('/compromissos', dto)).data;
}

/** Tempo relativo curto: "em 13min", "há 27d", "agora". */
export function tempoRelativo(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const futuro = diff > 0;
  const seg = Math.abs(diff) / 1000;
  let txt: string;
  if (seg < 60) return 'agora';
  else if (seg < 3600) txt = `${Math.round(seg / 60)}min`;
  else if (seg < 86400) txt = `${Math.round(seg / 3600)}h`;
  else txt = `${Math.round(seg / 86400)}d`;
  return futuro ? `em ${txt}` : `há ${txt}`;
}

/** Duração legível desde `iniciadoEm` até agora (cronômetro do card). */
export function duracaoDesde(iso: string | null | undefined, agora: number = Date.now()): string {
  if (!iso) return '';
  const seg = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 1000));
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/**
 * QUANTO A ATIVIDADE LEVOU, de "Iniciar" a "Concluir".
 *
 * Só mede o que foi de fato CRONOMETRADO. Devolve `null` quando falta um dos
 * dois carimbos — e isso não é detalhe: das 25 atividades concluídas na
 * produção de 31/08/2026, NOVE foram concluídas sem nunca terem sido
 * iniciadas. Para essas, a única duração calculável seria da criação até a
 * conclusão, e aí uma tarefa criada há três semanas e resolvida em dez minutos
 * apareceria como "concluída em 23 dias". Um número errado é pior que nenhum:
 * o primeiro é lido e usado, o segundo faz a pessoa procurar o dado certo.
 *
 * Também devolve `null` se o fim vier antes do início — dado torto existe, e
 * "concluída em -4h" seria a única coisa que a pessoa lembraria da tela.
 */
export function duracaoEntre(
  inicioIso: string | null | undefined,
  fimIso: string | null | undefined,
): string | null {
  if (!inicioIso || !fimIso) return null;
  const seg = Math.floor((new Date(fimIso).getTime() - new Date(inicioIso).getTime()) / 1000);
  if (!Number.isFinite(seg) || seg < 0) return null;

  if (seg < 60) return 'menos de 1 min';
  if (seg < 3600) return `${Math.round(seg / 60)}min`;
  if (seg < 86_400) {
    const h = Math.floor(seg / 3600);
    const m = Math.round((seg % 3600) / 60);
    // "2h40" e não "2h 40m": é como se fala a duração de uma audiência.
    // Arredondar 59min para cima viraria "2h60", daí o ajuste.
    if (m === 60) return `${h + 1}h`;
    return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
  }
  const d = Math.floor(seg / 86_400);
  const h = Math.round((seg % 86_400) / 3600);
  if (h === 24) return `${d + 1} dias`;
  return h === 0 ? `${d} ${d === 1 ? 'dia' : 'dias'}` : `${d}d ${h}h`;
}

/**
 * O cronômetro está rodando há tempo demais para ser trabalho?
 *
 * Passar do horário previsto é NORMAL — medido na produção, 12 das 25
 * atividades concluídas passaram até uma hora, e cinco entre uma e quatro.
 * Usar "passou do previsto" como alerta acenderia em quase todas e não
 * informaria nada.
 *
 * O que NÃO é normal é continuar contando muitas horas depois. As duas
 * atividades em andamento na produção estavam 11,4h e 12,7h além de um término
 * previsto para UMA hora depois do início — ninguém ficou meio dia numa
 * consulta de uma hora; alguém esqueceu de clicar em "Concluir", e o
 * cronômetro verde e pulsante seguia dizendo que estava tudo bem.
 *
 * Seis horas é a folga: cabe a audiência que atrasou a manhã inteira e não
 * cabe o cronômetro que virou a noite.
 */
export const HORAS_ATE_CRONOMETRO_ESQUECIDO = 6;

/**
 * TIPOS QUE TÊM HORA MARCADA DE VERDADE — a pessoa está num lugar, com alguém,
 * das 9h às 10h. Nesses, "Iniciar" é o gesto natural e o cronômetro que vira a
 * noite é esquecimento.
 *
 * O resto é TAREFA (prazo, acompanhamento, contato, despacho, diligência e
 * tudo que o robô cria): o horário do cartão é só onde ela caiu no dia, e o
 * trabalho dura o dia inteiro. Medido em 12/09/2026: PRAZO passou por Iniciar
 * em 4 de 12 conclusões, DILIGENCIA em 4 de 11, ACOMPANHAMENTO em 0 de 3 —
 * contra 18 de 22 na consulta e 5 de 5 na reunião.
 */
export const TIPOS_COM_HORA: readonly string[] = ['CONSULTA_JURIDICA', 'REUNIAO', 'AUDIENCIA', 'PERICIA'];

export function temHoraMarcada(tipo: string | null | undefined): boolean {
  return !!tipo && TIPOS_COM_HORA.includes(tipo);
}

/**
 * QUAL É O BOTÃO CHEIO DO CARTÃO: Iniciar para quem tem hora marcada, Concluir
 * para tarefa. Tarefa do robô é sempre tarefa, mesmo que o tipo seja de hora.
 */
export function acaoPrincipalDoCartao(c: {
  tipo: string;
  origemAutomatica?: boolean;
}): 'INICIAR' | 'CONCLUIR' {
  if (c.origemAutomatica) return 'CONCLUIR';
  return temHoraMarcada(c.tipo) ? 'INICIAR' : 'CONCLUIR';
}

export function cronometroEsquecido(
  fimPrevistoIso: string | null | undefined,
  agora: number = Date.now(),
  /**
   * Com o tipo, só acusa esquecimento em atividade com hora marcada. Numa
   * tarefa o fim previsto é o início + 30 min que o robô escolheu, e o aviso
   * acendia seis horas depois num trabalho que naturalmente dura o dia.
   */
  tipo?: string | null,
): boolean {
  if (!fimPrevistoIso) return false;
  if (tipo !== undefined && !temHoraMarcada(tipo)) return false;
  const alem = (agora - new Date(fimPrevistoIso).getTime()) / 3_600_000;
  return alem > HORAS_ATE_CRONOMETRO_ESQUECIDO;
}

/** Cronômetro HH:MM:SS desde `iniciadoEm` — conta horas, minutos e segundos. */
export function cronometroHMS(iso: string | null | undefined, agora: number = Date.now()): string {
  if (!iso) return '00:00:00';
  const seg = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 1000));
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/**
 * ESTA ATIVIDADE É MINHA?
 *
 * Responsável OU equipe — as duas coisas, porque a agenda de alguém inclui o
 * que ele ACOMPANHA, e não só o que responde. O segundo advogado de uma
 * audiência precisa vê-la como dele; é o ponto inteiro da multivinculação, e
 * a API já filtra pelas duas na listagem.
 */
export function ehMinha(c: Compromisso, meuId?: string): boolean {
  if (!meuId) return false;
  // A reserva posta pelo robô NÃO faz a atividade ser minha — é a régua
  // `daPessoa` da API. Contá-la aqui dava "Minhas 7" na agenda e 3 no painel.
  return (
    c.responsavel?.id === meuId ||
    !!c.equipe?.some((e) => e.usuario.id === meuId && !ehReserva(e))
  );
}

/** Reserva do robô: aparece na atividade, mas não é pendência de ninguém. */
export function ehReserva(e: { origem?: string | null }): boolean {
  return e.origem === 'AUTOMATICA';
}

export interface FiltroCompromissos {
  status?: StatusCompromisso;
  tipo?: TipoCompromisso;
  responsavelId?: string;
  /**
   * Vários responsáveis, separados por vírgula — "a agenda do Murilo e da
   * Shérad". Vírgula, e não `campo[]=`, para que os dois lados não dependam de
   * como cada um serializa lista em query string; ver o DTO na API.
   */
  responsaveis?: string;
  filiadoId?: string;
  /** "true" traz só as marcadas como urgentes. */
  urgente?: string;
  /** Título, nome do filiado, NPU (só dígitos) e nome de parte. */
  busca?: string;
  dataInicio?: string;
  dataFim?: string;
  /** Recorte calculado no SERVIDOR (mesma regra dos contadores e do painel). */
  recorte?: RecorteAgenda;
  /** Régua `daPessoa`: responde ou foi posta ali por gente (reserva fora). */
  pessoa?: string;
  /** Só as atividades em que a pessoa é reserva do robô. */
  reservaDe?: string;
  /** Com `responsavel`/`responsaveis`: só quem RESPONDE, sem a equipe. */
  somenteResponsavel?: string;
  /**
   * METADE DO TEMPO (14/09/2026). `adiante` = o que ainda está aberto ou começa
   * de hoje em diante, em ordem crescente; `anteriores` = o que já fechou em dia
   * anterior, do mais recente para o mais antigo. Com `recorte=todos` as duas são
   * disjuntas e somam "Todas". Só a lista por dia manda — o quadro e o calendário
   * continuam sem janela. A API antiga recusa o campo (forbidNonWhitelisted): a
   * API sobe antes.
   */
  janela?: JanelaDaAgenda;
  /** Tamanho da página (1 a 200). Sem ele a API corta em 500, como sempre. */
  limite?: number;
  /** `<ISO do início do último item>_<id>` — ver `proximoCursor`. Nunca vai para a URL. */
  cursor?: string;
}

export type JanelaDaAgenda = 'adiante' | 'anteriores';

function paraParams(filtro: object): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(filtro)) if (v) params[k] = String(v);
  return params;
}

export async function listarCompromissos(filtro: FiltroCompromissos = {}): Promise<Compromisso[]> {
  return (await api.get('/compromissos', { params: paraParams(filtro) })).data;
}

// ---------------------------------------------------------------------------
// Recortes (abas) — a regra mora na API; aqui só o vocabulário e a URL
// ---------------------------------------------------------------------------

/** Valores de `?aba=` e do parâmetro `recorte` da listagem (C1/C11). */
export type RecorteAgenda = 'hoje' | 'atrasadas' | 'atencao' | '7dias' | 'aberto' | 'todos';

/** Resposta de GET /compromissos/recortes — contagens por count() no servidor. */
export interface ContagemRecortes {
  hoje: number;
  atrasadas: number;
  atencao: number;
  seteDias: number;
  aberto: number;
  todos: number;
  urgentes: number;
  /**
   * As duas metades de "Todas" (14/09/2026), com os mesmos filtros: `todos` é a
   * soma. Opcionais pela janela de troca — sem eles o seletor mostra
   * "Próximas | Anteriores" sem número, em vez de um zero que seria mentira.
   */
  todosAdiante?: number;
  todosAnteriores?: number;
}

export const RECORTE_PADRAO: RecorteAgenda = 'hoje';

/**
 * As abas, na ordem da tela. `chave` é o campo de `ContagemRecortes` — o
 * número da aba é o count() do MESMO recorte que a lista abre.
 */
export const RECORTES: readonly {
  valor: RecorteAgenda;
  rotulo: string;
  chave: keyof ContagemRecortes;
  ajuda: string;
}[] = [
  { valor: 'hoje', rotulo: 'Hoje', chave: 'hoje', ajuda: 'O que é de hoje e o que ficou para trás' },
  { valor: 'atrasadas', rotulo: 'Ficaram para trás', chave: 'atrasadas', ajuda: 'Abertas de dias anteriores' },
  { valor: 'atencao', rotulo: 'Pedem atenção', chave: 'atencao', ajuda: 'Ficaram para trás ou já passaram da hora hoje' },
  { valor: '7dias', rotulo: '7 dias', chave: 'seteDias', ajuda: 'Até daqui a uma semana, com o que ficou para trás' },
  { valor: 'aberto', rotulo: 'Em aberto', chave: 'aberto', ajuda: 'Tudo que está pendente ou em andamento' },
  { valor: 'todos', rotulo: 'Todas', chave: 'todos', ajuda: 'Últimos 60 dias, as próximas e as abertas' },
];

export function ehRecorte(v: string | null | undefined): v is RecorteAgenda {
  return !!v && RECORTES.some((r) => r.valor === v);
}

/**
 * O que a URL da agenda pede, já resolvido — função pura, para o painel e a
 * agenda lerem a MESMA tradução de `?aba=&pessoa=eu&...` (C11).
 *
 * `eu` vira o id de quem está logado; sem sessão ainda, a pessoa fica de fora
 * (e `aguardandoSessao` avisa a tela para não mostrar a casa inteira como se
 * fosse a carteira da pessoa).
 */
export interface EstadoDaUrlDaAgenda {
  aba: RecorteAgenda;
  pessoa?: string;
  reservaDe?: string;
  /** Um ou mais ids, separados por vírgula. */
  responsaveis?: string;
  somenteResponsavel: boolean;
  tipo?: string;
  urgentes: boolean;
  compromisso?: string;
  busca?: string;
  /** `pessoa=eu` ou `reservaDe=eu` sem o id da sessão ainda carregado. */
  aguardandoSessao: boolean;
}

export function lerUrlDaAgenda(
  sp: { get(nome: string): string | null },
  meuId?: string | null,
): EstadoDaUrlDaAgenda {
  let aguardandoSessao = false;
  const resolver = (v: string | null): string | undefined => {
    if (!v) return undefined;
    if (v === 'eu') {
      if (!meuId) {
        aguardandoSessao = true;
        return undefined;
      }
      return meuId;
    }
    return v;
  };
  const abaBruta = sp.get('aba');
  // `?aba=urgentes` era a aba antiga: hoje é o filtro Urgentes sobre "Em aberto".
  const urgentesPelaAba = abaBruta === 'urgentes';
  const aba: RecorteAgenda = ehRecorte(abaBruta) ? abaBruta : urgentesPelaAba ? 'aberto' : RECORTE_PADRAO;
  const responsaveis = sp.get('responsaveis') || sp.get('responsavel') || undefined;
  const flag = (n: string) => {
    const v = sp.get(n);
    return v === '1' || v === 'true';
  };
  return {
    aba,
    pessoa: resolver(sp.get('pessoa')),
    reservaDe: resolver(sp.get('reservaDe')),
    responsaveis,
    somenteResponsavel: !!responsaveis && flag('somenteResponsavel'),
    tipo: sp.get('tipo') || undefined,
    urgentes: urgentesPelaAba || flag('urgentes'),
    compromisso: sp.get('compromisso') || undefined,
    busca: sp.get('busca') || undefined,
    aguardandoSessao,
  };
}

/**
 * Filtros que a tela manda ao servidor, SEM o recorte — o mesmo objeto vai para
 * a listagem (com `recorte`) e para os contadores (sem ele). Assim o número da
 * aba e a lista que ela abre não têm como divergir por filtro esquecido.
 */
export function filtroDoServidor(e: {
  pessoa?: string;
  reservaDe?: string;
  responsaveis?: string;
  somenteResponsavel?: boolean;
  tipo?: string;
  urgentes?: boolean;
  busca?: string;
}): Omit<FiltroCompromissos, 'recorte'> {
  const f: Omit<FiltroCompromissos, 'recorte'> = {};
  if (e.pessoa) f.pessoa = e.pessoa;
  if (e.reservaDe) f.reservaDe = e.reservaDe;
  if (e.responsaveis) {
    f.responsaveis = e.responsaveis;
    if (e.somenteResponsavel) f.somenteResponsavel = '1';
  }
  if (e.tipo) f.tipo = e.tipo;
  if (e.urgentes) f.urgente = 'true';
  const busca = e.busca?.trim();
  if (busca) f.busca = busca;
  return f;
}

/**
 * Quantos filtros a pessoa LIGOU. A aba nunca conta (toda tela tem uma), e
 * a aba padrão também não — senão a linha "1 filtro ativo" aparecia sempre.
 */
export function contarFiltrosAtivos(e: {
  pessoa?: string;
  reservaDe?: string;
  responsaveis?: string;
  tipo?: string;
  urgentes?: boolean;
  busca?: string;
}): number {
  let n = 0;
  if (e.pessoa) n++;
  if (e.reservaDe) n++;
  if (e.responsaveis) n++;
  if (e.tipo) n++;
  if (e.urgentes) n++;
  if (e.busca?.trim()) n++;
  return n;
}

export async function buscarRecortes(
  filtro: Omit<FiltroCompromissos, 'recorte'> = {},
): Promise<ContagemRecortes> {
  return (await api.get('/compromissos/recortes', { params: paraParams(filtro) })).data;
}

// ---------------------------------------------------------------------------
// Lista por dia (14/09/2026)
//
// No celular o quadro empilhava as quatro colunas e desmontava a ordem do
// tempo. A lista responde "o que tenho hoje e depois". As regras moram aqui,
// puras e testadas com linhas; o componente só desenha.
// ---------------------------------------------------------------------------

export type VisaoDaAgenda = 'quadro' | 'lista';

/**
 * Tamanho da página de "Todas" na lista. Medido em 14/09/2026: 89 atividades
 * no acervo inteiro — hoje o "Carregar mais" quase nunca aparece. O contrato
 * entra assim mesmo porque é aditivo e barato, e o dia em que o robô dobrar o
 * ritmo não vira uma lista de 500 cartões no telefone.
 */
export const PAGINA_DA_AGENDA = 50;

/**
 * CURSOR DA PRÓXIMA PÁGINA — `<ISO do início do último>_<id>`, ou nada.
 *
 * Por chave (início, id) e não por deslocamento: o robô cria e remarca
 * atividades o dia inteiro, e "pule as 50 primeiras" repetiria ou perderia
 * itens entre uma página e outra. O id desempata os inícios iguais (o robô
 * grava várias às 9h em ponto).
 *
 * Página com menos que o limite é a última. Com exatamente o limite, sobra uma
 * requisição vazia a mais — aceitável, e é o que a API espera.
 */
export function proximoCursor(
  ultima: readonly { inicio: string; id: string }[],
  limite: number,
): string | undefined {
  if (ultima.length === 0 || ultima.length < limite) return undefined;
  const u = ultima[ultima.length - 1];
  const t = new Date(u.inicio);
  if (Number.isNaN(t.getTime())) return undefined;
  // Normaliza para o ISO com "Z", que é o formato que a API valida.
  return `${t.toISOString()}_${u.id}`;
}

/**
 * As páginas viram uma lista, sem repetir. Uma atividade remarcada entre uma
 * página e outra pode vir duas vezes até a próxima atualização — fica a
 * primeira, que é a que a pessoa já leu.
 */
export function semRepetidas<T extends { id: string }>(paginas: readonly (readonly T[])[]): T[] {
  const porId = new Map<string, T>();
  for (const pagina of paginas) {
    for (const c of pagina) if (!porId.has(c.id)) porId.set(c.id, c);
  }
  return [...porId.values()];
}

/**
 * AS PÁGINAS JÁ CHEGARAM A HOJE? Só aí o Hoje vazio de Próximas diz a verdade.
 *
 * Em `adiante` a API ordena por início crescente, e as abertas que ficaram
 * para trás vêm antes de tudo. Com 50 delas no filtro, a primeira página é só
 * âmbar e as de hoje estão atrás de "Carregar mais": o grupo vazio afirmaria
 * "Nenhuma atividade hoje" e convidaria a cadastrar em duplicata (revisão de
 * 14/09/2026). Chegou quando não há próxima página ou quando o último item
 * carregado, na ordem da API, já é de hoje ou depois.
 */
export function paginasChegaramAHoje(
  itensNaOrdemDaApi: readonly { inicio: string }[],
  temProxima: boolean,
  agora: number,
): boolean {
  if (!temProxima) return true;
  const ultimo = itensNaOrdemDaApi[itensNaOrdemDaApi.length - 1];
  return !!ultimo && diaBRDe(ultimo.inicio) >= diaBR(agora);
}

/** "09:30" no relógio de Teresina (UTC−3 fixo), o mesmo do dia do cabeçalho. */
export function horaBRDe(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t - FUSO_BR_MS).toISOString().slice(11, 16);
}

function somarDiasAoYmd(ymd: string, dias: number): string {
  const [a, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * "Hoje · dom, 13/09", "Amanhã · seg, 14/09", "Ontem · sáb, 12/09" ou só "qua, 16/09".
 *
 * O dia curto vem de `rotuloCurtoDoDia` (lib/dia-curto), calculado e nunca
 * escrito à mão: os exemplos do pedido diziam "sex, 13/09", e 13/09/2026 é
 * domingo. Com hoje, põe o ano quando não é o corrente.
 */
export function rotuloDoCabecalho(ymd: string, hojeYmd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const curto = rotuloCurtoDoDia(ymd, hojeYmd);
  if (ymd === hojeYmd) return `Hoje · ${curto}`;
  if (ymd === somarDiasAoYmd(hojeYmd, 1)) return `Amanhã · ${curto}`;
  if (ymd === somarDiasAoYmd(hojeYmd, -1)) return `Ontem · ${curto}`;
  return curto;
}

type ItemDaLista = Pick<Compromisso, 'id' | 'inicio' | 'status' | 'tipo' | 'origemAutomatica'>;

export interface GrupoDaLista<T extends ItemDaLista = Compromisso> {
  /** 'ficaram-para-tras' ou o próprio 'AAAA-MM-DD'. */
  chave: string;
  /** O grupo âmbar do topo: abertas de dia anterior. */
  paraTras: boolean;
  /** Dia de Teresina do grupo; nulo no grupo âmbar, que mistura dias. */
  ymd: string | null;
  hoje: boolean;
  rotulo: string;
  itens: T[];
}

const porInicioEId = (a: { inicio: string; id: string }, b: { inicio: string; id: string }) => {
  const d = new Date(a.inicio).getTime() - new Date(b.inicio).getTime();
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

/**
 * A LISTA EM GRUPOS POR DIA DE TERESINA.
 *
 * - `adiante`: primeiro o grupo "Ficaram para trás" (a régua de `estaAtrasado`,
 *   a mais antiga primeiro), depois um grupo por dia, do mais cedo ao mais
 *   tarde. Dentro do dia, as TAREFAS (botão cheio Concluir, D7) vêm antes das
 *   de hora marcada, e cada metade por início. Não existe campo "dia inteiro"
 *   no banco: a regra D7 já decide o que é tarefa, e uma segunda regra
 *   divergiria dela.
 * - `anteriores`: sem âmbar, dias do mais recente ao mais antigo e tudo
 *   decrescente, inclusive dentro do dia — a página seguinte da API vem
 *   depois do último item, e assim nunca entra acima do que a pessoa já leu.
 *
 * Dia sem atividade é pulado. HOJE é a exceção quando `incluirHoje`: aparece
 * vazio, porque "nenhuma atividade hoje" é resposta, e o vazio convida a
 * cadastrar (a lição da coluna vazia do quadro).
 *
 * `separarParaTras` (padrão: só em `adiante`) desliga o grupo âmbar quando a
 * lista já é de um dia escolhido no calendário.
 *
 * `paginas` (id → página em que chegou) vale em Todas · Próximas. Sem ela, a
 * tarefa "No dia" da página 2 subia acima das consultas de hora marcada da
 * página 1 no mesmo dia, e o cartão que a pessoa estava lendo descia depois do
 * "Carregar mais" (auditoria de 14/09/2026). Com ela, a página seguinte só
 * acrescenta no fim de cada grupo; dentro de cada página a regra é a de sempre.
 */
export function agruparPorDia<T extends ItemDaLista>(
  itens: readonly T[],
  opcoes: {
    agora: number;
    sentido: JanelaDaAgenda;
    incluirHoje: boolean;
    separarParaTras?: boolean;
    paginas?: ReadonlyMap<string, number>;
  },
): GrupoDaLista<T>[] {
  const { agora, sentido } = opcoes;
  const hojeYmd = diaBR(agora);
  const separar = opcoes.separarParaTras ?? sentido === 'adiante';
  const pagina = (c: { id: string }) => opcoes.paginas?.get(c.id) ?? 0;

  const paraTras: T[] = [];
  const porDia = new Map<string, T[]>();
  for (const c of itens) {
    if (separar && estadoDoPrazoEm(c, agora) === 'ATRASADA') {
      paraTras.push(c);
      continue;
    }
    const ymd = diaBRDe(c.inicio);
    const doDia = porDia.get(ymd);
    if (doDia) doDia.push(c);
    else porDia.set(ymd, [c]);
  }
  if (opcoes.incluirHoje && sentido === 'adiante' && !porDia.has(hojeYmd)) porDia.set(hojeYmd, []);

  const grupos: GrupoDaLista<T>[] = [];
  if (paraTras.length > 0) {
    grupos.push({
      chave: 'ficaram-para-tras',
      paraTras: true,
      ymd: null,
      hoje: false,
      rotulo: 'Ficaram para trás',
      itens: [...paraTras].sort((a, b) => pagina(a) - pagina(b) || porInicioEId(a, b)),
    });
  }

  const dias = [...porDia.keys()].sort();
  if (sentido === 'anteriores') dias.reverse();
  for (const ymd of dias) {
    const doDia = [...(porDia.get(ymd) ?? [])];
    if (sentido === 'anteriores') {
      doDia.sort((a, b) => pagina(a) - pagina(b) || porInicioEId(b, a));
    } else {
      doDia.sort((a, b) => {
        const horaA = Number(acaoPrincipalDoCartao(a) === 'INICIAR');
        const horaB = Number(acaoPrincipalDoCartao(b) === 'INICIAR');
        return pagina(a) - pagina(b) || horaA - horaB || porInicioEId(a, b);
      });
    }
    grupos.push({
      chave: ymd,
      paraTras: false,
      ymd,
      hoje: ymd === hojeYmd,
      rotulo: rotuloDoCabecalho(ymd, hojeYmd),
      itens: doDia,
    });
  }
  return grupos;
}

/**
 * Em que página cada atividade chegou — a primeira vez que apareceu, a mesma
 * que `semRepetidas` mantém. Alimenta `agruparPorDia({ paginas })`.
 */
export function paginaDeCadaItem(paginas: readonly (readonly { id: string }[])[]): Map<string, number> {
  const mapa = new Map<string, number>();
  paginas.forEach((pagina, i) => {
    for (const c of pagina) if (!mapa.has(c.id)) mapa.set(c.id, i);
  });
  return mapa;
}

/**
 * AS OPÇÕES DA LISTA POR DIA, NUM LUGAR SÓ (15/09/2026).
 *
 * Moravam soltas na página, e o único teste que as guardava procurava as linhas
 * no fonte com `toContain`: provava que a linha existia, não que acertava.
 * Agora a página chama esta função e o teste roda com linhas de 2026.
 *
 * - Anteriores só existe em Todas; fora dela a lista anda para a frente.
 * - Hoje vazio não entra num dia escolhido, na aba "Ficaram para trás", nem em
 *   Todas enquanto as páginas não chegaram a hoje.
 * - O grupo âmbar não entra num dia escolhido.
 * - A ordem por página só vale em Todas, que é a única paginada.
 */
export function opcoesDaLista(p: {
  listaDeTodas: boolean;
  diaEscolhido: boolean;
  aba: RecorteAgenda;
  janelaDosDados: JanelaDaAgenda;
  itensNaOrdemDaApi: readonly { inicio: string }[];
  temProxima: boolean;
  agora: number;
  paginas?: ReadonlyMap<string, number>;
}): {
  agora: number;
  sentido: JanelaDaAgenda;
  incluirHoje: boolean;
  separarParaTras: boolean;
  paginas?: ReadonlyMap<string, number>;
} {
  const sentido: JanelaDaAgenda = p.listaDeTodas ? p.janelaDosDados : 'adiante';
  const chegouAHoje = !p.listaDeTodas || paginasChegaramAHoje(p.itensNaOrdemDaApi, p.temProxima, p.agora);
  return {
    agora: p.agora,
    sentido,
    incluirHoje: !p.diaEscolhido && p.aba !== 'atrasadas' && chegouAHoje,
    separarParaTras: !p.diaEscolhido && sentido === 'adiante',
    ...(p.listaDeTodas && p.paginas ? { paginas: p.paginas } : {}),
  };
}

/**
 * O RODAPÉ DE "CARREGAR MAIS" LÊ SÓ A PÁGINA SEGUINTE.
 *
 * O react-query guarda a página 1 quando a 2 falha: o erro que interessa aqui é
 * `isFetchNextPageError`, e não o da consulta inteira (que o bloco de erro da
 * tela já trata). Durante a troca de Próximas para Anteriores, os dados à vista
 * ainda são da janela anterior: oferecer mais deles seria pedir a página errada.
 */
export function estadoDoRodape(q: {
  hasNextPage?: boolean;
  isPlaceholderData: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
}): { temMais: boolean; carregando: boolean; erro: boolean } {
  return {
    temMais: !!q.hasNextPage && !q.isPlaceholderData,
    carregando: q.isFetchingNextPage,
    erro: q.isFetchNextPageError,
  };
}

/**
 * QUANTAS O RECORTE TEM, E NÃO QUANTAS JÁ CHEGARAM (15/09/2026).
 *
 * Em Todas a lista vem de 50 em 50: "1 filtro ativo · 50 atividades" e o botão
 * "Ver 50 atividades" do celular contavam só as páginas carregadas, com 120 no
 * recorte. Com o total da janela (a API nova manda), vale o total; sem ele, o
 * que está na tela. Nunca menos que o carregado: a contagem pode ter vindo antes
 * de uma atividade nova.
 */
export function quantasNoRecorte(p: { listaDeTodas: boolean; carregadas: number; totalDaJanela?: number }): number {
  if (!p.listaDeTodas || p.totalDaJanela === undefined) return p.carregadas;
  return Math.max(p.totalDaJanela, p.carregadas);
}

/**
 * O TOTAL DO GRUPO "FICARAM PARA TRÁS" QUANDO NEM TUDO CHEGOU.
 *
 * Com página de 50 e 60 atrasadas, o cabeçalho dizia "Ficaram para trás · 50"
 * enquanto a aba dizia 60 (auditoria de 14/09/2026). Só Todas · Próximas é
 * paginada e só ela tem esse grupo; com a última página já carregada, o que
 * está na tela é o total e nada muda.
 */
export function totalDoGrupoParaTras(p: {
  listaDeTodas: boolean;
  janelaDosDados: JanelaDaAgenda;
  temProxima: boolean;
  atrasadas?: number;
}): number | undefined {
  if (!p.listaDeTodas || p.janelaDosDados !== 'adiante' || !p.temProxima) return undefined;
  return p.atrasadas;
}

/** "50 de 60" quando faltam páginas; só "60" quando tudo chegou. */
export function contagemDoGrupoParaTras(carregadas: number, total?: number): string {
  return total !== undefined && total > carregadas ? `${carregadas} de ${total}` : String(carregadas);
}

/**
 * QUADRO OU LISTA, com a regra de Todas (decisão de 15/09/2026).
 *
 * "Carregar mais" e Próximas/Anteriores só existem na lista. O computador abria
 * no quadro, onde Todas continuava crescente, sem as duas metades e com teto de
 * 500: o pedido do dono ("Carregar mais em Todas") não chegava a quem usa o
 * computador. Tocar em Todas passa para a lista, a não ser que a pessoa tenha
 * escolhido o Quadro nesta sessão, e aí a escolha dela vale. Fora de Todas,
 * vale a escolha guardada, e sem escolha decide a largura.
 */
export function visaoDaAgenda(p: {
  escolhida: VisaoDaAgenda | null;
  telaLarga: boolean;
  aba: RecorteAgenda;
  quadroNaSessao: boolean;
}): VisaoDaAgenda {
  if (p.aba === 'todos' && !p.quadroNaSessao) return 'lista';
  return p.escolhida ?? (p.telaLarga ? 'quadro' : 'lista');
}

/**
 * O DIA DO CALENDÁRIO É O DIA DE TERESINA (15/09/2026).
 *
 * O dia escolhido filtrava por `getDate()` do aparelho, e os grupos da lista
 * usam Teresina: num aparelho em outro fuso (ou num notebook em UTC), a consulta
 * das 23h30 caía num dia no filtro e em outro no grupo, na mesma tela. A célula
 * do calendário continua um `Date` local (é a grade que a pessoa vê); o que se
 * compara é o texto 'AAAA-MM-DD' da célula com o dia de Teresina da atividade.
 */
export function ymdDoCalendario(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A célula do calendário (meia-noite local) do dia de Teresina em que o instante cai. */
export function celulaDoDiaBR(instante: string | number | Date): Date {
  const [a, m, d] = diaBRDe(instante).split('-').map(Number);
  return new Date(a, m - 1, d);
}

/** As atividades cujo dia de Teresina é o `ymd` — o filtro do dia escolhido e da célula. */
export function doDiaDeTeresina<T extends { inicio: string }>(itens: readonly T[], ymd: string): T[] {
  return itens.filter((c) => diaBRDe(c.inicio) === ymd);
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/**
 * "Setembro de 2026" (15/09/2026). O cabeçalho usava a classe `capitalize`, que
 * põe maiúscula em TODA palavra: saía "Setembro De 2026" na produção. Só a
 * primeira letra sobe.
 */
export function rotuloDoMes(mes: Date): string {
  const nome = MESES[mes.getMonth()];
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${mes.getFullYear()}`;
}

export async function getCompromisso(id: string): Promise<CompromissoDetalhe> {
  return (await api.get(`/compromissos/${id}`)).data;
}

export async function atualizarCompromisso(id: string, dto: Partial<CriarCompromissoInput>) {
  return (await api.patch(`/compromissos/${id}`, dto)).data;
}

/**
 * Avanço simples: iniciar, voltar a pendente, reabrir. Concluir e cancelar têm
 * funções próprias — a API recusa esses dois aqui, porque exigem desfecho/motivo.
 */
export async function mudarStatusCompromisso(
  id: string,
  status: StatusCompromisso,
  /** Só na reabertura: vai para o histórico, onde o desfecho apagado sobrevive. */
  motivo?: string,
) {
  return (await api.patch(`/compromissos/${id}/status`, { status, motivo })).data;
}

/**
 * CORRIGE O DESFECHO SEM REABRIR — a saída que o dono pediu em 21/09/2026.
 *
 * Reabrir é para quando o trabalho voltou. Errar o rótulo é outra coisa, e pelo
 * caminho antigo consertar um rótulo custava a data e o autor da conclusão, o
 * item voltava para a fila e o atendimento fechado pela consulta reabria junto.
 */
export async function corrigirDesfecho(id: string, desfecho: string, desfechoObs?: string) {
  return (await api.patch(`/compromissos/${id}/desfecho`, { desfecho, desfechoObs })).data;
}

export interface ConcluirInput {
  desfecho: DesfechoCompromisso;
  desfechoObs?: string;
  /** Obrigatório em VINCULADO_PROCESSO. */
  processoId?: string;
  /** Usado em PROCESSO_CRIADO — abre o caso na aba Pré-processuais. */
  novoProcesso?: {
    titulo?: string;
    assunto?: string;
    /** Área jurídica — slug de `AREAS_JURIDICAS`. */
    categoria?: string;
    advogadoId?: string;
    /** Demais advogados do caso (a equipe da atividade já vai por padrão). */
    advogadosIds?: string[];
    observacao?: string;
  };
  /** Usado em CRIAR_ATIVIDADE — o que difere dos padrões sugeridos pelo desfecho. */
  seguimento?: {
    titulo?: string;
    responsavelId?: string;
    inicio?: string;
    descricao?: string;
  };
  /** `false` dispensa o seguimento SUGERIDO; o obrigatório ignora este campo. */
  criarSeguimento?: boolean;
  /** De onde veio o gesto — só vai para o histórico e a auditoria. */
  origem?: OrigemDaConclusao;
}

export type OrigemDaConclusao = 'PAINEL' | 'AGENDA' | 'GAVETA';

/** Resposta da conclusão — traz o que o desfecho criou junto. */
export interface ConcluirResposta extends Compromisso {
  /** O caso pré-processual aberto pelo desfecho "Virou processo novo". */
  preProcessualCriado: { id: string; titulo: string | null } | null;
  /**
   * O MESMO objeto, sob o nome antigo. A API devolve os dois porque durante a
   * troca de contêiner o front antigo ainda lê por aqui. Some quando não houver
   * mais nada lendo — e é este campo, não o de cima, que pode sumir.
   * @deprecated use `preProcessualCriado`
   */
  rascunhoCriado: { id: string; titulo: string | null } | null;
  seguimentoCriado: { id: string; titulo: string; inicio: string; tipo: string } | null;
  /**
   * O atendimento da triagem que fechou junto com esta consulta (15/09/2026).
   * Nulo quando nada fechou; ausente na API antiga (janela de troca).
   */
  atendimentoConcluido?: { id: string; numero: number } | null;
}

/** Resposta do desfazer — o atendimento que voltou a aguardar a consulta, se voltou. */
export interface DesfazerConclusaoResposta extends Compromisso {
  /** Nulo quando o carimbo não bateu; ausente na API antiga (janela de troca). */
  atendimentoReaberto?: { id: string; numero: number } | null;
}

export async function concluirCompromisso(id: string, dto: ConcluirInput): Promise<ConcluirResposta> {
  return (await api.patch(`/compromissos/${id}/concluir`, dto)).data;
}

/**
 * DESFAZ UMA CONCLUSÃO RECENTE (o "Desfazer" do aviso).
 *
 * A API aceita só de quem concluiu, até 120 s depois, e só se a conclusão não
 * criou seguimento nem processo/vínculo; devolve o status anterior e apaga o
 * andamento automático que ELA escreveu. Fora disso responde 400 com a frase
 * que a tela mostra.
 */
export const JANELA_DESFAZER_CONCLUSAO_MS = 120_000;

export async function desfazerConclusao(id: string): Promise<DesfazerConclusaoResposta> {
  return (await api.patch(`/compromissos/${id}/desfazer-conclusao`)).data;
}

/**
 * Esta conclusão ainda PODE ser desfeita? Espelho da regra da API, só para a
 * tela não oferecer o botão que seria recusado. A palavra final é do servidor.
 */
export function podeDesfazerConclusao(
  r: Pick<ConcluirResposta, 'seguimentoCriado' | 'preProcessualCriado' | 'desfecho'> & {
    concluidoEm?: string | null;
  },
  agora: number = Date.now(),
): boolean {
  if (r.seguimentoCriado || r.preProcessualCriado) return false;
  if (r.desfecho === 'VINCULADO_PROCESSO' || r.desfecho === 'PROCESSO_CRIADO') return false;
  if (!r.concluidoEm) return true;
  const passou = agora - new Date(r.concluidoEm).getTime();
  return Number.isFinite(passou) && passou < JANELA_DESFAZER_CONCLUSAO_MS;
}

/**
 * Cancelamento — a CATEGORIA é obrigatória (é ela que explica e que vira
 * estatística); o texto livre é complemento, para o caso que ela não cobre.
 */
export async function cancelarCompromisso(id: string, categoria: string, motivo?: string) {
  return (await api.patch(`/compromissos/${id}/cancelar`, { categoria, motivo: motivo || undefined })).data;
}

/**
 * Remarcação — só data/hora e o porquê. Omitindo o fim, a API preserva a
 * duração original do evento.
 */
export async function remarcarCompromisso(
  id: string,
  dto: { inicio: string; fim?: string; motivo?: string },
) {
  return (await api.patch(`/compromissos/${id}/remarcar`, dto)).data;
}

export async function excluirCompromisso(id: string) {
  return (await api.delete(`/compromissos/${id}`)).data;
}

// ---------------------------------------------------------------------------
// Tipos de evento (cadastráveis)
// ---------------------------------------------------------------------------

export async function listarTiposEvento(incluirInativos = false): Promise<TipoEventoItem[]> {
  return (await api.get('/tipos-evento', { params: incluirInativos ? { incluirInativos: 'true' } : {} })).data;
}
export interface TipoEventoInput { nome: string; cor?: string; ordem?: number; ativo?: boolean }
export async function criarTipoEvento(dto: TipoEventoInput): Promise<TipoEventoItem> {
  return (await api.post('/tipos-evento', dto)).data;
}
export async function atualizarTipoEvento(id: string, dto: Partial<TipoEventoInput>): Promise<TipoEventoItem> {
  return (await api.patch(`/tipos-evento/${id}`, dto)).data;
}
export async function excluirTipoEvento(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/tipos-evento/${id}`)).data;
}
