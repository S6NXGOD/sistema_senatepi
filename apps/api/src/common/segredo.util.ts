import { Logger } from '@nestjs/common';
import { tenant } from '../tenant/tenant.config';

/**
 * SEGREDO DE UMA INSTALAÇÃO — nunca compartilhado entre sindicatos.
 *
 * O PROBLEMA QUE ISTO RESOLVE. Cada lugar que lia um segredo tinha o próprio
 * valor de reserva escrito à mão: `'dev-access-secret'`, `'dev-qr-secret'`,
 * `'senatepi-dev-secret'`. Com um cliente só isso era apenas feio. Com vários,
 * é uma falha de isolamento: DUAS instalações que esqueçam a mesma variável
 * passam a assinar com a MESMA chave literal — e um token emitido para um
 * sindicato vale no outro.
 *
 * A reserva agora inclui o `tenant.id`, então duas instalações mal
 * configuradas ainda assim não se cruzam.
 *
 * EM PRODUÇÃO NÃO HÁ RESERVA. Se a variável faltar, a aplicação não sobe —
 * do mesmo jeito que uma instalação sem `TENANT` não sobe. Um segredo
 * previsível em produção é pior que um serviço fora do ar: o serviço fora do ar
 * alguém percebe.
 */
const logger = new Logger('Segredo');
const jaAvisados = new Set<string>();

export function segredoDaInstalacao(nome: string, valor: string | undefined): string {
  if (valor && valor.trim()) return valor;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `A variável de ambiente ${nome} não está definida. ` +
        'Em produção não existe valor de reserva: um segredo previsível permitiria ' +
        'forjar credenciais desta instalação. Defina-a e reinicie.',
    );
  }

  // Uma linha por variável, e não uma por chamada: `secretOrKey` é lido a cada
  // requisição e encheria o log de desenvolvimento.
  if (!jaAvisados.has(nome)) {
    jaAvisados.add(nome);
    logger.warn(`${nome} não definida — usando um valor de DESENVOLVIMENTO derivado do tenant.`);
  }
  return `dev-${tenant.id}-${nome.toLowerCase()}`;
}
