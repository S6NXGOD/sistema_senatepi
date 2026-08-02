import { api } from './api';

/** Empresa como a API devolve — sem nada da senha. */
export interface Empresa {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cep: string | null;
  logradouro: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  /** Já tem credencial do portal patronal (senha provisória definida). */
  temAcessoPortal: boolean;
  /** A senha provisória ainda não foi trocada pela empresa. */
  primeiroAcesso: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Retorno de GET /empresas/cnpj/:cnpj — dados da Receita já limpos. */
export interface DadosCnpj {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  situacao: string | null;
  jaCadastrada: boolean;
}

export interface ListaEmpresas {
  data: Empresa[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface NovaEmpresa {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  cep?: string;
  logradouro?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  /**
   * Habilita o portal patronal. OPCIONAL: a mesma tabela guarda a empregadora
   * de um colaborador PJ/terceirizado, que existe só como vínculo e nunca
   * acessa o portal. Sem senha, a empresa aparece como "sem acesso ao portal"
   * e pode ser habilitada depois.
   */
  senhaProvisoria?: string;
}

export async function listarEmpresas(params: {
  busca?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListaEmpresas> {
  return (await api.get('/empresas', { params })).data;
}

export async function consultarCnpj(cnpj: string): Promise<DadosCnpj> {
  return (await api.get(`/empresas/cnpj/${apenasDigitos(cnpj)}`)).data;
}

export async function criarEmpresa(dados: NovaEmpresa): Promise<Empresa> {
  return (await api.post('/empresas', dados)).data;
}

/**
 * Exclusão permanente da empresa (a API restringe ao Administrador).
 * Leva junto as contribuições e os documentos; colaboradores só perdem o vínculo.
 */
export async function excluirEmpresa(id: string): Promise<{
  ok: boolean;
  contribuicoesRemovidas: number;
  colaboradoresDesvinculados: number;
}> {
  return (await api.delete(`/empresas/${id}`)).data;
}

// ---------------------------------------------------------------------------
// Máscaras e validação (espelham cnpj.util.ts da API)
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

export function mascaraCep(v: string): string {
  const d = apenasDigitos(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Dígitos verificadores do CNPJ. Validar aqui evita disparar a consulta
 * externa a cada tecla enquanto o número ainda está errado.
 */
export function cnpjValido(v: string): boolean {
  const d = apenasDigitos(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (pesos: number[]) => {
    const soma = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return (
    dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12]) &&
    dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13])
  );
}

/**
 * Sugestão de senha provisória: legível ao ditar por telefone (sem I/O/0/1,
 * que se confundem) e sorteada com o gerador criptográfico do navegador.
 */
export function gerarSenhaProvisoria(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b, i) => {
    const fonte = i < 4 ? alfabeto : digitos;
    return fonte[b % fonte.length];
  }).join('');
}
