import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty, IsArray, IsDateString, IsNotEmpty, IsOptional, IsString, Matches, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class EscalaItemDto {
  @ApiProperty({ description: 'Data (YYYY-MM-DD).' })
  @IsDateString()
  data: string;

  @ApiProperty({ example: '08:00' })
  @Matches(HORA, { message: 'Hora de início inválida (use HH:MM).' })
  horaInicio: string;

  @ApiProperty({ example: '17:00' })
  @Matches(HORA, { message: 'Hora de fim inválida (use HH:MM).' })
  horaFim: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  observacao?: string;
}

export class CriarEscalasDto {
  @ApiProperty({ description: 'Advogado (usuário) escalado.' })
  @IsString() @IsNotEmpty()
  advogadoId: string;

  @ApiProperty({ type: [EscalaItemDto], description: 'Uma ou mais datas/horários.' })
  @IsArray() @ArrayNotEmpty()
  @ValidateNested({ each: true }) @Type(() => EscalaItemDto)
  itens: EscalaItemDto[];
}

export class ListEscalasQueryDto {
  @ApiPropertyOptional({ description: 'Mês no formato YYYY-MM (padrão: mês atual).' })
  @IsOptional() @IsString()
  mes?: string;

  @ApiPropertyOptional({ description: 'Filtra por advogado.' })
  @IsOptional() @IsString()
  advogadoId?: string;
}
