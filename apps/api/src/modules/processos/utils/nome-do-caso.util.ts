import { NpuUtils } from './npu.util';

/**
 * COMO O PROCESSO SE CHAMA NA AGENDA — e por que "filiado" não serve.
 *
 * O criador de pauta escrevia `processo.filiado?.nomeCompleto ?? 'filiado'`.
 * Nunca tinha rodado de verdade; quando rodou contra a produção, o título que
 * sairia era este:
 *
 *   Audiência inicial — filiado
 *
 * em **177 dos 204 processos**, porque `processos.filiado_id` é um ATALHO
 * DERIVADO e está nulo em 87% do acervo. Um cartão de agenda que não diz de
 * quem é o caso obriga a abrir o processo para saber se é o seu — que é
 * exatamente o trabalho que a automação deveria poupar.
 *
 * A fonte boa são as PARTES, que são dado nosso e estão preenchidas. Medido
 * em 15/10/2026, com a escada abaixo:
 *
 *   filiado do processo ....................... 27
 *   parte ligada a um filiado .................. 0   (existe, mas não hoje)
 *   parte que não é o sindicato .............. 172
 *   ninguém — só o número .................... 5
 *
 * O NOME ESCOLHIDO NÃO AFIRMA PAPEL. Ele responde "qual caso é este", e não
 * "quem representamos": em ação institucional o sindicato é parte e o nome
 * que identifica o caso é o do outro lado ("Audiência inicial — Estado do
 * Piauí"). Afirmar papel a partir de polo é o erro que já pôs a própria
 * filiada na coluna "réu" do painel, em 20 de 26 fichas.
 */

/** Limite do nome no título: cartão de agenda, e não petição. */
const MAX_NOME = 56;

/** "1. ESTADO DO PIAUÍ (AGRAVANTE)" → "ESTADO DO PIAUÍ". */
const RE_INDICE = /^\s*\d{1,2}\s*[.)-]\s*/;
const RE_PAPEL_NO_FIM = /\s*\((?:[^()]{1,40})\)\s*$/;

export type PoloDaParte = 'ATIVO' | 'PASSIVO' | (string & {});

export interface ParteParaNome {
  nome: string | null;
  polo: PoloDaParte;
  principal?: boolean | null;
  filiadoId?: string | null;
  filiado?: { nomeCompleto: string | null } | null;
  parteExterna?: { institucional: boolean } | null;
}

export interface ProcessoParaNome {
  numeroCNJ: string | null;
  filiado?: { nomeCompleto: string | null } | null;
  partes?: ParteParaNome[] | null;
}

/**
 * NOSSA = ligada a um filiado OU a organização institucional (o sindicato).
 *
 * Mesma definição de `vinculo-de-advogado.service`; duas definições de "nós"
 * discordariam na tela, e já discordaram antes em outro par de regras.
 *
 * E NÃO casa por NOME, de propósito. Seria tentador dizer "parte cujo nome
 * tem SINDICATO somos nós", e é errado: das 171 partes da produção com essa
 * palavra, 12 não têm a marca institucional porque são OUTROS sindicatos —
 * SINDSEP-DF, a Federação, o das Indústrias da Informação. Chamá-los de "nós"
 * esconderia justamente a parte que nomeia o caso. A marca é a verdade; o
 * nome é parecença.
 */
function ehNossa(p: ParteParaNome): boolean {
  return !!(p.filiadoId || p.parteExterna?.institucional);
}

/** Tira o índice da lista e o papel entre parênteses; corta o que não cabe. */
function limpar(nome: string): string {
  const limpo = nome.replace(RE_INDICE, '').replace(RE_PAPEL_NO_FIM, '').trim();
  if (!limpo) return '';
  return limpo.length > MAX_NOME ? `${limpo.slice(0, MAX_NOME - 1).trimEnd()}…` : limpo;
}

/**
 * O nome pelo qual a equipe reconhece o caso.
 *
 * Nunca devolve vazio: sem parte e sem filiado sobra o número formatado, e sem
 * número sobra "processo sem número" — que é a verdade sobre um pré-processual.
 */
export function nomeDoCaso(processo: ProcessoParaNome): string {
  const doFiliado = processo.filiado?.nomeCompleto?.trim();
  if (doFiliado) return limpar(doFiliado);

  const partes = (processo.partes ?? []).filter((p) => (p.nome ?? '').trim());

  const parteFiliada = partes.find((p) => p.filiadoId && p.filiado?.nomeCompleto?.trim());
  if (parteFiliada) return limpar(parteFiliada.filiado!.nomeCompleto!.trim());

  const nossas = partes.filter(ehNossa);
  const outras = partes.filter((p) => !ehNossa(p));
  if (outras.length) {
    /*
      O LADO OPOSTO AO NOSSO, quando dá para saber qual é o nosso. É o nome que
      identifica o caso em uma linha; quando o sindicato não está entre as
      partes, não há "oposto" nenhum e vale a primeira parte do polo ativo.
    */
    const nossoPolo = nossas[0]?.polo;
    const oposto = nossoPolo === 'ATIVO' ? 'PASSIVO' : nossoPolo === 'PASSIVO' ? 'ATIVO' : null;
    const escolhida =
      (oposto && outras.find((p) => p.polo === oposto)) ??
      outras.find((p) => p.polo === 'ATIVO') ??
      outras.find((p) => p.principal) ??
      outras[0];
    const nome = limpar((escolhida.nome ?? '').trim());
    if (nome) return nome;
  }

  return NpuUtils.formatar(processo.numeroCNJ) || 'processo sem número';
}
