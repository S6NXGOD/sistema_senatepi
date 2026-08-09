export type StatusImportacao = 'VALIDANDO' | 'VALIDADO' | 'IMPORTANDO' | 'CONCLUIDO' | 'ERRO';
export type EstrategiaDuplicado = 'IGNORAR' | 'ATUALIZAR';
export type EstrategiaMatricula = 'REGENERAR' | 'DISPENSAR';

/** Qual planilha foi reconhecida no upload — decide qual tela de revisão abre. */
export type PerfilImportacao = 'LEGADO_CSV' | 'FOLHA_PREFEITURA';

export type ClassificacaoLinha =
  | 'NOVO'
  | 'ATUALIZACAO'
  | 'CONFLITO'
  | 'DUPLICIDADE'
  | 'ERRO';

export type MotivoConflito = 'NOME_SEMELHANTE' | 'NOME_DIVERGENTE' | 'CPF_DIVERGENTE';
export type DecisaoConflito = 'PENDENTE' | 'MESMA_PESSOA' | 'PESSOA_DIFERENTE' | 'IGNORAR';

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
  perfil: PerfilImportacao;
  estrategia: EstrategiaDuplicado;
  estrategiaMatricula: EstrategiaMatricula;
  total: number;
  validos: number;
  comErro: number;
  duplicados: number;
  conflitos: number;
  processados: number;
  importados: number;
  atualizados: number;
  ignorados: number;
  dispensados: number;
  vinculosCriados: number;
  vinculosAtualizados: number;
  permitirCpfInvalido: boolean;
  mapeamento: ColunaMapeada[] | null;
  duracaoMs: number | null;
  createdAt: string;
  /** Preenchido quando o arquivo já tinha sido importado antes. */
  reenvioDe?: string | null;
}

/** Uma linha da folha da Prefeitura na tela de revisão. */
export interface LinhaFolha {
  id: string;
  linha: number;
  nome: string | null;
  matricula: string | null;
  /** O Órgão — guardado na coluna `empresa`, que já era o empregador. */
  empresa: string | null;
  lotacao: string | null;
  cargo: string | null;
  quadro: string | null;
  classificacao: ClassificacaoLinha | null;
  motivoConflito: MotivoConflito | null;
  decisao: DecisaoConflito;
  candidatoId: string | null;
  alteracoes: Record<string, { de: string | null; para: string }> | null;
  erros: string[] | null;
  avisos: string[] | null;
  resultado: string | null;
  /** Ficha de quem o sistema apontou como candidato, para o operador conferir. */
  candidato: {
    id: string;
    nomeCompleto: string;
    matricula: string;
    cpf: string | null;
    situacao: string;
    vinculos: { empresa: string; matricula: string | null; cargo: string | null; lotacao: string | null }[];
  } | null;
}

export interface ResumoFolha {
  importacao: Importacao;
  contagem: Record<ClassificacaoLinha, number>;
  conflitosPendentes: number;
}

export const CLASSIFICACAO_LABEL: Record<ClassificacaoLinha, string> = {
  NOVO: 'Novos',
  ATUALIZACAO: 'Atualizações',
  CONFLITO: 'Conflitos',
  DUPLICIDADE: 'Duplicidades',
  ERRO: 'Erros',
};

export const MOTIVO_CONFLITO_LABEL: Record<MotivoConflito, string> = {
  NOME_SEMELHANTE: 'Nome já cadastrado, matrícula nova',
  NOME_DIVERGENTE: 'Matrícula cadastrada para outra pessoa',
  CPF_DIVERGENTE: 'Mesma matrícula, CPF diferente do cadastro',
};

export const CAMPO_LABEL: Record<string, string> = {
  cargo: 'Cargo',
  lotacao: 'Lotação',
  quadro: 'Quadro',
  orgao: 'Órgão',
  matricula: 'Matrícula',
  descontoEmFolha: 'Desconto em folha',
};

/**
 * `descontoEmFolha` chega como "true"/"false" no diff (o campo é booleano, e o
 * diff é texto). Mostrar "true → false" numa tela de secretaria seria
 * despejar tipo de dado na cara de quem só quer saber se a pessoa contribui.
 */
export function valorDoCampo(campo: string, valor: string | null): string {
  if (valor === null || valor === '') return '(vazio)';
  if (campo === 'descontoEmFolha') return valor === 'true' ? 'sim' : 'não';
  return valor;
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
