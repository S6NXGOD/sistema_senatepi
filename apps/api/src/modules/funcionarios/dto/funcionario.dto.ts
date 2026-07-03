import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { StatusFuncionario, TipoFuncionario } from '@prisma/client';

export class CreateFuncionarioDto {
  // Dados pessoais
  @ApiProperty() @IsString() nome: string;
  @ApiProperty() @IsString() cpf: string;
  @ApiProperty() @IsDateString() dataNascimento: string;
  @ApiProperty() @IsString() telefone: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;

  // Dados funcionais
  @ApiProperty() @IsDateString() dataAdmissao: string;
  @ApiProperty() @IsString() cargo: string;
  @ApiProperty() @IsString() departamento: string;
  @ApiProperty({ enum: TipoFuncionario }) @IsEnum(TipoFuncionario) tipo: TipoFuncionario;
  @ApiPropertyOptional({ enum: StatusFuncionario })
  @IsOptional() @IsEnum(StatusFuncionario) status?: StatusFuncionario;

  // Endereço
  @ApiPropertyOptional() @IsOptional() @IsString() cep?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endereco?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complemento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bairro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cidade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() estado?: string;
}

export class UpdateFuncionarioDto extends PartialType(CreateFuncionarioDto) {}

export class ChangeStatusDto {
  @ApiProperty({ enum: StatusFuncionario }) @IsEnum(StatusFuncionario) status: StatusFuncionario;
  @ApiPropertyOptional() @IsOptional() @IsString() motivo?: string;
}

export class ListFuncionariosQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() nome?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cpf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cargo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() departamento?: string;
  @ApiPropertyOptional({ enum: TipoFuncionario })
  @IsOptional() @IsEnum(TipoFuncionario) tipo?: TipoFuncionario;
  @ApiPropertyOptional({ enum: StatusFuncionario })
  @IsOptional() @IsEnum(StatusFuncionario) status?: StatusFuncionario;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() pageSize?: number;
}
