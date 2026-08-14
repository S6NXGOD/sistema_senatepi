import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/** O que fazer com os dependentes de quem JÁ EXISTE no sistema. */
export enum EstrategiaDependentes {
  /**
   * Só acrescenta o que falta (casa por CPF, ou por nome + nascimento).
   * PADRÃO: é a única que não destrói o que a secretaria cadastrou à mão depois
   * da primeira carga — e importação se roda mais de uma vez.
   */
  ACRESCENTAR = 'ACRESCENTAR',
  /** O arquivo passa a ser a verdade: o que não está nele é removido. */
  SUBSTITUIR = 'SUBSTITUIR',
  /** Não mexe em dependente nenhum de quem já existe. */
  MANTER = 'MANTER',
}

export class ConfirmarColaboradoresLegadoDto {
  @ApiPropertyOptional({
    default: true,
    description:
      'Atualiza os dados de quem já está cadastrado (casado pelo CPF). ' +
      'Desligado, quem já existe é apenas contado como ignorado.',
  })
  @IsOptional() @IsBoolean() atualizarExistentes?: boolean;

  @ApiPropertyOptional({ enum: EstrategiaDependentes, default: EstrategiaDependentes.ACRESCENTAR })
  @IsOptional() @IsEnum(EstrategiaDependentes) dependentes?: EstrategiaDependentes;

  @ApiPropertyOptional({
    default: true,
    description:
      'Importa as linhas válidas mesmo havendo linhas com erro. Desligado, ' +
      'a carga só roda se o arquivo inteiro estiver limpo.',
  })
  @IsOptional() @IsBoolean() importarSomenteValidos?: boolean;
}

export class UploadColaboradoresLegadoDto {
  @ApiPropertyOptional({
    description: 'Processa de novo um arquivo que já foi importado antes.',
  })
  // Vem de multipart: chega como string, nunca como booleano.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  permitirReenvio?: boolean;
}

export class ListarLinhasColaboradoresQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome, CPF ou matrícula' })
  @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: ['NOVO', 'ATUALIZACAO', 'ERRO', 'AVISO'] })
  @IsOptional() @IsIn(['NOVO', 'ATUALIZACAO', 'ERRO', 'AVISO']) classificacao?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Transform(({ value }) => Number(value)) page?: number;
}
