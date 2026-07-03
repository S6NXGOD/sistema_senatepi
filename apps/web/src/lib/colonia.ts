import { api } from './api';

export type Climatizacao = 'AR_CONDICIONADO' | 'VENTILADOR';
export type ModoReserva = 'RESERVA_DIRETA' | 'SORTEIO_OU_MANUAL';
export type FormacaoColonia = 'ENFERMEIRO' | 'TECNICO' | 'AUXILIAR';

export interface QuartoDisp {
  id: string;
  numero: number;
  climatizacao: Climatizacao;
  modoReserva: ModoReserva;
  disponivel: boolean;
}

export interface LoteDisp {
  lote: { id: string; numero: number; dataInicio: string; dataFim: string };
  quartos: QuartoDisp[];
  arDisponivel: boolean;
  ventiladorDiretoDisponivel: boolean;
  sorteioHabilitado: boolean;
  esgotado: boolean;
  quarto6AlocadoManualmente: boolean;
}

export interface Disponibilidade {
  temporada: { id: string; nome: string; ano: number; slug: string; dataSorteio?: string | null };
  lotes: LoteDisp[];
}

export interface CheckoutPayload {
  nomeCompleto: string;
  cpf: string;
  telefone: string;
  coren: string; // formato <número>-<ENF|TE|AE>, conforme a formação
  email?: string;
  formacao: FormacaoColonia;
  localTrabalho1: string;
  localTrabalho2?: string;
  cidade: string;
  estado: string;
  aceiteTermoNoShow: boolean;
  consentimentoLgpd: boolean;
}

export const FORMACAO_OPCOES: { value: FormacaoColonia; label: string }[] = [
  { value: 'ENFERMEIRO', label: 'Enfermeiro(a)' },
  { value: 'TECNICO', label: 'Técnico(a) de Enfermagem' },
  { value: 'AUXILIAR', label: 'Auxiliar de Enfermagem' },
];

// Estrutura padrão de todos os quartos da Colônia (exibida na vitrine e no comprovante).
export const ESTRUTURA_QUARTO =
  'Estrutura do Quarto: 2 camas de casal, 1 cama de solteiro e suportes para redes';

// Aviso do prazo de cancelamento (Termo de No-Show) — exibido em TODAS as reservas.
export const AVISO_NOSHOW_24H =
  'Você tem no máximo 24h após a reserva para cancelá-la. Após esse prazo, as ' +
  'penalidades do Termo de No-Show serão aplicadas.';

/** Calcula o prazo-limite de cancelamento (createdAt + 24h) e se já expirou. */
export function prazoCancelamento24h(createdAtIso: string) {
  const limite = new Date(new Date(createdAtIso).getTime() + 24 * 60 * 60 * 1000);
  return {
    limite,
    expirado: Date.now() > limite.getTime(),
    texto: limite.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }),
  };
}

// Aviso legal obrigatório no comprovante e na tela de sucesso.
export const AVISO_LEGAL_RESERVA =
  'ATENÇÃO: Esta reserva poderá ser cancelada caso seja constatado que o titular não é filiado ' +
  'ativo ao SENATEPI. Neste caso, a vaga voltará a ficar disponível no sistema e o CPF ficará ' +
  'bloqueado para novas reservas até a regularização da situação junto à secretaria. ' +
  '(Conforme regras administrativas internas amparadas pelo Código Civil - Lei nº 10.406, de 10 de ' +
  'janeiro de 2002. Fonte: Diário Oficial da União)';

// Dados de contato da secretaria (gatekeeper e comprovante).
export const SECRETARIA = {
  telefone: '(86) 3303-1426',
  telefoneHref: 'tel:+558633031426',
  whatsappNumero: '558633031426',
  endereco: 'R. Lucídio Freitas, 1070 - Centro (Norte), Teresina - PI, 64000-440',
  horario: 'Horário de atendimento: 7:30h às 13:30h',
};

export const LABEL_CLIMATIZACAO: Record<Climatizacao, string> = {
  AR_CONDICIONADO: 'Quarto com Ar-condicionado',
  VENTILADOR: 'Quarto com Ventilador',
};

// COREN: o sufixo é definido pela formação selecionada (espelha o back-end).
export const SUFIXO_COREN: Record<FormacaoColonia, 'ENF' | 'TE' | 'AE'> = {
  ENFERMEIRO: 'ENF',
  TECNICO: 'TE',
  AUXILIAR: 'AE',
};

/** Monta o COREN completo (ex.: "123456" + ENFERMEIRO → "123456-ENF"). */
export function montarCoren(numero: string, formacao: FormacaoColonia): string {
  const n = soDigitos(numero).slice(0, 6);
  return n ? `${n}-${SUFIXO_COREN[formacao]}` : '';
}

export async function getDisponibilidade(slug?: string): Promise<Disponibilidade> {
  return (await api.get('/colonia/disponibilidade', { params: slug ? { slug } : undefined })).data;
}

export async function postReservaDireta(payload: CheckoutPayload & { slug: string; loteId: string; quartoId: string }) {
  return (await api.post('/colonia/reservas', payload)).data;
}

export async function postSorteio(payload: CheckoutPayload & { slug: string; loteId: string }) {
  return (await api.post('/colonia/sorteio/inscricao', payload)).data;
}

// ---- Busca no cadastro legado de Filiados (autocomplete administrativo) ----
export interface FiliadoBusca {
  id: string;
  nome: string;
  cpf: string;
  cpfMascarado: string;
  coren: string | null;
  corenNumero: string | null;
  formacao: FormacaoColonia | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  localTrabalho1: string | null;
  localTrabalho2: string | null;
  vinculos: { empresa: string; cargo: string | null }[];
}

export async function buscarFiliados(q: string): Promise<FiliadoBusca[]> {
  const termo = q.trim();
  if (termo.length < 2) return [];
  return (await api.get('/admin/filiados/buscar', { params: { q: termo } })).data;
}

// ---- Admin ----
export type StatusTemporada = 'ATIVA' | 'INATIVA';

export interface TemporadaResumo {
  id: string;
  nome: string;
  slug: string;
  ano: number;
  status: StatusTemporada;
  dataSorteio?: string | null;
}

/** Resumo de campanha para o dashboard mestre (lista de campanhas/links). */
export interface CampanhaResumo {
  id: string;
  nome: string;
  slug: string;
  ano: number;
  status: StatusTemporada;
  createdAt: string;
  totalLotes: number;
  totalVagas: number;
  ocupadas: number;
}

export async function listarCampanhas(): Promise<CampanhaResumo[]> {
  return (await api.get('/colonia/admin/temporadas')).data;
}

export interface Ocupante {
  reservaId: string;
  quartoNumero: number;
  climatizacao: Climatizacao;
  origem: 'RESERVA_DIRETA' | 'SORTEIO' | 'ALOCACAO_MANUAL';
  alocacaoManual: boolean;
  nomeCompleto: string;
  cpf: string;
  coren: string | null;
  formacao: FormacaoColonia;
  telefone: string;
  email: string | null;
  localTrabalho1: string;
  localTrabalho2: string | null;
  cidade: string;
  estado: string;
  createdAt: string;
  /** Cadastro de filiado correspondente (por CPF), se existir. */
  filiadoId: string | null;
}

export interface InscritoSorteio {
  id: string;
  nomeCompleto: string;
  cpf: string;
  coren: string | null;
  formacao: FormacaoColonia;
  createdAt: string;
  filiadoId: string | null;
}

/** Suplente da fila de sorteio (ordem de promoção). */
export interface Suplente {
  id: string;
  posicao: number | null;
  nomeCompleto: string;
  cpf: string;
  coren: string | null;
  formacao: FormacaoColonia;
  filiadoId: string | null;
}

export interface LotePainel {
  lote: { id: string; numero: number; dataInicio: string; dataFim: string };
  quartos: (QuartoDisp & { ocupado: boolean })[];
  ocupacao: Ocupante[];
  inscritos: InscritoSorteio[];
  suplentes: Suplente[];
  sorteioHabilitado: boolean;
  esgotado: boolean;
  quarto6AlocadoManualmente: boolean;
}

export interface PainelAdmin {
  temporadas: TemporadaResumo[];
  temporada: TemporadaResumo | null;
  lotes: LotePainel[];
}

export interface ResultadoSorteio {
  vencedor: { nomeCompleto: string; cpf: string; coren: string | null; formacao: FormacaoColonia; reservaId: string };
  suplentes: { posicao: number; nomeCompleto: string; cpf: string; coren: string | null; formacao: FormacaoColonia }[];
}

export async function getPainelAdmin(temporadaId?: string): Promise<PainelAdmin> {
  return (await api.get('/colonia/admin/painel', { params: { temporadaId } })).data;
}

export async function setStatusTemporada(id: string, status: StatusTemporada) {
  return (await api.patch(`/colonia/admin/temporadas/${id}/status`, { status })).data;
}

/** Define/limpa a data-hora do sorteio público da temporada (ISO ou null). */
export async function definirDataSorteio(id: string, dataSorteio: string | null) {
  return (await api.patch(`/colonia/admin/temporadas/${id}/sorteio`, { dataSorteio })).data;
}

export interface SyncFiliadoResposta {
  filiadoId: string;
  nome: string;
  alterados: string[];
}

/** Campo da comparação antes/depois (valor atual do cadastro × valor da Colônia). */
export interface CampoDiff {
  campo: string;
  label: string;
  atual: string | null;
  novo: string | null;
  diferente: boolean;
}

export interface ComparacaoFiliado {
  filiadoId: string;
  filiadoNome: string;
  matricula: string;
  cpf: string;
  campos: CampoDiff[];
}

type FonteSync = 'reserva' | 'inscricao';
const rotaSync = (fonte: FonteSync, id: string) =>
  fonte === 'reserva' ? `/colonia/admin/reservas/${id}` : `/colonia/admin/inscricoes/${id}`;

/** Prévia (antes/depois) da sincronização de uma reserva/inscrição com o cadastro. */
export async function compararFiliado(fonte: FonteSync, id: string): Promise<ComparacaoFiliado> {
  return (await api.get(`${rotaSync(fonte, id)}/comparar-filiado`)).data;
}

/** Aplica no cadastro do filiado apenas os campos escolhidos. */
export async function sincronizarFiliado(
  fonte: FonteSync,
  id: string,
  campos: string[],
): Promise<SyncFiliadoResposta> {
  return (await api.patch(`${rotaSync(fonte, id)}/sincronizar-filiado`, { campos })).data;
}

export async function cancelarReserva(id: string, motivo?: string) {
  return (await api.patch(`/colonia/admin/reservas/${id}/cancelar`, { motivo })).data;
}

export async function alocarManual(payload: CheckoutPayload & { loteId: string; quartoId?: string }) {
  return (await api.post('/colonia/admin/alocacao-manual', payload)).data;
}

export async function executarSorteio(loteId: string): Promise<ResultadoSorteio> {
  return (await api.post(`/colonia/admin/lotes/${loteId}/sorteio/realizar`, {})).data;
}

export const FORMACAO_LABEL: Record<FormacaoColonia, string> = {
  ENFERMEIRO: 'Enfermeiro(a)',
  TECNICO: 'Técnico(a)',
  AUXILIAR: 'Auxiliar',
};

// ---- Máscaras de input (só dígitos internamente) ----
export function soDigitos(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

export function mascaraCpf(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

export function mascaraTelefone(v: string): string {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/^\((\d{2})\)\s(\d{4})(\d)/, '($1) $2-$3');
  }
  return d
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/^\((\d{2})\)\s(\d{5})(\d)/, '($1) $2-$3');
}

// ===========================================================================
// Mascaramento LGPD (Lei 13.709/2018) — para o "Modo Apresentação" do sorteio.
// ===========================================================================

/** Nome: primeiro nome + meio ofuscado + último (ex.: "João *** Silva"). */
export function mascararNomeLgpd(nome: string): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '—';
  if (partes.length === 1) return partes[0];
  return `${partes[0]} *** ${partes[partes.length - 1]}`;
}

/** CPF: mostra apenas os 3 dígitos do meio (ex.: "***.456.***-**"). */
export function mascararCpfLgpd(cpf: string): string {
  const d = soDigitos(cpf);
  if (d.length !== 11) return '***.***.***-**';
  return `***.${d.slice(3, 6)}.***-**`;
}

/** COREN: mostra o final + sufixo da formação (ex.: "***456-ENF"). */
export function mascararCorenLgpd(coren: string | null | undefined): string {
  if (!coren) return '—';
  const [num, sufixo] = coren.split('-');
  const fim = (num ?? '').replace(/\D/g, '').slice(-3);
  return `***${fim}${sufixo ? `-${sufixo}` : ''}`;
}

export function formatarPeriodoLote(inicio: string, fim: string): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `${fmt(inicio)} → ${fmt(fim)}`;
}

/** Formato completo por extenso: "10/07 (Quarta) às 10:00h". */
export function formatarDataHoraLote(iso: string): string {
  const d = new Date(iso);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'long' });
  const cap = semana.charAt(0).toUpperCase() + semana.slice(1);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${data} (${cap}) às ${hora}h`;
}

/** Quebra uma data ISO em partes para exibição em destaque (dia, mês, hora, dia da semana). */
export function partesData(iso: string) {
  const d = new Date(iso);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    dia: d.toLocaleDateString('pt-BR', { day: '2-digit' }),
    mes: cap(d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')),
    hora: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    diaSemana: cap(d.toLocaleDateString('pt-BR', { weekday: 'long' })),
  };
}
