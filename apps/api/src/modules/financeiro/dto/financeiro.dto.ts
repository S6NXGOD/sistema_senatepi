import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CriarContaBancariaDto {
  @ApiProperty({ example: 'Caixa do Sindicato' })
  @IsString() @IsNotEmpty()
  nome: string;

  @ApiPropertyOptional({ example: 'Banco do Brasil' })
  @IsOptional() @IsString()
  instituicao?: string;
}
