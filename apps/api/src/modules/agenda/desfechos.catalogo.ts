/**
 * Desfechos possíveis ao concluir uma atividade, POR TIPO.
 *
 * Por que assim
 * -------------
 * A lista única anterior (Realizado / Não compareceu / Outro / …) tinha três
 * defeitos:
 *
 *  • "Não compareceu" não é conclusão — a atividade não aconteceu. Registrar
 *    como concluída inflava as estatísticas de realização. Virou CATEGORIA DE
 *    CANCELAMENTO (ver CATEGORIAS_CANCELAMENTO).
 *
 *  • "Outro" é a válvula de escape que sempre vira a opção mais clicada, e aí
 *    o campo deixa de informar qualquer coisa. Como a observação livre já
 *    existe, "Outro" não acrescentava nada — só perdia a estatística.
 *
 *  • "Realizado" responde "acabou?", não "e daí?". Numa audiência o que
 *    importa é se houve acordo; num prazo, se a peça foi protocolada ou se o
 *    prazo foi PERDIDO — informação séria que ficava escondida atrás de um
 *    "Realizado". O desfecho genérico continua existindo (CONCLUIDA), mas
 *    apenas onde não há resultado melhor a registrar.
 *
 * Tipos personalizados (a Agenda permite criar tipos) caem em DESFECHOS_PADRAO.
 * Se um tipo novo merecer desfechos próprios, acrescente aqui — é o único
 * lugar que precisa mudar.
 */

/**
 * Atividade de seguimento que um desfecho gera.
 *
 * Existe porque vários desfechos DECLARAM uma pendência ("com encaminhamentos",
 * "laudo pendente", "houve acordo") e o sistema não tinha onde guardá-la: o
 * texto ia para `desfecho_obs` e morria ali — sem dono, sem data e sem
 * aparecer em lista nenhuma. Um encaminhamento sem responsável e sem prazo não
 * é encaminhamento; é ata.
 */
export interface SeguimentoSpec {
  /** Slug do tipo da atividade nova (ver tipos_evento). */
  tipo: string;
  /** Título sugerido — a tela deixa editar. */
  titulo: string;
  /** Prazo sugerido, em dias corridos a partir de hoje. */
  emDias: number;
  /**
   * Sem escapatória: a pendência É o desfecho, e deixá-la sem dono devolveria
   * o problema que este campo veio resolver. Quando falso, a tela pré-marca a
   * criação mas permite desmarcar.
   */
  obrigatorio?: boolean;
}

export interface DesfechoOpcao {
  slug: string;
  label: string;
  ajuda: string;
  /** Obriga preencher a observação — usado onde o texto é a informação útil. */
  exigeObs?: boolean;
  /** Sinaliza um resultado ruim (prazo perdido, diligência infrutífera). */
  alerta?: boolean;
  /** Encaminhamento com efeito colateral em Processos ou na própria Agenda. */
  acao?: 'VINCULAR_PROCESSO' | 'CRIAR_PROCESSO' | 'CRIAR_ATIVIDADE';
  /** Preenchido quando `acao` é CRIAR_ATIVIDADE. */
  seguimento?: SeguimentoSpec;
}

/** Encaminhamentos: a demanda continua, dentro de um processo. */
const VINCULAR: DesfechoOpcao = {
  slug: 'VINCULADO_PROCESSO',
  label: 'Vinculado a processo',
  ajuda: 'A demanda pertence a um processo que já existe.',
  acao: 'VINCULAR_PROCESSO',
};

const CRIAR: DesfechoOpcao = {
  slug: 'PROCESSO_CRIADO',
  label: 'Virou processo novo',
  ajuda: 'Abre um caso em fase pré-processual, antes do ajuizamento.',
  acao: 'CRIAR_PROCESSO',
};

/** Fecho genérico — só onde o tipo não tem um resultado mais específico. */
const CONCLUIDA: DesfechoOpcao = {
  slug: 'CONCLUIDA',
  label: 'Concluída',
  ajuda: 'A atividade foi realizada conforme o planejado.',
};

export const DESFECHOS_PADRAO: DesfechoOpcao[] = [CONCLUIDA, VINCULAR, CRIAR];

/**
 * Mapa por slug do tipo de atividade. Os 8 tipos "sistema" da Agenda.
 * A ordem importa: a primeira opção é a pré-selecionada na tela.
 */
export const DESFECHOS_POR_TIPO: Record<string, DesfechoOpcao[]> = {
  AUDIENCIA: [
    {
      slug: 'AUDIENCIA_ACORDO',
      label: 'Houve acordo',
      ajuda: 'Acordo firmado em audiência. Descreva os termos.',
      exigeObs: true,
      // Acordo firmado é acordo A CUMPRIR: alguém precisa conferir o pagamento
      // ou a obrigação na data combinada. Sugerido, não imposto — há acordo
      // cumprido na própria audiência.
      acao: 'CRIAR_ATIVIDADE',
      seguimento: {
        tipo: 'ACOMPANHAMENTO',
        titulo: 'Conferir cumprimento do acordo',
        emDias: 30,
      },
    },
    {
      slug: 'AUDIENCIA_SEM_ACORDO',
      label: 'Realizada, sem acordo',
      ajuda: 'A audiência ocorreu e o processo segue.',
    },
    {
      slug: 'AUDIENCIA_INSTRUCAO',
      label: 'Instrução encerrada',
      ajuda: 'Provas colhidas; aguarda sentença.',
    },
  ],

  PRAZO: [
    {
      slug: 'PRAZO_CUMPRIDO',
      label: 'Peça protocolada',
      ajuda: 'O prazo foi cumprido. Informe o protocolo, se houver.',
    },
    {
      slug: 'PRAZO_PERDIDO',
      label: 'Prazo perdido',
      ajuda: 'Não foi cumprido no tempo. Explique o que houve.',
      exigeObs: true,
      alerta: true,
      // Prazo perdido exige providência (preliminar, justificativa, ciência ao
      // filiado). Obrigatório: é o desfecho mais grave do catálogo e não pode
      // terminar em nada além de um texto.
      acao: 'CRIAR_ATIVIDADE',
      seguimento: {
        tipo: 'ACOMPANHAMENTO',
        titulo: 'Providência sobre prazo perdido',
        emDias: 2,
        obrigatorio: true,
      },
    },
  ],

  CONSULTA_JURIDICA: [
    {
      slug: 'DUVIDA_ESCLARECIDA',
      label: 'Dúvida esclarecida',
      ajuda: 'Resolvida na hora. Registre a orientação dada.',
      exigeObs: true,
    },
    VINCULAR,
    CRIAR,
  ],

  REUNIAO: [
    {
      slug: 'REUNIAO_COM_ENCAMINHAMENTOS',
      label: 'Com encaminhamentos',
      ajuda: 'Houve deliberação. O encaminhamento vira tarefa com dono e prazo.',
      exigeObs: true,
      acao: 'CRIAR_ATIVIDADE',
      seguimento: {
        tipo: 'ACOMPANHAMENTO',
        titulo: 'Encaminhamento da reunião',
        emDias: 7,
        obrigatorio: true,
      },
    },
    {
      slug: 'REUNIAO_SEM_DELIBERACAO',
      label: 'Sem deliberação',
      ajuda: 'A reunião ocorreu, mas nada foi decidido.',
    },
  ],

  DILIGENCIA: [
    {
      slug: 'DILIGENCIA_CUMPRIDA',
      label: 'Cumprida',
      ajuda: 'A diligência foi realizada com êxito.',
    },
    {
      slug: 'DILIGENCIA_INFRUTIFERA',
      label: 'Infrutífera',
      ajuda: 'Não foi possível cumprir. Explique o motivo.',
      exigeObs: true,
      alerta: true,
      // Sugerido: às vezes a diligência infrutífera encerra o assunto, às vezes
      // pede nova tentativa. Quem esteve lá decide.
      acao: 'CRIAR_ATIVIDADE',
      seguimento: {
        tipo: 'DILIGENCIA',
        titulo: 'Nova tentativa de diligência',
        emDias: 7,
      },
    },
    VINCULAR,
  ],

  DESPACHO: [
    {
      slug: 'DESPACHO_OBTIDO',
      label: 'Despacho obtido',
      ajuda: 'Registre o que foi tratado e o resultado.',
      exigeObs: true,
    },
    {
      slug: 'DESPACHO_NAO_ATENDIDO',
      label: 'Não atendido',
      ajuda: 'Não houve atendimento. Explique.',
      exigeObs: true,
      alerta: true,
    },
  ],

  PERICIA: [
    {
      slug: 'PERICIA_REALIZADA',
      label: 'Realizada — laudo pendente',
      ajuda: 'A perícia ocorreu; o laudo ainda não saiu.',
      // "Pendente" é uma promessa de acompanhamento. Obrigatório: sem isso o
      // laudo fica esquecido até alguém reabrir a atividade por acaso.
      acao: 'CRIAR_ATIVIDADE',
      seguimento: {
        tipo: 'ACOMPANHAMENTO',
        titulo: 'Cobrar laudo pericial',
        emDias: 21,
        obrigatorio: true,
      },
    },
    {
      slug: 'PERICIA_LAUDO_ENTREGUE',
      label: 'Laudo entregue',
      ajuda: 'O laudo já está nos autos.',
    },
  ],

  /**
   * CONTATO — tarefa de aviso ao filiado (a que o robô cria antes da audiência).
   * A pergunta aqui não é "a ligação aconteceu?", é "o filiado ficou sabendo?".
   * Filiado não avisado é ausência na audiência, com risco de arquivamento — por
   * isso os dois desfechos negativos são alerta e geram nova tentativa.
   */
  CONTATO: [
    {
      slug: 'CONTATO_CONFIRMADO',
      label: 'Confirmou presença',
      ajuda: 'Falamos com o filiado e ele confirmou que comparece.',
    },
    {
      slug: 'CONTATO_NAO_COMPARECERA',
      label: 'Avisou que não vai',
      ajuda: 'Conseguimos avisar, mas o filiado não poderá comparecer.',
      exigeObs: true,
      alerta: true,
    },
    {
      slug: 'CONTATO_SEM_SUCESSO',
      label: 'Não conseguimos contato',
      ajuda: 'Telefone não atende / número errado. Gera nova tentativa.',
      exigeObs: true,
      alerta: true,
      acao: 'CRIAR_ATIVIDADE',
      seguimento: {
        tipo: 'CONTATO',
        titulo: 'Nova tentativa de contato',
        emDias: 1,
        obrigatorio: true,
      },
    },
  ],

  /** ACOMPANHAMENTO — a pendência que veio de outro desfecho, agora fechando. */
  ACOMPANHAMENTO: [
    {
      slug: 'ACOMPANHAMENTO_CUMPRIDO',
      label: 'Cumprido',
      ajuda: 'O que estava pendente foi resolvido. Registre o resultado.',
      exigeObs: true,
    },
    {
      slug: 'ACOMPANHAMENTO_PENDENTE',
      label: 'Ainda pendente',
      ajuda: 'Não se resolveu — reagenda a cobrança para uma data nova.',
      exigeObs: true,
      alerta: true,
      acao: 'CRIAR_ATIVIDADE',
      seguimento: {
        tipo: 'ACOMPANHAMENTO',
        titulo: 'Nova cobrança',
        emDias: 15,
        obrigatorio: true,
      },
    },
    {
      slug: 'ACOMPANHAMENTO_SEM_OBJETO',
      label: 'Perdeu o objeto',
      ajuda: 'A pendência deixou de existir. Explique por quê.',
      exigeObs: true,
    },
    VINCULAR,
  ],

  // Tipo genérico da Agenda: aqui "Concluída" é a resposta honesta.
  COMPROMISSO: DESFECHOS_PADRAO,
};

/** Desfechos válidos para um tipo (cai no padrão se o tipo for personalizado). */
export function desfechosDoTipo(tipo: string): DesfechoOpcao[] {
  return DESFECHOS_POR_TIPO[tipo] ?? DESFECHOS_PADRAO;
}

export function acharDesfecho(tipo: string, slug: string): DesfechoOpcao | undefined {
  return desfechosDoTipo(tipo).find((d) => d.slug === slug);
}

/**
 * Rótulos de TODOS os desfechos, inclusive os que saíram de circulação, para o
 * histórico antigo continuar legível.
 */
export const DESFECHO_LABEL: Record<string, string> = {
  ...Object.values(DESFECHOS_POR_TIPO)
    .flat()
    .concat(DESFECHOS_PADRAO)
    .reduce((acc, d) => ({ ...acc, [d.slug]: d.label }), {} as Record<string, string>),
  // Legado (registros anteriores à conclusão por tipo).
  REALIZADO: 'Realizado',
  OUTRO: 'Outro',
  NAO_COMPARECEU: 'Não compareceu',
};

// ---------------------------------------------------------------------------
// Cancelamento
// ---------------------------------------------------------------------------

export interface CategoriaCancelamento {
  slug: string;
  label: string;
  ajuda: string;
  /**
   * Só o sistema escolhe — não aparece no formulário de cancelamento.
   *
   * Existe porque o rótulo precisa estar no catálogo (a tela lê
   * `CATEGORIA_CANCELAMENTO_LABEL` para exibir o motivo em qualquer cartão
   * cancelado), mas oferecer a opção a uma pessoa não faria sentido: ninguém
   * cancela algo "porque foi substituída" — isso é consequência de outra ação.
   */
  apenasSistema?: boolean;
}

/**
 * Por que a atividade NÃO aconteceu.
 *
 * Deliberadamente sem "Outro": o motivo em texto livre continua obrigatório,
 * então uma categoria vazia não acrescentaria nada. Se faltar categoria para
 * um caso real, o certo é acrescentá-la aqui — não abrir uma gaveta genérica.
 */
export const CATEGORIAS_CANCELAMENTO: CategoriaCancelamento[] = [
  {
    /**
     * A ATIVIDADE DE ORIGEM FOI CONCLUÍDA DE NOVO.
     *
     * Reabrir uma atividade concluída, corrigir o desfecho e concluir outra vez
     * criava um SEGUNDO seguimento — visto na produção: dois "Encaminhamento da
     * reunião" idênticos, mesmo horário, dezesseis minutos de diferença. Agora
     * a providência anterior é cancelada com esta categoria, e não apagada: o
     * histórico continua contando que ela existiu e por que caiu.
     */
    slug: 'SUBSTITUIDA',
    label: 'Substituída por nova conclusão',
    ajuda: 'A atividade de origem foi concluída novamente e esta providência deu lugar a outra.',
    apenasSistema: true,
  },
  {
    slug: 'NAO_COMPARECEU',
    label: 'Filiado não compareceu',
    ajuda: 'Estava agendada e a pessoa não apareceu.',
  },
  {
    slug: 'DESISTENCIA',
    label: 'Filiado desistiu',
    ajuda: 'A pessoa avisou que não quer mais.',
  },
  {
    slug: 'ADIADA_JUIZO',
    label: 'Adiada pelo juízo/órgão',
    ajuda: 'Cancelada por decisão externa. Se já tem data nova, use Remarcar.',
  },
  {
    slug: 'INDISPONIBILIDADE',
    label: 'Indisponibilidade do sindicato',
    ajuda: 'Nossa equipe não pôde atender.',
  },
  {
    slug: 'DUPLICIDADE',
    label: 'Agendada por engano',
    ajuda: 'Duplicada ou criada errada.',
  },
  {
    slug: 'PERDEU_OBJETO',
    label: 'Perdeu o objeto',
    ajuda: 'A demanda deixou de existir antes da data.',
  },
];

export const CATEGORIA_CANCELAMENTO_LABEL: Record<string, string> =
  CATEGORIAS_CANCELAMENTO.reduce(
    (acc, c) => ({ ...acc, [c.slug]: c.label }),
    {} as Record<string, string>,
  );

export const categoriaCancelamentoValida = (slug?: string | null): boolean =>
  !!slug && CATEGORIAS_CANCELAMENTO.some((c) => c.slug === slug);
