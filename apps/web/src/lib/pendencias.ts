import { api } from './api';

/**
 * O QUE PRECISA DE VOCÊ, AGORA — e por que não é uma caixa de notificações.
 *
 * Caixa guarda EVENTO ("a tarefa foi criada"), acumula, precisa de "marcar como
 * lida" e repete. Isto devolve ESTADO: o que é verdade neste instante. Concluiu
 * a tarefa, ela some — sem clicar em nada. O contador não infla com o tempo:
 * ele só cresce se o trabalho pendente crescer.
 */

export type TipoPendencia = 'ATRASADA' | 'HOJE' | 'AUDIENCIA' | 'PUBLICACAO_SEM_TAREFA';

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
export const PENDENCIA: Record<
  TipoPendencia,
  { um: string; varios: string; urgente: boolean }
> = {
  ATRASADA: {
    um: 'atividade com prazo vencido',
    varios: 'atividades com prazo vencido',
    urgente: true,
  },
  HOJE: { um: 'atividade para hoje', varios: 'atividades para hoje', urgente: false },
  AUDIENCIA: {
    um: 'audiência nos próximos 7 dias',
    varios: 'audiências nos próximos 7 dias',
    urgente: false,
  },
  PUBLICACAO_SEM_TAREFA: {
    um: 'publicação sua sem tarefa aberta',
    varios: 'publicações suas sem tarefa aberta',
    urgente: true,
  },
};

export function rotulo(p: Pendencia): string {
  const r = PENDENCIA[p.tipo];
  return `${p.total} ${p.total === 1 ? r.um : r.varios}`;
}
