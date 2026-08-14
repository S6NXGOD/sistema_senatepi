import { api } from './api';
import type { StatusImportacao } from './importacao';
import type { StatusColaborador, TipoVinculo } from './colaboradores';

/**
 * IMPORTAÇÃO DA EQUIPE DO SINDICATO vinda do sistema antigo.
 *
 * Arquivo próprio, e não mais tipos dentro de `importacao.ts`: aquele é o
 * contrato da importação de FILIADOS (duas planilhas, quatro estratégias,
 * decisão de conflito). Aqui a população é outra — `Colaborador` —, a âncora é
 * o CPF e não existe fila de decisão. Misturar os dois faria toda tela ter de
 * checar o perfil antes de acreditar num campo.
 */

export type ClassificacaoColaborador = 'NOVO' | 'ATUALIZACAO' | 'ERRO';

/** O que fazer com a família de quem já está cadastrado. */
export type EstrategiaDependentes = 'ACRESCENTAR' | 'SUBSTITUIR' | 'MANTER';

export const ESTRATEGIA_DEPENDENTES_LABEL: Record<EstrategiaDependentes, string> = {
  ACRESCENTAR: 'Acrescentar só os que faltam',
  SUBSTITUIR: 'O arquivo é a verdade (remove os que não estão nele)',
  MANTER: 'Não mexer nos dependentes já cadastrados',
};

export interface DependentePrevia {
  nome: string;
  cpf: string | null;
  tipo: 'CONJUGE' | 'FILHO' | 'PAI' | 'MAE';
  dataNascimento: string;
}

export interface LinhaColaboradorLegado {
  id: string;
  linha: number;
  nome: string | null;
  cpf: string | null;
  matricula: string | null;
  telefone: string | null;
  /** O contratante (só existe em PJ/terceirizado). */
  empresa: string | null;
  /** O setor — guardado na coluna `lotacao`, reaproveitada da folha. */
  lotacao: string | null;
  cargo: string | null;
  situacao: string | null;
  valido: boolean;
  classificacao: ClassificacaoColaborador | null;
  erros: string[] | null;
  avisos: string[] | null;
  codigos: string[];
  alteracoes: Record<string, { de: unknown; para: unknown }> | null;
  resultado: string | null;
  dependentes: DependentePrevia[];
}

export interface ImportacaoColaboradores {
  id: string;
  nomeArquivo: string;
  tamanhoBytes: number;
  status: StatusImportacao;
  total: number;
  validos: number;
  comErro: number;
  duplicados: number;
  processados: number;
  importados: number;
  atualizados: number;
  ignorados: number;
  dependentesCriados: number;
  dependentesRemovidos: number;
  duracaoMs: number | null;
  erroMensagem: string | null;
  createdAt: string;
  /** Só vem na resposta do upload. */
  dependentesNoArquivo?: number;
  reenvioDe?: string | null;
}

export interface ResumoColaboradores {
  importacao: ImportacaoColaboradores;
  contagem: { NOVO: number; ATUALIZACAO: number; ERRO: number; COM_AVISO: number };
  dependentes: number;
  /** Agrupado por problema: diz QUAL coluna consertar, não só quantas falharam. */
  problemas: { codigo: string; rotulo: string; total: number }[];
}

/** Espelha `ColaboradorLegado` da API — é o que a prévia guarda em `dados`. */
export interface ColaboradorPrevia {
  matricula: string | null;
  nome: string;
  cpf: string;
  cargo: string;
  setor: string;
  tipoVinculo: TipoVinculo;
  empresaNome: string | null;
  status: StatusColaborador;
  dependentes: DependentePrevia[];
}

const BASE = '/importacoes/colaboradores';

export async function enviarArquivoEquipe(
  file: File,
  permitirReenvio = false,
): Promise<ImportacaoColaboradores> {
  const fd = new FormData();
  fd.append('arquivo', file);
  if (permitirReenvio) fd.append('permitirReenvio', 'true');
  return (await api.post(`${BASE}/upload`, fd)).data;
}

export async function resumoEquipe(id: string): Promise<ResumoColaboradores> {
  return (await api.get(`${BASE}/${id}/resumo`)).data;
}

export async function linhasEquipe(
  id: string,
  params: { busca?: string; classificacao?: string; page?: number },
): Promise<{
  data: LinhaColaboradorLegado[];
  total: number;
  page: number;
  totalPages: number;
}> {
  return (await api.get(`${BASE}/${id}/linhas`, { params })).data;
}

export async function confirmarEquipe(
  id: string,
  dto: {
    atualizarExistentes: boolean;
    dependentes: EstrategiaDependentes;
    importarSomenteValidos: boolean;
  },
) {
  return (await api.post(`${BASE}/${id}/confirmar`, dto)).data;
}
