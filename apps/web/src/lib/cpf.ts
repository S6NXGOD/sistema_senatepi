/**
 * O DÍGITO VERIFICADOR DO CPF, DO LADO DE CÁ — 22/09/2026.
 *
 * O web não tinha nenhum: toda checagem de CPF acontecia na API. Serviu
 * enquanto quem digitava era a equipe, com a ficha aberta e a API a um toque.
 * Deixou de servir quando o próprio filiado passou a informar o CPF pelo link
 * (`IDENTIFICACAO`): lá, um dígito trocado vira uma ida ao servidor e uma
 * mensagem de erro, no celular, em pé, com a pessoa achando que o sistema não
 * a reconheceu.
 *
 * E PIOR QUE A IDA: no servidor a conferência do desafio corre dentro do
 * contador de tentativas. Erro de digitação não gasta tentativa (a API trata
 * IDENTIFICACAO antes de reservar), mas depender disso para uma coisa que o
 * navegador resolve sem rede seria deixar a rede no caminho à toa.
 *
 * É A MESMA CONTA da API (`importacao/mapeamento.util.ts`). Duas cópias de uma
 * regra costumam divergir; esta não diverge porque não é regra de negócio deste
 * sistema — é a norma da Receita Federal, de 1965, e ela não muda. O que não
 * se duplica é a DECISÃO: quem diz se o CPF entra no cadastro continua sendo a
 * API, que também confere unicidade. Aqui é só para avisar antes.
 */

/** Só os dígitos, no máximo 11 — a máscara da tela não chega ao cálculo. */
const soDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

export function cpfValido(valor: string | null | undefined): boolean {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11) return false;
  // 111.111.111-11 e os outros dez passam na conta dos dígitos e não existem.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
  let d1 = (soma * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
  let d2 = (soma * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === Number(cpf[10]);
}

/**
 * O QUE DIZER ENQUANTO A PESSOA DIGITA — e quando calar.
 *
 * Um campo que fica vermelho no primeiro caractere ensina a ignorar o vermelho.
 * Enquanto não há 11 dígitos, não há erro: há alguém digitando. Vazio também
 * não é erro aqui (quem exige o campo é o formulário, com a sua própria frase).
 *
 * Devolve `null` quando não há nada a dizer.
 */
export function erroDoCpf(valor: string | null | undefined): string | null {
  const cpf = soDigitos(valor);
  if (cpf.length < 11) return null;
  if (cpfValido(cpf)) return null;
  return 'Este CPF não parece certo. Confira os números.';
}
