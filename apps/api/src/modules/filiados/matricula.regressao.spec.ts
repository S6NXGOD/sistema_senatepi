import { proximoSequencial } from '@core/infra';

/**
 * REGRESSÃO DO INCIDENTE DE 14/08/2026 — cadastro de filiados parado em produção.
 *
 * O sintoma no log do Railway, repetido o dia inteiro:
 *
 *     Invalid `prisma.filiado.create()` invocation:
 *     Unique constraint failed on the fields: (`matricula`)
 *       at async FiliadosService.create (.../filiados.service.js:75:25)
 *
 * A causa era `gerarMatricula('SEN', count() + 1)`. O que torna este defeito
 * grave não é errar uma vez: é que, depois de errar, ele NUNCA MAIS ACERTA —
 * como o `create` falha, nada é inserido, `count()` devolve o mesmo número e a
 * tentativa seguinte colide igual. O cadastro para de vez.
 *
 * Estes casos travam o comportamento novo: numerar a partir da MAIOR matrícula
 * já emitida, que só anda para frente.
 */
describe('numeração de matrícula (regressão do incidente de produção)', () => {
  it('a primeira matrícula de um cadastro vazio é a 1', () => {
    expect(proximoSequencial('SEN', [])).toBe(1);
  });

  it('segue a maior já emitida, não a quantidade de registros', () => {
    expect(proximoSequencial('SEN', ['SEN-2026-000001', 'SEN-2026-000002'])).toBe(3);
  });

  /**
   * O CASO QUE DERRUBOU A PRODUÇÃO.
   *
   * Três emitidas, uma excluída → `count()` diz 2 e devolve a matrícula 3, que
   * já está com alguém. Com a regra nova o buraco fica aberto de propósito:
   * número de matrícula não se reaproveita, porque ele pode estar impresso numa
   * carteirinha em circulação.
   */
  it('NÃO reaproveita número depois de uma exclusão', () => {
    const aindaNoBanco = ['SEN-2026-000001', 'SEN-2026-000003']; // a 2 foi excluída
    expect(proximoSequencial('SEN', aindaNoBanco)).toBe(4);
  });

  it('continua andando para frente mesmo com o cadastro quase todo apagado', () => {
    expect(proximoSequencial('SEN', ['SEN-2026-007180'])).toBe(7181);
  });

  /**
   * O ano é texto da matrícula; o sequencial é único no cadastro inteiro.
   * Recomeçar do 1 em janeiro colidiria com o ano anterior.
   */
  it('atravessa a virada do ano sem colidir', () => {
    expect(proximoSequencial('SEN', ['SEN-2025-000500', 'SEN-2024-000100'])).toBe(501);
  });

  /**
   * A base do SENATEPI tem 7.146 filiados e só 193 matrículas no padrão — o
   * resto veio da carga legada com outro formato. Deixar esse texto influenciar
   * o contador daria saltos enormes ou números vindos de coisa que só parece
   * número.
   */
  it('ignora matrícula fora do padrão (carga legada)', () => {
    const base = ['12345', 'MAT-999', '', null, undefined, 'SEN-2026-000193'];
    expect(proximoSequencial('SEN', base)).toBe(194);
  });

  it('não confunde o prefixo de outro cadastro', () => {
    // `FUNC-` é do colaborador; não pode empurrar a numeração do filiado.
    expect(proximoSequencial('SEN', ['FUNC-2026-000900', 'SEN-2026-000002'])).toBe(3);
  });

  it('o colaborador usa a mesma regra, com o próprio prefixo', () => {
    expect(proximoSequencial('FUNC', ['FUNC-2026-000900', 'SEN-2026-000002'])).toBe(901);
  });

  /**
   * A importação da equipe grava a matrícula da ORIGEM (`2025F001`), que não
   * segue o padrão. Sem esta garantia, 40 pessoas importadas empurrariam o
   * contador 40 casas — que era o defeito do `count()` reaparecendo por outra
   * porta.
   */
  it('matrícula vinda de sistema antigo não empurra o contador', () => {
    expect(proximoSequencial('FUNC', ['2025F001', '2025F002', 'FUNC-2026-000003'])).toBe(4);
  });
});
