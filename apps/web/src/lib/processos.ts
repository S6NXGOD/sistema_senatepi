import { api } from './api';

// ---------------------------------------------------------------------------
// Tipos (espelham a API — módulo de Processos / DATAJUD)
// ---------------------------------------------------------------------------

export type StatusProcesso = 'ATIVO' | 'ARQUIVADO' | 'SUSPENSO';

export interface FiliadoRef {
  id: string;
  nomeCompleto: string;
  matricula: string;
}
export interface AdvogadoRef {
  id: string;
  nome: string;
}

export interface Movimentacao {
  id: string;
  processoId: string;
  dataMovimento: string;
  descricao: string;
  codigoMovimento: number | null;
  createdAt: string;
}

/** Parte processual (com desmascaramento inteligente do CPF do filiado). */
export interface ParteProcesso {
  nome: string | null;
  documento: string | null;
  polo: string | null;
  tipoPessoa: string | null;
  documentoDesmascarado?: boolean;
}

export interface ProcessoLista {
  id: string;
  numeroCNJ: string;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  tribunal: string | null;
  grau: string | null;
  dataDistribuicao: string | null;
  valorCausa: string | number | null;
  statusInterno: StatusProcesso;
  ultimaSincronizacao: string | null;
  filiado: FiliadoRef | null;
  advogado: AdvogadoRef | null;
  _count: { movimentacoes: number };
}

export interface ProcessoDetalhe {
  id: string;
  numeroCNJ: string;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  tribunal: string | null;
  grau: string | null;
  dataDistribuicao: string | null;
  valorCausa: string | number | null;
  statusInterno: StatusProcesso;
  ultimaSincronizacao: string | null;
  filiadoId: string | null;
  advogadoId: string | null;
  createdAt: string;
  updatedAt: string;
  filiado: FiliadoRef | null;
  advogado: AdvogadoRef | null;
  movimentacoes: Movimentacao[];
  /** Presente nas respostas de importar/sincronizar (não vem no GET /:id). */
  partes?: ParteProcesso[];
  /** Presente na resposta de sincronizar. */
  novasMovimentacoes?: number;
}

export interface ListaProcessosResp {
  items: ProcessoLista[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

// ---------------------------------------------------------------------------
// Rótulos e cores
// ---------------------------------------------------------------------------

export const STATUS_PROCESSO_LABEL: Record<StatusProcesso, string> = {
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  ARQUIVADO: 'Arquivado',
};
export const STATUS_PROCESSO_ORDEM: StatusProcesso[] = ['ATIVO', 'SUSPENSO', 'ARQUIVADO'];
export const STATUS_PROCESSO_COR: Record<StatusProcesso, string> = {
  ATIVO: 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
  SUSPENSO: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ARQUIVADO: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

/**
 * Máscara progressiva do NPU/CNJ: XXXXXXX-XX.XXXX.X.XX.XXXX (7-2.4.1.2.4).
 * Aceita entrada com ou sem pontuação e limita a 20 dígitos.
 */
export function mascararNPU(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 20);
  let out = d.slice(0, 7);
  if (d.length > 7) out += '-' + d.slice(7, 9);
  if (d.length > 9) out += '.' + d.slice(9, 13);
  if (d.length > 13) out += '.' + d.slice(13, 14);
  if (d.length > 14) out += '.' + d.slice(14, 16);
  if (d.length > 16) out += '.' + d.slice(16, 20);
  return out;
}

/** Formata um NPU já armazenado (20 dígitos) para exibição. */
export const formatNPU = (numeroCNJ: string) => mascararNPU(numeroCNJ);

export function formatData(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Formata o valor da causa (Decimal chega como string no JSON). */
export function formatMoeda(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface FiltroProcessos {
  busca?: string;
  statusInterno?: StatusProcesso;
  tribunal?: string;
  filiadoId?: string;
  advogadoId?: string;
  page?: number;
  pageSize?: number;
}

export async function listarProcessos(f: FiltroProcessos = {}): Promise<ListaProcessosResp> {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') params[k] = v as string | number;
  }
  return (await api.get('/processos', { params })).data;
}

export async function getProcesso(id: string): Promise<ProcessoDetalhe> {
  return (await api.get(`/processos/${id}`)).data;
}

export interface ImportarProcessoInput {
  numeroCNJ: string;
  tribunal?: string;
  filiadoId?: string;
  advogadoId?: string;
}
/** Gatilho On-Demand: consulta o DATAJUD e cria o cache local (409 se já existir). */
export async function importarProcesso(dto: ImportarProcessoInput): Promise<ProcessoDetalhe> {
  return (await api.post('/processos/importar', dto)).data;
}

/** Re-sincroniza incrementalmente (insere só as movimentações ausentes). */
export async function sincronizarProcesso(id: string): Promise<ProcessoDetalhe> {
  return (await api.patch(`/processos/${id}/sincronizar`)).data;
}

export async function atualizarProcesso(
  id: string,
  dto: { statusInterno?: StatusProcesso; filiadoId?: string | null; advogadoId?: string | null },
): Promise<ProcessoDetalhe> {
  return (await api.patch(`/processos/${id}`, dto)).data;
}
