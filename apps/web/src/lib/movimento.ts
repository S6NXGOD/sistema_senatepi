/**
 * MOVIMENTO — a fonte única de duração, curva e distância do sistema.
 *
 * Este arquivo é lido por DOIS mundos: pelas telas (funções puras abaixo) e
 * pelo `tailwind.config.ts`, que monta as classes `animate-*` a partir de
 * `KEYFRAMES` e `ANIMACOES`. Por isso ele não importa NADA — nem React, nem
 * alias `@/` — já que o Tailwind o carrega fora do Next.
 *
 * AS REGRAS (valem para qualquer tela que animar algo):
 *   - nada reanima por revalidação: toda entrada é animação CSS de INSERÇÃO,
 *     que só roda quando o elemento entra no DOM;
 *   - lista e tabela não escalonam linha;
 *   - aviso nunca pulsa, treme ou quica (aviso é estado, não evento);
 *   - nada animado por PESSOA (número contando ou barra crescendo por pessoa é
 *     pódio desenhado);
 *   - só `transform` e `opacity` — nunca largura, altura, topo ou sombra;
 *   - `prefers-reduced-motion` é global (globals.css) e vale para tudo.
 *
 * Proibido: mola, bounce, rotação, blur.
 */

/** Durações em milissegundos. */
export const DURACAO = {
  /** Pressionar um botão. */
  instante: 90,
  /** Hover, saída, troca de aba. */
  rapido: 150,
  /** Entrada de bloco e de diálogo. */
  base: 200,
  /** Gaveta e bottom sheet. */
  painel: 280,
  /** Número e barra — só na primeira montagem. */
  dado: 600,
} as const;

/** Curvas. Entrada desacelera (chega macio); saída acelera (sai sem arrastar). */
export const CURVA = {
  entrada: 'cubic-bezier(0.2, 0, 0, 1)',
  saida: 'cubic-bezier(0.4, 0, 1, 1)',
  padrao: 'cubic-bezier(0.2, 0, 0.2, 1)',
} as const;

/** Deslocamento de um bloco que surge (px). */
export const DESLOCAMENTO_PX = 6;
/** Deslocamento de um diálogo que entra (px). */
export const DESLOCAMENTO_DIALOGO_PX = 12;
/** Intervalo entre dois blocos de uma mesma grade (ms). */
export const PASSO_ESCALONAMENTO_MS = 40;
/** Quantos blocos, no máximo, recebem atraso próprio. Do 6º em diante, todos
    entram juntos com o último atraso — o total nunca passa de 200 ms. */
export const TETO_ESCALONAMENTO = 6;

/** Menor valor que vale a pena contar. Contar de 0 a 2 é teatro. */
export const MINIMO_PARA_CONTAR = 10;

/**
 * Atraso da entrada do i-ésimo bloco de uma GRADE (KPIs, cartões de gráfico).
 * Nunca de linha de lista. 40 ms por item, com teto: i=0 → '0ms', i≥5 → '200ms'.
 */
export function atrasoEscalonado(i: number): string {
  const indice = Number.isFinite(i) ? Math.floor(i) : 0;
  const limitado = Math.min(Math.max(indice, 0), TETO_ESCALONAMENTO - 1);
  return `${limitado * PASSO_ESCALONAMENTO_MS}ms`;
}

/**
 * O número deve contar de 0 até o valor?
 * Só com valor finito ≥ 10 e só se a pessoa não pediu menos movimento.
 */
export function deveContar({ valor, reduzir }: { valor: number | null | undefined; reduzir: boolean }): boolean {
  if (reduzir) return false;
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return false;
  return valor >= MINIMO_PARA_CONTAR;
}

/**
 * Curva de entrada para quem anima em JavaScript (o número que conta).
 * Cúbica de saída: rápida no começo, macia no fim — o número chega devagar ao
 * valor final, que é o que a pessoa vai ler.
 */
export function suavizarEntrada(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - x, 3);
}

const ms = (n: number) => `${n}ms`;

/**
 * Keyframes expostos ao Tailwind. `transform-origin` vai dentro do keyframe
 * para que `animate-crescer-x` sozinha já cresça a partir da esquerda.
 */
export const KEYFRAMES = {
  surgir: {
    from: { opacity: '0', transform: `translateY(${DESLOCAMENTO_PX}px)` },
    to: { opacity: '1', transform: 'translateY(0)' },
  },
  'surgir-leve': {
    from: { opacity: '0' },
    to: { opacity: '1' },
  },
  'crescer-x': {
    from: { transform: 'scaleX(0)', transformOrigin: 'left' },
    to: { transform: 'scaleX(1)', transformOrigin: 'left' },
  },
  'crescer-y': {
    from: { transform: 'scaleY(0)', transformOrigin: 'bottom' },
    to: { transform: 'scaleY(1)', transformOrigin: 'bottom' },
  },
  brilho: {
    from: { transform: 'translateX(-100%)' },
    to: { transform: 'translateX(100%)' },
  },
  'overlay-entrar': {
    from: { opacity: '0' },
    to: { opacity: '1' },
  },
  'dialogo-entrar': {
    from: { opacity: '0', transform: `translateY(${DESLOCAMENTO_DIALOGO_PX}px)` },
    to: { opacity: '1', transform: 'translateY(0)' },
  },
} as const;

/**
 * Classes `animate-*`.
 *
 * POR QUE `backwards` E NÃO `both`: `backwards` aplica o primeiro quadro
 * durante o atraso (o bloco escalonado não aparece antes da hora) e, ao
 * terminar, DEVOLVE o elemento ao estilo dele. Com `both` o último quadro
 * ficaria preso — e um `transform` preso cria bloco de contenção, que
 * desloca menu e combobox `position: fixed` abertos dentro do cartão.
 */
export const ANIMACOES = {
  surgir: `surgir ${ms(DURACAO.base)} ${CURVA.entrada} backwards`,
  'surgir-leve': `surgir-leve ${ms(DURACAO.rapido)} ease-out backwards`,
  'crescer-x': `crescer-x ${ms(DURACAO.dado)} ${CURVA.entrada} backwards`,
  'crescer-y': `crescer-y ${ms(DURACAO.dado)} ${CURVA.entrada} backwards`,
  brilho: 'brilho 1.6s ease-in-out infinite',
  'overlay-entrar': `overlay-entrar ${ms(DURACAO.rapido)} ease-out backwards`,
  'dialogo-entrar': `dialogo-entrar 220ms ${CURVA.entrada} backwards`,
} as const;

/** `duration-instante`, `duration-rapido`… para transições. */
export const DURACOES_TAILWIND = Object.fromEntries(
  Object.entries(DURACAO).map(([nome, valor]) => [nome, ms(valor)]),
) as Record<keyof typeof DURACAO, string>;

/** `ease-entrada`, `ease-saida`, `ease-padrao`. */
export const CURVAS_TAILWIND = { ...CURVA };
