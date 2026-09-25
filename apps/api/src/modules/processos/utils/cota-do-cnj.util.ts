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
    statusUpstream?: unknown;
    response?: { status?: unknown };
    message?: unknown;
  };

  /*
    `statusUpstream` PRIMEIRO, E ELE QUASE FICOU DE FORA (25/09/2026).

    `DatajudIndisponivelError` estende `ServiceUnavailableException`: o `.status`
    dele é **503**, o nosso; o do CNJ mora em `statusUpstream`. Enquanto a
    mensagem carregava a palavra "429", o reconhecimento funcionava POR TEXTO e
    ninguém notou que o campo estrutural nunca era lido.

    Ao reescrever a mensagem para dizer o que a pessoa precisa saber — sem
    código de protocolo, que não é recado para gente — o texto deixou de conter
    "429" e a repescagem noturna do cron pararia de reconhecer a cota **em
    silêncio**: o processo viraria falha comum e perderia o dia. Ler o campo
    resolve de vez, e não depende mais de como a frase estiver escrita.
  */
  if (Number(e.statusUpstream) === 429) return true;

  const status = Number(e.response?.status ?? e.status ?? e.statusCode);
  if (status === 429) return true;

  const msg = typeof e.message === 'string' ? e.message : '';
  /*
    "HTTP 429" é o que o nosso cliente escrevia no log; "Too Many Requests" é o
    que o CNJ devolve; "limite de consultas" e "excesso de consultas" são como a
    mensagem traduzida chega à tela. Todas são a mesma coisa.
  */
  return /\b429\b|too many requests|limite de consultas|excesso de consultas/i.test(msg);
}
