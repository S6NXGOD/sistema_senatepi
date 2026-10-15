import { OFFSET_BR_MS } from './data-br.util';

/**
 * A PAUTA SAI DO DIÁRIO, E NÃO DO DATAJUD — a fonte estava trocada.
 *
 * 15/10/2026, ao construir a automação de audiências. O sistema já tinha a
 * máquina inteira: classificador (`audiencia.util`), radar
 * (`audiencias.service`), criador de pauta com aviso ao filiado e tarefa de
 * preparo (`automacao-prazos.criarPauta`). Nada disso nunca produziu uma
 * audiência. Medido na produção:
 *
 *   movimentações do DataJud marcadas como audiência ....... 265
 *   dessas, com DATA extraída ................................ 0   (0%)
 *   dessas, que viraram compromisso na agenda ................ 0
 *   compromissos de audiência na agenda (todos à mão) ........ 3
 *
 * A causa não é o extrator: é a FONTE. O DataJud entrega o RÓTULO do ato
 * ("Inicial", "de Instrução", detalhe "Juiz(a) · designada") e nunca o texto.
 * Das 265, **zero** têm data na descrição, zero têm teor, zero têm data no
 * teor. Nenhum extrator tira data de onde não há data.
 *
 * O DIÁRIO TEM. Das 2.487 publicações, 122 designam audiência com o teor
 * inteiro, e a data está escrita de forma regular:
 *
 *   "AUDIÊNCIA VIRTUAL: 25/11/2026 11:45"
 *   "AUDIÊNCIA: 18/09/2026 10:00"
 *   "Inclua-se o presente feito na pauta do dia 31/07/2026, às 12:00h"
 *   "designada para o dia 08/12/2026 às 09:30"
 *
 * Este arquivo lê ESSE texto. É função pura, sem rede e sem banco, porque a
 * decisão que ela toma — "existe pauta, nesta data, nesta modalidade" — vira
 * compromisso na agenda de alguém, e isso tem de ser testável caso a caso.
 */

/** Normaliza para comparação: sem acento, maiúsculas, espaços colapsados. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * O ATO. Perícia entra junto porque é pauta igual — tem data, hora e lugar — e
 * o criador já a trata como tipo próprio (`PERICIA`), para não oferecer "houve
 * acordo" na hora de concluir.
 */
const RE_ATO = /\b(AUDIENCIA|PERICIA)\b/;
const RE_PERICIA = /\bPERICIA\b/;

/**
 * SESSÃO DE JULGAMENTO NÃO É AUDIÊNCIA — e eu quase agendei três.
 *
 * O julgamento virtual de 2º grau corre em PLENÁRIO ELETRÔNICO: "início no dia
 * 21/10/2026 às 00:00 e término no dia 23/10/2026 às 00:00". Ninguém comparece,
 * não há hora, e o "evento" dura dias. Na primeira versão deste arquivo eles
 * entravam como audiência e iam para a agenda do advogado marcados às 9h de um
 * dia em que nada acontece — pior que não agendar, porque promete presença onde
 * não há.
 *
 * São outra coisa e pedem outro tratamento (acompanhar o resultado, não
 * comparecer). Ficam de fora até alguém decidir o que fazer com eles.
 */
const RE_SESSAO_DE_JULGAMENTO =
  /\b(SESSAO (?:VIRTUAL )?DE JULGAMENTO|PAUTA DE JULGAMENTO|PAUTA DA SESSAO|PAUTA VIRTUAL|SESSAO VIRTUAL|PLENARIO VIRTUAL)\b/;

/**
 * O SINAL DE DESIGNAÇÃO. Duas formas, e as duas aparecem na produção:
 *
 *  1. O RÓTULO com dois-pontos, que é como o PJe monta o cabeçalho da
 *     notificação — "AUDIÊNCIA VIRTUAL: 25/11/2026 11:45". Não há verbo
 *     nenhum, e é o formato mais comum e mais confiável.
 *  2. O VERBO no corpo do despacho — "designada para o dia", "inclua-se na
 *     pauta do dia", "fica designada", "redesigno".
 */
const RE_ROTULO_PAUTA =
  /\b(?:AUDIENCIA|PERICIA)[^:\n]{0,60}:\s*(?=\d{1,2}\/\d{1,2}\/\d{4})/;
const RE_VERBO_DESIGNACAO =
  /\b(DESIGNO|DESIGNADA?|DESIGNADAS|REDESIGNO|REDESIGNADA?|APRAZAD[AO]|INCLUA-SE|INCLUIDO EM PAUTA|MARCADA PARA|REMARCADA PARA|PAUTA DO DIA|DATA DA AUDIENCIA)\b/;

/**
 * QUANDO O ATO REMARCA, A DATA BOA É A SEGUNDA — e eu estava pegando a
 * primeira.
 *
 * O ofício de remarcação cita as DUAS datas, nesta ordem:
 *
 *   "A AUDIENCIA DO PRESENTE FEITO, ANTERIORMENTE DESIGNADA PARA 03/06/2026,
 *    FOI REDESIGNADA PARA O DIA E HORARIO A SEGUIR: 28/05/2026 08:30."
 *
 * Ancorando no primeiro verbo, o leitor parava em "DESIGNADA" e gravava
 * **03/06/2026 às 9h** — a pauta velha, no horário que eu inventei. A boa é a
 * de baixo, com hora e tudo. Três publicações da produção são exatamente
 * isto, e é o pior erro possível: o advogado teria ido no dia errado,
 * confiando numa agenda que parecia certa.
 *
 * Por isso a remarcação tem precedência sobre a designação: quando o texto
 * remarca, a âncora é a remarcação, não o primeiro verbo que aparecer.
 */
const RE_VERBO_REMARCACAO = /\b(REDESIGNO|REDESIGNADA?S?|REMARCADA PARA|REMARCO)\b/;

/**
 * O QUE DESMARCA. Se o ato diz que a pauta caiu, não há o que agendar — e
 * agendar assim mesmo é pior que não agendar: põe na agenda de alguém uma
 * audiência que não vai acontecer.
 *
 * `REDESIGNADA` NÃO entra aqui de propósito: ela cancela uma e marca outra, e
 * a outra é justamente a que queremos. Por isso a lista evita a raiz comum.
 */
const RE_CANCELAMENTO =
  /\b(AUDIENCIA CANCELADA|CANCELADA A AUDIENCIA|CANCELAMENTO DA AUDIENCIA|AUDIENCIA ADIADA|SEM EFEITO A AUDIENCIA|TORNO SEM EFEITO|AUDIENCIA PREJUDICADA|RESTA PREJUDICADA A AUDIENCIA)\b/;

/**
 * Data numérica — a forma mais comum na pauta.
 *
 * O ano de DOIS dígitos entra porque existe: "DESIGNADA PARA O DIA 29/06/26 AS
 * 08:00H" (processo 0019100-09.2015.8.18.0140). É 1 em 129 candidatas, mas sem
 * ele o leitor pulava essa e pegava a data seguinte do texto — a falta não
 * custava uma perda, custava um ERRO, com a audiência no dia de outra coisa.
 */
const RE_DATA = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?![\/\d])/g;

/**
 * Data por extenso — "PARA O DIA 25 DE FEVEREIRO DE 2026".
 *
 * Não é raridade: sem ela, o despacho que marca a conciliação por extenso
 * fazia o leitor pular 1.081 caracteres e pegar uma data numérica qualquer do
 * resto do texto. Ou seja, a falta dela não causava só uma perda — causava um
 * ERRO, com a audiência no dia errado.
 */
const RE_DATA_EXTENSO = /\b(\d{1,2}) DE ([A-Z]+) DE (\d{4})\b/g;
const MESES: Record<string, number> = {
  JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6,
  JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
};

/**
 * A DATA TEM DE ESTAR NA MESMA FRASE DA DESIGNAÇÃO — a regra que separa a
 * pauta da ASSINATURA DO JUIZ.
 *
 * Primeiro medi só a distância em caracteres, e o corte de 60 parecia
 * resolver. Rodando contra as 2.444 publicações da produção, não resolvia:
 *
 *   "MANTENHO A AUDIENCIA DESIGNADA. TERESINA/PI, 03 DE FEVEREIRO DE 2026."
 *
 * A distância ali é 24 caracteres — bem dentro do corte — e a data que o
 * leitor pegava era **o dia em que o juiz assinou**. São 26 publicações
 * assim, todas do mesmo molde: o despacho MENCIONA uma audiência que já
 * existe, encerra a frase, e o que vem depois é o fecho do documento.
 *
 * Contar caracteres não distingue isso de "designada para o dia 29/06/2026".
 * O que distingue é o PONTO FINAL: uma designação e a sua data são uma
 * afirmação só. A regra passou a ser "sem `.` nem `;` no meio", e o limite de
 * caracteres virou um teto frouxo, contra o texto gigante:
 *
 *   com quebra de frase ..... 26 recusadas (todas eram a data da assinatura)
 *   sem quebra, até 140 ..... 103 aceitas, 62 delas com a data a menos de 20
 *
 * As mais distantes que a regra aceita são legítimas e um corte apertado as
 * perderia — "INCLUA-SE O PRESENTE FEITO NA PAUTA DA XIX SEMANA NACIONAL DA
 * CONCILIACAO, FICANDO DESIGNADA AUDIENCIA PARA O DIA 04/11/2024" tem 114
 * caracteres entre uma coisa e outra.
 */
const MAX_DISTANCIA_DA_ANCORA = 140;
const RE_QUEBRA_DE_FRASE = /[.;]\s/;

/**
 * Até onde no futuro uma pauta pode estar: 3 anos.
 *
 * Rede contra o número que o leitor confunde com data — um ano de dois
 * dígitos mal expandido, um "1382/2022" partido ao meio. Não é critério de
 * negócio: é o reconhecimento de que data lida de texto erra, e de que um
 * compromisso em 2043 na agenda de alguém é ruído que ninguém vai limpar.
 */
const MAX_ANTECEDENCIA_MS = 3 * 365 * 24 * 3_600_000;

/**
 * O HORÁRIO que acompanha a data. Aceita "11:45", "09h30", "12:00h", "às 10h".
 * Entre a data e a hora só pode haver pontuação e palavra vazia — "Local:" ou
 * "Sala" encerram a oração, e o número seguinte já é outra coisa.
 *
 * A hora vem DEPOIS da data quase sempre ("25/11/2026 11:45"), mas nem
 * sempre: "A AUDIENCIA QUE ESTAVA MARCADA PARA OCORRER AS 10H30MIN DO DIA
 * 25/09/2024" põe a hora antes. Sem ler esse formato, a pauta nascia às 9h
 * inventadas com a hora escrita a 18 caracteres de distância.
 */
const RE_LIGACAO = /^(?:[\s,.\-–—:()]|AS|A|HORAS?|HORARIO|DE|DIA|EM|PONTO|FEIRA|SEGUNDA|TERCA|QUARTA|QUINTA|SEXTA|SABADO|DOMINGO)*/;
const RE_HORA = /^(\d{1,2})[:H](\d{2})|^(\d{1,2})\s?H\b/;
/** Quanta "cola" aceitamos entre a data e a hora antes de desistir. */
const MAX_LACUNA_HORA = 26;
/** "AS 10H30MIN DO DIA " — a hora logo antes da data, e o que pode ligar as duas. */
const RE_HORA_ANTES = /(\d{1,2})[:H](\d{2})?(?:MIN)?H?\s*(?:HORAS?\s*)?(?:,\s*)?(?:DO |DE |NO )?DIA\s*$/;

/** Modalidade declarada no ato. */
const RE_VIRTUAL =
  /\b(VIRTUAL|TELEPRESENCIAL|VIDEOCONFERENCIA|POR VIDEOCONFERENCIA|ZOOM|GOOGLE MEET|MICROSOFT TEAMS|MEET\.GOOGLE|PLATAFORMA DIGITAL|MEIO ELETRONICO)\b/;

/**
 * A SALA VIRTUAL — escolhida, e não "o primeiro link do texto".
 *
 * Pegar o primeiro colocava na agenda o endereço errado quase sempre. Contado
 * nas 706 publicações com link da produção:
 *
 *   pje.trt22.jus.br ............... 475   consulta do processo
 *   pje.tst.jus.br ................. 132   consulta do processo
 *   trt22-jus-br.zoom.us ............ 90   A SALA
 *   bit.ly .......................... 22   a sala, encurtada (2ª VT Teresina)
 *   justicadotrabalhoeletronica.com   25   a sala do TRT22
 *   transparencia.tjpi.jus.br ....... 16   portal de transparência
 *
 * E o teor normalmente traz vários: 108 publicações têm mais de um link. O
 * primeiro é o rodapé institucional; a sala vem no meio do despacho.
 *
 * Por isso a lista é de ENTRAR, não de sair: só vira `linkReuniao` o endereço
 * que é reconhecidamente uma sala. Link bom de menos é um inconveniente — o
 * advogado abre o processo. Link errado manda alguém para o lugar errado na
 * hora da audiência, e isso é perder a audiência.
 */
const RE_TODOS_OS_LINKS = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
/** Pontuação da frase que vem colada no fim da URL ("…/j/864,", "…download."). */
const RE_PONTUACAO_FINAL = /[.,;:]+$/;

export type ModalidadeAudiencia = 'VIRTUAL' | 'PRESENCIAL';
export type TipoDePauta = 'AUDIENCIA' | 'PERICIA';

export interface PautaNoDiario {
  tipo: TipoDePauta;
  /** Instante de início, já convertido do horário de Teresina. */
  inicio: Date;
  /** `true` quando o ato não disse a hora e assumimos o início do expediente. */
  horaPresumida: boolean;
  modalidade: ModalidadeAudiencia;
  /** Sala virtual, quando o ato publica o endereço. */
  link: string | null;
  /**
   * O ato REMARCA uma pauta que já existia.
   *
   * Quem lê isto é o serviço, para derrubar a antiga: sem esse passo o
   * processo fica com duas audiências abertas e a errada é a que vem antes no
   * calendário — exatamente a que o advogado veria primeiro.
   */
  remarcacao: boolean;
  /** Como o ato nomeia a audiência: "Inicial", "de Conciliação"… */
  rotulo: string;
}

/** Por que uma publicação NÃO virou pauta — o vocabulário vai para o carimbo. */
export const MOTIVOS_SEM_PAUTA = {
  NAO_FALA_DE_PAUTA: 'NAO_FALA_DE_PAUTA',
  CANCELAMENTO: 'CANCELAMENTO',
  SESSAO_DE_JULGAMENTO: 'SESSAO_DE_JULGAMENTO',
  SEM_DESIGNACAO: 'SEM_DESIGNACAO',
  SEM_DATA: 'SEM_DATA',
  DATA_NO_PASSADO: 'DATA_NO_PASSADO',
} as const;
export type MotivoSemPauta = (typeof MOTIVOS_SEM_PAUTA)[keyof typeof MOTIVOS_SEM_PAUTA];

export type LeituraDoDiario =
  | { pauta: PautaNoDiario; motivo?: undefined }
  | { pauta?: undefined; motivo: MotivoSemPauta };

/**
 * A publicação designa uma audiência? Se sim, quando e de que jeito.
 *
 * A DATA É OBRIGATÓRIA, e essa é a regra que segura tudo. Sem data não existe
 * pauta: o texto que só CITA audiência — "ante a proximidade da data de
 * audiência", "defiro a dispensa do comparecimento à audiência designada" — é
 * conversa sobre uma pauta que já existe, não a marcação de uma nova. Na
 * amostra da produção, exigir data elimina exatamente esses casos sem precisar
 * de uma lista de exceções que nunca estaria completa.
 *
 * `publicadaEm` serve de âncora: a pauta é posterior à publicação (o tribunal
 * não intima depois do ato), e datas anteriores são referência a outra coisa —
 * prazo decorrido, data do despacho, audiência já realizada.
 */
export function lerPautaNoDiario(
  textoOriginal: string,
  publicadaEm: Date | string,
): LeituraDoDiario {
  const texto = normalizar(textoOriginal ?? '');
  if (!texto || !RE_ATO.test(texto)) return { motivo: MOTIVOS_SEM_PAUTA.NAO_FALA_DE_PAUTA };
  if (RE_SESSAO_DE_JULGAMENTO.test(texto)) return { motivo: MOTIVOS_SEM_PAUTA.SESSAO_DE_JULGAMENTO };
  if (RE_CANCELAMENTO.test(texto)) return { motivo: MOTIVOS_SEM_PAUTA.CANCELAMENTO };

  const porRotulo = RE_ROTULO_PAUTA.exec(texto);
  const posRemarcacao = texto.search(RE_VERBO_REMARCACAO);
  const posVerbo = posRemarcacao >= 0 ? posRemarcacao : texto.search(RE_VERBO_DESIGNACAO);
  if (!porRotulo && posVerbo < 0) return { motivo: MOTIVOS_SEM_PAUTA.SEM_DESIGNACAO };

  /*
    DE ONDE CONTAR A DATA. O rótulo ("AUDIÊNCIA: ") aponta direto para ela e é
    o sinal mais forte; na falta dele, vale a primeira data DEPOIS do verbo.
    Começar do texto inteiro pegaria a data do cabeçalho ou a do prazo citado
    no meio do despacho — e o compromisso nasceria no dia errado.
  */
  const ancora = porRotulo ? porRotulo.index + porRotulo[0].length : posVerbo;

  const candidatos: { inicio: number; fim: number; dia: number; mes: number; ano: number }[] = [];
  RE_DATA.lastIndex = 0;
  for (let m = RE_DATA.exec(texto); m; m = RE_DATA.exec(texto)) {
    candidatos.push({
      inicio: m.index, fim: m.index + m[0].length, dia: +m[1], mes: +m[2], ano: +m[3],
    });
  }
  RE_DATA_EXTENSO.lastIndex = 0;
  for (let m = RE_DATA_EXTENSO.exec(texto); m; m = RE_DATA_EXTENSO.exec(texto)) {
    const mes = MESES[m[2]];
    if (mes) {
      candidatos.push({
        inicio: m.index, fim: m.index + m[0].length, dia: +m[1], mes, ano: +m[3],
      });
    }
  }
  const perto = candidatos
    .filter(
      (c) =>
        c.inicio >= ancora &&
        c.inicio - ancora <= MAX_DISTANCIA_DA_ANCORA &&
        // Mesma frase da designação: o que vem depois do ponto final é outro
        // assunto, e quase sempre é a data em que o juiz assinou.
        !RE_QUEBRA_DE_FRASE.test(texto.slice(ancora, c.inicio)),
    )
    .sort((a, b) => a.inicio - b.inicio);
  if (!perto.length) return { motivo: MOTIVOS_SEM_PAUTA.SEM_DATA };

  const base = new Date(publicadaEm);
  const limiteInferior = Number.isFinite(base.getTime())
    ? base.getTime() - 24 * 3_600_000 // o ato pode ser publicado no mesmo dia
    : -Infinity;
  const limiteSuperior = Number.isFinite(base.getTime())
    ? base.getTime() + MAX_ANTECEDENCIA_MS
    : Infinity;

  for (const c of perto) {
    const hora =
      extrairHora(texto.slice(c.fim, c.fim + MAX_LACUNA_HORA + 8)) ??
      extrairHoraAntes(texto.slice(Math.max(0, c.inicio - 24), c.inicio));
    const ano = c.ano < 100 ? 2000 + c.ano : c.ano;
    const inicio = montarInstante(c.dia, c.mes, ano, hora?.hora ?? 9, hora?.minuto ?? 0);
    if (!inicio) continue;
    if (inicio.getTime() < limiteInferior) continue; // referência ao passado
    if (inicio.getTime() > limiteSuperior) continue; // número lido como data
    return {
      pauta: {
        tipo: RE_PERICIA.test(texto) && !/\bAUDIENCIA\b/.test(texto) ? 'PERICIA' : 'AUDIENCIA',
        inicio,
        horaPresumida: !hora,
        modalidade: RE_VIRTUAL.test(texto) ? 'VIRTUAL' : 'PRESENCIAL',
        link: escolherSalaVirtual(textoOriginal ?? ''),
        rotulo: rotuloDaPauta(texto),
        remarcacao: posRemarcacao >= 0,
      },
    };
  }
  return { motivo: MOTIVOS_SEM_PAUTA.DATA_NO_PASSADO };
}

/**
 * Como o ato chama a audiência — "Inicial", "de Conciliação", "de Instrução".
 *
 * Serve para o TÍTULO do compromisso dizer o que é sem obrigar ninguém a abrir
 * o processo. Sem qualificador reconhecido, devolve só "Audiência": inventar
 * um nome a partir do texto seria chutar, e o nome errado na agenda é pior que
 * o nome genérico.
 */
function rotuloDaPauta(textoNormalizado: string): string {
  const QUALIFICADORES: [RegExp, string][] = [
    [/\bINSTRUCAO E JULGAMENTO\b/, 'de instrução e julgamento'],
    [/\bUNA\b/, 'una'],
    [/\bINICIAL|INAUGURAL\b/, 'inicial'],
    [/\bCONCILIACAO|CONCILIATORIA\b/, 'de conciliação'],
    [/\bINSTRUCAO\b/, 'de instrução'],
    [/\bMEDIACAO\b/, 'de mediação'],
    [/\bJULGAMENTO\b/, 'de julgamento'],
    [/\bPERICIA\b/, 'perícia'],
  ];
  for (const [re, nome] of QUALIFICADORES) if (re.test(textoNormalizado)) return nome;
  return '';
}

/**
 * O endereço da sala, quando o ato publica um que dá para reconhecer.
 *
 * `salaDaCasa` é a pergunta "este endereço é uma sala de audiência?", e ela é
 * respondida por HOST + CAMINHO, nunca só por host: `zoom.us/download` é a
 * página de baixar o programa, e apareceu 2× no acervo; `zoom.us/j/8641…` é
 * uma sala. Sem `/j/`, não entra.
 */
function escolherSalaVirtual(textoOriginal: string): string | null {
  for (const bruto of textoOriginal.match(RE_TODOS_OS_LINKS) ?? []) {
    const limpo = bruto.replace(RE_PONTUACAO_FINAL, '');
    let url: URL;
    try {
      url = new URL(limpo);
    } catch {
      continue; // URL torta no meio do teor — não é endereço de sala
    }
    const host = url.host.toLowerCase();
    const caminho = url.pathname.toLowerCase();
    const ehZoom = host === 'zoom.us' || host.endsWith('.zoom.us');
    const salaDaCasa =
      (ehZoom && caminho.startsWith('/j/')) ||
      host === 'meet.google.com' ||
      host === 'teams.live.com' ||
      host.endsWith('teams.microsoft.com') ||
      host.endsWith('.webex.com') ||
      // O TRT22 publica a sala por aqui e, na 2ª Vara de Teresina, encurtada.
      host.endsWith('justicadotrabalhoeletronica.com') ||
      host === 'bit.ly';
    if (salaDaCasa) return limpo;
  }
  return null;
}

/** A hora escrita imediatamente ANTES da data ("as 10h30min do dia 25/09/2024"). */
function extrairHoraAntes(antes: string): { hora: number; minuto: number } | null {
  const m = RE_HORA_ANTES.exec(antes);
  if (!m) return null;
  const hora = +m[1];
  const minuto = +(m[2] ?? 0);
  if (hora > 23 || minuto > 59) return null;
  return { hora, minuto };
}

function extrairHora(apos: string): { hora: number; minuto: number } | null {
  const prefixo = RE_LIGACAO.exec(apos)?.[0] ?? '';
  if (prefixo.length > MAX_LACUNA_HORA) return null;
  const h = RE_HORA.exec(apos.slice(prefixo.length));
  if (!h) return null;
  const hora = +(h[1] ?? h[3] ?? 0);
  const minuto = +(h[2] ?? 0);
  if (hora > 23 || minuto > 59) return null;
  return { hora, minuto };
}

/**
 * Dia/hora de TERESINA viram o instante real.
 *
 * `Date.UTC` + offset, e nunca `new Date('AAAA-MM-DD')`: a segunda forma é
 * meia-noite de Londres e anda um dia para trás — o defeito que já fez 100%
 * das tarefas do Diário nascerem na véspera.
 */
function montarInstante(
  dia: number,
  mes: number,
  ano: number,
  hora: number,
  minuto: number,
): Date | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const utc = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const d = new Date(utc);
  // 31/02 "rola" para 03/03 — data que não existe não vira pauta.
  if (d.getUTCDate() !== dia || d.getUTCMonth() !== mes - 1 || d.getUTCFullYear() !== ano) {
    return null;
  }
  return new Date(utc + OFFSET_BR_MS);
}
