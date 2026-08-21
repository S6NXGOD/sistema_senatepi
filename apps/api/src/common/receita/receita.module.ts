import { Module } from '@nestjs/common';
import { BrasilApiService } from './brasil-api.service';

/**
 * A consulta de CNPJ, disponível para quem precisar dela.
 *
 * Nasceu dentro do módulo Patronal, para o cadastro de empresa contribuinte.
 * Só que a mesma pergunta — "quem é o dono deste CNPJ?" — aparece em mais dois
 * lugares: no cadastro de Organizações e no formulário de partes do processo.
 * Enquanto o serviço morava em `modules/empresas`, reusá-lo obrigava a importar
 * o módulo inteiro, e com ele controllers de contribuição e auditoria que nada
 * têm a ver com processo — inclusive em cliente que nem tem módulo patronal.
 */
@Module({
  providers: [BrasilApiService],
  exports: [BrasilApiService],
})
export class ReceitaModule {}
