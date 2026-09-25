/**
 * O PROCESSO EM PORTUGUÊS — para quem não é do Direito.
 *
 * "Tá bom da forma que está sendo mostrado ao filiado leigo?" — o dono,
 * 25/09/2026, olhando a ficha do processo no portal.
 *
 * NÃO ESTAVA. O que a pessoa lia era a Tabela Processual Unificada do CNJ,
 * crua. MEDIDO em 20.590 movimentações da produção:
 *
 *   Petição ........................................... 3.234
 *   Expedição de documento ............................ 3.071
 *   Conclusão ......................................... 2.919
 *   Publicação ........................................ 2.132
 *   Disponibilização no Diário da Justiça Eletrônico .. 2.115
 *   Decurso de Prazo .................................. 1.592
 *   Mero expediente ..................................... 926
 *   de Instrução ........................................ 186
 *   de Conciliação ...................................... 114
 *
 * "de Instrução" e "de Conciliação" **nem são frases** — são complementos da
 * TPU que chegam soltos (conferido: `detalhe` nulo e `complementos` vazio em
 * todos). Uma técnica de enfermagem abre o portal, lê "Mero expediente" e
 * fecha sabendo exatamente o que sabia antes.
 *
 * AS 25 DESCRIÇÕES MAIS COMUNS COBREM 91,4% de tudo. Traduzir cinquenta
 * códigos resolve praticamente o acervo inteiro.
 *
 * ## A regra que este arquivo não quebra
 *
 * **Só traduz o que eu sei.** Código fora do dicionário mantém o texto do
 * tribunal, palavra por palavra. Uma tradução errada é pior do que o jargão:
 * o jargão a pessoa sabe que não entendeu e liga para perguntar; a frase
 * errada em português ela entende — errado — e vai embora.
 *
 * Por isso não estão aqui, por exemplo, o código 12176 ("Paga") nem o 581
 * ("Documento"): são genéricos demais para eu afirmar do que tratam.
 *
 * **E nunca promete desfecho.** "Procedência" vira "o pedido foi julgado
 * procedente", e não "você ganhou": o mesmo movimento pode se referir a um
 * embargo, a um incidente ou a parte dos pedidos — quem lê o caso é o
 * advogado.
 */

/** Quanto aquilo muda a vida de quem é parte. */
export type PesoDoAndamento =
  /** Muda o rumo: audiência, decisão, recurso julgado, fim do processo. */
  | 'MARCO'
  /** Tem significado, mas é passo de caminho: conclusão ao juiz, prazo vencido. */
  | 'ANDAMENTO'
  /** Máquina do tribunal andando: remessa, recebimento, expedição de ofício. */
  | 'TRAMITE';

interface Traducao {
  titulo: string;
  /** Uma frase de contexto. Some quando o título já se explica. */
  explica?: string;
  peso: PesoDoAndamento;
}

/**
 * O dicionário, por CÓDIGO da TPU e não pelo texto.
 *
 * O texto varia entre tribunais e entre versões da tabela ("Conclusão" tem dois
 * códigos no nosso acervo, 51 e 15101); o código é o que o CNJ mantém estável.
 */
export const TRADUCAO_DO_MOVIMENTO: Record<number, Traducao> = {
  // ---- Entrada e trâmite ----
  26: {
    titulo: 'Processo distribuído',
    explica: 'O caso foi sorteado para um juiz e passou a tramitar.',
    peso: 'MARCO',
  },
  36: {
    titulo: 'Processo redistribuído',
    explica: 'Mudou de vara ou de relator.',
    peso: 'TRAMITE',
  },
  51: {
    titulo: 'Processo concluso ao juiz',
    explica: 'Está na mesa do juiz, aguardando decisão.',
    peso: 'ANDAMENTO',
  },
  15101: {
    titulo: 'Processo concluso ao juiz',
    explica: 'Está na mesa do juiz, aguardando decisão.',
    peso: 'ANDAMENTO',
  },
  60: {
    titulo: 'Documento emitido pelo tribunal',
    explica: 'Ofício, mandado ou carta expedida pela secretaria.',
    peso: 'TRAMITE',
  },
  85: {
    titulo: 'Documento apresentado no processo',
    explica: 'Uma das partes enviou um pedido ou documento ao juiz.',
    peso: 'TRAMITE',
  },
  92: { titulo: 'Publicado no diário oficial', peso: 'TRAMITE' },
  1061: {
    titulo: 'Publicado no Diário da Justiça',
    explica: 'É a partir daqui que os prazos começam a contar.',
    peso: 'TRAMITE',
  },
  123: { titulo: 'Processo enviado a outro setor', peso: 'TRAMITE' },
  132: { titulo: 'Processo recebido pelo setor', peso: 'TRAMITE' },
  11383: {
    titulo: 'Providência da secretaria',
    explica: 'Um passo administrativo, sem decisão do juiz.',
    peso: 'TRAMITE',
  },
  11010: {
    titulo: 'Despacho de andamento',
    explica: 'O juiz determinou um passo do trâmite, sem julgar o caso.',
    peso: 'TRAMITE',
  },
  14736: { titulo: 'Processo passou a tramitar 100% digital', peso: 'TRAMITE' },
  14738: { titulo: 'Tipo do processo corrigido', peso: 'TRAMITE' },
  106: { titulo: 'Mandado expedido', peso: 'TRAMITE' },
  985: { titulo: 'Mandado expedido', peso: 'TRAMITE' },

  // ---- Prazos ----
  1051: {
    titulo: 'Prazo encerrado',
    explica: 'O prazo acabou sem que a parte se manifestasse.',
    peso: 'ANDAMENTO',
  },

  // ---- Audiências ----
  12740: {
    titulo: 'Audiência de conciliação',
    explica: 'Encontro para tentar acordo antes do julgamento.',
    peso: 'MARCO',
  },
  12747: {
    titulo: 'Audiência inicial',
    explica: 'Primeira audiência do processo.',
    peso: 'MARCO',
  },
  12749: {
    titulo: 'Audiência de instrução',
    explica: 'A audiência em que se ouvem as partes e as testemunhas.',
    peso: 'MARCO',
  },
  12203: { titulo: 'Audiência adiada', peso: 'MARCO' },

  // ---- Julgamento e decisões ----
  12115: {
    titulo: 'Enviado para julgamento',
    explica: 'O caso entrou na fila para ser julgado no mérito.',
    peso: 'ANDAMENTO',
  },
  11022: { titulo: 'Julgamento convertido em diligência', peso: 'ANDAMENTO' },
  12164: { titulo: 'Decisão proferida', peso: 'MARCO' },
  219: {
    titulo: 'Pedido julgado procedente',
    explica: 'O juiz acolheu o que foi pedido. Fale com o sindicato sobre o que vem agora.',
    peso: 'MARCO',
  },
  221: {
    titulo: 'Pedido julgado procedente em parte',
    explica: 'O juiz acolheu parte do que foi pedido.',
    peso: 'MARCO',
  },
  220: {
    titulo: 'Pedido julgado improcedente',
    explica: 'O juiz não acolheu o pedido. Ainda pode caber recurso — fale com o sindicato.',
    peso: 'MARCO',
  },
  238: { titulo: 'Recurso provido em parte', peso: 'MARCO' },
  200: { titulo: 'Embargos de declaração rejeitados', peso: 'MARCO' },
  871: { titulo: 'Embargos de declaração acolhidos em parte', peso: 'MARCO' },
  785: { titulo: 'Decisão sobre pedido urgente (antecipação de tutela)', peso: 'MARCO' },
  334: { titulo: 'Justiça gratuita concedida', peso: 'ANDAMENTO' },
  787: { titulo: 'Justiça gratuita concedida', peso: 'ANDAMENTO' },

  // ---- Recursos ----
  434: { titulo: 'Recurso de revista', peso: 'MARCO' },
  1059: {
    titulo: 'Recurso recebido sem suspender a decisão',
    explica: 'O recurso segue, mas a decisão continua valendo enquanto isso.',
    peso: 'ANDAMENTO',
  },

  // ---- Fim ----
  848: {
    titulo: 'Trânsito em julgado',
    explica: 'Acabaram os recursos: a decisão é definitiva.',
    peso: 'MARCO',
  },
  22: {
    titulo: 'Processo arquivado em definitivo',
    peso: 'MARCO',
  },
  246: { titulo: 'Arquivamento definitivo', peso: 'MARCO' },
  11384: {
    titulo: 'Cálculo dos valores iniciado',
    explica: 'Começou a conta do quanto é devido.',
    peso: 'MARCO',
  },
  12066: { titulo: 'Suspensão do processo levantada', peso: 'ANDAMENTO' },
};

export interface MovimentoTraduzido {
  titulo: string;
  explica: string | null;
  peso: PesoDoAndamento;
  /**
   * O texto do TRIBUNAL, sempre. É o que o advogado vê no sistema do TRT e o
   * que a pessoa vai repetir ao telefone — some da tela só quando é igual ao
   * título traduzido.
   */
  original: string;
  /** `false` quando o código não está no dicionário: a tela mostra o cru. */
  traduzido: boolean;
}

export function traduzirMovimento(
  codigo: number | null | undefined,
  descricao: string,
): MovimentoTraduzido {
  const t = codigo != null ? TRADUCAO_DO_MOVIMENTO[codigo] : undefined;
  if (!t) {
    return {
      titulo: descricao,
      explica: null,
      /*
        DESCONHECIDO NÃO É TRÂMITE. Escondê-lo por padrão apagaria da linha do
        tempo justamente o que ainda não sabemos classificar — e o que cair
        aqui amanhã pode ser a sentença de alguém.
      */
      peso: 'ANDAMENTO',
      original: descricao,
      traduzido: false,
    };
  }
  return {
    titulo: t.titulo,
    explica: t.explica ?? null,
    peso: t.peso,
    original: descricao,
    traduzido: true,
  };
}

/**
 * ONDE O PROCESSO ESTÁ AGORA, numa frase.
 *
 * É a primeira coisa que alguém quer saber, e a linha do tempo não responde:
 * ela conta a história de trás para a frente e exige ler três itens para
 * montar o presente. Aqui sai o último movimento que SIGNIFICA alguma coisa —
 * pulando remessa, recebimento e expedição de ofício, que descrevem o
 * tribunal, não o caso.
 *
 * `null` quando só há trâmite: melhor não dizer nada do que dizer
 * "seu processo foi recebido pelo setor".
 */
export function ondeEstaAgora(
  movimentos: Array<{ codigoMovimento: number | null; descricao: string; dataMovimento: Date }>,
): { titulo: string; explica: string | null; em: Date } | null {
  for (const m of movimentos) {
    const t = traduzirMovimento(m.codigoMovimento, m.descricao);
    if (t.peso === 'TRAMITE') continue;
    return { titulo: t.titulo, explica: t.explica, em: m.dataMovimento };
  }
  return null;
}
