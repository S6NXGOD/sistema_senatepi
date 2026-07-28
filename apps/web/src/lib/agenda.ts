import { api } from './api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TipoCompromisso = 'CONSULTA_JURIDICA' | 'AUDIENCIA' | 'PRAZO' | 'REUNIAO' | 'DILIGENCIA';
export type StatusCompromisso = 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO';

export interface FiliadoCard {
  id: string;
  nomeCompleto: string;
  matricula: string;
}
export interface Responsavel {
  id: string;
  nome: string;
  role?: string;
}

export interface Compromisso {
  id: string;
  titulo: string;
  tipo: TipoCompromisso;
  status: StatusCompromisso;
  inicio: string;
  fim: string;
  descricao: string | null;
  dataOriginal: string | null;
  atendimentoId: string | null;
  filiado: FiliadoCard | null;
  responsavel: { id: string; nome: string };
}

export interface CompromissoDetalhe extends Compromisso {
  atendimento: { id: string; canal: string; desfecho: string } | null;
}

// ---------------------------------------------------------------------------
// Rótulos e cores
// ---------------------------------------------------------------------------

export const TIPO_LABEL: Record<TipoCompromisso, string> = {
  CONSULTA_JURIDICA: 'Consulta Jurídica',
  AUDIENCIA: 'Audiência',
  PRAZO: 'Prazo',
  REUNIAO: 'Reunião',
  DILIGENCIA: 'Diligência',
};
export const TIPOS = Object.keys(TIPO_LABEL) as TipoCompromisso[];

/** Cor de cada tipo — usada como borda/ponto do card e no calendário. */
export const TIPO_COR: Record<TipoCompromisso, { borda: string; ponto: string; badge: string }> = {
  CONSULTA_JURIDICA: { borda: 'border-l-sky-500', ponto: 'bg-sky-500', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  AUDIENCIA: { borda: 'border-l-red-500', ponto: 'bg-red-500', badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  PRAZO: { borda: 'border-l-amber-500', ponto: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  REUNIAO: { borda: 'border-l-purple-500', ponto: 'bg-purple-500', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
  DILIGENCIA: { borda: 'border-l-teal-500', ponto: 'bg-teal-500', badge: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
};

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
  descricao?: string;
  responsavelId: string;
  filiadoId?: string;
  atendimentoId?: string;
}
export async function criarCompromisso(dto: CriarCompromissoInput) {
  return (await api.post('/compromissos', dto)).data;
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
