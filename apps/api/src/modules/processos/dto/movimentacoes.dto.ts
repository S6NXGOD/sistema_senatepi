import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';
import { StatusProcesso } from '@prisma/client';

/** Chaves de paleta aceitas (espelham o front). */
export const CORES_ANDAMENTO = [
  'slate', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose',
  'red', 'orange', 'amber', 'emerald', 'teal', 'cyan',
] as const;

// ---------------------------------------------------------------------------
// Tipos de movimentação (cadastráveis)
// ---------------------------------------------------------------------------

export class CriarTipoAndamentoDto {
  @ApiProperty() @IsString() @MinLength(2, { message: 'Informe o nome do tipo.' }) @MaxLength(40)
  nome: string;

  @ApiPropertyOptional({ enum: CORES_ANDAMENTO }) @IsOptional() @IsString()
  cor?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  ordem?: number;
}

export class AtualizarTipoAndamentoDto extends PartialType(CriarTipoAndamentoDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  ativo?: boolean;
}

// ---------------------------------------------------------------------------
// Movimentação interna (andamento registrado pela equipe)
// ---------------------------------------------------------------------------

export class RegistrarMovimentacaoDto {
  @ApiProperty({ description: 'Slug do tipo de movimentação (cadastrável).' })
  @IsString() @MinLength(1)
  tipo: string;

  @ApiProperty({ description: 'O que aconteceu no processo.' })
  @IsString() @MinLength(3, { message: 'Descreva a movimentação.' }) @MaxLength(5000)
  descricao: string;

  /**
   * Quando o ato REALMENTE aconteceu, se diferente de hoje. Sem isto, a
   * audiência de quarta lançada na sexta apareceria na sexta na linha do tempo.
   * O carimbo de auditoria (`createdAt`) continua sendo a hora do registro.
   */
  @ApiPropertyOptional({
    description: 'Data do fato (ISO). Omitida, a movimentação vale pela data do registro.',
  })
  @IsOptional() @IsDateString({}, { message: 'Data do fato inválida.' })
  dataFato?: string;

  @ApiPropertyOptional({ description: 'Nota interna — não sai em extratos ao filiado.' })
  @IsOptional() @IsBoolean()
  notaInterna?: boolean;

  @ApiPropertyOptional({ enum: StatusProcesso, description: 'Muda o status do processo junto com o registro.' })
  @IsOptional() @IsEnum(StatusProcesso)
  novoStatus?: StatusProcesso;

  @ApiPropertyOptional({ description: 'Id de um anexo já enviado (POST /anexos).' })
  @IsOptional() @IsString()
  anexoId?: string;
}

// ---------------------------------------------------------------------------
// As duas mãos sobre o andamento do tribunal (17/09/2026)
// ---------------------------------------------------------------------------

/**
 * "JÁ CUIDEI" — a dispensa de GENTE sobre um andamento.
 *
 * O motivo é opcional de propósito, e é a mesma escolha já feita no radar de
 * audiências: exigir justificativa para dizer "isto eu já resolvi" transforma
 * um toque em formulário, e o que acontece então é que ninguém marca nada — o
 * andamento fica pendente para sempre e o aviso perde o sentido. Quando vem,
 * o motivo é ouro: é ele que diz onde o robô errou.
 */
export class JaCuideiDoAndamentoDto {
  @ApiPropertyOptional({ description: 'Por que não há o que fazer (ex.: "prazo é da outra parte").' })
  @IsOptional() @IsString() @MaxLength(300, { message: 'Motivo muito longo — resuma em uma linha.' })
  motivo?: string;
}
