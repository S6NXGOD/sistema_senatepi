import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, IsUUID,
  ValidateNested,
} from 'class-validator';

/** Vínculo do anexo — exatamente um dos três deve vir preenchido. */
export class CriarAnexoDto {
  @ApiPropertyOptional({ description: 'Atendimento (triagem) ao qual o anexo pertence.' })
  @IsOptional() @IsUUID()
  atendimentoId?: string;

  @ApiPropertyOptional({ description: 'Processo ao qual o anexo pertence.' })
  @IsOptional() @IsUUID()
  processoId?: string;

  @ApiPropertyOptional({ description: 'Atividade da agenda à qual o anexo pertence.' })
  @IsOptional() @IsUUID()
  compromissoId?: string;
}

export class ListarAnexosQueryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  atendimentoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  processoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  compromissoId?: string;
}

/** De onde veio o documento listado no acervo do filiado. */
export enum OrigemAcervo {
  ATENDIMENTO = 'ATENDIMENTO',
  PROCESSO = 'PROCESSO',
  COMPROMISSO = 'COMPROMISSO',
  CADASTRO = 'CADASTRO',
}

/**
 * Acervo do filiado — tudo que já foi anexado a ele em qualquer registro.
 * O alvo (atendimento/processo/compromisso) é opcional e serve para marcar o que
 * JÁ está vinculado nele — inclusive por herança da triagem de origem.
 */
export class AcervoQueryDto {
  @ApiProperty({ description: 'Filiado dono do acervo.' })
  @IsUUID()
  filiadoId!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  atendimentoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  processoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  compromissoId?: string;
}

export class ItemPuxarDto {
  @ApiProperty({ enum: OrigemAcervo })
  @IsEnum(OrigemAcervo)
  origemTipo!: OrigemAcervo;

  @ApiProperty({ description: 'Id do anexo (ou do documento do cadastro) de origem.' })
  @IsUUID()
  origemId!: string;
}

/** "Puxar" documentos do acervo para o registro atual, sem novo upload. */
export class PuxarAnexosDto {
  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  atendimentoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  processoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  compromissoId?: string;

  @ApiProperty({ type: [ItemPuxarDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ItemPuxarDto)
  itens!: ItemPuxarDto[];
}
