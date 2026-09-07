import { separarTimbre } from './timbre-do-tribunal';

/**
 * Os textos abaixo são publicações reais da produção, encurtadas no meio.
 *
 * Validado contra as 1.420 do acervo em 07/09/2026: 1.185 (83%) tiveram timbre
 * removido, média de 302 caracteres — de ~600 que o cartão mostra antes do
 * "Ler tudo". ZERO casos em que o corpo ficou com menos de 40 caracteres, que é
 * o sinal de que o corte teria engolido o ato.
 */
const COM_TIMBRE =
  'PODER JUDICIÁRIO JUSTIÇA DO TRABALHO TRIBUNAL REGIONAL DO TRABALHO DA 22ª REGIÃO ' +
  'VARA DO TRABALHO DE PARNAÍBA ATSum 0002664-81.2025.5.22.0101 ' +
  'AUTOR: SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI ' +
  'RÉU: INSTITUTO SAUDE E CIDADANIA - ISAC ' +
  'INTIMAÇÃO Fica V. Sa. intimado para tomar ciência da Decisão ID 84dfcc7 proferida nos autos.';

describe('o timbre do tribunal na frente da notícia', () => {
  it('corta no marco do documento e devolve as duas metades', () => {
    const { timbre, corpo } = separarTimbre(COM_TIMBRE);
    expect(corpo).toMatch(/^INTIMAÇÃO Fica V\. Sa\./);
    expect(timbre).toContain('TRIBUNAL REGIONAL DO TRABALHO');
    // Nada se perde: as duas metades reconstroem o documento.
    expect(`${timbre} ${corpo}`.replace(/\s+/g, ' ')).toBe(COM_TIMBRE.replace(/\s+/g, ' '));
  });

  it('poupa mais da metade do que o cartão mostra', () => {
    const { timbre } = separarTimbre(COM_TIMBRE);
    expect(timbre.length).toBeGreaterThan(250);
  });

  /**
   * TRAVA 1. Sem ela, um acórdão que cite "DECISÃO" na ementa perderia a
   * ementa — e o texto não tinha timbre nenhum para remover.
   */
  it('não mexe em texto que não começa com timbre', () => {
    const solto = 'Vistos etc. A DECISÃO recorrida merece reforma pelos fundamentos a seguir.';
    expect(separarTimbre(solto)).toEqual({ timbre: '', corpo: solto });
  });

  /**
   * TRAVA 2. Um marco que só aparece no caractere 1.200 é citação dentro do
   * documento, não o título dele.
   */
  it('não corta marco que aparece tarde demais', () => {
    const longo = 'PODER JUDICIÁRIO ' + 'x'.repeat(1000) + ' SENTENÇA de mérito.';
    expect(separarTimbre(longo).timbre).toBe('');
  });

  /** Corta no PRIMEIRO marco: "DESPACHO" antes de "DECISÃO" manda. */
  it('corta no primeiro marco, não no mais forte', () => {
    const t = 'PODER JUDICIÁRIO TRT22 Vara X DESPACHO: intime-se. Da DECISÃO cabe recurso.';
    expect(separarTimbre(t).corpo).toMatch(/^DESPACHO/);
  });

  /** Texto que já começa no marco não tem timbre a tirar. */
  it('não come o próprio marco quando o texto começa nele', () => {
    const t = 'INTIMAÇÃO Fica V. Sa. intimado.';
    expect(separarTimbre(t)).toEqual({ timbre: '', corpo: t });
  });

  it('aguenta texto vazio', () => {
    expect(separarTimbre('')).toEqual({ timbre: '', corpo: '' });
  });
});
