import { applyDecorators } from '@nestjs/common';
import { IsDateString, Validate, ValidatorConstraint } from 'class-validator';
import type { ValidationArguments, ValidatorConstraintInterface } from 'class-validator';

/**
 * Validadores de datas de PESSOA.
 *
 * Existem porque `@IsDateString()` aceita qualquer data sintaticamente válida —
 * inclusive nascimento em 2090 e admissão daqui a três anos. Um dígito trocado
 * na digitação virava um cadastro que ninguém revisava, e o erro só aparecia
 * meses depois num relatório de idade ou de tempo de casa.
 *
 * As duas regras, aplicadas em todo campo de data de pessoa:
 *   1. NÃO PODE SER FUTURA — nascer, admitir e filiar são fatos consumados;
 *   2. NÃO PODE PASSAR DE 100 ANOS — pessoa com mais de um século no cadastro é,
 *      na prática, erro de digitação (ano trocado). O limite é generoso de
 *      propósito: barra o absurdo sem recusar o centenário legítimo.
 *
 * A comparação é feita em DIA (não em instante) para o fuso não transformar
 * "hoje" em "amanhã" — o sistema roda em UTC-3 e as datas de calendário são
 * gravadas como meia-noite de Brasília (ver common/utils/datas.util.ts).
 */

/** Idade máxima aceita num cadastro. */
export const IDADE_MAXIMA_ANOS = 100;

/** Brasil sem horário de verão desde 2019 → offset fixo UTC-3. */
const OFFSET_BR_MS = 3 * 3_600_000;

/** 'AAAA-MM-DD' do valor, no fuso de Brasília. Null se não for data válida. */
function diaBR(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - OFFSET_BR_MS).toISOString().slice(0, 10);
}

/** 'AAAA-MM-DD' de hoje em Brasília. */
function hojeBR(): string {
  return new Date(Date.now() - OFFSET_BR_MS).toISOString().slice(0, 10);
}

@ValidatorConstraint({ name: 'dataNaoFutura', async: false })
class DataNaoFuturaConstraint implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    const dia = diaBR(valor);
    // Vazio é problema do @IsOptional/@IsDateString, não deste validador.
    if (dia === null) return true;
    return dia <= hojeBR();
  }

  defaultMessage(args: ValidationArguments): string {
    return `${rotulo(args)} não pode ser uma data futura.`;
  }
}

@ValidatorConstraint({ name: 'idadeplausivel', async: false })
class IdadePlausivelConstraint implements ValidatorConstraintInterface {
  validate(valor: unknown): boolean {
    const dia = diaBR(valor);
    if (dia === null) return true;
    const limite = new Date(Date.now() - OFFSET_BR_MS);
    limite.setUTCFullYear(limite.getUTCFullYear() - IDADE_MAXIMA_ANOS);
    return dia >= limite.toISOString().slice(0, 10);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${rotulo(args)} indica mais de ${IDADE_MAXIMA_ANOS} anos — confira o ano digitado.`;
  }
}

/** Nome legível do campo para a mensagem de erro. */
function rotulo(args: ValidationArguments): string {
  const nomes: Record<string, string> = {
    dataNascimento: 'A data de nascimento',
    dataAdmissao: 'A data de admissão',
    dataFiliacao: 'A data de filiação',
    dataDesligamento: 'A data de desligamento',
    dataPedido: 'A data do pedido',
  };
  return nomes[args.property] ?? `O campo "${args.property}"`;
}

/**
 * Data de NASCIMENTO: não futura e dentro de um século.
 * Substitui `@IsDateString()` no campo.
 */
export function IsDataNascimento(): PropertyDecorator {
  return applyDecorators(
    IsDateString({}, { message: 'Informe uma data de nascimento válida.' }),
    Validate(DataNaoFuturaConstraint),
    Validate(IdadePlausivelConstraint),
  );
}

/**
 * Data de um FATO JÁ OCORRIDO (admissão, filiação, desligamento): não futura.
 *
 * Sem o teto de 100 anos: a entidade pode registrar um vínculo antigo, e a
 * idade de quem se filiou não se deduz da data de filiação.
 */
export function IsDataPassada(): PropertyDecorator {
  return applyDecorators(
    IsDateString({}, { message: 'Informe uma data válida.' }),
    Validate(DataNaoFuturaConstraint),
  );
}
