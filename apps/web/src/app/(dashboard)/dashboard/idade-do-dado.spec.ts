import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGINA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

/**
 * "HÁ 1008 H" — o que a tela dizia, e ninguém lê.
 *
 * Visto na conferência de 18/09/2026, no painel do advogado: "A varredura do
 * DataJud está sem rodar há mais de 3 dias — a última foi há 1008 h". São 42
 * dias. Hora acima de dois dias é número que a pessoa precisa dividir de
 * cabeça, e número que exige conta não é informação.
 *
 * A mesma função serve ao "atualizado há X" do cabeçalho, que é de segundos —
 * por isso os quatro degraus, e não uma unidade só.
 */
describe('a idade do dado troca de unidade quando a hora deixa de caber', () => {
  /* A função é interna à página; o teste avalia o corpo dela isoladamente. */
  const idadeDoDado = (() => {
    const inicio = PAGINA.indexOf('function idadeDoDado(');
    const fim = PAGINA.indexOf('\n}', inicio) + 2;
    const corpo = PAGINA.slice(inicio, fim).replace(/: string|: number/g, '');
    // eslint-disable-next-line no-new-func
    return new Function(`${corpo}; return idadeDoDado;`)() as (q: number) => string;
  })();

  const atras = (ms: number) => Date.now() - ms;
  const MIN = 60_000;
  const HORA = 60 * MIN;
  const DIA = 24 * HORA;

  it.each([
    ['acabou de carregar', 10_000, 'agora há pouco'],
    ['minutos', 20 * MIN, 'há 20 min'],
    ['horas', 5 * HORA, 'há 5 h'],
    ['ainda em horas às 47 h', 47 * HORA, 'há 47 h'],
    ['vira dias depois de 48 h', 3 * DIA, 'há 3 dias'],
    ['o caso real: 1008 h', 1008 * HORA, 'há 42 dias'],
    ['vira meses depois de dois', 90 * DIA, 'há 3 meses'],
  ])('%s', (_nome, ms, esperado) => {
    expect(idadeDoDado(atras(ms))).toBe(esperado);
  });

  it('data no futuro não vira número negativo', () => {
    expect(idadeDoDado(Date.now() + 5 * HORA)).toBe('agora há pouco');
  });
});
