import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { tituloDoSeguimento } from './desfechos.catalogo';

/**
 * TRÊS CARTÕES "ENCAMINHAMENTO DA REUNIÃO" NA MESMA AGENDA.
 *
 * Produção, 31/08/2026. Dois deles no mesmo dia e horário, indistinguíveis na
 * face do cartão — a reunião de origem só aparecia dentro da descrição.
 */
describe('título do seguimento', () => {
  it('leva a origem à frente do rótulo genérico', () => {
    expect(tituloDoSeguimento('Encaminhamento da reunião', 'REUNIÃO COM DRH e GPAP'))
      .toBe('REUNIÃO COM DRH e GPAP — Encaminhamento da reunião');
  });

  /**
   * A ORIGEM VEM PRIMEIRO porque o título é cortado pela DIREITA na lista. O
   * sufixo genérico é o pedaço que pode sumir sem prejuízo — é o mesmo critério
   * já usado na identidade do processo, onde o polo ativo encolhe e o réu não.
   */
  it('o pedaço que sobrevive ao corte é o que distingue os cartões', () => {
    const a = tituloDoSeguimento('Encaminhamento da reunião', 'REUNIÃO COM DRH e GPAP');
    const b = tituloDoSeguimento('Encaminhamento da reunião', 'REUNIÃO COM A SEMDUH');
    expect(a.slice(0, 24)).not.toBe(b.slice(0, 24));
  });

  it('sem origem, devolve o rótulo do catálogo intacto', () => {
    expect(tituloDoSeguimento('Nova cobrança', null)).toBe('Nova cobrança');
    expect(tituloDoSeguimento('Nova cobrança', '   ')).toBe('Nova cobrança');
  });

  /** Repetir a ação já contida na origem só gastaria espaço da tela. */
  it('não repete quando a origem já contém o rótulo', () => {
    expect(tituloDoSeguimento('Nova cobrança', 'Nova cobrança de honorários'))
      .toBe('Nova cobrança de honorários');
  });

  it('origem quilométrica é encurtada, não deixada solta', () => {
    const longa = 'REUNIÃO EXTRAORDINÁRIA COM A DIRETORIA DE RECURSOS HUMANOS DA FUNDAÇÃO';
    const t = tituloDoSeguimento('Encaminhamento da reunião', longa);
    expect(t).toContain('…');
    expect(t.length).toBeLessThan(longa.length + 30);
    expect(t.endsWith('— Encaminhamento da reunião')).toBe(true);
  });

  it('o título digitado à mão continua vencendo', () => {
    const svc = readFileSync(path.join(__dirname, 'agenda.service.ts'), 'utf8');
    expect(svc).toContain("dto.seguimento?.titulo?.trim() || tituloDoSeguimento(spec!.titulo, atual.titulo)");
  });
});
