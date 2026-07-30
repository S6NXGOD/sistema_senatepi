import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Chaves de paleta aceitas para a cor do tipo (espelham o front). */
export const CORES_TIPO = [
  'slate', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose',
  'red', 'orange', 'amber', 'emerald', 'teal', 'cyan',
] as const;

export class CriarTipoEventoDto {
  @ApiProperty() @IsString() @MinLength(2, { message: 'Informe o nome do tipo.' }) @MaxLength(40)
  nome: string;

  @ApiPropertyOptional({ enum: CORES_TIPO }) @IsOptional() @IsString()
  cor?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  ordem?: number;
}

export class AtualizarTipoEventoDto extends PartialType(CriarTipoEventoDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  ativo?: boolean;
}
