import { OFFSET_BR_MS } from './data-br.util';

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
  // --- CONFERIDOS nos índices que o SENATEPI usa, em 07/08/2026 ---
  // A varredura procurou os movimentos que carregam o complemento
  // `situacao_da_audiencia` (3.200 movimentos amostrados). Estes são TODOS os
  // que apareceram, e nenhum deles estava aqui antes:
  970, //   TJPI  "Audiência"                     740 ocorrências
  12740, //  ambos "de Conciliação"               715 (TRT22) + 72 (TJPI)
  12747, //  TRT22 "Inicial"                      841
  12749, //  TRT22 "de Instrução"               1.655
  12750, //  TJPI  "de Instrução e Julgamento"      2
  12753, //  TJPI  "Preliminar"                    38
  // --- Herdados; não apareceram na amostra, mas não fazem mal ---
  11025, // Designação de audiência
  12173, // Audiência designada (pauta)
]);

/**
 * Situações possíveis do complemento `situacao_da_audiencia` — o sinal mais
 * confiável que o CNJ dá sobre pauta, e que o sistema ignorava.
 *
 * Valores observados na amostra: designada, realizada, redesignada, cancelada e
 * "não-realizada" (só no TJPI). Só as duas primeiras da lista abaixo pedem
 * agendamento; as demais são o oposto — dizem que não há o que agendar.
 */
const SITUACOES_QUE_PEDEM_PAUTA = new Set(['DESIGNADA', 'REDESIGNADA']);

/**
 * Complemento tabelado do CNJ, na forma mínima que interessa aqui.
 *
 * Deliberadamente estrutural (e não um import de `datajud.service`): este
 * arquivo é função pura e testável sem rede, e depender do serviço HTTP para
 * uma forma de objeto quebraria isso.
 */
export interface ComplementoTabelado {
  descricao?: string | null;
  nome?: string | null;
}

/** Situação da audiência declarada pelo tribunal, normalizada. Null se não houver. */
function situacaoDaAudiencia(complementos?: ComplementoTabelado[] | null): string | null {
  if (!complementos?.length) return null;
  for (const c of complementos) {
    // MAIÚSCULAS porque é o que `normalizar` produz — comparar com a versão
    // minúscula fazia o complemento nunca casar, e o radar continuava cego
    // enquanto os testes de "designada" passavam pelo caminho do código TPU.
    if (normalizar(c?.descricao ?? '') === 'SITUACAO_DA_AUDIENCIA') {
      const valor = normalizar(c?.nome ?? '').trim();
      if (valor) return valor;
    }
  }
  return null;
}

/**
 * Códigos que ENCERRAM uma instância. Conferidos contra o índice real do CNJ
 * (`movimentos.codigo` → `movimentos.nome`), não deduzidos da tabela da TPU.
 *
 * Servem para responder "este grau ainda está vivo?" — a pergunta que decide se
 * o processo continua na varredura noturna. O caso que motivou: 2º grau com
 * baixa definitiva e 1º grau com cumprimento de sentença correndo. Antes, a
 * baixa encerrava o processo inteiro e o 1º grau parava de ser monitorado.
 *
 * O 246 ENTROU DEPOIS, e a ausência dele era grave: é a forma MAIS COMUM de um
 * processo trabalhista terminar. Contagem no índice do TRT22 (07/08/2026):
 *
 *   246 "Definitivo" (arquivamento)  171.261 documentos
 *   848 "Trânsito em julgado"        102.083
 *   22  "Baixa Definitiva"            40.890
 *
 * Sem ele, TODO processo arquivado continuava marcado como vivo: seguia na
 * varredura noturna para sempre e a lista o mostrava em "Execução" ou
 * "Conhecimento" meses depois de arquivado. Foi assim que o
 * 0001000-26.2022.5.22.0002 — arquivado em 02/02/2026, com a execução extinta
 * em 24/11/2025 — aparecia como processo em andamento.
 *
 * O desarquivamento (893) posterior continua desfazendo a baixa, então o
 * processo que volta a andar volta a ser acompanhado sozinho.
 */
export const CODIGOS_TPU_BAIXA: ReadonlySet<number> = new Set([
  22, // Baixa Definitiva
  246, // Arquivamento — "Definitivo"
  848, // Trânsito em julgado
]);

/**
 * Desarquivamento — RESSUSCITA a instância baixada.
 *
 * Sem ele, um processo desarquivado ficaria marcado como baixado para sempre e
 * sairia da varredura justamente quando voltou a andar.
 */
export const CODIGO_TPU_DESARQUIVAMENTO = 893;

/**
 * A instância está baixada?
 *
 * A REGRA É "NÃO HOUVE MAIS NADA DEPOIS" — e não "veio um código de reabertura".
 *
 * A versão anterior exigia o código 893 (Desarquivamento) posterior à baixa, e
 * ele quase nunca vem. Conferido no processo 0000600-48.2023.5.22.0108 (TRT22):
 * o 1º grau tem "Trânsito em julgado" em 28/08/2025 e, no MESMO DIA, "Liquidação
 * iniciada", seguida de mais 125 movimentos até julho de 2026 — execução
 * correndo há quase um ano. O sistema exibia esse grau como baixado, e a lista
 * mostrava "2 instâncias · todas baixadas" ao lado da etiqueta "Fase de
 * Execução". O 2º grau do mesmo processo tem Baixa Definitiva e ZERO movimentos
 * depois: esse sim acabou.
 *
 * POR QUE COMPARAR POR DIA, E NÃO POR INSTANTE
 * A baixa costuma vir acompanhada, no mesmo dia, da publicação e da expedição do
 * próprio arquivamento. Comparar instantes marcaria como viva toda instância
 * encerrada, por causa desse eco. Exigir dia ESTRITAMENTE posterior descarta o
 * eco e ainda captura a execução, que se estende por meses.
 *
 * Assim a regra não depende de conhecer os códigos de reabertura — que mudam por
 * tribunal e por fase (liquidação, cumprimento de sentença, execução fiscal) e
 * seriam uma lista impossível de manter completa.
 *
 * Compara por DATA, nunca pela ordem do array: o CNJ não garante ordenação e
 * alguns tribunais devolvem a lista decrescente.
 */
export function instanciaBaixada(
  movimentos: { codigoMovimento?: number | null; dataMovimento: Date | string }[],
): boolean {
  const DIA_MS = 24 * 3_600_000;
  const emDias = (v: Date | string) => Math.floor(new Date(v).getTime() / DIA_MS);

  let diaDaBaixa = -Infinity;
  let ultimoDia = -Infinity;

  for (const m of movimentos) {
    const quando = new Date(m.dataMovimento).getTime();
    if (!Number.isFinite(quando)) continue;
    const dia = emDias(m.dataMovimento);
    if (dia > ultimoDia) ultimoDia = dia;

    const codigo = m.codigoMovimento;
    // Desarquivamento explícito é uma baixa desfeita: some com o marco.
    if (codigo === CODIGO_TPU_DESARQUIVAMENTO && dia >= diaDaBaixa) diaDaBaixa = -Infinity;
    else if (codigo != null && CODIGOS_TPU_BAIXA.has(codigo) && dia > diaDaBaixa) diaDaBaixa = dia;
  }

  if (diaDaBaixa === -Infinity) return false; // nunca houve baixa (ou foi desfeita)
  // Movimento em dia POSTERIOR ao da baixa ⇒ a instância voltou a andar.
  return ultimoDia <= diaDaBaixa;
}

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
  complementos?: ComplementoTabelado[] | null,
): GatilhoMovimentacao {
  const texto = normalizar(descricao ?? '');

  /**
   * O COMPLEMENTO MANDA MAIS QUE O TEXTO.
   *
   * O nome do movimento de audiência no TRT22 é "de Instrução", "Inicial" ou
   * "de Conciliação" — a palavra "audiência" NÃO aparece. Nenhuma regra de
   * texto acha isso, e os dois códigos que o sistema conhecia (11025, 12173)
   * não existem nesses tribunais: o radar estava cego para a pauta inteira.
   *
   * O que o CNJ dá de bom é o complemento `situacao_da_audiencia`, presente em
   * todos esses movimentos e com valor explícito: designada, redesignada,
   * realizada, cancelada, não-realizada. Ele responde as duas perguntas de uma
   * vez — "isto é audiência?" e "ainda vai acontecer?" — sem depender de como o
   * tribunal escreveu o nome.
   */
  const situacao = situacaoDaAudiencia(complementos);
  if (situacao) {
    if (!SITUACOES_QUE_PEDEM_PAUTA.has(situacao)) {
      // Realizada, cancelada ou não-realizada: se havia alerta, ele cai.
      return { tipo: 'PAUTA_CAIU' };
    }
    return {
      tipo: 'AUDIENCIA',
      data: extrairDataAudiencia(texto, dataMovimento),
      // Redesignada é data nova: substitui a pauta anterior em vez de somar.
      substituiPauta: situacao === 'REDESIGNADA',
    };
  }

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
  complementos?: ComplementoTabelado[] | null,
): ClassificacaoAudiencia {
  const g = classificarMovimentacao(descricao, codigoMovimento, dataMovimento, complementos);
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
