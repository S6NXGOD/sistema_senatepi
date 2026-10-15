import { MOTIVOS_SEM_PAUTA, lerPautaNoDiario } from './audiencia-do-diario.util';

/**
 * O LEITOR DE PAUTA DO DIÁRIO — provado contra o texto que os tribunais
 * escrevem de verdade.
 *
 * Todo texto aqui é RECORTE DE PUBLICAÇÃO REAL da produção (2.444 do acervo
 * do SENATEPI), encurtado só no que não muda a decisão. Fixture inventada
 * prova a regra que eu imaginei; estas provam a que o TRT-22 e o TJ-PI usam.
 *
 * O que cada bloco defende está no comentário dele. Em comum: a decisão deste
 * arquivo vira COMPROMISSO NA AGENDA DE ALGUÉM, com dia e hora. Errar o dia é
 * pior do que não agendar — por isso a regra é "sem certeza, não é pauta", e
 * quase todo teste aqui é de recusa.
 */

/** O dia em que a publicação saiu — é a âncora do passado. */
const PUB = '2026-09-30';

describe('lerPautaNoDiario — o que É pauta', () => {
  /**
   * O cabeçalho do PJe. É a forma mais comum e a mais confiável: não há verbo
   * nenhum, é o rótulo e os dois-pontos.
   */
  it('lê o cabeçalho "AUDIÊNCIA VIRTUAL: dd/mm/aaaa hh:mm"', () => {
    const r = lerPautaNoDiario(
      'INTIMAÇÃO Fica V. Sa. intimado para a AUDIÊNCIA UNA VIRTUAL: 25/11/2026 11:45, ' +
        'que será realizada por videoconferência pelo link ' +
        'https://trt22-jus-br.zoom.us/j/4341731264',
      PUB,
    );
    expect(r.pauta).toBeDefined();
    // 11:45 de Teresina = 14:45 UTC. O contêiner roda em UTC: se este número
    // virar 11:45Z, a audiência aparece três horas antes na agenda.
    expect(r.pauta!.inicio.toISOString()).toBe('2026-11-25T14:45:00.000Z');
    expect(r.pauta!.horaPresumida).toBe(false);
    expect(r.pauta!.tipo).toBe('AUDIENCIA');
    expect(r.pauta!.rotulo).toBe('una');
    expect(r.pauta!.modalidade).toBe('VIRTUAL');
    expect(r.pauta!.link).toBe('https://trt22-jus-br.zoom.us/j/4341731264');
  });

  /** O despacho, com o verbo no corpo e a hora grudada por "às". */
  it('lê "designada para o dia 29/06/2027 às 08:00h"', () => {
    const r = lerPautaNoDiario(
      'AUDIÊNCIA (CONCILIAÇÃO, INSTRUÇÃO E JULGAMENTO) DESIGNADA PARA O DIA 29/06/2027 ' +
        'ÀS 08:00H, QUE SERÁ REALIZADA POR VIDEOCONFERÊNCIA.',
      PUB,
    );
    expect(r.pauta!.inicio.toISOString()).toBe('2027-06-29T11:00:00.000Z');
    expect(r.pauta!.rotulo).toBe('de instrução e julgamento');
  });

  /**
   * ANO DE DOIS DÍGITOS. Uma publicação em 129 escreve assim, e sem ler esse
   * formato o leitor pulava a data certa e pegava a seguinte do texto.
   */
  it('lê o ano de dois dígitos — "29/06/27"', () => {
    const r = lerPautaNoDiario('AUDIÊNCIA DESIGNADA PARA O DIA 29/06/27 ÀS 08:00H.', PUB);
    expect(r.pauta!.inicio.toISOString()).toBe('2027-06-29T11:00:00.000Z');
  });

  /** A data por extenso, a 81 caracteres do verbo — e legítima. */
  it('lê "25 DE FEVEREIRO DE 2027, ÀS 09H45MIN" mesmo longe do verbo', () => {
    const r = lerPautaNoDiario(
      'FICA DESIGNADA A INCLUSÃO DO PROCESSO EM PAUTA DE AUDIÊNCIA DE CONCILIAÇÃO ' +
        'PARA O DIA 25 DE FEVEREIRO DE 2027, ÀS 09H45MIN, DEVENDO AS PARTES SEREM NOTIFICADAS.',
      PUB,
    );
    expect(r.pauta!.inicio.toISOString()).toBe('2027-02-25T12:45:00.000Z');
    expect(r.pauta!.rotulo).toBe('de conciliação');
  });

  /**
   * A HORA VEM ANTES DA DATA. "às 10h30min do dia 25/09" — sem ler isto, a
   * pauta nascia às 9h inventadas com a hora certa a 18 caracteres dali.
   */
  it('lê a hora escrita ANTES da data', () => {
    const r = lerPautaNoDiario(
      'A AUDIÊNCIA QUE ESTAVA MARCADA PARA OCORRER ÀS 10H30MIN DO DIA 25/11/2026 FICA MANTIDA.',
      PUB,
    );
    expect(r.pauta!.inicio.toISOString()).toBe('2026-11-25T13:30:00.000Z');
    expect(r.pauta!.horaPresumida).toBe(false);
  });

  /**
   * REDESIGNAÇÃO: O OFÍCIO CITA AS DUAS DATAS, E A BOA É A SEGUNDA.
   *
   * Ancorando no primeiro verbo o leitor gravava a pauta VELHA, às 9h
   * inventadas. Três publicações da produção têm exatamente este molde, e o
   * erro mandaria o advogado no dia errado com a agenda parecendo certa.
   */
  it('na remarcação, pega a data NOVA e não a anterior', () => {
    const r = lerPautaNoDiario(
      'A AUDIÊNCIA DO PRESENTE FEITO, ANTERIORMENTE DESIGNADA PARA 03/12/2026, ' +
        'FOI REDESIGNADA PARA O DIA E HORÁRIO A SEGUIR: 28/11/2026 08:30.',
      PUB,
    );
    expect(r.pauta!.inicio.toISOString()).toBe('2026-11-28T11:30:00.000Z');
  });

  /** Perícia é pauta também, e tem tipo próprio para não oferecer "houve acordo". */
  it('distingue perícia de audiência', () => {
    const r = lerPautaNoDiario('PERÍCIA MÉDICA DESIGNADA PARA O DIA 10/12/2026 ÀS 14:00.', PUB);
    expect(r.pauta!.tipo).toBe('PERICIA');
  });

  /** Sem palavra de modalidade e sem link, é presencial — o padrão do mundo. */
  it('sem sinal de virtual, a pauta é presencial e sem link', () => {
    const r = lerPautaNoDiario('AUDIÊNCIA INICIAL DESIGNADA PARA O DIA 10/12/2026 ÀS 14:00.', PUB);
    expect(r.pauta!.modalidade).toBe('PRESENCIAL');
    expect(r.pauta!.link).toBeNull();
  });
});

describe('lerPautaNoDiario — a sala virtual é escolhida, não é "o primeiro link"', () => {
  /**
   * Nas 706 publicações com link da produção, o endereço mais frequente é a
   * CONSULTA DO PROCESSO (475 pje.trt22 + 132 pje.tst) e não a sala (90
   * zoom). 108 publicações trazem mais de um link. Pegar o primeiro põe o
   * endereço errado na agenda na hora da audiência.
   */
  it('ignora o link de consulta do processo e pega a sala', () => {
    const r = lerPautaNoDiario(
      'Processo disponível em https://pje.trt22.jus.br/consultaprocessual/ . ' +
        'AUDIÊNCIA VIRTUAL: 25/11/2026 11:45. Sala: https://trt22-jus-br.zoom.us/j/4341731264',
      PUB,
    );
    expect(r.pauta!.link).toBe('https://trt22-jus-br.zoom.us/j/4341731264');
  });

  /** `zoom.us/download` é a página de baixar o programa. Apareceu 2× no acervo. */
  it('não aceita zoom.us/download como sala', () => {
    const r = lerPautaNoDiario(
      'AUDIÊNCIA VIRTUAL: 25/11/2026 11:45. Baixe o aplicativo em https://zoom.us/download.',
      PUB,
    );
    expect(r.pauta!.link).toBeNull();
  });

  /** A pontuação da frase vinha colada: "…/j/86414266800," ia inteira para a agenda. */
  it('tira a vírgula e o ponto grudados no fim da URL', () => {
    const r = lerPautaNoDiario(
      'AUDIÊNCIA VIRTUAL: 25/11/2026 11:45, pela sala https://trt22-jus-br.zoom.us/j/86414266800, ' +
        'conforme ato da secretaria.',
      PUB,
    );
    expect(r.pauta!.link).toBe('https://trt22-jus-br.zoom.us/j/86414266800');
  });
});

describe('lerPautaNoDiario — o que NÃO é pauta', () => {
  /**
   * O PIOR FALSO POSITIVO DE TODOS: a data da ASSINATURA DO JUIZ.
   *
   * São 26 publicações do mesmo molde — o despacho menciona uma audiência que
   * já existe, encerra a frase, e o fecho do documento traz "TERESINA/PI, 03
   * DE FEVEREIRO DE 2026". A distância é de 24 caracteres, dentro de qualquer
   * corte razoável. O que separa as duas coisas é o PONTO FINAL.
   */
  it('não confunde a data da assinatura com a da audiência', () => {
    const r = lerPautaNoDiario(
      'A MATÉRIA JÁ FOI DEBATIDA. MANTENHO A AUDIÊNCIA DESIGNADA. INTIME-SE. ' +
        'TERESINA/PI, 03 DE DEZEMBRO DE 2026. LUIS FORTES DO REGO JUNIOR, JUIZ DO TRABALHO.',
      PUB,
    );
    expect(r.pauta).toBeUndefined();
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.SEM_DATA);
  });

  /** "Aguarde-se a audiência já designada" fala de uma pauta que já existe. */
  it('não agenda quando o ato só MENCIONA uma audiência existente', () => {
    const r = lerPautaNoDiario(
      'CUMPRA-SE COM O FEITO, E AGUARDE-SE A AUDIÊNCIA JÁ DESIGNADA. A PUBLICAÇÃO DA ' +
        'PRESENTE DECISÃO TEM EFEITO DE CITAÇÃO. PRAZO DE 15 DIAS A CONTAR DE 10/10/2026.',
      PUB,
    );
    expect(r.pauta).toBeUndefined();
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.SEM_DATA);
  });

  /**
   * SESSÃO DE JULGAMENTO NÃO É AUDIÊNCIA. O plenário virtual dura DIAS
   * ("início 21/10 às 00:00, término 23/10 às 00:00") e ninguém comparece.
   * Agendar isso promete presença onde não há — pior que não agendar.
   */
  it('deixa de fora a sessão virtual de julgamento', () => {
    const r = lerPautaNoDiario(
      'INCLUA-SE O FEITO EM PAUTA DA SESSÃO VIRTUAL DE JULGAMENTO, COM INÍCIO NO DIA ' +
        '21/10/2026 ÀS 00:00 E TÉRMINO NO DIA 23/10/2026 ÀS 00:00. AUDIÊNCIA DISPENSADA.',
      PUB,
    );
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.SESSAO_DE_JULGAMENTO);
  });

  /** Pauta que caiu não vai para a agenda de ninguém. */
  it('recusa o cancelamento', () => {
    const r = lerPautaNoDiario(
      'FICA CANCELADA A AUDIÊNCIA designada para o dia 25/11/2026 às 11:45.',
      PUB,
    );
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.CANCELAMENTO);
  });

  /**
   * "REDESIGNADA" NÃO É CANCELAMENTO, e é por isso que a lista de cancelar
   * evita a raiz comum: ela desmarca uma e marca outra, e a outra é
   * justamente a que queremos.
   */
  it('remarcação não cai na regra de cancelamento', () => {
    const r = lerPautaNoDiario(
      'A AUDIÊNCIA FOI REDESIGNADA PARA O DIA 28/11/2026 ÀS 08:30.',
      PUB,
    );
    expect(r.pauta).toBeDefined();
  });

  it('texto que não fala de pauta nenhuma', () => {
    const r = lerPautaNoDiario('INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS.', PUB);
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.NAO_FALA_DE_PAUTA);
  });

  it('fala de audiência, mas não designa nada', () => {
    const r = lerPautaNoDiario(
      'CIÊNCIA ÀS PARTES DO TEOR DA ATA DE AUDIÊNCIA JUNTADA AOS AUTOS.',
      PUB,
    );
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.SEM_DESIGNACAO);
  });

  /**
   * A DATA ANTERIOR À PUBLICAÇÃO É REFERÊNCIA, NUNCA PAUTA. O tribunal não
   * intima depois do ato; data para trás é prazo decorrido ou audiência já
   * realizada.
   */
  it('recusa a data anterior à publicação', () => {
    const r = lerPautaNoDiario('AUDIÊNCIA DESIGNADA PARA O DIA 10/01/2020 ÀS 14:00.', PUB);
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.DATA_NO_PASSADO);
  });

  /** Rede contra o número lido como data: ninguém marca audiência para 2043. */
  it('recusa a data absurdamente no futuro', () => {
    const r = lerPautaNoDiario('AUDIÊNCIA DESIGNADA PARA O DIA 10/01/2043 ÀS 14:00.', PUB);
    expect(r.motivo).toBe(MOTIVOS_SEM_PAUTA.DATA_NO_PASSADO);
  });

  /** 31 de fevereiro "rola" para 3 de março no JS; data que não existe não é pauta. */
  it('recusa data que não existe no calendário', () => {
    const r = lerPautaNoDiario('AUDIÊNCIA DESIGNADA PARA O DIA 31/02/2027 ÀS 14:00.', PUB);
    expect(r.pauta).toBeUndefined();
  });

  it('texto vazio não quebra', () => {
    expect(lerPautaNoDiario('', PUB).motivo).toBe(MOTIVOS_SEM_PAUTA.NAO_FALA_DE_PAUTA);
    expect(lerPautaNoDiario(undefined as unknown as string, PUB).motivo).toBe(
      MOTIVOS_SEM_PAUTA.NAO_FALA_DE_PAUTA,
    );
  });
});

describe('lerPautaNoDiario — o horário quando o ato não diz', () => {
  /**
   * Nas 101 leituras da produção, ZERO caem aqui: todo ato diz a hora. Mas
   * quando não disser, a suposição tem de ser VISÍVEL — quem recebe o
   * compromisso precisa saber que as 9h são nossas, e não do juiz.
   */
  it('marca `horaPresumida` quando o ato só dá o dia', () => {
    const r = lerPautaNoDiario(
      'FICA DESIGNADA AUDIÊNCIA PARA O DIA 25/11/2026, CONFORME PAUTA DA SECRETARIA.',
      PUB,
    );
    expect(r.pauta!.horaPresumida).toBe(true);
    // 9h de Teresina, e não 9h UTC.
    expect(r.pauta!.inicio.toISOString()).toBe('2026-11-25T12:00:00.000Z');
  });
});
