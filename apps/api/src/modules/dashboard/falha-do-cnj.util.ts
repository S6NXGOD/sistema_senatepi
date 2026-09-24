import { DIAS_RECHECAGEM_DORMENTE } from '../processos/utils/varredura.util';

/**
 * "ESTE PROCESSO ESTÁ ATRASADO?" — e a régua é a do PRÓPRIO ROBÔ.
 *
 * 24/09/2026. A faixa do painel anunciava *"1 processo está sem leitura do CNJ
 * há mais de 48h"* e abria uma lista de 25 linhas iguais. Medido na produção
 * naquela manhã, três coisas estavam erradas ao mesmo tempo:
 *
 * **1. A régua de 48h não vale para todo mundo.** Os três processos acusados
 * eram `ENCERRADO` — a faixa LENTA da varredura, que o robô relê de propósito
 * a cada `DIAS_RECHECAGEM_DORMENTE` dias. O histórico deles é 31/08 → 08/09 →
 * 16/09 → 24/09: exatamente o ciclo prometido. Cobrar 48 horas de quem o robô
 * só visita a cada oito dias é acusar de atraso um processo que está em dia
 * **por desenho** — e isso nunca deixaria de acontecer.
 *
 * `varredura.util` já dizia isto, com todas as letras, sobre outro aviso:
 * *"acusar de inércia um processo que o robô nem consulta seria cobrar
 * movimento de quem ninguém está olhando"*. Era a mesma regra, e esta tela não
 * a seguia.
 *
 * **2. O corte escondia justamente o que pedia atenção.** A consulta terminava
 * em `ORDER BY created_at DESC LIMIT 25` — os 25 mais RECENTES. Havia **27**
 * falhas, e os processos mais atrasados haviam falhado no começo da rodada
 * (02:00–02:07), então caíam fora do corte: **2 dos 3 sumiram da tela**, e a
 * frase dizia "1" onde eram 3.
 *
 * **3. A frase mentia na conta.** "Outros 24" era `25 - 1`, calculado sobre a
 * lista já truncada. O número certo era 24 de 27.
 *
 * ## A régua: DOIS CICLOS sem leitura
 *
 * Um processo está atrasado quando perdeu **duas voltas inteiras** do ciclo em
 * que o robô se comprometeu a lê-lo. Não é um número escolhido a dedo: é o
 * mesmo critério para os dois ritmos, e por isso não precisa ser reajustado
 * quando o ciclo muda.
 *
 *   vivo (lido toda noite) ........ ciclo de 1 dia  → atrasado com 48h
 *   dormente (a cada 7 dias) ...... ciclo de 7 dias → atrasado com 336h (14d)
 *
 * Uma volta de folga é o soluço da rodada — o CNJ engasga, a próxima tentativa
 * resolve. Duas voltas é padrão: aí alguém precisa olhar.
 */

/** O ciclo prometido pela varredura, em dias. */
export function cicloEmDias(dormente: boolean): number {
  return dormente ? DIAS_RECHECAGEM_DORMENTE : 1;
}

/**
 * Quantas horas sem leitura até o processo virar alarme.
 *
 * Duas voltas do ciclo dele: 48h para o vivo, 336h para o dormente.
 */
export function horasAteOAtraso(dormente: boolean): number {
  return cicloEmDias(dormente) * 2 * 24;
}

export interface FalhaParaAvaliar {
  /** Última leitura bem-sucedida. `null` = nunca foi lido. */
  ultimoSucesso: Date | string | null;
  /** O processo está na faixa LENTA da varredura (encerrado, arquivado…). */
  dormente: boolean;
  /** Quando a tentativa que falhou aconteceu — só desempata a ordem. */
  createdAt: Date | string;
}

const emMs = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * Faz quanto tempo que este processo não é lido com sucesso, em horas.
 * `null` quando nunca foi lido — que é pior que qualquer número.
 */
export function horasSemLeitura(f: FalhaParaAvaliar, agora: Date): number | null {
  if (!f.ultimoSucesso) return null;
  return (agora.getTime() - emMs(f.ultimoSucesso)) / 3_600_000;
}

export function estaAtrasada(f: FalhaParaAvaliar, agora: Date): boolean {
  const horas = horasSemLeitura(f, agora);
  if (horas === null) return true; // nunca lido
  return horas > horasAteOAtraso(f.dormente);
}

/**
 * A ORDEM QUE O CORTE PODE TRUNCAR SEM MENTIR.
 *
 * Primeiro o que pede atenção, do mais abandonado para o menos; depois o
 * tropeço da rodada, do mais recente para o mais antigo. Assim um `LIMIT` só
 * come o que não estava pedindo nada.
 *
 * Nunca lido vem antes de tudo: não há número que expresse "nunca".
 */
export function ordenarFalhas<T extends FalhaParaAvaliar>(falhas: T[], agora: Date): T[] {
  const peso = (f: T) => {
    if (!f.ultimoSucesso) return Number.POSITIVE_INFINITY;
    return (horasSemLeitura(f, agora) ?? 0) / horasAteOAtraso(f.dormente);
  };
  return [...falhas].sort((a, b) => {
    const atrA = estaAtrasada(a, agora);
    const atrB = estaAtrasada(b, agora);
    if (atrA !== atrB) return atrA ? -1 : 1;
    if (atrA) return peso(b) - peso(a); // o mais abandonado primeiro
    return emMs(b.createdAt) - emMs(a.createdAt); // o tropeço mais recente
  });
}

export interface ResumoDasFalhas {
  /** Quantos processos falharam na última tentativa — o número REAL, sem corte. */
  total: number;
  /** Destes, quantos estão sem leitura há dois ciclos. */
  atrasados: number;
  /** Quantos tropeçaram na rodada mas seguem dentro do ciclo. */
  emDia: number;
  /** Quantos vão na lista — menor que `total` quando o corte agiu. */
  mostrando: number;
}

export function resumirFalhas(
  falhas: FalhaParaAvaliar[],
  agora: Date,
  mostrando: number,
): ResumoDasFalhas {
  const atrasados = falhas.filter((f) => estaAtrasada(f, agora)).length;
  return {
    total: falhas.length,
    atrasados,
    emDia: falhas.length - atrasados,
    mostrando: Math.min(mostrando, falhas.length),
  };
}
