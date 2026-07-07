import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { FormacaoColonia, StatusTemporada } from '@prisma/client';
import { IsCorenParaFormacao } from '../../../common/validators/coren.validator';

export class StatusTemporadaDto {
  @ApiProperty({ enum: StatusTemporada })
  @IsEnum(StatusTemporada)
  status: StatusTemporada;
}

/** Dados de checkout comuns à reserva direta, à fila de sorteio e à alocação manual. */
export class CheckoutDto {
  @ApiProperty() @IsString() @MinLength(3) nomeCompleto: string;
  @ApiProperty() @IsString() cpf: string;
  @ApiProperty() @IsString() telefone: string;
  // COREN obrigatório e no formato correspondente à formação (ex.: 123456-ENF).
  @ApiProperty({ example: '123456-ENF', description: 'COREN no formato <número (1–6 díg.)>-<ENF|TE|AE>, conforme a formação.' })
  @IsCorenParaFormacao()
  coren: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiProperty({ enum: FormacaoColonia }) @IsEnum(FormacaoColonia) formacao: FormacaoColonia;
  @ApiProperty() @IsString() localTrabalho1: string;
  @ApiPropertyOptional() @IsOptional() @IsString() localTrabalho2?: string;
  @ApiProperty() @IsString() cidade: string;
  @ApiProperty() @IsString() estado: string;

  // LGPD (Lei 13.709/2018) — consentimentos obrigatórios
  @ApiProperty({ description: 'Aceite do Termo de No-Show (obrigatório)' })
  @IsBoolean() aceiteTermoNoShow: boolean;
  @ApiProperty({ description: 'Consentimento de tratamento de dados (LGPD) (obrigatório)' })
  @IsBoolean() consentimentoLgpd: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() termoVersao?: string;
}

export class CreateReservaDiretaDto extends CheckoutDto {
  // Data de nascimento é obrigatória no checkout público (formato ISO: AAAA-MM-DD).
  @ApiProperty({ example: '1990-05-20', description: 'Data de nascimento (ISO 8601).' })
  @IsDateString() dataNascimento: string;
  @ApiProperty({ description: 'Slug (link público) da campanha — deve estar ATIVA.' })
  @IsString() @IsNotEmpty() slug: string;
  @ApiProperty() @IsString() loteId: string;
  @ApiProperty() @IsString() quartoId: string;
}

export class EntrarSorteioDto extends CheckoutDto {
  // Data de nascimento é obrigatória no checkout público (formato ISO: AAAA-MM-DD).
  @ApiProperty({ example: '1990-05-20', description: 'Data de nascimento (ISO 8601).' })
  @IsDateString() dataNascimento: string;
  @ApiProperty({ description: 'Slug (link público) da campanha — deve estar ATIVA.' })
  @IsString() @IsNotEmpty() slug: string;
  @ApiProperty() @IsString() loteId: string;
}

export class AlocacaoManualDto extends CheckoutDto {
  // Ato administrativo: a data de nascimento é opcional na alocação manual.
  @ApiPropertyOptional({ example: '1990-05-20', description: 'Data de nascimento (ISO 8601).' })
  @IsOptional() @IsDateString() dataNascimento?: string;
  @ApiProperty() @IsString() loteId: string;
  @ApiPropertyOptional({ description: 'Quarto a alocar (padrão: quarto 6)' })
  @IsOptional() @IsString() quartoId?: string;
}

export class CancelarReservaDto {
  @ApiPropertyOptional() @IsOptional() @IsString() motivo?: string;
}

export class SincronizarFiliadoDto {
  @ApiProperty({
    type: [String],
    description: 'Campos escolhidos para atualizar no cadastro (ex.: ["nomeCompleto","telefonePrincipal"]).',
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'Selecione ao menos um campo para atualizar.' })
  @IsString({ each: true })
  campos: string[];

  @ApiPropertyOptional({ description: 'Filiado escolhido para atualizar (quando há vários com o mesmo nome).' })
  @IsOptional() @IsString() filiadoId?: string;
}

export class DataSorteioDto {
  @ApiPropertyOptional({
    description: 'Data/hora do sorteio público (ISO 8601). Envie null para limpar.',
    example: '2026-07-07T19:30:00-03:00',
  })
  @IsOptional()
  @ValidateIf((o) => o.dataSorteio != null)
  @IsDateString()
  dataSorteio?: string | null;
}
