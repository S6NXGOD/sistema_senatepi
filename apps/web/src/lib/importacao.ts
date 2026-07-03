export type StatusImportacao = 'VALIDANDO' | 'VALIDADO' | 'IMPORTANDO' | 'CONCLUIDO' | 'ERRO';
export type EstrategiaDuplicado = 'IGNORAR' | 'ATUALIZAR';
export type EstrategiaMatricula = 'REGENERAR' | 'DISPENSAR';

export interface ColunaMapeada {
  coluna: string;
  campo: string | null;
  rotulo: string | null;
}

export interface Importacao {
  id: string;
  nomeArquivo: string;
  tamanhoBytes: number;
  status: StatusImportacao;
  estrategia: EstrategiaDuplicado;
  estrategiaMatricula: EstrategiaMatricula;
  total: number;
  validos: number;
  comErro: number;
  duplicados: number;
  processados: number;
  importados: number;
  atualizados: number;
  ignorados: number;
  dispensados: number;
  permitirCpfInvalido: boolean;
  mapeamento: ColunaMapeada[] | null;
  duracaoMs: number | null;
  createdAt: string;
}

export interface ResumoValidacao {
  erros: { codigo: string; label: string; total: number }[];
  avisos: { codigo: string; label: string; total: number }[];
}

export interface ImportacaoLinha {
  id: string;
  linha: number;
  dados?: Record<string, any> | null;
  nome: string | null;
  cpf: string | null;
  matricula: string | null;
  telefone: string | null;
  empresa: string | null;
  situacao: string | null;
  valido: boolean;
  duplicadoNoSistema: boolean;
  erros: string[] | null;
  avisos: string[] | null;
  codigos: string[];
  resultado: string | null;
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatarDuracao(ms?: number | null): string {
  if (!ms) return '-';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${s % 60}s`;
}
