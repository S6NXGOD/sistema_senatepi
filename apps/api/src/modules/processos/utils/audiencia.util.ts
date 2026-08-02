/**
 * Classificador ÚNICO das movimentações do DataJud.
 *
 * FONTE DE VERDADE para os dois consumidores — o radar de audiências (colunas
 * `eh_audiencia` / `audiencia_data`) e o robô de prazos. Antes eram duas regras
 * independentes, e a diferença entre elas abria um buraco: "Intimação para a
 * audiência de conciliação" era tratada como audiência pelo robô (que desistia
 * por não achar data) e recusada pelo radar (que exige verbo de designação).
 * A movimentação — uma INTIMAÇÃO, com prazo correndo — não virava nada.
 *
 * A regra continua conservadora quanto à PAUTA: só é designação o que traz o
 * ato + o verbo de marcação (ou um código TPU de designação). A diferença é que
 * agora, quando não é designação, o texto CONTINUA sendo avaliado como prazo em
 * vez de ser descartado. Nada some no meio do caminho.
 */

/**
 * Códigos da TPU (Tabela Processual Unificada / SGT-CNJ) que, por si só, já
 * caracterizam designação de audiência — independentemente do texto.
 *
 * ATENÇÃO: a TPU tem centenas de códigos e cada tribunal usa um subconjunto.
 * Esta lista começa com os códigos confirmados pela equipe; para ampliá-la,
 * acrescente aqui e rode `POST /audiencias-a-agendar/reclassificar` (admin),
 * que reaplica a regra sobre TODO o histórico já sincronizado — não é preciso
 * migração nem re-importar processos.
 *
 * Para descobrir novos códigos: o alerta exibe o código TPU de cada
 * movimentação, e a linha do tempo do processo mostra os demais.
 */
export const CODIGOS_TPU_AUDIENCIA: ReadonlySet<number> = new Set([
  11025, // Designação de audiência
  12173, // Audiência designada (pauta)
]);

/**
 * Substantivo do ato, separado por espécie: perícia tem desfechos próprios
 * ("laudo entregue") e não pode entrar na agenda como audiência, oferecendo
 * "houve acordo" na hora de concluir.
 * (Texto já normalizado: MAIÚSCULAS e sem acentos.)
 */
const RE_ATO_AUDIENCIA = /\b(AUDIENCIA|AUDIENCIAS|SESSAO DE JULGAMENTO|SESSAO VIRTUAL)\b/;
const RE_ATO_PERICIA = /\b(PERICIA|PERICIAS|PERICIAL)\b/;

/**
 * Verbo de marcação: é o que separa "designar pauta" de "comunicar ato".
 * REDESIGNAD/REMARCAD entram de propósito — remarcação é uma nova data e
 * precisa de novo agendamento.
 */
const RE_DESIGNACAO =
  /(DESIGNAD|DESIGNACAO|REDESIGNAD|REMARCAD|APRAZAD|MARCAD|INCLUID[AO] EM PAUTA|PAUTA DE JULGAMENTO)/;

/**
 * Remarcação: a data nova SUBSTITUI uma anterior. Quem consome precisa saber
 * disso para cancelar o compromisso velho — sem isso a agenda fica com a
 * audiência fantasma na data antiga ao lado da nova.
 */
const RE_REDESIGNACAO = /(REDESIGNAD|REDESIGNACAO|REMARCAD|ADIAD)/;

/**
 * Veto: a audiência caiu (ou o ato foi esvaziado) — não há o que agendar.
 * Vale inclusive sobre os códigos TPU: "Cancelada a audiência designada" pode
 * vir com o mesmo código da designação.
 */
const RE_VETO = /(CANCELAD|PREJUDICAD|SEM EFEITO|NAO REALIZAD|DISPENSAD|REDESIGNACAO INDEFERIDA)/;

/**
 * Atos que fazem CORRER PRAZO para a defesa — a rede de segurança do robô.
 *
 * Só é consultada quando o texto NÃO é designação de pauta, e é a última
 * parada antes de descartar a movimentação. "Publicação"/"Disponibilização no
 * Diário" entram porque, na prática, são a intimação do advogado.
 *
 * "Decurso de prazo" ficou DE FORA: é o fim de um prazo, não a abertura de um.
 * Gerava tarefa de conferência para algo que já tinha acabado — ruído puro
 * numa agenda que precisa ser levada a sério.
 */
const RE_PRAZO =
  /(INTIMACAO|INTIMAD|CITACAO|CITAD|ABERTURA DE PRAZO|ABERTURA DE VISTA|VISTA DOS AUTOS|DESPACHO|PUBLICACAO|DISPONIBILIZACAO NO DIARIO|DIARIO DA JUSTICA)/;

/** dd/mm/aaaa (aceita 1 dígito no dia/mês). */
const RE_DATA = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
/** "15 DE AGOSTO DE 2026" — formato usado em despachos redigidos por extenso. */
const RE_DATA_EXTENSO = /\b(\d{1,2}) DE ([A-Z]+) DE (\d{4})\b/g;
/** "14:00", "14H30" e "14H" (hora cheia). */
const RE_HORA = /^(\d{1,2})\s*[:H]\s*(\d{2})\b|^(\d{1,2})\s*H\b/;

/**
 * Só aceitamos o horário que estiver na MESMA ORAÇÃO da data — logo depois
 * dela, separado apenas por pontuação/"às"/dia da semana e sem nenhum outro
 * número no meio. Sem isso, "15/08/2026. Local: Fórum, guichê 09:15" viraria
 * audiência às 9h15.
 */
const MAX_LACUNA_HORA = 25;

const MESES: Record<string, number> = {
  JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6,
  JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
};

/** Brasil sem horário de verão desde 2019 → offset fixo UTC-3 (Teresina). */
const OFFSET_BR_MS = 3 * 3_600_000;

/**
 * MAIÚSCULAS sem acento. NFD separa a letra-base do acento; removemos tudo que
 * não for ASCII básico (as marcas combinantes viram não-ASCII). Assim todas as
 * expressões regulares acima ficam em ASCII puro — imunes a problemas de
 * codificação no arquivo-fonte.
 */
function normalizar(texto: string): string {
  return (texto || '')
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '')
    .toUpperCase();
}

/**
 * O que a movimentação PEDE que o sistema faça.
 *
 * `PAUTA_CAIU` existe porque ignorar a movimentação (comportamento antigo) não
 * bastava: o compromisso criado pela designação anterior continuava PENDENTE na
 * agenda, com a data velha, e o advogado ia ao fórum.
 */
export type GatilhoMovimentacao =
  | {
      tipo: 'AUDIENCIA' | 'PERICIA';
      /** Data/hora extraída do texto (instante UTC) ou null se não houver. */
      data: Date | null;
      /** Remarcação: a pauta anterior deste processo deve ser cancelada. */
      substituiPauta: boolean;
    }
  | { tipo: 'PAUTA_CAIU' }
  | { tipo: 'PRAZO' }
  | { tipo: 'NENHUM' };

/**
 * Classifica uma movimentação do DataJud — porta de entrada única.
 *
 * Ordem das decisões (cada uma só é consultada se a anterior não resolveu):
 *  1. ato de pauta + veto  → PAUTA_CAIU (audiência cancelada/prejudicada);
 *  2. veto sem ato de pauta → NENHUM ("intimação cancelada" não abre prazo);
 *  3. designação de pauta   → AUDIENCIA ou PERICIA, com a data se estiver no texto;
 *  4. termo de prazo        → PRAZO — é a rede que apara tudo que citou audiência
 *     sem designar nada, e que antes desaparecia;
 *  5. nada                  → NENHUM.
 *
 * @param descricao       texto da movimentação (idealmente nome + detalhe + teor)
 * @param codigoMovimento código TPU (campo `codigo` do DataJud)
 * @param dataMovimento   data da movimentação — usada só para validar a data
 *                        extraída (descarta datas absurdas de OCR/typo)
 */
export function classificarMovimentacao(
  descricao: string | null | undefined,
  codigoMovimento?: number | null,
  dataMovimento?: Date | string | null,
): GatilhoMovimentacao {
  const texto = normalizar(descricao ?? '');
  if (!texto) return { tipo: 'NENHUM' };

  const porCodigo = codigoMovimento != null && CODIGOS_TPU_AUDIENCIA.has(codigoMovimento);
  const ehPericia = RE_ATO_PERICIA.test(texto);
  const ehAudiencia = RE_ATO_AUDIENCIA.test(texto) || porCodigo;
  const atoDePauta = ehPericia || ehAudiencia;

  // (1) e (2) — o veto sempre vence, mas o destino depende do que foi vetado.
  if (RE_VETO.test(texto)) return atoDePauta ? { tipo: 'PAUTA_CAIU' } : { tipo: 'NENHUM' };

  // (3) Designação: código TPU já basta; por texto, exige ato + verbo.
  if (atoDePauta && (porCodigo || RE_DESIGNACAO.test(texto))) {
    return {
      // Audiência prevalece: "audiência de instrução para oitiva do perito" é
      // audiência, não perícia.
      tipo: ehAudiencia ? 'AUDIENCIA' : 'PERICIA',
      data: extrairDataAudiencia(texto, dataMovimento),
      substituiPauta: RE_REDESIGNACAO.test(texto),
    };
  }

  // (4) Rede de segurança — aqui mora o prazo que antes evaporava.
  if (RE_PRAZO.test(texto)) return { tipo: 'PRAZO' };

  return { tipo: 'NENHUM' };
}

export interface ClassificacaoAudiencia {
  /** Movimentação designa/redesigna audiência (ou perícia)? */
  ehAudiencia: boolean;
  /** Data/hora da audiência extraída do texto (instante UTC) ou null. */
  audienciaData: Date | null;
}

/**
 * Recorte do classificador para as colunas `eh_audiencia`/`audiencia_data`, que
 * alimentam o radar. Perícia entra na mesma fila de propósito — também é pauta
 * que alguém precisa confirmar; o TIPO certo é escolhido no agendamento.
 */
export function classificarAudiencia(
  descricao: string | null | undefined,
  codigoMovimento: number | null | undefined,
  dataMovimento?: Date | string | null,
): ClassificacaoAudiencia {
  const g = classificarMovimentacao(descricao, codigoMovimento, dataMovimento);
  return g.tipo === 'AUDIENCIA' || g.tipo === 'PERICIA'
    ? { ehAudiencia: true, audienciaData: g.data }
    : { ehAudiencia: false, audienciaData: null };
}

/**
 * Extrai a data designada do texto já normalizado.
 *
 * Prefere a data que vier DEPOIS do verbo de designação ("... designada para
 * 15/08/2026"), que é como os tribunais escrevem; se não houver, usa a primeira
 * data do texto.
 */
export function extrairDataAudiencia(
  textoNormalizado: string,
  dataMovimento?: Date | string | null,
): Date | null {
  const texto = textoNormalizado;
  const posVerbo = texto.search(RE_DESIGNACAO);

  const candidatos: { indice: number; fim: number; ano: number; mes: number; dia: number }[] = [];

  RE_DATA.lastIndex = 0;
  for (let m = RE_DATA.exec(texto); m; m = RE_DATA.exec(texto)) {
    candidatos.push({ indice: m.index, fim: m.index + m[0].length, dia: +m[1], mes: +m[2], ano: +m[3] });
  }
  RE_DATA_EXTENSO.lastIndex = 0;
  for (let m = RE_DATA_EXTENSO.exec(texto); m; m = RE_DATA_EXTENSO.exec(texto)) {
    const mes = MESES[m[2]];
    if (mes) candidatos.push({ indice: m.index, fim: m.index + m[0].length, dia: +m[1], mes, ano: +m[3] });
  }
  if (!candidatos.length) return null;

  candidatos.sort((a, b) => a.indice - b.indice);
  const escolhido =
    (posVerbo >= 0 ? candidatos.find((c) => c.indice > posVerbo) : undefined) ?? candidatos[0];

  const { hora, minuto } = extrairHora(texto.slice(escolhido.fim, escolhido.fim + MAX_LACUNA_HORA + 8));
  return montarData(escolhido.dia, escolhido.mes, escolhido.ano, hora, minuto, dataMovimento);
}

/**
 * Horário que segue imediatamente a data. Aceita a pontuação e as palavras de
 * ligação usadas pelos tribunais ("às", "(quarta-feira)", "- horário de") e
 * descarta qualquer coisa que traga OUTRO número no caminho.
 */
function extrairHora(aposData: string): { hora: number; minuto: number } {
  const prefixo = RE_LIGACAO_HORA.exec(aposData)?.[0] ?? '';
  if (prefixo.length > MAX_LACUNA_HORA) return { hora: 0, minuto: 0 };

  const h = RE_HORA.exec(aposData.slice(prefixo.length));
  if (!h) return { hora: 0, minuto: 0 };
  return { hora: +(h[1] ?? h[3] ?? 0), minuto: +(h[2] ?? 0) };
}

/**
 * Ligação aceita entre a data e o horário: só pontuação e palavras "vazias"
 * ("às", "quarta-feira", "horário de"). Qualquer outra palavra — "Local:",
 * "Sala", "Guichê" — encerra a oração e o horário deixa de ser considerado.
 */
const RE_LIGACAO_HORA =
  /^(?:[\s,.\-–—:()]+|AS|HORARIO|HORA|DE|DIA|EM|PONTO|PARTIR|SEGUNDA|TERCA|QUARTA|QUINTA|SEXTA|SABADO|DOMINGO|FEIRA)*/;

/**
 * Monta o instante UTC a partir da data/hora LOCAL (Teresina) e valida:
 *  - a data tem de existir de fato (31/02 não "rola" para 03/03);
 *  - hora/minuto plausíveis;
 *  - a audiência tem de cair numa janela sensata em torno da movimentação
 *    (5 anos para trás/frente) — barra typo de OCR do tipo "15/08/2062".
 */
function montarData(
  dia: number,
  mes: number,
  ano: number,
  hora: number,
  minuto: number,
  dataMovimento?: Date | string | null,
): Date | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (hora > 23 || minuto > 59) return null;

  const utc = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const d = new Date(utc);
  // Rejeita datas inexistentes (o Date.UTC "rola" 31/02 para 03/03).
  if (d.getUTCDate() !== dia || d.getUTCMonth() !== mes - 1 || d.getUTCFullYear() !== ano) {
    return null;
  }

  const instante = new Date(utc + OFFSET_BR_MS); // local (BRT) → instante UTC
  if (dataMovimento) {
    const base = new Date(dataMovimento).getTime();
    const CINCO_ANOS = 5 * 365 * 24 * 3_600_000;
    if (Number.isFinite(base) && Math.abs(instante.getTime() - base) > CINCO_ANOS) return null;
  }
  return instante;
}
