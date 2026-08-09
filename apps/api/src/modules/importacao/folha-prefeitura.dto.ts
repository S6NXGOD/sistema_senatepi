import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClassificacaoLinha, DecisaoConflito, MotivoConflito } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class DecidirConflitoDto {
  @ApiProperty({ enum: DecisaoConflito })
  @IsEnum(DecisaoConflito)
  decisao!: DecisaoConflito;

  @ApiPropertyOptional({
    description:
      'A qual cadastro o vínculo pertence. Só em MESMA_PESSOA. Omitido, ' +
      'usa o candidato que a prévia sugeriu.',
  })
  @IsOptional()
  @IsUUID()
  filiadoId?: string;
}

export class DecidirEmLoteDto {
  @ApiProperty({ enum: MotivoConflito })
  @IsEnum(MotivoConflito)
  motivo!: MotivoConflito;

  @ApiProperty({
    enum: DecisaoConflito,
    description: 'MESMA_PESSOA é recusado em lote — o candidato muda a cada linha.',
  })
  @IsEnum(DecisaoConflito)
  decisao!: DecisaoConflito;
}

export class ConfirmarFolhaDto {
  @ApiPropertyOptional({
    description:
      'Segue em frente deixando os conflitos ainda pendentes DE FORA desta ' +
      'importação. Eles continuam registrados para uma próxima rodada.',
  })
  @IsOptional()
  @IsBoolean()
  ignorarConflitosPendentes?: boolean;
}

export class ListarLinhasFolhaQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() busca?: string;

  @ApiPropertyOptional({ enum: ClassificacaoLinha })
  @IsOptional()
  @IsEnum(ClassificacaoLinha)
  classificacao?: ClassificacaoLinha;

  @ApiPropertyOptional() @IsOptional() page?: number;
}
