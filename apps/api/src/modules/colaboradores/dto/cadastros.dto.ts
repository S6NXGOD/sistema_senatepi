import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Listas de apoio de Colaboradores.
 *
 * `EmpresaDto` saiu daqui: empresa é entidade do módulo Patronal, com CNPJ
 * validado, consulta à Receita e credencial de portal — o cadastro resumido a
 * "razão social + CNPJ" contornava tudo isso.
 */
export class DepartamentoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(80) nome: string;
}

export class CargoDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MinLength(2) @MaxLength(80) nome: string;
}

/** Edição: renomear e/ou ocultar. Ambos opcionais — a tela manda só o que mudou. */
export class AtualizarDepartamentoDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(80) nome?: string;

  @ApiPropertyOptional({
    description: 'false aposenta o registro: ele some dos formulários e continua no histórico.',
  })
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export class AtualizarCargoDto extends AtualizarDepartamentoDto {}
