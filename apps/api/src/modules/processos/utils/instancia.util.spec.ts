import { escolherPrincipal, temInstanciaViva, type InstanciaParaEscolha } from './instancia.util';

/** Atalho para montar instâncias legíveis nos casos abaixo. */
function inst(
  grau: string | null,
  ultimoMovimento: string | null,
  baixada = false,
  docId = `TJPI_${grau}_0800000000000000000`,
): InstanciaParaEscolha {
  return {
    docId,
    grau,
    ultimoMovimentoEm: ultimoMovimento ? new Date(ultimoMovimento) : null,
    baixada,
  };
}

describe('escolherPrincipal', () => {
  it('devolve null para lista vazia', () => {
    expect(escolherPrincipal([])).toBeNull();
  });

  it('com uma instância só, devolve ela', () => {
    const g1 = inst('G1', '2026-01-10');
    expect(escolherPrincipal([g1])).toBe(g1);
  });

  /**
   * O CASO QUE MOTIVOU A FUNCIONALIDADE.
   *
   * 2º grau com baixa definitiva (e baixa RECENTE, mais nova que o último ato
   * do 1º grau) enquanto o cumprimento de sentença corre no 1º. Escolher pelo
   * movimento mais recente sem antes descartar as baixadas elegeria o G2 — o
   * grau que acabou — e o processo passaria a se apresentar como encerrado.
   */
  it('ignora a instância baixada mesmo quando ela é a que se moveu por último', () => {
    const g2 = inst('G2', '2026-07-30', true);
    const g1 = inst('G1', '2026-05-02', false);
    expect(escolherPrincipal([g2, g1])).toBe(g1);
  });

  it('entre instâncias vivas, escolhe a de movimento mais recente', () => {
    const g1 = inst('G1', '2025-11-05');
    const g2 = inst('G2', '2026-05-13');
    expect(escolherPrincipal([g1, g2])).toBe(g2);
  });

  /**
   * Processo acabado: o que o descreve é a instância que o ENCERROU. Um caso
   * que subiu em apelação e transitou em julgado no 2º grau se apresentando
   * como "1º grau" esconderia a decisão final.
   */
  it('com todas baixadas, escolhe a que se moveu por último', () => {
    const g2 = inst('G2', '2026-07-30', true);
    const g1 = inst('G1', '2026-01-02', true);
    expect(escolherPrincipal([g2, g1])).toBe(g2);
  });

  it('sem nenhum movimento, desempata pelo menor grau', () => {
    const g2 = inst('G2', null);
    const je = inst('JE', null);
    const g1 = inst('G1', null);
    expect(escolherPrincipal([g2, je, g1])).toBe(g1);
  });

  it('ordena os graus G1 < JE < TR < G2', () => {
    const tr = inst('TR', null);
    const g2 = inst('G2', null);
    const je = inst('JE', null);
    expect(escolherPrincipal([g2, tr, je])).toBe(je);
    expect(escolherPrincipal([g2, tr])).toBe(tr);
  });

  it('grau desconhecido ou nulo perde para qualquer grau reconhecido', () => {
    const g2 = inst('G2', null);
    const desconhecido = inst('SUP', null);
    const semGrau = inst(null, null);
    expect(escolherPrincipal([desconhecido, g2])).toBe(g2);
    expect(escolherPrincipal([semGrau, g2])).toBe(g2);
  });

  /**
   * Determinismo importa: o atalho de `Processo` é reescrito a cada
   * sincronização. Sem desempate estável, dois graus empatados fariam o
   * processo alternar de tribunal/classe a cada madrugada, sem que nada tivesse
   * mudado no CNJ.
   */
  it('desempata por docId quando grau e movimento são iguais', () => {
    const a = inst('G1', '2026-01-10', false, 'TJPI_G1_AAA');
    const b = inst('G1', '2026-01-10', false, 'TJPI_G1_BBB');
    expect(escolherPrincipal([b, a])).toBe(a);
    expect(escolherPrincipal([a, b])).toBe(a);
  });

  it('instância sem movimento perde para uma que tem', () => {
    const semMov = inst('G1', null);
    const comMov = inst('G2', '2020-01-01');
    expect(escolherPrincipal([semMov, comMov])).toBe(comMov);
  });
});

describe('temInstanciaViva', () => {
  it('é falso quando todas estão baixadas', () => {
    expect(temInstanciaViva([{ baixada: true }, { baixada: true }])).toBe(false);
  });

  /** É o que mantém o processo na varredura noturna depois da baixa no 2º grau. */
  it('é verdadeiro se qualquer instância continua sem baixa', () => {
    expect(temInstanciaViva([{ baixada: true }, { baixada: false }])).toBe(true);
  });

  it('é falso para lista vazia — sem instância não há o que monitorar', () => {
    expect(temInstanciaViva([])).toBe(false);
  });
});
