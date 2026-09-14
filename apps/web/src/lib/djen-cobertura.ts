/**
 * O QUE O ROBÔ DO DIÁRIO ALCANÇA — a leitura, na tela, do que a API decidiu.
 *
 * Medido em 14/09/2026: os 8 advogados ativos têm OAB PI, mas a Lara Cortez
 * está sem OAB, e as intimações de quem não tem OAB no cadastro não chegam pela
 * busca por OAB. Nada na tela dizia isso. Vira ESTADO na tela de Usuários e na
 * aba Publicações da ficha, sem cor de alerta e sem notificação.
 *
 * AS FRASES NASCEM NA API (`coberturaDoDiario` em djen-leitura.util.ts). Ela
 * sabe o que a tela não sabe: se o processo é vivo (número toda noite) ou
 * dormente (a cada 7 dias), se o histórico já foi lido, e o dia de Teresina.
 * Uma cópia da regra aqui divergiria da primeira, então o web só confere o
 * formato e mostra.
 *
 * Na janela de troca a API pode ainda não trazer os campos: ausente é "sem
 * informação", e a tela não mostra linha nenhuma, em vez de afirmar algo que
 * não sabe.
 */

/** Resposta de `GET /djen/processo/:processoId/cobertura`. */
export interface CoberturaDoDiario {
  /** Advogados da equipe NESTE processo cuja OAB a varredura consulta. */
  porOab: { id: string; nome: string }[];
  /** Última consulta pelo número do processo (instante, ISO). */
  ultimaConsultaNumero: string | null;
  historicoLidoEm?: string | null;
  frequenciaDoNumero?: 'TODA_NOITE' | 'SEMANAL' | null;
  /** As frases da linha de estado, na ordem, prontas. */
  linhas?: string[];
}

/**
 * AS FRASES QUE A ABA MOSTRA, ou `null` para não mostrar nada.
 *
 * Só texto de verdade passa: item vazio ou que não é texto some, e resposta
 * sem `linhas` (formato anterior ou incompleto) não vira linha inventada.
 */
export function linhasDaCobertura(
  cobertura: Partial<CoberturaDoDiario> | null | undefined,
): string[] | null {
  if (!cobertura || !Array.isArray(cobertura.linhas)) return null;
  const linhas = cobertura.linhas
    .filter((l): l is string => typeof l === 'string')
    .map((l) => l.trim())
    .filter(Boolean);
  return linhas.length ? linhas : null;
}

/**
 * QUEM ESTÁ SEM OAB, pelo `advogadosSemOab` do `GET /djen/status`.
 *
 * `null` quando o campo não veio (API anterior a 14/09/2026, ou a resposta
 * antiga com um NÚMERO no lugar da lista): a tela de Usuários não mostra a
 * linha. Lista vazia = ninguém sem OAB, o que é informação.
 */
export function idsSemOab(
  status: { ativo?: boolean; advogadosSemOab?: unknown } | null | undefined,
): Set<string> | null {
  if (!status?.ativo) return null;
  const lista = status.advogadosSemOab;
  if (!Array.isArray(lista)) return null;
  return new Set(
    lista
      .map((a) => (a && typeof a === 'object' ? (a as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
}

export const FRASE_SEM_OAB =
  'Sem OAB no cadastro. O robô do Diário não recebe as intimações desta pessoa.';
