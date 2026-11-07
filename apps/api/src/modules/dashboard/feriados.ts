/**
 * OS DIAS EM QUE O DIÁRIO NÃO CIRCULA.
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * O dono perguntou, olhando a faixa do painel em 03/11/2026: *"O sistema diz
 * que não recebe publicações desde domingo, 01/11. Mas o Diário recebe
 * atualizações no sábado e domingo?"*
 *
 * Não recebe. Medido nas 2.537 publicações do acervo: **ZERO** caíram num
 * sábado ou domingo. `diasUteisEntre` já sabia disso — e só disso. Não sabia
 * de feriado, e 02/11/2026 era **Finados**: a conta de "dois dias úteis sem
 * notícia" somou um dia em que não havia notícia nenhuma a dar.
 *
 * NÃO DEU PARA DEDUZIR DO BANCO. Dia útil sem publicação existe aos montes
 * (741 de 1.275 na janela inteira) — com 188 processos, a maioria dos dias
 * simplesmente não tem ato nosso. "Zero publicações" não prova "não circulou",
 * então a lista é explícita.
 *
 * O QUE ENTRA: os feriados NACIONAIS, que suspendem o expediente forense em
 * todo o país. Os móveis saem da Páscoa.
 *
 * O QUE NÃO ENTRA, e é limitação conhecida:
 *  · feriado estadual e municipal (Teresina tem o 19/10, por exemplo) e os
 *    pontos facultativos — o alarme vai contar um dia a mais nesses, e o custo
 *    é uma faixa que aparece um dia antes do que devia;
 *  · o recesso forense de 20/12 a 06/01. O acervo sugere que o Diário não
 *    circula nele (todos os dias úteis de 23/12/2025 a 06/01/2026 estão
 *    vazios), mas com este tamanho de acervo isso não é prova.
 */

/** Domingo de Páscoa (Meeus/Jones/Butcher) — a âncora dos feriados móveis. */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const diaISO = (d: Date) => d.toISOString().slice(0, 10);

/** Feriados fixos, como MM-DD. */
const FIXOS = [
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  /*
    Consciência Negra: feriado NACIONAL desde a Lei 14.759/2023 (vale a partir
    de 2024). Faltava aqui até 07/11/2026, e em 2026 ele cai numa sexta: a faixa
    do painel contaria um dia útil sem Diário, e a conta de prazo da agenda
    encurtaria um dia — o lado em que alguém perde prazo por causa do sistema.
  */
  '11-20',
  '12-25', // Natal
];

/** Cache por ano: a lista não muda no meio da execução. */
const porAno = new Map<number, Set<string>>();

export function feriadosNacionais(ano: number): Set<string> {
  const guardado = porAno.get(ano);
  if (guardado) return guardado;

  const dias = new Set(FIXOS.map((md) => `${ano}-${md}`));
  const dom = pascoa(ano);
  const somar = (n: number) => {
    const d = new Date(dom);
    d.setUTCDate(d.getUTCDate() + n);
    return diaISO(d);
  };
  dias.add(somar(-48)); // Carnaval (segunda)
  dias.add(somar(-47)); // Carnaval (terça)
  dias.add(somar(-2)); //  Sexta-feira Santa
  dias.add(somar(60)); //  Corpus Christi

  porAno.set(ano, dias);
  return dias;
}

/**
 * O dia (yyyy-mm-dd, em UTC) é de expediente forense?
 *
 * Recebe o DIA, não o instante — quem chama já resolveu o fuso. Ver
 * `dias-uteis.ts`, que caminha por dia de calendário justamente por isso.
 */
export function ehDiaDeExpediente(diaUtc: Date): boolean {
  const dow = diaUtc.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !feriadosNacionais(diaUtc.getUTCFullYear()).has(diaISO(diaUtc));
}
