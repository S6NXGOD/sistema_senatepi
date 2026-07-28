import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StatusProcesso } from '@prisma/client';

export class SincronizarProcessoDto {
  @ApiProperty({ description: 'Número único (NPU/CNJ) — com ou sem pontuação.' })
  @IsString() @IsNotEmpty()
  numeroCNJ: string;

  @ApiProperty({ description: 'Sigla do tribunal (ex.: TJPI, TRT22, TRF1).' })
  @IsString() @IsNotEmpty()
  tribunal: string;

  @ApiPropertyOptional({ description: 'Filiado vinculado ao processo.' })
  @IsOptional() @IsString()
  filiadoId?: string;

  @ApiPropertyOptional({ description: 'Advogado (usuário) responsável.' })
  @IsOptional() @IsString()
  advogadoId?: string;

  @ApiPropertyOptional({ enum: StatusProcesso })
  @IsOptional() @IsEnum(StatusProcesso)
  statusInterno?: StatusProcesso;
}

export class AtualizarProcessoDto {
  @ApiPropertyOptional({ enum: StatusProcesso })
  @IsOptional() @IsEnum(StatusProcesso) statusInterno?: StatusProcesso;
  @ApiPropertyOptional() @IsOptional() @IsString() filiadoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() advogadoId?: string;
}

export class ListProcessosQueryDto {
  @ApiPropertyOptional({ description: 'Busca por NPU, classe ou nome do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: StatusProcesso })
  @IsOptional() @IsEnum(StatusProcesso) statusInterno?: StatusProcesso;

  @ApiPropertyOptional() @IsOptional() @IsString() tribunal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() filiadoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() advogadoId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
