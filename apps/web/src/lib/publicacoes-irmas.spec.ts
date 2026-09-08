import { agruparPublicacoes, semelhanca, SEMELHANCA_MINIMA } from './publicacoes-irmas';

/**
 * Os números deste arquivo saíram das 136 publicações da produção em
 * 03/09/2026, não de estimativa. Ver o cabeçalho de `publicacoes-irmas.ts`.
 */

const pub = (id: string, dia: string, texto: string, link: string | null = null) => ({
  id,
  dataDisponibilizacao: `${dia}T00:00:00.000Z`,
  texto,
  link,
});

// Cabeçalho que TODA publicação do TRT22 repete — sozinho já dá semelhança
// alta, e é justamente por isso que o corte precisa ser exigente.
const CABECALHO =
  'PODER JUDICIÁRIO JUSTIÇA DO TRABALHO TRIBUNAL REGIONAL DO TRABALHO DA 22ª REGIÃO ' +
  '2ª VARA DO TRABALHO DE TERESINA ATOrd 0000764-11.2021.5.22.0002 AUTOR: SINDICATO DOS ' +
  'ENFERMEIROS AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI SENATEPI RÉU: ' +
  'MUNICIPIO DE TERESINA INTIMADO(S)/CITADO(S):';

const FUNDAMENTACAO = [
  'Fica intimada a parte autora para, no prazo de cinco dias, manifestar-se sobre a certidão do oficial de justiça e sobre os documentos juntados pela reclamada, sob pena de preclusão.',
  'Considerando o acordo homologado nos autos e o depósito recursal efetuado, determino a expedição de alvará em favor do exequente, observada a retenção previdenciária e fiscal cabível.',
  'Intime-se o perito nomeado para apresentar esclarecimentos complementares acerca das condições ambientais aferidas na unidade hospitalar, especialmente quanto ao agente biológico descrito.',
  'Indefiro o pedido de gratuidade formulado pela executada, porquanto ausente comprovação idônea da alegada insuficiência econômica, nos termos da Súmula 463 do Tribunal Superior.',
  'Publique-se, registre-se e cumpra-se, remetendo os autos à contadoria judicial para atualização integral dos cálculos, incluídos juros moratórios e correção monetária pelo índice vigente.',
].join(' ');

describe('agrupamento de publicações irmãs do DJEN', () => {
  const LINK = 'https://pje.trt22.jus.br/pjekz/validacao/26070312552737900000011017561?instancia=2';

  it('junta pelo link do documento, mesmo em publicação curta', () => {
    // O caso que a semelhança de texto NÃO pega: intimação curta em que o nome
    // do advogado é fração grande do texto. O link resolve sem heurística.
    const grupos = agruparPublicacoes([
      pub('a', '2026-08-28', 'Intimado: MURILO MARCONES ALVES VELOSO OAB 9226/PI. Vista dos autos.', LINK),
      pub('b', '2026-08-28', 'Intimado: SHERAD KENNANI CARVALHO SALGUEIROS DE ARAUJO OAB 11301/PI. Vista dos autos.', LINK),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].copias).toHaveLength(1);
  });

  /**
   * A FIXTURE ANTIGA ERA UMA FICÇÃO, e por isso mudou.
   *
   * Ela punha dois atos com TEXTO IDÊNTICO e links diferentes, e exigia
   * separação — o que só o link podia decidir. Mas texto idêntico no mesmo dia
   * e no mesmo processo não é "dois atos": é a mesma coisa duas vezes, e foi
   * exatamente o que apareceu em dobro no painel do usuário.
   *
   * Medido em 08/09/2026 sobre as 1.433 publicações: entre pares do mesmo
   * processo e dia com links DIFERENTES, a mediana de semelhança é 0,973 e 262
   * de 303 passam de 0,9 — são cópias, não atos distintos. Os genuinamente
   * distintos ficam abaixo de 0,4.
   *
   * A fixture agora tem a forma que a produção tem: dois atos diferentes falam
   * de coisas diferentes.
   */
  it('separa dois atos DIFERENTES do mesmo dia, ainda que os links difiram', () => {
    const grupos = agruparPublicacoes([
      pub(
        'desp',
        '2026-08-24',
        `${CABECALHO} DESPACHO. Intime-se a parte autora para apresentar réplica no prazo de 15 dias, sob pena de preclusão.`,
        `${LINK}#a`,
      ),
      pub(
        'sent',
        '2026-08-24',
        'SENTENÇA. Julgo procedente em parte o pedido para condenar a reclamada ao pagamento do adicional de insalubridade em grau médio, com reflexos.',
        `${LINK}#b`,
      ),
    ]);

    expect(grupos).toHaveLength(2);
  });

  /**
   * O CASO QUE ESTAVA QUEBRADO: o tribunal emite um código de validação POR
   * DESTINATÁRIO, então as cópias do MESMO ato chegam com links distintos. Só
   * o texto as reconhece.
   */
  it('junta cópias do mesmo ato quando o tribunal deu um link a cada destinatário', () => {
    const grupos = agruparPublicacoes([
      pub('c1', '2026-09-04', `${FUNDAMENTACAO} Intimado: MURILO MARCONES OAB 9226/PI.`, `${LINK}#1`),
      pub('c2', '2026-09-04', `${FUNDAMENTACAO} Intimado: MORGANA NUALLA OAB 5124/PI.`, `${LINK}#2`),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].copias).toHaveLength(1);
  });

  it('sem link, junta as cópias do mesmo dia num texto de tamanho real', () => {
    // Publicação de tribunal tem centenas de palavras distintas: trocar o nome
    // do advogado mexe em pouco. Foi o que a produção mostrou — a irmã mais
    // divergente dentro de um mesmo link ficou em 0,912.
    const corpo = FUNDAMENTACAO;
    const grupos = agruparPublicacoes([
      pub('a', '2026-08-28', `${CABECALHO} - MURILO MARCONES ALVES VELOSO OAB 9226/PI. ${corpo}`),
      pub('b', '2026-08-28', `${CABECALHO} - SHERAD KENNANI CARVALHO SALGUEIROS DE ARAUJO OAB 11301/PI. ${corpo}`),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].copias).toHaveLength(1);
  });

  it('sem link e com texto curto, prefere repetir a esconder', () => {
    // LIMITAÇÃO CONHECIDA, e é a direção segura. Num texto de cinquenta
    // palavras o nome do advogado é 20% do vocabulário, e a semelhança cai a
    // 0,804. O grupo não se forma e a publicação aparece duas vezes — o erro
    // oposto (agrupar dois atos distintos) sumiria com um deles da tela.
    // Não é hipótese remota nem urgente: nas 136 publicações medidas em
    // 03/09/2026 NENHUMA veio sem link. Este caminho é só a rede de proteção.
    const grupos = agruparPublicacoes([
      pub('a', '2026-08-28', 'Intimado: MURILO MARCONES ALVES VELOSO OAB 9226/PI. Vista dos autos.'),
      pub('b', '2026-08-28', 'Intimado: SHERAD KENNANI CARVALHO SALGUEIROS DE ARAUJO OAB 11301/PI. Vista dos autos.'),
    ]);

    expect(grupos).toHaveLength(2);
  });

  it('mantém separados dois atos DIFERENTES publicados no mesmo dia', () => {
    // O par medido: um despacho curto e uma sentença longa, semelhança 0,054.
    const grupos = agruparPublicacoes([
      pub('curto', '2026-08-24', `${CABECALHO} Vista à parte contrária.`),
      pub('longo', '2026-08-24', 'SENTENÇA. Trata-se de ação civil pública ajuizada pelo sindicato requerendo adicional de insalubridade grau máximo para os servidores lotados na unidade hospitalar, com pedido liminar deferido, perícia realizada e laudo conclusivo pela procedência integral dos pedidos formulados na exordial. Julgo procedente.'),
    ]);

    expect(grupos).toHaveLength(2);
  });

  it('NUNCA junta dias diferentes, mesmo com texto quase igual', () => {
    // Medido: pares de dias diferentes chegam a 0,921 — acima da irmã real
    // mais divergente (0,912). Sem a trava da data, esconderia um ato novo.
    const quase = `${CABECALHO} Fica intimada a parte para manifestar-se sobre o laudo pericial no prazo legal de quinze dias.`;
    const grupos = agruparPublicacoes([
      pub('ontem', '2026-08-27', quase),
      pub('hoje', '2026-08-28', `${quase} Nova perícia deferida.`),
    ]);

    expect(semelhanca(grupos[0].principal.texto, grupos[1].principal.texto)).toBeGreaterThan(
      SEMELHANCA_MINIMA,
    );
    expect(grupos).toHaveLength(2);
  });

  it('elege a versão mais longa como principal, seja qual for a ordem', () => {
    const curta = pub('curta', '2026-08-28', `${CABECALHO} - MURILO OAB 9226/PI. Manifeste-se.`, LINK);
    const longa = pub('longa', '2026-08-28', `${CABECALHO} - MURILO OAB 9226/PI, SHERAD OAB 11301/PI, DURVALINO OAB 75588/SP. Manifeste-se.`, LINK);

    for (const ordem of [[curta, longa], [longa, curta]]) {
      const [g] = agruparPublicacoes(ordem);
      expect(g.principal.id).toBe('longa');
      expect(g.copias.map((c) => c.id)).toEqual(['curta']);
    }
  });

  it('não quebra com lista vazia nem com publicação única', () => {
    expect(agruparPublicacoes([])).toEqual([]);
    const [g] = agruparPublicacoes([pub('só', '2026-09-03', 'Texto qualquer do tribunal.')]);
    expect(g.copias).toEqual([]);
  });
});
