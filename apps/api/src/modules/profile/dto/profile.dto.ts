import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Nome de exibição' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(120)
  nome?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  email?: string;

  @ApiPropertyOptional({ description: 'Nome de usuário (único). Envie vazio para remover.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^$|^[a-zA-Z0-9_.]{3,40}$/, {
    message: 'Usuário deve ter 3 a 40 caracteres (letras, números, ponto ou _).',
  })
  username?: string;

  @ApiPropertyOptional({ description: 'URL da foto de perfil. Envie vazio para remover.' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  senhaAtual: string;

  @ApiProperty({ description: 'Mínimo de 8 caracteres.' })
  @IsString()
  @MinLength(8, { message: 'A nova senha deve ter ao menos 8 caracteres.' })
  @MaxLength(72) // limite do bcrypt
  novaSenha: string;

  @ApiProperty()
  @IsString()
  confirmarNovaSenha: string;
}
