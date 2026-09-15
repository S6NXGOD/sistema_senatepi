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

/**
 * A LINHA EM DUAS (15/09/2026). As frases saíam coladas num parágrafo só de
 * `text-xs`, e a que responde a pergunta ("por onde chega?") se perdia no meio
 * das datas. A primeira frase é a principal; as outras (a data da consulta
 * pelo número, o histórico ainda não lido) vão embaixo, menores.
 */
export function partesDaCobertura(
  cobertura: Partial<CoberturaDoDiario> | null | undefined,
): { principal: string; apoio: string[] } | null {
  const linhas = linhasDaCobertura(cobertura);
  if (!linhas) return null;
  const [principal, ...apoio] = linhas;
  return { principal, apoio };
}

export const FRASE_SEM_OAB =
  'Sem OAB no cadastro. O robô do Diário não recebe as intimações desta pessoa.';

export const FRASE_OAB_SEM_UF =
  'OAB incompleta: falta a UF. O robô do Diário não recebe as intimações desta pessoa.';

/**
 * QUAL DAS DUAS FRASES (15/09/2026).
 *
 * A API põe na lista quem não tem OAB CONSULTÁVEL (`oabConsultavel`: número e
 * UF de duas letras). Quem tinha o número e não a UF lia "Sem OAB no cadastro"
 * olhando para o número na própria ficha. A mesma régua aqui só escolhe a
 * frase; quem entra na lista continua sendo decisão da API.
 */
export function fraseSemOab(usuario: { oab?: string | null; oabUf?: string | null }): {
  frase: string;
  acao: string;
} {
  const numero = (usuario.oab ?? '').replace(/\D/g, '');
  const uf = (usuario.oabUf ?? '').trim().toUpperCase();
  if (numero && !/^[A-Z]{2}$/.test(uf)) return { frase: FRASE_OAB_SEM_UF, acao: 'Preencher a UF' };
  return { frase: FRASE_SEM_OAB, acao: 'Preencher OAB' };
}
