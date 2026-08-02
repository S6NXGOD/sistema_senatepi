import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';
import { StatusProcesso } from '@prisma/client';

/** Chaves de paleta aceitas (espelham o front). */
export const CORES_ANDAMENTO = [
  'slate', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose',
  'red', 'orange', 'amber', 'emerald', 'teal', 'cyan',
] as const;

// ---------------------------------------------------------------------------
// Tipos de movimentação (cadastráveis)
// ---------------------------------------------------------------------------

export class CriarTipoAndamentoDto {
  @ApiProperty() @IsString() @MinLength(2, { message: 'Informe o nome do tipo.' }) @MaxLength(40)
  nome: string;

  @ApiPropertyOptional({ enum: CORES_ANDAMENTO }) @IsOptional() @IsString()
  cor?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  ordem?: number;
}

export class AtualizarTipoAndamentoDto extends PartialType(CriarTipoAndamentoDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  ativo?: boolean;
}

// ---------------------------------------------------------------------------
// Movimentação interna (andamento registrado pela equipe)
// ---------------------------------------------------------------------------

export class RegistrarMovimentacaoDto {
  @ApiProperty({ description: 'Slug do tipo de movimentação (cadastrável).' })
  @IsString() @MinLength(1)
  tipo: string;

  @ApiProperty({ description: 'O que aconteceu no processo.' })
  @IsString() @MinLength(3, { message: 'Descreva a movimentação.' }) @MaxLength(5000)
  descricao: string;

  /**
   * Quando o ato REALMENTE aconteceu, se diferente de hoje. Sem isto, a
   * audiência de quarta lançada na sexta apareceria na sexta na linha do tempo.
   * O carimbo de auditoria (`createdAt`) continua sendo a hora do registro.
   */
  @ApiPropertyOptional({
    description: 'Data do fato (ISO). Omitida, a movimentação vale pela data do registro.',
  })
  @IsOptional() @IsDateString({}, { message: 'Data do fato inválida.' })
  dataFato?: string;

  @ApiPropertyOptional({ description: 'Nota interna — não sai em extratos ao filiado.' })
  @IsOptional() @IsBoolean()
  notaInterna?: boolean;

  @ApiPropertyOptional({ enum: StatusProcesso, description: 'Muda o status do processo junto com o registro.' })
  @IsOptional() @IsEnum(StatusProcesso)
  novoStatus?: StatusProcesso;

  @ApiPropertyOptional({ description: 'Id de um anexo já enviado (POST /anexos).' })
  @IsOptional() @IsString()
  anexoId?: string;
}
