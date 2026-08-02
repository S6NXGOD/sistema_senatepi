import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { StatusContribuicaoPatronal } from '@prisma/client';
import {
  IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength,
} from 'class-validator';

const TRIM = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ListarContribuicoesAdminQueryDto {
  @ApiPropertyOptional({ enum: StatusContribuicaoPatronal })
  @IsOptional() @IsEnum(StatusContribuicaoPatronal)
  status?: StatusContribuicaoPatronal;

  @ApiPropertyOptional({ description: 'Razão social, nome fantasia ou CNPJ.' })
  @IsOptional() @IsString() @Transform(TRIM)
  busca?: string;

  @ApiPropertyOptional({ description: 'Competência (AAAA-MM).' })
  @IsOptional() @IsString() @Transform(TRIM)
  mesReferencia?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  pageSize?: number;
}

export class HomologarContribuicaoDto {
  /**
   * Conta que recebe a entrada no fluxo de caixa.
   *
   * Opcional de propósito: a homologação é ato do sindicato e não pode ficar
   * travada por causa do financeiro. Sem conta informada (ou sem nenhuma conta
   * cadastrada), a contribuição é homologada e o lançamento fica pendente.
   */
  @ApiPropertyOptional({ description: 'Conta bancária para lançar a ENTRADA.' })
  @IsOptional() @IsUUID()
  contaBancariaId?: string;

  @ApiPropertyOptional({ description: 'Observação interna da conferência.' })
  @IsOptional() @IsString() @Transform(TRIM) @MaxLength(500)
  observacao?: string;
}

export class RejeitarContribuicaoDto {
  @ApiProperty({ description: 'Explicação que a empresa vai ler para corrigir.' })
  @IsString() @Transform(TRIM)
  @MinLength(10, { message: 'Descreva o motivo da rejeição com pelo menos 10 caracteres.' })
  @MaxLength(500)
  motivo: string;
}
