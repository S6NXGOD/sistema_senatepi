import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@senatepi.org.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'sua-senha' })
  @IsString()
  @MinLength(6)
  senha: string;

  @ApiProperty({ required: false, description: 'Lembrar acesso (refresh mais longo)' })
  @IsOptional()
  @IsBoolean()
  lembrar?: boolean;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  novaSenha: string;
}
