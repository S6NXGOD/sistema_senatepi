import { api } from './api';
import { chaveLocal } from '@/lib/armazenamento';

/**
 * Identidade visual da instalação — cor institucional e logos.
 *
 * O `tenant.config` continua sendo o PADRÃO; o que vem daqui é uma
 * sobreposição. Instalação que nunca mexeu devolve tudo nulo, e nada muda.
 */

export type SlotLogo = 'horizontal-cor' | 'horizontal-branco' | 'vertical-cor' | 'vertical-branco';

export interface IdentidadeVisual {
  corPrimaria: string | null;
  logos: Record<SlotLogo, string | null>;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

/** Chave do cache local. Ver `marca-css.tsx` para o porquê de existir. */
export const CHAVE_MARCA = chaveLocal('marca-canais');

/** Pública: a tela de login precisa da marca antes de qualquer autenticação. */
export async function obterIdentidade(): Promise<IdentidadeVisual> {
  return (await api.get('/identidade-visual')).data;
}

export async function salvarCor(corPrimaria: string | null): Promise<IdentidadeVisual> {
  return (await api.put('/identidade-visual', { corPrimaria })).data;
}

export async function enviarLogo(slot: SlotLogo, arquivo: File): Promise<IdentidadeVisual> {
  const form = new FormData();
  form.append('arquivo', arquivo);
  return (await api.post(`/identidade-visual/logo/${slot}`, form)).data;
}

export async function removerLogo(slot: SlotLogo): Promise<IdentidadeVisual> {
  return (await api.delete(`/identidade-visual/logo/${slot}`)).data;
}

export const ROTULO_SLOT: Record<SlotLogo, string> = {
  'horizontal-cor': 'Horizontal · colorido',
  'horizontal-branco': 'Horizontal · branco',
  'vertical-cor': 'Vertical · colorido',
  'vertical-branco': 'Vertical · branco',
};

export const DICA_SLOT: Record<SlotLogo, string> = {
  'horizontal-cor': 'Topo do sistema no tema claro.',
  'horizontal-branco': 'Topo do sistema no tema escuro e sobre fundos da cor da marca.',
  'vertical-cor': 'Documentos e telas estreitas.',
  'vertical-branco': 'Documentos com fundo escuro.',
};
