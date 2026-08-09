import { api } from './api';
import type { ItemAcervo } from './anexos';
import type { FormacaoProfissional, SituacaoFiliado, Vinculo } from './filiados';

/**
 * DOSSIÊ DO FILIADO — o histórico do associado consolidado (GET /filiados/:id/dossie).
 *
 * Responde no balcão a pergunta de sempre: "esse filiado já veio aqui antes, por
 * quê, e em que pé ficou?" — sem abrir Triagem, Agenda, Processos e Cobranças
 * uma a uma.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ResumoAtendimentos {
  total: number;
  pendentes: number;
  concluidos: number;
  cancelados: number;
  resolvidosNoAto: number;
  encaminhados: number;
  semDesfecho: number;
  porCanal: Record<string, number>;
  primeiroEm: string | null;
  ultimoEm: string | null;
}

export interface ResumoAtividades {
  total: number;
  pendentes: number;
  emAndamento: number;
  concluidas: number;
  canceladas: number;
  ultimaEm: string | null;
  proxima: { id: string; titulo: string; tipo: string; inicio: string } | null;
}

export interface ResumoProcessos {
  total: number;
  ativos: number;
  rascunhos: number;
  encerrados: number;
  porStatus: Record<string, number>;
}

export interface ResumoFinanceiro {
  parcelasPagas: number;
  valorPago: number;
  parcelasAbertas: number;
  valorAberto: number;
  parcelasVencidas: number;
  valorVencido: number;
  inadimplente: boolean;
}

export interface ResumoDossie {
  atendimentos: ResumoAtendimentos;
  atividades: ResumoAtividades;
  processos: ResumoProcessos;
  financeiro: ResumoFinanceiro;
  documentos: { total: number };
  dependentes: number;
  eventos: { presencas: number; ultimoEm: string | null };
  colonia: { reservas: number; ultimaTemporada: string | null };
  recadastramentos: { total: number; ultimoEm: string | null };
  relacionamento: { desde: string; ultimoContatoEm: string | null };
}

export interface AtendimentoDossie {
  id: string;
  numero: number;
  canal: string;
  status: string;
  desfecho: string | null;
  tipoEncaminhamento: string | null;
  descricao: string;
  desfechoObs: string | null;
  desfechoEm: string | null;
  responsavel: string | null;
  createdAt: string;
  atendente: { id: string; nome: string; nomeExibicao: string | null };
  processo: { id: string; numeroCNJ: string | null; titulo: string | null } | null;
  _count: { anexos: number; compromissos: number };
}

export interface AtividadeDossie {
  id: string;
  titulo: string;
  tipo: string;
  status: string;
  inicio: string;
  fim: string;
  local: string | null;
  urgente: boolean;
  desfecho: string | null;
  desfechoObs: string | null;
  concluidoEm: string | null;
  canceladoCategoria: string | null;
  canceladoMotivo: string | null;
  remarcacoes: number;
  responsavel: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null };
  atendimento: { id: string; numero: number } | null;
  processo: { id: string; numeroCNJ: string | null; titulo: string | null } | null;
}

export interface ProcessoDossie {
  id: string;
  numeroCNJ: string | null;
  titulo: string | null;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  tribunal: string | null;
  statusInterno: string;
  valorCausa: number | null;
  dataDistribuicao: string | null;
  etiquetas: string[];
  createdAt: string;
  updatedAt: string;
  advogado: { id: string; nome: string; nomeExibicao: string | null } | null;
  _count: { movimentacoes: number; anexos: number };
}

export interface ParcelaDossie {
  id: string;
  numero: number;
  valor: number;
  status: string;
  dataVencimento: string;
  dataPagamento: string | null;
  valorPago: number | null;
}

export interface CobrancaDossie {
  id: string;
  tipo: string;
  descricao: string | null;
  valorTotal: number;
  createdAt: string;
  parcelas: ParcelaDossie[];
}

export interface EventoDossie {
  id: string;
  registradoEm: string;
  evento: { id: string; nome: string; dataInicio: string; local: string | null; tipo: string } | null;
}

export type TipoFatoDossie =
  | 'FILIACAO' | 'ATENDIMENTO' | 'ATIVIDADE' | 'PROCESSO'
  | 'COBRANCA' | 'EVENTO' | 'RECADASTRAMENTO' | 'CADASTRO';

export interface FatoDossie {
  tipo: TipoFatoDossie;
  data: string;
  titulo: string;
  detalhe: string | null;
  situacao: string | null;
  refId: string | null;
}

export interface Dossie {
  filiado: {
    id: string;
    matricula: string;
    nomeCompleto: string;
    cpf: string | null;
    situacao: SituacaoFiliado;
    formacao: FormacaoProfissional | null;
    formacaoOutro: string | null;
    numeroCoren: string | null;
    dataNascimento: string | null;
    telefonePrincipal: string | null;
    telefoneSecundario: string | null;
    email: string | null;
    cidade: string | null;
    estado: string | null;
    bairro: string | null;
    endereco: string | null;
    numero: string | null;
    createdAt: string;
    aprovadoEm: string | null;
    dataAdmissao: string | null;
    fotoUrl: string | null;
    vinculos: Vinculo[];
  };
  resumo: ResumoDossie;
  atendimentos: AtendimentoDossie[];
  atividades: AtividadeDossie[];
  processos: ProcessoDossie[];
  cobrancas: CobrancaDossie[];
  eventos: EventoDossie[];
  documentos: ItemAcervo[];
  linhaDoTempo: FatoDossie[];
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

export const FATO_LABEL: Record<TipoFatoDossie, string> = {
  FILIACAO: 'Filiação',
  ATENDIMENTO: 'Triagem',
  ATIVIDADE: 'Agenda',
  PROCESSO: 'Processo',
  COBRANCA: 'Cobrança',
  EVENTO: 'Evento',
  RECADASTRAMENTO: 'Recadastramento',
  CADASTRO: 'Cadastro',
};

export const FATO_COR: Record<TipoFatoDossie, string> = {
  FILIACAO: 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300',
  ATENDIMENTO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  ATIVIDADE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  PROCESSO: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  COBRANCA: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  EVENTO: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  RECADASTRAMENTO: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  CADASTRO: 'bg-muted text-muted-foreground',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function moeda(valor: number | null | undefined): string {
  return (valor ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function dataHoraBr(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function dataBr(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** "há 3 meses" / "em 5 dias" — a leitura rápida de quando foi a última vez. */
export function desde(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dias = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias === -1) return 'amanhã';
  if (dias < 0) return `em ${Math.abs(dias)} dias`;
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  const anos = Math.floor(meses / 12);
  return `há ${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function getDossie(filiadoId: string): Promise<Dossie> {
  return (await api.get(`/filiados/${filiadoId}/dossie`)).data;
}
