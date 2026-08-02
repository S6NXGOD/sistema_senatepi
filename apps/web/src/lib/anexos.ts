import { api } from './api';

export interface Anexo {
  id: string;
  storageKey: string;
  url: string;
  nomeArquivo: string;
  tipoMime: string;
  tamanhoBytes: number | null;
  atendimentoId: string | null;
  processoId: string | null;
  compromissoId: string | null;
  /** Preenchido quando o anexo foi PUXADO do acervo (não houve upload novo). */
  origemAnexoId: string | null;
  origemDocumentoId: string | null;
  createdAt: string;
}

/** Vínculo do anexo — exatamente um dos três. */
export interface AlvoAnexo {
  atendimentoId?: string;
  processoId?: string;
  compromissoId?: string;
}

/** Extensões aceitas no seletor de arquivos (espelha o whitelist do backend). */
export const MIME_ACEITOS = '.pdf,.doc,.docx,.jpg,.jpeg,.png';
export const TAMANHO_MAX_MB = 15;

export async function listarAnexos(alvo: AlvoAnexo): Promise<Anexo[]> {
  return (await api.get('/anexos', { params: alvo })).data;
}

export async function uploadAnexo(
  alvo: AlvoAnexo,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<Anexo> {
  const fd = new FormData();
  fd.append('arquivo', file);
  if (alvo.atendimentoId) fd.append('atendimentoId', alvo.atendimentoId);
  if (alvo.processoId) fd.append('processoId', alvo.processoId);
  if (alvo.compromissoId) fd.append('compromissoId', alvo.compromissoId);
  return (
    await api.post('/anexos', fd, {
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    })
  ).data;
}

export async function excluirAnexo(id: string): Promise<{ ok: boolean; arquivoMantido?: boolean }> {
  return (await api.delete(`/anexos/${id}`)).data;
}

// ---------------------------------------------------------------------------
// Acervo do filiado — "puxar documento de outro atendimento"
// ---------------------------------------------------------------------------

export type OrigemAcervo = 'ATENDIMENTO' | 'PROCESSO' | 'COMPROMISSO' | 'CADASTRO';

/** Documento já entregue pelo filiado, disponível para reaproveitar. */
export interface ItemAcervo {
  origemTipo: OrigemAcervo;
  origemId: string;
  origemRegistroId: string | null;
  origemRotulo: string;
  storageKey: string;
  nomeArquivo: string;
  tipoMime: string;
  tamanhoBytes: number | null;
  createdAt: string;
  url: string;
  /** Já disponível no registro atual — anexado aqui ou herdado da triagem. */
  jaVinculado: boolean;
}

export const ORIGEM_LABEL: Record<OrigemAcervo, string> = {
  ATENDIMENTO: 'Triagem',
  PROCESSO: 'Processo',
  COMPROMISSO: 'Agenda',
  CADASTRO: 'Cadastro',
};

export const ORIGEM_COR: Record<OrigemAcervo, string> = {
  ATENDIMENTO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  PROCESSO: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  COMPROMISSO: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  CADASTRO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

/**
 * Tudo que o filiado já entregou, em qualquer registro. Passando o alvo, cada
 * item vem marcado com `jaVinculado` (inclusive o que chega por herança da
 * triagem de origem — esse não precisa ser puxado de novo).
 */
export async function listarAcervo(
  filiadoId: string,
  alvo: AlvoAnexo = {},
): Promise<ItemAcervo[]> {
  return (await api.get('/anexos/acervo', { params: { filiadoId, ...alvo } })).data;
}

export interface ResultadoPuxar {
  criados: Anexo[];
  ignorados: number;
}

/** Vincula documentos do acervo ao registro atual, sem novo upload. */
export async function puxarAnexos(
  alvo: AlvoAnexo,
  itens: Array<Pick<ItemAcervo, 'origemTipo' | 'origemId'>>,
): Promise<ResultadoPuxar> {
  return (await api.post('/anexos/puxar', { ...alvo, itens })).data;
}

export function formatTamanho(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const ehImagem = (mime: string) => mime.startsWith('image/');
