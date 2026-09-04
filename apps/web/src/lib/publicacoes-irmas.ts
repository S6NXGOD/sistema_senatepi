/**
 * Agrupa as CÓPIAS de uma mesma publicação do DJEN.
 *
 * O DJEN publica UMA comunicação POR DESTINATÁRIO: a mesma intimação chega
 * duas, oito, doze vezes, com textos idênticos ou que só diferem em quem é
 * nomeado. Mostrar todas é mostrar a mesma notícia várias vezes — foi o que o
 * jurídico viu na gaveta da atividade em 03/09/2026.
 *
 * A CHAVE É O LINK DO DOCUMENTO NO TRIBUNAL, e isso saiu de medição, não de
 * intuição. Nas 136 publicações da produção: nenhum link nulo; 40 links com
 * exatamente duas publicações cada, todas do mesmo dia; e — o que confirma que
 * a chave é boa — os 11 casos de dois atos DIFERENTES publicados no mesmo dia
 * têm links diferentes. O link carrega o código de validação do documento, ou
 * seja, é identidade do ato, não semelhança.
 *
 * O plano B (texto) existe porque o link é opcional no modelo e pode faltar num
 * tribunal que ainda não vimos. Aí vale data + semelhança de palavras, e o
 * corte de 0,9 também é medido: dentro de um mesmo link, a menor semelhança
 * observada foi 0,912; entre atos distintos do mesmo dia, a maior foi 0,101.
 * A data é obrigatória no plano B porque atos de DIAS diferentes chegaram a
 * 0,921 — acima da irmã real mais divergente.
 */

export interface PublicacaoAgrupavel {
  id: string;
  texto: string;
  dataDisponibilizacao: string;
  link?: string | null;
}

export interface GrupoDePublicacoes<T extends PublicacaoAgrupavel> {
  /** A versão mais completa — é ela que se lê. */
  principal: T;
  /** As outras cópias da mesma comunicação. Nunca inclui a principal. */
  copias: T[];
}

/** Semelhança mínima, entre publicações do MESMO dia, no plano B. */
export const SEMELHANCA_MINIMA = 0.9;

/** Palavras menores que isto são preposição e artigo — não distinguem nada. */
const TAMANHO_MINIMO_PALAVRA = 4;

function palavras(texto: string): Set<string> {
  return new Set(
    texto
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toUpperCase()
      .split(/[^A-Z0-9]+/)
      .filter((p) => p.length >= TAMANHO_MINIMO_PALAVRA),
  );
}

/** Jaccard sobre o conjunto de palavras: |A∩B| / |A∪B|. */
export function semelhanca(a: string, b: string): number {
  const A = palavras(a);
  const B = palavras(b);
  if (!A.size && !B.size) return 1;
  let comuns = 0;
  for (const p of A) if (B.has(p)) comuns++;
  return comuns / (A.size + B.size - comuns);
}

/** Só a data, sem hora — o DJEN disponibiliza por dia. */
function dia(iso: string): string {
  return iso.slice(0, 10);
}

function ehCopia(a: PublicacaoAgrupavel, b: PublicacaoAgrupavel): boolean {
  if (a.link && b.link) return a.link === b.link;
  return (
    dia(a.dataDisponibilizacao) === dia(b.dataDisponibilizacao) &&
    semelhanca(a.texto, b.texto) >= SEMELHANCA_MINIMA
  );
}

export function agruparPublicacoes<T extends PublicacaoAgrupavel>(
  publicacoes: T[],
): GrupoDePublicacoes<T>[] {
  const grupos: GrupoDePublicacoes<T>[] = [];

  for (const pub of publicacoes) {
    const irmao = grupos.find((g) => ehCopia(g.principal, pub));
    if (!irmao) {
      grupos.push({ principal: pub, copias: [] });
      continue;
    }
    // A mais longa vira a principal: é a que nomeia mais partes e advogados.
    if (pub.texto.length > irmao.principal.texto.length) {
      irmao.copias.push(irmao.principal);
      irmao.principal = pub;
    } else {
      irmao.copias.push(pub);
    }
  }

  return grupos;
}
