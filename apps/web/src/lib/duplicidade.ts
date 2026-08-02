import { api } from './api';

/**
 * Mutirão de consolidação de cadastros duplicados.
 *
 * Ferramenta TEMPORÁRIA: existe para higienizar a carga legada, em que 70% dos
 * filiados vieram sem CPF e o índice único não teve como impedir repetição.
 * Some sozinha quando não houver mais grupos pendentes, e pode ser desligada
 * pela variável FILIADOS_DUPLICIDADE na API.
 */

export type Confianca = 'ALTA' | 'MEDIA' | 'BAIXA';

export interface CandidatoDuplicata {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  numeroCoren: string | null;
  cidade: string | null;
  estado: string | null;
  telefonePrincipal: string | null;
  email: string | null;
  dataNascimento: string | null;
  endereco: string | null;
  situacao: string;
  dataFiliacao: string | null;
  createdAt: string;
  temFoto: boolean;
  vinculos: number;
  pontuacao: number;
  sugerido: boolean;
}

export interface GrupoDuplicata {
  chave: string;
  confianca: Confianca;
  criterio: string;
  motivoSugestao: string | null;
  /** Falso = o sistema NÃO sabe escolher; a decisão é inteiramente humana. */
  decidiu: boolean;
  contradicoes: string[];
  candidatos: CandidatoDuplicata[];
}

export const CONFIANCA_LABEL: Record<Confianca, string> = {
  ALTA: 'Alta',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
};

export const CONFIANCA_COR: Record<Confianca, string> = {
  ALTA: 'bg-senatepi-100 text-senatepi-900 dark:bg-senatepi-900/40 dark:text-senatepi-100',
  MEDIA: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  BAIXA: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200',
};

/** O que cada nível de confiança significa, em uma frase. */
export const CONFIANCA_EXPLICACAO: Record<Confianca, string> = {
  ALTA: 'Mesmo nome e mesma cidade, sem nenhum campo se contradizendo.',
  MEDIA: 'Mesmo nome e nada se contradiz, mas falta a cidade para confirmar.',
  BAIXA: 'Há campo divergente ou o nome só é parecido — confira antes de decidir.',
};

export async function statusDuplicidade(): Promise<{ ativo: boolean; pendentes: number }> {
  try {
    return (await api.get('/filiados/duplicidade/status')).data;
  } catch {
    // Perfil sem acesso, recurso desligado ou API antiga: a ferramenta
    // simplesmente não aparece. Não é erro que mereça alarme na tela.
    return { ativo: false, pendentes: 0 };
  }
}

export async function listarDuplicados(): Promise<GrupoDuplicata[]> {
  return (await api.get('/filiados/duplicidade')).data;
}

export async function marcarDistintos(idA: string, idB: string) {
  return (await api.post('/filiados/duplicidade/distintos', { idA, idB })).data;
}

export async function fundirDuplicados(manterId: string, descartarId: string) {
  return (await api.delete('/filiados/duplicidade/fundir', { data: { manterId, descartarId } }))
    .data;
}

/** Campos comparados lado a lado no cartão, na ordem em que ajudam a decidir. */
export const CAMPOS_COMPARADOS = [
  { chave: 'cpf', rotulo: 'CPF' },
  { chave: 'numeroCoren', rotulo: 'COREN' },
  { chave: 'dataNascimento', rotulo: 'Nascimento' },
  { chave: 'cidade', rotulo: 'Cidade' },
  { chave: 'telefonePrincipal', rotulo: 'Telefone' },
  { chave: 'email', rotulo: 'E-mail' },
  { chave: 'endereco', rotulo: 'Endereço' },
  { chave: 'dataFiliacao', rotulo: 'Filiação' },
] as const;
