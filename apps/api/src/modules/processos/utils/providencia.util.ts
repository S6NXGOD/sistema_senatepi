/**
 * O que a publicação do DJEN está PEDINDO que se faça.
 *
 * POR QUE ISTO EXISTE
 * O DataJud entrega o rótulo do ato ("Expedição de documento") e nada mais, e
 * por isso a atividade automática só podia se chamar "Verificação de Intimação
 * / Prazo": o sistema sabia que algo aconteceu, não o quê. Quem abria a
 * atividade tinha de ir ao PJe descobrir o que estava sendo cobrado.
 *
 * O DJEN traz o teor — "Intimo a parte autora a apresentar réplica no prazo de
 * 15 dias" —, e daí sai uma atividade que já diz "Elaborar manifestação".
 *
 * DECISÕES QUE MOLDARAM ESTE ARQUIVO
 *
 * 1. NÃO se cria tipo novo em `tipos_evento`. Cada providência aponta para um
 *    dos tipos-sistema que já existem, e o que muda é o TÍTULO. O tipo carrega
 *    o catálogo de desfechos (PRAZO já pergunta "Peça protocolada / Prazo
 *    perdido", que é exatamente o que se quer saber ao concluir "Elaborar
 *    manifestação"), a cor e as colunas do quadro. Tipos novos exigiriam
 *    migração, oito blocos novos de desfecho e revisão das telas da Agenda —
 *    para ganhar o que o título já resolve.
 *
 * 2. A regra lê `tipoComunicacao` (4 valores limpos: Intimação, Edital,
 *    Citação, Lista de distribuição) e o TEXTO. NUNCA `tipoDocumento`: ele é
 *    livre por tribunal e, numa amostra real de 100 publicações, veio como
 *    "Sentença", "87", "DESPACHO/DECISÃO", "Devedores" e "Publicação
 *    Automática". Não dá para escrever regra sobre isso.
 *
 * 3. Na dúvida, ANALISAR_INTIMACAO. Uma atividade genérica é o comportamento de
 *    hoje; uma atividade com nome errado é pior que genérica, porque o advogado
 *    passa a desconfiar de todas.
 *
 * Função pura, testável sem banco nem rede — mesmo padrão de `audiencia.util.ts`.
 */

export type Providencia =
  | 'ANALISAR_INTIMACAO'
  | 'ELABORAR_MANIFESTACAO'
  | 'JUNTAR_DOCUMENTOS'
  | 'ANALISAR_SENTENCA'
  | 'AVALIAR_RECURSO'
  | 'PREPARAR_AUDIENCIA'
  | 'SOLICITAR_DOCUMENTOS_FILIADO'
  | 'COMUNICAR_FILIADO'
  | 'NENHUMA';

export interface EspecificacaoProvidencia {
  /** Slug de `tipos_evento` — sempre um dos que já existem. */
  tipo: string;
  /** Título da atividade. É o que a equipe lê no quadro. */
  titulo: string;
  /**
   * Dias ÚTEIS até o lembrete, quando o texto não menciona prazo.
   * É prazo de CONFERÊNCIA, não vencimento processual (ver §prazo abaixo).
   */
  diasUteis: number;
}

/**
 * Catálogo. `NENHUMA` fica de fora de propósito: não gera atividade, e
 * representá-la aqui convidaria alguém a criar uma "atividade nenhuma".
 */
export const PROVIDENCIAS: Record<Exclude<Providencia, 'NENHUMA'>, EspecificacaoProvidencia> = {
  ANALISAR_INTIMACAO: { tipo: 'PRAZO', titulo: 'Analisar intimação', diasUteis: 5 },
  ELABORAR_MANIFESTACAO: { tipo: 'PRAZO', titulo: 'Elaborar manifestação', diasUteis: 5 },
  JUNTAR_DOCUMENTOS: { tipo: 'PRAZO', titulo: 'Juntar documentos', diasUteis: 5 },
  ANALISAR_SENTENCA: { tipo: 'PRAZO', titulo: 'Analisar sentença', diasUteis: 3 },
  AVALIAR_RECURSO: { tipo: 'PRAZO', titulo: 'Avaliar recurso', diasUteis: 3 },
  // ACOMPANHAMENTO e não AUDIENCIA: a audiência em si é agendada pelo radar,
  // com data confirmada por uma pessoa. Esta é a tarefa de PREPARAR — e criá-la
  // como AUDIENCIA colocaria uma segunda audiência fantasma na agenda.
  PREPARAR_AUDIENCIA: { tipo: 'ACOMPANHAMENTO', titulo: 'Preparar audiência', diasUteis: 5 },
  SOLICITAR_DOCUMENTOS_FILIADO: {
    tipo: 'CONTATO',
    titulo: 'Solicitar documentos ao filiado',
    diasUteis: 2,
  },
  COMUNICAR_FILIADO: { tipo: 'CONTATO', titulo: 'Comunicar filiado', diasUteis: 3 },
};

// ---------------------------------------------------------------------------
// Vocabulário. Texto já normalizado: MAIÚSCULAS, sem acento.
// ---------------------------------------------------------------------------

/** Designação de pauta — mesma família de termos do classificador do DataJud. */
const RE_AUDIENCIA = /\b(AUDIENCIA|SESSAO DE JULGAMENTO|SESSAO VIRTUAL)\b/;
const RE_DESIGNACAO = /(DESIGNAD|APRAZAD|MARCAD|INCLUID[AO] EM PAUTA)/;

/**
 * Sentença: o ato que decide o mérito em 1º grau.
 *
 * A palavra "SENTENÇA" SOZINHA não serve. Acórdão de apelação fala da sentença
 * o tempo todo — é o que ele está julgando. Medido em 200 publicações reais do
 * TJPI, a regra solta classificava 61% delas como "Analisar sentença", quase
 * todas atas de sessão do 2º grau. Aqui só entram construções que indicam a
 * sentença sendo COMUNICADA ou PROFERIDA.
 */
const RE_SENTENCA = /(INTIMA(CAO|D[AO]S?).{0,20}SENTENCA|CIENCIA DA SENTENCA|SENTENCA PROFERIDA|PROFERIDA A SENTENCA|PUBLIQUE-SE A SENTENCA|JULGO (TOTALMENTE |PARCIALMENTE )?(PROCEDENTE|IMPROCEDENTE)|EXTINGO O (PROCESSO|FEITO)|JULGO EXTINTO)/;

/**
 * Peça a escrever. CONTRARRAZOES entra AQUI e não em recurso: contrarrazão é
 * uma peça que se redige em resposta ao recurso do outro — o trabalho é
 * escrever, não decidir se recorre.
 */
const RE_MANIFESTACAO = /(MANIFEST|REPLICA|IMPUGNA|CONTRARRAZOES|CONTRA-RAZOES|CONTESTAC|CONTESTAR|ALEGACOES FINAIS|MEMORIAIS|APRESENTAR DEFESA)/;

/**
 * Decidir se recorre — pressupõe uma decisão desfavorável já publicada.
 *
 * ATENÇÃO ao que NÃO está aqui: "APELACAO", "AGRAVO" e "EMBARGOS DE
 * DECLARACAO" sozinhos. Eles são NOMES DE CLASSE PROCESSUAL e aparecem no
 * cabeçalho de toda publicação de um processo daquele tipo ("CLASSE: APELAÇÃO
 * CRIMINAL"). Numa amostra de 200 publicações reais do TJPI, incluí-los fazia
 * 40% das publicações virarem "Avaliar recurso" — quase todas por causa do
 * cabeçalho, não do pedido. Aqui só entram termos que indicam a PROVIDÊNCIA.
 */
const RE_RECURSO = /(ACORDAO|PRAZO RECURSAL|INTERPOR RECURSO|INTERPOSICAO DE RECURSO|RAZOES (DE APELACAO|RECURSAIS)|JUIZO DE ADMISSIBILIDADE|PARA RECORRER|SESSAO DE JULGAMENTO|RESULTADO DO JULGAMENTO|NEGAR PROVIMENTO|DAR PROVIMENTO|CONHECER (E|DO) RECURSO)/;

/** Juntada de documento aos autos. */
const RE_DOCUMENTOS = /(JUNTAR|JUNTADA|ACOSTAR|APRESENTAR (OS )?DOCUMENTOS|COMPROVANTE|COMPROVAR)/;

/** Falta documento do filiado para o processo andar. */
const RE_DOCS_FILIADO = /(EMENDA A INICIAL|EMENDAR A INICIAL|DOCUMENTO(S)? FALTANTE|SANAR A IRREGULARIDADE|REGULARIZAR A REPRESENTACAO|PROCURACAO)/;

/** Notícia que o filiado precisa receber, sem peça a produzir. */
const RE_COMUNICAR = /(ACORDO HOMOLOGADO|HOMOLOGO O ACORDO|TRANSITO EM JULGADO|ALVARA|LEVANTAMENTO DE VALOR|PAGAMENTO DISPONIVEL)/;

/** Comunicações que não pedem nada de quem lê. */
const RE_SEM_PROVIDENCIA = /(LISTA DE DISTRIBUICAO|DISTRIBUICAO POR SORTEIO|MERO EXPEDIENTE)/;

/**
 * Prazo mencionado no texto.
 *
 * Ancorado em "PRAZO" e tolerante ao que os tribunais escrevem no meio:
 * "no prazo de 15 dias", "prazo de 05 (cinco) dias", "prazo comum de 15 dias".
 * "no prazo legal" não casa — e é exatamente o que se quer, porque ali o texto
 * NÃO informa o número.
 */
const RE_PRAZO_DIAS = /PRAZO[^.\d]{0,30}(\d{1,3})\s*(?:\([^)]{0,30}\)\s*)?DIAS/;

/** Prazo processual plausível. Fora disso é erro de leitura, não prazo. */
const PRAZO_MIN = 1;
const PRAZO_MAX = 180;

/** MAIÚSCULAS sem acento — mesma normalização de `audiencia.util.ts`. */
function normalizar(texto: string): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '')
    .toUpperCase();
}

/**
 * Converte o teor da publicação em texto legível.
 *
 * PARTE DAS PUBLICAÇÕES VEM EM HTML. Verificado em produção: no TJPI, atos do
 * PJe chegam como `<div id="j_id1151..." style="text-align: center;"><img
 * src="…brasao.gif"/>…`. Guardar isso cru significaria mostrar marcação ao
 * advogado no card da atividade — e fazer o classificador ler nome de tag como
 * se fosse conteúdo do ato.
 *
 * Aplicado na INGESTÃO, para que o banco guarde o texto já limpo: o teor é lido
 * pela tela, pela atividade e pelo classificador, e limpar em três lugares
 * diferentes é como eles divergem.
 */
export function limparTextoPublicacao(bruto: string): string {
  return (bruto || '')
    // <br> e </p> viram quebra de linha antes de o resto das tags sumir, senão
    // o texto inteiro colapsa num parágrafo único ilegível.
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    // ATENÇÃO: entidade nomeada é CASE-SENSITIVE em HTML — `&Aacute;` é Á e
    // `&aacute;` é á. A chave vai para a tabela com a caixa original; só o
    // prefixo numérico/hexadecimal é normalizado.
    .replace(/&([A-Za-z]+|#\d+|#[xX][0-9a-fA-F]+);/g, (inteiro, chave: string) => {
      if (chave.startsWith('#')) {
        const resto = chave.slice(1);
        const codigo =
          resto[0] === 'x' || resto[0] === 'X'
            ? parseInt(resto.slice(1), 16)
            : Number(resto);
        return Number.isFinite(codigo) && codigo > 0 ? String.fromCharCode(codigo) : inteiro;
      }
      return ENTIDADES[chave] ?? inteiro;
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();
}

/**
 * Entidades nomeadas que aparecem de fato nas publicações.
 *
 * São as acentuadas do português — o TJPI publica "PODER JUDICI&Aacute;RIO",
 * "Tribunal de Justi&ccedil;a", "1&ordf; C&acirc;mara". Sem decodificá-las, o
 * teor chegaria ilegível ao advogado e o classificador leria "JUSTICCEDILA" no
 * lugar de "JUSTIÇA". A tabela é fechada de propósito: entidade desconhecida
 * fica como está, e um texto com um símbolo cru é melhor que um texto com um
 * pedaço apagado.
 */
const ENTIDADES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  agrave: 'à', ecirc: 'ê', ocirc: 'ô', acirc: 'â', ucirc: 'û', icirc: 'î',
  atilde: 'ã', otilde: 'õ', ntilde: 'ñ', ccedil: 'ç',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  Agrave: 'À', Ecirc: 'Ê', Ocirc: 'Ô', Acirc: 'Â',
  Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç',
  Auml: 'Ä', Euml: 'Ë', Iuml: 'Ï', Ouml: 'Ö', Uuml: 'Ü',
  Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù', Ntilde: 'Ñ',
  Ucirc: 'Û', Icirc: 'Î',
  ordf: 'ª', ordm: 'º', deg: '°', sect: '§', para: '¶',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', bull: '•', middot: '·',
};

/**
 * Rótulos do CABEÇALHO da publicação, que descrevem o processo e NÃO o que se
 * pede. O corpo do ato começa depois do último deles.
 */
const RE_ROTULO_CABECALHO =
  /\b(ASSUNTO|REU|REQUERIDO|EXECUTADO|APELADO|EMBARGADO|RECORRIDO|IMPETRADO|DENUNCIADO|INDICIADO|VITIMA|AUTOR|EXEQUENTE|APELANTE|IMPETRANTE)\s*:/g;

/** Abaixo disto, o que sobrou não é corpo de ato — é resto de cabeçalho. */
const MIN_CORPO = 40;

/**
 * Recorta o corpo do ato, descartando o cabeçalho.
 *
 * POR QUE ISTO É NECESSÁRIO
 * Toda publicação começa com "PROCESSO Nº … CLASSE: APELAÇÃO CRIMINAL ASSUNTO:
 * … APELANTE: … APELADO: …". Classificar o texto inteiro faz a CLASSE do
 * processo decidir a providência: um pedido de juntada de documentos numa
 * apelação viraria "Avaliar recurso" porque a palavra "apelação" está no
 * cabeçalho. Medido em 200 publicações reais do TJPI, era o erro mais comum.
 *
 * Se nada for reconhecido como cabeçalho, ou se o corpo restante for curto
 * demais para ser um ato, devolve o texto inteiro — perder a classificação é
 * pior que classificar com ruído.
 */
export function corpoDaPublicacao(textoNormalizado: string): string {
  RE_ROTULO_CABECALHO.lastIndex = 0;
  let fimDoCabecalho = -1;
  for (let m = RE_ROTULO_CABECALHO.exec(textoNormalizado); m; m = RE_ROTULO_CABECALHO.exec(textoNormalizado)) {
    fimDoCabecalho = m.index + m[0].length;
  }
  if (fimDoCabecalho < 0) return textoNormalizado;

  const corpo = textoNormalizado.slice(fimDoCabecalho).trim();
  return corpo.length >= MIN_CORPO ? corpo : textoNormalizado;
}

export interface ClassificacaoProvidencia {
  providencia: Providencia;
  /**
   * Dias que o TEXTO menciona, ou null. É SUGESTÃO — o sistema não calcula
   * vencimento processual (ver `aplicarPrazo`).
   */
  prazoMencionadoDias: number | null;
}

/**
 * Classifica a publicação.
 *
 * ORDEM DAS REGRAS — cada uma só é consultada se a anterior não resolveu:
 *  1. sem providência (lista de distribuição, mero expediente);
 *  2. pauta designada        → PREPARAR_AUDIENCIA;
 *  3. sentença               → ANALISAR_SENTENCA (decidir recurso vem junto);
 *  4. peça a redigir         → ELABORAR_MANIFESTACAO;
 *  5. acórdão/prazo recursal → AVALIAR_RECURSO;
 *  6. juntada                → JUNTAR_DOCUMENTOS;
 *  7. falta documento do filiado → SOLICITAR_DOCUMENTOS_FILIADO;
 *  8. notícia ao filiado     → COMUNICAR_FILIADO;
 *  9. é intimação/citação    → ANALISAR_INTIMACAO (a rede de segurança);
 * 10. nada                   → NENHUMA.
 *
 * A regra 4 vem antes da 5 de propósito: "apresentar contrarrazões" cita
 * apelação, mas o trabalho é escrever a peça, não avaliar recurso próprio.
 */
export function classificarProvidencia(
  texto: string | null | undefined,
  tipoComunicacao?: string | null,
): ClassificacaoProvidencia {
  const completo = normalizar(texto ?? '');
  if (!completo) return { providencia: 'NENHUMA', prazoMencionadoDias: null };

  // A classificação olha só o CORPO — o cabeçalho descreve o processo, não o
  // que está sendo pedido. O prazo, ao contrário, sai do texto INTEIRO: alguns
  // tribunais o anunciam antes do corpo do ato.
  const t = corpoDaPublicacao(completo);
  const prazoMencionadoDias = extrairPrazoDias(completo);

  const tipo = normalizar(tipoComunicacao ?? '');
  const resolver = (providencia: Providencia): ClassificacaoProvidencia => ({
    providencia,
    prazoMencionadoDias,
  });

  if (RE_SEM_PROVIDENCIA.test(t)) return resolver('NENHUMA');
  if (RE_AUDIENCIA.test(t) && RE_DESIGNACAO.test(t)) return resolver('PREPARAR_AUDIENCIA');
  if (RE_SENTENCA.test(t)) return resolver('ANALISAR_SENTENCA');
  // Recurso vem ANTES de manifestação quando o processo já foi julgado: uma ata
  // de sessão ou um acórdão pede decisão sobre recorrer, e a menção genérica a
  // "manifestação" no corpo do julgado não muda isso.
  if (RE_RECURSO.test(t)) return resolver('AVALIAR_RECURSO');
  if (RE_MANIFESTACAO.test(t)) return resolver('ELABORAR_MANIFESTACAO');
  if (RE_DOCS_FILIADO.test(t)) return resolver('SOLICITAR_DOCUMENTOS_FILIADO');
  if (RE_DOCUMENTOS.test(t)) return resolver('JUNTAR_DOCUMENTOS');
  if (RE_COMUNICAR.test(t)) return resolver('COMUNICAR_FILIADO');

  // Rede de segurança: uma intimação SEMPRE gera tarefa, mesmo que o texto não
  // se encaixe em nada. É o comportamento que já existe hoje — nunca regride.
  if (/INTIMA|CITA/.test(tipo) || /INTIMO|INTIMA-SE|FICA INTIMAD|CITA-SE/.test(t)) {
    return resolver('ANALISAR_INTIMACAO');
  }

  return resolver('NENHUMA');
}

/** Prazo em dias citado no texto, dentro de uma faixa plausível. */
export function extrairPrazoDias(textoNormalizado: string): number | null {
  const m = RE_PRAZO_DIAS.exec(textoNormalizado);
  if (!m) return null;
  const dias = Number(m[1]);
  if (!Number.isFinite(dias) || dias < PRAZO_MIN || dias > PRAZO_MAX) return null;
  return dias;
}

/**
 * Em quantos dias úteis o LEMBRETE deve cair.
 *
 * O SISTEMA NÃO CALCULA VENCIMENTO. A contagem oficial depende de dias úteis
 * forenses, feriado da comarca, forma de intimação e suspensão de prazo — errar
 * isso para menos é perder prazo, e nenhuma automação deveria assumir esse
 * risco no lugar de uma pessoa.
 *
 * O que se faz aqui é ANTECIPAR o lembrete quando o texto menciona um prazo
 * curto: um prazo de 5 dias com lembrete no 5º dia útil é um lembrete inútil.
 * Antecipar é sempre seguro; o lembrete nunca passa do padrão do catálogo, só
 * vem antes dele.
 */
export function diasParaLembrete(
  spec: EspecificacaoProvidencia,
  prazoMencionadoDias: number | null,
): number {
  if (prazoMencionadoDias == null) return spec.diasUteis;
  // Dois dias de folga antes do prazo citado, nunca menos de 1 e nunca depois
  // do padrão da providência.
  return Math.max(1, Math.min(spec.diasUteis, prazoMencionadoDias - 2));
}
