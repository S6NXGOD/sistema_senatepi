/**
 * Dados do filiado que NÃO mudam ao longo da vida.
 *
 * Por que travar
 * --------------
 * Recadastramento e atualização cadastral existem para corrigir o que muda:
 * telefone, endereço, emprego, dependentes. CPF e data de nascimento não
 * mudam — se estão diferentes do documento, houve erro de digitação, e
 * "corrigir" isso no meio de um recadastramento em massa é como um cadastro
 * silenciosamente vira o de outra pessoa.
 *
 * A porta para corrigir continua aberta: a EDIÇÃO direta do filiado
 * (PATCH /filiados/:id, tela de Editar) não passa por aqui. É uma ação da
 * equipe, deliberada, e fica na auditoria.
 *
 * A exceção que importa
 * ---------------------
 * Campo VAZIO continua editável. Boa parte da base foi importada sem CPF, sem
 * RG ou sem nascimento; o recadastramento é justamente a chance de preencher.
 * Travar um campo em branco impediria o sistema de completar o cadastro.
 */

/** Campos protegidos quando já têm valor. */
export const CAMPOS_IMUTAVEIS = [
  'cpf',
  'rg',
  'ufRg',
  'dataNascimento',
  'naturalidade',
] as const;

export type CampoImutavel = (typeof CAMPOS_IMUTAVEIS)[number];

export const ROTULO_IMUTAVEL: Record<CampoImutavel, string> = {
  cpf: 'CPF',
  rg: 'RG',
  ufRg: 'UF do RG',
  dataNascimento: 'Data de nascimento',
  naturalidade: 'Naturalidade',
};

/** Um valor "presente" — string vazia e null contam como ausente. */
function preenchido(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

/** Compara ignorando máscara e hora, para não acusar mudança onde não houve. */
function mudou(campo: CampoImutavel, atual: unknown, novo: unknown): boolean {
  if (!preenchido(novo)) return false; // não enviar o campo não é tentar mudar

  if (campo === 'dataNascimento') {
    const dia = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10);
    return dia(atual) !== dia(novo);
  }
  if (campo === 'cpf') {
    const so = (v: unknown) => String(v ?? '').replace(/\D/g, '');
    return so(atual) !== so(novo);
  }
  const txt = (v: unknown) => String(v ?? '').trim().toUpperCase();
  return txt(atual) !== txt(novo);
}

export interface ResultadoProtecao<T> {
  /** DTO já sem as alterações barradas. */
  dados: T;
  /** Rótulos dos campos que foram ignorados (para avisar quem enviou). */
  ignorados: string[];
}

/**
 * Remove do DTO qualquer tentativa de alterar um campo imutável que JÁ tenha
 * valor. Campos vazios no cadastro passam livremente.
 *
 * Silenciosamente ignorar é melhor do que recusar a requisição inteira: o
 * recadastramento traz dezenas de campos, e derrubar tudo porque o CPF veio
 * junto (mesmo sem mudança real) faria o filiado perder o preenchimento.
 */
export function protegerImutaveis<T extends Record<string, unknown>>(
  atual: Record<string, unknown>,
  dto: T,
): ResultadoProtecao<T> {
  const dados = { ...dto };
  const ignorados: string[] = [];

  for (const campo of CAMPOS_IMUTAVEIS) {
    if (!(campo in dados)) continue;

    // Campo em branco no cadastro: o envio PREENCHE (é o caso da base importada).
    if (!preenchido(atual[campo])) continue;

    if (mudou(campo, atual[campo], dados[campo])) {
      ignorados.push(ROTULO_IMUTAVEL[campo]);
    }
    // Vindo igual ou diferente, o valor do banco prevalece.
    delete dados[campo];
  }

  return { dados, ignorados };
}
