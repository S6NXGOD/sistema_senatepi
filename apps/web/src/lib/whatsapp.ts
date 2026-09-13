/**
 * WHATSAPP — o número e o link, num lugar só.
 *
 * Havia três montagens de `wa.me` no sistema, e as três erravam de um jeito:
 *   - `55${dígitos}` sem conferir nada: número já gravado com DDI virava 5555…;
 *   - "10 dígitos ou mais serve": telefone FIXO passava, e o WhatsApp abria uma
 *     conversa com um número que não tem WhatsApp;
 *   - "começa com 55, então já tem DDI": um celular do Rio Grande do Sul (DDD 55)
 *     gravado sem DDI ficava sem o 55 do país e abria a conversa ERRADA;
 *   - nenhuma lia o telefone SECUNDÁRIO — que é justamente onde a importação
 *     grava o "celular" (383 filiados ativos só têm celular ali).
 *
 * O telefone no cadastro é texto livre: "(86) 99999-9999", "086 999999999",
 * "+55 86 9 9999-9999". A regra abaixo aceita todos esses e recusa o resto.
 *
 * A API tem a MESMA regra (celularWhatsApp do envio do recadastro), com a mesma
 * tabela de casos no teste. Mudou aqui, muda lá.
 */

/** Só os dígitos. */
function digitos(telefone: string | null | undefined): string {
  return (telefone ?? '').replace(/\D/g, '');
}

/**
 * Um telefone → celular brasileiro com DDI (`55` + 11 dígitos), ou `null`.
 *
 *   1. fica só com os dígitos;
 *   2. tira os zeros da frente (prefixo de operadora "0 86…", ou "00 55…");
 *   3. aceita o DDI 55 APENAS quando o número tem 12 ou 13 dígitos — com 11,
 *      o "55" do começo é o DDD do Rio Grande do Sul, não o país;
 *   4. exige 11 dígitos com o terceiro igual a 9 (celular). Fixo e número
 *      antigo de 8 dígitos devolvem `null`.
 */
function celularDeUmTelefone(telefone: string | null | undefined): string | null {
  let d = digitos(telefone).replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 11) return null;
  if (d[2] !== '9') return null;
  return `55${d}`;
}

/**
 * O número que o WhatsApp entende (`5586999998888`), tentando o principal e,
 * se ele não for um celular utilizável, o secundário. `null` quando nenhum dos
 * dois é celular — o botão deve ficar desabilitado com o motivo escrito.
 */
export function celularParaWhatsApp(
  principal?: string | null,
  secundario?: string | null,
): string | null {
  return celularDeUmTelefone(principal) ?? celularDeUmTelefone(secundario);
}

/**
 * Link `https://wa.me/<número>?text=<mensagem>`.
 *
 * Espera o número já passado por `celularParaWhatsApp`. Se receber um telefone
 * cru, normaliza pela mesma regra; se não for celular, usa os dígitos como
 * vieram (quem chama é que decidiu oferecer o botão).
 */
export function linkWhatsApp(celular: string, texto?: string): string {
  const numero = celularParaWhatsApp(celular) ?? digitos(celular);
  const base = `https://wa.me/${numero}`;
  return texto ? `${base}?text=${encodeURIComponent(texto)}` : base;
}
