/**
 * O VALOR POR EXTENSO — o que separa um recibo de um comprovante bonito.
 *
 * Recibo sem o valor escrito por extenso é contestável: o algarismo se altera
 * com uma caneta, a frase não. É praxe de toda contabilidade brasileira e é o
 * primeiro item que um conselho fiscal cobra.
 *
 * NÃO USA `Intl.NumberFormat`: ele não escreve por extenso em pt-BR. E não usa
 * biblioteca: são 60 linhas, a regra é fechada (não muda), e uma dependência
 * nova para isso é dependência a manter para sempre.
 *
 * A REGRA DOS CENTAVOS É SEPARADA. "R$ 1,01" é "um real e um centavo", não "um
 * vírgula zero um" — e o plural do centavo não acompanha o do real: 2,01 é
 * "dois reais e um centavo".
 */

const UNIDADES = [
  '', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove',
];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
/** "cento" só quando há resto: 100 é "cem", 101 é "cento e um". */
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0–999 por extenso. Vazio para zero — quem chama decide se diz "zero". */
function ate999(n: number): string {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

/**
 * As escalas que um sindicato alcança. Acima de bilhão não existe recibo —
 * e inventar trilhão aqui seria código que ninguém jamais executa.
 */
const ESCALAS: { valor: number; um: string; muitos: string }[] = [
  { valor: 1_000_000_000, um: 'bilhão', muitos: 'bilhões' },
  { valor: 1_000_000, um: 'milhão', muitos: 'milhões' },
  { valor: 1_000, um: 'mil', muitos: 'mil' },
];

/**
 * O inteiro por extenso, sem a moeda — e a regra do "e", que é onde se erra.
 *
 * A NORMA: os grupos separam-se por vírgula, menos o ÚLTIMO, que entra com
 * "e" quando vale menos de cem ou é centena redonda. E o que decide é o
 * MULTIPLICADOR do grupo, não o valor dele:
 *
 *   2.500.000 → "dois milhões E quinhentos mil"   (multiplicador 500, redondo)
 *   1.234.000 → "um milhão, duzentos e trinta e quatro mil"  (234 não é)
 *   1.200     → "mil E duzentos"
 *   1.050     → "mil E cinquenta"
 *
 * A EXCEÇÃO DO "MIL" SOZINHO é como gente escreve: "mil duzentos e trinta e
 * quatro", com espaço, e não "mil, duzentos e trinta e quatro". Uma palavra só
 * antes da vírgula fica estranha no papel, e recibo é papel.
 *
 * Devolve também se o número termina em escala REDONDA de milhão/bilhão, que é
 * o que obriga o "de" antes da moeda ("um milhão DE reais").
 */
function inteiroPorExtenso(n: number): { texto: string; pedeDe: boolean } {
  if (n === 0) return { texto: 'zero', pedeDe: false };

  const partes: { texto: string; chave: number }[] = [];
  let resto = n;
  let ultimaFoiEscalaGrande = false;

  for (const escala of ESCALAS) {
    const quantos = Math.floor(resto / escala.valor);
    if (!quantos) continue;
    resto %= escala.valor;
    // "mil" não leva "um" na frente: 1.000 é "mil", não "um mil".
    const prefixo = escala.valor === 1_000 && quantos === 1 ? '' : `${ate999(quantos)} `;
    partes.push({
      texto: `${prefixo}${quantos === 1 ? escala.um : escala.muitos}`.trim(),
      chave: quantos,
    });
    ultimaFoiEscalaGrande = escala.valor >= 1_000_000;
  }
  if (resto) {
    partes.push({ texto: ate999(resto), chave: resto });
    ultimaFoiEscalaGrande = false;
  }

  // "de reais" só quando o número ACABA numa escala de milhão/bilhão redonda.
  const pedeDe = ultimaFoiEscalaGrande && resto === 0 && partes.length === 1;

  if (partes.length === 1) return { texto: partes[0].texto, pedeDe };

  const ultima = partes[partes.length - 1];
  const anterior = partes[partes.length - 2];
  const inicio = partes.slice(0, -1).map((p) => p.texto).join(', ');
  const ligaComE = ultima.chave < 100 || ultima.chave % 100 === 0;
  const separador = ligaComE ? ' e ' : anterior.texto === 'mil' ? ' ' : ', ';
  return { texto: `${inicio}${separador}${ultima.texto}`, pedeDe };
}

/**
 * "R$ 1.234,56" → "mil duzentos e trinta e quatro reais e cinquenta e seis
 * centavos".
 *
 * Aceita número ou string decimal (o Prisma devolve `Decimal`, que vira string
 * sem perder centavo — `Number` em dinheiro é como se perde um centavo por
 * arredondamento, e num recibo isso é divergência com o caixa).
 */
export function valorPorExtenso(valor: number | string): string {
  const texto = typeof valor === 'string' ? valor : valor.toFixed(2);
  const negativo = texto.trim().startsWith('-');
  const limpo = texto.trim().replace('-', '');
  // Centavos a partir do TEXTO, não de `valor * 100`: 1.07 * 100 dá 107.00000000000001.
  const [inteiroTexto, centavosTexto = ''] = limpo.split('.');
  const inteiro = Math.floor(Math.abs(Number(inteiroTexto) || 0));
  const centavos = Number(`${centavosTexto}00`.slice(0, 2)) || 0;

  const partes: string[] = [];
  if (inteiro > 0 || centavos === 0) {
    const { texto: porExtenso, pedeDe } = inteiroPorExtenso(inteiro);
    const moeda = inteiro === 1 ? 'real' : 'reais';
    partes.push(`${porExtenso} ${pedeDe ? 'de ' : ''}${moeda}`);
  }
  if (centavos > 0) {
    partes.push(`${inteiroPorExtenso(centavos).texto} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  }
  const frase = partes.join(' e ');
  return negativo ? `menos ${frase}` : frase;
}
