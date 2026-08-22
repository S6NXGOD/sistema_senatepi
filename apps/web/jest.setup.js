/**
 * Todo teste do front roda como se fosse uma instalação do SENATEPI.
 *
 * `tenant.config.ts` estoura sem `NEXT_PUBLIC_TENANT` — de propósito: uma
 * instalação sem cliente definido não deve subir. Só que isso derrubava
 * qualquer teste que importasse, mesmo indiretamente, o vocabulário ou a
 * navegação — e é justamente onde mora a lógica que mais precisa de teste
 * (permissões por rota, filtros do menu).
 *
 * Fixo em `senatepi` e não em um cliente falso: os testes que dependem de
 * vocabulário ("filiado" x "associado") passam a exercitar uma configuração
 * REAL, e não uma que ninguém usa.
 */
process.env.NEXT_PUBLIC_TENANT = process.env.NEXT_PUBLIC_TENANT || 'senatepi';
