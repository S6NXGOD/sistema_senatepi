import { api, TIMEOUT_LONGO } from './api';
import type { Confronto, ParteResumo } from './partes';

// ---------------------------------------------------------------------------
// Tipos (espelham a API — módulo de Processos / DATAJUD)
// ---------------------------------------------------------------------------

export type StatusProcesso =
  | 'RASCUNHO' | 'PENDENTE' | 'ATIVO' | 'SUSPENSO' | 'GANHO_EXECUCAO'
  | 'IMPROCEDENTE' | 'ENCERRADO' | 'ARQUIVADO';

/**
 * Natureza da atuação. INSTITUCIONAL é a ação coletiva movida pelo SENATEPI em
 * nome da categoria — nela não existe filiado "dono", e a tela para de cobrar o
 * vínculo que num processo coletivo não faria sentido.
 */
export type TipoAcaoProcesso = 'INDIVIDUAL' | 'INSTITUCIONAL';

/** Selo da ação institucional, usado na lista e no detalhe. */
export const BADGE_INSTITUCIONAL = '🏛️ Ação Institucional (SENATEPI)';

export interface FiliadoRef {
  id: string;
  nomeCompleto: string;
  matricula: string;
}
export interface AdvogadoRef {
  id: string;
  nome: string;
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
  /** Nulo em RASCUNHO — processo aberto por um desfecho, ainda sem NPU. */
  numeroCNJ: string | null;
  /** Rótulo do rascunho enquanto não há número/classe. */
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
  segredoJustica?: boolean;
  /** INSTITUCIONAL = ação coletiva movida pelo SENATEPI (badge própria). */
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
  alerta?: { nivel: 'PRAZO' | 'DECISAO'; rotulo: string } | null;
  /**
   * Etiquetas mantidas pelo SISTEMA (⚡). Derivadas na leitura, nunca gravadas —
   * é o que garante que não envelheçam. As de `etiquetas` são as manuais.
   */
  etiquetasAutomaticas?: string[];
  _count: { movimentacoes: number; partes: number; advogados: number };
}

/** Fase processual — espelha `apps/api/.../utils/fase.util.ts`. */
export type FaseProcessual = 'CONHECIMENTO' | 'EXECUCAO' | 'RECURSAL' | 'ARQUIVADO';

export const FASE_LABEL: Record<FaseProcessual, string> = {
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
export const ETIQUETAS_SUGERIDAS = [
  'Urgente', 'Acordo', 'Aguardando Cliente', 'Prioridade Idoso',
  'Perícia realizada', 'Acordo descumprido',
];

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

export const STATUS_PROCESSO_LABEL: Record<StatusProcesso, string> = {
  RASCUNHO: 'Rascunho',
  PENDENTE: 'Pendente',
  ATIVO: 'Ativo',
  SUSPENSO: 'Suspenso',
  GANHO_EXECUCAO: 'Ganho — Execução',
  IMPROCEDENTE: 'Improcedente',
  ENCERRADO: 'Encerrado',
  ARQUIVADO: 'Arquivado',
};
/** Ordem do ciclo de vida (usada nos filtros e no seletor). */
export const STATUS_PROCESSO_ORDEM: StatusProcesso[] = [
  'RASCUNHO', 'PENDENTE', 'ATIVO', 'SUSPENSO', 'GANHO_EXECUCAO', 'IMPROCEDENTE', 'ENCERRADO', 'ARQUIVADO',
];
export const STATUS_PROCESSO_COR: Record<StatusProcesso, string> = {
  RASCUNHO: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ATIVO: 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
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
 * Aceita nulo porque processos em RASCUNHO ainda não têm número — nesses casos
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
  return p.titulo || p.classeProcessual || 'Rascunho sem título';
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
  /** Filtros rápidos da tabela. */
  meus?: 'true';
  semFiliado?: 'true';
  semParteContraria?: 'true';
  /** Movimentação nos últimos N dias (string por ser query param). */
  movimentacaoRecente?: string;
  /** Fase processual — a API deriva de instâncias vivas + atos de execução. */
  fase?: FaseProcessual;
  etiqueta?: string;
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
export type PoloAtivoInput =
  /** Ação coletiva: o polo ativo é o próprio SENATEPI. */
  | { tipo: 'INSTITUCIONAL' }
  /** Um ou mais filiados (o primeiro é o principal). */
  | { tipo: 'FILIADOS'; filiadoIds: string[] }
  /** Parte conhecida só pelo nome — ou nada, para definir depois. */
  | { tipo: 'OUTRA'; nome?: string; documento?: string };

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
  parteContraria?: { parteExternaId?: string; nome?: string; documento?: string };
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
