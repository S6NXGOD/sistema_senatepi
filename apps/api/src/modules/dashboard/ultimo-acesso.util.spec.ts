import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ultimoUsoReal } from './ultimo-acesso.util';

const PAINEL = readFileSync(join(__dirname, 'dashboard.module.ts'), 'utf8');

/** A carga da equipe, do começo do bloco até o próximo. */
const CARGA = PAINEL.slice(
  PAINEL.indexOf('const cargaEquipe = !ehGestao'),
  PAINEL.indexOf('A CARTEIRA DO ADVOGADO'),
);

/**
 * "TEM ALGUNS QUE REALMENTE IGNORAM ATIVIDADES ATRASADAS" — pedido de 12/09/2026.
 *
 * A medição mostrou que o sino, a faixa e o painel já avisavam; o furo era de
 * alcance. Das três atividades atrasadas da casa, duas eram de uma pessoa que
 * não entrava havia 39 dias. Aviso dentro do sistema não alcança quem não
 * entra — quem alcança é a coordenação, e para isso ela precisa ver o dado.
 */
describe('o último acesso na carga da equipe', () => {
  it('é o maior entre login, sessão renovada e ação', () => {
    const login = new Date('2026-08-24T19:32:00Z');
    const sessao = new Date('2026-09-12T09:44:00Z');
    const acao = new Date('2026-09-09T21:09:00Z');
    expect(ultimoUsoReal(login, sessao, acao)).toEqual(sessao);
    expect(ultimoUsoReal(sessao, login)).toEqual(sessao);
  });

  /** Nunca entrou é "nunca", e não "agora": o nulo não pode virar data. */
  it('sem registro nenhum, devolve nulo', () => {
    expect(ultimoUsoReal(null, undefined, null)).toBeNull();
    expect(ultimoUsoReal()).toBeNull();
  });

  it('o painel lê as três fontes', () => {
    expect(CARGA).toContain('ultimoLoginEm: true');
    expect(CARGA).toContain('this.prisma.refreshToken.groupBy({');
    expect(CARGA).toContain("acao: { not: 'LOGIN' }");
    expect(CARGA).toContain('ultimoUsoReal(ultimoLoginEm,');
  });

  /**
   * O DADO É DE GESTÃO. Quando alguém entrou pela última vez só viaja na carga
   * da equipe, que já nasce `null` para quem não coordena — o corte é no
   * backend, não na tela.
   */
  it('só existe dentro da carga que só a gestão recebe', () => {
    expect(CARGA.startsWith('const cargaEquipe = !ehGestao')).toBe(true);
    expect(CARGA).toContain('ultimoAcesso:');
    // E o login não vaza dentro do objeto da pessoa.
    expect(CARGA).toContain('const { ultimoLoginEm, ...p } = achada;');
  });
});
