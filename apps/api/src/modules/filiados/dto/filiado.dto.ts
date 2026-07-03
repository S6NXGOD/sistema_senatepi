import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EstadoCivil,
  FormacaoProfissional,
  Sexo,
  SituacaoFiliado,
} from '@prisma/client';

export class VinculoDto {
  @ApiProperty() @IsString() empresa: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() matricula?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() ordem?: number;
}

export class CreateFiliadoDto {
  // Dados pessoais
  @ApiProperty() @IsString() nomeCompleto: string;
  @ApiProperty() @IsString() cpf: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rg?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ufRg?: string;
  @ApiProperty() @IsDateString() dataNascimento: string;
  @ApiPropertyOptional({ enum: Sexo }) @IsOptional() @IsEnum(Sexo) sexo?: Sexo;
  @ApiPropertyOptional({ enum: EstadoCivil })
  @IsOptional() @IsEnum(EstadoCivil) estadoCivil?: EstadoCivil;
  @ApiPropertyOptional() @IsOptional() @IsString() naturalidade?: string;

  // Contato
  @ApiPropertyOptional() @IsOptional() @IsString() telefonePrincipal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telefoneSecundario?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;

  // Endereço
  @ApiPropertyOptional() @IsOptional() @IsString() cep?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endereco?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complemento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bairro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cidade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() estado?: string;

  // Profissional
  @ApiPropertyOptional({ enum: FormacaoProfissional })
  @IsOptional() @IsEnum(FormacaoProfissional) formacao?: FormacaoProfissional;
  @ApiPropertyOptional({ description: 'Descrição quando formação = OUTRO' })
  @IsOptional() @IsString() formacaoOutro?: string;
  @ApiPropertyOptional({ example: 'COREN-PI 123456-ENF', description: 'Formato: COREN-PI 000000-SSS' })
  @IsOptional()
  @Matches(/^COREN-PI \d{1,6}-[A-Z]{3}$/, {
    message: 'COREN inválido. Use o formato COREN-PI 000000-SSS (ex.: COREN-PI 123456-ENF).',
  })
  numeroCoren?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dataAdmissao?: string;

  @ApiPropertyOptional({ type: [VinculoDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VinculoDto)
  vinculos?: VinculoDto[];
}

export class UpdateFiliadoDto extends PartialType(CreateFiliadoDto) {
  @ApiPropertyOptional({ enum: SituacaoFiliado })
  @IsOptional() @IsEnum(SituacaoFiliado) situacao?: SituacaoFiliado;
}

export class ChangeSituacaoDto {
  @ApiProperty({ enum: SituacaoFiliado })
  @IsEnum(SituacaoFiliado) situacao: SituacaoFiliado;
  @ApiPropertyOptional() @IsOptional() @IsString() motivo?: string;
}

export class ListFiliadosQueryDto {
  @ApiPropertyOptional({ description: 'Busca livre (nome, CPF ou matrícula)' })
  @IsOptional() @IsString() busca?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nome?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cpf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() coren?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cidade?: string;
  @ApiPropertyOptional({ enum: SituacaoFiliado })
  @IsOptional() @IsEnum(SituacaoFiliado) situacao?: SituacaoFiliado;
  @ApiPropertyOptional({ description: 'Data de filiação inicial (YYYY-MM-DD)' })
  @IsOptional() @IsString() dataInicio?: string;
  @ApiPropertyOptional({ description: 'Data de filiação final (YYYY-MM-DD)' })
  @IsOptional() @IsString() dataFim?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() pageSize?: number;
}
