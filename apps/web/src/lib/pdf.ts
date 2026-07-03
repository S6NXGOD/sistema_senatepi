import { api } from './api';

/**
 * Abre um PDF de endpoint protegido (que exige Authorization: Bearer).
 * Links <a href> normais não enviam o token, então buscamos via axios
 * como blob e navegamos a aba para o object URL.
 *
 * A aba é aberta de forma síncrona (no clique) para não ser bloqueada por
 * bloqueadores de pop-up; só então é redirecionada ao blob.
 */
export async function abrirPdf(endpoint: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const res = await api.get(endpoint, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

/** Baixa um arquivo de endpoint protegido (envia o token e força o download). */
export async function baixarArquivo(endpoint: string, nomeArquivo: string): Promise<void> {
  const res = await api.get(endpoint, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
