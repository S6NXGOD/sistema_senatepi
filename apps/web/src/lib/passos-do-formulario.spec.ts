import { JANELA_DO_CLIQUE_HERDADO_MS, oCliqueEDoPassoAtual } from './passos-do-formulario';

/**
 * *"Na hora de recadastrar, antes de eu concluir e colocar os dependentes, o
 * cadastro já tá fechando sozinho."* — 23/09/2026.
 *
 * O rastro na produção: os **4 recadastramentos existentes chegaram com
 * `dependentes: []`**, e dois são a MESMA ficha com 18 segundos de diferença.
 * A causa está no cabeçalho de `passos-do-formulario.ts`: o botão do rodapé
 * troca de "Continuar" para "Concluir recadastramento" **no mesmo elemento do
 * DOM**, embaixo do dedo e com o foco.
 */

const CLIQUE_DUPLO_MS = 150; // o intervalo típico entre os dois toques

describe('o clique herdado do passo anterior', () => {
  it('o segundo toque do clique duplo NÃO conclui o cadastro', () => {
    expect(oCliqueEDoPassoAtual({ emPassos: true, msNoPasso: CLIQUE_DUPLO_MS })).toBe(false);
  });

  it('o Enter logo depois do clique também não', () => {
    expect(oCliqueEDoPassoAtual({ emPassos: true, msNoPasso: 40 })).toBe(false);
  });

  /**
   * E o contrário importa tanto quanto: a trava não pode virar um botão que
   * "às vezes não funciona". Quem leu o passo e decidiu sempre passa.
   */
  it('quem parou para ler o passo conclui normalmente', () => {
    expect(oCliqueEDoPassoAtual({ emPassos: true, msNoPasso: 3_000 })).toBe(true);
  });

  it('na borda da janela já vale', () => {
    expect(oCliqueEDoPassoAtual({ emPassos: true, msNoPasso: JANELA_DO_CLIQUE_HERDADO_MS })).toBe(true);
  });

  /**
   * FORA DO MODAL NÃO HÁ O QUE HERDAR. Em `/filiados/novo`, `/editar` e
   * `/recadastrar` o formulário é inteiro e o botão "Salvar" nunca troca de
   * papel — travar ali seria inventar um defeito que não existe.
   */
  it('fora do modo em passos, o clique sempre vale', () => {
    expect(oCliqueEDoPassoAtual({ emPassos: false, msNoPasso: 0 })).toBe(true);
  });

  /**
   * A JANELA TEM DE CABER ENTRE OS DOIS: maior que um clique duplo e bem menor
   * que uma decisão. Se alguém mexer nesta constante, este teste explica o
   * intervalo em que ela pode viver.
   */
  it('a janela é maior que um clique duplo e curta o bastante para não atrapalhar', () => {
    expect(JANELA_DO_CLIQUE_HERDADO_MS).toBeGreaterThan(CLIQUE_DUPLO_MS * 2);
    expect(JANELA_DO_CLIQUE_HERDADO_MS).toBeLessThanOrEqual(800);
  });
});
