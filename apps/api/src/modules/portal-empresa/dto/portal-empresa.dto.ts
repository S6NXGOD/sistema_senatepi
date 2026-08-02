import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginEmpresaDto {
  @ApiProperty({ example: '12.345.678/0001-95', description: 'Com ou sem máscara.' })
  @IsString()
  cnpj: string;

  @ApiProperty()
  @IsString() @MinLength(1)
  senha: string;
}

export class PrimeiroAcessoDto {
  @ApiProperty({
    minLength: 8,
    description: 'Substitui a senha provisória definida pela secretaria.',
  })
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value : value))
  @MinLength(8, { message: 'A nova senha deve ter ao menos 8 caracteres.' })
  @MaxLength(72, { message: 'A nova senha deve ter no máximo 72 caracteres.' })
  novaSenha: string;
}

/** Empresa autenticada, anexada à requisição pela estratégia JWT do portal. */
export interface EmpresaAutenticada {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  primeiroAcesso: boolean;
}
