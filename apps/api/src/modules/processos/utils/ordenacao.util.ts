import { Prisma } from '@prisma/client';

/**
 * COMO A LISTA DE PROCESSOS VEM ORDENADA.
 *
 * O QUE ISTO CONSERTA. A lista ordenava por `ultimaSincronizacao` — o carimbo
 * de quando o ROBÔ falou com o CNJ, e não de quando o processo se moveu. Como a
 * varredura noturna reescreve esse carimbo em TODO o acervo na mesma madrugada,
 * os valores se agrupam na janela do cron: a "ordem por mais recente" era, na
 * prática, a ordem em que o robô terminou cada processo. O que recebeu sentença
 * ontem podia cair na página 3 atrás de trinta processos dormentes, e nada na
 * tela explicava por quê.
 *
 * `ultimoMovimentoEm` é coluna mantida por GATILHO no banco (migração
 * `20260825120000_ultimo_movimento_do_processo`), e não pelo serviço: são cinco
 * caminhos de escrita de andamento e bastaria um esquecer para a ordem voltar a
 * mentir sem ninguém perceber.
 *
 * MORA NUM UTIL, e não no serviço, porque o DTO precisa da lista para
 * documentar o parâmetro — e o serviço já importa o DTO. Declarar lá criaria um
 * ciclo de import.
 */
export const ORDENS_PROCESSO = ['movimentacao', 'parados', 'cadastro'] as const;
export type OrdemProcesso = (typeof ORDENS_PROCESSO)[number];

export const ORDEM_PADRAO: OrdemProcesso = 'movimentacao';

/**
 * AS TRÊS ORDENS respondem perguntas diferentes, e é por isso que são três e
 * não sete: "o que está acontecendo" (padrão), "o que estou esquecendo" e "o
 * que acabou de entrar". Um seletor com dez opções é um seletor que ninguém
 * abre — e cada opção a mais é uma consulta a mais para o banco justificar com
 * índice.
 *
 * NULLS LAST no padrão, NULLS FIRST em `parados`: processo sem andamento nenhum
 * é o extremo da inércia — vai para o fim de "quem andou por último" e para o
 * topo de "quem está parado há mais tempo". Nos dois casos, exatamente onde
 * alguém o procuraria.
 *
 * O DESEMPATE por `id` existe para a paginação não repetir nem pular linha: sem
 * critério estável, dois processos com a mesma data podem trocar de lugar entre
 * a página 1 e a 2, e um deles simplesmente some da lista.
 */
export const ORDENACAO: Record<OrdemProcesso, Prisma.ProcessoOrderByWithRelationInput[]> = {
  movimentacao: [{ ultimoMovimentoEm: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
  parados: [{ ultimoMovimentoEm: { sort: 'asc', nulls: 'first' } }, { id: 'desc' }],
  cadastro: [{ createdAt: 'desc' }, { id: 'desc' }],
};

/**
 * Ordem pedida na URL, ou o padrão.
 *
 * Valor desconhecido NÃO estoura: o parâmetro vem da barra de endereços, e um
 * link salvo nos favoritos com uma ordem que deixou de existir tem de abrir a
 * lista, não devolver 400 numa tela que a equipe usa todo dia.
 */
export function ordemValida(bruta: string | undefined | null): OrdemProcesso {
  return ORDENS_PROCESSO.includes(bruta as OrdemProcesso)
    ? (bruta as OrdemProcesso)
    : ORDEM_PADRAO;
}
