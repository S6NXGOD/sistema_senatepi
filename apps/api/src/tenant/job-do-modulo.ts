import { Logger } from '@nestjs/common';
import { ModuloSistema, moduloAtivo } from './tenant.config';

/**
 * TRABALHO DE FUNDO TAMBÉM PRECISA RESPEITAR O MÓDULO DESLIGADO.
 *
 * O `ModuloAtivoGuard` protege ROTA — ele só existe quando alguém faz uma
 * requisição. Cron não faz requisição: ele é registrado no boot e dispara
 * sozinho, então um módulo desligado continuava tendo robô rodando todo dia
 * naquele cliente.
 *
 * Hoje o pior sintoma é uma varredura sem resultado e uma linha de log
 * enganosa. Mas a diferença entre "não tem o módulo" e "tem o módulo e ele não
 * achou nada" é justamente o que alguém precisa saber ao investigar um
 * problema — e o dia em que um job passar a ESCREVER algo, a conta muda de
 * natureza.
 *
 * Uso, na primeira linha do método anotado com `@Cron`:
 *
 *     if (pularJobSemModulo('cobrancas', this.logger, 'Vencimentos')) return;
 *
 * O retorno é `true` quando o job NÃO deve rodar.
 */
export function pularJobSemModulo(
  modulo: ModuloSistema,
  logger: Logger,
  rotulo: string,
): boolean {
  if (moduloAtivo(modulo)) return false;
  // `debug` e não `log`: numa instalação sem o módulo isto é o esperado, todo
  // dia. Em nível normal viraria ruído diário que ensina a ignorar o log.
  logger.debug(`[${rotulo}] Módulo "${modulo}" não faz parte desta instalação — job ignorado.`);
  return true;
}
