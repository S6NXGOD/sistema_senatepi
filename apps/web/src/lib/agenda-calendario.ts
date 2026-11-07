import { estadoDoPrazoEm, type Compromisso } from './agenda';

/**
 * O QUE O DIA DO CALENDÁRIO MOSTRA — decidido aqui, desenhado em `calendario-view`.
 *
 * O PEDIDO (07/11/2026): o dono mandou o print de um calendário de referência e
 * escreveu *"se inspire no visual"*, junto com *"essas atividades estão poluindo
 * demais"*. Na referência, nove consultas de um mesmo dia são UMA linha,
 * "9× Consulta Jurídica"; aqui eram nove, uma por advogado, e o dia mais cheio
 * do mês virava uma coluna de "09:00 Elaborar mani…".
 *
 * TRÊS REGRAS, e cada uma resolve uma confusão que a tela tinha:
 *
 * 1. O MESMO TIPO NO MESMO DIA VIRA UMA LINHA COM A CONTAGEM. Uma só continua
 *    mostrando o título, que é mais útil que o nome do tipo.
 *
 * 2. CONCLUÍDA FICA RISCADA, e num grupo separado das abertas. Antes ela tinha
 *    a mesma cara da pendente: a consulta já feita de quarta parecia esperar
 *    alguém, e não havia como saber sem abrir.
 *
 * 3. CANCELADA SAI DA GRADE. O calendário responde "o que tem no dia 14?", e o
 *    que foi cancelado não tem. Ele continua na lista do dia, no quadro e no
 *    histórico — só não ocupa a célula. Sem isso, o cancelamento automático por
 *    falta de interação não limparia nada da tela.
 */

export interface ChipDoDia {
  /** Estável entre renderizações: tipo + se é o grupo das concluídas. */
  chave: string;
  tipo: string;
  feita: boolean;
  /** Pendente que o dia já deixou para trás — fica em âmbar, como no painel. */
  atrasada: boolean;
  itens: Compromisso[];
}

/** O que ocupa a célula: tudo menos o cancelado. */
export function noCalendario(compromissos: Compromisso[]): Compromisso[] {
  return compromissos.filter((c) => c.status !== 'CANCELADO');
}

/**
 * Os chips de UM dia, na ordem em que aparecem: primeiro o que ainda está
 * aberto (pela hora do primeiro item), depois o que já foi feito. `agora` entra
 * por parâmetro para a regra poder ser testada com uma data fixa.
 */
export function chipsDoDia(eventosDoDia: Compromisso[], agora: number = Date.now()): ChipDoDia[] {
  const ordenados = noCalendario(eventosDoDia).sort(
    (a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime(),
  );
  const grupos = new Map<string, ChipDoDia>();
  for (const c of ordenados) {
    const feita = c.status === 'CONCLUIDO';
    const chave = `${c.tipo}|${feita ? 'feita' : 'aberta'}`;
    const chip = grupos.get(chave) ?? { chave, tipo: c.tipo, feita, atrasada: false, itens: [] };
    chip.itens.push(c);
    if (!feita && estadoDoPrazoEm(c, agora) === 'ATRASADA') chip.atrasada = true;
    grupos.set(chave, chip);
  }
  const todos = [...grupos.values()];
  return [...todos.filter((g) => !g.feita), ...todos.filter((g) => g.feita)];
}

/** Quantos chips cabem na célula do computador antes do "+N mais". */
export const CHIPS_POR_DIA = 3;

/** Os chips à vista e quantas ATIVIDADES (não grupos) ficaram escondidas. */
export function chipsAVista(chips: ChipDoDia[], limite = CHIPS_POR_DIA) {
  const aVista = chips.slice(0, limite);
  const escondidas = chips.slice(limite).reduce((n, g) => n + g.itens.length, 0);
  return { aVista, escondidas };
}
