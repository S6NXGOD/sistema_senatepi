/**
 * AS INICIAIS E A COR DE UMA PESSOA — a mesma na tela e no papel.
 *
 * Moravam dentro de `avatar-pessoa.tsx`. O PDF do uso passou a desenhar o
 * cartão da pessoa com iniciais quando não há foto, e uma segunda cópia da
 * regra daria à MESMA pessoa uma cor na tela e outra no papel. Por isso a regra
 * é uma função pura aqui, lida pelos dois.
 *
 * Sem `@/tenant.config` e sem React: quem chama passa a paleta da instalação.
 */

export type Rgb = [number, number, number];

/**
 * DUAS LETRAS, e o tratamento é descartado. Com uma letra só, "Dra. Morgana" e
 * "Dr. Matheus" viravam ambos um "D": o avatar deixava de distinguir
 * exatamente onde precisava.
 */
export function iniciaisDe(nome: string): string {
  return nome
    .trim()
    .replace(/^(dra?\.?|sr[a]?\.?)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
}

/**
 * Os sete tons, em ordem fixa: a classe da tela e o RGB do papel lado a lado.
 * O primeiro é a cor da casa (200 de fundo, 900 de texto), lida da paleta;
 * os outros são os valores do Tailwind 3 (tom 200 e tom 900).
 */
const TONS_FIXOS: { classe: string; fundo: Rgb; texto: Rgb }[] = [
  { classe: 'bg-sky-200 text-sky-900', fundo: [186, 230, 253], texto: [12, 74, 110] },
  { classe: 'bg-violet-200 text-violet-900', fundo: [221, 214, 254], texto: [76, 29, 149] },
  { classe: 'bg-amber-200 text-amber-900', fundo: [253, 230, 138], texto: [120, 53, 15] },
  { classe: 'bg-emerald-200 text-emerald-900', fundo: [167, 243, 208], texto: [6, 78, 59] },
  { classe: 'bg-rose-200 text-rose-900', fundo: [254, 205, 211], texto: [136, 19, 55] },
  { classe: 'bg-teal-200 text-teal-900', fundo: [153, 246, 228], texto: [19, 78, 74] },
];

export const QUANTIDADE_DE_TONS = TONS_FIXOS.length + 1;

/** Índice estável: a mesma pessoa recebe sempre o mesmo tom, em toda tela e em todo PDF. */
export function indiceDaCor(nome: string): number {
  let soma = 0;
  for (let i = 0; i < nome.length; i++) soma = (soma + nome.charCodeAt(i)) % 9973;
  return soma % QUANTIDADE_DE_TONS;
}

/** "#1B7F0A" vira [27, 127, 10]; qualquer outra coisa vira null — nunca NaN. */
export function hexParaRgb(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const valor = parseInt(m[1], 16);
  return [(valor >> 16) & 255, (valor >> 8) & 255, valor & 255];
}

export interface CorDasIniciais {
  /** As classes do Tailwind para a tela. */
  classe: string;
  /** O mesmo tom, em RGB, para o PDF. */
  fundo: Rgb;
  texto: Rgb;
}

/** O tom da pessoa, com a paleta da instalação para o primeiro deles. */
export function corDasIniciais(nome: string, paleta: Record<string, string>): CorDasIniciais {
  const i = indiceDaCor(nome);
  if (i > 0) return TONS_FIXOS[i - 1];
  return {
    classe: 'bg-brand-200 text-brand-900',
    fundo: hexParaRgb(paleta['200']) ?? [208, 226, 158],
    texto: hexParaRgb(paleta['900']) ?? [20, 94, 7],
  };
}
