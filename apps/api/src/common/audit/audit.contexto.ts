import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * QUEM JÁ CONTOU O QUE ACONTECEU NESTA REQUISIÇÃO.
 *
 * O problema que isto resolve: metade do log de auditoria era duplicata.
 * Medido na produção em 04/09/2026 — **1.555 de 2.973 registros (52%) eram
 * linhas de curl** (`POST /api/processos/instancias/reavaliar?limite=10`),
 * gravadas pelo `AuditInterceptor` em toda escrita. E os serviços que fazem o
 * trabalho de verdade já gravavam a MESMA operação em português
 * ("Radar de audiências reclassificado: …"). Dois registros para um ato, e o
 * pior dos dois vinha primeiro na tela.
 *
 * O interceptor continua existindo — sem ele, uma rota que ninguém instrumentou
 * não deixaria rastro nenhum, e é justamente essa a que se procura depois. Ele
 * só deixa de falar quando alguém já falou melhor.
 *
 * ASYNC LOCAL STORAGE, e não um campo em `req`: o serviço que grava está a
 * várias camadas de distância do controller e não recebe a requisição. É a
 * ferramenta do Node para exatamente isto, sem dependência nova.
 */
const armazem = new AsyncLocalStorage<{ registrou: boolean }>();

/** Abre o escopo de uma requisição. Só o interceptor chama. */
export function comContextoDeAuditoria<T>(fn: () => T): T {
  return armazem.run({ registrou: false }, fn);
}

/** Marca que esta requisição já ganhou um registro escrito à mão. */
export function marcarAuditadoPeloServico(): void {
  const ctx = armazem.getStore();
  if (ctx) ctx.registrou = true;
}

/** O serviço já contou o que aconteceu? */
export function jaFoiAuditadoPeloServico(): boolean {
  return armazem.getStore()?.registrou ?? false;
}
