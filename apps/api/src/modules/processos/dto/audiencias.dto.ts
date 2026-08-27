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

  /*
   * `urgente` VIVIA AQUI e foi removido.
   *
   * Era um campo que só sabia falhar: `agendar` o repassa a `AgendaService.criar`,
   * que exige MOTIVO de quem marca urgência ("sem motivo, a marca não pode ser
   * revista depois e a fila de urgências perde o sentido"). Este DTO nunca teve
   * campo de motivo, então `urgente: true` resultava sempre em 400 — e a
   * mensagem falava de um campo que este formulário não tem.
   *
   * Ninguém enviava (conferido no app), então a remoção não quebra tela alguma.
   * Se um dia a marca fizer sentido ao agendar pelo radar, ela volta ACOMPANHADA
   * de `urgenteMotivo` — nunca sozinha.
   */

  @ApiPropertyOptional({ description: 'Notas internas (não visíveis ao filiado).' })
  @IsOptional() @IsString() @MaxLength(1000)
  observacoesInternas?: string;
}
