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

/**
 * "O CNJ DEMOROU DEMAIS" — e por que isso também merece uma segunda chance.
 *
 * 10/10/2026. A faixa do painel acusava 10 processos sem leitura há 64–114h, e
 * a pergunta do dono foi se havia problema nas leituras. Havia, e não era dos
 * processos. Medido na produção:
 *
 *   mediana de uma consulta ao DataJud, de madrugada, pelo Railway
 *     semana de 24/08 ...... 0,9 s
 *     semana de 14/09 ...... 4,7 s
 *     semana de 28/09 ..... 27,6 s
 *     semana de 05/10 ..... 30,5 s      ← 30× mais lenta em seis semanas
 *
 *   falhas da varredura, por motivo (12 dias)
 *     estouro do NOSSO teto de 45s .... 103
 *     429 (cota do IP compartilhado) ... 94
 *     dois estouros no mesmo processo .. 12
 *
 *   a rodada inteira
 *     28/09 ....... 18 minutos, 0 falhas
 *     10/10 ..... 2h03min, 25 falhas de 167
 *
 * O timeout virou o motivo de falha MAIS COMUM — e ele é nosso, não do CNJ.
 *
 * E A REPESCAGEM JÁ EXISTIA, só que só para o 429. Medido no fim de cada
 * rodada, onde ela acontece: **17 de 19, 13 de 16, 18 de 20, 28 de 28** deram
 * certo na segunda tentativa. Quem estourou o teto ficava de fora dessa fila e
 * perdia a noite inteira — até cruzar as 48h e virar alarme na tela.
 *
 * RECONHECIMENTO ESTRUTURAL, e não por texto: `statusUpstream = 408`, gravado
 * por `datajud.service` no momento do `AbortError`. A lição é a do 429 logo
 * acima — enquanto o reconhecimento morava na frase, reescrever a frase
 * quebrava a repescagem em silêncio.
 */
export function ehDemoraDoCnj(err: unknown): boolean {
  if (!err) return false;
  const e = err as { statusUpstream?: unknown; name?: unknown; code?: unknown };
  if (Number(e.statusUpstream) === 408) return true;
  // O aborto cru, caso algum caminho novo não passe pelo erro tipado.
  return e.name === 'AbortError' || e.name === 'TimeoutError';
}

/**
 * Vale uma segunda tentativa no fim da rodada?
 *
 * As duas causas têm a mesma natureza — "agora não dá, daqui a pouco dá" — e
 * nenhuma delas é defeito do processo. O que NÃO entra aqui é o erro que a
 * segunda tentativa repetiria igual: NPU que o índice não conhece, tribunal
 * sem alias, processo apagado.
 */
export function valeTentarDeNovo(err: unknown): boolean {
  return ehCotaEstourada(err) || ehDemoraDoCnj(err);
}
