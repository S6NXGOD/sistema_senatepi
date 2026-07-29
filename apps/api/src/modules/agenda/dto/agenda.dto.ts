import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import {
  StatusCompromisso,
  TipoCompromisso,
} from '@prisma/client';

export class CreateCompromissoDto {
  @ApiProperty() @IsString() @MinLength(2, { message: 'Informe um título.' })
  titulo: string;

  @ApiProperty({ enum: TipoCompromisso })
  @IsEnum(TipoCompromisso)
  tipo: TipoCompromisso;

  @ApiPropertyOptional({ enum: StatusCompromisso })
  @IsOptional() @IsEnum(StatusCompromisso)
  status?: StatusCompromisso;

  @ApiProperty({ description: 'Início (ISO 8601).' })
  @IsDateString()
  inicio: string;

  @ApiProperty({ description: 'Fim (ISO 8601).' })
  @IsDateString()
  fim: string;

  @ApiPropertyOptional({ description: 'Local (ex.: 1ª Vara do Trabalho de Teresina).' })
  @IsOptional() @IsString()
  local?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  descricao?: string;

  @ApiPropertyOptional({ description: 'Notas internas — não visíveis ao filiado.' })
  @IsOptional() @IsString()
  observacoesInternas?: string;

  @ApiPropertyOptional({ description: 'Marca o compromisso como urgente.' })
  @IsOptional() @IsBoolean()
  urgente?: boolean;

  @ApiProperty({ description: 'Usuário responsável (advogado/colaborador).' })
  @IsString() @IsNotEmpty()
  responsavelId: string;

  @ApiPropertyOptional({ description: 'Filiado vinculado (rastreabilidade).' })
  @IsOptional() @IsString()
  filiadoId?: string;

  @ApiPropertyOptional({ description: 'Atendimento/triagem de origem (rastreabilidade).' })
  @IsOptional() @IsString()
  atendimentoId?: string;

  @ApiPropertyOptional({ description: 'Processo vinculado (DATAJUD).' })
  @IsOptional() @IsString()
  processoId?: string;
}

export class UpdateCompromissoDto extends PartialType(CreateCompromissoDto) {}

export class MudarStatusDto {
  @ApiProperty({ enum: StatusCompromisso })
  @IsEnum(StatusCompromisso)
  status: StatusCompromisso;
}

export class ListCompromissosQueryDto {
  @ApiPropertyOptional({ enum: StatusCompromisso })
  @IsOptional() @IsEnum(StatusCompromisso) status?: StatusCompromisso;

  @ApiPropertyOptional({ enum: TipoCompromisso })
  @IsOptional() @IsEnum(TipoCompromisso) tipo?: TipoCompromisso;

  @ApiPropertyOptional() @IsOptional() @IsString() responsavelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() filiadoId?: string;
  @ApiPropertyOptional({ description: 'Busca por título ou nome do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ description: 'Início do período (ISO/data).' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Fim do período (ISO/data).' })
  @IsOptional() @IsString() dataFim?: string;
}
