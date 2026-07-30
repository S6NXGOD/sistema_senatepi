import { api } from './api';
import type { PerfilUsuario } from './permissoes';
import type { CanalAtendimento, DesfechoAtendimento } from './atendimentos';

// ---------------------------------------------------------------------------
// Tipos do payload consolidado de /dashboard/resumo
// ---------------------------------------------------------------------------

/** Slug de um tipo de evento cadastrável (ver lib/agenda). */
export type TipoCompromisso = string;
export type StatusCompromisso = 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO';

export interface PessoaResumo {
  id: string;
  nome: string;
  nomeExibicao?: string | null;
  avatarUrl?: string | null;
}

export interface CompromissoCard {
  id: string;
  titulo: string;
  tipo: TipoCompromisso;
  status: StatusCompromisso;
  inicio: string;
  fim: string;
  local: string | null;
  urgente: boolean;
  iniciadoEm: string | null;
  responsavel: PessoaResumo;
  filiado: { id: string; nomeCompleto: string } | null;
  processo: { id: string; numeroCNJ: string } | null;
}

export interface AtendimentoPendente {
  id: string;
  numero: number;
  canal: CanalAtendimento;
  desfecho: DesfechoAtendimento | null;
  createdAt: string;
  filiado: { id: string; nomeCompleto: string };
}

export interface MovimentacaoRecente {
  id: string;
  descricao: string;
  dataMovimento: string;
  processo: { id: string; numeroCNJ: string; filiado: { nomeCompleto: string } | null };
}

export interface PlantaoItem {
  id: string;
  horaInicio: string;
  horaFim: string;
  advogado: PessoaResumo;
}

export interface ResumoDashboard {
  papel: PerfilUsuario;
  escopo: 'PESSOAL' | 'GLOBAL';
  kpis: {
    processosAtivos: number;
    atendimentosPendentes: number;
    prazosSemana: number;
    filiadosAtivos: number;
    filiadosTotal: number;
    novosFiliadosMes: number;
  };
  minhaCarteira: {
    meusProcessos: number;
    minhasAudiencias: number;
    atrasadas: number;
    urgentes: number;
  } | null;
  alertas: { atrasadas: number; semMovimentacao: number; urgentes: number };
  atividadesHoje: CompromissoCard[];
  audienciasSemana: CompromissoCard[];
  pendenciasAtivas: CompromissoCard[];
  atendimentosPendentes: AtendimentoPendente[];
  movimentacoesRecentes: MovimentacaoRecente[];
  equipeHoje: {
    plantaoHoje: PlantaoItem[];
    proximoPlantao: { data: string; advogados: PessoaResumo[] } | null;
  };
  graficos: {
    atendimentosPorCanal: { canal: CanalAtendimento; total: number }[];
    atendimentos14dias: { dia: string; total: number }[];
    crescimentoFiliados: { mes: string; total: number }[];
  };
}

export async function getResumoDashboard(): Promise<ResumoDashboard> {
  return (await api.get<ResumoDashboard>('/dashboard/resumo')).data;
}

// ---------------------------------------------------------------------------
// Rótulos, cores e helpers de exibição
// ---------------------------------------------------------------------------

export const TIPO_COMP_LABEL: Record<TipoCompromisso, string> = {
  CONSULTA_JURIDICA: 'Consulta Jurídica',
  AUDIENCIA: 'Audiência',
  PRAZO: 'Prazo',
  REUNIAO: 'Reunião',
  DILIGENCIA: 'Diligência',
  DESPACHO: 'Despacho',
  PERICIA: 'Perícia',
  COMPROMISSO: 'Compromisso',
};

/** Cor da barra lateral do card por tipo. */
export const TIPO_COMP_COR: Record<TipoCompromisso, string> = {
  CONSULTA_JURIDICA: 'bg-emerald-500',
  AUDIENCIA: 'bg-violet-500',
  PRAZO: 'bg-rose-500',
  REUNIAO: 'bg-sky-500',
  DILIGENCIA: 'bg-amber-500',
  DESPACHO: 'bg-indigo-500',
  PERICIA: 'bg-teal-500',
  COMPROMISSO: 'bg-slate-400',
};

export const STATUS_COMP_LABEL: Record<StatusCompromisso, string> = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};

export const STATUS_COMP_COR: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  EM_ANDAMENTO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  CONCLUIDO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  CANCELADO: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 line-through',
};

export const PALETA_CANAL = ['#1B7F0A', '#4FA11B', '#0ea5e9', '#f59e0b', '#8b5cf6'];

/** Saudação pela hora local. */
export function saudacao(nome: string): string {
  const h = new Date().getHours();
  const prefixo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiro = nome?.trim().split(/\s+/)[0] ?? '';
  return `${prefixo}, ${primeiro}`;
}

/** "Quarta-feira, 29 de julho" (só a inicial em maiúscula). */
export function dataPorExtenso(d = new Date()): string {
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "há 2h 49m" / "há 3d 5h" a partir de uma data no passado (ou "em ..." no futuro). */
export function tempoRelativo(iso: string): string {
  const alvo = new Date(iso).getTime();
  const diff = Date.now() - alvo;
  const futuro = diff < 0;
  const abs = Math.abs(diff);
  const min = Math.floor(abs / 60000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  let texto: string;
  if (d >= 1) texto = `${d}d ${h % 24}h`;
  else if (h >= 1) texto = `${h}h ${min % 60}m`;
  else texto = `${min}m`;
  return futuro ? `em ${texto}` : `há ${texto}`;
}

/** Hora curta "16:30". */
export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function primeiroNome(p: PessoaResumo): string {
  return p.nomeExibicao || p.nome;
}
