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
  createdAt: string;
}

/** Vínculo do anexo — exatamente um dos dois. */
export interface AlvoAnexo {
  atendimentoId?: string;
  processoId?: string;
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
  return (
    await api.post('/anexos', fd, {
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    })
  ).data;
}

export async function excluirAnexo(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/anexos/${id}`)).data;
}

export function formatTamanho(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const ehImagem = (mime: string) => mime.startsWith('image/');
