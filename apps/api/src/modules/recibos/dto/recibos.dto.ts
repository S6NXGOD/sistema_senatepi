import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * AS TRÊS PORTAS DE EMISSÃO, num DTO só — e a razão de não serem três rotas.
 *
 * `parcelaId`, `movimentacaoId` e nenhum dos dois (avulso) são a MESMA
 * operação: nasce um recibo numerado. O que muda é de onde vêm os dados. Três
 * rotas obrigariam a tela a escolher a rota antes de o usuário terminar de
 * preencher, e duplicariam a numeração em três lugares — que é exatamente onde
 * numeração duplicada costuma aparecer.
 *
 * O SERVIÇO VALIDA A COMBINAÇÃO. Validação condicional em decorador de
 * class-validator fica ilegível e a mensagem de erro sai genérica; aqui cada
 * recusa diz o que faltou, em português, porque ela vai para a tela.
 */
export class EmitirReciboDto {
  @ApiPropertyOptional({ description: 'Emitir a partir da baixa de uma parcela do carnê.' })
  @IsOptional() @IsString()
  parcelaId?: string;

  @ApiPropertyOptional({ description: 'Emitir a partir de uma ENTRADA que já está no caixa.' })
  @IsOptional() @IsString()
  movimentacaoId?: string;

  @ApiPropertyOptional({ example: 150.0, description: 'Obrigatório no recibo avulso.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'O valor tem no máximo dois centavos.' })
  @IsPositive({ message: 'O valor recebido precisa ser maior que zero.' })
  @Type(() => Number)
  valor?: number;

  @ApiPropertyOptional({ example: 'Mensalidade de outubro/2026' })
  @IsOptional() @IsString() @MaxLength(180)
  referente?: string;

  @ApiProperty({ example: 'PIX', description: 'Dinheiro, PIX, transferência, cartão…' })
  @IsString({ message: 'Diga como o valor foi recebido.' })
  @IsNotEmpty({ message: 'Diga como o valor foi recebido.' })
  @MaxLength(40, { message: 'A forma de pagamento é um rótulo curto.' })
  formaPagamento: string;

  @ApiPropertyOptional({ description: 'Quando o dinheiro entrou. Padrão: agora.' })
  @IsOptional() @IsISO8601()
  recebidoEm?: string;

  @ApiPropertyOptional({ description: 'Obrigatório quando não dá para deduzir do pagamento.' })
  @IsOptional() @IsString() @MaxLength(120)
  pagadorNome?: string;

  @ApiPropertyOptional({ description: 'CPF ou CNPJ. Só dígitos ou com máscara — é limpo aqui.' })
  @IsOptional() @IsString() @MaxLength(20)
  pagadorDocumento?: string;

  @ApiPropertyOptional({ description: 'Liga o recibo à ficha do filiado.' })
  @IsOptional() @IsString()
  filiadoId?: string;

  @ApiPropertyOptional({ description: 'Liga o recibo à empresa contribuinte.' })
  @IsOptional() @IsString()
  empresaId?: string;

  @ApiPropertyOptional({
    description:
      'Conta de destino do avulso. Com uma conta ativa só, pode ser omitida — o serviço usa a única.',
  })
  @IsOptional() @IsString()
  contaBancariaId?: string;
}

/**
 * O MOTIVO NÃO É OPCIONAL, e tem tamanho mínimo.
 *
 * Um recibo cancelado sem motivo é pior que nenhum: o número fica queimado e
 * ninguém sabe por quê. Cinco caracteres não garantem uma boa explicação, mas
 * impedem o "x" e o ".", que é o que se digita quando o campo não exige nada.
 */
export class CancelarReciboDto {
  /*
    A MENSAGEM EM PORTUGUÊS É PARTE DA REGRA. O texto cru do class-validator
    ("motivo must be longer than or equal to 5 characters") sobe para a TELA,
    e erro de validação tem dois destinatários: o cru vai para o log, nunca
    para quem está no balcão (`senatepi-um-corpo-duas-rotas`).
  */
  @ApiProperty({ example: 'Valor digitado errado; reemitido no nº 8.' })
  @IsString({ message: 'Escreva o motivo do cancelamento.' })
  @MinLength(5, { message: 'Escreva o motivo com um pouco mais de detalhe.' })
  @MaxLength(300, { message: 'O motivo passou de 300 caracteres.' })
  motivo: string;
}

export class ListarRecibosQueryDto {
  @ApiPropertyOptional({ description: 'Nome do pagador, documento ou número do recibo.' })
  @IsOptional() @IsString()
  busca?: string;

  @ApiPropertyOptional({ example: 2026 })
  @IsOptional() @IsInt() @Type(() => Number)
  exercicio?: number;

  @ApiPropertyOptional({ enum: ['VALIDOS', 'CANCELADOS', 'TODOS'], default: 'VALIDOS' })
  @IsOptional() @IsIn(['VALIDOS', 'CANCELADOS', 'TODOS'])
  situacao?: 'VALIDOS' | 'CANCELADOS' | 'TODOS';

  @ApiPropertyOptional({ description: 'Recebido a partir de (YYYY-MM-DD).' })
  @IsOptional() @IsString()
  de?: string;

  @ApiPropertyOptional({ description: 'Recebido até (YYYY-MM-DD), inclusive.' })
  @IsOptional() @IsString()
  ate?: string;

  @ApiPropertyOptional({ description: 'Só os recibos deste filiado.' })
  @IsOptional() @IsString()
  filiadoId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @IsInt() @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @IsInt() @Type(() => Number)
  pageSize?: number;
}
