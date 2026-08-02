import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsEmail, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class CriarUsuarioDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  nome: string;

  @ApiPropertyOptional({ description: 'Nome curto exibido na interface.' })
  @IsOptional() @IsString()
  nomeExibicao?: string;

  // O login é feito pelo E-MAIL — não existe "nome de usuário" no sistema.
  @ApiProperty({ description: 'E-mail (usado como login).' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: 'Inscrição na OAB (só o número).' })
  @IsOptional() @IsString()
  oab?: string;

  @ApiPropertyOptional({ description: 'UF da OAB (ex.: PI).' })
  @IsOptional() @IsString()
  oabUf?: string;

  @ApiProperty({ minLength: 6 })
  @IsString() @MinLength(6)
  senha: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  ativo?: boolean;

  @ApiPropertyOptional({ description: 'Matriz de permissões por módulo (override do preset).' })
  @IsOptional() @IsObject()
  permissoes?: Record<string, string>;
}

export class AtualizarUsuarioDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty()
  nome?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  nomeExibicao?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  oab?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  oabUf?: string;

  @ApiPropertyOptional({ minLength: 6, description: 'Só informe para redefinir a senha.' })
  @IsOptional() @IsString() @MinLength(6)
  senha?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional() @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  ativo?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsObject()
  permissoes?: Record<string, string>;
}
