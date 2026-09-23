/**
 * QUEM RESPONDE AO ESC, E O QUE CONTA COMO "CLIQUEI FORA".
 *
 * 23/09/2026, conferido na tela com o cadastro de recadastramento aberto
 * dentro da gaveta do atendimento:
 *
 *  · **Esc** fechou o modal **e a gaveta junto** — tudo que estava digitado
 *    sumiu, e a pessoa voltou para a lista sem entender o que fez. A gaveta
 *    (`components/ui/sheet`) escuta `keydown` no `document`, então ela ouve o
 *    Esc mesmo com outra caixa por cima. E Esc é justamente a tecla que se
 *    aperta para fechar o calendário nativo de um campo de data — e este
 *    formulário tem três.
 *
 *  · **arrastar de dentro para fora** (selecionar o texto de um campo e soltar
 *    o botão fora da caixa) também fechou. O `click` do navegador nasce no
 *    ancestral comum entre onde se apertou e onde se soltou: soltando fora, o
 *    alvo vira o fundo escuro, e o fundo fecha.
 *
 * As duas regras aqui embaixo resolvem os dois, e valem para qualquer
 * sobreposição do sistema.
 */

// ---------------------------------------------------------------------------
// 1) A pilha: o Esc é sempre do TOPO
// ---------------------------------------------------------------------------

/**
 * A regra, pura: dentre as sobreposições abertas, só a última a abrir responde
 * ao Esc. Sem isso, uma tecla fecha três coisas de uma vez.
 *
 * Quem não está na pilha (uma sobreposição que ainda não se registrou) não é
 * topo de nada — é mais seguro não fechar do que fechar o que não devia.
 */
export function ehOTopoDaPilha(pilha: readonly string[], id: string): boolean {
  return pilha.length > 0 && pilha[pilha.length - 1] === id;
}

/** A pilha viva desta aba. Uma por documento, como o próprio `document`. */
const pilha: string[] = [];

export function empilharSobreposicao(id: string): void {
  if (!pilha.includes(id)) pilha.push(id);
}

export function desempilharSobreposicao(id: string): void {
  const i = pilha.indexOf(id);
  if (i >= 0) pilha.splice(i, 1);
}

export function ehOTopo(id: string): boolean {
  return ehOTopoDaPilha(pilha, id);
}

/** Só para teste: devolve a pilha ao estado de página recém-aberta. */
export function limparPilha(): void {
  pilha.length = 0;
}

// ---------------------------------------------------------------------------
// 2) O clique no fundo: tem de COMEÇAR e TERMINAR no fundo
// ---------------------------------------------------------------------------

/**
 * Quanto tempo um gesto leva para acabar. Meio segundo é muito para o intervalo
 * entre os dois toques de um clique duplo (~150 ms) e pouco demais para
 * qualquer decisão de gente — ninguém é reprovado por esta janela.
 *
 * A mesma constante governa o rodapé do formulário em passos, porque é o mesmo
 * fenômeno: um controle que nasce embaixo do dedo não pode aceitar o clique
 * que o revelou. Ver `lib/passos-do-formulario`.
 */
export const JANELA_DO_GESTO_MS = 500;

/**
 * O gesto fechou a caixa de propósito?
 *
 * Só quando o botão foi apertado no fundo E solto no fundo. Apertar dentro e
 * soltar fora é seleção de texto, não vontade de sair — e é o gesto que estava
 * jogando fora um cadastro inteiro. O mesmo vale para o caso em que a caixa
 * ENCOLHE entre os dois toques de um clique duplo: o segundo toque cai onde a
 * caixa estava, e sem esta regra ele fecha.
 */
export function oCliqueFoiNoFundo(args: {
  comecouNoFundo: boolean;
  terminouNoFundo: boolean;
  msDesdeOUltimoCliqueDentro: number;
}): boolean {
  if (!args.comecouNoFundo || !args.terminouNoFundo) return false;
  /*
    E A SOBRA DO GESTO ANTERIOR. Quando o primeiro toque de um clique duplo faz
    a caixa ENCOLHER — trocar de passo, um bloco sumir —, o segundo toque cai
    no fundo por acidente: começou e terminou nele, e mesmo assim ninguém
    pediu para sair. A régua é a mesma do rodapé em passos.
  */
  return args.msDesdeOUltimoCliqueDentro >= JANELA_DO_GESTO_MS;
}
