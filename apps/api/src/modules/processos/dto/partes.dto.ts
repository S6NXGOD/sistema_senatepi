import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength,
} from 'class-validator';
import { PoloProcesso, TipoParteExterna } from '@prisma/client';

// ---------------------------------------------------------------------------
// Cadastro de partes externas (empresa ré, município, pessoa física…)
// ---------------------------------------------------------------------------

export class CriarParteExternaDto {
  @ApiProperty({ enum: TipoParteExterna })
  @IsEnum(TipoParteExterna)
  tipo: TipoParteExterna;

  @ApiProperty({ description: 'Razão social (PJ) ou nome completo (PF).' })
  @IsString() @MinLength(2, { message: 'Informe o nome da parte.' }) @MaxLength(180)
  nome: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180)
  nomeFantasia?: string;

  @ApiPropertyOptional({ description: 'CPF (11) ou CNPJ (14) — com ou sem pontuação.' })
  @IsOptional() @IsString()
  documento?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) telefone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) cidade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2) uf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) observacoes?: string;
}

export class AtualizarParteExternaDto extends PartialType(CriarParteExternaDto) {
  @ApiPropertyOptional({ description: 'Desativar preserva o histórico e some dos seletores.' })
  @IsOptional() @IsBoolean()
  ativo?: boolean;
}

export class ListParteExternaQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome, nome fantasia ou CPF/CNPJ.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: TipoParteExterna })
  @IsOptional() @IsEnum(TipoParteExterna) tipo?: TipoParteExterna;

  @ApiPropertyOptional({ description: '"true" inclui as desativadas.' })
  @IsOptional() @IsString() incluirInativas?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

// ---------------------------------------------------------------------------
// Partes do processo
// ---------------------------------------------------------------------------

/** Advogado da parte adversa, como a equipe anotou dos autos. */
export class AdvogadoDaParteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) nome?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) oab?: string;
}

export class AdicionarParteDto {
  @ApiProperty({ enum: PoloProcesso })
  @IsEnum(PoloProcesso)
  polo: PoloProcesso;

  /**
   * Identidade da parte. Informe NO MÁXIMO um vínculo:
   *  - `filiadoId`        → parte é um filiado (nome/CPF vêm do cadastro);
   *  - `parteExternaId`   → parte já cadastrada (empresa, município, PF);
   *  - nenhum dos dois    → texto livre, e aí `nome` é obrigatório.
   */
  @ApiPropertyOptional() @IsOptional() @IsString() filiadoId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() parteExternaId?: string;

  @ApiPropertyOptional({ description: 'Nome nos autos. Obrigatório quando não há vínculo.' })
  @IsOptional() @IsString() @MaxLength(180)
  nome?: string;

  @ApiPropertyOptional({ description: 'CPF/CNPJ como consta nos autos.' })
  @IsOptional() @IsString()
  documento?: string;

  @ApiPropertyOptional({ description: 'Reclamante, Réu, Executada, Substituído…' })
  @IsOptional() @IsString() @MaxLength(60)
  papel?: string;

  @ApiPropertyOptional({ description: 'Parte principal do polo (forma o "Autor × Réu").' })
  @IsOptional() @IsBoolean()
  principal?: boolean;

  @ApiPropertyOptional({ type: [AdvogadoDaParteDto] })
  @IsOptional() @IsArray()
  advogados?: AdvogadoDaParteDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) observacao?: string;
}

export class AtualizarParteDto extends PartialType(AdicionarParteDto) {}

// ---------------------------------------------------------------------------
// Advogados da casa no processo
// ---------------------------------------------------------------------------

export class DefinirAdvogadosDto {
  @ApiProperty({ type: [String], description: 'Lista COMPLETA de advogados do processo (substitui a atual).' })
  @IsArray() @IsString({ each: true })
  advogadoIds: string[];

  @ApiPropertyOptional({
    description: 'Qual deles é o responsável. Omitido, mantém o atual se ele continuar na lista; senão, o primeiro.',
  })
  @IsOptional() @IsString()
  principalId?: string;
}
