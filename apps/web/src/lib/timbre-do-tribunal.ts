/**
 * O TIMBRE DO TRIBUNAL NÃO É A NOTÍCIA.
 *
 * Toda publicação do DJEN começa com o mesmo cabeçalho institucional:
 *
 *   "PODER JUDICIÁRIO JUSTIÇA DO TRABALHO TRIBUNAL REGIONAL DO TRABALHO DA 22ª
 *    REGIÃO VARA DO TRABALHO DE PARNAÍBA ATSum 0002664-81.2025.5.22.0101
 *    AUTOR: SINDICATO DOS ENFERMEIROS… RÉU: INSTITUTO SAÚDE E CIDADANIA - ISAC
 *    INTIMAÇÃO Fica V. Sa. intimado para tomar ciência da Decisão…"
 *
 * Medido em 07/09/2026 sobre as 1.420 publicações da produção: **1.257 (89%)**
 * começam assim, e o cabeçalho tem em média **304 caracteres**. O cartão mostra
 * ~600 antes do "Ler tudo" — ou seja, METADE do que a pessoa lê numa lista de
 * 1.420 atos é órgão, número e partes que o próprio cartão já exibe logo acima,
 * estruturado e com as partes capitalizadas.
 *
 * O corte é no primeiro MARCO DE CONTEÚDO ("INTIMAÇÃO", "DESPACHO", "SENTENÇA"…)
 * — a palavra com que o tribunal anuncia o que o documento é.
 *
 * DUAS TRAVAS CONTRA CORTAR DEMAIS, porque esconder texto de tribunal é pior
 * que mostrar texto demais:
 *
 *  1. Só corta se o texto REALMENTE começa com timbre. Sem isso, um acórdão que
 *     mencione "DECISÃO" no meio da ementa perderia a ementa.
 *  2. Só corta até 900 caracteres. Um marco que aparece lá adiante não é o
 *     título do documento, é uma citação dentro dele.
 *
 * Não achou marco? Devolve o texto inteiro, como antes. O timbre nunca é
 * jogado fora — ele volta em "Ler tudo", porque é o documento oficial e alguém
 * pode precisar conferir a vara.
 */

/** Como o tribunal anuncia o que o documento é. */
const MARCOS = [
  'INTIMAÇÃO', 'INTIMACAO',
  'NOTIFICAÇÃO', 'NOTIFICACAO',
  'CITAÇÃO', 'CITACAO',
  'DESPACHO',
  'DECISÃO', 'DECISAO',
  'SENTENÇA', 'SENTENCA',
  'ACÓRDÃO', 'ACORDAO',
  'CERTIDÃO', 'CERTIDAO',
  'ATA DE',
  'EDITAL',
];

/** O texto abre com cabeçalho institucional? */
const COMECA_COM_TIMBRE = /^\s*(PODER\s+JUDICI|JUSTI[ÇC]A\s+D|TRIBUNAL\s|SUPERIOR\s+TRIBUNAL)/i;

/** Depois disto, um marco já não é o título do documento — é citação interna. */
const LIMITE_DO_TIMBRE = 900;

export interface AtoSemTimbre {
  /** O cabeçalho institucional, se houver — some do resumo, volta no inteiro. */
  timbre: string;
  /** O que interessa ler primeiro. Igual ao texto inteiro quando não há timbre. */
  corpo: string;
}

export function separarTimbre(texto: string): AtoSemTimbre {
  const t = texto ?? '';
  if (!COMECA_COM_TIMBRE.test(t)) return { timbre: '', corpo: t };

  let corte = -1;
  for (const m of MARCOS) {
    // A partir de 1: um texto que COMEÇA com o marco não tem timbre a remover.
    const i = t.indexOf(m, 1);
    if (i > 0 && i < LIMITE_DO_TIMBRE && (corte < 0 || i < corte)) corte = i;
  }
  if (corte < 0) return { timbre: '', corpo: t };

  return { timbre: t.slice(0, corte).trim(), corpo: t.slice(corte).trim() };
}
