import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StatusParcela, TipoCobranca } from '@prisma/client';

export class SimularCobrancaDto {
  @ApiProperty({ example: 1200.0, description: 'Valor total a ser dividido nas parcelas.' })
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  valorTotal: number;

  @ApiProperty({ example: 12, description: 'Quantidade de parcelas do carnê.' })
  @IsInt() @Min(1)
  quantidadeParcelas: number;

  @ApiProperty({ example: '2026-08-01', description: 'Competência da 1ª parcela (YYYY-MM-DD).' })
  @IsDateString()
  dataCompetenciaInicial: string;

  @ApiProperty({ example: '2026-08-10', description: 'Vencimento da 1ª parcela (YYYY-MM-DD).' })
  @IsDateString()
  dataVencimentoInicial: string;

  @ApiPropertyOptional({ enum: TipoCobranca })
  @IsOptional() @IsEnum(TipoCobranca)
  tipo?: TipoCobranca;
}

export class ParcelaInputDto {
  @ApiPropertyOptional({ description: 'Ordem no carnê (1..n). Se ausente, usa o índice.' })
  @IsOptional() @IsInt() @Min(1)
  numero?: number;

  @ApiProperty({ example: '2026-08-01' })
  @IsDateString()
  dataCompetencia: string;

  @ApiProperty({ example: '2026-08-10' })
  @IsDateString()
  dataVencimento: string;

  @ApiProperty({ example: 100.0 })
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  valor: number;
}

export class GravarCobrancaDto {
  @ApiProperty({ description: 'ID do filiado ao qual a cobrança pertence.' })
  @IsString() @IsNotEmpty()
  filiadoId: string;

  @ApiPropertyOptional({ enum: TipoCobranca, default: TipoCobranca.MENSALIDADE })
  @IsOptional() @IsEnum(TipoCobranca)
  tipo?: TipoCobranca;

  @ApiPropertyOptional({ description: 'Descrição/observação da cobrança.' })
  @IsOptional() @IsString()
  descricao?: string;

  @ApiProperty({ type: [ParcelaInputDto], description: 'Parcelas já validadas/editadas no front.' })
  @IsArray() @ArrayNotEmpty()
  @ValidateNested({ each: true }) @Type(() => ParcelaInputDto)
  parcelas: ParcelaInputDto[];
}

export class BaixarParcelaDto {
  @ApiProperty({ example: 150.0, description: 'Valor efetivamente recebido (permite juros/desconto).' })
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive()
  valorPago: number;

  @ApiProperty({ description: 'Conta bancária de destino da entrada (Módulo Financeiro).' })
  @IsString() @IsNotEmpty()
  contaBancariaId: string;
}

export class ListarParcelasQueryDto {
  @ApiPropertyOptional({ enum: StatusParcela, description: 'Filtra por situação (VENCIDO = pendente vencida).' })
  @IsOptional() @IsEnum(StatusParcela) status?: StatusParcela;

  @ApiPropertyOptional({ example: '2026-08', description: 'Mês de vencimento (YYYY-MM).' })
  @IsOptional() @IsString() mes?: string;

  @ApiPropertyOptional({ description: 'Busca por nome, matrícula ou CPF do filiado.' })
  @IsOptional() @IsString() busca?: string;
}

export class ListarPorFiliadoQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome, matrícula ou CPF do filiado.' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ description: 'Se "true", só filiados com valor vencido.' })
  @IsOptional() @IsString() inadimplentes?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

export class ConfiguracaoSindicatoDto {
  @ApiPropertyOptional() @IsOptional() @IsString() logoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assinaturaPresidenteUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() textoRodapeCarne?: string;
  @ApiPropertyOptional({ description: 'Chave PIX estática do sindicato.' })
  @IsOptional() @IsString() pixChave?: string;
  @ApiPropertyOptional({ description: 'Nome do recebedor no BR Code (máx. 25).' })
  @IsOptional() @IsString() pixNomeRecebedor?: string;
  @ApiPropertyOptional({ description: 'Cidade do recebedor no BR Code (máx. 15).' })
  @IsOptional() @IsString() pixCidade?: string;
}
