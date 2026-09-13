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

export interface TextoRepetido {
  texto: string;
  total: number;
}

/** A partir de quantas vezes um texto de "Outro" sai com nome no relatório. */
export const REPETICOES_PARA_MOSTRAR = 2;

/**
 * A CHAVE DE AGRUPAMENTO DE "OUTRO": minúsculas, sem acento, espaços colapsados.
 *
 * Função LOCAL, de propósito. A `normalizarNome` do editor de partes COLA as
 * palavras, e "plano de saúde" viraria "planodesaude" — a mesma armadilha que
 * já quebrou a busca por palavra.
 */
export function chaveDoAssuntoOutro(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O QUE HÁ DENTRO DE "OUTRO" — sem expor caso individual.
 *
 * O objetivo é achar a categoria que falta, e o sinal disso é a REPETIÇÃO. Só
 * entra com nome o texto que aparece `REPETICOES_PARA_MOSTRAR` vezes ou mais; o
 * resto vira só um número (`outrosUnicos`). Texto único de 80 caracteres num
 * PDF da diretoria pode identificar uma pessoa ("demissão da Maria da UBS").
 *
 * O rótulo é a grafia mais usada no grupo (empate: a primeira em ordem
 * alfabética, para a mesma entrada dar sempre a mesma saída). Registro de
 * "Outro" sem o texto — todos os anteriores a 13/09/2026 — não entra em
 * nenhuma das duas contas: não há o que agrupar.
 */
export function outrosDoAssunto(
  atendimentos: { assunto: string | null; assuntoOutro?: string | null }[],
): { outrosAssuntos: TextoRepetido[]; outrosUnicos: number } {
  const grupos = new Map<string, Map<string, number>>();
  for (const a of atendimentos) {
    if (a.assunto !== 'OUTRO' || !a.assuntoOutro) continue;
    const grafia = a.assuntoOutro.replace(/\s+/g, ' ').trim();
    const chave = chaveDoAssuntoOutro(grafia);
    if (!chave) continue;
    const grafias = grupos.get(chave) ?? new Map<string, number>();
    grafias.set(grafia, (grafias.get(grafia) ?? 0) + 1);
    grupos.set(chave, grafias);
  }

  const outrosAssuntos: TextoRepetido[] = [];
  let outrosUnicos = 0;
  for (const grafias of grupos.values()) {
    const total = [...grafias.values()].reduce((s, n) => s + n, 0);
    if (total < REPETICOES_PARA_MOSTRAR) {
      outrosUnicos++;
      continue;
    }
    const [texto] = [...grafias.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'),
    )[0];
    outrosAssuntos.push({ texto, total });
  }
  outrosAssuntos.sort((a, b) => b.total - a.total || a.texto.localeCompare(b.texto, 'pt-BR'));
  return { outrosAssuntos, outrosUnicos };
}
