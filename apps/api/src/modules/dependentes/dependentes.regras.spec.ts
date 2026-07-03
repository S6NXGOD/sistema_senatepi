import { TipoDependente } from '@prisma/client';
import { calcularIdade, dependenteValidoParaEvento } from './dependentes.module';

describe('Regras de dependentes', () => {
  const hoje = new Date('2026-06-22');

  it('calcula idade corretamente (aniversário ainda não ocorrido no ano)', () => {
    expect(calcularIdade(new Date('2010-12-01'), hoje)).toBe(15);
  });

  it('calcula idade corretamente (aniversário já ocorrido no ano)', () => {
    expect(calcularIdade(new Date('2010-01-01'), hoje)).toBe(16);
  });

  it('cônjuge é sempre válido para evento', () => {
    expect(
      dependenteValidoParaEvento(TipoDependente.CONJUGE, new Date('1980-01-01')),
    ).toBe(true);
  });

  it('filho com até 18 anos é válido', () => {
    const nasc = new Date();
    nasc.setFullYear(nasc.getFullYear() - 17);
    expect(dependenteValidoParaEvento(TipoDependente.FILHO, nasc)).toBe(true);
  });

  it('filho com mais de 18 anos é inválido', () => {
    const nasc = new Date();
    nasc.setFullYear(nasc.getFullYear() - 25);
    expect(dependenteValidoParaEvento(TipoDependente.FILHO, nasc)).toBe(false);
  });
});
