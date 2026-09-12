import { IMPROCEDENCIA, PROCEDENCIA, PROCEDENCIA_PARCIAL } from '../processos/padroes.service';

/**
 * AS CONTAS PURAS DO RELATÓRIO — fora do serviço para poderem ser provadas sem
 * banco. O serviço busca; aqui só se soma e se arruma.
 */

/** Seis anos: dá para ver tendência e ainda cabe numa tela de celular. */
export const ANOS_NA_SERIE = 6;

export type ResultadoSentenca = 'PROCEDENTE' | 'PARCIAL' | 'IMPROCEDENTE';

export interface SentencasDoAno {
  ano: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
}

export interface AjuizadasDoAno {
  ano: number;
  processos: number;
}

/** O desfecho que o TRIBUNAL carimbou. Código fora da lista não vira resultado. */
export function resultadoDoCodigo(codigo: number | null | undefined): ResultadoSentenca | null {
  if (codigo === PROCEDENCIA) return 'PROCEDENTE';
  if (codigo === PROCEDENCIA_PARCIAL) return 'PARCIAL';
  if (codigo === IMPROCEDENCIA) return 'IMPROCEDENTE';
  return null;
}

/** Os anos da série, do mais antigo ao corrente. */
export function anosDaSerie(anoFinal: number, quantos = ANOS_NA_SERIE): number[] {
  return Array.from({ length: quantos }, (_, i) => anoFinal - quantos + 1 + i);
}

/**
 * SENTENÇAS POR ANO — com os anos ZERADOS no meio.
 *
 * Mesmo motivo de `serieCompleta` no Panorama: ano sem sentença nenhuma é
 * informação, e pular o ano faria a série contar outra história.
 */
export function serieDeSentencas(
  linhas: { ano: number; codigo: number; processos: number }[],
  anos: number[],
): SentencasDoAno[] {
  return anos.map((ano) => {
    const soma = (codigo: number) =>
      linhas
        .filter((l) => l.ano === ano && l.codigo === codigo)
        .reduce((total, l) => total + l.processos, 0);
    return {
      ano,
      procedentes: soma(PROCEDENCIA),
      parciais: soma(PROCEDENCIA_PARCIAL),
      improcedentes: soma(IMPROCEDENCIA),
    };
  });
}

export function serieDeAjuizadas(
  linhas: { ano: number; processos: number }[],
  anos: number[],
): AjuizadasDoAno[] {
  return anos.map((ano) => ({
    ano,
    processos: linhas.filter((l) => l.ano === ano).reduce((total, l) => total + l.processos, 0),
  }));
}

/**
 * UMA LINHA POR PROCESSO na lista de sentenças do período.
 *
 * Embargos e sentença refeita existem: o mesmo processo pode ter dois carimbos
 * de julgamento na mesma janela. Vale o mais recente — a lista chega do mais
 * novo para o mais antigo, então o primeiro de cada processo é o que fica.
 */
export function umaPorProcesso<T extends { processoId: string }>(itens: T[]): T[] {
  const vistos = new Set<string>();
  return itens.filter((item) => {
    if (vistos.has(item.processoId)) return false;
    vistos.add(item.processoId);
    return true;
  });
}

/**
 * A COMARCA LEVA A UF SÓ QUANDO A UF INFORMA.
 *
 * "Teresina (PI)" em toda linha de um sindicato do Piauí repete o óbvio. Fora
 * do estado a sigla é o dado: "Brasília (DF)" diz que o caso subiu ou tramita
 * longe de casa.
 */
export function rotuloDaComarca(nome: string, uf: string, ufDaCasa: string): string {
  const sigla = uf.trim().toUpperCase();
  return sigla === ufDaCasa.trim().toUpperCase() ? nome : `${nome} (${sigla})`;
}
