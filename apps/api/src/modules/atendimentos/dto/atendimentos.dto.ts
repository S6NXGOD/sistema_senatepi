import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CanalAtendimento,
  DesfechoAtendimento,
  SetorAtendimento,
} from '@prisma/client';

export class CreateAtendimentoDto {
  @ApiProperty({ description: 'Filiado ao qual o atendimento pertence (obrigatório).' })
  @IsString() @IsNotEmpty()
  filiadoId: string;

  @ApiProperty({ enum: CanalAtendimento })
  @IsEnum(CanalAtendimento)
  canal: CanalAtendimento;

  @ApiProperty({ description: 'Descrição da demanda.' })
  @IsString() @MinLength(3, { message: 'Descreva a demanda.' })
  descricao: string;

  @ApiProperty({ enum: DesfechoAtendimento })
  @IsEnum(DesfechoAtendimento)
  desfecho: DesfechoAtendimento;

  // Só quando ENCAMINHADO: setor é obrigatório; responsável é opcional.
  @ApiPropertyOptional({ enum: SetorAtendimento })
  @ValidateIf((o) => o.desfecho === DesfechoAtendimento.ENCAMINHADO)
  @IsEnum(SetorAtendimento, { message: 'Informe o setor que assumirá a demanda.' })
  setor?: SetorAtendimento;

  @ApiPropertyOptional({ description: 'Advogado/pessoa responsável pela demanda encaminhada.' })
  @IsOptional() @IsString()
  responsavel?: string;
}

export class ListAtendimentosQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome, matrícula ou CPF do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: DesfechoAtendimento })
  @IsOptional() @IsEnum(DesfechoAtendimento) desfecho?: DesfechoAtendimento;

  @ApiPropertyOptional({ enum: CanalAtendimento })
  @IsOptional() @IsEnum(CanalAtendimento) canal?: CanalAtendimento;

  @ApiPropertyOptional({ description: 'Data inicial do período (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataInicio?: string;

  @ApiPropertyOptional({ description: 'Data final do período (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataFim?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
