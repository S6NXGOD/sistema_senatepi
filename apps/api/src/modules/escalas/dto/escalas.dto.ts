import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * DATA PURA, e não `IsDateString`.
 *
 * `IsDateString` aceita "2026-09-15T23:00:00-03:00", que `new Date` leva para
 * 16/09 em UTC: a escala andaria um dia sem ninguém ter pedido. A coluna é
 * `@db.Date`, e a tela sempre manda o dia puro. (Que o dia EXISTA — 31/02 casa
 * com a regex — o serviço confere com `ehDataPuraValida`.)
 */
const DATA_PURA = /^\d{4}-\d{2}-\d{2}$/;

/** Uma observação é uma linha ("Substitui a Dra. X"), não um documento. */
export const OBSERVACAO_MAX = 500;

/**
 * 62 itens: dois meses de dias corridos. A repetição semanal da tela gera no
 * máximo uns 45 (todos os dias úteis de dois meses); acima disso é engano de
 * quem montou o pedido, ou alguém martelando a API.
 */
export const ITENS_MAX = 62;

export class EscalaItemDto {
  @ApiProperty({ description: 'Data (YYYY-MM-DD).', example: '2026-09-15' })
  @Matches(DATA_PURA, { message: 'Data inválida (use AAAA-MM-DD).' })
  data: string;

  @ApiProperty({ example: '08:00' })
  @Matches(HORA, { message: 'Hora de início inválida (use HH:MM).' })
  horaInicio: string;

  @ApiProperty({ example: '17:00' })
  @Matches(HORA, { message: 'Hora de fim inválida (use HH:MM).' })
  horaFim: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  @MaxLength(OBSERVACAO_MAX, { message: `A observação passa de ${OBSERVACAO_MAX} caracteres.` })
  observacao?: string;
}

export class CriarEscalasDto {
  @ApiProperty({ description: 'Pessoa (usuário) escalada.' })
  @IsString() @IsNotEmpty()
  advogadoId: string;

  @ApiProperty({ type: [EscalaItemDto], description: 'Uma ou mais datas/horários.' })
  @IsArray() @ArrayNotEmpty()
  @ArrayMaxSize(ITENS_MAX, { message: `No máximo ${ITENS_MAX} datas por vez.` })
  @ValidateNested({ each: true }) @Type(() => EscalaItemDto)
  itens: EscalaItemDto[];
}

/**
 * CORRIGIR OU TROCAR UM PLANTÃO.
 *
 * A troca é só isto: mudar `advogadoId`. Não há fluxo de pedido e aprovação —
 * com cinco advogados a troca se combina no corredor e alguém registra.
 *
 * A DATA NÃO MUDA AQUI, de propósito: plantão em outro dia é outro plantão, e a
 * tela o cria como tal. `observacao: null` apaga a observação.
 */
export class AtualizarEscalaDto {
  @ApiPropertyOptional({ description: 'Nova pessoa de plantão (troca).' })
  @IsOptional() @IsString() @IsNotEmpty()
  advogadoId?: string;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @Matches(HORA, { message: 'Hora de início inválida (use HH:MM).' })
  horaInicio?: string;

  @ApiPropertyOptional({ example: '12:00' })
  @IsOptional()
  @Matches(HORA, { message: 'Hora de fim inválida (use HH:MM).' })
  horaFim?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @IsString()
  @MaxLength(OBSERVACAO_MAX, { message: `A observação passa de ${OBSERVACAO_MAX} caracteres.` })
  observacao?: string | null;
}

export class ListEscalasQueryDto {
  @ApiPropertyOptional({ description: 'Mês no formato YYYY-MM (padrão: mês atual em Teresina).' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mês inválido (use AAAA-MM).' })
  mes?: string;

  @ApiPropertyOptional({ description: 'Filtra por advogado.' })
  @IsOptional() @IsString()
  advogadoId?: string;
}
