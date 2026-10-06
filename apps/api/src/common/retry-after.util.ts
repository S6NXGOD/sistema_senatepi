/**
 * QUANTO ESPERAR, SEGUNDO O PRÓPRIO SERVIDOR QUE RECUSOU.
 *
 * `Retry-After` vem em segundos ou como data HTTP (as duas formas são válidas
 * pela RFC, e servidores atrás de CDN usam as duas). Ler o que o servidor diz é
 * melhor que arbitrar um minuto: um castigo maior que o necessário atrasa a
 * fila da casa inteira, e um menor faz a próxima chamada tomar a mesma recusa.
 *
 * Devolve nulo quando não há cabeçalho ou ele não faz sentido — aí quem chama
 * usa o próprio palpite.
 *
 * MORA EM `common` DE PROPÓSITO (06/10/2026). Nasceu dentro de
 * `datajud.service.ts`, e o Tesouro (SICONFI) precisou da mesma conta ao levar
 * 42 respostas 429 numa rodada. Importar o serviço de um módulo Nest a partir
 * de outro fecha ciclo de importação, e isso só o dev pega — a mesma armadilha
 * que já custou caro quando as Contas Públicas foram ligadas ao processo.
 */

/** Teto: nenhum cabeçalho prende a fila da casa por mais de 5 minutos. */
const TETO_MS = 300_000;

export function esperaDoRetryAfter(
  valor: string | null | undefined,
  agora = Date.now(),
): number | null {
  if (!valor) return null;
  const texto = valor.trim();
  if (!texto) return null;

  if (/^\d+$/.test(texto)) {
    const segundos = Number(texto);
    if (segundos <= 0 || segundos * 1_000 > TETO_MS) return null;
    return segundos * 1_000;
  }

  const quando = Date.parse(texto);
  if (Number.isNaN(quando)) return null;
  const ms = quando - agora;
  if (ms <= 0 || ms > TETO_MS) return null;
  return ms;
}
