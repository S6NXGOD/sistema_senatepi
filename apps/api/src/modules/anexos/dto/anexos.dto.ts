import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

/** Vínculo do anexo — exatamente um dos dois deve vir preenchido. */
export class CriarAnexoDto {
  @ApiPropertyOptional({ description: 'Atendimento (triagem) ao qual o anexo pertence.' })
  @IsOptional() @IsUUID()
  atendimentoId?: string;

  @ApiPropertyOptional({ description: 'Processo ao qual o anexo pertence.' })
  @IsOptional() @IsUUID()
  processoId?: string;
}

export class ListarAnexosQueryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  atendimentoId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  processoId?: string;
}
