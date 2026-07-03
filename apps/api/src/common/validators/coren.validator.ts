import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { FormacaoColonia } from '@prisma/client';

/**
 * Sufixo do COREN por formação:
 *  - ENFERMEIRO → ENF
 *  - TECNICO    → TE
 *  - AUXILIAR   → AE
 *
 * Regra: o COREN DEVE corresponder à formação (item de validação rígida).
 * O formulário seleciona a formação e o sufixo já fica definido — o número
 * (1 a 6 dígitos) é o único campo livre.
 */
export const SUFIXO_COREN: Record<FormacaoColonia, 'ENF' | 'TE' | 'AE'> = {
  ENFERMEIRO: 'ENF',
  TECNICO: 'TE',
  AUXILIAR: 'AE',
};

/** Regex do COREN esperado para uma formação (ex.: /^\d{1,6}-ENF$/). */
export function corenRegexPara(formacao: FormacaoColonia): RegExp {
  return new RegExp(`^\\d{1,6}-${SUFIXO_COREN[formacao]}$`);
}

@ValidatorConstraint({ name: 'corenParaFormacao', async: false })
export class CorenParaFormacaoConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const formacao = (args.object as { formacao?: FormacaoColonia }).formacao;
    // Sem formação válida não há sufixo esperado (o @IsEnum de `formacao` reporta o erro dela).
    if (!formacao || !(formacao in SUFIXO_COREN)) return false;
    // COREN é obrigatório e deve casar exatamente com o formato da formação.
    if (typeof value !== 'string' || value.trim() === '') return false;
    return corenRegexPara(formacao).test(value.trim());
  }

  defaultMessage(args: ValidationArguments): string {
    const formacao = (args.object as { formacao?: FormacaoColonia }).formacao;
    const suf = formacao && formacao in SUFIXO_COREN ? SUFIXO_COREN[formacao] : 'ENF|TE|AE';
    return `COREN inválido para a formação: use o formato "<número de 1 a 6 dígitos>-${suf}" (ex.: 123456-${suf}).`;
  }
}

/** Valida que o COREN casa com a formação informada no mesmo objeto. */
export function IsCorenParaFormacao(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: CorenParaFormacaoConstraint,
    });
  };
}
