import { api } from './api';

export type SituacaoFiliado = 'ATIVO' | 'INATIVO' | 'DESFILIADO';
export type FormacaoProfissional =
  | 'ENFERMEIRO'
  | 'TECNICO_ENFERMAGEM'
  | 'AUXILIAR_ENFERMAGEM'
  | 'OUTRO';

export interface Vinculo {
  id?: string;
  empresa: string;
  cargo?: string | null;
  matricula?: string | null;
  ordem?: number;
}

export interface Filiado {
  id: string;
  matricula: string;
  nomeCompleto: string;
  cpf: string | null;
  rg?: string | null;
  ufRg?: string | null;
  dataNascimento: string;
  sexo?: string | null;
  estadoCivil?: string | null;
  naturalidade?: string | null;
  telefonePrincipal?: string | null;
  telefoneSecundario?: string | null;
  email?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  formacao?: FormacaoProfissional | null;
  formacaoOutro?: string | null;
  numeroCoren?: string | null;
  dataAdmissao?: string | null;
  situacao: SituacaoFiliado;
  fotoUrl?: string | null;
  vinculos?: Vinculo[];
  createdAt: string;
}

export const SITUACAO_LABEL: Record<SituacaoFiliado, string> = {
  ATIVO: 'Ativo',
  INATIVO: 'Inativo',
  DESFILIADO: 'Desfiliado',
};

export const SITUACAO_COR: Record<SituacaoFiliado, string> = {
  ATIVO: 'bg-senatepi-50 text-senatepi-800',
  INATIVO: 'bg-gray-100 text-gray-600',
  DESFILIADO: 'bg-red-100 text-red-700',
};

export const FORMACAO_LABEL: Record<FormacaoProfissional, string> = {
  ENFERMEIRO: 'Enfermeiro(a)',
  TECNICO_ENFERMAGEM: 'Técnico(a) em Enfermagem',
  AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem',
  OUTRO: 'Outro',
};

export const SITUACOES = Object.keys(SITUACAO_LABEL) as SituacaoFiliado[];
export const FORMACOES = Object.keys(FORMACAO_LABEL) as FormacaoProfissional[];

/** Regex de validação do COREN-PI: COREN-PI 000000-SSS (até 6 dígitos + 3 letras). */
export const COREN_REGEX = /^COREN-PI \d{1,6}-[A-Z]{3}$/;

/**
 * Máscara progressiva do COREN-PI. Sempre prefixa "COREN-PI ", limita a
 * 6 dígitos e 3 letras maiúsculas da categoria (ex.: COREN-PI 123456-ENF).
 */
export function mascararCoren(input: string): string {
  // Remove o prefixo fixo (em qualquer estágio de digitação) e normaliza
  const corpo = input
    .toUpperCase()
    .replace(/^\s*COREN\s*-?\s*PI\s*/, '')
    .trim();
  const digitos = (corpo.match(/\d/g) ?? []).join('').slice(0, 6);
  const letras = (corpo.replace(/[^A-Z]/g, '') ?? '').slice(0, 3);

  let out = 'COREN-PI ';
  out += digitos;
  // mostra o hífen assim que houver categoria (ou os 6 dígitos preenchidos)
  if (letras.length > 0 || corpo.includes('-')) out += '-' + letras;
  return out;
}

/** Sugere a categoria (ENF/TEC/AUX) a partir da formação selecionada. */
export const CATEGORIA_POR_FORMACAO: Record<string, string> = {
  ENFERMEIRO: 'ENF',
  TECNICO_ENFERMAGEM: 'TEC',
  AUXILIAR_ENFERMAGEM: 'AUX',
};

// ============================================================================
// API — gestão de filiados
// ============================================================================

/** Desfilia um associado (PATCH /filiados/:id/desfiliar), com motivo opcional. */
export async function desfiliarFiliado(id: string, motivo?: string): Promise<Filiado> {
  return (await api.patch(`/filiados/${id}/desfiliar`, { motivo })).data;
}

/** Anexa um documento (ex.: termo de desfiliação) ao filiado. */
export async function anexarDocumentoFiliado(id: string, file: File, titulo: string) {
  const fd = new FormData();
  fd.append('arquivo', file);
  fd.append('titulo', titulo);
  return (await api.post(`/filiados/${id}/documentos`, fd)).data;
}

/** Exclui permanentemente um filiado (DELETE /filiados/:id). */
export async function excluirFiliado(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/filiados/${id}`)).data;
}
