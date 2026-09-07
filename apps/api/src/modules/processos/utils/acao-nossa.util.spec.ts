import { normalizarNome, nossoPoloNoAto } from './acao-nossa.util';

/**
 * O FILTRO QUE SEPARA O NOSSO DO PARTICULAR.
 *
 * A varredura do DJEN consulta por OAB e o CNJ devolve a carteira INTEIRA de
 * cada advogado. Tudo que não casa com um processo cadastrado é descartado — e
 * isso continua certo: a causa particular de quem trabalha aqui não é assunto
 * do sindicato e não pode virar linha no banco.
 *
 * Junto ia o caso NOVO do próprio sindicato. Esta função é a peneira estreita
 * que separa um do outro, e ela erra para os dois lados se estiver frouxa:
 * larga demais persiste dado de terceiro, apertada demais perde a ação nossa.
 */
describe('reconhecer o sindicato num ato do Diário', () => {
  const SIGLA = 'SENATEPI';

  /**
   * O NOME DO TRIBUNAL NÃO É O DO CADASTRO. Conferido na produção:
   *   cadastro: "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ"
   *   o DJEN:   "SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI"
   * Vírgula a mais, "AUXILIARES" no meio, "EM" no lugar de "DE", sem acento.
   */
  it('acha a sigla no nome longo que o tribunal escreve', () => {
    const destinatarios = [
      { nome: 'HAPVIDA - PARTICIPACOES E INVESTIMENTOS LTDA', polo: 'A' },
      {
        nome: 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI',
        polo: 'P',
      },
    ];
    expect(nossoPoloNoAto(destinatarios, SIGLA)).toBe('PASSIVO');
  });

  it('e na variante numerada que aparece nos recursos', () => {
    const d = [{ nome: '2. SINDICATO ... - SENATEPI (RECORRIDO)', polo: 'P' }];
    expect(nossoPoloNoAto(d, SIGLA)).toBe('PASSIVO');
  });

  it('reconhece quando somos autor', () => {
    const d = [
      { nome: 'SINDICATO DOS ENFERMEIROS ... - SENATEPI', polo: 'A' },
      { nome: 'CLINICA DR RICARDO XAVIER LTDA', polo: 'P' },
    ];
    expect(nossoPoloNoAto(d, SIGLA)).toBe('ATIVO');
  });

  /**
   * AMBOS NÃO É DEFEITO DE LEITURA. Em recurso o sindicato figura como
   * recorrente E recorrido, e o tribunal lista os dois. Medido nas 1.408
   * publicações do acervo em 07/09/2026: 754 só autor, 167 só réu e **113 nos
   * dois** — 11%. A primeira versão desta função devolvia o primeiro polo do
   * array, o que naquelas 113 era um chute com cara de fato.
   */
  it('nos dois polos devolve AMBOS, e não um chute', () => {
    const d = [
      { nome: 'SINDICATO ... - SENATEPI', polo: 'A' },
      { nome: 'EMPRESA X LTDA', polo: 'P' },
      { nome: 'SINDICATO ... - SENATEPI', polo: 'P' },
    ];
    expect(nossoPoloNoAto(d, SIGLA)).toBe('AMBOS');
  });

  /** Está no ato mas o tribunal não classificou: caso para alguém olhar. */
  it('polo desconhecido vira INDEFINIDO, não some', () => {
    expect(nossoPoloNoAto([{ nome: 'SINDICATO - SENATEPI', polo: 'X' }], SIGLA)).toBe('INDEFINIDO');
    expect(nossoPoloNoAto([{ nome: 'SINDICATO - SENATEPI' }], SIGLA)).toBe('INDEFINIDO');
  });

  /**
   * A PENEIRA TEM DE SER ESTREITA — o que passa daqui vira linha no banco.
   * Publicação de terceiro persistida é o dado que a decisão de privacidade da
   * ingestão existe para NÃO guardar.
   */
  it('processo particular do advogado não é nosso', () => {
    const d = [
      { nome: 'JOAO DA SILVA', polo: 'A' },
      { nome: 'BANCO XPTO S.A.', polo: 'P' },
    ];
    expect(nossoPoloNoAto(d, SIGLA)).toBeNull();
  });

  /** Fronteira de palavra: sem ela, a sigla casaria dentro de outra razão social. */
  it('não casa a sigla no meio de outra palavra', () => {
    expect(nossoPoloNoAto([{ nome: 'PROSENATEPINHO LTDA', polo: 'A' }], SIGLA)).toBeNull();
  });

  /**
   * SIGLA CURTA NÃO SERVE DE CHAVE: duas ou três letras casariam dentro de
   * qualquer razão social e transformariam processo de terceiro em sugestão.
   */
  it('sigla curta demais não identifica ninguém', () => {
    expect(nossoPoloNoAto([{ nome: 'ABC INDUSTRIA ABC LTDA', polo: 'A' }], 'ABC')).toBeNull();
  });

  /** Sem sigla no cadastro (cliente novo, seed ainda não rodou) não quebra. */
  it('sem sigla, ninguém é nós', () => {
    const d = [{ nome: 'SINDICATO - SENATEPI', polo: 'A' }];
    expect(nossoPoloNoAto(d, null)).toBeNull();
    expect(nossoPoloNoAto(d, '')).toBeNull();
  });

  /** O DJEN pode mandar qualquer coisa no campo — inclusive nada. */
  it('aguenta payload torto sem estourar', () => {
    expect(nossoPoloNoAto(null, SIGLA)).toBeNull();
    expect(nossoPoloNoAto('nada disso', SIGLA)).toBeNull();
    expect(nossoPoloNoAto([{ polo: 'A' }], SIGLA)).toBeNull();
    expect(nossoPoloNoAto([null as never], SIGLA)).toBeNull();
  });
});

/**
 * A normalização é o que faz o resto funcionar: sem ela, "PIAUÍ" e "PIAUI" são
 * strings diferentes e o casamento erra justamente nos nomes acentuados.
 */
describe('normalizar nome', () => {
  it('tira acento, pontuação e colapsa espaço', () => {
    expect(normalizarNome('SINDICATO DOS ENFERMEIROS E TÉCNICOS DO PIAUÍ')).toBe(
      'SINDICATO DOS ENFERMEIROS E TECNICOS DO PIAUI',
    );
    expect(normalizarNome('  a,b.  c  ')).toBe('A B C');
  });

  it('nulo e vazio viram string vazia', () => {
    expect(normalizarNome(null)).toBe('');
    expect(normalizarNome(undefined)).toBe('');
  });
});
