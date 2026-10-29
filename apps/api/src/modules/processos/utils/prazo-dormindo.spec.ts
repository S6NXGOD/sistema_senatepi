import {
  deQuemEOPrazo,
  oPrazoPodeVirarData,
  prazoPendurado,
  quemFoiIntimado,
} from './de-quem-e-a-ordem.util';

/**
 * AS DUAS ATIVIDADES QUE O ROBÔ CRIOU E ALGUÉM CANCELOU À MÃO — 22/09/2026.
 *
 * O dono pediu: *"Analise todas as atividades canceladas pelo robô e veja o
 * motivo, para esse erro não ser mais repetido."*
 *
 * Foram 58 cancelamentos na produção. A maioria esmagadora (34) é do criador
 * cego do DataJud, que já foi DESLIGADO. Sobraram DOIS erros do DJEN — e o
 * teste de reprocessar o acervo com o código de então mostrava que os dois
 * nasceriam de novo. São estes dois casos, com o texto real.
 *
 * E O MOTIVO ESCRITO NO CANCELAMENTO ESTAVA ERRADO nos dois. Diziam "o prazo é
 * da parte contrária"; lendo os autos, **o prazo é NOSSO nos dois** — só que
 * está DORMINDO, condicionado a um evento que ainda não aconteceu. Marcar data
 * na agenda hoje é prometer um dia que depende de terceiro.
 *
 * Medido no acervo: **7 das 2.395 publicações** mudam de caminho, e entre as
 * tarefas afetadas estão as 5 que foram canceladas à mão.
 */

/** O despacho da execução contra o ISAC (VT de Parnaíba, 03/09/2026). */
const ISAC =
  'INTIME-SE a executada (INSTITUTO SAÚDE E CIDADANIA - ISAC) para que, no prazo de 15 (quinze) ' +
  'dias, comprove o cumprimento da obrigação de fazer determinada na sentença, acostando aos ' +
  'autos a relação nominal de todos os empregados celetistas representados pelo sindicato autor. ' +
  'Apresentada a documentação pela executada, ou transcorrido in albis o prazo supra, INTIME-SE ' +
  'o sindicato exequente para que, no prazo de 15 (quinze) dias, apresente a sua conta de ' +
  'liquidação devidamente discriminada e atualizada.';

/** A sentença homologatória do acordo com a Clínica Santa Fé (4ª VT, 04/09/2026). */
const SANTA_FE =
  'HOMOLOGO o acordo de ID 23f38b2, para que produza seus jurídicos e legais efeitos. ' +
  'O SENATEPI deverá comprovar nos autos, no prazo de 30 (trinta) dias após o recebimento de ' +
  'cada parcela, o repasse dos valores aos respectivos substituídos. ' +
  'Apurado eventual débito, intime-se a reclamada para recolhimento no prazo de 15 dias.';

describe('quem foi intimado × quem foi citado', () => {
  /**
   * O DEFEITO DO CASO ISAC. A frase tem papel ATIVO ("sindicato autor") e
   * PASSIVO ("executada"), e a regra concluía "obriga os dois lados" → prazo
   * NOSSO → tarefa na agenda. Mas a ordem é de UM: a executada. Nós aparecemos
   * cem caracteres depois, dentro da DESCRIÇÃO do que ela tem de entregar.
   */
  it('o destinatário é quem vem logo depois do verbo, não quem é citado adiante', () => {
    expect(
      quemFoiIntimado(
        'INTIME-SE A EXECUTADA (ISAC) PARA QUE, NO PRAZO DE 15 DIAS, COMPROVE O CUMPRIMENTO, ' +
          'ACOSTANDO A RELACAO NOMINAL DOS EMPREGADOS REPRESENTADOS PELO SINDICATO AUTOR',
      ),
    ).toBe('PASSIVO');
  });

  it('e acerta quando quem é intimado somos nós', () => {
    expect(quemFoiIntimado('INTIME-SE O SINDICATO EXEQUENTE PARA QUE, NO PRAZO DE 15 DIAS, APRESENTE'))
      .toBe('ATIVO');
  });

  /** Sem verbo de ordem não há destinatário: devolve null e o resto decide. */
  it('sem verbo de ordem, não opina', () => {
    expect(quemFoiIntimado('FICA A EXECUTADA ADVERTIDA DE QUE O SILENCIO ACARRETARA MULTA')).toBeNull();
  });

  /**
   * OS DOIS LIGADOS POR "E" SÃO OS DOIS — e agora a função DIZ isso.
   *
   * Até 29/10/2026 ela devolvia `null` aqui, e o comentário deste teste já
   * explicava a intenção ("aí a frase obriga mesmo os dois"). Desistir
   * funcionava por acidente: o fluxo caía na regra seguinte, que empurrava
   * para `nosso()`. Funcionava — para este caso.
   */
  it('com os dois papéis ligados por "e", diz que são AMBOS', () => {
    expect(quemFoiIntimado('INTIMEM-SE O AUTOR E A RECLAMADA PARA, NO PRAZO DE 5 DIAS'))
      .toBe('AMBOS');
  });

  /**
   * O CASO EM QUE DESISTIR CUSTAVA CARO — medido na produção em 29/10/2026.
   *
   * "NOTIFIQUE-SE O RECLAMADO PARA APRESENTAR OS DOCUMENTOS INDICADOS PELO
   *  SINDICATO AUTOR, NO PRAZO DE 5 DIAS, SOB PENA DE MULTA"
   *
   * O destinatário é o RECLAMADO; o "sindicato autor" é quem pediu os
   * documentos. Com os dois papéis na janela a função devolvia `null`, o
   * fluxo caía em "a frase obriga os dois lados" e o prazo virava NOSSO —
   * nasceu "Juntar documentos" na agenda do advogado, para um dever da parte
   * contrária. Dos três atos desse molde no acervo, os três eram dela.
   *
   * A régua: dentro da frase, o papel mais PERTO do verbo é o destinatário.
   */
  it('o papel mais perto do verbo é o destinatário, e o outro é só mencionado', () => {
    expect(
      quemFoiIntimado(
        'NOTIFIQUE-SE O RECLAMADO PARA APRESENTAR OS DOCUMENTOS INDICADOS PELO ' +
          'SINDICATO AUTOR (ID 384EFDA), NO PRAZO DE 5 DIAS, SOB PENA DE MULTA',
      ),
    ).toBe('PASSIVO');

    expect(
      quemFoiIntimado(
        'INTIME-SE O RECLAMADO PARA COMPROVAR O PAGAMENTO DO VALOR DEVIDO AO ' +
          'SINDICATO AUTOR, NO PRAZO DE 15 DIAS',
      ),
    ).toBe('PASSIVO');

    // E o espelho: quando quem vem primeiro somos nós, a ordem é nossa.
    expect(
      quemFoiIntimado(
        'INTIME-SE A PARTE AUTORA PARA SE MANIFESTAR SOBRE A DEFESA DO RECLAMADO, ' +
          'NO PRAZO DE 15 DIAS',
      ),
    ).toBe('ATIVO');
  });
});

describe('o prazo pendurado num evento futuro', () => {
  /**
   * O DEFEITO DO CASO SANTA FÉ. O prazo é NOSSO e a obrigação é real — mas o
   * relógio não começou: nenhuma parcela foi recebida. `RE_PRAZO_CONDICIONADO`
   * está ancorado no COMEÇO da frase e não vê a condição pendurada no prazo.
   */
  it('"no prazo de 30 dias após o recebimento" é prazo que não começou', () => {
    expect(
      prazoPendurado(
        'O SENATEPI DEVERA COMPROVAR NOS AUTOS, NO PRAZO DE 30 (TRINTA) DIAS APOS O RECEBIMENTO ' +
          'DE CADA PARCELA, O REPASSE DOS VALORES',
      ),
    ).toBe(true);
  });

  it.each([
    'NO PRAZO DE 15 DIAS APOS O TRANSITO EM JULGADO',
    'NO PRAZO DE 10 DIAS A PARTIR DA JUNTADA DOS DOCUMENTOS',
    'NO PRAZO DE 5 DIAS CONTADOS DO CUMPRIMENTO DA OBRIGACAO',
    'NO PRAZO DE 15 DIAS APOS O PAGAMENTO',
  ])('%s também está dormindo', (frase) => {
    expect(prazoPendurado(frase)).toBe(true);
  });

  /**
   * A LISTA DE EXCEÇÕES É O CORAÇÃO DISTO. "a contar da publicação" e "após a
   * intimação" descrevem o prazo que começa AGORA — é a forma normal de
   * escrever despacho. Tratá-las como condição faria metade do acervo virar
   * proposta, e aí ninguém abriria a caixa.
   */
  it.each([
    'NO PRAZO DE 15 DIAS A CONTAR DA PUBLICACAO',
    'NO PRAZO DE 10 DIAS APOS A INTIMACAO',
    'NO PRAZO DE 5 DIAS CONTADOS DA CIENCIA',
    'NO PRAZO DE 8 DIAS A PARTIR DA NOTIFICACAO',
    'FICA INTIMADO PARA, NO PRAZO DE 15 DIAS, MANIFESTAR-SE',
  ])('%s NÃO está dormindo — o relógio já corre', (frase) => {
    expect(prazoPendurado(frase)).toBe(false);
  });
});

describe('os dois casos reais, de ponta a ponta', () => {
  /**
   * ISAC: o prazo nosso existe (item 4) e está condicionado ao item 2. O
   * cancelamento à mão dizia "o prazo assinalado é da Reclamada" — era meia
   * verdade: o da Reclamada é o item 2, e o nosso é o item 4, dormindo.
   */
  it('ISAC vai para a caixa, não para a agenda', () => {
    const lado = deQuemEOPrazo(ISAC, 'ATIVO', 'SENATEPI');
    expect(lado).toBe('NOSSO_FUTURO');
    expect(oPrazoPodeVirarData(lado)).toBe(false);
  });

  it('Santa Fé vai para a caixa, não para a agenda', () => {
    const lado = deQuemEOPrazo(SANTA_FE, 'ATIVO', 'SENATEPI');
    expect(lado).toBe('NOSSO_FUTURO');
    expect(oPrazoPodeVirarData(lado)).toBe(false);
  });

  /**
   * E O QUE NÃO PODE MUDAR: o prazo nosso que corre AGORA continua virando
   * tarefa. Este é o ato real que gerou a atividade legítima da produção
   * (Elesbão Veloso, 08/09) — se ele parar de criar, o conserto custou mais do
   * que resolveu.
   */
  it('o prazo nosso que já corre continua virando tarefa', () => {
    const elesbao =
      'AUTOR: SINDICATO DOS ENFERMEIROS - SENATEPI. RÉU: MUNICIPIO DE ELESBAO VELOSO. ' +
      'Apresentada a contestação pela parte requerida, tenho por saneado o feito. ' +
      'Intimem-se as partes para, em 10 dias, manifestarem se tem interesse na produção de ' +
      'outras provas.';
    const lado = deQuemEOPrazo(elesbao, 'ATIVO', 'SENATEPI');
    expect(oPrazoPodeVirarData(lado)).toBe(true);
  });
});
