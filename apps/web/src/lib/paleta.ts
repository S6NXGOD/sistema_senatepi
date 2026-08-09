/**
 * DEZ TONS A PARTIR DE UMA COR.
 *
 * POR QUE DERIVAR, E NÃO PEDIR OS DEZ. Entregar dez campos de cor a alguém
 * garante, mais cedo ou mais tarde, uma tela ilegível: o tom 700 é o fundo dos
 * botões primários e das abas, com texto branco por cima, e basta escolhê-lo
 * claro demais para o texto sumir. Isso já aconteceu neste sistema — havia
 * degraus faltando na paleta e `bg-brand-700 text-white` virava branco no
 * branco.
 *
 * Aqui a pessoa escolhe UMA cor, a institucional, e a escala inteira sai daqui
 * com contraste conferido.
 *
 * O MÉTODO: a cor vira HSL; a matiz é preservada (é ela que identifica a
 * marca), a saturação é suavizada nas pontas — cinza-claro quase saturado fica
 * berrante, e escuro saturado demais fica sujo — e a luminosidade segue uma
 * curva fixa, do quase-branco ao quase-preto. Depois os tons escuros são
 * escurecidos até passarem em contraste AA (4,5:1) com texto branco.
 */

export type Paleta = Record<string, string>;

/** Os degraus, do mais claro ao mais escuro, com a luminosidade alvo de cada um. */
const DEGRAUS: Array<{ tom: number; luz: number; satFator: number }> = [
  { tom: 50, luz: 0.965, satFator: 0.55 },
  { tom: 100, luz: 0.925, satFator: 0.65 },
  { tom: 200, luz: 0.85, satFator: 0.75 },
  { tom: 300, luz: 0.75, satFator: 0.85 },
  { tom: 400, luz: 0.64, satFator: 0.95 },
  { tom: 500, luz: 0.54, satFator: 1.0 },
  { tom: 600, luz: 0.45, satFator: 1.0 },
  { tom: 700, luz: 0.38, satFator: 1.0 },
  { tom: 800, luz: 0.31, satFator: 1.0 },
  { tom: 900, luz: 0.24, satFator: 0.95 },
];

/**
 * Tons que recebem texto BRANCO por cima e por isso precisam passar em
 * contraste AA. São os fundos sólidos: botão primário, aba ativa, cabeçalho.
 */
export const TONS_COM_TEXTO_BRANCO = [600, 700, 800, 900];

/** Razão mínima de contraste da WCAG para texto normal. */
export const CONTRASTE_AA = 4.5;

// ---------------------------------------------------------------------------
// Conversões
// ---------------------------------------------------------------------------

/** Aceita `#RGB`, `#RRGGBB` e sem `#`. Devolve `null` se não for cor. */
export function hexParaRgb(hex: string): [number, number, number] | null {
  const limpo = hex.trim().replace(/^#/, '');
  const completo =
    limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  if (!/^[0-9a-fA-F]{6}$/.test(completo)) return null;
  return [
    parseInt(completo.slice(0, 2), 16),
    parseInt(completo.slice(2, 4), 16),
    parseInt(completo.slice(4, 6), 16),
  ];
}

export function rgbParaHex(r: number, g: number, b: number): string {
  const oito = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${oito(r)}${oito(g)}${oito(b)}`.toUpperCase();
}

function rgbParaHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

function hslParaRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = l * 255;
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255];
}

// ---------------------------------------------------------------------------
// Contraste (WCAG 2.1)
// ---------------------------------------------------------------------------

function luminancia(r: number, g: number, b: number): number {
  const ajusta = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ajusta(r) + 0.7152 * ajusta(g) + 0.0722 * ajusta(b);
}

/** Razão de contraste entre duas cores. 1 = idênticas, 21 = preto no branco. */
export function contraste(hexA: string, hexB: string): number {
  const a = hexParaRgb(hexA);
  const b = hexParaRgb(hexB);
  if (!a || !b) return 1;
  const la = luminancia(...a);
  const lb = luminancia(...b);
  const [claro, escuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

/** O texto branco fica legível sobre esta cor? */
export function legivelComBranco(hex: string): boolean {
  return contraste(hex, '#FFFFFF') >= CONTRASTE_AA;
}

// ---------------------------------------------------------------------------
// A derivação
// ---------------------------------------------------------------------------

/**
 * Gera a escala de 50 a 900 a partir da cor institucional.
 *
 * Devolve `null` quando o texto não é uma cor — quem chama decide o que fazer
 * (a tela mostra o aviso; o back recusa o valor).
 */
export function derivarPaleta(corBase: string): Paleta | null {
  const rgb = hexParaRgb(corBase);
  if (!rgb) return null;

  const [h, s] = rgbParaHsl(...rgb);
  const paleta: Paleta = {};

  for (const { tom, luz, satFator } of DEGRAUS) {
    let luzAtual = luz;
    let hex = rgbParaHex(...hslParaRgb(h, s * satFator, luzAtual));

    /**
     * Os tons escuros escurecem até o texto branco passar em AA.
     *
     * É por isso que a escolha de UMA cor é segura: uma cor institucional
     * clara (amarelo, lima) geraria um botão primário ilegível, e aqui ela é
     * puxada para baixo até parar de ser um problema — sem que a pessoa
     * precise saber o que é razão de contraste.
     */
    if (TONS_COM_TEXTO_BRANCO.includes(tom)) {
      let voltas = 0;
      while (!legivelComBranco(hex) && luzAtual > 0.05 && voltas < 40) {
        luzAtual -= 0.02;
        hex = rgbParaHex(...hslParaRgb(h, s * satFator, luzAtual));
        voltas += 1;
      }
    }

    paleta[String(tom)] = hex;
  }

  return paleta;
}

/**
 * A cor no formato HSL que o shadcn espera (`hsl(var(--primary))`).
 *
 * O `--primary` do `globals.css` estava escrito à mão como `105 85% 27%` — o
 * verde do SENATEPI em HSL, cravado. Derivar daqui tira mais essa amarra.
 */
export function hexParaHslCss(hex: string): string | null {
  const rgb = hexParaRgb(hex);
  if (!rgb) return null;
  const [h, s, l] = rgbParaHsl(...rgb);
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * A escala no formato que o CSS espera: canais separados por espaço.
 *
 * `--brand-800: 27 127 10` e não `#1B7F0A` — é o que permite ao Tailwind
 * compor opacidade (`bg-brand-800/30` vira `rgb(var(--brand-800) / 0.3)`).
 * Com o hexadecimal dentro da variável, toda classe com barra quebraria, e
 * elas existem no código.
 */
export function paletaParaCanaisCss(paleta: Paleta): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [tom, hex] of Object.entries(paleta)) {
    const rgb = hexParaRgb(hex);
    if (rgb) saida[`--brand-${tom}`] = rgb.join(' ');
  }
  return saida;
}
