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
  | 'SEM_DADO'
  | 'NAO_CONSULTADO';

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
  /** Quando o Tesouro foi perguntado. Nulo = nunca — não é o mesmo que "não publicou". */
  consultadoEm?: string | null;
  /** Falso enquanto "Ligar cadastros" nunca rodou: os contadores ainda não valem. */
  ligacaoJaRodou?: boolean;
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
  /** Falso = o botão "Ligar cadastros" nunca foi usado. */
  jaRodou: boolean;
  totalComCidade: number;
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
  { rotulo: string; curto: string; cor: string; ponto: string; ajuda: string }
> = {
  ACIMA_DO_TETO: {
    rotulo: 'Acima do teto da LRF',
    curto: 'acima do teto',
    cor: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
    ponto: 'bg-red-500',
    ajuda:
      'Passou dos 54% da receita que a Lei de Responsabilidade Fiscal permite gastar com pessoal. Além de não poder conceder aumento, o ente tem prazo para recompor a folha e perde transferências voluntárias e crédito.',
  },
  PRUDENCIAL: {
    rotulo: 'No limite prudencial',
    curto: 'prudencial',
    cor: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
    ponto: 'bg-amber-500',
    ajuda:
      'Passou de 95% do teto. Pelo art. 22, parágrafo único, da LRF, está PROIBIDO de conceder aumento, criar cargo e contratar — exceto reposição em saúde, educação e segurança.',
  },
  ALERTA: {
    rotulo: 'No limite de alerta',
    curto: 'alerta',
    cor: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300',
    ponto: 'bg-yellow-400',
    ajuda:
      'Passou de 90% do teto. Ainda pode conceder aumento, mas o Tribunal de Contas já é obrigado a alertar formalmente.',
  },
  REGULAR: {
    rotulo: 'Dentro do limite',
    curto: 'dentro do limite',
    cor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
    ponto: 'bg-emerald-500',
    ajuda:
      'Abaixo do limite prudencial: não há impedimento fiscal para conceder aumento. É o número que derruba a alegação mais comum na mesa de negociação.',
  },
  INCONSISTENTE: {
    rotulo: 'Declaração inconsistente',
    curto: 'declaração não fecha',
    cor: 'bg-muted text-muted-foreground',
    ponto: 'bg-muted-foreground/40',
    ajuda:
      'O próprio ente declarou ao Tesouro uma folha maior que a receita do período. O número não serve de argumento para nenhum dos dois lados enquanto ele não retificar.',
  },
  /**
   * PERGUNTAMOS E O ENTE NÃO PUBLICOU. É irregularidade DELE — e por isso o
   * rótulo acusa, com todas as letras.
   */
  SEM_DADO: {
    rotulo: 'Não publicou o relatório',
    curto: 'não publicou',
    cor: 'bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-300',
    ponto: 'bg-orange-400',
    ajuda:
      'O ente não publicou o Relatório de Gestão Fiscal no período. Deixar de publicar é, por si, uma irregularidade prevista na LRF.',
  },
  /**
   * AINDA NÃO PERGUNTAMOS. Tarefa nossa, e o rótulo não pode parecer acusação.
   * A ficha do Governo do Piauí chegou a dizer que ele "não publicou" — ele
   * tinha publicado 37,00%; faltava a varredura passar por lá.
   */
  NAO_CONSULTADO: {
    rotulo: 'Ainda não consultado',
    curto: 'a consultar',
    cor: 'bg-muted text-muted-foreground',
    ponto: 'bg-muted-foreground/25',
    ajuda:
      'Os indicadores deste ente ainda não foram buscados no Tesouro. Não é falha do ente — use \"Atualizar do Tesouro\".',
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
  NAO_CONSULTADO: 6,
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
/** O mínimo para identificar um ente num seletor. */
export interface EnteResumido {
  codigo: number;
  nome: string;
  uf: string;
  /** 'M' município, 'E' estado ou DF, 'U' União. */
  esfera: string;
}

/**
 * Busca curta para seletor, atravessando as três esferas — digitar "piauí"
 * tem de achar o Governo do Estado, não só os municípios com a palavra no nome.
 */
export async function buscarEntes(termo: string): Promise<EnteResumido[]> {
  return (await api.get('/municipios/buscar', { params: { q: termo } })).data;
}

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
 * Buscar os indicadores no Tesouro AGORA.
 *
 * Demora, e o tempo limite é dimensionado por medição, não por chute: são ~71
 * entes no universo do sindicato, duas chamadas cada (RGF e RREO) mais um
 * respiro de 250 ms entre eles. Cinco minutos cobre o caso ruim em que boa
 * parte não publicou e a janela de períodos precisa ser percorrida inteira.
 *
 * Estourar aqui seria pior que demorar: o servidor continuaria trabalhando e a
 * tela mostraria erro sobre um trabalho que deu certo.
*/
export async function sincronizarSiconfi(codigos?: number[]) {
  return (await api.post('/municipios/sincronizar', { codigos }, { timeout: 300_000 })).data as {
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

/**
 * O RREO É ACUMULADO DENTRO DO ANO — e sem dizer isso o número engana.
 *
 * O 3º bimestre traz janeiro a JUNHO; o 6º traz o ano inteiro. Então
 * "R$ 888/hab" de Teresina (3º bimestre de 2026, seis meses) ao lado de
 * "R$ 1.267/hab" de Oeiras (6º bimestre de 2025, doze meses) faz Oeiras
 * parecer o dobro do que é — quando, anualizado, Teresina gasta mais.
 *
 * O percentual não sofre disso, porque é razão entre dois acumulados iguais.
 * O valor em reais sofre, e por isso nunca aparece sem este rótulo.
 */
const MES_FINAL = ['', 'fevereiro', 'abril', 'junho', 'agosto', 'outubro', 'dezembro'];

export function acumuladoAte(exercicio?: number, bimestre?: number): string {
  if (!exercicio || !bimestre) return '';
  const meses = bimestre * 2;
  return `acumulado de ${meses} ${meses === 1 ? 'mês' : 'meses'} (janeiro a ${MES_FINAL[bimestre]} de ${exercicio})`;
}

/** Só para comparar duas fichas: mesmo exercício E mesmo bimestre. */
export const mesmoPeriodoRREO = (
  a: { exercicio: number; bimestre: number } | null | undefined,
  b: { exercicio: number; bimestre: number } | null | undefined,
) => !!a && !!b && a.exercicio === b.exercicio && a.bimestre === b.bimestre;
export const periodoRREO = (exercicio?: number, bimestre?: number) =>
  exercicio && bimestre ? `${bimestre}º bimestre de ${exercicio}` : '—';
