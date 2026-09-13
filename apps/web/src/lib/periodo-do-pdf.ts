/**
 * O PERÍODO DO PDF — o mês, o ano, ou as datas que a pessoa escolher, e o
 * período anterior para comparar.
 *
 * Datas como TEXTO "AAAA-MM-DD" do começo ao fim, e contas em UTC: é o que o
 * `<input type="date">` fala e o que a API espera. Passar por fuso local aqui é
 * o jeito conhecido de o dia andar para trás (ver `data-pura.ts`).
 */

export type PresetDoPeriodo = 'TELA' | 'ESTE_MES' | 'MES_PASSADO' | 'ESTE_ANO' | 'ANO_PASSADO' | 'PERSONALIZADO';

export const PRESETS_DO_PERIODO: { id: PresetDoPeriodo; texto: string }[] = [
  { id: 'TELA', texto: 'O mesmo da tela' },
  { id: 'ESTE_MES', texto: 'Este mês' },
  { id: 'MES_PASSADO', texto: 'Mês passado' },
  { id: 'ESTE_ANO', texto: 'Este ano' },
  { id: 'ANO_PASSADO', texto: 'Ano passado' },
  { id: 'PERSONALIZADO', texto: 'Escolher as datas' },
];

export interface Periodo {
  de: string;
  ate: string;
}

const DIA_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const comoTexto = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const comoData = (t: string) => {
  const [a, m, d] = t.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
};
const ultimoDiaDoMes = (ano: number, mes0: number) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
const emOrdem = (p: Periodo): Periodo => (p.de <= p.ate ? p : { de: p.ate, ate: p.de });

/** "Hoje" como texto, pelo calendário de quem está gerando o PDF. */
export function hojeComoTexto(agora: Date): string {
  return `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
}

export function periodoDoPreset(
  preset: PresetDoPeriodo,
  hoje: string,
  tela: Periodo,
  escolhido?: Periodo,
): Periodo {
  const [ano, mes] = hoje.split('-').map(Number);
  switch (preset) {
    case 'ESTE_MES':
      return { de: `${ano}-${pad(mes)}-01`, ate: hoje };
    case 'MES_PASSADO': {
      const a = mes === 1 ? ano - 1 : ano;
      const m = mes === 1 ? 12 : mes - 1;
      return { de: `${a}-${pad(m)}-01`, ate: `${a}-${pad(m)}-${pad(ultimoDiaDoMes(a, m - 1))}` };
    }
    case 'ESTE_ANO':
      return { de: `${ano}-01-01`, ate: hoje };
    case 'ANO_PASSADO':
      return { de: `${ano - 1}-01-01`, ate: `${ano - 1}-12-31` };
    case 'PERSONALIZADO':
      return emOrdem(escolhido ?? tela);
    default:
      return emOrdem(tela);
  }
}

/** Recua meses prendendo o dia no fim do mês: 31/03 menos um mês é 28/02 (ou 29). */
function recuarMeses(t: string, meses: number): string {
  const [a, m, d] = t.split('-').map(Number);
  const total = a * 12 + (m - 1) - meses;
  const ano = Math.floor(total / 12);
  const mes0 = total - ano * 12;
  return `${ano}-${pad(mes0 + 1)}-${pad(Math.min(d, ultimoDiaDoMes(ano, mes0)))}`;
}

/**
 * O PERÍODO ANTERIOR, do mesmo tamanho — contra o que se compara.
 *
 *  · este mês (até hoje) → os MESMOS dias do mês anterior: 01 a 12/09 compara
 *    com 01 a 12/08, e não com agosto inteiro — senão todo mês em curso
 *    "cairia" pela metade no papel da assembleia;
 *  · o mês passado inteiro → o mês anterior inteiro;
 *  · o ano → o mesmo trecho do ano anterior;
 *  · qualquer outro → a mesma quantidade de dias, logo antes.
 */
export function periodoAnterior(p: Periodo, preset: PresetDoPeriodo): Periodo {
  if (preset === 'MES_PASSADO') {
    const de = recuarMeses(p.de, 1);
    const [a, m] = de.split('-').map(Number);
    return { de, ate: `${a}-${pad(m)}-${pad(ultimoDiaDoMes(a, m - 1))}` };
  }
  if (preset === 'ESTE_MES') return { de: recuarMeses(p.de, 1), ate: recuarMeses(p.ate, 1) };
  if (preset === 'ESTE_ANO' || preset === 'ANO_PASSADO') {
    return { de: recuarMeses(p.de, 12), ate: recuarMeses(p.ate, 12) };
  }
  const dias = Math.round((comoData(p.ate).getTime() - comoData(p.de).getTime()) / DIA_MS) + 1;
  const ate = new Date(comoData(p.de).getTime() - DIA_MS);
  const de = new Date(ate.getTime() - (dias - 1) * DIA_MS);
  return { de: comoTexto(de), ate: comoTexto(ate) };
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "setembro de 2026", "2026", ou "13/08/2026 a 12/09/2026" — o nome que vai no papel. */
export function rotuloDoPeriodo(p: Periodo): string {
  const [a1, m1, d1] = p.de.split('-').map(Number);
  const [a2, m2, d2] = p.ate.split('-').map(Number);
  if (a1 === a2 && m1 === 1 && d1 === 1 && m2 === 12 && d2 === 31) return String(a1);
  if (a1 === a2 && m1 === m2 && d1 === 1 && d2 === ultimoDiaDoMes(a2, m2 - 1)) {
    return `${MESES[m1 - 1]} de ${a1}`;
  }
  const br = (a: number, m: number, d: number) => `${pad(d)}/${pad(m)}/${a}`;
  return `${br(a1, m1, d1)} a ${br(a2, m2, d2)}`;
}

/**
 * O PERÍODO POR EXTENSO — o destaque da primeira página do PDF.
 *
 * "1º a 31 de agosto de 2026", "1º de janeiro a 12 de setembro de 2026",
 * "15 de dezembro de 2025 a 14 de janeiro de 2026". Texto puro, sem `Date`: o
 * dia não anda para trás em fuso nenhum.
 */
export function periodoPorExtenso(p: Periodo): string {
  const [a1, m1, d1] = p.de.split('-').map(Number);
  const [a2, m2, d2] = p.ate.split('-').map(Number);
  const dia = (d: number) => (d === 1 ? '1º' : String(d));
  const mes = (m: number) => MESES[m - 1] ?? String(m);
  if (a1 === a2 && m1 === m2) {
    return d1 === d2 ? `${dia(d1)} de ${mes(m1)} de ${a1}` : `${dia(d1)} a ${d2} de ${mes(m1)} de ${a1}`;
  }
  if (a1 === a2) return `${dia(d1)} de ${mes(m1)} a ${dia(d2)} de ${mes(m2)} de ${a1}`;
  return `${dia(d1)} de ${mes(m1)} de ${a1} a ${dia(d2)} de ${mes(m2)} de ${a2}`;
}

/** O preset guardado no navegador ainda existe? Lixo antigo vira o padrão. */
export function presetValido(valor: unknown): valor is PresetDoPeriodo {
  return PRESETS_DO_PERIODO.some((p) => p.id === valor);
}

const DATA_PURA = /^\d{4}-\d{2}-\d{2}$/;

/** As duas datas preenchidas — o campo de data apagado devolve texto vazio. */
export function periodoValido(p: Periodo): boolean {
  return DATA_PURA.test(p.de) && DATA_PURA.test(p.ate);
}
