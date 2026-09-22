import { api } from './api';
import { classesCor, type ClassesCor } from './paleta-cores';
import { formatData, type FaseProcessual, type StatusProcesso, type TipoAcaoProcesso } from './processos';
import type { AdvogadoDoProcesso, ParteDoProcesso, PolosProcesso } from './partes';
import type { ContaPublicaDoReu } from '@/components/processos/conta-publica-do-reu';

// ---------------------------------------------------------------------------
// Tipos de movimentação (cadastráveis)
// ---------------------------------------------------------------------------

export interface TipoAndamento {
  id: string;
  slug: string;
  nome: string;
  cor: string;
  ordem: number;
  ativo: boolean;
  sistema: boolean;
}

/** Fallback dos tipos "sistema" enquanto a lista dinâmica não carregou. */
export const TIPO_MOV_PADRAO: Record<string, { nome: string; cor: string }> = {
  ATUALIZACAO: { nome: 'Atualização', cor: 'slate' },
  AUDIENCIA: { nome: 'Audiência', cor: 'purple' },
  DECISAO: { nome: 'Decisão', cor: 'emerald' },
  DESPACHO: { nome: 'Despacho', cor: 'teal' },
  PRAZO: { nome: 'Prazo', cor: 'amber' },
  PROTOCOLO: { nome: 'Protocolo', cor: 'blue' },
  RECURSO: { nome: 'Recurso', cor: 'orange' },
  URGENTE: { nome: 'Urgente!', cor: 'red' },
};

export function rotuloTipoMov(slug: string, tipos?: TipoAndamento[]): string {
  return tipos?.find((t) => t.slug === slug)?.nome ?? TIPO_MOV_PADRAO[slug]?.nome ?? slug;
}
export function corTipoMov(slug: string, tipos?: TipoAndamento[]): ClassesCor {
  const cor = tipos?.find((t) => t.slug === slug)?.cor ?? TIPO_MOV_PADRAO[slug]?.cor;
  return classesCor(cor);
}

export async function listarTiposMovimentacao(incluirInativos = false): Promise<TipoAndamento[]> {
  return (
    await api.get('/tipos-movimentacao', {
      params: incluirInativos ? { incluirInativos: 'true' } : {},
    })
  ).data;
}
export interface TipoMovInput { nome: string; cor?: string; ordem?: number; ativo?: boolean }
export async function criarTipoMovimentacao(dto: TipoMovInput): Promise<TipoAndamento> {
  return (await api.post('/tipos-movimentacao', dto)).data;
}
export async function atualizarTipoMovimentacao(id: string, dto: Partial<TipoMovInput>): Promise<TipoAndamento> {
  return (await api.patch(`/tipos-movimentacao/${id}`, dto)).data;
}
export async function excluirTipoMovimentacao(id: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/tipos-movimentacao/${id}`)).data;
}

// ---------------------------------------------------------------------------
// Dossiê do processo
// ---------------------------------------------------------------------------

export interface PessoaRef {
  id: string;
  nome: string;
  nomeExibicao?: string | null;
  avatarUrl?: string | null;
}

export interface AnexoRef {
  id: string;
  nomeArquivo: string;
  url: string;
  tipoMime: string;
  tamanhoBytes: number | null;
}

/** Item da linha do tempo unificada (cache do DataJud + andamentos internos). */
export type ItemTimeline =
  | {
      id: string;
      origem: 'DATAJUD';
      data: string;
      descricao: string;
      codigoMovimento: number | null;
      /** Tipo exato do ato, vindo dos complementos tabelados do CNJ. */
      detalhe?: string | null;
      /** Teor/síntese do despacho ou decisão, quando o tribunal envia. */
      conteudo?: string | null;
      complementos?: { codigo: number | null; descricao: string | null; valor: number | null; nome: string | null }[] | null;
      orgaoJulgador?: string | null;
      ehAudiencia?: boolean;
      audienciaData?: string | null;
      /**
       * Grau que praticou o ato (G1, G2, JE, TR). Null no histórico anterior ao
       * acompanhamento por instância — sem etiqueta, o item não mente sobre a
       * origem.
       */
      grau?: string | null;
      instanciaId?: string | null;
      /**
       * A PUBLICAÇÃO DO DJEN QUE DESCREVE ESTE MESMO ATO.
       *
       * O DataJud entrega o rótulo ("Expedição de documento"); o DJEN entrega o
       * TEOR. A correlação casa os dois no banco — este campo é o que traz esse
       * vínculo para a tela, para o andamento poder apontar onde está o texto.
       */
      publicacao?: {
        id: string;
        providencia: string | null;
        dataDisponibilizacao: string;
      } | null;
      /** Por que o robô NÃO abriu tarefa para este ato — ver `fraseSemTarefa`. */
      semTarefaMotivo?: string | null;
      /**
       * Já virou atividade na Agenda. Com ele, a tela leva direto à tarefa em
       * vez de oferecer de novo os botões que a criariam pela segunda vez.
       */
      compromissoId?: string | null;
      /**
       * Dispensa HUMANA ("Já cuidei") — colunas de gente, nunca do robô.
       * `dispensadoPor` é o id de quem clicou; a ficha usa para dizer "por você".
       */
      dispensadoEm?: string | null;
      dispensadoPor?: string | null;
      dispensadoMotivo?: string | null;
    }
  | {
      id: string;
      origem: 'INTERNA';
      /** Data que vale na timeline: a do FATO quando informada, senão a do registro. */
      data: string;
      /** Data do fato explícita (null = a movimentação vale pela data do registro). */
      dataFato: string | null;
      /** Carimbo de auditoria — exibido como "registrado em" quando difere do fato. */
      registradoEm: string;
      descricao: string;
      tipo: string;
      notaInterna: boolean;
      /** Anotação do próprio sistema, não de uma pessoa. Peso visual menor. */
      origemSistema: boolean;
      statusAnterior: StatusProcesso | null;
      statusNovo: StatusProcesso | null;
      autor: PessoaRef | null;
      anexo: AnexoRef | null;
    };

export interface AtendimentoOrigem {
  id: string;
  numero: number;
  canal: string;
  desfecho: string | null;
  createdAt: string;
  atendente: { id: string; nome: string; nomeExibicao: string | null };
}

export interface CompromissoDoProcesso {
  id: string;
  titulo: string;
  tipo: string;
  status: string;
  inicio: string;
  fim: string;
  local: string | null;
  urgente: boolean;
  descricao?: string | null;
  /** Gerado pelo robô de prazos (badge "Criado pelo Sistema"). */
  origemAutomatica?: boolean;
  /** O que aconteceu de fato — "CONCLUIDO" sozinho não informa nada. */
  desfecho?: string | null;
  desfechoObs?: string | null;
  concluidoEm?: string | null;
  canceladoCategoria?: string | null;
  canceladoMotivo?: string | null;
  responsavel: PessoaRef;
}

export interface RegistroAuditoria {
  id: string;
  acao: string;
  entidade: string | null;
  descricao: string | null;
  createdAt: string;
  metadata: unknown;
  user: { id: string; nome: string; nomeExibicao: string | null } | null;
}

export interface FiliadoDoProcesso {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  situacao: string;
  telefonePrincipal: string | null;
  email: string | null;
  formacao: string | null;
}

/**
 * Um grau do processo (1º, 2º, juizado, turma recursal).
 *
 * Um mesmo número de processo corre em mais de uma instância ao mesmo tempo —
 * apelação no 2º grau enquanto o cumprimento de sentença anda no 1º —, e cada
 * uma tem o próprio histórico de andamentos.
 */
export interface InstanciaProcesso {
  id: string;
  grau: string;
  tribunal: string;
  classeProcessual: string | null;
  orgaoJulgador: string | null;
  dataDistribuicao: string | null;
  ultimoMovimentoEm: string | null;
  /** Baixa definitiva ou trânsito em julgado, sem desarquivamento depois. */
  baixada: boolean;
  /** É a instância que responde pelo processo nas listas e nos filtros. */
  principal: boolean;
  ultimaSincronizacao: string | null;
  _count?: { movimentacoes: number };
}

/** Rótulo legível do grau. */
export const GRAU_LABEL: Record<string, string> = {
  G1: '1º grau',
  G2: '2º grau',
  G3: '3º grau',
  G4: '4º grau',
  JE: 'Juizado Especial',
  TR: 'Turma Recursal',
  TST: 'TST',
  STJ: 'STJ',
  STF: 'STF',
  SUP: 'Instância superior',
};

/**
 * Rótulo do grau. Recebendo o TRIBUNAL, ele vence na instância superior:
 * "TST" identifica muito melhor que "Instância superior", e é assim que o
 * advogado se refere ao recurso.
 */
export const rotuloGrau = (grau: string | null | undefined, tribunal?: string | null): string => {
  const g = (grau ?? '').toUpperCase();
  if (!g) return '';
  if (g === 'SUP' && tribunal) return tribunal.toUpperCase();
  return GRAU_LABEL[g] ?? grau ?? '';
};

/**
 * Versão curta do grau, para caber numa etiqueta de tabela ("1º", "2º", "TST").
 *
 * Mora junto de `GRAU_LABEL` de propósito: são a mesma informação em dois
 * tamanhos, e separá-las garantiria que um dia uma conheça um grau que a outra
 * não conhece.
 */
const GRAU_SIGLA: Record<string, string> = {
  G1: '1º', G2: '2º', G3: '3º', G4: '4º',
  JE: 'JE', TR: 'TR', TST: 'TST', STJ: 'STJ', STF: 'STF', SUP: 'SUP',
};

export const siglaGrau = (grau: string | null | undefined, tribunal?: string | null): string => {
  const g = (grau ?? '').toUpperCase();
  if (!g) return '—';
  if (g === 'SUP' && tribunal) return tribunal.toUpperCase();
  return GRAU_SIGLA[g] ?? g;
};

export interface DossieProcesso {
  /**
   * A CONTA PÚBLICA DO RÉU (22/09/2026) — quando a parte adversária é um ente
   * do IBGE e o Tesouro já foi consultado. Nulo na maioria: 52 dos 191
   * processos não arquivados têm réu público. Ver `conta-publica-do-reu`.
   */
  contaPublica?: ContaPublicaDoReu | null;
  id: string;
  numeroCNJ: string;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  tribunal: string | null;
  grau: string | null;
  dataDistribuicao: string | null;
  valorCausa: string | number | null;
  statusInterno: StatusProcesso;
  /**
   * Campos que a API SEMPRE devolveu — o dossiê monta a resposta com `include`,
   * que espalha todo escalar do processo — e que faltavam aqui. O tipo estava
   * mentindo: quem tentasse usá-los levava erro de compilação num dado que
   * chegava certinho no JSON.
   */
  titulo: string | null;
  categoria: string | null;
  filiadoId: string | null;
  /** INSTITUCIONAL = ação coletiva do sindicato (badge no cabeçalho). */
  tipoAcao?: TipoAcaoProcesso;
  ultimaSincronizacao: string | null;
  createdAt: string;
  /** Etiquetas internas da equipe (Urgente, Fase de Execução…). */
  etiquetas: string[];
  // ---- Metadados ricos do DataJud ----
  classeCodigo: number | null;
  assuntos: { codigo: number | null; nome: string | null; principal: boolean }[] | null;
  orgaoJulgadorCodigo: string | null;
  municipioIBGE: number | null;
  formato: string | null;
  sistema: string | null;
  nivelSigilo: number | null;
  segredoJustica: boolean;
  prioridades: string[] | null;
  atualizadoNoCnjEm: string | null;
  /** Partes como vieram do tribunal (sem criar rascunho de filiado). */
  partesBrutas: {
    nome: string | null;
    documento: string | null;
    polo: string | null;
    tipoPessoa: string | null;
    advogados?: { nome: string | null; oab: string | null }[];
  }[] | null;
  /** Filiado principal e advogado responsável (atalhos dos vínculos N:N). */
  filiado: FiliadoDoProcesso | null;
  advogado: PessoaRef | null;
  /** Partes do processo (fonte de verdade de quem processou quem). */
  partes: ParteDoProcesso[];
  /** Partes agrupadas por polo + o "Autor × Réu" pronto. */
  polos: PolosProcesso;
  /** Toda a equipe do processo. */
  advogados: AdvogadoDoProcesso[];
  /** Graus em que o processo corre — vazio no histórico anterior. */
  instancias: InstanciaProcesso[];
  linhaDoTempo: ItemTimeline[];
  /**
   * Atos recentes que pedem atenção e que AINDA não viraram atividade.
   * O robô de prazos já cria tarefa para o que reconhece; o que aparece aqui é
   * o que ele NÃO pegou — por isso é alerta, e não repetição da agenda.
   */
  atencao?: {
    total: number;
    nivel: 'URGENTE' | 'PRAZO' | 'DECISAO' | 'ENCERRAMENTO' | null;
    itens: { id: string; nivel: string; rotulo: string; data: string; descricao: string }[];
    /**
     * QUAIS andamentos pedem atenção — a lista inteira, não os cinco do resumo.
     * É por ela que a linha do tempo sabe em qual cartão oferecer "Virar tarefa"
     * e "Já cuidei". Quem decide continua sendo o servidor (`atoAcionavel`): no
     * dia em que o front decidir isso sozinho, o aviso da lista e o botão da
     * ficha voltam a discordar.
     */
    idsAcionaveis?: string[];
  };
  /** Por onde o processo passou — derivado dos andamentos, sem tabela nova. */
  historicoOrgaos?: { orgao: string; de: string; ate: string; atos: number }[];
  /**
   * Fase processual pela mesma regra da lista (`fase.util.ts` no back).
   * Sustenta o aviso de etiqueta conflitante na ficha.
   */
  fase?: FaseProcessual;
  /**
   * Quando o parser MULTI-INSTÂNCIA leu este processo. Nulo = ainda não foi
   * lido (processo anterior à funcionalidade), e a ficha pede a releitura ao
   * abrir — é o que faz as badges de grau aparecerem sem esperar a varredura
   * das 02:00.
   */
  instanciasLidasEm?: string | null;
  /**
   * Atos que encerraram (ou reabriram) o processo, em ordem cronológica.
   * É com isto que a ficha explica POR QUE está arquivado, em vez de só
   * afirmar que está.
   */
  /** Etiquetas mantidas pelo sistema (⚡) — derivadas, nunca gravadas. */
  etiquetasAutomaticas?: string[];
  marcosDoEncerramento?: {
    codigo: number;
    rotulo: string;
    data: string;
    /** Desarquivamento, liquidação e início de execução reabrem o ciclo. */
    reabre: boolean;
  }[];
  atendimentos: AtendimentoOrigem[];
  compromissos: CompromissoDoProcesso[];
  anexos: { id: string; nomeArquivo: string; url: string; tipoMime: string; tamanhoBytes: number | null; createdAt: string }[];
  auditoria: RegistroAuditoria[];
  totais: {
    datajud: number; internas: number; anexos: number; compromissos: number;
    partes: number; advogados: number; filiados: number;
  };
}

export async function getDossie(processoId: string): Promise<DossieProcesso> {
  return (await api.get(`/processos/${processoId}/dossie`)).data;
}

// ---------------------------------------------------------------------------
// Leitura dos complementos tabelados do CNJ
// ---------------------------------------------------------------------------

/**
 * O CNJ manda a chave do complemento em snake_case e sem acento
 * (`tipo_de_peticao`). Traduzimos as mais comuns e caímos num tratamento
 * genérico para as demais — assim nenhum complemento fica sem rótulo.
 */
const ROTULO_COMPLEMENTO: Record<string, string> = {
  tipo_de_peticao: 'Tipo de petição',
  tipo_de_documento: 'Tipo de documento',
  tipo_de_distribuicao_redistribuicao: 'Tipo de distribuição',
  motivo_da_remessa: 'Motivo da remessa',
  tipo_de_audiencia: 'Tipo de audiência',
  motivo_do_cancelamento: 'Motivo do cancelamento',
  tipo_de_decisao: 'Tipo de decisão',
  tipo_de_despacho: 'Tipo de despacho',
  natureza_da_conclusao: 'Natureza da conclusão',
  tipo_de_conclusao: 'Tipo de conclusão',
  motivo_da_suspensao: 'Motivo da suspensão',
  tipo_de_publicacao: 'Tipo de publicação',
  prazo: 'Prazo',
};

/**
 * Títulos que, sozinhos, não dizem nada ao advogado. Quando o movimento é um
 * destes, o complemento vira a informação principal (o "Acórdão" de
 * "Documento — Acórdão") em vez de ficar só como subtítulo.
 */
const TITULOS_GENERICOS = new Set([
  'documento', 'documentos', 'peticao', 'peticoes', 'expedicao de documento',
  'juntada', 'juntada de peticao', 'ato ordinatorio', 'andamento', 'outros',
  'outras decisoes', 'movimento', 'remessa', 'recebimento', 'ato',
]);

function semAcento(v: string): string {
  return v.normalize('NFD').replace(/[^\x00-\x7F]/g, '').toLowerCase().trim();
}

export function ehTituloGenerico(descricao: string | null | undefined): boolean {
  return TITULOS_GENERICOS.has(semAcento(descricao ?? ''));
}

/**
 * Escolhe o complemento que melhor qualifica o ato — prioriza as chaves
 * `tipo_de_*` (tipo de documento/petição/audiência), que são as que respondem
 * "que documento é esse?".
 */
export function complementoPrincipal(
  complementos: { descricao: string | null; nome: string | null }[] | null | undefined,
): { descricao: string | null; nome: string | null } | null {
  const lista = (complementos ?? []).filter((c) => c?.nome);
  if (!lista.length) return null;
  return lista.find((c) => (c.descricao ?? '').startsWith('tipo_de')) ?? lista[0];
}

export function rotuloComplemento(chave: string | null | undefined): string {
  if (!chave) return 'Detalhe';
  const conhecido = ROTULO_COMPLEMENTO[chave];
  if (conhecido) return conhecido;
  const texto = chave.replace(/_/g, ' ').trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Categoria semântica da movimentação a partir do código TPU do CNJ.
 * Serve para colorir e permitir bater o olho na linha do tempo — o CNJ não
 * manda categoria, só o código.
 */
export type CategoriaMovimento =
  | 'AUDIENCIA' | 'PUBLICACAO' | 'DECISAO' | 'DESPACHO' | 'PRAZO'
  | 'PROTOCOLO' | 'JULGAMENTO' | 'ANDAMENTO';

const CATEGORIA_POR_CODIGO: Record<number, CategoriaMovimento> = {
  // Audiências e sessões
  11025: 'AUDIENCIA', 12173: 'AUDIENCIA', 970: 'AUDIENCIA',
  // Publicação / intimação / comunicação
  // 1061 estava classificado como AUDIÊNCIA e é "Disponibilização no Diário da
  // Justiça Eletrônico" (conferido contra a API do CNJ) — mostrava etiqueta de
  // audiência numa publicação, que é o oposto do que o advogado precisa ler.
  1061: 'PUBLICACAO',
  92: 'PUBLICACAO', 60: 'PUBLICACAO', 12265: 'PUBLICACAO', 581: 'PUBLICACAO',
  // Decisões e sentenças
  193: 'DECISAO', 219: 'DECISAO', 385: 'DECISAO', 11009: 'DECISAO',
  455: 'JULGAMENTO', 848: 'JULGAMENTO', 246: 'JULGAMENTO', 22: 'JULGAMENTO',
  // Despachos
  11010: 'DESPACHO', 51: 'DESPACHO',
  // Prazos
  1051: 'PRAZO', 861: 'PRAZO',
  // Protocolo / distribuição / petição
  26: 'PROTOCOLO', 85: 'PROTOCOLO', 118: 'PROTOCOLO',
};

export const CATEGORIA_LABEL: Record<CategoriaMovimento, string> = {
  AUDIENCIA: 'Audiência',
  PUBLICACAO: 'Publicação / Intimação',
  DECISAO: 'Decisão',
  DESPACHO: 'Despacho',
  PRAZO: 'Prazo',
  PROTOCOLO: 'Protocolo',
  JULGAMENTO: 'Julgamento',
  ANDAMENTO: 'Andamento',
};

/** Chave de cor da categoria (usa a paleta compartilhada). */
export const CATEGORIA_COR: Record<CategoriaMovimento, string> = {
  AUDIENCIA: 'purple',
  PUBLICACAO: 'sky',
  DECISAO: 'emerald',
  DESPACHO: 'teal',
  PRAZO: 'amber',
  PROTOCOLO: 'blue',
  JULGAMENTO: 'indigo',
  ANDAMENTO: 'slate',
};

export function categoriaMovimento(
  codigo: number | null | undefined,
  descricao?: string | null,
): CategoriaMovimento {
  if (codigo != null && CATEGORIA_POR_CODIGO[codigo]) return CATEGORIA_POR_CODIGO[codigo];
  // Sem código conhecido, cai no texto (cobre tribunais que variam os códigos).
  const t = (descricao ?? '').toLowerCase();
  if (/audi[êe]ncia|sess[ãa]o/.test(t)) return 'AUDIENCIA';
  if (/public|intima|diário|diario|comunica/.test(t)) return 'PUBLICACAO';
  if (/senten[çc]a|decis[ãa]o|ac[óo]rd[ãa]o/.test(t)) return 'DECISAO';
  if (/despacho/.test(t)) return 'DESPACHO';
  if (/prazo/.test(t)) return 'PRAZO';
  if (/peti[çc][ãa]o|protocol|distribu/.test(t)) return 'PROTOCOLO';
  if (/julgamento|tr[âa]nsito|baixa/.test(t)) return 'JULGAMENTO';
  return 'ANDAMENTO';
}

// ---------------------------------------------------------------------------
// Movimentações internas
// ---------------------------------------------------------------------------

export interface RegistrarMovimentacaoInput {
  tipo: string;
  descricao: string;
  /** ISO. Quando o ato aconteceu, se diferente de hoje. */
  dataFato?: string;
  notaInterna?: boolean;
  novoStatus?: StatusProcesso;
  anexoId?: string;
}
export async function registrarMovimentacao(processoId: string, dto: RegistrarMovimentacaoInput) {
  return (await api.post(`/processos/${processoId}/movimentacoes`, dto)).data;
}
export async function excluirMovimentacao(movId: string): Promise<{ ok: boolean }> {
  return (await api.delete(`/processos/movimentacoes/${movId}`)).data;
}

// ---------------------------------------------------------------------------
// As duas mãos do advogado sobre o andamento do tribunal (17/09/2026)
// ---------------------------------------------------------------------------

/**
 * "VIRAR TAREFA" — o andamento vira atividade na Agenda, com a mesma regra do
 * Diário. O dono é quem clicou. Idempotente: o segundo toque devolve a mesma
 * atividade (`criada: false`), em vez de criar a segunda.
 */
export async function virarTarefaDoAndamento(
  movId: string,
): Promise<{ compromissoId: string; criada: boolean; titulo?: string }> {
  return (await api.post(`/processos/movimentacoes/${movId}/tarefa`)).data;
}

/**
 * "JÁ CUIDEI" — dispensa humana do aviso. Não apaga o andamento: o ato do
 * tribunal continua inteiro na linha do tempo, só deixa de pedir atenção.
 */
export async function jaCuideiDoAndamento(
  movId: string,
  motivo?: string,
): Promise<{ ok: boolean; dispensado: boolean }> {
  return (await api.post(`/processos/movimentacoes/${movId}/ja-cuidei`, {
    motivo: motivo?.trim() || undefined,
  })).data;
}

/**
 * DESFAZ o "já cuidei" — o par que o radar de audiências sempre teve.
 *
 * Sem ele, o toque errado no celular apagava o selo de atenção sem volta: a
 * faixa verde substitui os dois botões, e o cartão deixa de pedir olho.
 */
export async function desfazerJaCuideiDoAndamento(
  movId: string,
): Promise<{ ok: boolean; dispensado: boolean }> {
  return (await api.post(`/processos/movimentacoes/${movId}/desfazer-ja-cuidei`)).data;
}

// ---------------------------------------------------------------------------
// Consulta pública do tribunal
// ---------------------------------------------------------------------------

/**
 * Link para a consulta pública do processo no site do tribunal.
 *
 * POR QUE NÃO É UM LINK DIRETO PARA O PROCESSO
 * Cada tribunal tem o próprio endereço, e os que usam PJe exigem sessão ou
 * captcha para abrir um processo específico — um "link direto" montado por nós
 * levaria o advogado a uma tela de erro na metade dos casos. O que funciona
 * sempre é abrir a CONSULTA do tribunal certo e colar o número, que é o que
 * este atalho faz (o número vai para a área de transferência junto).
 *
 * Tribunais fora da lista caem no portal do CNJ, que encaminha para o tribunal
 * correto a partir do número — pior que o atalho direto, melhor que nada.
 */
const CONSULTA_POR_TRIBUNAL: Record<string, string> = {
  // Justiça do Trabalho — PJe, mesma estrutura em todos os TRTs.
  TRT22: 'https://pje.trt22.jus.br/consultaprocessual/',
  // Justiça Estadual do Piauí — consulta pública do PJe de 1º grau.
  TJPI: 'https://pje.tjpi.jus.br/1g/ConsultaPublica/listView.seam',
};

const CONSULTA_PADRAO = 'https://www.cnj.jus.br/consultas-publicas-processuais/';

export function urlConsultaTribunal(tribunal: string | null | undefined): string {
  const sigla = (tribunal ?? '').trim().toUpperCase();
  if (CONSULTA_POR_TRIBUNAL[sigla]) return CONSULTA_POR_TRIBUNAL[sigla];
  // Todo TRT usa PJe no mesmo caminho; vale a generalização.
  const trt = /^TRT(\d{1,2})$/.exec(sigla);
  if (trt) return `https://pje.trt${trt[1]}.jus.br/consultaprocessual/`;
  return CONSULTA_PADRAO;
}

/**
 * Rótulo e cor do nível de atenção (espelha `NIVEL_ATENCAO_LABEL` no back).
 *
 * Só APARÊNCIA. Quem decide se um ato ainda pede providência é `atoAcionavel`,
 * no servidor — o front nunca reimplementa a regra, porque um dicionário
 * espelhado envelhece só de um lado, e foi assim que a lista passou meses
 * mostrando prazos que a ficha do mesmo processo não mostrava.
 *
 * `URGENTE` entrou com a antecipação de tutela: é o único nível que muda o que
 * se pode fazer HOJE, e por isso é o único em vermelho. Se um dia houver dois
 * níveis vermelhos, nenhum será vermelho de verdade.
 */
export const ATENCAO_LABEL: Record<string, string> = {
  URGENTE: 'Ação imediata',
  PRAZO: 'Prazo em curso',
  DECISAO: 'Decisão a analisar',
  ENCERRAMENTO: 'Mudança de fase',
};
export const ATENCAO_COR: Record<string, string> = {
  URGENTE: 'red',
  PRAZO: 'amber',
  DECISAO: 'sky',
  ENCERRAMENTO: 'slate',
};

/**
 * POR QUE ESTE ANDAMENTO NÃO VIROU TAREFA (17/09/2026).
 *
 * O robô passou a não abrir tarefa para andamento que chega do tribunal depois
 * de qualquer prazo ordinário — eram 36 de 48 "Verificação de Intimação /
 * Prazo" nascendo com "o prazo, se havia, já correu". A decisão fica gravada na
 * movimentação, e a tela precisa dizê-la: silêncio na agenda, sem explicação,
 * é o que faz a equipe desconfiar de tudo que o robô cria.
 */
const MOTIVO_SEM_TAREFA: Record<string, string> = {
  // Vocabulário de algumas horas em 17/09/2026, antes das colunas próprias do
  // robô. A migração move o que houver, mas a chave continua entendida aqui:
  // registro histórico não se reescreve.
  ANDAMENTO_ANTIGO_SEM_TEOR:
    'O robô não abriu tarefa: o tribunal informou este ato depois de qualquer prazo ordinário.',
  /*
    OS TRÊS MOTIVOS DO ROBÔ, agora em colunas próprias dele (`avaliado*`).

    Eles substituem o carimbo que por algumas horas foi parar nas colunas de
    dispensa HUMANA — e apagaria o selo âmbar do andamento sem que ninguém
    tivesse decidido nada. O motivo continua aparecendo aqui porque silêncio sem
    explicação foi a desconfiança relatada; o que mudou é que agora, ao lado da
    explicação, há o que fazer: "Virar tarefa" ou "Já cuidei".
  */
  /*
    A FRASE EXPLICA; QUEM CONVIDA É O BOTÃO (17/09/2026).

    Estas frases mandavam "use Virar tarefa" — e o botão só existe no cartão que
    ainda pede atenção, para quem tem edição na Agenda. Ato de código fora do
    dicionário, ato com mais de 30 dias, Triagem só com leitura: todos liam a
    ordem sem nunca ver o botão, e tela que manda apertar o que não existe é a
    mesma desconfiança por outro caminho. O convite agora mora ao lado das mãos.
  */
  SEM_TEOR_NO_DATAJUD:
    'O robô não abriu tarefa: o tribunal avisou que houve um ato, mas não disse o que ele pede — e sem isso qualquer prazo seria chute.',
  ANDAMENTO_ANTIGO:
    'O robô não abriu tarefa: o tribunal informou este ato depois de qualquer prazo ordinário.',
  TEOR_NO_DIARIO:
    'O robô não abriu tarefa por aqui: o teor deste mesmo ato chegou pelo Diário, e é lá que a providência foi decidida.',
};

/**
 * MOTIVO QUE TEM PARA ONDE APONTAR.
 *
 * "O teor chegou pelo Diário" sem o caminho até ele é uma frase que manda
 * procurar: a pessoa teria de trocar de aba e comparar datas no olho para achar
 * a publicação certa. O andamento já sabe qual é — a frase leva junto o atalho
 * que esta ficha usa desde 12/09 ("Ver teor no DJEN").
 */
const MOTIVOS_QUE_LEVAM_AO_TEOR = new Set(['TEOR_NO_DIARIO']);

export function motivoLevaAoTeor(motivo?: string | null): boolean {
  return !!motivo && MOTIVOS_QUE_LEVAM_AO_TEOR.has(motivo);
}

export function fraseSemTarefa(motivo?: string | null): string | null {
  if (!motivo) return null;
  // Motivo novo (ou de outra automação) não pode virar código na tela.
  return MOTIVO_SEM_TAREFA[motivo] ?? null;
}

/**
 * A FRASE DA DISPENSA DE GENTE — e ela nomeia quem decidiu.
 *
 * "Já cuidei" sem autor na tela seria o mesmo silêncio de antes, com outra
 * roupa: quem abre a ficha depois precisa saber se aquele ato foi resolvido por
 * alguém ou se o sistema resolveu sozinho. Quem clicou lê "por você"; os
 * demais leem a data e o motivo, quando houver.
 */
export function fraseJaCuidei(
  item: { dispensadoEm?: string | null; dispensadoPor?: string | null; dispensadoMotivo?: string | null },
  usuarioId?: string | null,
): string | null {
  if (!item.dispensadoEm || !item.dispensadoPor) return null;
  const quem = usuarioId && item.dispensadoPor === usuarioId ? 'por você' : 'pela equipe';
  // A data sai pelo mesmo formatador do resto da ficha — uma régua só.
  const dia = formatData(item.dispensadoEm);
  const motivo = item.dispensadoMotivo?.trim();
  return `Marcado como já cuidado ${quem} em ${dia}${motivo ? ` — ${motivo}` : ''}.`;
}
