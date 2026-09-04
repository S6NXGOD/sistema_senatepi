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
 *
 * QUEM ABRE O ESCOPO É UM MIDDLEWARE, E ISSO NÃO É DETALHE.
 *
 * Eu tinha aberto o escopo dentro do INTERCEPTOR:
 *
 *     return comContextoDeAuditoria(() => next.handle().pipe(tap(…)));
 *
 * e afirmei, em commit, que a duplicação tinha acabado. **Não tinha.**
 * `next.handle()` devolve um Observable FRIO: o handler só roda quando o Nest
 * se inscreve nele, o que acontece DEPOIS de `intercept()` retornar — fora do
 * `run()`. O serviço chamava `marcarAuditadoPeloServico()` num escopo vazio, a
 * marca ia para lugar nenhum, e o interceptor gravava a segunda linha do mesmo
 * jeito. Medido com a API rodando: uma edição → DOIS registros.
 *
 * No middleware o escopo envolve `next()`, e aí tudo o que vem depois —
 * guardas, interceptors, handler, serviços — corre dentro dele.
 */
interface EstadoDaRequisicao {
  /** Um serviço gravou o registro próprio desta requisição. */
  registrou: boolean;
  /** Um serviço OLHOU e decidiu que não há o que registrar. */
  decidiuCalar: boolean;
}

const armazem = new AsyncLocalStorage<EstadoDaRequisicao>();

/** Abre o escopo de uma requisição. Só o middleware chama. */
export function comContextoDeAuditoria<T>(fn: () => T): T {
  return armazem.run({ registrou: false, decidiuCalar: false }, fn);
}

/** Marca que esta requisição já ganhou um registro escrito à mão. */
export function marcarAuditadoPeloServico(): void {
  const ctx = armazem.getStore();
  if (ctx) ctx.registrou = true;
}

/**
 * "EU OLHEI E NÃO HÁ O QUE REGISTRAR."
 *
 * Salvar o formulário sem mudar nada não é fato auditável — mas, sem esta
 * marca, o interceptor de último recurso gravava "Mexeu no cadastro de um
 * filiado" justamente nesse caso, que é o mais inútil de todos: diz que alguém
 * mexeu quando ninguém mexeu em nada.
 *
 * Diferente de `marcarAuditadoPeloServico`: ali houve registro, aqui houve
 * DECISÃO de não registrar. As duas calam o interceptor, e separá-las deixa a
 * intenção legível em vez de fingir um registro que não existe.
 */
export function marcarNadaMudou(): void {
  const ctx = armazem.getStore();
  if (ctx) ctx.decidiuCalar = true;
}

/** Algum serviço já tratou a auditoria desta requisição? */
export function jaFoiAuditadoPeloServico(): boolean {
  const ctx = armazem.getStore();
  return !!ctx && (ctx.registrou || ctx.decidiuCalar);
}
