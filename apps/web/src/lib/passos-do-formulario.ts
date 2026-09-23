/**
 * O CLIQUE QUE TE TRAZ AO PASSO NÃO PODE SER O CLIQUE QUE O CONCLUI.
 *
 * 23/09/2026: *"Na hora de recadastrar, antes de eu concluir e colocar os
 * dependentes, o cadastro já tá fechando sozinho."*
 *
 * Medido na produção: os **4 recadastramentos existentes chegaram com
 * `dependentes: []`**, e dois deles são a MESMA ficha com 18 segundos de
 * diferença — enviou, ele tentou de novo, enviou outra vez.
 *
 * A causa é uma armadilha de formulário em etapas. No rodapé há UM botão só:
 *
 *     passo 1, 2, 3 ......... "Continuar"                  (type="button")
 *     passo 4 (Dependentes) . "Concluir recadastramento"   (type="submit")
 *
 * Como os dois saem do mesmo ponto do JSX e são o mesmo componente, o React
 * **reaproveita o mesmo elemento do DOM** e só troca o `type`. Ou seja: o
 * clique que leva do passo 3 para o 4 deixa, embaixo do dedo e AINDA COM O
 * FOCO, um botão que agora ENVIA o cadastro. Daí o resto é natural:
 *
 *  · o segundo toque de um clique duplo cai no "Concluir";
 *  · um Enter depois do clique também — o foco não saiu do botão.
 *
 * Nos dois casos o cadastro é gravado com a lista de dependentes VAZIA, que é
 * justamente o passo que a pessoa nem chegou a ver. E como o modal fecha ao
 * salvar, na tela isso parece "fechou sozinho".
 *
 * A régua abaixo é a trava: uma ação de passo só conta depois que a pessoa
 * teve tempo de VER o passo em que está. Não é frescura de milissegundo — é a
 * mesma ideia de não deixar um diálogo aceitar o clique que o abriu.
 */

import { JANELA_DO_GESTO_MS } from './sobreposicoes';

/**
 * Quanto tempo um passo precisa estar na tela para que um clique no botão do
 * rodapé conte como decisão.
 *
 * É a MESMA janela do clique no fundo da caixa (`lib/sobreposicoes`), e de
 * propósito: os dois defeitos são o mesmo fenômeno — um controle que nasce
 * embaixo do dedo aceitando o clique que o revelou. Uma constante só para não
 * haver duas réguas para a mesma coisa.
 */
export const JANELA_DO_CLIQUE_HERDADO_MS = JANELA_DO_GESTO_MS;

/**
 * O clique no botão do rodapé foi decisão de quem está usando, ou é a sobra do
 * clique anterior?
 *
 * Fora do modo em passos não há o que herdar: o botão nunca troca de papel, e
 * a resposta é sempre sim.
 */
export function oCliqueEDoPassoAtual(args: {
  emPassos: boolean;
  msNoPasso: number;
}): boolean {
  if (!args.emPassos) return true;
  return args.msNoPasso >= JANELA_DO_CLIQUE_HERDADO_MS;
}
