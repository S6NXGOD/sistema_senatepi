/**
 * Espelho de apps/api/src/modules/filiados/campos-imutaveis.ts.
 *
 * A trava REAL é do servidor; aqui a lista existe só para a tela mostrar o
 * cadeado e explicar por que o campo não aceita digitação. Se divergirem, o
 * servidor vence — o usuário só teria a má experiência de digitar em vão.
 */

export const CAMPOS_IMUTAVEIS = ['cpf', 'rg', 'ufRg', 'dataNascimento', 'naturalidade'] as const;

export type CampoImutavel = (typeof CAMPOS_IMUTAVEIS)[number];

/** Um campo está TRAVADO quando é imutável E já tem valor no cadastro. */
export function travado(campo: CampoImutavel, valorAtual: unknown): boolean {
  if (valorAtual === null || valorAtual === undefined) return false;
  if (typeof valorAtual === 'string') return valorAtual.trim().length > 0;
  return true;
}

export const AVISO_TRAVADO =
  'Não muda ao longo da vida. Se estiver errado, a equipe corrige na edição do cadastro.';

export const AVISO_VAZIO_LIBERADO =
  'Está em branco no cadastro — pode ser preenchido agora.';
