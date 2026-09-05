import { api } from './api';
import type { PerfilUsuario } from './permissoes';
import type { CanalAtendimento, DesfechoAtendimento } from './atendimentos';
import type { AudienciaAAgendar } from './audiencias';

// ---------------------------------------------------------------------------
// Tipos do payload consolidado de /dashboard/resumo
// ---------------------------------------------------------------------------

/** Slug de um tipo de evento cadastrável (ver lib/agenda). */
export type TipoCompromisso = string;
export type StatusCompromisso = 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO';

export interface PessoaResumo {
  id: string;
  nome: string;
  nomeExibicao?: string | null;
  avatarUrl?: string | null;
}

export interface CompromissoCard {
  id: string;
  titulo: string;
  tipo: TipoCompromisso;
  status: StatusCompromisso;
  inicio: string;
  fim: string;
  local: string | null;
  urgente: boolean;
  /** POR QUE é urgente — o selo mostra na dica; sem ele a tarja não explica nada. */
  urgenteMotivo: string | null;
  urgenteEm: string | null;
  iniciadoEm: string | null;
  responsavel: PessoaResumo;
  filiado: { id: string; nomeCompleto: string } | null;
  processo: { id: string; numeroCNJ: string } | null;
}

export interface AtendimentoPendente {
  id: string;
  numero: number;
  canal: CanalAtendimento;
  desfecho: DesfechoAtendimento | null;
  createdAt: string;
  filiado: { id: string; nomeCompleto: string };
}

export interface MovimentacaoRecente {
  id: string;
  descricao: string;
  dataMovimento: string;
  processo: { id: string; numeroCNJ: string; filiado: { nomeCompleto: string } | null };
}

export interface PlantaoItem {
  id: string;
  horaInicio: string;
  horaFim: string;
  advogado: PessoaResumo;
}

/** Processo recusado pelo CNJ na última tentativa das 24h (ver `robo`). */
export interface FalhaDatajud {
  /** Nulo se o processo foi excluído depois da falha — resta o NPU. */
  processoId: string | null;
  numeroCNJ: string;
  tribunal: string | null;
  httpStatus: number | null;
  mensagemErro: string | null;
  createdAt: string;
  filiado: string | null;
  /** Duração da chamada. 45.000ms é o teto de espera do nosso lado. */
  duracaoMs?: number | null;
  /**
   * Quando este processo foi lido com SUCESSO pela última vez.
   *
   * É o que separa "o CNJ engasgou numa tentativa" de "este processo está sem
   * leitura há dias". Opcional porque a API antiga não mandava — na janela de
   * troca do deploy a tela nova conversa com o contêiner velho, e aí ela trata
   * a ausência como "não sei", não como "nunca".
   */
  ultimoSucesso?: string | null;
}

/**
 * Um NPU que o CNJ diz não conhecer — e que o robô continua perguntando.
 *
 * NÃO É FALHA: a consulta funciona, o índice é que não tem o processo. Por isso
 * era gravado como sucesso e ficava invisível — enquanto um único número
 * consumia 151 consultas em 7 dias.
 */
export interface ProcessoDesconhecidoNoCnj {
  processoId: string | null;
  numeroCNJ: string;
  tribunal: string | null;
  filiado: string | null;
  tentativas: number;
  desde: string;
  ultima: string;
}

export interface ResumoDashboard {
  papel: PerfilUsuario;
  escopo: 'PESSOAL' | 'GLOBAL';
  kpis: {
    processosAtivos: number;
    /** Todos os processos, em qualquer status — o contexto do número de ativos. */
    /** Mesmo universo da tela de Processos: NÃO inclui os pré-processuais. */
    processosTotal: number;
    /** A fila que a lista padrão esconde, contada à parte. */
    processosPreProcessuais: number;
    atendimentosPendentes: number;
    prazosSemana: number;
    filiadosAtivos: number;
    filiadosTotal: number;
    novosFiliadosMes: number;
    /** Saídas do quadro no mês — o contrapeso das entradas. */
    desfiliadosMes: number;
    /** entradas − saídas. Negativo = o quadro encolheu no mês. */
    saldoFiliadosMes: number;
  };
  minhaCarteira: {
    meusProcessos: number;
    minhasAudiencias: number;
    atrasadas: number;
    urgentes: number;
    /**
     * Os dois riscos que NÃO aparecem em agenda nenhuma, porque não têm data:
     * o caso pré-processual esquecido (some da lista padrão de propósito) e o
     * processo parado há 30 dias — o que mais custa caro e o único que ninguém
     * cobra, justamente porque não vence.
     */
    preProcessuais: number;
    semMovimentacao: number;
  } | null;
  /** A fila de quem está no BALCÃO. Nulo fora da Triagem. */
  minhaTriagem: {
    registradosHoje: number;
    semDesfecho: number;
    filiadosHoje: number;
  } | null;
  alertas: {
    atrasadas: number;
    semMovimentacao: number;
    urgentes: number;
    /** Audiências designadas no DataJud e ainda fora da Agenda. */
    audienciasAAgendar: number;
  };
  /** Amostra do radar de audiências (o total vem em `alertas`). */
  audienciasAAgendar: AudienciaAAgendar[];
  atividadesHoje: CompromissoCard[];
  audienciasSemana: CompromissoCard[];
  pendenciasAtivas: CompromissoCard[];
  atendimentosPendentes: AtendimentoPendente[];
  movimentacoesRecentes: MovimentacaoRecente[];
  equipeHoje: {
    plantaoHoje: PlantaoItem[];
    proximoPlantao: { data: string; advogados: PessoaResumo[] } | null;
  };
  /**
   * Saúde do robô de sincronização do DataJud. Sem isto, "0 audiências a
   * agendar" era ambíguo: podia ser que não houvesse nada OU que a varredura
   * noturna não tivesse rodado.
   */
  /**
   * SAÚDE E CONTEÚDO DO DJEN — a mesma razão de existir de `robo`, e por um
   * motivo que já se materializou: a integração devolveu zero por UM MÊS, por
   * bloqueio de origem, e a tela dizia apenas "nenhuma publicação". Quem lesse
   * concluiria que o tribunal não publicou nada nos processos do sindicato.
   */
  djen: {
    ativa: boolean;
    /**
     * DESLIGADA   integração off — escolha, não falha
     * PRIMEIRA    ligada, nunca trouxe nada
     * EM_DIA      trouxe publicação nas últimas 48h
     * SILENCIOSA  já trouxe antes e parou há mais de 48h
     */
    situacao: 'DESLIGADA' | 'PRIMEIRA' | 'EM_DIA' | 'SILENCIOSA';
    /** ATOS dos últimos 7 dias — já sem as cópias por destinatário. */
    publicacoes7d: number;
    ultimaEm: string | null;
    /** PESSOAL para o advogado (só o acervo dele); GLOBAL para os demais. */
    escopo: 'GLOBAL' | 'PESSOAL';
    /** Só as que pedem providência — edital e lista de distribuição ficam fora. */
    recentes: {
      id: string;
      tipoComunicacao: string | null;
      nomeOrgao: string | null;
      providencia: string | null;
      prazoMencionadoDias: number | null;
      dataDisponibilizacao: string;
      compromissoId: string | null;
      /** A atividade existe E está aberta? Concluída/cancelada não conta. */
      temTarefaAberta: boolean;
      /** Nunca virou tarefa. Diferente de "a tarefa fechou" — ver a API. */
      semTarefa: boolean;
      /** Quantos destinatários receberam a MESMA comunicação. */
      copias: number;
      processo: {
        id: string;
        numeroCNJ: string | null;
        /** Quem está do outro lado — é o que distingue um processo do outro. */
        adversario: string | null;
        /** O autor, e só quando NÃO é o próprio sindicato. */
        autor: string | null;
        /** Em que polo o sindicato figura — muda o sentido do ato. */
        nossoPolo: 'ATIVO' | 'PASSIVO' | null;
        /**
         * O responsável, com foto. Numa lista de seis, o rosto é reconhecido
         * antes do nome — é ele que responde "isto é meu?" sem obrigar a ler.
         */
        advogado: {
          id: string;
          nome: string;
          nomeExibicao: string | null;
          avatarUrl: string | null;
        } | null;
      } | null;
    }[];
  };
  /**
   * Contra quem o sindicato mais litiga — organizações com três ou mais
   * processos ativos. Vazio quando não há padrão; a tela não desenha.
   */
  adversarios: {
    id: string;
    nome: string;
    tipo: string;
    processos: number;
  }[];
  robo: {
    /**
     * SEM_OBJETO  nada monitorado — o robô não tem o que varrer (sem alerta)
     * PRIMEIRA    há processos, a primeira varredura ainda não aconteceu
     * EM_DIA      varreu nas últimas 36h
     * ATRASADO    parou entre 36h e 3 dias
     * PARADO      parado há mais de 3 dias
     */
    situacao: 'SEM_OBJETO' | 'PRIMEIRA' | 'EM_DIA' | 'ATRASADO' | 'PARADO';
    /** Denominador: quantos processos o robô de fato varre. */
    processosMonitorados: number;
    ultimaSincronizacao: string | null;
    ultimaComSucesso: boolean | null;
    /** Processos distintos recusados — `falhasProcessos.length`. */
    falhas24h: number;
    /**
     * Destes, quantos estão de fato SEM LEITURA há mais de `horasAteAtraso`.
     *
     * É o número que merece alarme. `falhas24h` conta tentativas que deram
     * errado; este conta processos que ficaram para trás — e são coisas
     * diferentes, como a produção mostrou: oito timeouts numa noite, zero
     * processos atrasados.
     */
    atrasados24h?: number;
    horasAteAtraso?: number;
    /** QUAIS processos falharam, para o aviso poder virar trabalho. */
    falhasProcessos: FalhaDatajud[];
    /** NPUs que o CNJ não encontra — conferência de cadastro, não falha. */
    desconhecidosNoCnj?: ProcessoDesconhecidoNoCnj[];
  };
  /**
   * Carga da equipe — quem está sobrecarregado e quem está atrasado.
   * NULO para o advogado: é instrumento de gestão, não ranking do time.
   */
  cargaEquipe: {
    advogado: PessoaResumo;
    abertas: number;
    atrasadas: number;
  }[] | null;
  /** Tarefas de contato com o filiado — a fila própria da Triagem. */
  contatosHoje: CompromissoCard[];
  /** Aniversariantes de hoje: filiados e equipe, na mesma lista. */
  /**
   * QUEM PASSOU POR AQUI E ESTÁ COM A FICHA PELA METADE — a fila do balcão.
   * Vazia para quem não edita filiado.
   */
  cadastrosACompletar: {
    id: string;
    nome: string;
    /** Por que esta pessoa está "em jogo": atendimento recente ou processo. */
    motivo: 'ATENDIMENTO' | 'PROCESSO';
    /** O que falta na ficha, na ordem em que atrapalha. */
    falta: string[];
  }[];
  /**
   * AS FONTES EXTERNAS ESTÃO DE PÉ? Nulo para quem não coordena — é a única
   * pessoa que faz alguma coisa com a resposta.
   */
  integracoes:
    | {
        fonte: string;
        situacao: 'OK' | 'INSTAVEL' | 'PARADA' | 'SEM_USO';
        ok24: number;
        falhas24: number;
        ultimoSucesso: string | null;
        ultimaFalha: string | null;
        ultimoErro: string | null;
      }[]
    | null;
  aniversariantes: {
    id: string;
    nome: string;
    telefone: string | null;
    nascimento: string;
    idade: number;
    tipo: 'FILIADO' | 'COLABORADOR';
  }[];
  /**
   * Tempo médio da triagem, da abertura ao desfecho (30 dias).
   * `horas: null` = não houve resolução no período (amostra vazia).
   */
  tempoMedioTriagem: { horas: number | null; amostra: number };
  graficos: {
    atendimentosPorCanal: { canal: CanalAtendimento; total: number }[];
    atendimentos14dias: { dia: string; total: number }[];
    crescimentoFiliados: { mes: string; total: number }[];
    /** Entradas × saídas × saldo por mês (6 meses, com meses zerados). */
    movimentacaoQuadro: { mes: string; entradas: number; saidas: number; saldo: number }[];
    /** Fora da série por não terem data de filiação (carga sem a informação). */
    filiadosSemDataFiliacao: number;
  };
}

export async function getResumoDashboard(): Promise<ResumoDashboard> {
  return (await api.get<ResumoDashboard>('/dashboard/resumo')).data;
}

// ---------------------------------------------------------------------------
// Rótulos, cores e helpers de exibição
// ---------------------------------------------------------------------------

export const TIPO_COMP_LABEL: Record<TipoCompromisso, string> = {
  CONSULTA_JURIDICA: 'Consulta Jurídica',
  AUDIENCIA: 'Audiência',
  PRAZO: 'Prazo',
  REUNIAO: 'Reunião',
  DILIGENCIA: 'Diligência',
  DESPACHO: 'Despacho',
  PERICIA: 'Perícia',
  COMPROMISSO: 'Compromisso',
  CONTATO: 'Contato',
  ACOMPANHAMENTO: 'Acompanhamento',
};

/** Cor da barra lateral do card por tipo. */
export const TIPO_COMP_COR: Record<TipoCompromisso, string> = {
  CONSULTA_JURIDICA: 'bg-emerald-500',
  AUDIENCIA: 'bg-violet-500',
  PRAZO: 'bg-rose-500',
  REUNIAO: 'bg-sky-500',
  DILIGENCIA: 'bg-amber-500',
  DESPACHO: 'bg-indigo-500',
  PERICIA: 'bg-teal-500',
  COMPROMISSO: 'bg-slate-400',
  CONTATO: 'bg-cyan-500',
  ACOMPANHAMENTO: 'bg-blue-500',
};

export const STATUS_COMP_LABEL: Record<StatusCompromisso, string> = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em andamento',
  CONCLUIDO: 'Concluído',
  CANCELADO: 'Cancelado',
};

export const STATUS_COMP_COR: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  EM_ANDAMENTO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  CONCLUIDO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  CANCELADO: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 line-through',
};

/**
 * As cores das fatias mudaram-se para `lib/cores-grafico.ts` (PALETA_CATEGORICA).
 *
 * O que havia aqui começava com DOIS TONS DA MARCA (`brand-800` e `brand-600`).
 * O comentário original já dizia que "cinco tons da mesma cor seria ilegível" —
 * e dois também são: medidos com o validador de paletas, aquele par fica em
 * ΔE 11,3 para visão normal, abaixo do piso de 15. Duas das cinco fatias eram
 * "o verde".
 *
 * Também morava no lugar errado: estas cores são desenhadas em SVG e não
 * acompanhavam a troca de cor feita em Configurações → Identidade visual, que
 * mexe em `--brand-*` em tempo de execução.
 */

/** Saudação pela hora local. */
export function saudacao(nome: string): string {
  const h = new Date().getHours();
  const prefixo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiro = nome?.trim().split(/\s+/)[0] ?? '';
  return `${prefixo}, ${primeiro}`;
}

/** "Quarta-feira, 29 de julho" (só a inicial em maiúscula). */
export function dataPorExtenso(d = new Date()): string {
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "há 2h 49m" / "há 3d 5h" a partir de uma data no passado (ou "em ..." no futuro). */
export function tempoRelativo(iso: string): string {
  const alvo = new Date(iso).getTime();
  const diff = Date.now() - alvo;
  const futuro = diff < 0;
  const abs = Math.abs(diff);
  const min = Math.floor(abs / 60000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  let texto: string;
  if (d >= 1) texto = `${d}d ${h % 24}h`;
  else if (h >= 1) texto = `${h}h ${min % 60}m`;
  else texto = `${min}m`;
  return futuro ? `em ${texto}` : `há ${texto}`;
}

/** Hora curta "16:30". */
export function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function primeiroNome(p: PessoaResumo): string {
  return p.nomeExibicao || p.nome;
}

/**
 * Traduz a recusa do CNJ em uma frase que diz o que fazer a respeito.
 *
 * `passageiro` separa o que a próxima varredura resolve sozinha (tribunal fora
 * do ar, limite de consultas) do que vai falhar de novo amanhã se ninguém
 * mexer (NPU inexistente, chave recusada). A barra dizia "costuma ser
 * instabilidade passageira" para tudo — e para um 404 isso é falso: o robô
 * tentaria indefinidamente um processo que o CNJ não tem.
 */
export function motivoFalhaDatajud(f: FalhaDatajud): { texto: string; passageiro: boolean } {
  const s = f.httpStatus;
  if (s === 404) return { texto: 'NPU não encontrado no CNJ', passageiro: false };
  if (s === 401 || s === 403) return { texto: 'chave da API recusada', passageiro: false };
  if (s === 400 || s === 422) return { texto: 'NPU recusado pelo CNJ', passageiro: false };
  if (s === 429) return { texto: 'limite de consultas atingido', passageiro: true };
  if (s && s >= 500) return { texto: 'tribunal fora do ar', passageiro: true };
  /*
    SEM STATUS é rede ou TIMEOUT — e são coisas diferentes o bastante para
    merecerem palavras diferentes.

    "sem resposta do CNJ" é vago: soa como serviço fora do ar. Na produção de
    05/09/2026 as oito falhas tinham duração de exatos 45.000ms — o teto de
    espera do nosso lado. O CNJ não estava fora; estava lento demais para a
    janela que damos a ele. Quem lê "demorou mais de 45s" sabe o que aconteceu;
    quem lê "sem resposta" vai procurar defeito no processo.
  */
  if (f.duracaoMs != null && f.duracaoMs >= 40_000) {
    return { texto: 'o CNJ demorou mais de 45s', passageiro: true };
  }
  return { texto: s ? `erro ${s} no CNJ` : 'sem resposta do CNJ', passageiro: true };
}
