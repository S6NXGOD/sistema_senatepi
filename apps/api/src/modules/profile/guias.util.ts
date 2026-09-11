/**
 * OS GUIAS DE PRIMEIRO ACESSO QUE A PESSOA JÁ VIU.
 *
 * Moram em `users.preferencias.guias`, como `{ chave: quando }`. A tela só
 * precisa da lista de chaves; a data fica para responder, um dia, "quando essa
 * pessoa viu o guia" sem ter de adivinhar.
 *
 * Função pura e à parte porque DOIS lugares devolvem o usuário para a tela — o
 * login e `/profile/me` — e os dois têm de dizer a mesma coisa. Se só o
 * `/profile/me` soubesse, o guia apareceria de novo logo depois de entrar, até
 * a revalidação chegar.
 */
export function guiasVistosDe(preferencias: unknown): string[] {
  if (!preferencias || typeof preferencias !== 'object' || Array.isArray(preferencias)) return [];
  const guias = (preferencias as Record<string, unknown>).guias;
  if (!guias || typeof guias !== 'object' || Array.isArray(guias)) return [];
  return Object.keys(guias);
}

/** Chave curta, minúscula, com hífen — nada que vire caminho, SQL ou HTML. */
export const CHAVE_DE_GUIA = /^[a-z0-9-]{2,40}$/;
