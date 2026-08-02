import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Nome completo (registro).' })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'O nome deve ter ao menos 2 caracteres.' })
  @MaxLength(120)
  nome?: string;

  @ApiPropertyOptional({ description: 'Nome curto exibido na interface. Envie vazio para remover.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nomeExibicao?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  email?: string;

  // A foto de perfil é definida APENAS por upload (POST /profile/avatar) e
  // removida por DELETE /profile/avatar — não aceitamos URL informada à mão.
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
