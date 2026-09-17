import { api } from './api';
import { mascararNPU } from './processos';

/**
 * O QUE NÃO PODE ESPERAR — o que alimenta a faixa em cima de toda tela.
 *
 * ESTADO, e não evento: o que é verdade neste instante. Concluiu a tarefa, o
 * aviso some — sem clicar em nada, sem "marcar como lida", sem histórico.
 *
 * Até 12/09/2026 isto alimentava também um sino no topo, com sete grupos. O sino
 * saiu: repetia o painel numa gaveta que ninguém abria. Ficaram os grupos
 * que justificam interromper qualquer tela.
 */

export type TipoPendencia =
  | 'ATRASADA'
  | 'PRECISA_DA_EQUIPE'
  | 'PUBLICACAO_SEM_TAREFA'
  | 'ATO_ESPERANDO_OLHO';

export interface Pendencia {
  tipo: TipoPendencia;
  total: number;
  exemplos: {
    id: string;
    titulo: string;
    quando: string | null;
    href: string;
    /** O porquê, quando o item é da equipe: "Dr. Carlos está sem entrar há 39 dias". */
    detalhe?: string;
  }[];
}

export interface MinhasPendencias {
  pendencias: Pendencia[];
  total: number;
}

/**
 * TIPO QUE A TELA NÃO CONHECE NÃO ENTRA — defesa da janela de troca.
 *
 * A faixa lê `PENDENCIA[p.tipo]` sem rede: um tipo novo vindo de uma API mais
 * nova que a tela quebraria o cabeçalho de TODAS as páginas por alguns minutos.
 * Filtrar aqui, na porta, protege todo mundo que consome a lista — inclusive o
 * próximo tipo, e os grupos antigos que uma API de antes ainda mande.
 */
export function soConhecidas(pendencias: Pendencia[]): Pendencia[] {
  return pendencias.filter((p) => Object.prototype.hasOwnProperty.call(PENDENCIA, p.tipo));
}

export async function minhasPendencias(): Promise<MinhasPendencias> {
  const { data } = await api.get<MinhasPendencias>('/minhas-pendencias');
  return { ...data, pendencias: soConhecidas(data.pendencias ?? []) };
}

/**
 * O rótulo de cada grupo, no singular e no plural, e para onde a contagem leva.
 *
 * "PRAZO VENCIDO" NÃO ENTRA: o sistema conhece a data que alguém marcou na
 * agenda, não o prazo processual. Afirmar perda de prazo é a acusação mais grave
 * que ele poderia fazer a um advogado, e ele não tem como sustentá-la. "Ficou
 * para trás" é exatamente o que o dado diz.
 */
export const PENDENCIA: Record<TipoPendencia, { um: string; varios: string; href: string }> = {
  ATRASADA: {
    um: 'atividade sua ficou para trás',
    varios: 'atividades suas ficaram para trás',
    href: '/agenda',
  },
  /*
    A TAREFA DO CASO EM QUE VOCÊ É RESERVA, E NINGUÉM ESTÁ CUIDANDO — o
    responsável sumiu, ou o dia virou. Várias levam ao painel, onde a lista diz de
    quem é cada uma e por quê; uma só leva direto à atividade, onde está o botão
    "Assumir".
  */
  PRECISA_DA_EQUIPE: {
    um: 'atividade da sua equipe está sem ninguém cuidando',
    varios: 'atividades da sua equipe estão sem ninguém cuidando',
    href: '/dashboard',
  },
  PUBLICACAO_SEM_TAREFA: {
    um: 'publicação sua sem tarefa aberta',
    varios: 'publicações suas sem tarefa aberta',
    href: '/publicacoes',
  },
  /*
    O ATO QUE O ROBÔ NÃO SOUBE RESOLVER — o alerta que entrou no lugar da tarefa
    cega, em 17/09/2026.

    "Se for algo urgente, mande um alerta, mas não encha de tarefas
    desnecessárias." O robô do DataJud abria "Verificação de Intimação / Prazo"
    sem saber o que o juízo pediu; 32 das 48 foram canceladas. Agora o ato
    aparece aqui, como ESTADO, e some quando alguém decide — virando tarefa ou
    marcando "já cuidei" na ficha.

    "SEM NINGUÉM DECIDIR", e não "sem providência": o sistema não sabe se há
    providência a tomar. Ele sabe que o tribunal praticou um ato dos que costumam
    pedir uma, e que ninguém olhou. Prometer mais que isso é o que fez a tarefa
    cega perder a confiança de quem a recebia.
  */
  ATO_ESPERANDO_OLHO: {
    um: 'ato do tribunal está sem ninguém decidir',
    varios: 'atos do tribunal estão sem ninguém decidir',
    href: '/processos',
  },
};

export function rotulo(p: Pendencia): string {
  const r = PENDENCIA[p.tipo];
  return `${p.total} ${p.total === 1 ? r.um : r.varios}`;
}

/**
 * A FRASE DA FAIXA — uma por grupo, e para onde ela leva.
 *
 * Um item só vira frase com o NOME da coisa e leva ao próprio item: "1 atividade
 * ficou para trás" obrigaria a abrir a agenda para descobrir qual. Vários viram
 * contagem e levam à lista. É a regra de todo aviso deste sistema: leva ao ato,
 * não à tela onde o ato mora.
 */
export function fraseDaFaixa(p: Pendencia): { texto: string; href: string } {
  const unico = p.total === 1 ? p.exemplos[0] : undefined;
  if (unico && p.tipo === 'ATRASADA') {
    return { texto: `“${unico.titulo}” ficou para trás`, href: unico.href };
  }
  if (unico && p.tipo === 'PRECISA_DA_EQUIPE') {
    return {
      texto: `“${unico.titulo}” precisa de alguém da equipe${unico.detalhe ? ` — ${unico.detalhe}` : ''}`,
      href: unico.href,
    };
  }
  /*
    UM ATO SÓ DIZ QUAL ATO E EM QUE PROCESSO. "1 ato do tribunal está sem
    ninguém decidir" manda procurar entre dezenas de linhas da ficha; "Recurso
    negado no processo 0001381-91…" já é a informação.
  */
  if (unico && p.tipo === 'ATO_ESPERANDO_OLHO' && unico.detalhe) {
    // O número vem cru do banco (20 dígitos); ninguém lê processo assim.
    return { texto: `${unico.detalhe} no processo ${mascararNPU(unico.titulo)}`, href: unico.href };
  }
  if (unico) return { texto: rotulo(p), href: unico.href };
  return { texto: rotulo(p), href: PENDENCIA[p.tipo].href };
}
