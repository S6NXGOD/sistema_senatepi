import { api } from './api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type CanalAtendimento = 'PRESENCIAL' | 'WHATSAPP' | 'TELEFONE' | 'EMAIL' | 'SITE';
export type DesfechoAtendimento = 'RESOLVIDO_ATO' | 'ENCAMINHADO';
export type SetorAtendimento = 'JURIDICO' | 'FINANCEIRO' | 'SECRETARIA' | 'DIRETORIA' | 'COLONIA' | 'OUTRO';

export interface FiliadoLista {
  id: string;
  nomeCompleto: string;
  matricula: string;
  telefonePrincipal: string | null;
}

export interface Atendente {
  id: string;
  nome: string;
}

export interface AtendimentoLista {
  id: string;
  canal: CanalAtendimento;
  desfecho: DesfechoAtendimento;
  setor: SetorAtendimento | null;
  responsavel: string | null;
  descricao: string;
  createdAt: string;
  filiado: FiliadoLista;
  atendente: Atendente;
}

export interface PaginaAtendimentos {
  items: AtendimentoLista[];
  total: number;
  page: number;
  pageSize: number;
  totalPaginas: number;
}

/** Filiado com dados de contato (dossiê / atualização cadastral). */
export interface FiliadoDossie {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  situacao: string;
  telefonePrincipal: string | null;
  telefoneSecundario: string | null;
  email: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
}

export interface AtendimentoDossie {
  atendimento: {
    id: string;
    canal: CanalAtendimento;
    desfecho: DesfechoAtendimento;
    setor: SetorAtendimento | null;
    responsavel: string | null;
    descricao: string;
    createdAt: string;
    atendente: Atendente;
    filiado: FiliadoDossie;
  };
  historico: {
    id: string;
    canal: CanalAtendimento;
    desfecho: DesfechoAtendimento;
    setor: SetorAtendimento | null;
    descricao: string;
    createdAt: string;
    atendente: { nome: string };
  }[];
}

// ---------------------------------------------------------------------------
// Rótulos e cores
// ---------------------------------------------------------------------------

export const CANAL_LABEL: Record<CanalAtendimento, string> = {
  PRESENCIAL: 'Presencial',
  WHATSAPP: 'WhatsApp',
  TELEFONE: 'Telefone',
  EMAIL: 'E-mail',
  SITE: 'Site',
};
export const CANAIS = Object.keys(CANAL_LABEL) as CanalAtendimento[];

export const CANAL_COR: Record<CanalAtendimento, string> = {
  PRESENCIAL: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  WHATSAPP: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  TELEFONE: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  EMAIL: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  SITE: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

export const DESFECHO_LABEL: Record<DesfechoAtendimento, string> = {
  RESOLVIDO_ATO: 'Resolvido no ato',
  ENCAMINHADO: 'Encaminhado',
};

export const DESFECHO_COR: Record<DesfechoAtendimento, string> = {
  RESOLVIDO_ATO: 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
  ENCAMINHADO: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export const SETOR_LABEL: Record<SetorAtendimento, string> = {
  JURIDICO: 'Jurídico',
  FINANCEIRO: 'Financeiro',
  SECRETARIA: 'Secretaria',
  DIRETORIA: 'Diretoria',
  COLONIA: 'Colônia de Férias',
  OUTRO: 'Outro',
};
export const SETORES = Object.keys(SETOR_LABEL) as SetorAtendimento[];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** URL wa.me com DDI 55 + mensagem codificada. Null se telefone inválido. */
export function linkWhatsApp(telefone: string | null | undefined, mensagem: string): string | null {
  const d = (telefone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const comDDI = d.startsWith('55') ? d : `55${d}`;
  return `https://wa.me/${comDDI}?text=${encodeURIComponent(mensagem)}`;
}

/** Saudação de WhatsApp referenciando o atendimento. */
export function mensagemSaudacao(p: { nome: string; data: string }): string {
  const primeiro = p.nome.trim().split(/\s+/)[0] || p.nome;
  const quando = new Date(p.data).toLocaleDateString('pt-BR');
  return (
    `Olá, ${primeiro}! 👋 Aqui é do *SENATEPI*.\n\n` +
    `Estamos entrando em contato a respeito do seu atendimento registrado em ${quando}. ` +
    `Como podemos te ajudar?`
  );
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface CriarAtendimentoInput {
  filiadoId: string;
  canal: CanalAtendimento;
  descricao: string;
  desfecho: DesfechoAtendimento;
  setor?: SetorAtendimento;
  responsavel?: string;
}
export async function criarAtendimento(dto: CriarAtendimentoInput) {
  return (await api.post('/atendimentos', dto)).data;
}

export interface FiltroAtendimentos {
  busca?: string;
  desfecho?: DesfechoAtendimento;
  canal?: CanalAtendimento;
  dataInicio?: string;
  dataFim?: string;
  page?: number;
  pageSize?: number;
}
export async function listarAtendimentos(filtro: FiltroAtendimentos = {}): Promise<PaginaAtendimentos> {
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(filtro)) if (v) params[k] = String(v);
  return (await api.get('/atendimentos', { params })).data;
}

export async function getAtendimento(id: string): Promise<AtendimentoDossie> {
  return (await api.get(`/atendimentos/${id}`)).data;
}

/** Atualização cadastral de contato do filiado (reusa o PATCH de filiados). */
export interface ContatoFiliado {
  telefonePrincipal?: string | null;
  telefoneSecundario?: string | null;
  email?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
}
export async function atualizarContatoFiliado(filiadoId: string, dados: ContatoFiliado) {
  return (await api.patch(`/filiados/${filiadoId}`, dados)).data;
}
