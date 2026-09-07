/**
 * O SINDICATO ESTÁ NESTE ATO? — a pergunta que separa o nosso do particular.
 *
 * A varredura do DJEN consulta por OAB, e o CNJ devolve a carteira INTEIRA de
 * cada advogado: as causas do sindicato e as particulares dele. Tudo que não
 * casava com um `Processo.numeroCNJ` cadastrado era descartado na ingestão, e
 * isso está certo — o processo particular de quem trabalha aqui não é assunto
 * do sindicato e não pode virar linha no banco.
 *
 * Só que junto ia o caso NOVO do próprio sindicato: ação recém-distribuída em
 * que um dos nossos advogados já está no polo, ainda sem cadastro aqui. O
 * Diário anunciava e o sistema jogava fora.
 *
 * Este arquivo é o filtro estreito que separa um do outro. Se a resposta é
 * "sim, somos parte", vira sugestão de cadastro; se não, continua sendo
 * descartado como sempre foi.
 *
 * POR QUE A SIGLA, E NÃO O NOME COMPLETO. O nome que o tribunal escreve não é o
 * do cadastro. Conferido na produção em 07/09/2026:
 *
 *   cadastro:  "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ"
 *   o DJEN:    "SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI"
 *
 * Vírgula a mais, "AUXILIARES" no meio, "EM" no lugar de "DE", sem acento.
 * Comparar nome com nome erraria em todas. A SIGLA, ao contrário, é o apelido
 * que o próprio tribunal repete: das 1.408 publicações do acervo, **1.034 têm a
 * sigla entre os destinatários e ZERO trazem o nome sem ela**. Ou seja, a sigla
 * não perde nenhum caso que o nome pegaria.
 *
 * E ela vem do CADASTRO (`ParteExterna.nomeFantasia` da parte institucional),
 * não de uma constante — são dois sindicatos no mesmo código.
 */

/** Sem acento, sem pontuação, em caixa alta e com espaços colapsados. */
export function normalizarNome(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    // Acentos combinantes escritos como ESCAPE: o intervalo cru são
    // caracteres invisíveis no fonte e some no primeiro round-trip de
    // encoding sem ninguém ver — e aí a normalização passa a errar em
    // silêncio justamente nos nomes acentuados.
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Como o DJEN manda o polo de cada destinatário. */
type DestinatarioDjen = { nome?: string | null; polo?: string | null };

/**
 * De que lado o sindicato aparece — e "dos dois" é uma resposta legítima.
 *
 * `ATIVO`/`PASSIVO` são o `A`/`P` do DJEN. `AMBOS` não é defeito de leitura: em
 * recurso o sindicato figura como recorrente E recorrido, e o próprio tribunal
 * lista os dois. Medido nas 1.408 publicações do acervo em 07/09/2026: 754 só
 * como autor, 167 só como réu e **113 nos dois** — 11% do total.
 *
 * A primeira versão desta função devolvia o primeiro polo que encontrasse no
 * array. Nas 113 isso era um CHUTE com cara de fato: metade das vezes diria
 * "movemos contra alguém" sobre uma ação em que estamos sendo cobrados. Preferir
 * ATIVO "porque é o mais comum" teria o mesmo problema, só que sistematicamente.
 *
 * `INDEFINIDO` é quando o sindicato está no ato mas o tribunal não classificou o
 * polo — raro, e ainda assim caso para alguém olhar: informação incompleta é
 * exatamente quando o julgamento humano vale mais.
 */
export type PoloDetectado = 'ATIVO' | 'PASSIVO' | 'AMBOS' | 'INDEFINIDO';

export function nossoPoloNoAto(
  destinatarios: unknown,
  sigla: string | null | undefined,
): PoloDetectado | null {
  const alvo = normalizarNome(sigla);
  /*
    SIGLA CURTA DEMAIS NÃO SERVE DE CHAVE. Duas ou três letras casariam dentro de
    qualquer razão social e transformariam processo de terceiro em sugestão —
    exatamente o dado que esta função existe para NÃO persistir. Sem sigla
    utilizável, ninguém é nós.
  */
  if (alvo.length < 4) return null;
  if (!Array.isArray(destinatarios)) return null;

  let ativo = false;
  let passivo = false;
  let outro = false;

  // Percorre TODOS: parar no primeiro é o que produzia o chute nas 113.
  for (const bruto of destinatarios as DestinatarioDjen[]) {
    const nome = normalizarNome(bruto?.nome);
    if (!nome) continue;
    /*
      Fronteira de palavra: sem ela, "SENATEPI" casaria dentro de
      "PROSENATEPINHO". O tribunal também escreve "2. SINDICATO ... - SENATEPI
      (RECORRIDO)", e por isso a busca é por CONTER a palavra, e não por
      igualdade com a string inteira.
    */
    if (!nome.split(' ').includes(alvo)) continue;

    const polo = (bruto?.polo ?? '').trim().toUpperCase();
    if (polo === 'A') ativo = true;
    else if (polo === 'P') passivo = true;
    else outro = true;
  }

  if (ativo && passivo) return 'AMBOS';
  if (ativo) return 'ATIVO';
  if (passivo) return 'PASSIVO';
  if (outro) return 'INDEFINIDO';
  return null;
}
