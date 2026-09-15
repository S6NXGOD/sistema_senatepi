import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength,
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

/** Teto de `passarConsultas` num PATCH (ver o campo). */
export const PASSAR_CONSULTAS_MAX = 50;

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

  /**
   * AS CONSULTAS QUE PASSAM PARA QUEM ASSUME (D16, 14/09/2026).
   *
   * OPCIONAL, e é isso que mantém a tela antiga funcionando: ausente, a troca
   * faz o que sempre fez e as consultas não mudam. `[]` é outra coisa — a
   * pessoa viu a lista e decidiu manter todas, e a decisão fica carimbada na
   * auditoria.
   *
   * 50: a produção tem uns 16 plantões por mês, de 3 horas, com consulta de
   * 1 hora. Acima disso é pedido montado à mão.
   */
  @ApiPropertyOptional({ type: [String], description: 'Ids das consultas que passam para quem assume.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PASSAR_CONSULTAS_MAX, { message: `No máximo ${PASSAR_CONSULTAS_MAX} consultas por troca.` })
  @IsUUID('all', { each: true, message: 'Consulta inválida.' })
  passarConsultas?: string[];
}

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** GET /escalas/:id/consultas?entra= — sem `entra`, só a lista (excluir, encurtar o horário). */
export class ConsultasDoPlantaoQueryDto {
  @ApiPropertyOptional({ description: 'Quem vai assumir o plantão.' })
  @IsOptional() @IsString() @IsNotEmpty()
  entra?: string;

  /**
   * O HORÁRIO NOVO, para o aviso de encurtar (15/09/2026). Opcionais: sem eles
   * a resposta é a de sempre, com `foraDoNovoHorario: null`. Só um dos dois
   * vale o outro do plantão como está.
   */
  @ApiPropertyOptional({ example: '09:00', description: 'Início do horário que o plantão vai ter.' })
  @IsOptional()
  @Matches(HORA, { message: 'Hora de início inválida (use HH:MM).' })
  horaInicio?: string;

  @ApiPropertyOptional({ example: '11:00', description: 'Fim do horário que o plantão vai ter.' })
  @IsOptional()
  @Matches(HORA, { message: 'Hora de fim inválida (use HH:MM).' })
  horaFim?: string;
}

/** GET /escalas/copia?origem=AAAA-MM&destino=AAAA-MM */
export class CopiaQueryDto {
  @ApiProperty({ example: '2026-09' })
  @Matches(MES, { message: 'Mês de origem inválido (use AAAA-MM).' })
  origem: string;

  @ApiProperty({ example: '2026-10' })
  @Matches(MES, { message: 'Mês de destino inválido (use AAAA-MM).' })
  destino: string;
}

export class CopiaItemDto {
  @ApiProperty({ description: 'O plantão da origem.' })
  @IsString() @IsNotEmpty()
  origemId: string;

  @ApiProperty({ description: 'Dia do destino (AAAA-MM-DD).', example: '2026-10-05' })
  @Matches(DATA_PURA, { message: 'Data inválida (use AAAA-MM-DD).' })
  data: string;
}

/**
 * 250 itens: 5 pessoas × 2 turnos × 23 dias úteis dá 230. É trava de
 * segurança, não regra de negócio — a produção copia uns 16 por mês.
 */
export const COPIA_MAX = 250;

/** POST /escalas/copia — só os itens marcados na prévia. */
export class CopiarEscalaDto extends CopiaQueryDto {
  @ApiProperty({ type: [CopiaItemDto] })
  @IsArray()
  @ArrayNotEmpty({ message: 'Marque ao menos um plantão para copiar.' })
  @ArrayMaxSize(COPIA_MAX, { message: `No máximo ${COPIA_MAX} plantões por cópia.` })
  @ValidateNested({ each: true }) @Type(() => CopiaItemDto)
  itens: CopiaItemDto[];
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
