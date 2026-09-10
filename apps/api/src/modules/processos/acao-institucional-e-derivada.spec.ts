import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PARTES = readFileSync(join(__dirname, 'partes.service.ts'), 'utf8');
const PROCESSOS = readFileSync(join(__dirname, 'processos.service.ts'), 'utf8');
const TELA = readFileSync(
  join(__dirname, '../../../../web/src/app/(dashboard)/processos/page.tsx'),
  'utf8',
);

/**
 * "COLOQUEI O SENATEPI COMO POLO ATIVO E NÃO MOSTRA COMO AÇÃO INSTITUCIONAL."
 *
 * Estava certo, e a causa é a de sempre nesta base: a regra existia e rodava em
 * UM caminho só.
 *
 * `processos.service.ts` deriva no `create`:
 *
 *   tipoAcao: polo.institucional ? INSTITUCIONAL : INDIVIDUAL
 *
 * Adicionar, trocar ou remover a parte institucional DEPOIS não recalculava
 * nada — o campo ficava com o valor do dia do cadastro. E é ele que decide o
 * selo da listagem e o filtro "ação institucional".
 *
 * Medido na produção em 10/09/2026: 1 processo em 134
 * (0000736-77.2016.8.18.0067, SENATEPI × Município de Piracuruca) com a parte
 * institucional no polo ATIVO, sem filiado, marcado INDIVIDUAL. Corrigido no
 * banco depois desta mudança; a varredura fecha em zero divergências.
 *
 * `filiadoId` e `advogadoId` já tinham sido trazidos para `sincronizarAtalhos`
 * exatamente por isso. `tipoAcao` era o terceiro derivado, e faltava.
 */
describe('tipoAcao é derivado das partes, não só na criação', () => {
  it('a sincronização dos atalhos recalcula o tipo da ação', () => {
    const i = PARTES.indexOf('async sincronizarAtalhos(');
    expect(i).toBeGreaterThan(-1);
    const bloco = PARTES.slice(i, PARTES.indexOf('\n  }', i));
    expect(bloco).toContain('parteExterna: { institucional: true }');
    expect(bloco).toContain('tipoAcao: temInstitucional');
    expect(bloco).toContain('TipoAcaoProcesso.INSTITUCIONAL');
    expect(bloco).toContain('TipoAcaoProcesso.INDIVIDUAL');
  });

  /** Os três derivados moram na mesma casa — é o que impede um deles envelhecer. */
  it('os três derivados são recalculados juntos', () => {
    const i = PARTES.indexOf('async sincronizarAtalhos(');
    const bloco = PARTES.slice(i, PARTES.indexOf('\n  }', i));
    for (const campo of ['filiadoId:', 'advogadoId:', 'tipoAcao:']) {
      expect(bloco).toContain(campo);
    }
  });

  /** A criação continua derivando — as duas portas dizem a mesma coisa. */
  it('a criação segue derivando do polo', () => {
    expect(PROCESSOS).toContain('tipoAcao: polo.institucional');
  });

  /**
   * INSTITUCIONAL É SER PARTE, EM QUALQUER POLO.
   *
   * O sindicato tanto move ação pela categoria quanto é processado por ela; nos
   * dois casos não há filiado dono, que é o que a distinção significa. A tela
   * já sabe separar os dois lados no selo ("SENATEPI é réu" × "Ação
   * institucional"), então a derivação não precisa — nem deve — olhar o polo.
   */
  it('a derivação não filtra por polo, e a tela é quem distingue os lados', () => {
    const i = PARTES.indexOf('const temInstitucional');
    const bloco = PARTES.slice(i, i + 260);
    expect(bloco).not.toContain('polo:');

    expect(TELA).toContain('const institucional = p.tipoAcao === ');
    expect(TELA).toContain('é réu');
  });
});
