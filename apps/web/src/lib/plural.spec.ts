import { plural, contar } from './plural';

/**
 * Os três casos reais do código, incluindo os dois que estavam errados no ar.
 */
describe('plural em português', () => {
  it('troca a terminação em -ão, não acumula', () => {
    expect(plural(1, 'organização', 'organizações')).toBe('organização');
    expect(plural(27, 'organização', 'organizações')).toBe('organizações');
    expect(plural(27, 'organização', 'organizações')).not.toContain('ãoões');
  });

  it('troca a terminação em -l', () => {
    expect(plural(1, 'possível', 'possíveis')).toBe('possível');
    expect(plural(3, 'possível', 'possíveis')).toBe('possíveis');
    expect(plural(3, 'possível', 'possíveis')).not.toContain('velis');
  });

  it('zero é plural, como se fala', () => {
    expect(contar(0, 'processo', 'processos')).toBe('0 processos');
  });

  it('um é singular; negativo também conta pelo módulo', () => {
    expect(contar(1, 'prazo', 'prazos')).toBe('1 prazo');
    expect(contar(-1, 'prazo', 'prazos')).toBe('-1 prazo');
  });
});
