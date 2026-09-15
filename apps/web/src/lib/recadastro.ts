/**
 * Recadastramento ONLINE — área pública (o filiado acessa sem login).
 *
 * Usa `fetch` puro de propósito: o cliente Axios do sistema anexa o token da
 * equipe e tenta renovar a sessão em 401 — comportamento indesejado numa tela
 * que, por definição, não tem sessão. Aqui a credencial é o token do link.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';

/**
 * O QUE O LINK PEDE PARA CONFIRMAR QUE É O FILIADO — o tipo ÚNICO do web.
 *
 * 14/09/2026: ganhou CPF e NASCIMENTO (um dado só, quando o cadastro só tem
 * aquele). Antes, CPF sem nascimento virava NENHUM, e 1.768 filiados ativos
 * recebiam link sem confirmação nenhuma. MATRICULA ficou de fora: zero filiados
 * dependeriam dela.
 *
 * `lib/filiados.ts` e `lib/envio-recadastro.ts` reusam este tipo: três cópias
 * da mesma lista já divergiram uma vez.
 */
export type DesafioRecadastramento = 'CPF_NASCIMENTO' | 'CPF' | 'COREN' | 'NASCIMENTO' | 'NENHUM';

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

/** Erro da área pública COM o status: a página decide o destino por ele. */
export class ErroDoRecadastro extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'ErroDoRecadastro';
  }
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
    throw new ErroDoRecadastro(
      Array.isArray(msg) ? msg[0] : msg ?? 'Não foi possível concluir a operação.',
      r.status,
    );
  }
  return corpo as T;
}

/**
 * ONDE O ERRO DA CONFIRMAÇÃO APARECE (15/09/2026).
 *
 * "Dados não conferem. Restam 3 tentativa(s)." saía num toast que some em
 * segundos, e a pessoa tentava de novo sem saber quantas restavam. Agora:
 *  · LINHA: fica fixa acima do botão até a próxima tentativa (dado errado,
 *    campo que falta).
 *  · LINK: o link morreu (bloqueado na 5ª, cancelado, vencido, inexistente).
 *    Não adianta insistir no formulário: a página troca para "Link
 *    indisponível", com a frase da API. A API responde 410/404; a 5ª errada
 *    volta 403 com "bloqueado" na frase, e é essa palavra que a separa.
 */
export function destinoDoErroDoDesafio(erro: unknown): 'LINHA' | 'LINK' {
  const status = (erro as { status?: unknown })?.status;
  if (status === 404 || status === 410) return 'LINK';
  const msg = (erro as { message?: unknown })?.message;
  return typeof msg === 'string' && /bloquead/i.test(msg) ? 'LINK' : 'LINHA';
}

/**
 * LINK ANTIGO SEM CONFIRMAÇÃO: o que a tela mostra (15/09/2026).
 *
 * O efeito que abre o cadastro roda DEPOIS do primeiro desenho. Nesse desenho
 * `validando` ainda é falso, e a página mostrava "Não foi possível abrir o seu
 * cadastro." por um instante antes de abrir. Antes da primeira tentativa
 * terminar, é sempre ABRINDO; FALHOU só depois de uma tentativa de verdade.
 */
export function telaDoLinkDireto(estado: { validando: boolean; tentouUmaVez: boolean }): 'ABRINDO' | 'FALHOU' {
  return !estado.validando && estado.tentouUmaVez ? 'FALHOU' : 'ABRINDO';
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

/** As respostas do desafio, como a pessoa digitou na primeira tela. */
export interface ConfirmacaoDeIdentidade {
  cpf?: string;
  dataNascimento?: string;
  coren?: string;
}

// ---------------------------------------------------------------------------
// A primeira tela: o que pedir, conforme o desafio do link
// ---------------------------------------------------------------------------

export type CampoDoDesafio = 'CPF' | 'NASCIMENTO' | 'COREN';

/**
 * O QUE A PÁGINA PÚBLICA MOSTRA ANTES DO CADASTRO.
 *
 *  · FORMULARIO: os campos e a frase. A página só desenha.
 *  · DIRETO: link NENHUM antigo. Desde 14/09/2026 a API não gera mais esse
 *    link, mas os que já estavam vivos abrem até vencer (24h).
 *  · DESATUALIZADA: um valor que este web não conhece (página velha em cache
 *    contra API nova). Antes, qualquer valor diferente de COREN caía no
 *    formulário de CPF e data: a pessoa gastava tentativas num formulário que
 *    nunca ia conferir. Aqui ela recarrega e recebe a página certa.
 */
export type PedidoDoDesafio =
  | { tipo: 'FORMULARIO'; campos: CampoDoDesafio[]; frase: string }
  | { tipo: 'DIRETO' }
  | { tipo: 'DESATUALIZADA' };

export function pedidoDoDesafio(desafio: string | null | undefined): PedidoDoDesafio {
  switch (desafio) {
    case 'CPF_NASCIMENTO':
      return {
        tipo: 'FORMULARIO',
        campos: ['CPF', 'NASCIMENTO'],
        frase: 'Para sua segurança, confirme seus dados antes de atualizar o cadastro.',
      };
    case 'CPF':
      return {
        tipo: 'FORMULARIO',
        campos: ['CPF'],
        frase: 'Para sua segurança, confirme o seu CPF antes de atualizar o cadastro.',
      };
    case 'COREN':
      return {
        tipo: 'FORMULARIO',
        campos: ['COREN'],
        frase: 'Para sua segurança, confirme o número do seu COREN antes de atualizar o cadastro.',
      };
    case 'NASCIMENTO':
      return {
        tipo: 'FORMULARIO',
        campos: ['NASCIMENTO'],
        frase: 'Para sua segurança, confirme a sua data de nascimento antes de atualizar o cadastro.',
      };
    case 'NENHUM':
      return { tipo: 'DIRETO' };
    default:
      return { tipo: 'DESATUALIZADA' };
  }
}

/** O que a pessoa digitou na primeira tela, cru. */
export interface ValoresDoDesafio {
  cpf: string;
  nascimento: string;
  coren: string;
}

/**
 * SÓ OS CAMPOS DO DESAFIO VÃO PARA A API.
 *
 * A API confere só o campo do próprio desafio. Mandar um campo que não foi
 * pedido não ajuda e, se um dia a conferência mudar, vira ruído. Vale para o
 * /validar, a foto e o envio, que repetem a confirmação.
 */
export function respostaDoDesafio(
  pedido: PedidoDoDesafio,
  valores: ValoresDoDesafio,
): ConfirmacaoDeIdentidade {
  if (pedido.tipo !== 'FORMULARIO') return {};
  const r: ConfirmacaoDeIdentidade = {};
  if (pedido.campos.includes('CPF')) {
    const cpf = valores.cpf.replace(/\D/g, '');
    if (cpf) r.cpf = cpf;
  }
  if (pedido.campos.includes('NASCIMENTO') && valores.nascimento) {
    r.dataNascimento = valores.nascimento;
  }
  if (pedido.campos.includes('COREN') && valores.coren.trim()) {
    r.coren = valores.coren.trim();
  }
  return r;
}

/**
 * O QUE AINDA FALTA ANTES DE GASTAR UMA TENTATIVA.
 *
 * O link bloqueia depois de 5 respostas erradas, e campo vazio ou CPF pela
 * metade conta como resposta errada na API. Barrar aqui não é segurança (a API
 * confere de novo); é não queimar tentativa com erro de digitação.
 */
export function faltaNoDesafio(pedido: PedidoDoDesafio, valores: ValoresDoDesafio): string | null {
  if (pedido.tipo !== 'FORMULARIO') return null;
  if (pedido.campos.includes('CPF')) {
    const digitos = valores.cpf.replace(/\D/g, '');
    if (!digitos) return 'Preencha o CPF.';
    if (digitos.length !== 11) return 'Confira o CPF: são 11 números.';
  }
  if (pedido.campos.includes('NASCIMENTO') && !valores.nascimento) {
    return 'Preencha a data de nascimento.';
  }
  if (pedido.campos.includes('COREN') && !valores.coren.trim()) {
    return 'Preencha o número do COREN.';
  }
  return null;
}

/**
 * O MULTIPART DA FOTO LEVA O DESAFIO (13/09/2026).
 *
 * Bastava o token para trocar a foto da carteirinha, e a anterior some do
 * storage. Agora a API confere as mesmas respostas do /validar, e o erro conta
 * nas mesmas tentativas. Vai só o que foi preenchido: link sem desafio manda só
 * a foto.
 */
export function formularioDaFoto(foto: Blob, confirmacao: ConfirmacaoDeIdentidade = {}): FormData {
  const fd = new FormData();
  for (const campo of ['cpf', 'dataNascimento', 'coren'] as const) {
    const valor = confirmacao[campo];
    if (valor) fd.append(campo, valor);
  }
  fd.append('foto', foto, 'foto.webp');
  return fd;
}

/**
 * Troca a foto. Precisa ir ANTES do envio — depois o link já está queimado.
 * Sem `Content-Type` manual: o browser monta o boundary do multipart.
 */
export async function enviarFotoRecadastro(
  token: string,
  foto: Blob,
  confirmacao: ConfirmacaoDeIdentidade = {},
) {
  const fd = formularioDaFoto(foto, confirmacao);
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

// ---------------------------------------------------------------------------
// Conferência do que o filiado mandou pelo link (tela da equipe)
// ---------------------------------------------------------------------------

const DATA_PURA = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.0+)?Z)?$/;

/**
 * Um valor do de→para em texto de gente.
 *
 * Data pura ("1980-05-02" ou meia-noite UTC) é recortada do texto, nunca passa
 * por `new Date` — no fuso de Teresina ela andaria um dia para trás. Vazio é
 * "vazio", e não um traço: na conferência, "estava vazio e agora tem" é a
 * informação.
 */
export function valorDaAlteracao(valor: unknown): string {
  if (valor === null || valor === undefined) return 'vazio';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : 'vazio';
  if (typeof valor === 'string') {
    const t = valor.trim();
    if (!t) return 'vazio';
    const d = DATA_PURA.exec(t);
    if (d) return `${d[3]}/${d[2]}/${d[1]}`;
    return ROTULO[t] ?? t;
  }
  if (Array.isArray(valor)) {
    if (valor.length === 0) return 'nenhum';
    return valor
      .map((item) => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const nome = o.nome ?? o.empresa ?? o.rotulo;
          if (typeof nome === 'string' && nome.trim()) return nome.trim();
          return JSON.stringify(item);
        }
        return valorDaAlteracao(item);
      })
      .join('; ');
  }
  return JSON.stringify(valor);
}

/**
 * O que ainda espera conferência: o que veio pelo link (ONLINE) e segue
 * PENDENTE. O presencial já nasce APROVADO — quem preencheu foi a equipe.
 */
export function recadastramentosAConferir<
  T extends { status: string; origem?: 'ONLINE' | 'PRESENCIAL' },
>(lista: T[] | null | undefined): T[] {
  return (lista ?? []).filter((r) => r.status === 'PENDENTE' && r.origem !== 'PRESENCIAL');
}
