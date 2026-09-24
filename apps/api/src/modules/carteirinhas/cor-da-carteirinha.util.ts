/**
 * A CARTEIRINHA É DA CASA, NÃO DO SENATEPI — 24/09/2026.
 *
 * *"Esse é o visual para o SENATEPI e o visual dos outros TENANTS, como
 * faria?"* Hoje não havia visual dos outros: a carteirinha cravava no código o
 * verde `#1B7F0A` e as duas linhas do nome —
 *
 *     doc.text('Sindicato dos Enfermeiros, Auxiliares e', …)
 *     doc.text('Técnicos em Enfermagem do Piauí', …)
 *
 * — então a carteirinha do SINDSERM sairia **verde, com o nome do SENATEPI**.
 * Não é decisão de design pendente: é defeito, e o dado para consertar já
 * existia. `tenant.config` publica os dois desde sempre:
 *
 *   SENATEPI ... #1B7F0A · "SINDICATO DOS ENFERMEIROS, AUXILIARES E TÉCNICOS…"
 *   SINDSERM ... #0F4C81 · "SINDICATO DOS SERVIDORES PÚBLICOS MUNICIPAIS…"
 *
 * Faltava um segundo tom: o desenho usa a cor forte no texto e no painel, e uma
 * MAIS CLARA na faixa do topo e nos rótulos. Estava cravada (`#4FA11B`) ao lado
 * da escura. Em vez de pedir a cada cliente uma segunda cor que ninguém sabe
 * escolher, ela é derivada da institucional — assim um sindicato novo entra com
 * um `corInstitucional` e a carteirinha inteira acompanha.
 */

const HEX = /^#?([0-9a-f]{6})$/i;

/** `#1B7F0A` → `[27, 127, 10]`. Devolve `null` para qualquer coisa que não seja hex de 6. */
export function paraRgb(hex: string | null | undefined): [number, number, number] | null {
  const m = HEX.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const doisDigitos = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/**
 * O TOM CLARO DA MESMA COR — o que a faixa do topo e os rótulos usam.
 *
 * CLAREIA EM HSL, e não misturando branco. Misturar com branco lava a cor: o
 * verde `#1B7F0A` a 35% de branco vira `#6bac60`, um verde acinzentado que não
 * se parece com o `#4FA11B` que estava cravado. Subir a LUMINOSIDADE mantendo
 * matiz e saturação dá um tom da mesma família — que é o que "a cor clara da
 * casa" quer dizer.
 *
 * Doze pontos de luminosidade é o passo: abaixo disso a faixa do topo não se
 * distingue do painel; acima, a cor começa a desbotar.
 */
export function tomClaro(hex: string | null | undefined, pontos = 12): string | null {
  const rgb = paraRgb(hex);
  if (!rgb) return null;
  const [h, s, l] = paraHsl(rgb);
  return deHsl(h, s, Math.min(100, l + pontos));
}

/** RGB 0–255 → HSL com H em graus e S/L em 0–100. */
function paraHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === R ? ((G - B) / d + (G < B ? 6 : 0))
      : max === G ? (B - R) / d + 2
        : (R - G) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function deHsl(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const faixa = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r, g, b] = (
    [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const
  )[faixa];
  return `#${doisDigitos((r + m) * 255)}${doisDigitos((g + m) * 255)}${doisDigitos((b + m) * 255)}`;
}

/** O grafite de sempre, para quando o cliente não declarou cor nenhuma. */
export const COR_RESERVA = '#374151';

export interface CoresDaCarteirinha {
  forte: string;
  clara: string;
}

/**
 * As duas cores do cartão, a partir da cor da casa.
 *
 * Sem cor declarada, cai no grafite — nunca no verde de outro sindicato, que é
 * o defeito que este arquivo existe para não repetir.
 */
export function coresDaCarteirinha(corInstitucional: string | null | undefined): CoresDaCarteirinha {
  const forte = paraRgb(corInstitucional) ? String(corInstitucional).trim() : COR_RESERVA;
  return { forte, clara: tomClaro(forte) ?? COR_RESERVA };
}
