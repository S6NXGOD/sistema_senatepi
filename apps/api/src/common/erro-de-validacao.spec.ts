import { ValidationError } from '@nestjs/common';
import { MENSAGEM_DE_DEFEITO, erroDeValidacao } from './erro-de-validacao';

const erro = (property: string, constraints: Record<string, string>): ValidationError =>
  ({ property, constraints }) as ValidationError;

const mensagens = (e: ReturnType<typeof erroDeValidacao>) =>
  (e.getResponse() as { message: string[] }).message;

/**
 * "PROPERTY ENTECODIGO SHOULD NOT EXIST" apareceu na tela de uma secretaria em
 * 25/09/2026, ao tentar cadastrar uma organizacao.
 *
 * Ela nao sabe o que e `enteCodigo`, nao digitou aquilo em lugar nenhum, e nao
 * havia nada que pudesse fazer: o campo faltava no DTO do POST e NENHUMA
 * organizacao podia ser cadastrada havia quinze dias — sem um unico chamado,
 * porque a mensagem fazia parecer erro dela.
 */
describe('o erro de validacao fala com quem pode resolver', () => {
  it('a mensagem escrita para a pessoa passa inteira', () => {
    const e = erroDeValidacao([erro('nome', { minLength: 'Informe o nome da parte.' })]);
    expect(mensagens(e)).toEqual(['Informe o nome da parte.']);
  });

  /** `forbidNonWhitelisted` e defeito NOSSO: o cliente mandou o que o DTO nao conhece. */
  it('"should not exist" nao chega na tela', () => {
    const e = erroDeValidacao([
      erro('enteCodigo', { whitelistValidation: 'property enteCodigo should not exist' }),
    ]);
    expect(mensagens(e)).toEqual([MENSAGEM_DE_DEFEITO]);
    expect(mensagens(e)[0]).not.toMatch(/enteCodigo/);
  });

  /** E as automaticas do class-validator tambem sao conversa de desenvolvedor. */
  it.each([
    'documento must be a string',
    'codigo must be an integer number',
    'ativo must be a boolean value',
    'tipo must be one of the following values: A, B',
  ])('esconde "%s"', (bruta) => {
    const e = erroDeValidacao([erro('x', { c: bruta })]);
    expect(mensagens(e)).toEqual([MENSAGEM_DE_DEFEITO]);
  });

  /**
   * MISTURA: se ha ao menos UMA coisa que a pessoa pode corrigir, e dela que a
   * tela fala. Mandar as duas faria ela procurar um campo que nao existe no
   * formulario, no meio de um erro que ela consegue resolver.
   */
  it('havendo erro corrigivel, so ele aparece', () => {
    const e = erroDeValidacao([
      erro('nome', { minLength: 'Informe o nome da parte.' }),
      erro('enteCodigo', { whitelistValidation: 'property enteCodigo should not exist' }),
    ]);
    expect(mensagens(e)).toEqual(['Informe o nome da parte.']);
  });

  /** Erro aninhado (`@ValidateNested`) tambem e achatado — vinculos, dependentes. */
  it('acha a mensagem dentro do filho', () => {
    const pai = {
      property: 'vinculos',
      children: [
        { property: '0', children: [erro('empresa', { isString: 'Informe a instituicao.' })] },
      ],
    } as unknown as ValidationError;
    expect(mensagens(erroDeValidacao([pai]))).toEqual(['Informe a instituicao.']);
  });

  /** A frase nao culpa a pessoa e diz o que fazer. */
  it('a frase de defeito assume a culpa e aponta a saida', () => {
    expect(MENSAGEM_DE_DEFEITO).toMatch(/problema nosso/i);
    expect(MENSAGEM_DE_DEFEITO).toMatch(/suporte/i);
  });

  /** Sempre ARRAY: e o formato que as telas ja tratam. */
  it('devolve sempre um array', () => {
    expect(Array.isArray(mensagens(erroDeValidacao([])))).toBe(true);
  });
});
