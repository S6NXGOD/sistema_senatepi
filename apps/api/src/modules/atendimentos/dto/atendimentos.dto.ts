import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNotEmpty,
  IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  AssuntoAtendimento, CanalAtendimento, DesfechoAtendimento, StatusAtendimento, TipoEncaminhamento,
} from '@prisma/client';

/** Criação: só o essencial da triagem — o desfecho é registrado depois. */
export class CreateAtendimentoDto {
  @ApiProperty({ description: 'Filiado ao qual o atendimento pertence.' })
  @IsString() @IsNotEmpty()
  filiadoId: string;

  @ApiProperty({ enum: CanalAtendimento })
  @IsEnum(CanalAtendimento)
  canal: CanalAtendimento;

  /**
   * SOBRE O QUE É A DEMANDA.
   *
   * O atendimento sabia COMO a pessoa chegou, QUEM atendeu e COMO terminou — e
   * não sabia sobre o quê. "As pessoas vêm mais por nível ou por salário?" não
   * tinha resposta, e a descrição livre dos registros existentes confirma:
   * cinco dos sete dizem apenas "Consulta Jurídica".
   *
   * OPCIONAL de propósito. Obrigar a classificar no balcão, com o filiado
   * esperando, produz o primeiro item da lista em toda ficha — e um campo
   * preenchido no automático mente pior que um campo vazio. O relatório conta
   * os não informados à parte.
   */
  @ApiPropertyOptional({ enum: AssuntoAtendimento, description: 'Assunto da demanda.' })
  @IsOptional() @IsEnum(AssuntoAtendimento) assunto?: AssuntoAtendimento;

  @ApiProperty({ description: 'Descrição da demanda.' })
  @IsString() @MinLength(3, { message: 'Descreva a demanda.' })
  descricao: string;

  /**
   * A TRIAGEM É A PORTA: é no balcão que se descobre que o caso tem prazo curto.
   * Era o único dos três lugares (triagem, agenda, processo) sem como registrar
   * isso — a informação existia na cabeça de quem atendeu e morria ali.
   * A urgência marcada aqui é HERDADA pela atividade e pelo caso que nascerem
   * desta demanda.
   */
  @ApiPropertyOptional({ description: 'Marca a demanda como urgente.' })
  @IsOptional() @IsBoolean() urgente?: boolean;

  @ApiPropertyOptional({ description: 'POR QUE é urgente — obrigatório ao marcar.' })
  @IsOptional() @IsString() @MaxLength(300) urgenteMotivo?: string;
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

  @ApiPropertyOptional({ enum: AssuntoAtendimento })
  @IsOptional() @IsEnum(AssuntoAtendimento) assunto?: AssuntoAtendimento;

  @ApiPropertyOptional({ description: 'Data inicial (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Data final (YYYY-MM-DD).' })
  @IsOptional() @IsString() dataFim?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}
