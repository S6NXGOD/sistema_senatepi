import { contaPublicaDoReu, valeMostrarNaFicha, type EnteDoReu } from './reu-com-conta-publica.util';

/**
 * A CONTA PÚBLICA DO RÉU, NA FICHA DO PROCESSO — 22/09/2026.
 *
 * "Não seria interessante de vez em quando aparecer uma notícia aos advogados
 * com uma orientação — por exemplo, se houver processos para respeitar o piso
 * em tal cidade, mostrar se estão ou não amparados pela LRF."
 *
 * O que este spec trava não é a classificação fiscal (essa é de
 * `leitura-fiscal.util` e tem spec próprio) — é a DECISÃO DE MOSTRAR, que é
 * onde dá para errar feio nos dois sentidos: esconder um argumento do advogado,
 * ou pendurar na ficha do caso uma pendência que é nossa.
 */

const TERESINA: EnteDoReu = {
  codigo: 2211001,
  nome: 'Teresina',
  uf: 'PI',
  esfera: 'M',
  consultadoEm: new Date('2026-09-20T06:00:00.000Z'),
  indicador: {
    percentualRcl: 43.29,
    limiteMaximo: 54,
    limitePrudencial: 51.3,
    limiteAlerta: 48.6,
    despesaPessoal: 1_500_000_000,
    exercicio: 2026,
    quadrimestre: 1,
  },
};

/** Um município acima do prudencial: é onde a orientação importa de verdade. */
const APERTADO: EnteDoReu = {
  ...TERESINA,
  codigo: 2200053,
  nome: 'Município Apertado',
  indicador: { ...TERESINA.indicador!, percentualRcl: 52.4 },
};

describe('o bloco da conta pública do réu', () => {
  it('traz o percentual, os limites e a frase do art. 22', () => {
    const c = contaPublicaDoReu(TERESINA, new Date('2026-09-22T12:00:00.000Z'))!;
    expect(c.nome).toBe('Teresina');
    expect(c.percentualRcl).toBe(43.29);
    expect(c.limitePrudencial).toBe(51.3);
    expect(c.situacao).toBe('REGULAR');
    expect(c.oQueSignifica).toContain('art. 22');
  });

  /**
   * AS EXCEÇÕES SÃO O ARGUMENTO DO SINDICATO, e é por isso que a frase inteira
   * vai para a tela em vez de um selo. A prefeitura diz "estou no prudencial,
   * não posso pagar"; o parágrafo único ressalva a revisão geral anual e **o
   * que decorre de sentença judicial ou de lei** — que é exatamente o caso de
   * uma ação pedindo o piso.
   */
  it('acima do prudencial, a frase lista as exceções — não só a proibição', () => {
    const c = contaPublicaDoReu(APERTADO, new Date('2026-09-22T12:00:00.000Z'))!;
    expect(c.situacao).toBe('PRUDENCIAL');
    expect(c.oQueSignifica).toContain('proibido de conceder aumento');
    expect(c.oQueSignifica).toContain('sentença judicial');
    expect(c.oQueSignifica).toContain('revisão geral anual');
  });

  /** A folga sai em REAIS, que é o número que serve numa negociação. */
  it('calcula quanto ainda cabe antes do prudencial', () => {
    const c = contaPublicaDoReu(TERESINA, new Date('2026-09-22T12:00:00.000Z'))!;
    expect(c.folga).not.toBeNull();
    expect(c.folga!.valor).toBeGreaterThan(0);
    expect(c.folga!.percentualDaFolha).toBeGreaterThan(0);
  });

  /**
   * O ART. 21 NÃO DEPENDE DO PERCENTUAL. Nos 180 dias finais do mandato o
   * aumento concedido é NULO, esteja o ente dentro ou fora dos limites — e
   * Teresina está dentro. Sem esta linha, a ficha diria "pode conceder" a quem
   * não pode.
   */
  it('o aviso de fim de mandato vem junto, mesmo com o ente dentro do limite', () => {
    const c = contaPublicaDoReu(TERESINA, new Date('2026-09-22T12:00:00.000Z'))!;
    expect(c.situacao).toBe('REGULAR');
    if (c.aviso) expect(c.aviso.texto.length).toBeGreaterThan(10);
  });

  it('sem ente, sem bloco — a maioria das fichas não tem réu público', () => {
    expect(contaPublicaDoReu(null)).toBeNull();
    expect(contaPublicaDoReu(undefined)).toBeNull();
  });
});

describe('mostrar ou não na ficha do processo', () => {
  /**
   * O ENTE NÃO PUBLICOU: fica. Deixar de publicar o RGF é irregularidade DELE,
   * prevista na própria LRF — é argumento, não lacuna nossa.
   */
  it('"não publicou" aparece: é argumento contra o ente', () => {
    const c = contaPublicaDoReu({ ...TERESINA, indicador: null });
    expect(c!.situacao).toBe('SEM_DADO');
    expect(valeMostrarNaFicha(c)).toBe(true);
  });

  /**
   * AINDA NÃO PERGUNTAMOS: some. É atraso NOSSO, não fato do processo. Uma
   * linha na ficha do caso dizendo "não buscamos" não ajuda o advogado e ainda
   * parece defeito do processo — a pendência continua visível em Contas
   * Públicas, que é de quem cuida disso.
   */
  it('"ainda não consultamos" não aparece: a pendência é nossa, não do caso', () => {
    const c = contaPublicaDoReu({ ...TERESINA, indicador: null, consultadoEm: null });
    expect(c!.situacao).toBe('NAO_CONSULTADO');
    expect(valeMostrarNaFicha(c)).toBe(false);
  });

  it('sem bloco nenhum, não mostra', () => {
    expect(valeMostrarNaFicha(null)).toBe(false);
  });

  /**
   * DECLARAÇÃO QUE NÃO FECHA TAMBÉM APARECE. Gastar com folha mais que toda a
   * receita é impossível, e o número não serve para nenhum dos dois lados —
   * mas esconder faria o advogado citar um percentual que o município vai
   * derrubar em contestação.
   */
  it('declaração inconsistente aparece, e diz que não serve de argumento', () => {
    const c = contaPublicaDoReu({
      ...TERESINA,
      indicador: { ...TERESINA.indicador!, percentualRcl: 210 },
    });
    expect(c!.situacao).toBe('INCONSISTENTE');
    expect(valeMostrarNaFicha(c)).toBe(true);
    expect(c!.oQueSignifica).toContain('não fecha');
  });
});
