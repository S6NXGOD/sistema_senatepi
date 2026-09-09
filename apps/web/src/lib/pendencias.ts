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
  | 'PASSOU_DA_HORA'
  | 'HOJE'
  | 'AUDIENCIA'
  | 'PUBLICACAO_SEM_TAREFA'
  | 'ACAO_NOVA';

export interface Pendencia {
  tipo: TipoPendencia;
  total: number;
  exemplos: { id: string; titulo: string; quando: string | null; href: string }[];
  /**
   * FILA DA EQUIPE — vem da API, e não de um mapa aqui.
   *
   * Esta bandeira decide DUAS coisas: a linha "quem resolver primeiro limpa
   * para todos" nesta tela, e se o item entra no número do crachá. A segunda
   * conta é feita na API. Com a regra escrita nos dois lugares, o crachá somava
   * 25 itens que o rótulo, logo abaixo, dizia não serem da pessoa — cinco dos
   * catorze usuários tinham ZERO tarefas e viam "25" em vermelho.
   *
   * Opcional porque a API pode ser a de antes durante a janela de troca.
   */
  compartilhada?: boolean;
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
  {
    um: string;
    varios: string;
    urgente: boolean;
    naFaixa: boolean;
    href: string;
    verTodas: string;
  }
> = {
  /*
    "PRAZO VENCIDO" SAIU DO RÓTULO — o sistema não sabe disso.

    Ele conhece a data que alguém marcou na agenda, não o prazo processual.
    Dizer "prazo vencido" afirma perda de prazo, que é a acusação mais grave
    que este sistema pode fazer a um advogado, e ele não tem como sustentá-la.
    "Ficou para trás" é exatamente o que o dado diz: a data passou e a
    atividade continua aberta.
  */
  ATRASADA: {
    um: 'atividade atrasada, de dia anterior',
    varios: 'atividades atrasadas, de dias anteriores',
    urgente: true,
    naFaixa: true,
    href: '/agenda',
    verTodas: 'Ver todas na agenda',
  },
  /*
    A ESCALA DENTRO DO DIA, que faltava.

    "5 atividades para hoje" às 09:00 e a MESMA frase às 22:00 descrevem
    situações opostas. O sino é o único aviso presente em todas as telas — se
    ele não escala, ninguém percebe o dia acabando exceto quem abre o painel.

    Não é urgente e não vai para a faixa: o robô agenda tarefa para as 15:00 do
    próprio dia, e às 15:01 nada foi perdido. Alarme só para o que ficou para
    trás de verdade; aqui é informação. Mesmas palavras do painel.
  */
  PASSOU_DA_HORA: {
    um: 'atividade de hoje que passou da hora',
    varios: 'atividades de hoje que passaram da hora',
    urgente: false,
    naFaixa: false,
    href: '/agenda',
    verTodas: 'Ver todas na agenda',
  },
  HOJE: {
    um: 'atividade ainda por vir hoje',
    varios: 'atividades ainda por vir hoje',
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
