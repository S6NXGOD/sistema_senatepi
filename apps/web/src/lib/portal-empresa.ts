/**
 * Portal da Empresa — cliente da área externa.
 *
 * Usa `fetch` puro de propósito: o cliente Axios do administrativo anexa o
 * token da EQUIPE e tenta renovar a sessão em 401. Aqui a credencial é outra
 * (token da empresa, assinado com outro segredo) e as duas sessões precisam
 * conviver sem se atropelar no mesmo navegador.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';

/** Chave própria — não colide com `senatepi.accessToken` do painel admin. */
export const CHAVE_TOKEN = 'senatepi.empresa.accessToken';
export const CHAVE_EMPRESA = 'senatepi.empresa.dados';

export interface EmpresaSessao {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  primeiroAcesso: boolean;
}

interface RespostaAuth {
  accessToken: string;
  expiraEm: string;
  empresa: EmpresaSessao;
}

export class ErroPortal extends Error {
  constructor(mensagem: string, readonly status: number) {
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
      Array.isArray(m) ? m[0] : m ?? 'Não foi possível concluir a operação.',
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

export function lerEmpresa(): EmpresaSessao | null {
  if (typeof window === 'undefined') return null;
  const bruto = localStorage.getItem(CHAVE_EMPRESA);
  if (!bruto) return null;
  try {
    return JSON.parse(bruto) as EmpresaSessao;
  } catch {
    return null;
  }
}

function salvarSessao(r: RespostaAuth) {
  localStorage.setItem(CHAVE_TOKEN, r.accessToken);
  localStorage.setItem(CHAVE_EMPRESA, JSON.stringify(r.empresa));
}

export function encerrarSessao() {
  localStorage.removeItem(CHAVE_TOKEN);
  localStorage.removeItem(CHAVE_EMPRESA);
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function loginEmpresa(cnpj: string, senha: string): Promise<EmpresaSessao> {
  const r = await chamar<RespostaAuth>('/portal-empresa/auth/login', {
    method: 'POST',
    body: JSON.stringify({ cnpj: apenasDigitos(cnpj), senha }),
  });
  salvarSessao(r);
  return r.empresa;
}

/** Troca a senha provisória e substitui a sessão pelo token já liberado. */
export async function definirSenhaDefinitiva(novaSenha: string): Promise<EmpresaSessao> {
  const r = await chamar<RespostaAuth>('/portal-empresa/auth/primeiro-acesso', {
    method: 'PATCH',
    comToken: true,
    body: JSON.stringify({ novaSenha }),
  });
  salvarSessao(r);
  return r.empresa;
}

/** Revalida a sessão no servidor — o estado local pode estar desatualizado. */
export async function buscarSessao(): Promise<EmpresaSessao> {
  return chamar<EmpresaSessao>('/portal-empresa/auth/eu', { comToken: true });
}

export interface DadosEmpresa extends EmpresaSessao {
  cep: string | null;
  logradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  createdAt: string;
}

/**
 * Cadastro da empresa, direto do servidor.
 * Rota protegida sem isenção: só responde depois da troca da senha provisória.
 */
export async function buscarDados(): Promise<DadosEmpresa> {
  return chamar<DadosEmpresa>('/portal-empresa/dados', { comToken: true });
}

// ---------------------------------------------------------------------------
// Contribuição patronal
// ---------------------------------------------------------------------------

export type StatusContribuicao = 'AGUARDANDO' | 'EM_ANALISE' | 'HOMOLOGADA' | 'REJEITADA';

export interface Contribuicao {
  id: string;
  mesReferencia: string;
  /** "julho/2026" — já montado pela API. */
  competencia: string;
  valorDeclarado: number;
  status: StatusContribuicao;
  /** Indicadores de que o documento existe (o conteúdo vem por rota autenticada). */
  temComprovante: boolean;
  temRelacao: boolean;
  /** Preenchido quando o sindicato recusa — é o que a empresa precisa corrigir. */
  motivoRejeicao: string | null;
  enviadoEm: string | null;
  analisadoEm: string | null;
  createdAt: string;
}

export interface DadosPix {
  contribuicaoId: string;
  valor: number;
  identificador: string;
  copiaECola: string;
  /** PNG em data URL, pronto para <img src>. */
  qrDataUrl: string;
  recebedor: string;
}

export const STATUS_CONTRIBUICAO: Record<
  StatusContribuicao,
  { label: string; descricao: string; classe: string }
> = {
  AGUARDANDO: {
    label: 'Aguardando envio',
    descricao: 'Guia gerada. Pague o PIX e envie os documentos.',
    classe: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  EM_ANALISE: {
    label: 'Em análise',
    descricao: 'Documentos recebidos. O sindicato está conferindo.',
    classe: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
  HOMOLOGADA: {
    label: 'Homologada',
    descricao: 'Contribuição conferida e aceita.',
    classe: 'bg-senatepi-50 text-senatepi-800 dark:bg-senatepi-900/40 dark:text-senatepi-300',
  },
  REJEITADA: {
    label: 'Rejeitada',
    descricao: 'Houve um problema. Corrija e envie novamente.',
    classe: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
};

export const listarContribuicoes = () =>
  chamar<Contribuicao[]>('/portal-empresa/contribuicoes', { comToken: true });

export const buscarPixDaGuia = (id: string) =>
  chamar<DadosPix>(`/portal-empresa/contribuicoes/${id}/pix`, { comToken: true });

export const gerarContribuicao = (mesReferencia: string, valorDeclarado: string | number) =>
  chamar<{ contribuicao: Contribuicao; pix: DadosPix }>('/portal-empresa/contribuicoes/gerar', {
    method: 'POST',
    comToken: true,
    body: JSON.stringify({ mesReferencia, valorDeclarado }),
  });

/**
 * Envia os documentos. Os dois são independentes: dá para mandar só um agora e
 * completar o outro depois. Sem `Content-Type` — o browser monta o multipart.
 */
export async function anexarDocumentos(
  id: string,
  comprovante: File | null,
  relacao: File | null,
): Promise<Contribuicao> {
  const fd = new FormData();
  if (comprovante) fd.append('comprovante', comprovante);
  if (relacao) fd.append('relacao', relacao);

  const token = lerToken();
  const r = await fetch(`${BASE}/portal-empresa/contribuicoes/${id}/anexar`, {
    method: 'PATCH',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
  const texto = await r.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    const m = corpo?.message;
    throw new ErroPortal(
      Array.isArray(m) ? m[0] : m ?? 'Não foi possível enviar os documentos.',
      r.status,
    );
  }
  return corpo as Contribuicao;
}

/**
 * Baixa um documento da guia.
 *
 * Passa pelo `fetch` com o token porque a rota é autenticada — abrir em aba
 * nova por <a href> não carregaria o cabeçalho. O blob é revogado depois de
 * aberto para não deixar o arquivo pendurado na memória.
 */
export async function abrirDocumento(id: string, tipo: 'comprovante' | 'relacao') {
  const token = lerToken();
  const r = await fetch(`${BASE}/portal-empresa/contribuicoes/${id}/documento/${tipo}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!r.ok) throw new ErroPortal('Não foi possível abrir o documento.', r.status);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const formatarReais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Máscara de moeda a partir dos dígitos digitados: "150050" → "1.500,50". */
export function mascaraMoeda(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 10);
  if (!d) return '';
  const n = Number(d) / 100;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "1.500,50" → 1500.5 */
export const moedaParaNumero = (mascarado: string) =>
  Number(apenasDigitos(mascarado)) / 100;

// ---------------------------------------------------------------------------
// Máscara
// ---------------------------------------------------------------------------

export const apenasDigitos = (v: string) => (v ?? '').replace(/\D/g, '');

export function mascaraCnpj(v: string): string {
  const d = apenasDigitos(v).slice(0, 14);
  let o = d.slice(0, 2);
  if (d.length > 2) o += '.' + d.slice(2, 5);
  if (d.length > 5) o += '.' + d.slice(5, 8);
  if (d.length > 8) o += '/' + d.slice(8, 12);
  if (d.length > 12) o += '-' + d.slice(12, 14);
  return o;
}
