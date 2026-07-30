import { api } from './api';

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
  role?: string;
  avatarUrl?: string | null;
}
export interface ProcessoRef {
  id: string;
  numeroCNJ: string;
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
  iniciadoEm: string | null;
  dataOriginal: string | null;
  atendimentoId: string | null;
  filiado: FiliadoCard | null;
  responsavel: Responsavel;
  processo: ProcessoRef | null;
}

export interface CompromissoDetalhe extends Compromisso {
  observacoesInternas: string | null;
  criadoPorNome: string | null;
  filiado: (FiliadoCard & {
    cpf: string | null;
    telefonePrincipal: string | null;
    email: string | null;
    formacao: string | null;
  }) | null;
  responsavel: Responsavel & { nomeExibicao?: string | null; role?: string };
  processo: (ProcessoRef & { classeProcessual: string | null }) | null;
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

export interface ClassesTipo { borda: string; ponto: string; badge: string }

/** Chaves de paleta aceitas para a cor do tipo (espelham o backend). */
export const CORES_TIPO = [
  'slate', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose',
  'red', 'orange', 'amber', 'emerald', 'teal', 'cyan',
] as const;
export type CorTipo = (typeof CORES_TIPO)[number];

/** Classes Tailwind por chave de cor (estáticas → geradas pelo Tailwind). */
export const PALETA_TIPO: Record<string, ClassesTipo> = {
  slate: { borda: 'border-l-slate-500', ponto: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  sky: { borda: 'border-l-sky-500', ponto: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  blue: { borda: 'border-l-blue-500', ponto: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  indigo: { borda: 'border-l-indigo-500', ponto: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  violet: { borda: 'border-l-violet-500', ponto: 'bg-violet-500', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  purple: { borda: 'border-l-purple-500', ponto: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  pink: { borda: 'border-l-pink-500', ponto: 'bg-pink-500', badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300' },
  rose: { borda: 'border-l-rose-500', ponto: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  red: { borda: 'border-l-red-500', ponto: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  orange: { borda: 'border-l-orange-500', ponto: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  amber: { borda: 'border-l-amber-500', ponto: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  emerald: { borda: 'border-l-emerald-500', ponto: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  teal: { borda: 'border-l-teal-500', ponto: 'bg-teal-500', badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
  cyan: { borda: 'border-l-cyan-500', ponto: 'bg-cyan-500', badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' },
};

/** Fallback dos 8 tipos "sistema" (quando a lista dinâmica ainda não carregou). */
export const TIPO_PADRAO: Record<string, { nome: string; cor: CorTipo }> = {
  AUDIENCIA: { nome: 'Audiência', cor: 'sky' },
  PRAZO: { nome: 'Prazo', cor: 'red' },
  CONSULTA_JURIDICA: { nome: 'Consulta Jurídica', cor: 'purple' },
  REUNIAO: { nome: 'Reunião', cor: 'emerald' },
  DILIGENCIA: { nome: 'Diligência', cor: 'teal' },
  DESPACHO: { nome: 'Despacho', cor: 'slate' },
  PERICIA: { nome: 'Perícia', cor: 'pink' },
  COMPROMISSO: { nome: 'Compromisso', cor: 'orange' },
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
  CONCLUIDO: 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
  CANCELADO: 'bg-muted text-muted-foreground line-through',
};

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
  responsavelId: string;
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

export interface FiltroCompromissos {
  status?: StatusCompromisso;
  tipo?: TipoCompromisso;
  responsavelId?: string;
  filiadoId?: string;
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

export async function mudarStatusCompromisso(id: string, status: StatusCompromisso) {
  return (await api.patch(`/compromissos/${id}/status`, { status })).data;
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
