import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty, IsArray, IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional,
  IsString, Min, MinLength, ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CanalAtendimento, DesfechoAtendimento, StatusAtendimento, TipoEncaminhamento,
} from '@prisma/client';

/** Criação: só o essencial da triagem — o desfecho é registrado depois. */
export class CreateAtendimentoDto {
  @ApiProperty({ description: 'Filiado ao qual o atendimento pertence.' })
  @IsString() @IsNotEmpty()
  filiadoId: string;

  @ApiProperty({ enum: CanalAtendimento })
  @IsEnum(CanalAtendimento)
  canal: CanalAtendimento;

  @ApiProperty({ description: 'Descrição da demanda.' })
  @IsString() @MinLength(3, { message: 'Descreva a demanda.' })
  descricao: string;
}

/** Registro do desfecho (resultado) da triagem. */
export class RegistrarDesfechoDto {
  @ApiProperty({ enum: DesfechoAtendimento })
  @IsEnum(DesfechoAtendimento)
  resultado: DesfechoAtendimento;

  @ApiPropertyOptional({ description: 'O que foi resolvido (RESOLVIDO_ATO) ou nota.' })
  @IsOptional() @IsString()
  desfechoObs?: string;

  // ---- Só quando ENCAMINHADO ----
  @ApiPropertyOptional({ type: [String], description: 'Advogado(s) responsável(is).' })
  @ValidateIf((o) => o.resultado === DesfechoAtendimento.ENCAMINHADO)
  @IsArray() @ArrayNotEmpty({ message: 'Selecione ao menos um advogado.' }) @IsString({ each: true })
  advogadoIds?: string[];

  @ApiPropertyOptional({ enum: TipoEncaminhamento })
  @ValidateIf((o) => o.resultado === DesfechoAtendimento.ENCAMINHADO)
  @IsEnum(TipoEncaminhamento, { message: 'Informe o tipo de encaminhamento.' })
  tipoEncaminhamento?: TipoEncaminhamento;

  @ApiPropertyOptional({ description: 'Processo vinculado (obrigatório em ANDAMENTO_PROCESSO).' })
  @ValidateIf((o) => o.tipoEncaminhamento === TipoEncaminhamento.ANDAMENTO_PROCESSO)
  @IsString() @IsNotEmpty({ message: 'Selecione o processo existente.' })
  processoId?: string;

  @ApiPropertyOptional({ description: 'Data/hora da consulta (ISO). Vazio → amanhã.' })
  @IsOptional() @IsDateString()
  dataConsulta?: string;
}

export class MudarStatusAtendimentoDto {
  @ApiProperty({ enum: StatusAtendimento })
  @IsEnum(StatusAtendimento)
  status: StatusAtendimento;
}

export class ListAtendimentosQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome, matrícula ou CPF do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: DesfechoAtendimento })
  @IsOptional() @IsEnum(DesfechoAtendimento) desfecho?: DesfechoAtendimento;

  @ApiPropertyOptional({ enum: StatusAtendimento })
  @IsOptional() @IsEnum(StatusAtendimento) status?: StatusAtendimento;

  @ApiPropertyOptional({ enum: CanalAtendimento })
  @IsOptional() @IsEnum(CanalAtendimento) canal?: CanalAtendimento;

  @ApiPropertyOptional({ description: 'Data inicial (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Data final (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataFim?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
