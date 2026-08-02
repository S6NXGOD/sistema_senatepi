import { api } from './api';
import type { StatusProcesso } from './processos';

// ---------------------------------------------------------------------------
// Tipos (espelham a API — partes do processo e cadastro de partes externas)
// ---------------------------------------------------------------------------

export type PoloProcesso = 'ATIVO' | 'PASSIVO' | 'TERCEIRO';
export type TipoParteExterna = 'FISICA' | 'JURIDICA' | 'ORGAO_PUBLICO';

export interface ParteExterna {
  id: string;
  tipo: TipoParteExterna;
  nome: string;
  nomeFantasia: string | null;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  observacoes: string | null;
  ativo: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { participacoes: number };
}

export interface ParteDoProcesso {
  id: string;
  polo: PoloProcesso;
  papel: string | null;
  principal: boolean;
  /** Nome como consta nos autos — sempre preenchido. */
  nome: string;
  documento: string | null;
  filiadoId: string | null;
  parteExternaId: string | null;
  advogados: { nome: string | null; oab: string | null }[] | null;
  observacao: string | null;
  filiado: { id: string; nomeCompleto: string; matricula: string; situacao: string } | null;
  parteExterna: {
    id: string; tipo: TipoParteExterna; nome: string;
    nomeFantasia: string | null; documento: string | null; ativo: boolean;
  } | null;
}

/** Resumo da parte que vem na LISTA de processos (sem os cadastros aninhados). */
export interface ParteResumo {
  id: string;
  polo: PoloProcesso;
  papel: string | null;
  principal: boolean;
  nome: string;
}

/** O par que a tela mostra como "Autor × Réu". */
export interface Confronto<T = ParteResumo> {
  autor: T | null;
  reu: T | null;
  outrosAtivo: number;
  outrosPassivo: number;
}

export interface PolosProcesso {
  ativo: ParteDoProcesso[];
  passivo: ParteDoProcesso[];
  terceiros: ParteDoProcesso[];
  confronto: Confronto<ParteDoProcesso>;
}

export interface AdvogadoDoProcesso {
  principal: boolean;
  advogado: {
    id: string;
    nome: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
    oab: string | null;
    oabUf: string | null;
    ativo: boolean;
  };
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const POLO_LABEL: Record<PoloProcesso, string> = {
  ATIVO: 'Polo Ativo',
  PASSIVO: 'Polo Passivo',
  TERCEIRO: 'Terceiros',
};

/** Quem é quem, em português de gente — o que a tela precisa deixar óbvio. */
export const POLO_DESCRICAO: Record<PoloProcesso, string> = {
  ATIVO: 'quem entrou com a ação',
  PASSIVO: 'contra quem a ação foi movida',
  TERCEIRO: 'assistentes, litisconsortes e demais interessados',
};

export const POLO_COR: Record<PoloProcesso, string> = {
  ATIVO: 'emerald',
  PASSIVO: 'rose',
  TERCEIRO: 'slate',
};

export const TIPO_PARTE_LABEL: Record<TipoParteExterna, string> = {
  FISICA: 'Pessoa física',
  JURIDICA: 'Empresa',
  ORGAO_PUBLICO: 'Órgão público',
};

/**
 * Papéis sugeridos por polo. Texto livre no banco de propósito — a nomenclatura
 * muda conforme a justiça (trabalhista fala Reclamante/Reclamada, cível fala
 * Autor/Réu) e o campo precisa acompanhar os autos, não o contrário.
 */
export const PAPEIS_SUGERIDOS: Record<PoloProcesso, string[]> = {
  ATIVO: ['Autor', 'Reclamante', 'Exequente', 'Impetrante', 'Requerente', 'Substituído'],
  PASSIVO: ['Réu', 'Reclamada', 'Executada', 'Impetrado', 'Requerido'],
  TERCEIRO: ['Terceiro interessado', 'Assistente', 'Litisconsorte', 'Ministério Público', 'Perito'],
};

/** Máscara de CPF (11) / CNPJ (14) para exibição. */
export function formatDocumento(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
}

/** Máscara progressiva enquanto digita (alterna CPF/CNPJ pelo tamanho). */
export function mascararDocumento(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

/** Rótulo curto de uma parte: nome + papel, sem repetir informação. */
export function rotuloParte(p: { nome: string; papel: string | null }): string {
  return p.papel ? `${p.nome} (${p.papel})` : p.nome;
}

// ---------------------------------------------------------------------------
// API — partes do processo
// ---------------------------------------------------------------------------

export interface AdicionarParteInput {
  polo: PoloProcesso;
  filiadoId?: string;
  parteExternaId?: string;
  nome?: string;
  documento?: string;
  papel?: string;
  principal?: boolean;
  advogados?: { nome?: string; oab?: string }[];
  observacao?: string;
}

export async function listarPartes(processoId: string): Promise<PolosProcesso> {
  return (await api.get(`/processos/${processoId}/partes`)).data;
}

export async function adicionarParte(
  processoId: string,
  dto: AdicionarParteInput,
): Promise<ParteDoProcesso> {
  return (await api.post(`/processos/${processoId}/partes`, dto)).data;
}

export async function atualizarParte(
  parteId: string,
  dto: Partial<AdicionarParteInput>,
): Promise<ParteDoProcesso> {
  return (await api.patch(`/processos/partes/${parteId}`, dto)).data;
}

export async function removerParte(parteId: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/processos/partes/${parteId}`)).data;
}

// ---------------------------------------------------------------------------
// API — advogados da casa no processo
// ---------------------------------------------------------------------------

export async function listarAdvogadosDoProcesso(processoId: string): Promise<AdvogadoDoProcesso[]> {
  return (await api.get(`/processos/${processoId}/advogados`)).data;
}

/** Envia a lista COMPLETA (substitui a atual) e quem é o responsável. */
export async function definirAdvogadosDoProcesso(
  processoId: string,
  advogadoIds: string[],
  principalId?: string,
): Promise<AdvogadoDoProcesso[]> {
  return (
    await api.patch(`/processos/${processoId}/advogados`, {
      advogadoIds,
      ...(principalId ? { principalId } : {}),
    })
  ).data;
}

// ---------------------------------------------------------------------------
// API — cadastro de partes externas
// ---------------------------------------------------------------------------

export interface ListaPartesExternasResp {
  items: ParteExterna[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

export interface ParteExternaInput {
  tipo: TipoParteExterna;
  nome: string;
  nomeFantasia?: string;
  documento?: string;
  email?: string;
  telefone?: string;
  cidade?: string;
  uf?: string;
  observacoes?: string;
  ativo?: boolean;
}

export async function listarPartesExternas(f: {
  busca?: string;
  tipo?: TipoParteExterna;
  incluirInativas?: 'true';
  page?: number;
  pageSize?: number;
} = {}): Promise<ListaPartesExternasResp> {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') params[k] = v as string | number;
  }
  return (await api.get('/partes-externas', { params })).data;
}

/** Dossiê da parte: cadastro + todos os processos em que ela figura. */
export interface DossieParteExterna extends ParteExterna {
  participacoes: {
    id: string;
    polo: PoloProcesso;
    papel: string | null;
    processo: {
      id: string;
      numeroCNJ: string;
      classeProcessual: string | null;
      assuntoPrincipal: string | null;
      tribunal: string | null;
      statusInterno: StatusProcesso;
      valorCausa: string | number | null;
      dataDistribuicao: string | null;
    };
  }[];
  resumo: {
    processos: number;
    comoReu: number;
    comoAutor: number;
    valorTotalEmCausa: number;
    porStatus: Record<string, number>;
  };
}

export async function getParteExterna(id: string): Promise<DossieParteExterna> {
  return (await api.get(`/partes-externas/${id}`)).data;
}

export async function criarParteExterna(dto: ParteExternaInput): Promise<ParteExterna> {
  return (await api.post('/partes-externas', dto)).data;
}

export async function atualizarParteExterna(
  id: string,
  dto: Partial<ParteExternaInput>,
): Promise<ParteExterna> {
  return (await api.patch(`/partes-externas/${id}`, dto)).data;
}

export async function excluirParteExterna(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/partes-externas/${id}`)).data;
}
