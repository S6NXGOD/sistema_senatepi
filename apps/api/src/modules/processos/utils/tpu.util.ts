/**
 * Códigos da TPU (Tabela Processual Unificada do CNJ) que mudam o que a equipe
 * precisa fazer.
 *
 * POR QUE ESTE ARQUIVO EXISTE, SE JÁ HÁ UM CLASSIFICADOR
 * `audiencia.util.ts` responde "isto vira atividade na agenda?" — decisão de
 * AUTOMAÇÃO, conservadora de propósito: na dúvida, não cria tarefa. Aqui a
 * pergunta é outra: "isto merece o olho de alguém?". Um ato pode não gerar
 * tarefa e ainda assim precisar de atenção, e juntar as duas perguntas na mesma
 * tabela faria uma estragar a outra — afrouxar para sinalizar mais encheria a
 * agenda de tarefas falsas.
 *
 * A LISTA É CURTA DE PROPÓSITO. Só entra código cujo nome foi CONFERIDO contra a
 * API pública do CNJ (`movimentos.codigo` → `movimentos.nome`), em processos
 * reais do TJPI e do TRT22. Palpite pela tabela publicada não entra: na
 * conferência, o código 581 — que eu esperava ser "Citação" — é "Documento", e
 * teria virado alarme falso em toda ficha.
 *
 * COMO ACRESCENTAR UM CÓDIGO
 * Consulte antes o nome real:
 *   POST api_publica_<tribunal>/_search
 *   {"size":50,"query":{"terms":{"movimentos.codigo":[<codigo>]}},
 *    "_source":["movimentos"]}
 * Se o código não aparecer na amostra, ele não é usado por aquele tribunal —
 * e não vale a pena adivinhar o significado.
 */

/** Grau de atenção que o ato exige. */
export type NivelAtencao = 'PRAZO' | 'DECISAO' | 'ENCERRAMENTO';

export interface AtoCritico {
  nivel: NivelAtencao;
  /** Como o ato é chamado na ficha — o nome da TPU costuma ser burocrático. */
  rotulo: string;
}

export const ATOS_CRITICOS: ReadonlyMap<number, AtoCritico> = new Map<number, AtoCritico>([
  // ---- Prazo correndo: o que não pode passar batido ----
  [92, { nivel: 'PRAZO', rotulo: 'Publicação' }],
  [60, { nivel: 'PRAZO', rotulo: 'Expedição de documento' }],
  [1061, { nivel: 'PRAZO', rotulo: 'Disponibilização no Diário' }],

  // ---- Decisão a ler ----
  [219, { nivel: 'DECISAO', rotulo: 'Procedência' }],

  // ---- Fim de linha: muda o acompanhamento ----
  [22, { nivel: 'ENCERRAMENTO', rotulo: 'Baixa definitiva' }],
  [246, { nivel: 'ENCERRAMENTO', rotulo: 'Arquivamento definitivo' }],
  [848, { nivel: 'ENCERRAMENTO', rotulo: 'Trânsito em julgado' }],
  [893, { nivel: 'ENCERRAMENTO', rotulo: 'Desarquivamento' }],
]);

/**
 * DELIBERADAMENTE FORA — documentado para ninguém acrescentar achando que foi
 * esquecimento:
 *
 *  1051 "Decurso de Prazo"  — é o FIM de um prazo, não a abertura de um.
 *                             Sinalizar pediria ação sobre algo que já acabou.
 *  11010 "Mero expediente"  — por definição não decide nada; entraria como
 *                             ruído em praticamente todo processo.
 *  581 "Documento"          — nome genérico demais para significar algo.
 *  51 "Conclusão"           — etapa interna do cartório.
 *  26 "Distribuição"        — acontece uma vez, no começo, e já é visível.
 *  970 "Audiência"          — a agenda já cuida, com regra própria e mais
 *                             cuidadosa (ver audiencia.util.ts).
 */
export const CODIGOS_IGNORADOS_DE_PROPOSITO = [1051, 11010, 581, 51, 26, 970] as const;

export function atoCritico(codigo: number | null | undefined): AtoCritico | null {
  return codigo == null ? null : (ATOS_CRITICOS.get(codigo) ?? null);
}

/** Rótulo do nível, para a etiqueta na ficha. */
export const NIVEL_ATENCAO_LABEL: Record<NivelAtencao, string> = {
  PRAZO: 'Prazo em curso',
  DECISAO: 'Decisão a analisar',
  ENCERRAMENTO: 'Mudança de fase',
};
