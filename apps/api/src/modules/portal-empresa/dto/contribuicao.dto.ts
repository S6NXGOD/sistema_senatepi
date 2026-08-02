import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, Max, Min, IsNumber } from 'class-validator';

export class GerarContribuicaoDto {
  @ApiProperty({ example: '2026-07', description: 'Competência no formato AAAA-MM.' })
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'Informe a competência no formato AAAA-MM (ex.: 2026-07).',
  })
  mesReferencia: string;

  @ApiProperty({ example: 1500.5, description: 'Valor total declarado, em reais.' })
  // Aceita "1500,50" (como o usuário digita) e "1500.50" (JSON).
  @Transform(({ value }) => {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return value;
    const limpo = value.trim().replace(/\./g, '').replace(',', '.');
    const n = Number(limpo);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido — use no máximo 2 casas decimais.' })
  @Min(0.01, { message: 'O valor declarado precisa ser maior que zero.' })
  @Max(99_999_999.99, { message: 'Valor acima do limite permitido.' })
  valorDeclarado: number;
}

export class ListarContribuicoesQueryDto {
  @ApiPropertyOptional({ description: 'Filtra por competência (AAAA-MM).' })
  @IsOptional() @IsString()
  mesReferencia?: string;
}
