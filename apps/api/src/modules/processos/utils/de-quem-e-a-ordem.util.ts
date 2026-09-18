/**
 * A ORDEM DO ATO É NOSSA, OU DA PARTE CONTRÁRIA?
 *
 * POR QUE ISTO EXISTE
 * O robô lia o teor, achava "no prazo de 15 dias" e criava tarefa para o
 * advogado do sindicato. Só que o tribunal publica o MESMO ato para todos os
 * intimados, e o prazo costuma ser de um lado só. Caso real da produção
 * (0000978-59.2022.5.22.0004):
 *
 *   "INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS"
 *
 * Não há uma linha para nós no ato inteiro, e mesmo assim nasceu "Elaborar
 * manifestação" na agenda de um advogado nosso. Outro caso
 * (0002664-81.2025.5.22.0101) traz as duas ordens — uma para a executada, outra
 * para o sindicato exequente — e aí a tarefa é legítima.
 *
 * Medido em 07/09/2026: das 14 atividades que o robô criou, 5 já tinham sido
 * CANCELADAS à mão. A equipe vinha limpando a sujeira toda semana, em silêncio.
 *
 * COMO DECIDE
 * Procura as ordens do juízo ("intime-se", "fica intimada", "cite-se") e olha a
 * quem cada uma se dirige. O destinatário vira um LADO comparando o papel
 * processual ("reclamada", "exequente") com o polo que o SINDICATO ocupa NAQUELE
 * processo — porque "intime-se a executada" é ordem nossa quando somos nós a
 * executada.
 *
 * NA DÚVIDA, CRIA A TAREFA. Este arquivo só sabe dizer "não" com certeza: basta
 * uma ordem nossa, ou uma ordem que não dê para atribuir, para a tarefa nascer
 * como sempre nasceu. Deixar de avisar um prazo custa o prazo; avisar um que
 * não era nosso custa um clique. A assimetria decide o desenho.
 *
 * Função pura, testável sem banco nem rede — mesmo padrão de `providencia.util`.
 */

export type LadoDaOrdem = 'NOSSA' | 'DA_OUTRA_PARTE' | 'INDEFINIDO';

/**
 * Verbos com que o juízo manda alguém fazer algo, e o destinatário logo depois.
 *
 * `INTIMEM-SE`/`CITEM-SE` no plural entram: eles quase sempre significam "todas
 * as partes", e aí a ordem é nossa também.
 */
/*
  O ARTIGO VEM COM AS ALTERNATIVAS MAIS LONGAS PRIMEIRO.

  Escrito como `(?:A|O|AS|OS)?`, a alternância casava "A" em "AS PARTES" e o
  destinatário chegava como "S PARTES DO INTEIRO TEOR" — regex tenta as
  alternativas da esquerda para a direita e aceita a primeira que serve, sem
  procurar a maior. O mesmo estrago em "OS INTERESSADOS".

  E o artigo exige espaço depois (`\s+`): sem isso, "AS" casaria o começo de
  "ASSISTENCIA" e comeria duas letras do nome de quem foi intimado.
*/
const RE_ORDEM =
  /(?:INTIME[- ]?SE|INTIMEM[- ]?SE|INTIMO|NOTIFIQUE[- ]?SE|NOTIFIQUEM[- ]?SE|CITE[- ]?SE|CITEM[- ]?SE|FICA[M]? (?:A PARTE |O |A )?INTIMAD[OA]S?)\s+(?:(?:ÀS|AS|OS|À|A|O)\s+)?([^.;:\n]{0,70})/g;

/** Papéis de quem PROPÔS a ação. */
const PAPEL_ATIVO =
  /\b(AUTOR|AUTORA|RECLAMANTE|EXEQUENTE|REQUERENTE|IMPETRANTE|EMBARGANTE|AGRAVANTE|SUSCITANTE)\b/;

/** Papéis de contra quem a ação foi proposta. */
const PAPEL_PASSIVO =
  /\b(REU|RE|RECLAMAD[AO]|EXECUTAD[AO]|REQUERID[AO]|IMPETRAD[AO]|EMBARGAD[AO]|AGRAVAD[AO]|SUSCITAD[AO])\b/;

/**
 * "TODAS AS PARTES" é ordem nossa também — e é comum no fim de despacho.
 *
 * `^PARTES` existe porque o artigo já foi consumido pela regex da ordem:
 * "INTIMEM-SE AS PARTES DO INTEIRO TEOR" chega aqui como "PARTES DO INTEIRO
 * TEOR". Sem essa âncora o caso caía em INDEFINIDO — inofensivo, porque
 * indefinido cria a tarefa, mas errado. Foi o teste que apontou.
 */
const TODAS_AS_PARTES =
  /^PARTES\b|\b(AS PARTES|AMBAS AS PARTES|OS INTERESSADOS|TODOS OS INTERESSADOS)\b/;

/** Sem acento, maiúsculo, espaço único — a mesma régua do resto do módulo. */
export function normalizarTeor(texto: string): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * A quem esta ordem se dirige, do nosso ponto de vista.
 *
 * `sigla` entra porque o ato costuma nomear o sindicato por extenso ou pela
 * sigla, e nesses casos não é preciso raciocinar sobre papel nenhum.
 */
function ladoDoDestinatario(
  destinatario: string,
  nossoPolo: 'ATIVO' | 'PASSIVO' | null,
  sigla: string,
): LadoDaOrdem {
  const d = destinatario;

  // O ato nos nomeia: é conosco, qualquer que seja o papel escrito.
  const siglaNormalizada = normalizarTeor(sigla).replace(/[^A-Z0-9]/g, '');
  if (siglaNormalizada.length >= 4 && d.replace(/[^A-Z0-9]/g, '').includes(siglaNormalizada)) {
    return 'NOSSA';
  }
  if (TODAS_AS_PARTES.test(d)) return 'NOSSA';

  /*
    "SINDICATO" sozinho só vale quando o sindicato é parte deste processo.

    Em ação contra outro sindicato (SINSEP, SINDHOSPI — dois casos reais no
    acervo) a palavra aparece dos dois lados, e tratá-la como nossa devolveria
    o bug com outra roupa.
  */
  const ehSindicatoGenerico = /\bSINDICATO\b/.test(d);

  /*
    "A PARTE CONTRÁRIA" É RELATIVA A QUEM AGIU — e muitas vezes somos nós.

    Dois despachos abertos na produção dizem: "RECEBO OS EMBARGOS OPOSTOS PELA
    RECLAMADA, FICANDO A PARTE CONTRÁRIA DEVIDAMENTE INTIMADA PARA SE
    MANIFESTAR NO PRAZO DE CINCO DIAS". Quem embargou foi a reclamada, então a
    "parte contrária" é o sindicato — e as duas tarefas estão certas.

    Hoje a regex nem casa essa construção ("FICANDO", com palavras no meio) e o
    caso cai em INDEFINIDO, que cria a tarefa. Deu certo por acaso. Esta guarda
    existe para que continue certo quando alguém ampliar a regex: a expressão é
    ambígua por natureza e NUNCA pode bloquear.
  */
  if (/\bPARTE[S]? CONTRARIA[S]?\b/.test(d)) return 'INDEFINIDO';

  const ativo = PAPEL_ATIVO.test(d);
  const passivo = PAPEL_PASSIVO.test(d);
  // "reclamante e reclamada" na mesma ordem: é para os dois.
  if (ativo && passivo) return 'NOSSA';

  if (!nossoPolo) return ehSindicatoGenerico ? 'NOSSA' : 'INDEFINIDO';
  if (ativo) return nossoPolo === 'ATIVO' ? 'NOSSA' : 'DA_OUTRA_PARTE';
  if (passivo) return nossoPolo === 'PASSIVO' ? 'NOSSA' : 'DA_OUTRA_PARTE';

  return ehSindicatoGenerico ? 'NOSSA' : 'INDEFINIDO';
}

/**
 * O veredito do ato inteiro.
 *
 * `DA_OUTRA_PARTE` só sai quando há ordem E todas elas são atribuíveis à outra
 * parte. Uma ordem indefinida no meio basta para o resultado virar
 * `INDEFINIDO`, e indefinido cria tarefa.
 */
export function deQuemEAOrdem(
  texto: string,
  nossoPolo: 'ATIVO' | 'PASSIVO' | null,
  sigla: string,
): LadoDaOrdem {
  const t = normalizarTeor(texto);
  RE_ORDEM.lastIndex = 0;

  const lados: LadoDaOrdem[] = [];
  for (const m of t.matchAll(RE_ORDEM)) {
    const destinatario = (m[1] ?? '').trim();
    if (!destinatario) continue;
    lados.push(ladoDoDestinatario(destinatario, nossoPolo, sigla));
  }

  if (!lados.length) return 'INDEFINIDO';
  if (lados.includes('NOSSA')) return 'NOSSA';
  if (lados.every((l) => l === 'DA_OUTRA_PARTE')) return 'DA_OUTRA_PARTE';
  return 'INDEFINIDO';
}

/**
 * E O PRAZO ESCRITO NO ATO — DE QUEM É? (17/09/2026)
 *
 * A ordem e o prazo são coisas diferentes, e o ato mistura as duas. Caso real
 * da produção (0001381-91.2023.5.22.0101, o sindicato é AUTOR):
 *
 *   "Fica V. Sa. intimado para tomar ciência da Decisão ID f94d451 (...)
 *    este Juízo determinou que a executada complementasse a documentação (...)
 *    no prazo improrrogável de 15 (quinze) dias."
 *
 * A ordem para nós é TOMAR CIÊNCIA. O prazo de 15 dias é da executada. Mesmo
 * assim nasceu "Juntar documentos" na agenda, e a advogada fechou escrevendo
 * "Prazo direcionado à empresa Reclamada". Outro caso igual no mesmo mês.
 *
 * COMO DECIDE: olha só as FRASES que têm prazo e pergunta de quem é a obrigação
 * naquela frase — pelo nome do sindicato ou pelo papel processual comparado com
 * o polo que ele ocupa. Fora disso não opina.
 *
 * E OPINA PARA MENOS, como o resto deste arquivo: `DA_OUTRA_PARTE` só sai
 * quando existe prazo e TODOS são atribuíveis à outra parte. Um prazo nosso, ou
 * um que não dê para atribuir, devolve o ato ao caminho normal.
 */
export type LadoDoPrazo = 'NOSSO' | 'NOSSO_FUTURO' | 'DA_OUTRA_PARTE' | 'INDEFINIDO';

/** "no prazo de 15 dias", "prazo improrrogável de 5 (cinco) dias", "prazo de 48 horas". */
const RE_TEM_PRAZO = /\bPRAZO\b[^.;\n]{0,40}?\bDE\s+\d{1,3}\b|\bPRAZO\s+DE\s+\d{1,3}\b/;

/**
 * O PRAZO É NOSSO, MAS AINDA NÃO COMEÇOU A CORRER (18/09/2026).
 *
 * O caso que ensinou isto está na produção, em 0001383-61.2023.5.22.0101 — e é o
 * ÚNICO das seis tarefas "prazo da parte contrária" que a regra anterior ainda
 * deixava passar. O ato traz DOIS prazos de quinze dias:
 *
 *   1. "INTIME-SE a parte Reclamada para que, no prazo de 15 dias, cumpra a
 *      obrigação de fazer (...)" — dela;
 *   3. "CUMPRIDA A OBRIGAÇÃO E JUNTADOS OS DOCUMENTOS, intime-se o Sindicato
 *      Autor para que, no prazo de 15 (quinze) dias, apresente os cálculos" —
 *      nosso, e a advogada fechou a tarefa escrevendo exatamente isso:
 *      "Prazo direcionado, NESTE MOMENTO, à empresa Reclamada. Intimação do
 *      SENATEPI para cálculos será POSTERIOR à apresentação da documentação".
 *
 * A atribuição estava certa e a conclusão, errada: o prazo é nosso e está
 * DORMINDO. Marcá-lo na agenda hoje é dar ao advogado uma data que depende de
 * um ato que a outra parte pode nem praticar — e quando ela praticar, o tribunal
 * nos intima de novo, que é quando o prazo nasce de verdade.
 *
 * Os gatilhos são as fórmulas com que o juízo encadeia atos. Ficam ANCORADAS NO
 * COMEÇO da frase (`^`) de propósito: "cumprida a obrigação, intime-se X" é
 * condição; "o réu deverá juntar os documentos, após o que..." não é a mesma
 * coisa, e casar no meio transformaria metade dos despachos em prazo dormente.
 */
const RE_PRAZO_CONDICIONADO = new RegExp(
  '^\\s*(?:' +
    // Depende de a outra parte fazer algo primeiro.
    'CUMPRIDA|CUMPRIDO|CUMPRIDAS|CUMPRIDOS|JUNTADA|JUNTADO|JUNTADAS|JUNTADOS|' +
    'APRESENTADA|APRESENTADO|APRESENTADAS|APRESENTADOS|SOBREVINDO|ADVINDO|' +
    'COM A JUNTADA|COM A APRESENTACAO|COM A VINDA|COM O RETORNO|APOS|' +
    // Depende de um prazo alheio terminar.
    'TRANSCORRIDO|TRANSCORRIDOS|DECORRIDO|DECORRIDOS|ESGOTADO|ESGOTADOS|' +
    'ULTRAPASSADO|VENCIDO O PRAZO|FINDO|FINDOS|SILENTE|QUEDANDO|' +
    'NADA SENDO REQUERIDO|NAO HAVENDO|INEXISTINDO|' +
    // Depende de uma hipótese.
    'CASO|SE HOUVER|HAVENDO|EM SEGUIDA|NA SEQUENCIA|POSTERIORMENTE' +
  ')\\b',
);

export function deQuemEOPrazo(
  texto: string,
  nossoPolo: 'ATIVO' | 'PASSIVO' | null,
  sigla: string,
): LadoDoPrazo {
  const t = normalizarTeor(texto);
  const siglaNormalizada = normalizarTeor(sigla).replace(/[^A-Z0-9]/g, '');

  const lados: LadoDoPrazo[] = [];
  // Frase a frase: o prazo pertence a quem a FRASE dele obriga.
  for (const frase of t.split(/[.;\n]/)) {
    if (!RE_TEM_PRAZO.test(frase)) continue;

    /*
      DORMINDO OU CORRENDO? A frase que traz o prazo pode começar condicionada a
      um ato que ainda não aconteceu. Quando começa, o prazo é nosso mas não é
      de hoje — e `nosso(...)` devolve `NOSSO_FUTURO` no lugar de `NOSSO`.
    */
    const condicionado = RE_PRAZO_CONDICIONADO.test(frase.trim());
    const nosso = (): LadoDoPrazo => (condicionado ? 'NOSSO_FUTURO' : 'NOSSO');

    const limpa = frase.replace(/[^A-Z0-9]/g, '');
    if (siglaNormalizada.length >= 4 && limpa.includes(siglaNormalizada)) {
      lados.push(nosso());
      continue;
    }
    /*
      "AS PARTES ... NO PRAZO DE" é prazo de todo mundo, o nosso incluído. E
      "parte contrária" continua sendo relativa a quem agiu: nunca bloqueia.
    */
    if (TODAS_AS_PARTES.test(frase) || /\bPARTE[S]? CONTRARIA[S]?\b/.test(frase)) {
      lados.push(nosso());
      continue;
    }

    const ativo = PAPEL_ATIVO.test(frase);
    const passivo = PAPEL_PASSIVO.test(frase);
    if (ativo && passivo) lados.push(nosso()); // a frase obriga os dois lados
    else if (!nossoPolo || (!ativo && !passivo)) lados.push('INDEFINIDO');
    else if (ativo) lados.push(nossoPolo === 'ATIVO' ? nosso() : 'DA_OUTRA_PARTE');
    else lados.push(nossoPolo === 'PASSIVO' ? nosso() : 'DA_OUTRA_PARTE');
  }

  if (!lados.length) return 'INDEFINIDO';
  /*
    A ORDEM DE DESEMPATE DIZ O QUE FAZER HOJE. Um prazo nosso que já corre manda
    em tudo — é trabalho de agora. Sem ele, um prazo nosso DORMENTE vale mais que
    "não sei": ele é a informação exata de que existe trabalho nosso à frente,
    esperando a outra parte. O caso da produção cai aqui: item 1 da outra parte,
    item 3 nosso e condicionado.
  */
  if (lados.includes('NOSSO')) return 'NOSSO';
  if (lados.includes('NOSSO_FUTURO')) return 'NOSSO_FUTURO';
  if (lados.every((l) => l === 'DA_OUTRA_PARTE')) return 'DA_OUTRA_PARTE';
  return 'INDEFINIDO';
}

/**
 * O PRAZO PERMITE MARCAR UMA DATA NA AGENDA HOJE?
 *
 * Um lugar só para a pergunta, porque ela tem DOIS jeitos de dar não e os dois
 * consumidores (a criação direta e a escalada da caixa) precisam concordar. Se
 * cada um escrevesse a sua comparação, o próximo valor do vocabulário entraria
 * num e não no outro — e a agenda voltaria a receber o que a caixa recusa.
 *
 * `INDEFINIDO` passa de propósito: não saber de quem é o prazo não é o mesmo que
 * saber que não é nosso, e o caminho normal continua tendo as outras provas.
 */
export function oPrazoPodeVirarData(lado: LadoDoPrazo): boolean {
  return lado !== 'DA_OUTRA_PARTE' && lado !== 'NOSSO_FUTURO';
}
