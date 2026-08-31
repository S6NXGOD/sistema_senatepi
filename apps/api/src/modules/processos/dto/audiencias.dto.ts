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

  /**
   * Marca a pauta como urgente — E EXIGE O MOTIVO.
   *
   * HISTÓRICO, porque eu errei duas vezes aqui e a segunda foi pior. O campo
   * chegava sozinho a `AgendaService.criar`, que exige motivo de quem marca
   * ("sem motivo, a marca não pode ser revista depois e a fila de urgências
   * perde o sentido") — então `urgente: true` dava 400 falando de um campo que
   * o formulário não tinha.
   *
   * Eu então REMOVI o campo, afirmando que ninguém o enviava. Tinha conferido o
   * arquivo errado: quem envia é `agendar-audiencia-modal.tsx`, e envia SEMPRE,
   * inclusive `false`. Com `forbidNonWhitelisted` ligado, isso derrubou o
   * agendamento inteiro do radar — não só o caso urgente.
   *
   * A correção certa era esta desde o começo: o campo volta ACOMPANHADO do
   * motivo, e os dois seguem juntos para `criar`, como em qualquer outra tela
   * que marca urgência.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional() @Transform(paraBooleano) @IsBoolean()
  urgente?: boolean;

  @ApiPropertyOptional({
    description: 'POR QUE é urgente — obrigatório quando `urgente` é verdadeiro.',
  })
  @IsOptional() @IsString() @MaxLength(300)
  urgenteMotivo?: string;

  @ApiPropertyOptional({ description: 'Notas internas (não visíveis ao filiado).' })
  @IsOptional() @IsString() @MaxLength(1000)
  observacoesInternas?: string;
}
