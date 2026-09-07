import { api } from './api';

/**
 * O QUE PRECISA DE VOCÊ, AGORA — e por que não é uma caixa de notificações.
 *
 * Caixa guarda EVENTO ("a tarefa foi criada"), acumula, precisa de "marcar como
 * lida" e repete. Isto devolve ESTADO: o que é verdade neste instante. Concluiu
 * a tarefa, ela some — sem clicar em nada. O contador não infla com o tempo:
 * ele só cresce se o trabalho pendente crescer.
 */

export type TipoPendencia =
  | 'ATRASADA'
  | 'HOJE'
  | 'AUDIENCIA'
  | 'PUBLICACAO_SEM_TAREFA'
  | 'ACAO_NOVA';

export interface Pendencia {
  tipo: TipoPendencia;
  total: number;
  exemplos: { id: string; titulo: string; quando: string | null; href: string }[];
}

export interface MinhasPendencias {
  pendencias: Pendencia[];
  total: number;
}

export async function minhasPendencias(): Promise<MinhasPendencias> {
  return (await api.get<MinhasPendencias>('/minhas-pendencias')).data;
}

/**
 * O rótulo de cada grupo, no singular e no plural.
 *
 * `urgente` decide a cor: só o que já venceu. Pintar audiência da semana de
 * vermelho ensinaria a ignorar o vermelho — que é justamente o que precisa
 * funcionar no dia em que houver um prazo perdido.
 */
/**
 * DUAS DECISÕES DIFERENTES, e por um tempo elas foram uma só.
 *
 * `urgente` pinta o sino de vermelho. `naFaixa` autoriza o item a ocupar a
 * FAIXA que aparece em cima de TODA tela do sistema. Eram a mesma coisa, e a
 * ação nova sem cadastro escancarou a diferença: 30 itens que não se resolvem
 * hoje, numa faixa que a própria documentação dela diz existir só para o que JÁ
 * VENCEU — "uma faixa que aparece todo dia é um cabeçalho, e cabeçalho ninguém
 * lê". Ela ficaria semanas na tela.
 *
 * `href` é o terceiro: a faixa mandava todo mundo para `/agenda`, fixo. Com a
 * ação nova, que vive em Processos, o clique levava ao lugar errado.
 */
export const PENDENCIA: Record<
  TipoPendencia,
  { um: string; varios: string; urgente: boolean; naFaixa: boolean; href: string; verTodas: string }
> = {
  ATRASADA: {
    um: 'atividade com prazo vencido',
    varios: 'atividades com prazo vencido',
    urgente: true,
    naFaixa: true,
    href: '/agenda',
    verTodas: 'Ver todas na agenda',
  },
  HOJE: {
    um: 'atividade para hoje',
    varios: 'atividades para hoje',
    urgente: false,
    naFaixa: false,
    href: '/agenda',
    verTodas: 'Ver todas na agenda',
  },
  AUDIENCIA: {
    um: 'audiência nos próximos 7 dias',
    varios: 'audiências nos próximos 7 dias',
    urgente: false,
    naFaixa: false,
    href: '/agenda',
    verTodas: 'Ver todas na agenda',
  },
  PUBLICACAO_SEM_TAREFA: {
    um: 'publicação sua sem tarefa aberta',
    varios: 'publicações suas sem tarefa aberta',
    urgente: true,
    naFaixa: true,
    href: '/publicacoes',
    verTodas: 'Ver todas as publicações',
  },
  /*
    VERMELHO NO SINO, MAS FORA DA FAIXA.

    É o único item que não aparece em nenhuma outra lista do sistema — daí o
    vermelho. Mas é BACKLOG: trinta ações que levam dias para serem conferidas
    uma a uma. Na faixa, viraria um cabeçalho permanente; e cabeçalho ninguém lê,
    inclusive quando ele passar a dizer "prazo vencido".
  */
  ACAO_NOVA: {
    um: 'ação no Diário ainda sem cadastro',
    varios: 'ações no Diário ainda sem cadastro',
    urgente: true,
    naFaixa: false,
    href: '/processos',
    verTodas: 'Ver todas as ações encontradas',
  },
};

export function rotulo(p: Pendencia): string {
  const r = PENDENCIA[p.tipo];
  return `${p.total} ${p.total === 1 ? r.um : r.varios}`;
}
