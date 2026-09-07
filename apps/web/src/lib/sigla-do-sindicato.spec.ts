import { ehOSindicato, palavrasDoNome } from './sigla-do-sindicato';

/**
 * COMPORTAMENTO, NÃO TEXTO-FONTE.
 *
 * O teste anterior desta regra vivia em `rosto-na-publicacao.spec.ts` e afirmava
 * `expect(DIALOGO).toContain('normalizarNome(tenant.sigla)')` — a presença da
 * CHAMADA. Ele passou verde durante todo o tempo em que a chamada era a errada e
 * o SENATEPI entrava como parte avulsa na tela. Um teste que só confere que uma
 * linha existe não sabe dizer se ela funciona.
 *
 * Os nomes abaixo são as duas grafias que o SENATEPI realmente tem nos
 * destinatários do acervo (`comunicacoes_djen`), copiadas do banco de produção.
 */
const SIGLA = 'SENATEPI';

const COMO_O_TRIBUNAL_ESCREVE =
  'SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI';
const COM_NUMERO_E_POLO =
  '2. SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI (RECORRIDO)';

describe('a sigla do sindicato dentro do nome do Diário', () => {
  it('reconhece o nome por extenso, com e sem numeração de polo', () => {
    expect(ehOSindicato(COMO_O_TRIBUNAL_ESCREVE, SIGLA)).toBe(true);
    expect(ehOSindicato(COM_NUMERO_E_POLO, SIGLA)).toBe(true);
  });

  /**
   * O CADASTRO ESCREVE DIFERENTE ("DE ENFERMAGEM", com acento) e ainda assim é o
   * mesmo sindicato: é justamente por isso que a comparação é pela sigla.
   */
  it('atravessa acento e a redação divergente do cadastro', () => {
    expect(
      ehOSindicato(
        'Sindicato dos Enfermeiros, Auxiliares e Técnicos de Enfermagem do Estado do Piauí – SENATEPI',
        SIGLA,
      ),
    ).toBe(true);
  });

  it('não confunde com as outras partes do mesmo Diário', () => {
    expect(ehOSindicato('1. MUNICÍPIO DE PALMEIRA DO PIAUÍ (RECORRENTE)', SIGLA)).toBe(false);
    expect(ehOSindicato('AMANDA KELLEN IRENE', SIGLA)).toBe(false);
    expect(ehOSindicato('IJC OFTALMOS LTDA', SIGLA)).toBe(false);
  });

  /** PALAVRA INTEIRA: a sigla dentro de outra palavra não é o sindicato. */
  it('exige palavra inteira, não trecho', () => {
    expect(ehOSindicato('PROSENATEPINHO LTDA', SIGLA)).toBe(false);
    expect(ehOSindicato('SENATEPIAUI SERVICOS', SIGLA)).toBe(false);
  });

  /** Sigla curta casaria dentro de qualquer razão social. */
  it('recusa sigla curta demais para distinguir', () => {
    expect(ehOSindicato('ABC TRANSPORTES LTDA', 'ABC')).toBe(false);
  });

  it('não quebra com nome vazio', () => {
    expect(ehOSindicato('', SIGLA)).toBe(false);
  });

  /**
   * A REGRESSÃO EM UMA LINHA.
   *
   * Esta é a diferença exata entre esta normalização e a de `editor-de-partes`:
   * lá a pontuação SOME e o nome inteiro vira um token só. Se alguém trocar o
   * `[^A-Z0-9]+` por `[^A-Z0-9]` aqui, este teste cai — e é o único sinal que
   * separa "O próprio sindicato" de mais uma parte avulsa duplicada no cadastro.
   */
  it('troca pontuação por espaço em vez de removê-la', () => {
    expect(palavrasDoNome(COMO_O_TRIBUNAL_ESCREVE)).toContain('SENATEPI');
    expect(palavrasDoNome('A-B.C')).toEqual(['A', 'B', 'C']);
  });
});
