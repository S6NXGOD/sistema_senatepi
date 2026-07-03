import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { EstrategiaDuplicado, EstrategiaMatricula } from '@prisma/client';

export class EditarLinhaDto {
  @ApiPropertyOptional() @IsOptional() @IsString() cpf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nomeCompleto?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() matricula?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telefonePrincipal?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() empresa?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() situacao?: string;
}

export class ConfirmarImportacaoDto {
  @ApiPropertyOptional({ enum: EstrategiaDuplicado, default: EstrategiaDuplicado.IGNORAR })
  @IsOptional()
  @IsEnum(EstrategiaDuplicado)
  estrategia?: EstrategiaDuplicado;

  @ApiPropertyOptional({ enum: EstrategiaMatricula, default: EstrategiaMatricula.REGENERAR })
  @IsOptional()
  @IsEnum(EstrategiaMatricula)
  estrategiaMatricula?: EstrategiaMatricula;

  @ApiPropertyOptional({ description: 'Importar apenas os registros válidos (ignora linhas com erro)' })
  @IsOptional()
  @IsBoolean()
  importarSomenteValidos?: boolean;

  @ApiPropertyOptional({ description: 'Importar CPFs inválidos (dígito verificador) mesmo assim' })
  @IsOptional()
  @IsBoolean()
  permitirCpfInvalido?: boolean;
}
