import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A RESPOSTA DO DESAFIO NO `POST /recadastro/:token/validar` — CLASSE desde 14/09/2026.
 *
 * Era um tipo inline (`{ cpf?; dataNascimento?; coren? }`): o metatipo virava
 * `Object`, o ValidationPipe pulava, e qualquer coisa chegava ao serviço — do
 * mesmo jeito que o corpo do /enviar chegava antes de virar classe.
 *
 * Os três nomes são os que a página pública manda desde sempre. Nenhum campo
 * novo é obrigatório: a página antiga, em cache no celular de quem abriu o link
 * antes do deploy, continua passando pela whitelist (o `link-recadastramento.
 * controller.spec.ts` roda o pipe de verdade com o corpo dela).
 */
export class RespostaDoDesafioDto {
  /** Com ou sem máscara: a conferência compara só os dígitos. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) cpf?: string;
  /** 'AAAA-MM-DD' do campo de data da página. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) dataNascimento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) coren?: string;
}
