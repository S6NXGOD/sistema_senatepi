import { ehDiaDeExpediente, feriadosNacionais } from './feriados';
import { diasUteisEntre } from './dias-uteis';

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * O caso que originou tudo: terça, 03/11/2026, o painel anunciou "não recebe
 * as publicações do Diário desde domingo, 01/11". Entre os dois havia um
 * domingo (que nunca tem edição) e Finados (que não tem expediente).
 */
describe('feriados nacionais', () => {
  it('02/11 é Finados, e não é dia de expediente', () => {
    expect(feriadosNacionais(2026).has('2026-11-02')).toBe(true);
    expect(ehDiaDeExpediente(dia('2026-11-02'))).toBe(false);
  });

  it.each([
    ['2026-01-01', 'Confraternização'],
    ['2026-04-21', 'Tiradentes'],
    ['2026-05-01', 'Dia do Trabalho'],
    ['2026-09-07', 'Independência'],
    ['2026-10-12', 'Aparecida'],
    ['2026-11-15', 'Proclamação'],
    ['2026-12-25', 'Natal'],
  ])('%s (%s) não é expediente', (d) => {
    expect(ehDiaDeExpediente(dia(d))).toBe(false);
  });

  /*
    OS MÓVEIS SAEM DA PÁSCOA. Em 2026 ela cai em 05/04, então: Carnaval
    16 e 17/02, Sexta-feira Santa 03/04, Corpus Christi 04/06. Todos os
    quatro estão entre os dias úteis SEM publicação nenhuma no acervo — o
    que não prova, mas combina.
  */
  it.each([
    ['2026-02-16', 'Carnaval (segunda)'],
    ['2026-02-17', 'Carnaval (terça)'],
    ['2026-04-03', 'Sexta-feira Santa'],
    ['2026-06-04', 'Corpus Christi'],
  ])('%s (%s) sai da Páscoa', (d) => {
    expect(ehDiaDeExpediente(dia(d))).toBe(false);
  });

  /*
    Consciência Negra é feriado NACIONAL desde a Lei 14.759/2023. Faltava na
    lista até 07/11/2026, e em 2026 cai numa sexta-feira.
  */
  it('20/11 é Consciência Negra, e não é dia de expediente', () => {
    expect(ehDiaDeExpediente(new Date('2026-11-20T00:00:00.000Z'))).toBe(false);
    expect(ehDiaDeExpediente(new Date('2026-11-19T00:00:00.000Z'))).toBe(true);
  });

  it('a Páscoa de outros anos também fecha', () => {
    // 2027: Páscoa em 28/03 → Sexta-feira Santa 26/03, Corpus Christi 27/05.
    expect(ehDiaDeExpediente(dia('2027-03-26'))).toBe(false);
    expect(ehDiaDeExpediente(dia('2027-05-27'))).toBe(false);
  });

  it('dia útil comum continua sendo expediente', () => {
    expect(ehDiaDeExpediente(dia('2026-11-03'))).toBe(true);
    expect(ehDiaDeExpediente(dia('2026-10-30'))).toBe(true);
  });

  it('fim de semana continua fora, como já estava', () => {
    expect(ehDiaDeExpediente(dia('2026-10-31'))).toBe(false); // sábado
    expect(ehDiaDeExpediente(dia('2026-11-01'))).toBe(false); // domingo
  });
});

/**
 * O FALSO ALARME DE 03/11/2026, reproduzido.
 *
 * Última varredura boa: domingo 01/11 às 05h12 de Teresina. "Agora": terça
 * 03/11 às 03h16. Sem feriado a conta dava DOIS dias úteis (02 e 03) e a faixa
 * acusava a integração; com Finados fora, dá UM — e não havia uma linha sequer
 * a receber no meio.
 */
describe('o atraso do Diário em dias de expediente', () => {
  const domingo = new Date('2026-11-01T08:12:00Z');
  const tercaDeManha = new Date('2026-11-03T06:16:00Z');

  it('de domingo à terça de Finados é UM dia de expediente, não dois', () => {
    expect(diasUteisEntre(domingo, tercaDeManha)).toBe(1);
  });

  it('e na quarta já são dois — aí o aviso é devido', () => {
    expect(diasUteisEntre(domingo, new Date('2026-11-04T06:00:00Z'))).toBe(2);
  });

  /* O fim de semana continua não contando — era o conserto anterior. */
  it('sexta para segunda é um dia só', () => {
    expect(diasUteisEntre(new Date('2026-10-30T08:00:00Z'), new Date('2026-11-02T20:00:00Z'))).toBe(0);
  });
});
