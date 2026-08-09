import { api } from './api';
import type { StatusContribuicao } from './portal-empresa';

export type { StatusContribuicao };

/** Contribuição patronal como o painel administrativo enxerga. */
export interface ContribuicaoAdmin {
  id: string;
  mesReferencia: string;
  competencia: string;
  valorDeclarado: number;
  status: StatusContribuicao;
  temComprovante: boolean;
  temRelacao: boolean;
  motivoRejeicao: string | null;
  enviadoEm: string | null;
  analisadoEm: string | null;
  analista: string | null;
  movimentacaoId: string | null;
  createdAt: string;
  empresa: {
    id: string;
    cnpj: string;
    razaoSocial: string;
    nomeFantasia: string | null;
  };
}

export interface ListaContribuicoesAdmin {
  data: ContribuicaoAdmin[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
  resumo: {
    aguardando: number;
    emAnalise: number;
    homologadas: number;
    rejeitadas: number;
    totalHomologado: number;
  };
}

const BASE = '/cobrancas/contribuicoes-patronais';

export async function listarContribuicoesAdmin(params: {
  status?: StatusContribuicao;
  busca?: string;
  mesReferencia?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListaContribuicoesAdmin> {
  return (await api.get(BASE, { params })).data;
}

export async function homologarContribuicao(
  id: string,
  dados: { contaBancariaId?: string; observacao?: string },
): Promise<ContribuicaoAdmin & { lancamento: { conta: string } | null; avisoFinanceiro: string | null }> {
  return (await api.patch(`${BASE}/${id}/homologar`, dados)).data;
}

export async function rejeitarContribuicao(id: string, motivo: string): Promise<ContribuicaoAdmin> {
  return (await api.patch(`${BASE}/${id}/rejeitar`, { motivo })).data;
}

/** Exclusão permanente (a API restringe ao Administrador). */
export async function excluirContribuicao(
  id: string,
): Promise<{ ok: boolean; lancamentoPreservado: string | null; aviso: string | null }> {
  return (await api.delete(`${BASE}/${id}`)).data;
}

/** Desfaz a entrada no caixa; a contribuição segue homologada, sem valor. */
export async function excluirLancamento(movimentacaoId: string): Promise<{ ok: boolean }> {
  return (await api.delete(`${BASE}/lancamentos/${movimentacaoId}`)).data;
}

/**
 * Baixa um documento para exibir no visualizador.
 *
 * A rota é autenticada, então o arquivo vem por XHR (com o token do Axios) e
 * vira um object URL — um `<iframe src>` apontando direto para a API não
 * levaria o cabeçalho Authorization.
 */
export async function carregarDocumento(
  id: string,
  tipo: 'comprovante' | 'relacao',
): Promise<{ url: string; tipoMime: string }> {
  const r = await api.get(`${BASE}/${id}/documento/${tipo}`, { responseType: 'blob' });
  const blob = r.data as Blob;
  return { url: URL.createObjectURL(blob), tipoMime: blob.type };
}

export const formatarReais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function mascaraCnpj(v: string): string {
  const d = (v ?? '').replace(/\D/g, '').slice(0, 14);
  if (d.length !== 14) return v ?? '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export const STATUS_ADMIN: Record<StatusContribuicao, { label: string; classe: string }> = {
  AGUARDANDO: {
    label: 'Aguardando envio',
    classe: 'bg-muted text-muted-foreground',
  },
  EM_ANALISE: {
    label: 'Em análise',
    classe: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  HOMOLOGADA: {
    label: 'Homologada',
    classe: 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300',
  },
  REJEITADA: {
    label: 'Rejeitada',
    classe: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
};
