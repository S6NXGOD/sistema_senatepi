import { api } from './api';

/**
 * PADRÕES NO ACERVO — o que só aparece olhando os processos juntos.
 *
 * A API devolve CONTAGEM e RÓTULO; a frase é daqui. É de propósito: no dia em
 * que alguém quiser corrigir a redação de uma leitura jurídica, o lugar de
 * mexer é um arquivo de interface, não uma consulta SQL.
 */

export type LeituraConcentracao =
  | 'DESFECHO_SEMPRE_CONTRA'
  | 'DESFECHO_SEMPRE_A_FAVOR'
  | 'COLETIVA_POSSIVEL'
  | 'REINCIDENCIA';

export interface Desfechos {
  julgados: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
}

export interface PedidoRecorrente {
  assunto: string;
  processos: number;
}

export interface Concentracao extends Desfechos {
  parteExternaId: string;
  adversario: string;
  processos: number;
  individuais: number;
  desde: string | null;
  pedidos: PedidoRecorrente[];
  leituras: LeituraConcentracao[];
}

export interface PorAno {
  ano: number;
  processos: number;
}

export interface Dispersao extends Desfechos {
  assunto: string;
  processos: number;
  adversarios: number;
  individuais: number;
  desde: string | null;
  /** Ações por ano, com os anos zerados no meio — a lacuna é informação. */
  porAno: PorAno[];
}

export interface Panorama {
  concentracoes: Concentracao[];
  dispersoes: Dispersao[];
  /**
   * De que lado a entidade está. As três somam o acervo inteiro — é partição,
   * não amostra.
   */
  nossoPapel: { autor: number; reu: number; representando: number };
  acervoAtivo: number;
  geradoEm: string;
}

export async function carregarPanorama(): Promise<Panorama> {
  return (await api.get<Panorama>('/panorama')).data;
}

/**
 * A LEITURA EM PORTUGUÊS — e cada frase termina numa decisão de quem lê, nunca
 * numa ordem.
 *
 * O sistema soma processos; ele não sabe de estratégia processual, de prazo de
 * prescrição, de conversa que já houve com o empregador. Dizer "ajuíze uma
 * coletiva" com base em três linhas de banco é opinar sobre o ofício de quem
 * está lendo, e basta errar uma vez para o painel inteiro virar ruído.
 */
export const LEITURA: Record<
  LeituraConcentracao,
  { titulo: string; explicacao: string; tom: 'alerta' | 'favoravel' | 'neutro' }
> = {
  DESFECHO_SEMPRE_CONTRA: {
    titulo: 'O resultado tem sido sempre contrário',
    explicacao:
      'Todas as ações já julgadas contra este réu deram improcedentes. Cada uma, ' +
      'isolada, parece azar; juntas, é o mesmo argumento não convencendo o mesmo juízo. ' +
      'Vale rever a tese antes da próxima.',
    tom: 'alerta',
  },
  DESFECHO_SEMPRE_A_FAVOR: {
    titulo: 'O resultado tem sido sempre favorável',
    explicacao:
      'Todas as ações já julgadas contra este réu foram procedentes, inteiras ou em ' +
      'parte. É o histórico mais forte que se leva para uma mesa de negociação.',
    tom: 'favoravel',
  },
  COLETIVA_POSSIVEL: {
    titulo: 'São ações individuais pedindo a mesma coisa',
    explicacao:
      'O mesmo pedido, contra o mesmo empregador, em processos separados — a situação ' +
      'que a substituição processual existe para resolver. Discutir de uma vez o que ' +
      'hoje se discute em vários autos é uma decisão de quem conduz.',
    tom: 'neutro',
  },
  REINCIDENCIA: {
    titulo: 'O mesmo réu responde de novo pelo mesmo pedido',
    explicacao:
      'Ainda sem desfecho uniforme e sem maioria de ações individuais — mas a repetição ' +
      'já diz que não é caso isolado.',
    tom: 'neutro',
  },
};

/** "3 de 5 julgadas" em uma linha, sem transformar em porcentagem falsa. */
export function resumoDesfechos(d: Desfechos): string | null {
  if (!d.julgados) return null;
  const partes: string[] = [];
  if (d.procedentes) partes.push(`${d.procedentes} procedente${d.procedentes > 1 ? 's' : ''}`);
  if (d.parciais) partes.push(`${d.parciais} procedente${d.parciais > 1 ? 's' : ''} em parte`);
  if (d.improcedentes) {
    partes.push(`${d.improcedentes} improcedente${d.improcedentes > 1 ? 's' : ''}`);
  }
  return `${d.julgados} já julgada${d.julgados > 1 ? 's' : ''}: ${partes.join(', ')}`;
}

/**
 * A LEITURA DA TENDÊNCIA — e ela só fala quando há o que dizer.
 *
 * Compara os DOIS últimos anos fechados com os dois anteriores, e não o último
 * ano com o penúltimo: um único ano fraco por acaso viraria "está caindo". O
 * ano corrente fica de fora do cálculo — ele está pela metade e puxaria toda
 * série para baixo em janeiro.
 *
 * Devolve `null` quando não há base: menos de quatro anos de série, ou variação
 * pequena demais para significar alguma coisa.
 */
export function tendencia(porAno: PorAno[]): 'CRESCENDO' | 'DIMINUINDO' | null {
  const anoCorrente = new Date().getFullYear();
  const fechados = porAno.filter((a) => a.ano < anoCorrente);
  if (fechados.length < 4) return null;

  const soma = (xs: PorAno[]) => xs.reduce((t, a) => t + a.processos, 0);
  const recentes = soma(fechados.slice(-2));
  const anteriores = soma(fechados.slice(-4, -2));
  if (recentes + anteriores < 4) return null; // amostra pequena demais

  // Metade a mais (ou a menos) é o piso para chamar de movimento.
  if (recentes >= anteriores * 1.5) return 'CRESCENDO';
  if (anteriores >= recentes * 1.5) return 'DIMINUINDO';
  return null;
}
