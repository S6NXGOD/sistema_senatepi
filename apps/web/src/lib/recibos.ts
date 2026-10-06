import { api } from './api';

/**
 * RECIBOS — o cliente da API e as regras de exibição.
 *
 * O VALOR POR EXTENSO NÃO MORA AQUI, de propósito. Ele vem pronto do servidor
 * (`valorPorExtenso` em `common/valor-por-extenso.util.ts`), porque uma segunda
 * implementação da mesma frase faria a 2ª via poder sair diferente da 1ª — e o
 * recibo é um documento, não uma tela (`senatepi-previa-le-a-mesma-regra`).
 */

/** O fuso do sindicato: a hora que o papel mostra é a de Teresina. */
export const FUSO_BR = 'America/Fortaleza';

export interface ReciboResumo {
  id: string;
  exercicio: number;
  numero: number;
  /** "007/2026" — como o recibo é citado em ofício e prestação de contas. */
  codigo: string;
  valor: number;
  referente: string;
  formaPagamento: string;
  recebidoEm: string;
  pagadorNome: string;
  pagadorDocumento: string | null;
  emitidoEm: string;
  cancelado: boolean;
  canceladoEm: string | null;
  canceladoMotivo: string | null;
  movimentacaoId: string | null;
  parcelaId: string | null;
  filiadoId: string | null;
  empresaId: string | null;
  filiadoNome: string | null;
  filiadoMatricula: string | null;
  empresaNome: string | null;
}

/**
 * O CABEÇALHO INSTITUCIONAL DO PAPEL, montado pelo servidor.
 *
 * CNPJ, endereço e telefone vivem só no `tenant.config` da API. Copiá-los
 * para o web daria dois lugares com o mesmo dado legal — e um recibo com o
 * CNPJ do outro cliente no dia em que divergissem.
 */
export interface EmitenteDoRecibo {
  sigla: string;
  nome: string;
  nomeCurto: string;
  cnpj: string | null;
  registroSindical: string | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
}

export interface ReciboCompleto extends ReciboResumo {
  valorPorExtenso: string;
  emitente: EmitenteDoRecibo;
  emitidoPorNome: string | null;
  canceladoPorNome: string | null;
  filiado: { id: string; nomeCompleto: string; matricula: string; cpf: string | null } | null;
  empresa: { id: string; razaoSocial: string; cnpj: string } | null;
  parcela: { numero: number; total: number; tipo: string; competencia: string } | null;
}

export interface ListaDeRecibos {
  itens: ReciboResumo[];
  total: number;
  page: number;
  pageSize: number;
  resumo: { quantidadeValida: number; valorValido: number; cancelados: number };
  exercicios: number[];
}

/**
 * O QUE O FORMULÁRIO PRECISA SABER DE UM PAGAMENTO JÁ LANÇADO.
 *
 * Vem de dois lugares: da fila de pendentes (`/recibos/pendentes`) e do menu de
 * uma parcela paga, dentro de Cobranças. Os dois descrevem o mesmo fato —
 * dinheiro que entrou — e por isso alimentam o MESMO formulário. Uma segunda
 * tela de emissão seria uma segunda regra de numeração.
 */
export interface PagamentoParaRecibo {
  /** Uma das duas origens; a parcela tem precedência quando existe. */
  parcelaId: string | null;
  movimentacaoId: string | null;
  valor: number;
  data: string;
  /** Nome da conta de caixa, quando se sabe. */
  conta: string | null;
  pagadorNome: string | null;
  pagadorDocumento: string | null;
  filiadoId: string | null;
  empresaId: string | null;
  referenteSugerido: string;
}

/** Uma linha da fila de pendentes — um pagamento no caixa sem recibo. */
export interface PagamentoSemRecibo extends PagamentoParaRecibo {
  movimentacaoId: string;
  conta: string;
  descricao: string;
  origem: string | null;
}

export interface FilaDePendentes {
  total: number;
  truncada: boolean;
  itens: PagamentoSemRecibo[];
}

export interface FiltroRecibos {
  busca?: string;
  exercicio?: number;
  situacao?: 'VALIDOS' | 'CANCELADOS' | 'TODOS';
  de?: string;
  ate?: string;
  filiadoId?: string;
  page?: number;
  pageSize?: number;
}

export interface EmitirRecibo {
  parcelaId?: string;
  movimentacaoId?: string;
  valor?: number;
  referente?: string;
  formaPagamento: string;
  recebidoEm?: string;
  pagadorNome?: string;
  pagadorDocumento?: string;
  filiadoId?: string;
  empresaId?: string;
  contaBancariaId?: string;
}

export async function listarRecibos(f: FiltroRecibos): Promise<ListaDeRecibos> {
  const { data } = await api.get('/recibos', { params: f });
  return data;
}

export async function pendentesDeRecibo(): Promise<FilaDePendentes> {
  const { data } = await api.get('/recibos/pendentes');
  return data;
}

export async function obterRecibo(id: string): Promise<ReciboCompleto> {
  const { data } = await api.get(`/recibos/${id}`);
  return data;
}

export async function emitirRecibo(body: EmitirRecibo): Promise<ReciboCompleto> {
  const { data } = await api.post('/recibos', body);
  return data;
}

export async function cancelarRecibo(id: string, motivo: string): Promise<ReciboCompleto> {
  const { data } = await api.patch(`/recibos/${id}/cancelar`, { motivo });
  return data;
}

// ---------------------------------------------------------------------------
// Exibição
// ---------------------------------------------------------------------------

export function formatBRL(v: number | string): string {
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Instante → "06/10/2026" no fuso de Teresina (nunca no do aparelho). */
export function formatData(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO_BR });
}

export function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: FUSO_BR,
  });
}

/** "6 de outubro de 2026" — a data por extenso que todo documento assina. */
export function formatDataExtenso(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: FUSO_BR,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** CPF ou CNPJ, pelo tamanho. Documento curto ou estranho sai como veio. */
export function formatDocumento(doc: string | null | undefined): string {
  const d = (doc ?? '').replace(/[^0-9]/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return doc || '—';
}

/**
 * AS FORMAS DE PAGAMENTO QUE O BALCÃO USA, como atalho — e o campo continua
 * livre.
 *
 * É TEXTO no banco, e não enum, porque as formas mudam (hoje PIX, ontem
 * boleto) e acrescentar valor a enum existente derruba o contêiner antigo na
 * janela de troca do deploy. A lista aqui é só a fileira de botões: quem
 * receber de um jeito que não está nela digita.
 */
export const FORMAS_DE_PAGAMENTO = ['PIX', 'Dinheiro', 'Transferência', 'Cartão', 'Boleto'];

/**
 * A DATA DE HOJE EM TERESINA, como "AAAA-MM-DD" para `<input type="date">`.
 *
 * `new Date().toISOString().slice(0,10)` responderia em UTC: das 21h em diante
 * o campo já abriria com a data de amanhã (`senatepi-fuso-do-servidor`).
 */
export function hojeEmTeresina(): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_BR,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return partes;
}
