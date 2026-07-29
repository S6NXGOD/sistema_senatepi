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

  @ApiProperty({ description: 'Login do usuário.' })
  @IsString() @IsNotEmpty()
  username: string;

  @ApiProperty() @IsEmail()
  email: string;

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

  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty()
  username?: string;

  @ApiPropertyOptional() @IsOptional() @IsEmail()
  email?: string;

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
