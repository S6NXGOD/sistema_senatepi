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
