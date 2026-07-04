import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class DepartamentoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(80) nome: string;
}

export class CargoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(80) nome: string;
}

export class EmpresaDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(160) razaoSocial: string;
  @ApiProperty({ description: 'CNPJ (com ou sem máscara — 14 dígitos)' })
  @IsString() @IsNotEmpty() cnpj: string;
}
