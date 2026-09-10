import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatDataPura, dataPuraComoDate, diasDesdeDataPura } from './data-pura';

/**
 * "ESCALA CADASTRADA NA SEGUNDA APARECENDO NO DOMINGO."
 *
 * Um `date` do Postgres não guarda instante — guarda "14 de setembro". O Prisma
 * o entrega como `2026-09-14T00:00:00.000Z`, e `new Date(...)
 * .toLocaleDateString('pt-BR')` num navegador em Teresina (UTC-3) resolve para
 * 13/09 às 21h. A data anda um dia para trás, sempre.
 *
 * Medido na produção em 10/09/2026 — o total, não uma amostra:
 *   escalas .................. 25 de 25
 *   vencimento de parcela .... 36 de 36
 *   competência .............. 36 de 36
 *   publicações do DJEN ...... 500 de 500
 */

/** A data que o usuário relatou: uma segunda-feira. */
const SEGUNDA = '2026-09-14T00:00:00.000Z';

describe('a data pura não anda para trás', () => {
  it('a segunda continua segunda', () => {
    expect(formatDataPura(SEGUNDA)).toBe('14/09/2026');
    expect(formatDataPura(SEGUNDA, { weekday: 'long', day: '2-digit', month: '2-digit' })).toContain(
      'segunda-feira',
    );
  });

  /**
   * A PROVA DE VERDADE: se o teste roda numa máquina em UTC, ele passaria com o
   * código bugado. Aqui a comparação é explícita contra o que a versão antiga
   * produzia — `new Date(x).toLocaleDateString('pt-BR', { timeZone: BR })`.
   */
  it('e o jeito antigo produzia domingo — a diferença está provada', () => {
    const comoEra = new Date(SEGUNDA).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'America/Fortaleza',
    });
    expect(comoEra).toBe('13/09/2026'); // o bug, reproduzido
    expect(formatDataPura(SEGUNDA)).toBe('14/09/2026'); // o conserto
  });

  /** Os quatro campos medidos, com o valor do banco e o que a tela mostrava. */
  it.each([
    ['escala', '2026-09-30T00:00:00.000Z', '30/09/2026'],
    ['vencimento', '2026-09-20T00:00:00.000Z', '20/09/2026'],
    ['competência', '2026-09-10T00:00:00.000Z', '10/09/2026'],
    ['publicação', '2024-12-04T00:00:00.000Z', '04/12/2024'],
  ])('%s: %s → %s', (_campo, doBanco, esperado) => {
    expect(formatDataPura(doBanco)).toBe(esperado);
  });

  /** Aceita a data já enxuta, caso a API passe a mandar `YYYY-MM-DD`. */
  it('aceita as duas formas em que a data pura pode chegar', () => {
    expect(formatDataPura('2026-09-14')).toBe('14/09/2026');
    expect(formatDataPura('2026-09-14T00:00:00.000Z')).toBe('14/09/2026');
  });

  it('vazio e lixo viram travessão, nunca "Invalid Date"', () => {
    expect(formatDataPura(null)).toBe('—');
    expect(formatDataPura(undefined)).toBe('—');
    expect(formatDataPura('')).toBe('—');
    expect(formatDataPura('nao e data')).toBe('—');
  });

  /**
   * MEIO-DIA, E NÃO MEIA-NOITE — é o detalhe que faz a coisa funcionar. Com
   * `T00:00:00Z` qualquer fuso negativo já cai no dia anterior, que É o bug.
   */
  it('o Date construído fica ao meio-dia UTC, longe das duas bordas', () => {
    const d = dataPuraComoDate(SEGUNDA)!;
    expect(d.toISOString()).toBe('2026-09-14T12:00:00.000Z');
    // Sobram 12h de folga para cada lado: nenhum fuso do planeta muda o dia.
    expect(d.getUTCHours()).toBe(12);
  });
});

describe('dias desde uma data pura', () => {
  const hojeBR = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
  const maisDias = (n: number) =>
    new Date(new Date(`${hojeBR}T12:00:00.000Z`).getTime() + n * 86_400_000)
      .toISOString()
      .slice(0, 10);

  it('hoje é zero', () => {
    expect(diasDesdeDataPura(hojeBR)).toBe(0);
  });

  it('ontem é um, e uma semana atrás é sete', () => {
    expect(diasDesdeDataPura(maisDias(-1))).toBe(1);
    expect(diasDesdeDataPura(maisDias(-7))).toBe(7);
  });

  it('sem valor, devolve null em vez de NaN', () => {
    expect(diasDesdeDataPura(null)).toBeNull();
    expect(diasDesdeDataPura('xxx')).toBeNull();
  });
});

/**
 * OS IRMÃOS. Consertar o cartão da escala e deixar o carnê errado seria trocar
 * um bug visível por três invisíveis — e vencimento de carnê é documento que o
 * filiado leva ao banco.
 */
describe('todo campo de data pura usa a regra única', () => {
  const ler = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it.each([
    ['app/(dashboard)/dashboard/page.tsx', 'proximoPlantao.data'],
    ['app/(dashboard)/dashboard/page.tsx', 'pub.dataDisponibilizacao'],
    ['components/cobrancas/carne-print-modal.tsx', 'parcela.dataVencimento'],
    ['components/cobrancas/carne-print-modal.tsx', 'parcela.dataCompetencia'],
    ['components/cobrancas/filiado-cobrancas-card.tsx', 'p.dataVencimento'],
    ['components/filiados/financeiro-section.tsx', 'p.dataVencimento'],
    ['components/processos/publicacao-djen-card.tsx', 'pub.dataDisponibilizacao'],
    ['app/(dashboard)/escalas/page.tsx', 'e.data'],
  ])('%s formata %s com formatDataPura', (arquivo, campo) => {
    expect(ler(arquivo)).toContain(`formatDataPura(${campo}`);
  });

  /**
   * A NEGATIVA MIRA A CHAMADA, não a palavra: os arquivos têm comentários que
   * citam `new Date(...)` para explicar o bug, e uma negativa ingênua reprovaria
   * justamente o arquivo corrigido. Já custou cinco correções nesta base.
   */
  it.each([
    ['app/(dashboard)/dashboard/page.tsx', 'new Date(proximoPlantao.data)'],
    ['app/(dashboard)/dashboard/page.tsx', 'new Date(pub.dataDisponibilizacao)'],
    ['components/cobrancas/carne-print-modal.tsx', 'formatData(parcela.dataVencimento)'],
    ['components/cobrancas/filiado-cobrancas-card.tsx', 'formatData(p.dataVencimento)'],
  ])('%s não constrói mais Date a partir de %s', (arquivo, chamadaAntiga) => {
    expect(ler(arquivo)).not.toContain(chamadaAntiga);
  });

  /** `timeZone` não é opção de quem chama — senão o bug volta pela porta. */
  it('formatDataPura não deixa o chamador escolher o fuso', () => {
    const fonte = readFileSync(join(__dirname, 'data-pura.ts'), 'utf8');
    expect(fonte).toContain("Omit<Intl.DateTimeFormatOptions, 'timeZone'>");
    expect(fonte).toContain("timeZone: 'UTC'");
  });
});
