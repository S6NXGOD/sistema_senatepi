/**
 * O CELULAR QUE O WHATSAPP ENTENDE — a mesma regra do web (`apps/web/src/lib/whatsapp.ts`).
 *
 * Mora aqui porque a rota de envio do link devolve `celularWhatsApp`, e a tela
 * decide por ele se o botão de WhatsApp fica habilitado. Se as duas regras
 * divergirem, a API diz "tem celular" e o botão abre uma conversa com um fixo —
 * ou o contrário. Por isso o spec tem a MESMA tabela de casos do web.
 *
 * Por que a regra é esta (medido em 12/09/2026): o telefone é texto livre, a
 * página pública grava com máscara e a importação grava como vier; 383 filiados
 * ativos só têm celular no telefone SECUNDÁRIO. E o DDD 55 (Rio Grande do Sul)
 * não é o DDI: com 11 dígitos, o "55" do começo é o DDD.
 */

function digitos(telefone: string | null | undefined): string {
  return (telefone ?? '').replace(/\D/g, '');
}

function celularDeUmTelefone(telefone: string | null | undefined): string | null {
  let d = digitos(telefone).replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 11) return null;
  if (d[2] !== '9') return null;
  return `55${d}`;
}

/** `5586999998888`, tentando o principal e depois o secundário; `null` se nenhum é celular. */
export function celularParaWhatsApp(
  principal?: string | null,
  secundario?: string | null,
): string | null {
  return celularDeUmTelefone(principal) ?? celularDeUmTelefone(secundario);
}
