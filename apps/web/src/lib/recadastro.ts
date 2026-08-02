/**
 * Recadastramento ONLINE — área pública (o filiado acessa sem login).
 *
 * Usa `fetch` puro de propósito: o cliente Axios do sistema anexa o token da
 * equipe e tenta renovar a sessão em 401 — comportamento indesejado numa tela
 * que, por definição, não tem sessão. Aqui a credencial é o token do link.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';

export type DesafioRecadastramento = 'CPF_NASCIMENTO' | 'COREN' | 'NENHUM';

export interface LinkAberto {
  desafio: DesafioRecadastramento;
  expiraEm: string;
  primeiroNome: string;
}

/** Vínculo profissional — espelha o model VinculoProfissional da API. */
export interface VinculoFiliado {
  id?: string;
  empresa: string;
  cargo?: string | null;
  matricula?: string | null;
  ordem?: number;
}

export type TipoDependente = 'CONJUGE' | 'FILHO';

/** Dependente do filiado. Sem `id` = novo; fora da lista enviada = removido. */
export interface DependenteFiliado {
  id?: string;
  tipo: TipoDependente;
  nome: string;
  cpf?: string | null;
  /** ISO ou AAAA-MM-DD. */
  dataNascimento: string;
}

export const TIPOS_DEPENDENTE: Array<{ valor: TipoDependente; rotulo: string }> = [
  { valor: 'FILHO', rotulo: 'Filho(a)' },
  { valor: 'CONJUGE', rotulo: 'Cônjuge' },
];

/** Cadastro completo devolvido após o desafio — é o que o formulário edita. */
export interface FiliadoRecadastro {
  id: string;
  nomeCompleto: string;
  matricula: string;
  cpf: string | null;
  rg: string | null;
  ufRg: string | null;
  dataNascimento: string | null;
  sexo: string | null;
  estadoCivil: string | null;
  naturalidade: string | null;
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
  formacao: string | null;
  formacaoOutro: string | null;
  numeroCoren: string | null;
  dataAdmissao: string | null;
  vinculos: VinculoFiliado[];
  dependentes: DependenteFiliado[];
  fotoUrl?: string | null;
}

async function chamar<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const texto = await r.text();
  const corpo = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    const msg = corpo?.message;
    throw new Error(Array.isArray(msg) ? msg[0] : msg ?? 'Não foi possível concluir a operação.');
  }
  return corpo as T;
}

/** Estado do link + qual confirmação será pedida. */
export const abrirLink = (token: string) =>
  chamar<LinkAberto>(`/recadastro/${token}`);

/** Confere a identidade e devolve o cadastro para edição. */
export const validarDesafio = (
  token: string,
  resposta: { cpf?: string; dataNascimento?: string; coren?: string },
) =>
  chamar<{ filiado: FiliadoRecadastro; desafio: DesafioRecadastramento }>(
    `/recadastro/${token}/validar`,
    { method: 'POST', body: JSON.stringify(resposta) },
  );

/** Grava o recadastramento (o link é queimado no servidor). */
export const enviarRecadastro = (token: string, dados: Record<string, unknown>) =>
  chamar<{ ok: boolean; nome: string }>(`/recadastro/${token}/enviar`, {
    method: 'POST',
    body: JSON.stringify(dados),
  });

/**
 * Troca a foto. Precisa ir ANTES do envio — depois o link já está queimado.
 * Sem `Content-Type` manual: o browser monta o boundary do multipart.
 */
export async function enviarFotoRecadastro(token: string, foto: Blob) {
  const fd = new FormData();
  fd.append('foto', foto, 'foto.webp');
  const r = await fetch(`${BASE}/recadastro/${token}/foto`, { method: 'POST', body: fd });
  if (!r.ok) {
    const corpo = await r.text();
    const msg = corpo ? JSON.parse(corpo)?.message : null;
    throw new Error(Array.isArray(msg) ? msg[0] : msg ?? 'Não foi possível enviar a foto.');
  }
  return r.json() as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Máscaras (a tela é pública: quanto menos o filiado precisar formatar, melhor)
// ---------------------------------------------------------------------------

export function mascaraCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  let o = d.slice(0, 3);
  if (d.length > 3) o += '.' + d.slice(3, 6);
  if (d.length > 6) o += '.' + d.slice(6, 9);
  if (d.length > 9) o += '-' + d.slice(9, 11);
  return o;
}

export function mascaraTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}${d.length > 6 ? '-' + d.slice(6) : ''}`.trim();
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function mascaraCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export const SEXOS = ['MASCULINO', 'FEMININO', 'OUTRO'] as const;
export const ESTADOS_CIVIS = [
  'SOLTEIRO', 'CASADO', 'DIVORCIADO', 'VIUVO', 'UNIAO_ESTAVEL', 'OUTRO',
] as const;
export const FORMACOES = [
  'ENFERMEIRO', 'TECNICO_ENFERMAGEM', 'AUXILIAR_ENFERMAGEM', 'OUTRO',
] as const;

export const ROTULO: Record<string, string> = {
  MASCULINO: 'Masculino', FEMININO: 'Feminino', OUTRO: 'Outro',
  SOLTEIRO: 'Solteiro(a)', CASADO: 'Casado(a)', DIVORCIADO: 'Divorciado(a)',
  VIUVO: 'Viúvo(a)', UNIAO_ESTAVEL: 'União estável',
  ENFERMEIRO: 'Enfermeiro(a)', TECNICO_ENFERMAGEM: 'Técnico(a) de Enfermagem',
  AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem',
};
