/**
 * "A COTA FOI DE OUTRO" — como reconhecer um 429 do CNJ.
 *
 * 24/09/2026, decidindo se a varredura noturna devia ir mais devagar. Medido
 * antes, e a medição derrubou a pergunta:
 *
 *   ritmo real da varredura ..... 1 a 2 chamadas por MINUTO
 *   cota do CNJ ................. 20 por minuto
 *   429 em 24/09 ................ 9 de 169 (5,3%)
 *   429 nos 8 dias anteriores ... ZERO
 *
 * Estamos a um décimo da cota. O 429 veio de fora: o IP do Railway é
 * compartilhado, e naquela manhã alguém gastou a cota antes de nós. Espaçar
 * mais alongaria a rodada sem ganhar nada.
 *
 * O que faltava era tratar o 429 pelo que ele é — **"tente daqui a pouco"** — em
 * vez de tratá-lo como "este processo falhou". Ver o laço de repescagem em
 * `processos-cron.service`.
 *
 * O RECONHECIMENTO É DEFENSIVO de propósito: o erro chega de camadas diferentes
 * (axios, o cliente do CNJ, o nosso disjuntor) e nem sempre com `status`. Um
 * falso positivo aqui custa uma chamada extra na madrugada; um falso negativo
 * custa um dia de atualização do processo. A balança é óbvia.
 */

/** O 429 pode vir como número, como texto, ou só na mensagem. */
export function ehCotaEstourada(err: unknown): boolean {
  if (!err) return false;

  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };

  const status = Number(e.response?.status ?? e.status ?? e.statusCode);
  if (status === 429) return true;

  const msg = typeof e.message === 'string' ? e.message : '';
  /*
    "HTTP 429" é o que o nosso cliente escreve no log; "Too Many Requests" é o
    que o CNJ devolve; "limite de consultas" é como a mensagem traduzida chega
    à tela. Os três são a mesma coisa.
  */
  return /\b429\b|too many requests|limite de consultas/i.test(msg);
}
