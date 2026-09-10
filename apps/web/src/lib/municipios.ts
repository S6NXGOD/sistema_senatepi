import { api } from '@/lib/api';

/**
 * MUNICÍPIOS E INDICADORES PÚBLICOS — o espelho dos tipos da API.
 *
 * O catálogo vem do IBGE; os números, do SICONFI (Tesouro Nacional). A tela
 * nunca calcula nem reclassifica nada disto: quem decide se um município está
 * acima do limite é o servidor, porque a regra tem base legal e não pode ter
 * duas versões — já houve neste sistema duas definições de "atrasada" no ar ao
 * mesmo tempo, discordando na própria tela.
 */

export type SituacaoFiscal =
  | 'REGULAR'
  | 'ALERTA'
  | 'PRUDENCIAL'
  | 'ACIMA_DO_TETO'
  | 'INCONSISTENTE'
  | 'SEM_DADO';

export interface FiscalResumo {
  situacao: SituacaoFiscal;
  percentualRcl?: number | null;
  limiteMaximo?: number | null;
  limitePrudencial?: number | null;
  exercicio?: number;
  quadrimestre?: number;
}

export interface SaudeResumo {
  exercicio: number;
  bimestre: number;
  percentualDespesa: number | null;
  despesaLiquidada: number | null;
}

export interface VinculosDoMunicipio {
  filiados: number;
  organizacoes: number;
  processos: number;
}

export interface MunicipioLinha {
  codigo: number;
  nome: string;
  uf: string;
  /** 'M' município, 'E' estado ou DF, 'U' União. */
  esfera: string;
  regiaoImediata: string | null;
  populacao: number | null;
  fiscal: FiscalResumo;
  saude: SaudeResumo | null;
  vinculos: VinculosDoMunicipio;
}

export interface MunicipioDetalhe extends Omit<MunicipioLinha, 'fiscal'> {
  regiaoIntermediaria: string | null;
  populacaoAno: number | null;
  fiscal: FiscalResumo & {
    explicacao: string;
    limiteAlerta?: number | null;
    despesaPessoal?: number | null;
    receitaCorrenteLiquida?: number | null;
    atualizadoEm?: string;
  };
  seriePessoal: Array<{
    exercicio: number;
    quadrimestre: number;
    percentualRcl: number | null;
    situacao: SituacaoFiscal;
  }>;
  serieSaude: Array<{ exercicio: number; bimestre: number; percentualDespesa: number | null }>;
  /** Verdadeiro quando os números são da UF inteira (o caso do Estado). */
  contagemPorUF?: boolean;
  saudePorHabitante: number | null;
  organizacoes: Array<{
    id: string;
    nome: string;
    nomeFantasia: string | null;
    tipo: string;
    institucional: boolean;
  }>;
  fonte: { catalogo: string; indicadores: string };
}

export interface PaginaMunicipios {
  items: MunicipioLinha[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

export interface FiltrosMunicipios {
  esfera?: string;
  busca?: string;
  uf?: string;
  soComVinculo?: boolean;
  soAcimaDoLimite?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Pendencias {
  ufDaCasa: string;
  filiadosSemMunicipio: Array<{ cidade: string | null; estado: string | null; quantos: number }>;
  ligadosPorPreferencia: Array<{ cidade: string | null; estado: string | null; quantos: number }>;
  organizacoesSemMunicipio: number;
}

/**
 * O ROTULO E A COR de cada situação, num lugar só.
 *
 * "Acima do teto" e "no prudencial" são VERMELHO e ÂMBAR porque significam
 * restrição legal, não porque são números altos. "Inconsistente" é CINZA de
 * propósito: não é gravidade, é ausência de informação utilizável — pintá-lo de
 * vermelho faria parecer o pior dos casos quando na verdade é o município que
 * errou o preenchimento.
 */
export const SITUACAO_FISCAL: Record<
  SituacaoFiscal,
  { rotulo: string; curto: string; cor: string; ponto: string }
> = {
  ACIMA_DO_TETO: {
    rotulo: 'Acima do teto da LRF',
    curto: 'acima do teto',
    cor: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
    ponto: 'bg-red-500',
  },
  PRUDENCIAL: {
    rotulo: 'No limite prudencial',
    curto: 'prudencial',
    cor: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
    ponto: 'bg-amber-500',
  },
  ALERTA: {
    rotulo: 'No limite de alerta',
    curto: 'alerta',
    cor: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300',
    ponto: 'bg-yellow-400',
  },
  REGULAR: {
    rotulo: 'Dentro do limite',
    curto: 'dentro do limite',
    cor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
    ponto: 'bg-emerald-500',
  },
  INCONSISTENTE: {
    rotulo: 'Declaração inconsistente',
    curto: 'declaração não fecha',
    cor: 'bg-muted text-muted-foreground',
    ponto: 'bg-muted-foreground/40',
  },
  SEM_DADO: {
    rotulo: 'Não publicou o relatório',
    curto: 'sem publicação',
    cor: 'bg-muted text-muted-foreground',
    ponto: 'bg-muted-foreground/25',
  },
};

/** A ordem em que uma lista deve mostrar: quem restringe direito vem primeiro. */
export const PESO_SITUACAO: Record<SituacaoFiscal, number> = {
  ACIMA_DO_TETO: 0,
  PRUDENCIAL: 1,
  ALERTA: 2,
  INCONSISTENTE: 3,
  REGULAR: 4,
  SEM_DADO: 5,
};

const limpar = (f: FiltrosMunicipios) =>
  Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  );

export async function listarMunicipios(f: FiltrosMunicipios): Promise<PaginaMunicipios> {
  return (await api.get('/municipios', { params: limpar(f) })).data;
}

export async function getMunicipio(codigo: number): Promise<MunicipioDetalhe> {
  return (await api.get(`/municipios/${codigo}`)).data;
}

/**
 * OS ENTES QUE NÃO SÃO MUNICÍPIO — o Estado da casa e a União.
 *
 * Chamada separada porque eles NÃO entram na paginação: misturar 28 entes em
 * 5.599 colocaria "Piauí" entre "Picos" e "Pimenteiras", onde ninguém
 * procuraria um governo estadual.
 */
export async function destaquesDeEntes(): Promise<MunicipioLinha[]> {
  return (await api.get('/municipios/destaques')).data;
}

export async function pendenciasDeMunicipio(): Promise<Pendencias> {
  return (await api.get('/municipios/pendencias')).data;
}

export async function municipiosDaUFPelaApi(uf: string): Promise<Array<{ codigo: number; nome: string }>> {
  return (await api.get('/municipios/por-uf', { params: { uf } })).data;
}

/**
 * Buscar os indicadores no Tesouro agora. Pode demorar — a varredura fala com
 * uma API externa, um município por vez — por isso o tempo limite estendido, o
 * mesmo que as consultas ao CNJ usam.
 */
export async function sincronizarSiconfi(codigos?: number[]) {
  return (await api.post('/municipios/sincronizar', { codigos }, { timeout: 180_000 })).data as {
    municipios: number;
    comPessoal: number;
    comSaude: number;
    semPublicacao: number;
    falhas: number;
  };
}

export async function casarCadastrosComIBGE() {
  return (await api.post('/municipios/casar-cadastros', {}, { timeout: 180_000 })).data as {
    filiados: { ligados: number; semResolver: number; exemplosSemResolver: string[] };
    organizacoes: { ligados: number; semResolver: number; exemplosSemResolver: string[] };
  };
}

// ------------------------------------------------------------------ formatação

export const numeroBR = (n: number | null | undefined, casas = 0) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const percentualBR = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Dinheiro público em escala legível. R$ 1.798.591.840,56 não cabe numa linha de
 * cartão e ninguém lê os dígitos do meio: "R$ 1,80 bi" comunica a mesma coisa.
 */
export function dinheiroCurto(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `R$ ${(n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bi`;
  if (abs >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "1º quadrimestre de 2026" — o período por extenso, como sai no relatório. */
export const periodoRGF = (exercicio?: number, quadrimestre?: number) =>
  exercicio && quadrimestre ? `${quadrimestre}º quadrimestre de ${exercicio}` : '—';

export const periodoRREO = (exercicio?: number, bimestre?: number) =>
  exercicio && bimestre ? `${bimestre}º bimestre de ${exercicio}` : '—';
