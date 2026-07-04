import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { StatusColaborador, TipoVinculo } from '@prisma/client';

export class CreateColaboradorDto {
  // Universais
  @ApiProperty() @IsString() @IsNotEmpty() nome: string;
  // LGPD (Lei 13.709/2018): CPF é o único identificador sensível coletado.
  @ApiProperty() @IsString() @IsNotEmpty() cpf: string;
  @ApiProperty({ enum: TipoVinculo }) @IsEnum(TipoVinculo) tipoVinculo: TipoVinculo;
  @ApiPropertyOptional({ enum: StatusColaborador })
  @IsOptional() @IsEnum(StatusColaborador) status?: StatusColaborador;

  @ApiPropertyOptional() @IsOptional() @IsString() fotoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dataNascimento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telefone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dataAdmissao?: string;

  // Endereço
  @ApiPropertyOptional() @IsOptional() @IsString() cep?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logradouro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bairro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cidade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2) uf?: string;

  // Relacionamentos obrigatórios
  @ApiProperty() @IsString() @IsNotEmpty() cargoId: string;
  @ApiProperty() @IsString() @IsNotEmpty() departamentoId: string;
  // Condicional (PJ/Terceirizado)
  @ApiPropertyOptional() @IsOptional() @IsString() empresaId?: string;

  // Campos dinâmicos
  @ApiPropertyOptional() @IsOptional() @IsDateString() vencimentoContrato?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instituicaoEnsino?: string;
}

export class UpdateColaboradorDto extends PartialType(CreateColaboradorDto) {}

export class AlterarStatusColaboradorDto {
  @ApiProperty({ enum: StatusColaborador })
  @IsEnum(StatusColaborador) status: StatusColaborador;
  @ApiPropertyOptional({ description: 'Obrigatório em INATIVO/AFASTADO' })
  @IsOptional() @IsString() motivo?: string;
  @ApiPropertyOptional({ description: 'Obrigatório em DESLIGADO (YYYY-MM-DD)' })
  @IsOptional() @IsDateString() dataDesligamento?: string;
  @ApiPropertyOptional({ description: 'Obrigatório em FERIAS — dias até o retorno automático' })
  @IsOptional() diasFerias?: number;
}

export class ListColaboradoresQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou CPF' })
  @IsOptional() @IsString() busca?: string;
  @ApiPropertyOptional({ enum: StatusColaborador })
  @IsOptional() @IsEnum(StatusColaborador) status?: StatusColaborador;
  @ApiPropertyOptional() @IsOptional() @IsString() departamentoId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() pageSize?: number;
}
