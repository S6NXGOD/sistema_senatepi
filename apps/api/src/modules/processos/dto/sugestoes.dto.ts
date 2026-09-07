import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsString, MaxLength,
} from 'class-validator';

/**
 * O MOTIVO DE IGNORAR — opcional, mas guardado quando vem.
 *
 * A mesma ação volta a aparecer no Diário por meses. Sem o registro do porquê,
 * a próxima pessoa refaz a mesma investigação; e uma decisão que, no limite,
 * deixa um processo do sindicato fora do acompanhamento merece rastro.
 *
 * Opcional de propósito: exigir texto para descartar transformaria a fila num
 * formulário, e aí ninguém a limpa — o alarme volta a ser ignorado em bloco,
 * que é o problema que a fila existe para resolver.
 */
export class IgnorarSugestaoDto {
  @ApiPropertyOptional({ example: 'Processo particular do advogado, não é do sindicato.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

/**
 * QUAIS AÇÕES CADASTRAR DE UMA VEZ.
 *
 * O teto de 50 não é medo do banco: cada importação consulta o CNJ, e a cota é
 * de 20 requisições por minuto. Cinquenta já são uns quatro minutos com a tela
 * presa — mais que isso e a pessoa acha que travou.
 */
export class ImportarLoteSugestoesDto {
  @ApiProperty({ type: [String], description: 'Ids das sugestões a cadastrar (1 a 50).' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  ids: string[];
}
