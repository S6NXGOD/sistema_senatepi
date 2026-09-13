import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANIMACOES,
  CURVA,
  DURACAO,
  DURACOES_TAILWIND,
  KEYFRAMES,
  atrasoEscalonado,
  deveContar,
  suavizarEntrada,
} from './movimento';

const RAIZ = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n');

/** Só o código: tira comentários de bloco, de linha e de JSX. Negativa em
    português bate em comentário, e comentário não é comportamento. */
const semComentarios = (fonte: string) =>
  fonte
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('os tokens de movimento', () => {
  it('as durações do contrato', () => {
    expect(DURACAO).toEqual({ instante: 90, rapido: 150, base: 200, painel: 280, dado: 600 });
    expect(DURACOES_TAILWIND).toEqual({
      instante: '90ms',
      rapido: '150ms',
      base: '200ms',
      painel: '280ms',
      dado: '600ms',
    });
  });

  it('as curvas', () => {
    expect(CURVA.entrada).toBe('cubic-bezier(0.2, 0, 0, 1)');
    expect(CURVA.saida).toBe('cubic-bezier(0.4, 0, 1, 1)');
  });
});

describe('atrasoEscalonado — 40 ms por bloco, teto de 6', () => {
  it.each([
    [0, '0ms'],
    [1, '40ms'],
    [2, '80ms'],
    [4, '160ms'],
    [5, '200ms'],
    [6, '200ms'],
    [30, '200ms'],
    [-3, '0ms'],
    [2.7, '80ms'],
    [Number.NaN, '0ms'],
    [Number.POSITIVE_INFINITY, '0ms'],
  ])('i=%p → %p', (i, esperado) => {
    expect(atrasoEscalonado(i)).toBe(esperado);
  });

  it('nunca passa de 200 ms, para a tela não parecer mais lenta', () => {
    for (let i = 0; i < 100; i++) expect(parseInt(atrasoEscalonado(i), 10)).toBeLessThanOrEqual(200);
  });
});

describe('deveContar — só vale a pena contar número grande', () => {
  it.each([
    [{ valor: 10, reduzir: false }, true],
    [{ valor: 7279, reduzir: false }, true],
    [{ valor: 12.5, reduzir: false }, true],
    [{ valor: 9, reduzir: false }, false],
    [{ valor: 2, reduzir: false }, false],
    [{ valor: 0, reduzir: false }, false],
    [{ valor: -50, reduzir: false }, false],
    [{ valor: Number.NaN, reduzir: false }, false],
    [{ valor: Number.POSITIVE_INFINITY, reduzir: false }, false],
    [{ valor: undefined, reduzir: false }, false],
    [{ valor: null, reduzir: false }, false],
    // Quem pediu menos movimento nunca vê contagem
    [{ valor: 7279, reduzir: true }, false],
  ])('%p → %p', (entrada, esperado) => {
    expect(deveContar(entrada)).toBe(esperado);
  });
});

describe('suavizarEntrada', () => {
  it('começa em 0, termina em 1 e nunca sai do intervalo', () => {
    expect(suavizarEntrada(0)).toBe(0);
    expect(suavizarEntrada(1)).toBe(1);
    expect(suavizarEntrada(-1)).toBe(0);
    expect(suavizarEntrada(2)).toBe(1);
  });

  it('desacelera: a primeira metade anda mais que a segunda', () => {
    expect(suavizarEntrada(0.5)).toBeGreaterThan(0.5);
  });
});

/**
 * AS CLASSES QUE AS OUTRAS TELAS USAM. Nome errado no Tailwind não dá erro:
 * a classe simplesmente não existe e nada anima (ou pior, nada aparece).
 */
describe('as classes animate-* do contrato', () => {
  const NOMES = [
    'surgir',
    'surgir-leve',
    'crescer-x',
    'crescer-y',
    'brilho',
    'overlay-entrar',
    'dialogo-entrar',
  ];

  it('cada classe tem keyframe e animação', () => {
    for (const nome of NOMES) {
      expect(Object.keys(KEYFRAMES)).toContain(nome);
      expect(ANIMACOES[nome as keyof typeof ANIMACOES].startsWith(`${nome} `)).toBe(true);
    }
  });

  it('as durações batem com o contrato', () => {
    expect(ANIMACOES.surgir).toContain('200ms');
    expect(ANIMACOES['surgir-leve']).toContain('150ms');
    expect(ANIMACOES['crescer-x']).toContain('600ms');
    expect(ANIMACOES['crescer-y']).toContain('600ms');
    expect(ANIMACOES['overlay-entrar']).toContain('150ms');
    expect(ANIMACOES['dialogo-entrar']).toContain('220ms');
  });

  /** Só transform e opacity: largura, altura, topo e sombra animados refazem o layout. */
  it('nenhum keyframe anima propriedade de layout', () => {
    const permitidas = new Set(['opacity', 'transform', 'transformOrigin']);
    for (const quadros of Object.values(KEYFRAMES)) {
      for (const quadro of Object.values(quadros)) {
        for (const prop of Object.keys(quadro)) expect(permitidas).toContain(prop);
      }
    }
  });

  /**
   * Com `both`, o último quadro fica preso — e um `transform` preso cria bloco
   * de contenção, deslocando menu e combobox `position: fixed` do cartão.
   * Só o brilho, que é infinito, fica de fora.
   */
  it('nenhuma entrada prende o último quadro', () => {
    for (const [nome, valor] of Object.entries(ANIMACOES)) {
      expect(valor).not.toMatch(/\bboth\b|\bforwards\b/);
      if (nome !== 'brilho') expect(valor).toMatch(/\bbackwards$/);
    }
  });

  it('o tailwind.config lê daqui, e não de uma cópia', () => {
    const config = ler('../tailwind.config.ts');
    expect(config).toContain("from './src/lib/movimento'");
    expect(config).toContain('...KEYFRAMES');
    expect(config).toContain('...ANIMACOES');
    expect(config).toContain('transitionDuration: DURACOES_TAILWIND');
    expect(config).toContain('transitionTimingFunction: CURVAS_TAILWIND');
  });

  /** O Tailwind carrega este arquivo fora do Next: import com alias quebraria o build. */
  it('movimento.ts não importa nada', () => {
    expect(semComentarios(ler('lib/movimento.ts'))).not.toMatch(/^\s*import\s/m);
  });
});

describe('"reduzir movimento" é global', () => {
  const CSS = ler('app/globals.css');
  const bloco = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));

  it('existe a regra, sobre todo elemento', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
    expect(bloco).toContain('animation-duration: 1ms !important;');
    expect(bloco).toContain('animation-iteration-count: 1 !important;');
    expect(bloco).toContain('transition-duration: 1ms !important;');
  });

  /** Um girador congelado parece travamento: ele só desacelera. */
  it('menos o girador, que continua girando', () => {
    const spin = bloco.slice(bloco.indexOf('.animate-spin'));
    expect(spin).toContain('animation-iteration-count: infinite !important;');
  });

  it('e o papel não se mexe', () => {
    const impressao = CSS.slice(CSS.lastIndexOf('@media print'));
    expect(impressao).toContain('animation: none !important;');
    expect(impressao).toContain('transition: none !important;');
  });

  it('o framer-motion segue a mesma preferência', () => {
    expect(ler('components/providers.tsx')).toContain('<MotionConfig reducedMotion="user">');
  });

  it('o recharts também (ele não lê a preferência sozinho)', () => {
    const grafico = ler('lib/grafico.ts');
    expect(grafico).toContain('isAnimationActive: !reduzir');
    expect(grafico).toContain('animationBegin: 0');
  });
});

describe('o que já animava, consertado', () => {
  /** O formulário saía no HTML com opacidade zero e ficava em branco até hidratar. */
  it('o login não esconde o formulário até o JavaScript chegar', () => {
    const login = semComentarios(ler('app/login/page.tsx'));
    expect(login).not.toContain('initial=');
    expect(login).not.toContain("from 'framer-motion'");
    expect(login).toContain('animate-surgir');
  });

  /** O contador voltava a zero a cada revalidação de 60 s. */
  it('o KPI conta uma vez só, pelo NumeroAnimado', () => {
    const widgets = semComentarios(ler('components/dashboard/widgets.tsx'));
    expect(widgets).not.toContain('useCountUp');
    expect(widgets).not.toContain("from 'framer-motion'");
    expect(widgets).toContain('<NumeroAnimado valor={valor} />');
  });

  it('o NumeroAnimado decide pela regra pura, e não recomeça quando o valor muda', () => {
    const numero = semComentarios(ler('components/ui/numero-animado.tsx'));
    expect(numero).toContain('deveContar({ valor: alvo, reduzir: prefereMenosMovimento() })');
    expect(numero).toContain('DURACAO.dado');
    expect(numero).toContain('className="sr-only">{final}</span>');
  });

  /** Elevar no hover promete um clique; só cartão que é clique eleva. */
  it('o Card só eleva no hover quando é interativo', () => {
    const card = semComentarios(ler('components/ui/card.tsx'));
    expect(card).toContain("interativo && 'transition-shadow duration-rapido hover:shadow-md'");
    expect(card).not.toMatch(/'rounded-xl border bg-card[^']*hover:shadow-md/);
  });

  /** A barra da votação ao vivo refazia o layout a cada 3 s. */
  it('a barra da votação anda por transform', () => {
    const pauta = semComentarios(ler('components/eventos/resultado-pauta.tsx'));
    expect(pauta).not.toContain('transition-all');
    expect(pauta).not.toContain('width: `');
    expect(pauta).toContain('scaleX(');
  });

  /** As abas de cobranças dependem da desmontagem para não buscar a aba escondida. */
  it('a aba entra com fade e continua desmontando quando inativa', () => {
    const tabs = semComentarios(ler('components/ui/tabs.tsx'));
    expect(tabs).toContain('if (ctx.value !== value) return null;');
    expect(tabs).toContain("cn('animate-surgir-leve', className)");
  });

  /**
   * SÓ ENTRADA. É o `return null` que zera o formulário ao reabrir; animar a
   * saída exigiria manter o diálogo montado.
   */
  it('o ConfirmDialog entra animado e continua saindo do DOM', () => {
    const dialogo = semComentarios(ler('components/ui/confirm-dialog.tsx'));
    expect(dialogo).toContain('if (!open) return null;');
    expect(dialogo).toContain('animate-overlay-entrar');
    expect(dialogo).toContain('animate-dialogo-entrar');
  });

  it('o Sheet usa os tokens, e não mais 300 ms cravados', () => {
    const sheet = semComentarios(ler('components/ui/sheet.tsx'));
    expect(sheet).not.toContain('duration-300');
    expect(sheet).toContain('duration-painel ease-entrada');
  });
});

describe('o esqueleto', () => {
  const ESQ = semComentarios(ler('components/ui/esqueleto.tsx'));

  it('exporta as formas do contrato', () => {
    for (const nome of ['Esqueleto', 'EsqueletoCartoes', 'EsqueletoLinhas', 'EsqueletoGrafico', 'Carregando']) {
      expect(ESQ).toContain(`export function ${nome}(`);
    }
  });

  it('anuncia a espera para o leitor de tela', () => {
    expect(ESQ).toContain('role="status"');
    expect(ESQ).toContain('aria-busy="true"');
  });

  /** Sem cor da marca: igual em qualquer sindicato e no escuro. */
  it('não usa a cor da marca', () => {
    expect(ESQ).not.toMatch(/brand-/);
  });

  /** O cartão de número tem 104 px: a grade não se mexe quando o valor chega. */
  it('o cartão de mentira tem a altura do KpiCard', () => {
    expect(ESQ).toContain('h-[104px]');
  });
});
