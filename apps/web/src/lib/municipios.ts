import { api } from '@/lib/api';

/**
 * CONTAS PÚBLICAS — o espelho dos tipos da API (rota e módulo `municipios`).
 *
 * O catálogo vem do IBGE; os números, do SICONFI (Tesouro Nacional). A tela
 * nunca calcula nem reclassifica nada disto: quem decide se um ente está acima
 * do limite, e quanto a folha ainda pode crescer, é o servidor — a regra tem
 * base legal e não pode ter duas versões. Já houve neste sistema duas
 * definições de "atrasada" no ar ao mesmo tempo, discordando na própria tela.
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

/**
 * A PRESENÇA DO SINDICATO — cinco números, e cada um responde UMA pergunta.
 *
 * Antes eram três contadores genéricos, e a ficha do Governo do Piauí dizia
 * "3.077 filiados · 114 processos": 3.077 era quem MORA no estado e 114 o que
 * TRAMITA em comarca do Piauí. Quem trabalha para o Estado são 16, e o Estado
 * é réu em 8 ações.
 */
export interface Presenca {
  /** Filiados ativos com endereço neste município. */
  moram: number;
  /** Filiados ativos com vínculo numa organização ligada a este ente. */
  trabalham: number;
  /** Organizações do cadastro ligadas a este ente. */
  organizacoes: number;
  /** Ações do sindicato em que o ente (ou órgão dele) é réu. */
  acoesContra: number;
  /** Ações que só TRAMITAM na comarca — nada dizem sobre a prefeitura. */
  naComarca: number;
}

/** O formato antigo. Só existe para a janela de troca do deploy — ver `presencaDe`. */
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
  /** Fora do estado da casa — só nesses a UF aparece ao lado do nome. */
  foraDaUF?: boolean;
  fiscal: FiscalResumo;
  saude: SaudeResumo | null;
  presenca?: Presenca;
  vinculos?: VinculosDoMunicipio;
  /**
   * O QUE OS LIMITES NÃO DIZEM — fim de mandato (LRF, art. 21) e ano de eleição
   * (Lei 9.504/97, art. 73). A frase vem pronta do servidor, que sabe as datas.
   */
  calendario?: { fimDeMandato: boolean; texto: string } | null;
}

export interface Folga {
  /** Em reais, nos 12 meses do relatório. Negativo = passou do prudencial. */
  valor: number;
  /** Quanto a folha pode crescer (ou teria de cair), em % dela mesma. */
  percentualDaFolha: number;
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
    folga?: Folga | null;
  };
  /** A mediana do estado e da região imediata — só para município, e só com amostra suficiente. */
  comparacao?: {
    uf: { uf: string; mediana: number | null; n: number } | null;
    regiao: { nome: string; mediana: number | null; n: number } | null;
  } | null;
  seriePessoal: Array<{
    exercicio: number;
    quadrimestre: number;
    percentualRcl: number | null;
    situacao: SituacaoFiscal;
  }>;
  serieSaude: Array<{ exercicio: number; bimestre: number; percentualDespesa: number | null }>;
  /** Legado da versão anterior; hoje sempre falso. */
  contagemPorUF?: boolean;
  saudePorHabitante: number | null;
  /** O denominador dos contadores: quanto do cadastro eles enxergam. */
  cobertura?: { ativos: number; semCidade: number; comLocalDeTrabalho: number };
  /** Só para Estado e União: órgãos públicos com filiados que ainda não dizem de qual governo são. */
  orgaosPublicosSemGoverno?: { total: number; exemplos: string[] } | null;
  organizacoes: Array<{
    id: string;
    nome: string;
    nomeFantasia: string | null;
    tipo: string;
    institucional: boolean;
  }>;
  fonte: { catalogo: string; indicadores: string };
}

// ------------------------------------------------------ recorte, chips, ordem

export type EscopoLista = 'atuacao' | 'uf' | 'brasil';
export type FiltroSituacao = 'impedidos' | 'alerta' | 'regular' | 'sem_numero';
export type OrdemLista = 'presenca' | 'percentual' | 'nome';

export interface PaginaMunicipios {
  items: MunicipioLinha[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
  escopo?: EscopoLista;
  ordem?: OrdemLista;
  ufDaCasa?: string;
  contagens?: {
    escopos: Record<EscopoLista, number>;
    situacao: Record<FiltroSituacao | 'todas', number>;
  };
}

export interface FiltrosMunicipios {
  escopo?: EscopoLista;
  situacao?: FiltroSituacao | '';
  ordem?: OrdemLista;
  busca?: string;
  /** Só no recorte "Brasil". */
  uf?: string;
  page?: number;
  pageSize?: number;
}

/** O rótulo de cada recorte. "Piauí" sai da UF da casa — o SINDSERM também é do Piauí, mas o código não sabe disso. */
export function rotuloDoEscopo(e: EscopoLista, nomeDaUF: string): string {
  if (e === 'atuacao') return 'Onde atuamos';
  if (e === 'uf') return nomeDaUF || 'Meu estado';
  return 'Brasil';
}

/**
 * OS CHIPS DE SITUAÇÃO — em português de quem negocia. "Prudencial" é palavra
 * de contador; "proibidos de dar aumento" é a consequência, e é ela que muda a
 * conversa. O `title` diz as exceções, que são o argumento do sindicato.
 */
export const CHIP_SITUACAO: Record<FiltroSituacao, { rotulo: string; ajuda: string; ponto: string }> = {
  impedidos: {
    rotulo: 'Proibidos de dar aumento',
    ajuda:
      'No limite prudencial ou acima do teto da LRF. Mesmo assim, a revisão geral anual e o que vem de sentença ou de lei continuam permitidos.',
    ponto: 'bg-red-500',
  },
  alerta: {
    rotulo: 'Em alerta',
    ajuda: 'Passaram de 90% do teto. Ainda podem conceder aumento; o Tribunal de Contas já alerta.',
    ponto: 'bg-yellow-400',
  },
  /*
    "DENTRO DO LIMITE", e não "sem impedimento": o limite é o que a tela mede.
    No fim do mandato o art. 21 da LRF anula o aumento mesmo dentro dele — o
    Governo do Piauí estava assim em setembro de 2026, com 37%.
  */
  regular: {
    rotulo: 'Dentro do limite',
    ajuda:
      'Abaixo do limite prudencial: os limites de despesa da LRF não impedem aumento. No fim do mandato e em ano de eleição valem outras regras — a ficha avisa.',
    ponto: 'bg-emerald-500',
  },
  sem_numero: {
    rotulo: 'Sem número',
    ajuda: 'Não publicaram o relatório, ainda não foram consultados, ou declararam algo que não fecha.',
    ponto: 'bg-muted-foreground/40',
  },
};

export const ORDENS_LISTA: Array<{ valor: OrdemLista; rotulo: string }> = [
  { valor: 'presenca', rotulo: 'Onde temos mais gente' },
  { valor: 'percentual', rotulo: 'Mais perto do limite' },
  { valor: 'nome', rotulo: 'Nome (A–Z)' },
];

// ------------------------------------------------------------ pendências

export interface SugestaoDeMunicipio {
  codigo: number;
  nome: string;
  uf: string;
  motivo: 'COMECA_IGUAL' | 'ESCRITA_PARECIDA' | 'MESMO_NOME_EM_OUTRA_UF';
}

export interface Pendencias {
  ufDaCasa: string;
  /** Falso = o botão "Ligar cadastros" nunca foi usado. */
  jaRodou: boolean;
  totalComCidade: number;
  /** O total de verdade — a lista abaixo tem teto de 40 grafias. */
  totalSemMunicipio?: number;
  filiadosSemMunicipio: Array<{
    cidade: string | null;
    estado: string | null;
    quantos: number;
    sugestoes?: SugestaoDeMunicipio[];
  }>;
  ligadosPorPreferencia: Array<{ cidade: string | null; estado: string | null; quantos: number }>;
  organizacoesSemMunicipio: number;
  /** `total` conta todos; `itens` traz só os doze com mais filiados. */
  orgaosSemGoverno?: {
    total: number;
    comFiliados?: number;
    itens: Array<{ id: string; nome: string; filiados: number }>;
  };
  cobertura?: { ativos: number; semCidade: number; comLocalDeTrabalho: number };
}

// ------------------------------------------------------------ situações

/**
 * O RÓTULO E A COR de cada situação, num lugar só.
 *
 * "Acima do teto" e "no prudencial" são VERMELHO e ÂMBAR porque significam
 * restrição legal, não porque são números altos. "Inconsistente" é CINZA de
 * propósito: não é gravidade, é ausência de informação utilizável.
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
      'Passou do teto da Lei de Responsabilidade Fiscal para gasto com pessoal (54% da receita nas prefeituras, 49% no Governo do Estado). Além de não poder conceder aumento, o ente tem prazo para recompor a folha e perde transferências voluntárias e crédito. A revisão geral anual continua permitida.',
  },
  /*
    AS EXCEÇÕES FICAM NO TEXTO. A versão anterior dizia "proibido de conceder
    aumento, criar cargo e contratar — exceto reposição em saúde" e omitia a
    revisão geral anual (art. 37, X, da Constituição), que a LRF ressalva no
    mesmo inciso. É exatamente o que a prefeitura omite na mesa.
  */
  PRUDENCIAL: {
    rotulo: 'No limite prudencial',
    curto: 'prudencial',
    cor: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
    ponto: 'bg-amber-500',
    ajuda:
      'Passou de 95% do teto. Pelo art. 22 da LRF está PROIBIDO de conceder aumento, criar cargo e contratar. Continuam permitidos a revisão geral anual (art. 37, X, da Constituição), o que vem de sentença ou de lei, e a reposição de aposentados e falecidos na saúde.',
  },
  ALERTA: {
    rotulo: 'No limite de alerta',
    curto: 'alerta',
    cor: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300',
    ponto: 'bg-yellow-400',
    ajuda:
      'Passou de 90% do teto. Pelos limites, ainda pode conceder aumento, mas o Tribunal de Contas já é obrigado a alertar formalmente.',
  },
  REGULAR: {
    rotulo: 'Dentro do limite',
    curto: 'dentro do limite',
    cor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
    ponto: 'bg-emerald-500',
    ajuda:
      'Abaixo do limite prudencial: não há impedimento pelos limites de despesa da LRF — é o número que derruba a alegação mais comum na mesa. No fim do mandato e em ano de eleição valem outras regras, e a ficha avisa.',
  },
  INCONSISTENTE: {
    rotulo: 'Declaração inconsistente',
    curto: 'declaração não fecha',
    cor: 'bg-muted text-muted-foreground',
    ponto: 'bg-muted-foreground/40',
    ajuda:
      'O próprio ente declarou ao Tesouro uma folha maior que a receita do período. O número não serve de argumento para nenhum dos dois lados enquanto ele não retificar.',
  },
  /** PERGUNTAMOS E O ENTE NÃO PUBLICOU. É irregularidade DELE — e o rótulo diz. */
  SEM_DADO: {
    rotulo: 'Não publicou o relatório',
    curto: 'não publicou',
    cor: 'bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-300',
    ponto: 'bg-orange-400',
    ajuda:
      'O ente não publicou o Relatório de Gestão Fiscal no período. Deixar de publicar é, por si, uma irregularidade prevista na LRF.',
  },
  /** AINDA NÃO PERGUNTAMOS. Tarefa nossa, e o rótulo não pode parecer acusação. */
  NAO_CONSULTADO: {
    rotulo: 'Ainda não consultado',
    curto: 'a consultar',
    cor: 'bg-muted text-muted-foreground',
    ponto: 'bg-muted-foreground/25',
    ajuda:
      'Os números deste ente ainda não foram buscados no Tesouro — não é falha do ente. A consulta da madrugada passa por onde atuamos e pelos municípios do estado; na ficha, dá para buscar na hora.',
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

// ------------------------------------------------------------ presença, em frases

/**
 * A PRESENÇA DE UMA LINHA, com a API nova ou a antiga.
 *
 * Os dois serviços sobem separados. Se a tela nova chegar antes da API nova,
 * `presenca` não vem — e sem este tradutor a lista inteira quebraria por uma
 * leitura de `undefined`. A tradução do formato antigo é a melhor possível, e
 * vale só pelos minutos da troca.
 */
export function presencaDe(m: Pick<MunicipioLinha, 'presenca' | 'vinculos'>): Presenca {
  if (m.presenca) return m.presenca;
  return {
    moram: m.vinculos?.filiados ?? 0,
    trabalham: 0,
    organizacoes: m.vinculos?.organizacoes ?? 0,
    acoesContra: 0,
    naComarca: m.vinculos?.processos ?? 0,
  };
}

/**
 * "2.639 moram · 8 ações contra" — o que substituiu os três ícones soltos da
 * coluna "O sindicato ali". Ícone com número não diz o que conta: um martelo e
 * "114" foi lido como "114 processos contra o Estado".
 *
 * Só o que existe vira frase; a comarca NÃO entra (ela não é presença).
 */
export function frasesDaPresenca(p: Presenca): string[] {
  const n = (v: number) => numeroBR(v);
  return [
    p.moram ? `${n(p.moram)} ${p.moram === 1 ? 'mora' : 'moram'}` : '',
    p.trabalham ? `${n(p.trabalham)} ${p.trabalham === 1 ? 'trabalha' : 'trabalham'}` : '',
    p.acoesContra ? `${n(p.acoesContra)} ${p.acoesContra === 1 ? 'ação' : 'ações'} contra` : '',
    !p.moram && !p.trabalham && p.organizacoes
      ? `${n(p.organizacoes)} ${p.organizacoes === 1 ? 'organização' : 'organizações'}`
      : '',
  ].filter(Boolean);
}

// ------------------------------------------------------------ chamadas

const limpar = (f: FiltrosMunicipios) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ''));

export async function listarMunicipios(f: FiltrosMunicipios): Promise<PaginaMunicipios> {
  return (await api.get('/municipios', { params: limpar(f) })).data;
}

export async function getMunicipio(codigo: number): Promise<MunicipioDetalhe> {
  return (await api.get(`/municipios/${codigo}`)).data;
}

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

/**
 * O GOVERNO DO ESTADO E A UNIÃO — por fora da paginação: misturar 28 entes em
 * 5.599 colocaria "Piauí" entre "Picos" e "Pimenteiras".
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
 * Buscar os indicadores no Tesouro AGORA — de todos onde atuamos, ou de um só.
 *
 * O tempo limite é medido, não chutado: ~2,7 s por ente (196 s para 71). Cinco
 * minutos cobre o caso ruim. Estourar seria pior que demorar: o servidor
 * continuaria trabalhando e a tela mostraria erro sobre um trabalho que deu
 * certo. Um ente só — o botão da ficha — volta em poucos segundos.
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

/** "Monte Alegre" é Monte Alegre do Piauí — a grafia volta EXATA, como veio da pendência. */
export async function ligarCidade(cidade: string, estado: string | null, codigo: number) {
  return (await api.post('/municipios/ligar-cidade', { cidade, estado, codigo })).data as {
    ligados: number;
    municipio: { codigo: number; nome: string; uf: string };
  };
}

/** "O HGV é do Estado do Piauí." */
export async function ligarOrganizacao(parteExternaId: string, enteCodigo: number) {
  return (await api.post('/municipios/ligar-organizacao', { parteExternaId, enteCodigo })).data as {
    id: string;
    ente: EnteResumido;
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
 * "R$ 888/hab" de Teresina (seis meses) ao lado de "R$ 1.267/hab" de Oeiras
 * (doze meses) faz Oeiras parecer o dobro do que é.
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
