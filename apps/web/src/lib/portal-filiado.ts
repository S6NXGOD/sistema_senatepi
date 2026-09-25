/**
 * Portal do Filiado — cliente da área externa.
 *
 * Usa `fetch` puro de propósito: o cliente Axios do administrativo anexa o
 * token da EQUIPE e tenta renovar a sessão em 401. Aqui a credencial é outra
 * (token do filiado, assinado com outro segredo) e as três sessões possíveis no
 * mesmo navegador — equipe, empresa e filiado — precisam conviver sem se
 * atropelar. Mesmo desenho de `portal-empresa`, e pelo mesmo motivo.
 */

import { chaveLocal } from '@/lib/armazenamento';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';

/**
 * Chave própria — não colide com a do painel nem com a do portal patronal, e
 * leva o id do sindicato: duas instalações no mesmo host compartilhariam
 * armazenamento.
 */
export const CHAVE_TOKEN = chaveLocal('filiado', 'accessToken');
export const CHAVE_FILIADO = chaveLocal('filiado', 'dados');

export interface FiliadoSessao {
  id: string;
  nomeCompleto: string;
  matricula: string;
  primeiroAcesso: boolean;
}

interface RespostaAuth {
  accessToken: string;
  expiraEm: string;
  filiado: FiliadoSessao;
}

export class ErroPortal extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
  }
}

async function chamar<T>(caminho: string, init?: RequestInit & { comToken?: boolean }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (init?.comToken) {
    const token = lerToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const r = await fetch(`${BASE}${caminho}`, { ...init, headers });
  const texto = await r.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    const m = corpo?.message;
    throw new ErroPortal(
      Array.isArray(m) ? m[0] : (m ?? 'Não foi possível concluir a operação.'),
      r.status,
    );
  }
  return corpo as T;
}

// ---------------------------------------------------------------------------
// Sessão (localStorage — o portal é 100% client-side)
// ---------------------------------------------------------------------------

export function lerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CHAVE_TOKEN);
}

export function lerFiliado(): FiliadoSessao | null {
  if (typeof window === 'undefined') return null;
  const bruto = localStorage.getItem(CHAVE_FILIADO);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as FiliadoSessao;
  } catch {
    return null;
  }
}

function salvarSessao(r: RespostaAuth) {
  localStorage.setItem(CHAVE_TOKEN, r.accessToken);
  localStorage.setItem(CHAVE_FILIADO, JSON.stringify(r.filiado));
}

export function encerrarSessao() {
  localStorage.removeItem(CHAVE_TOKEN);
  localStorage.removeItem(CHAVE_FILIADO);
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

/**
 * Login por CPF — a única porta do portal (decisão do dono, 25/09/2026).
 *
 * A máscara é tirada AQUI porque o campo da tela a coloca; o servidor também
 * limpa, e ter os dois lados limpando é de propósito: o dia em que alguém colar
 * o CPF de outro jeito, nenhum dos dois quebra.
 */
export async function loginFiliado(cpf: string, senha: string): Promise<FiliadoSessao> {
  const r = await chamar<RespostaAuth>('/portal-filiado/auth/login', {
    method: 'POST',
    body: JSON.stringify({ cpf: cpf.replace(/\D/g, ''), senha }),
  });
  salvarSessao(r);
  return r.filiado;
}

/** Troca a senha e substitui a sessão pelo token já liberado. */
export async function trocarSenha(novaSenha: string): Promise<FiliadoSessao> {
  const r = await chamar<RespostaAuth>('/portal-filiado/auth/senha', {
    method: 'PATCH',
    comToken: true,
    body: JSON.stringify({ novaSenha }),
  });
  salvarSessao(r);
  return r.filiado;
}

/** Revalida a sessão no servidor — o estado local pode estar desatualizado. */
export async function buscarSessao(): Promise<FiliadoSessao> {
  return chamar<FiliadoSessao>('/portal-filiado/auth/eu', { comToken: true });
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

export interface ResumoDoPortal {
  nomeCompleto: string;
  matricula: string;
  situacao: 'ATIVO' | 'INATIVO' | 'DESFILIADO';
  situacaoRotulo: string;
  dataFiliacao: string | null;
  carteirinha: { numero: string; validaAte: string | null } | null;
  processos: { total: number; emAndamento: number };
  /** `null` quando o cliente não usa cobrança pelo sistema — a aba nem aparece. */
  cobrancas: { emAberto: number; vencidas: number; total: number } | null;
  /** Recados do sindicato que a pessoa ainda não abriu. */
  recadosNovos: number;
}

export async function buscarResumo(): Promise<ResumoDoPortal> {
  return chamar<ResumoDoPortal>('/portal-filiado/eu', { comToken: true });
}

export interface CarteirinhaDoPortal {
  emitida: boolean;
  numero: string | null;
  emitidaEm: string | null;
  validaAte: string | null;
  nomeCompleto: string;
  matricula: string;
  categoria: string | null;
  categoriaOutro: string | null;
  dataFiliacao: string | null;
  situacaoRotulo: string;
}

export async function buscarCarteirinha(): Promise<CarteirinhaDoPortal> {
  return chamar<CarteirinhaDoPortal>('/portal-filiado/eu/carteirinha', { comToken: true });
}

export interface MeuVinculo {
  empresa: string;
  cargo: string | null;
  matricula: string | null;
}

export interface MeuCadastro {
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  rg: string | null;
  ufRg: string | null;
  dataNascimento: string | null;
  sexo: string | null;
  estadoCivil: string | null;
  naturalidade: string | null;
  situacao: string;
  dataFiliacao: string | null;
  dataAdmissao: string | null;
  formacao: string | null;
  formacaoOutro: string | null;
  numeroCoren: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  telefonePrincipal: string | null;
  telefoneSecundario: string | null;
  email: string | null;
  vinculos: MeuVinculo[];
  dependentes: Array<{ id: string; nome: string; tipo: string; dataNascimento: string }>;
  /** A foto atual, assinada — `null` enquanto não houver. */
  fotoUrl: string | null;
  /** A lista vem do SERVIDOR: o formulário não mantém uma segunda cópia dela. */
  editaveis: string[];
}

export async function buscarMeuCadastro(): Promise<MeuCadastro> {
  return chamar<MeuCadastro>('/portal-filiado/eu/cadastro', { comToken: true });
}

export async function salvarMeuCadastro(
  dados: Record<string, unknown>,
): Promise<MeuCadastro & { alterados: string[] }> {
  return chamar('/portal-filiado/eu/cadastro', {
    method: 'PATCH',
    comToken: true,
    body: JSON.stringify(dados),
  });
}

/**
 * A foto do próprio celular.
 *
 * `FormData` sem `Content-Type` à mão: o navegador precisa pôr o `boundary`
 * junto. Por isso esta não passa por `chamar`.
 */
export async function enviarMinhaFoto(arquivo: File): Promise<{ fotoUrl: string | null }> {
  const corpo = new FormData();
  corpo.append('foto', arquivo);
  const token = lerToken();
  const r = await fetch(`${BASE}/portal-filiado/eu/foto`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: corpo,
  });
  const texto = await r.text();
  const dado = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    const m = dado?.message;
    throw new ErroPortal(
      Array.isArray(m) ? m[0] : (m ?? 'Não foi possível enviar a foto.'),
      r.status,
    );
  }
  return dado;
}

export interface MeuProcesso {
  id: string;
  numeroCNJ: string | null;
  identificacao: string;
  titulo: string | null;
  classeProcessual: string | null;
  assuntoPrincipal: string | null;
  orgaoJulgador: string | null;
  tribunal: string | null;
  dataDistribuicao: string | null;
  statusInterno: string;
  situacao: string;
  ultimoMovimentoEm: string | null;
  segredoJustica: boolean;
  recadosNovos: number;
}

/** Quanto o andamento muda a vida de quem é parte — ver a util da API. */
export type PesoDoAndamento = 'MARCO' | 'ANDAMENTO' | 'TRAMITE';

export interface AndamentoTraduzido {
  id: string;
  dataMovimento: string;
  orgaoJulgador: string | null;
  /** Já em português de gente. Igual ao `original` quando não há tradução. */
  titulo: string;
  explica: string | null;
  peso: PesoDoAndamento;
  /** O texto do TRIBUNAL, sempre — é o que o advogado vê no sistema do TRT. */
  original: string;
  traduzido: boolean;
}

export interface RecadoDoSindicato {
  id: string;
  texto: string;
  autorNome: string;
  createdAt: string;
  vistoEm: string | null;
  novo: boolean;
}

export interface MeuProcessoDetalhe extends MeuProcesso {
  valorCausa: number | null;
  grau: string | null;
  advogadoResponsavel: string | null;
  /** Onde o processo está AGORA, numa frase. `null` quando só houve trâmite. */
  agora: { titulo: string; explica: string | null; em: string } | null;
  recados: RecadoDoSindicato[];
  movimentacoes: AndamentoTraduzido[];
  totalDeMovimentacoes: number;
}

export async function buscarMeusProcessos(): Promise<MeuProcesso[]> {
  return chamar<MeuProcesso[]>('/portal-filiado/eu/processos', { comToken: true });
}

export async function buscarMeuProcesso(id: string): Promise<MeuProcessoDetalhe> {
  return chamar<MeuProcessoDetalhe>(`/portal-filiado/eu/processos/${id}`, { comToken: true });
}

export interface MinhaParcela {
  id: string;
  numero: number;
  dataCompetencia: string;
  dataVencimento: string;
  valor: number;
  status: string;
  dataPagamento: string | null;
  /** `null` até a pessoa mandar. Não é status: é estado derivado — ver a API. */
  comprovante: { nome: string | null; enviadoEm: string } | null;
}

export interface MinhaCobranca {
  id: string;
  tipo: string;
  descricao: string | null;
  valorTotal: number;
  createdAt: string;
  parcelas: MinhaParcela[];
}

export async function buscarMinhasCobrancas(): Promise<MinhaCobranca[]> {
  return chamar<MinhaCobranca[]>('/portal-filiado/eu/cobrancas', { comToken: true });
}

export interface PixDaParcela {
  parcelaId: string;
  numero: number;
  valor: number;
  identificador: string;
  copiaECola: string;
  qrDataUrl: string;
}

/**
 * O PIX de UMA parcela, sob demanda.
 *
 * Não vem na listagem porque o QR é um data URL de alguns KB: um carnê de doze
 * faria a primeira tela do celular baixar meio mega de imagem que ninguém pediu.
 */
export async function buscarPixDaParcela(parcelaId: string): Promise<PixDaParcela> {
  return chamar<PixDaParcela>(`/portal-filiado/eu/cobrancas/parcelas/${parcelaId}/pix`, {
    comToken: true,
  });
}

/**
 * Envia o comprovante de pagamento.
 *
 * `FormData` sem `Content-Type` à mão: o navegador precisa pôr o `boundary`
 * junto, e cravar o cabeçalho é o erro clássico que faz o servidor receber um
 * corpo vazio. Por isso esta não passa por `chamar`.
 */
export async function enviarComprovante(
  parcelaId: string,
  arquivo: File,
): Promise<{ nome: string | null; enviadoEm: string }> {
  const corpo = new FormData();
  corpo.append('arquivo', arquivo);
  const token = lerToken();
  const r = await fetch(`${BASE}/portal-filiado/eu/cobrancas/parcelas/${parcelaId}/comprovante`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: corpo,
  });
  const texto = await r.text();
  const dado = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    const m = dado?.message;
    throw new ErroPortal(
      Array.isArray(m) ? m[0] : (m ?? 'Não foi possível enviar o comprovante.'),
      r.status,
    );
  }
  return dado;
}

// ---------------------------------------------------------------------------
// A carteirinha em PDF
// ---------------------------------------------------------------------------

/**
 * Baixa o PDF da carteirinha.
 *
 * `fetch` + blob porque o PDF exige o header de autorização: um `<a href>`
 * simples iria sem token e voltaria 401 — em silêncio, que é como quinze
 * downloads do administrativo falharam até 24/09.
 */
export async function baixarMinhaCarteirinha(): Promise<void> {
  const token = lerToken();
  const r = await fetch(`${BASE}/portal-filiado/eu/carteirinha/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) {
    // O corpo do erro vem como Blob quando o servidor responde JSON num
    // endpoint de arquivo: ler como texto é o único jeito de saber o motivo.
    const texto = await r.text();
    let mensagem = 'Não foi possível baixar a carteirinha.';
    try {
      const corpo = JSON.parse(texto);
      if (corpo?.message) mensagem = Array.isArray(corpo.message) ? corpo.message[0] : corpo.message;
    } catch {
      /* corpo não era JSON: fica a mensagem padrão */
    }
    throw new ErroPortal(mensagem, r.status);
  }

  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'carteirinha.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
