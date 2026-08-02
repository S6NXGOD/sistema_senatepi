import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const paraBooleano = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class ListAudienciasQueryDto {
  @ApiPropertyOptional({
    description: 'Somente audiências de processos sob minha responsabilidade.',
    default: false,
  })
  @IsOptional() @Transform(paraBooleano) @IsBoolean()
  apenasMeus?: boolean;

  @ApiPropertyOptional({ default: 20, description: 'Máximo de alertas retornados.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  limite?: number;
}

export class DispensarAudienciaDto {
  @ApiPropertyOptional({ description: 'Por que o alerta não se aplica (fica na auditoria).' })
  @IsOptional() @IsString() @MaxLength(300)
  motivo?: string;
}

/** Cria o evento na Agenda a partir do alerta, num único passo. */
export class AgendarAudienciaDto {
  @ApiProperty({ description: 'Início da audiência (ISO-8601).' })
  @IsISO8601()
  inicio: string;

  @ApiPropertyOptional({ description: 'Fim (ISO-8601). Padrão: início + 1h.' })
  @IsOptional() @IsISO8601()
  fim?: string;

  @ApiProperty({ description: 'Advogado/colaborador responsável pelo evento.' })
  @IsString() @IsNotEmpty()
  responsavelId: string;

  @ApiPropertyOptional({ description: 'Título do evento. Padrão: "Audiência — <classe>".' })
  @IsOptional() @IsString() @MaxLength(180)
  titulo?: string;

  @ApiPropertyOptional({ description: 'Local. Padrão: órgão julgador do processo.' })
  @IsOptional() @IsString() @MaxLength(180)
  local?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional() @Transform(paraBooleano) @IsBoolean()
  urgente?: boolean;

  @ApiPropertyOptional({ description: 'Notas internas (não visíveis ao filiado).' })
  @IsOptional() @IsString() @MaxLength(1000)
  observacoesInternas?: string;
}
