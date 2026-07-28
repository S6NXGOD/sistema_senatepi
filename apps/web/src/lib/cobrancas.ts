import { api } from './api';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TipoCobranca =
  | 'MENSALIDADE'
  | 'ANUIDADE'
  | 'ACORDO'
  | 'TAXA'
  | 'CONTRIBUICAO'
  | 'OUTRO';

export type StatusParcela = 'PENDENTE' | 'PAGO' | 'VENCIDO' | 'CANCELADO';

/** Valor pode chegar como string (Prisma.Decimal) ou number. */
export type Dinheiro = number | string;

export interface FiliadoResumo {
  id: string;
  nomeCompleto: string;
  matricula: string;
  telefonePrincipal?: string | null;
}

export interface Parcela {
  id: string;
  numero: number;
  valor: Dinheiro;
  dataCompetencia: string;
  dataVencimento: string;
  status: StatusParcela;
  dataPagamento: string | null;
  cobrancaId: string;
  tipo: TipoCobranca;
  filiado: FiliadoResumo;
}

/** Parcela simulada (ainda não persistida) devolvida por /simular. */
export interface ParcelaSimulada {
  numero: number;
  dataCompetencia: string; // YYYY-MM-DD
  dataVencimento: string; // YYYY-MM-DD
  valor: number;
  status: StatusParcela;
}

export interface Simulacao {
  tipo: TipoCobranca;
  quantidadeParcelas: number;
  valorTotal: number;
  parcelas: ParcelaSimulada[];
}

export interface ResumoFinanceiro {
  qtdParcelas: number;
  qtdPago: number;
  qtdPendente: number;
  qtdVencido: number;
  qtdCancelado: number;
  totalPago: number;
  totalEmAberto: number;
  totalVencido: number;
}

export interface CobrancaHistorico {
  id: string;
  tipo: TipoCobranca;
  descricao: string | null;
  valorTotal: Dinheiro;
  createdAt: string;
  parcelas: {
    id: string;
    numero: number;
    dataCompetencia: string;
    dataVencimento: string;
    valor: Dinheiro;
    status: StatusParcela;
    dataPagamento: string | null;
  }[];
}

export interface HistoricoFiliado {
  filiado: { id: string; nomeCompleto: string; matricula: string };
  cobrancas: CobrancaHistorico[];
  resumo: ResumoFinanceiro;
}

export interface PixParcela {
  parcelaId: string;
  numero: number;
  valor: number;
  identificador: string;
  copiaECola: string;
  qrDataUrl: string;
}

export interface ConfiguracaoSindicato {
  id?: string;
  logoUrl?: string | null;
  assinaturaPresidenteUrl?: string | null;
  textoRodapeCarne?: string | null;
  pixChave?: string | null;
  pixNomeRecebedor?: string | null;
  pixCidade?: string | null;
}

// ---------------------------------------------------------------------------
// Rótulos e cores
// ---------------------------------------------------------------------------

export const TIPO_LABEL: Record<TipoCobranca, string> = {
  MENSALIDADE: 'Mensalidade',
  ANUIDADE: 'Anuidade',
  ACORDO: 'Acordo',
  TAXA: 'Taxa',
  CONTRIBUICAO: 'Contribuição',
  OUTRO: 'Outro',
};
export const TIPOS = Object.keys(TIPO_LABEL) as TipoCobranca[];

export const STATUS_LABEL: Record<StatusParcela, string> = {
  PENDENTE: 'A vencer',
  PAGO: 'Pago',
  VENCIDO: 'Vencida',
  CANCELADO: 'Cancelada',
};

export const STATUS_COR: Record<StatusParcela, string> = {
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  PAGO: 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/30 dark:text-senatepi-400',
  VENCIDO: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CANCELADO: 'bg-muted text-muted-foreground',
};

// ---------------------------------------------------------------------------
// Helpers de formatação / negócio
// ---------------------------------------------------------------------------

export function formatBRL(v: Dinheiro): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** "2026-08-10" | ISO → "10/08/2026" (sem deslocar por fuso). */
export function formatData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Situação para exibição: deriva "VENCIDA" quando a parcela está pendente e o
 * vencimento já passou (o back guarda PENDENTE; a virada é só visual/relatório).
 */
export function statusExibicao(p: { status: StatusParcela; dataVencimento: string }): StatusParcela {
  if (p.status === 'PENDENTE') {
    const hoje = new Date().toISOString().slice(0, 10);
    if (p.dataVencimento.slice(0, 10) < hoje) return 'VENCIDO';
  }
  return p.status;
}

/** Monta a URL wa.me com DDI 55 e a mensagem já codificada. */
export function linkWhatsApp(telefone: string | null | undefined, mensagem: string): string | null {
  const d = (telefone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const comDDI = d.startsWith('55') ? d : `55${d}`;
  return `https://wa.me/${comDDI}?text=${encodeURIComponent(mensagem)}`;
}

/** Mensagem amigável de cobrança (com PIX Copia e Cola, quando disponível). */
export function mensagemCobranca(p: {
  nome: string;
  vencimento: string;
  valor: Dinheiro;
  copiaECola?: string;
}): string {
  const primeiroNome = p.nome.trim().split(/\s+/)[0] || p.nome;
  let msg =
    `Olá, ${primeiroNome}! 👋\n\n` +
    `Aqui é do *SENATEPI*. Passando para lembrar da sua parcela com vencimento em ` +
    `*${formatData(p.vencimento)}*, no valor de *${formatBRL(p.valor)}*.`;
  if (p.copiaECola) {
    msg +=
      `\n\nVocê pode pagar agora pelo *PIX Copia e Cola* abaixo:\n\n` +
      `${p.copiaECola}`;
  }
  msg += `\n\nQualquer dúvida, estamos à disposição. Obrigado! 🙏`;
  return msg;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function getConfig(): Promise<ConfiguracaoSindicato | null> {
  return (await api.get('/cobrancas/config')).data;
}

export async function salvarConfig(dto: ConfiguracaoSindicato): Promise<ConfiguracaoSindicato> {
  return (await api.put('/cobrancas/config', dto)).data;
}

export interface SimularInput {
  valorTotal: number;
  quantidadeParcelas: number;
  dataCompetenciaInicial: string;
  dataVencimentoInicial: string;
  tipo?: TipoCobranca;
}
export async function simularCobranca(input: SimularInput): Promise<Simulacao> {
  return (await api.post('/cobrancas/simular', input)).data;
}

export interface GravarInput {
  filiadoId: string;
  tipo?: TipoCobranca;
  descricao?: string;
  parcelas: { numero?: number; dataCompetencia: string; dataVencimento: string; valor: number }[];
}
export async function gravarCobranca(input: GravarInput) {
  return (await api.post('/cobrancas/gravar', input)).data;
}

export interface FiltroParcelas {
  status?: StatusParcela;
  mes?: string; // YYYY-MM
  busca?: string;
}
export async function listarParcelas(filtro: FiltroParcelas = {}): Promise<Parcela[]> {
  const params: Record<string, string> = {};
  if (filtro.status) params.status = filtro.status;
  if (filtro.mes) params.mes = filtro.mes;
  if (filtro.busca) params.busca = filtro.busca;
  return (await api.get('/cobrancas/parcelas', { params })).data;
}

export async function historicoFiliado(filiadoId: string): Promise<HistoricoFiliado> {
  return (await api.get(`/cobrancas/filiado/${filiadoId}`)).data;
}

export async function pixParcela(parcelaId: string): Promise<PixParcela> {
  return (await api.get(`/cobrancas/parcela/${parcelaId}/pix`)).data;
}

export async function baixarParcela(parcelaId: string) {
  return (await api.patch(`/cobrancas/parcela/${parcelaId}/baixar`)).data;
}

export async function excluirParcela(parcelaId: string) {
  return (await api.delete(`/cobrancas/parcela/${parcelaId}`)).data;
}
