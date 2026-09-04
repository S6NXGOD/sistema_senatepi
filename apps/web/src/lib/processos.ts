import { api, TIMEOUT_LONGO } from './api';
import type { Confronto, ParteResumo } from './partes';
import { tenant } from '@/tenant.config';

// ---------------------------------------------------------------------------
// Tipos (espelham a API — módulo de Processos / DATAJUD)
// ---------------------------------------------------------------------------

export type StatusProcesso =
  | 'PRE_PROCESSUAL' | 'PENDENTE' | 'ATIVO' | 'SUSPENSO' | 'GANHO_EXECUCAO'
  | 'IMPROCEDENTE' | 'ENCERRADO' | 'ARQUIVADO'
  /**
   * O nome ANTIGO de `PRE_PROCESSUAL`. Ainda chega da API nos casos criados
   * antes do deploy que introduziu o nome novo — a migração é aditiva de
   * propósito (renomear o rótulo derrubaria a listagem no contêiner que segue
   * no ar durante a troca; a medição está no enum, em `schema.prisma`).
   *
   * Para o usuário os dois são A MESMA COISA e têm de aparecer idênticos: mesmo
   * rótulo, mesma cor, mesmo lugar no filtro. Se este valor cair num
   * `Record<StatusProcesso, …>` sem entrada, a tela mostra `undefined`.
   */
  | 'RASCUNHO';

/**
 * Natureza da atuação. INSTITUCIONAL é a ação coletiva movida pelo sindicato em
 * nome da categoria — nela não existe filiado "dono", e a tela para de cobrar o
 * vínculo que num processo coletivo não faria sentido.
 */
export type TipoAcaoProcesso = 'INDIVIDUAL' | 'INSTITUCIONAL';

/** Selo da ação institucional, usado na lista e no detalhe. */
export const BADGE_INSTITUCIONAL = `Ação institucional (${tenant.sigla})`;

export interface FiliadoRef {
  id: string;
  nomeCompleto: string;
  matricula: string;
}
export interface AdvogadoRef {
  id: string;
  nome: string;
  /** Como a pessoa é chamada na casa ("Dra. Shérad") — é o que se reconhece. */
  nomeExibicao?: string | null;
  /**
   * Já resolvida pelo `AvataresInterceptor` da API: a foto enviada mora no
   * storage e nunca esteve neste campo no banco. A tela só consome.
   */
  avatarUrl?: string | null;
}

export interface Movimentacao {
  id: string;
  processoId: string;
  dataMovimento: string;
  descricao: string;
  codigoMovimento: number | null;
  createdAt: string;
}

/** Parte processual (com desmascaramento inteligente do CPF do filiado). */
export interface ParteProcesso {
  nome: string | null;
  documento: string | null;
  polo: string | null;
  tipoPessoa: string | null;
  documentoDesmascarado?: boolean;
}

export interface ProcessoLista {
  id: string;
  /** Nulo em PRE_PROCESSUAL — caso aberto por um desfecho e ainda não ajuizado. */
  numeroCNJ: string | null;
  /** Rótulo do caso pré-processual enquanto não há número nem classe. */
  titulo?: string | null;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  tribunal: string | null;
  grau: string | null;
  dataDistribuicao: string | null;
  valorCausa: string | number | null;
  statusInterno: StatusProcesso;
  ultimaSincronizacao: string | null;
  etiquetas?: string[];
  /** Coluna, e não etiqueta — é o que torna a urgência filtrável e contável. */
  urgente?: boolean;
  /** POR QUE é urgente. Nulo nos registros migrados da etiqueta antiga. */
  urgenteMotivo?: string | null;
  urgenteEm?: string | null;
  /** Área jurídica — a única classificação que existe antes do ajuizamento. */
  categoria?: string | null;
  /** QUEM PEDIU o caso. Diferente do filiado parte — ver a API. */
  solicitadoPor?: { id: string; nomeCompleto: string } | null;
  segredoJustica?: boolean;
  /** INSTITUCIONAL = ação coletiva movida pelo sindicato (badge própria). */
  tipoAcao?: TipoAcaoProcesso;
  /** Filiado principal e advogado responsável (atalhos dos vínculos N:N). */
  filiado: FiliadoRef | null;
  advogado: AdvogadoRef | null;
  /** Todas as partes, para o resumo do polo na linha da tabela. */
  partes: ParteResumo[];
  /** Toda a equipe do processo (o `principal` é o responsável). */
  advogados: { principal: boolean; advogado: AdvogadoRef }[];
  /** "Autor × Réu" já calculado pela API — a tela não reimplementa a regra. */
  confronto: Confronto;
  /**
   * Graus em que o processo corre. Só o resumo: a lista precisa avisar que há
   * mais de uma instância, não descrever cada uma.
   */
  instancias?: { grau: string; tribunal: string; baixada: boolean; principal: boolean }[];
  /**
   * Última movimentação — data e o que foi.
   *
   * A coluna mostrava só a CONTAGEM ("203 mov."), que não responde a pergunta
   * de quem abre a lista: "este processo andou? quando? o quê?".
   */
  /**
   * A ÚLTIMA MOVIMENTAÇÃO DE VERDADE — do tribunal ou da equipe.
   *
   * A coluna mostrava só o andamento do CNJ enquanto o chip "com movimentação
   * recente" contava também a nota da equipe: um filtro de sete dias listava
   * processos com "há 1 ano" ao lado. Agora a coluna mostra o que o filtro
   * conta, e `origem` diz de onde veio — publicação oficial e anotação interna
   * não podem parecer a mesma coisa.
   *
   * A papelada do robô ("encerrado automaticamente") não entra em nenhum dos
   * dois: arquivar não é andar.
   */
  ultimaMovimentacao?: {
    data: string;
    descricao: string;
    detalhe: string | null;
    origem: 'TRIBUNAL' | 'EQUIPE';
  } | null;
  movimentacoes?: {
    dataMovimento: string;
    descricao: string;
    detalhe: string | null;
    codigoMovimento: number | null;
    /** Já virou tarefa na agenda? Se não, o ato pode estar pendente. */
    compromissoId: string | null;
  }[];
  /**
   * Fase derivada pela API (`fase.util.ts`). Vem calculada de lá de propósito:
   * é a mesma regra que alimenta o filtro, e reimplementá-la aqui abriria a
   * porta para a etiqueta discordar do chip que a pessoa acabou de clicar.
   */
  fase?: FaseProcessual;
  /**
   * O último ato pede providência e ainda não virou tarefa na agenda.
   *
   * Vem classificado da API (`tpu.util.ts`) — a tela não repete o dicionário de
   * códigos da TPU, senão os dois envelheceriam separados.
   */
  /**
   * O aviso da linha — um só, escolhido no back (`alertaDaLinha`).
   *
   * `PARADO` não vem de um ato: vem da AUSÊNCIA deles. Entrou quando os selos
   * de prazo ganharam validade e dez avisos sumiram de uma vez — eles estavam
   * mal rotulados, não eram falsos, e sumir sem substituto faria a inércia
   * parecer normalidade.
   */
  alerta?: {
    nivel: 'URGENTE' | 'PRAZO' | 'DECISAO' | 'PARADO';
    rotulo: string;
  } | null;
  /**
   * Etiquetas mantidas pelo SISTEMA (⚡). Derivadas na leitura, nunca gravadas —
   * é o que garante que não envelheçam. As de `etiquetas` são as manuais.
   */
  etiquetasAutomaticas?: string[];
  _count: { movimentacoes: number; partes: number; advogados: number };
}

/** Fase processual — espelha `apps/api/.../utils/fase.util.ts`. */
export type FaseProcessual =
  | 'PRE_PROCESSUAL'
  | 'CONHECIMENTO'
  | 'EXECUCAO'
  | 'RECURSAL'
  | 'ARQUIVADO';

/** Onde o processo está NO TRIBUNAL — a outra metade da coluna "Status". */
export const FASE_AJUDA: Record<FaseProcessual, string> = {
  PRE_PROCESSUAL: 'Fase: ainda não ajuizado.',
  CONHECIMENTO: 'Fase no tribunal: instrução e julgamento em primeiro grau.',
  EXECUCAO: 'Fase no tribunal: cumprimento da decisão.',
  RECURSAL: 'Fase no tribunal: há instância recursal ativa.',
  ARQUIVADO: 'Fase no tribunal: todas as instâncias receberam baixa.',
};

export const FASE_LABEL: Record<FaseProcessual, string> = {
  PRE_PROCESSUAL: 'Pré-processual',
  CONHECIMENTO: 'Conhecimento',
  EXECUCAO: 'Execução',
  RECURSAL: 'Recursal',
  ARQUIVADO: 'Arquivado',
};

/**
 * Etiquetas sugeridas no seletor — só as que dependem de JULGAMENTO HUMANO.
 *
 * "Fase de Execução", "Recurso", "Coletiva" e "Perícia" saíram daqui: são
 * consequência de dados que o sistema já tem, e agora ele as mantém sozinho
 * (fase processual + `etiquetasAutomaticas`). Escrever à mão o que a máquina
 * deduz foi o que produziu etiqueta contradizendo a tela ao lado.
 */
/*
  A LISTA FIXA DE ETIQUETAS FOI REMOVIDA, e não substituída.

  Eram seis sugestões escritas aqui — "Urgente", "Acordo", "Aguardando
  Cliente", "Prioridade Idoso", "Perícia realizada", "Acordo descumprido".
  Medido em 04/09/2026: entre os 83 processos etiquetados da produção, as seis
  somam DUAS ocorrências. O vocabulário real da equipe é outro (período da
  convenção e pedido), e nenhuma lista escrita no código ia adivinhá-lo.

  Agora a sugestão vem do próprio acervo, por frequência:
  `etiquetasDoAcervo()` em `@/lib/partes`.
*/

export interface ProcessoDetalhe {
  id: string;
  numeroCNJ: string | null;
  titulo?: string | null;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  tribunal: string | null;
  grau: string | null;
  dataDistribuicao: string | null;
  valorCausa: string | number | null;
  statusInterno: StatusProcesso;
  ultimaSincronizacao: string | null;
  tipoAcao?: TipoAcaoProcesso;
  filiadoId: string | null;
  advogadoId: string | null;
  createdAt: string;
  updatedAt: string;
  filiado: FiliadoRef | null;
  advogado: AdvogadoRef | null;
  movimentacoes: Movimentacao[];
  /** Presente nas respostas de importar/sincronizar (não vem no GET /:id). */
  partes?: ParteProcesso[];
  /** Presente na resposta de sincronizar. */
  novasMovimentacoes?: number;
}

/**
 * COMO A LISTA VEM ORDENADA — espelho de `ORDENS_PROCESSO` no back.
 *
 * Três, e não sete, porque cada uma responde uma pergunta diferente: o que está
 * acontecendo, o que estou esquecendo, o que acabou de entrar. Seletor com dez
 * opções é seletor que ninguém abre.
 *
 * Os rótulos aqui são a PERGUNTA em linguagem de gente, não o nome do campo:
 * "Parados há mais tempo" diz para que serve; "ultimoMovimentoEm asc" não.
 */
export const ORDENS_LABEL = {
  movimentacao: 'Movimentação recente',
  parados: 'Parados há mais tempo',
  cadastro: 'Cadastrados por último',
} as const;

export type OrdemProcesso = keyof typeof ORDENS_LABEL;

export interface ListaProcessosResp {
  items: ProcessoLista[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

// ---------------------------------------------------------------------------
// Rótulos e cores
// ---------------------------------------------------------------------------

/**
 * "Este caso ainda não foi ajuizado?" — pergunte SEMPRE por aqui, nunca
 * comparando com um literal. São dois rótulos para o mesmo estado (ver o tipo
 * `StatusProcesso`), e a comparação direta esquece o legado em silêncio: o
 * selo simplesmente não aparece, e ninguém percebe.
 */
// Aceita `string` porque nem todo lugar que carrega o status o tipa: a agenda,
// por exemplo, traz o processo embutido com `statusInterno: string`. Estreitar
// o parâmetro só empurraria um `as` para cada chamada.
export const ehPreProcessual = (s?: string | null) =>
  s === 'PRE_PROCESSUAL' || s === 'RASCUNHO';

export const STATUS_PROCESSO_LABEL: Record<StatusProcesso, string> = {
  PRE_PROCESSUAL: 'Pré-processual',
  RASCUNHO: 'Pré-processual', // legado: mesmo nome na tela, ver o tipo acima
  PENDENTE: 'Pendente',
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  GANHO_EXECUCAO: 'Ganho — Execução',
  IMPROCEDENTE: 'Improcedente',
  ENCERRADO: 'Encerrado',
  ARQUIVADO: 'Arquivado',
};
/**
 * O QUE CADA SITUAÇÃO QUER DIZER — vira a dica ao passar o mouse.
 *
 * A coluna "Status" da listagem empilha DUAS escalas diferentes: a situação no
 * SINDICATO (esta) e a fase no TRIBUNAL (`FASE_LABEL`). Quem chega novo lê
 * "Ativo / EXECUÇÃO" e precisa adivinhar qual é qual — e, pior, "Pendente"
 * sozinho não diz nada. Os textos abaixo saíram do próprio schema, onde a
 * definição de cada valor já estava escrita.
 */
export const STATUS_PROCESSO_AJUDA: Record<StatusProcesso, string> = {
  PRE_PROCESSUAL: 'Situação no sindicato: o caso existe e é trabalho de verdade, mas ainda não foi ajuizado — não há número de processo.',
  RASCUNHO: 'Situação no sindicato: o caso existe e é trabalho de verdade, mas ainda não foi ajuizado — não há número de processo.',
  PENDENTE: 'Situação no sindicato: distribuído, aguardando a primeira movimentação do tribunal.',
  ATIVO: 'Situação no sindicato: em andamento.',
  SUSPENSO: 'Situação no sindicato: tramitação suspensa.',
  GANHO_EXECUCAO: 'Situação no sindicato: julgado procedente, em fase de execução/cumprimento.',
  IMPROCEDENTE: 'Situação no sindicato: julgado improcedente.',
  ENCERRADO: 'Situação no sindicato: baixado ou transitado em julgado.',
  ARQUIVADO: 'Situação no sindicato: arquivado.',
};

/** Ordem do ciclo de vida (usada nos filtros e no seletor). */
// `RASCUNHO` NÃO entra: é o mesmo status com nome velho, e listá-lo criaria
// duas opções idênticas no filtro. Quem escolhe "Pré-processual" recebe os dois
// — quem resolve isso é a API (`PRE_PROCESSUAIS`), não a tela.
export const STATUS_PROCESSO_ORDEM: StatusProcesso[] = [
  'PRE_PROCESSUAL', 'PENDENTE', 'ATIVO', 'SUSPENSO', 'GANHO_EXECUCAO', 'IMPROCEDENTE', 'ENCERRADO', 'ARQUIVADO',
];
export const STATUS_PROCESSO_COR: Record<StatusProcesso, string> = {
  PRE_PROCESSUAL: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  RASCUNHO: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ATIVO: 'bg-brand-50 text-brand-800 dark:bg-brand-900/30 dark:text-brand-400',
  SUSPENSO: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  GANHO_EXECUCAO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  IMPROCEDENTE: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  ENCERRADO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  ARQUIVADO: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

// ---------------------------------------------------------------------------
// Helpers de formatação
// ---------------------------------------------------------------------------

/**
 * Máscara progressiva do NPU/CNJ: XXXXXXX-XX.XXXX.X.XX.XXXX (7-2.4.1.2.4).
 * Aceita entrada com ou sem pontuação e limita a 20 dígitos.
 */
export function mascararNPU(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 20);
  let out = d.slice(0, 7);
  if (d.length > 7) out += '-' + d.slice(7, 9);
  if (d.length > 9) out += '.' + d.slice(9, 13);
  if (d.length > 13) out += '.' + d.slice(13, 14);
  if (d.length > 14) out += '.' + d.slice(14, 16);
  if (d.length > 16) out += '.' + d.slice(16, 20);
  return out;
}

/** Justiça Estadual (J=8): código do tribunal → UF. */
const UF_ESTADUAL: Record<string, string> = {
  '01': 'AC', '02': 'AL', '03': 'AP', '04': 'AM', '05': 'BA', '06': 'CE',
  '07': 'DFT', '08': 'ES', '09': 'GO', '10': 'MA', '11': 'MT', '12': 'MS',
  '13': 'MG', '14': 'PA', '15': 'PB', '16': 'PR', '17': 'PE', '18': 'PI',
  '19': 'RJ', '20': 'RN', '21': 'RS', '22': 'RO', '23': 'RR', '24': 'SC',
  '25': 'SE', '26': 'SP', '27': 'TO',
};

/**
 * Alias do tribunal derivado do próprio NPU — o mesmo cálculo do back
 * (`NpuUtils.siglaTribunal`), refeito aqui só para dar retorno IMEDIATO
 * enquanto se digita, sem depender de ida ao servidor.
 *
 * Funciona parcialmente: os dígitos J e TR ficam nas posições 14–16, então o
 * alias aparece antes de o número estar completo. `null` = ainda não dá para
 * saber (ou é um segmento sem índice por NPU, como STF/CNJ).
 */
export function aliasTribunalDoNPU(npu: string): string | null {
  const d = (npu || '').replace(/\D/g, '');
  if (d.length < 16) return null;

  const j = d[13];
  const tr = d.slice(14, 16);
  const n = Number.parseInt(tr, 10);

  switch (j) {
    case '3': return 'STJ';
    case '4': return n >= 1 && n <= 6 ? `TRF${n}` : null;
    case '5': return tr === '00' ? 'TST' : n >= 1 && n <= 24 ? `TRT${n}` : null;
    case '7': return 'STM';
    case '6': {
      if (tr === '00') return 'TSE';
      const uf = UF_ESTADUAL[tr];
      return uf && uf !== 'DFT' ? `TRE-${uf}` : tr === '07' ? 'TRE-DF' : null;
    }
    case '8': return UF_ESTADUAL[tr] ? `TJ${UF_ESTADUAL[tr]}` : null;
    case '9': {
      const uf = UF_ESTADUAL[tr];
      return uf && ['MG', 'RS', 'SP'].includes(uf) ? `TJM${uf}` : null;
    }
    default: return null; // STF e CNJ não têm índice por NPU
  }
}

/**
 * Formata um NPU já armazenado (20 dígitos) para exibição.
 * Aceita nulo porque casos PRÉ-PROCESSUAIS ainda não têm número — nesses casos
 * a tela deve mostrar o título do rascunho, e este travessão é o último recurso.
 */
export const formatNPU = (numeroCNJ: string | null | undefined) =>
  numeroCNJ ? mascararNPU(numeroCNJ) : '—';

/** Rótulo do processo na lista: NPU quando existe, senão o título do rascunho. */
export function rotuloProcesso(p: {
  numeroCNJ: string | null;
  titulo?: string | null;
  classeProcessual?: string | null;
}): string {
  if (p.numeroCNJ) return mascararNPU(p.numeroCNJ);
  return p.titulo || p.classeProcessual || 'Caso sem título';
}

export function formatData(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Formata o valor da causa (Decimal chega como string no JSON). */
export function formatMoeda(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface FiltroProcessos {
  busca?: string;
  statusInterno?: StatusProcesso;
  tribunal?: string;
  /** Casam com QUALQUER vínculo do processo, não só o principal. */
  filiadoId?: string;
  advogadoId?: string;
  /** Todos os processos de uma parte cadastrada (ex.: uma empresa ré). */
  parteExternaId?: string;
  /** Assunto do CNJ, casamento exato — inclusive quando for secundário. */
  assunto?: string;
  /** Restringe a busca por nome de parte a um lado do processo. */
  polo?: 'ATIVO' | 'PASSIVO';
  /**
   * De que lado o SINDICATO está. Não confundir com `polo`, que é o lado da
   * parte procurada na busca por nome.
   */
  nossoPapel?: 'AUTOR' | 'REU' | 'REPRESENTANDO';
  /** Filtros rápidos da tabela. */
  meus?: 'true';
  semFiliado?: 'true';
  semParteContraria?: 'true';
  /** Movimentação nos últimos N dias (string por ser query param). */
  movimentacaoRecente?: string;
  /** Fase processual — a API deriva de instâncias vivas + atos de execução. */
  fase?: FaseProcessual;
  etiqueta?: string;
  /** Área jurídica — slug de `AREAS_JURIDICAS`. */
  categoria?: string;
  /**
   * Ordem da lista. Estava faltando aqui e funcionava por acidente:
   * `listarProcessos` itera as chaves do objeto, então a chave ia para a URL
   * mesmo sem existir no tipo. Faltando no tipo, um erro de digitação viraria um
   * parâmetro silenciosamente ignorado — e a lista voltaria à ordem padrão sem
   * ninguém entender por quê.
   */
  ordem?: OrdemProcesso;
  page?: number;
  pageSize?: number;
}

export async function listarProcessos(f: FiltroProcessos = {}): Promise<ListaProcessosResp> {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && v !== '') params[k] = v as string | number;
  }
  return (await api.get('/processos', { params })).data;
}

/**
 * Os números das abas de filtro rápido.
 *
 * Chamada separada da listagem de propósito: a lista muda a cada tecla da busca
 * e a cada página; estes números, não. Juntos, cada tecla custaria sete `count`
 * no banco.
 */
export interface ContadoresProcessos {
  /** A lista padrão — JÁ SEM os pré-processuais, igual ao que a tela mostra. */
  todos: number;
  preProcessuais: number;
  meus: number;
  semFiliado: number;
  semReu: number;
  recentes: number;
  urgentes: number;
}

export async function contadoresProcessos(): Promise<ContadoresProcessos> {
  return (await api.get('/processos/contadores')).data;
}

export async function getProcesso(id: string): Promise<ProcessoDetalhe> {
  return (await api.get(`/processos/${id}`)).data;
}

// ---------------------------------------------------------------------------
// Consulta prévia ao DataJud (auto-preenchimento do modal "Novo Processo")
// ---------------------------------------------------------------------------

export interface ParteConferida {
  nome: string | null;
  documento: string | null;
  polo: string | null;
  tipoPessoa: string | null;
  advogados: { nome: string | null; oab: string | null }[];
  /** Filiado encontrado pelo CPF/CNPJ (null quando não há correspondência). */
  filiado: { id: string; nomeCompleto: string; matricula: string } | null;
}

export interface ConsultaDatajud {
  encontrado: boolean;
  jaImportado: boolean;
  processoExistenteId: string | null;
  tribunalDerivado: string;
  preenchimento?: {
    classeProcessual: string | null;
    assuntoPrincipal: string | null;
    orgaoJulgador: string | null;
    tribunal: string;
    grau: string | null;
    dataDistribuicao: string | null;
    valorCausa: number | null;
    formato: string | null;
    sistema: string | null;
    segredoJustica: boolean;
    nivelSigilo: number | null;
    prioridades: string[];
    totalMovimentacoes: number;
    ultimaMovimentacao: { data: string; descricao: string; detalhe: string | null } | null;
    descricaoSugerida: string;
    /**
     * Etiquetas deduzidas da classe e do último andamento (`etiquetas.util.ts`).
     * A tela marca de saída; o operador desmarca o que não quiser.
     */
    etiquetasSugeridas?: string[];
  };
  partes?: ParteConferida[];
  /** Partes separadas por polo, prontas para o card de prévia. */
  polos?: { ativo: ParteConferida[]; passivo: ParteConferida[]; outros: ParteConferida[] };
  advogadosDatajud?: { nome: string | null; oab: string | null }[];
  sugestoesAdvogado?: SugestaoAdvogado[];
  filiadoSugerido?: { id: string; nomeCompleto: string; matricula: string } | null;
  semFiliadoVinculado?: boolean;
  /** true quando o tribunal não expõe partes (caso normal da API pública). */
  tribunalNaoExpoePartes?: boolean;
}

export type OrigemSugestao = 'DATAJUD_OAB' | 'DATAJUD_NOME' | 'CARTEIRA_FILIADO' | 'TRIAGEM';

/** Sugestão de advogado responsável — sempre facultativa. */
export interface SugestaoAdvogado {
  advogado: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null };
  origem: OrigemSugestao;
  motivo: string;
  confianca: number;
}

/** Rótulo curto da origem, para o badge. */
export const ORIGEM_SUGESTAO_LABEL: Record<OrigemSugestao, string> = {
  DATAJUD_OAB: 'Sugerido pelo DataJud',
  DATAJUD_NOME: 'Sugerido pelo DataJud',
  CARTEIRA_FILIADO: 'Sugerido pelo histórico',
  TRIAGEM: 'Sugerido pela triagem',
};

/**
 * Sugestões de advogado a partir do histórico local do filiado.
 * 100% local — não consulta o CNJ.
 */
export async function sugerirAdvogado(filiadoId: string): Promise<SugestaoAdvogado[]> {
  return (await api.get('/datajud/sugerir-advogado', { params: { filiadoId } })).data;
}

/**
 * Consulta o DataJud SEM persistir — usada enquanto o usuário digita o NPU.
 * Nenhum registro (nem de filiado) é criado no banco.
 */
export async function consultarDatajud(numeroCNJ: string, tribunal?: string): Promise<ConsultaDatajud> {
  return (
    await api.get('/datajud/consultar', {
      params: { numeroCNJ: numeroCNJ.replace(/\D/g, ''), ...(tribunal ? { tribunal } : {}) },
      // Fala com o CNJ: o timeout padrão de 30s cortaria uma consulta que ia
      // dar certo (a API Pública responde em 10–25s no caso comum).
      timeout: TIMEOUT_LONGO,
    })
  ).data;
}

/**
 * Quem move a ação. As três opções do modal, e nenhuma delas cria cadastro
 * provisório de filiado.
 */
/** Uma linha do polo ativo. Os tipos podem se MISTURAR na mesma ação. */
export interface ParteDoPoloInput {
  tipo: 'FILIADO' | 'INSTITUCIONAL' | 'ORGANIZACAO' | 'AVULSA';
  filiadoId?: string;
  parteExternaId?: string;
  nome?: string;
  documento?: string;
}

/**
 * O polo ativo, nos DOIS formatos.
 *
 * `partes` é a relação ordenada e é o que a API nova usa. `tipo` continua
 * obrigatório como RESUMO: web e API sobem separadas, e na janela de troca a
 * tela nova fala com o contêiner velho, que só entende o resumo. Mandar os
 * dois é o que impede um processo de entrar sem autor nesse intervalo.
 */
export type PoloAtivoInput =
  /** Ação coletiva: o polo ativo é o próprio sindicato. */
  | { tipo: 'INSTITUCIONAL'; partes?: ParteDoPoloInput[] }
  /** Um ou mais filiados (o primeiro é o principal). */
  | { tipo: 'FILIADOS'; filiadoIds: string[]; partes?: ParteDoPoloInput[] }
  /** Parte conhecida só pelo nome — ou nada, para definir depois. */
  | { tipo: 'OUTRA'; nome?: string; documento?: string; partes?: ParteDoPoloInput[] };

export interface ImportarProcessoInput {
  numeroCNJ: string;
  tribunal?: string;
  /** @deprecated Use `poloAtivo`. Mantido para chamadas antigas. */
  filiadoId?: string;
  poloAtivo?: PoloAtivoInput;
  /** Advogado RESPONSÁVEL (principal). */
  advogadoId?: string;
  /** Equipe completa — o responsável entra nela mesmo se não vier listado. */
  advogadosIds?: string[];
  etiquetas?: string[];
  /**
   * Réu informado já na importação — o DataJud não devolve as partes, e este é o
   * momento em que o operador tem o nome em mãos.
   */
  /** Compatibilidade: réu único. O caminho novo é `partesContrarias`. */
  parteContraria?: { parteExternaId?: string; nome?: string; documento?: string };
  /** Litisconsórcio passivo — o primeiro é o réu principal. */
  partesContrarias?: { parteExternaId?: string; nome?: string; documento?: string }[];
}
/** Gatilho On-Demand: consulta o DATAJUD e cria o cache local (409 se já existir). */
export async function importarProcesso(dto: ImportarProcessoInput): Promise<ProcessoDetalhe> {
  return (await api.post('/processos/importar', dto, { timeout: TIMEOUT_LONGO })).data;
}

/** Re-sincroniza incrementalmente (insere só as movimentações ausentes). */
export async function sincronizarProcesso(id: string): Promise<ProcessoDetalhe> {
  // Com multi-instância, uma sincronização consulta o CNJ e percorre TODOS os
  // graus do processo — leva mais que uma leitura comum.
  return (await api.patch(`/processos/${id}/sincronizar`, undefined, { timeout: TIMEOUT_LONGO })).data;
}

/** Advogado habilitado a atuar num processo (perfil ADVOGADO). */
export interface AdvogadoDisponivel {
  id: string;
  nome: string;
  nomeExibicao: string | null;
  role: string;
  oab: string | null;
  oabUf: string | null;
  avatarUrl: string | null;
}

/**
 * SÓ o perfil ADVOGADO — diferente de `listarResponsaveis` (Agenda), que traz
 * todo usuário ativo porque lá triagem e coordenação respondem por tarefas.
 */
export async function listarAdvogadosDisponiveis(): Promise<AdvogadoDisponivel[]> {
  return (await api.get('/processos/advogados')).data;
}

/**
 * Pede à API que releia no CNJ os processos que o parser multi-instância ainda
 * não viu. Idempotente por construção: cada processo é relido uma única vez
 * (carimbo `instanciasLidasEm`), então chamar de novo não custa chamada ao CNJ.
 */
export async function reavaliarInstancias(limite = 10): Promise<{
  reavaliados: number;
  restantes: number;
  executou: boolean;
  /** Processos cujo status foi realinhado às instâncias (só banco, sem CNJ). */
  desalinhados: number;
}> {
  // Fala com o CNJ, um processo por vez — o timeout curto cortaria a rodada.
  return (
    await api.post('/processos/instancias/reavaliar', undefined, {
      params: { limite },
      timeout: TIMEOUT_LONGO,
    })
  ).data;
}

export async function atualizarProcesso(
  id: string,
  dto: {
    statusInterno?: StatusProcesso;
    filiadoId?: string | null;
    advogadoId?: string | null;
    etiquetas?: string[];
    /** Preenchimento manual — o CNJ não publica o valor da causa. */
    valorCausa?: number | null;
  },
): Promise<ProcessoDetalhe> {
  return (await api.patch(`/processos/${id}`, dto)).data;
}

export interface FormalizarProcessoInput {
  numeroCNJ: string;
  tribunal?: string;
  /** Buscar os dados no DataJud logo após formalizar. */
  sincronizar?: boolean;
  // Preenchimento manual (para quando o CNJ ainda não indexou o processo).
  classeProcessual?: string;
  assuntoPrincipal?: string;
  orgaoJulgador?: string;
  dataDistribuicao?: string;
  valorCausa?: number;
  statusInterno?: StatusProcesso;
}

/**
 * Formaliza um RASCUNHO: informa o NPU e, se quiser, puxa tudo do DataJud.
 * A busca é opcional de propósito — nos primeiros dias após a distribuição o
 * tribunal ainda não indexou o processo no CNJ, e o preenchimento manual é o
 * único caminho possível.
 */
export async function formalizarProcesso(
  id: string,
  dto: FormalizarProcessoInput,
): Promise<ProcessoDetalhe & { avisoSincronizacao?: string }> {
  return (await api.patch(`/processos/${id}/formalizar`, dto)).data;
}

/** Exclui o processo e todo o histórico (movimentações + anexos) — só Administrador. */
export async function excluirProcesso(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/processos/${id}`)).data;
}
