import { api } from './api';
import { CORES_PALETA, PALETA, type ClassesCor, type CorPaleta } from './paleta-cores';
import { V } from '@/lib/vocabulario';

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
}): Promise<ChoqueDeAgenda[]> {
  return (await api.get('/compromissos/conflitos', { params: p })).data;
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
  partes?: { nome: string; polo: 'ATIVO' | 'PASSIVO' | 'TERCEIRO' }[];
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
  equipe?: { principal: boolean; usuario: Responsavel }[];
  /** Quem REGISTROU a demanda (com foto). Nulo em eventos do robô. */
  criador: Responsavel | null;
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
    descricao: string;
    createdAt: string;
    atendente: { id: string; nome: string; nomeExibicao: string | null };
  } | null;
}

export interface AlertasAgenda {
  aguardando: Compromisso[];
  proximas24h: Compromisso[];
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

export const STATUS_COR: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  EM_ANDAMENTO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  CONCLUIDO: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400',
  CANCELADO: 'bg-muted text-muted-foreground line-through',
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
export function formatData(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function formatHora(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Atrasado = início já passou e ainda está Pendente/Em andamento. */
export function estaAtrasado(c: { inicio: string; status: StatusCompromisso }): boolean {
  if (c.status === 'CONCLUIDO' || c.status === 'CANCELADO') return false;
  return new Date(c.inicio).getTime() < Date.now();
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
}
export async function criarCompromisso(dto: CriarCompromissoInput) {
  return (await api.post('/compromissos', dto)).data;
}

/** Alertas da agenda: aguardando interação (+3h) e próximas 24h. */
export async function listarAlertas(): Promise<AlertasAgenda> {
  return (await api.get('/compromissos/alertas')).data;
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

export function cronometroEsquecido(
  fimPrevistoIso: string | null | undefined,
  agora: number = Date.now(),
): boolean {
  if (!fimPrevistoIso) return false;
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
  return c.responsavel?.id === meuId || !!c.equipe?.some((e) => e.usuario.id === meuId);
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
  busca?: string;
  dataInicio?: string;
  dataFim?: string;
}
export async function listarCompromissos(filtro: FiltroCompromissos = {}): Promise<Compromisso[]> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(filtro)) if (v) params[k] = String(v);
  return (await api.get('/compromissos', { params })).data;
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
export async function mudarStatusCompromisso(id: string, status: StatusCompromisso) {
  return (await api.patch(`/compromissos/${id}/status`, { status })).data;
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
}

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
}

export async function concluirCompromisso(id: string, dto: ConcluirInput): Promise<ConcluirResposta> {
  return (await api.patch(`/compromissos/${id}/concluir`, dto)).data;
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
