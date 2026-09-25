import { api } from './api';
import type { PerfilUsuario } from './permissoes';
import { filaDe, type CanalAtendimento, type DesfechoAtendimento, type FilaNaResposta } from './atendimentos';
import type { AudienciaAAgendar } from './audiencias';
import type { RecorteAgenda } from './agenda';
import { MOTIVO_SEM_TAREFA } from './djen';

// ---------------------------------------------------------------------------
// Tipos do payload consolidado de /dashboard/resumo
// ---------------------------------------------------------------------------

/** Slug de um tipo de evento cadastrável (ver lib/agenda). */
export type TipoCompromisso = string;
export type StatusCompromisso = 'PENDENTE' | 'EM_ANDAMENTO' | 'CONCLUIDO' | 'CANCELADO';

/**
 * HÁ QUANTOS DIAS A PESSOA NÃO USA O SISTEMA — só quando isso diz alguma coisa.
 *
 * Abaixo de uma semana é folga, feriado prolongado, audiência fora: mostrar
 * "há 3 dias" em toda linha viraria ruído e acusação. A partir de sete dias é
 * informação para quem coordena. `undefined` é a API de antes do campo — aí não
 * sabemos, e não afirmamos nada.
 */
export const DIAS_PARA_NOTAR_AUSENCIA = 7;

export function diasSemAcesso(
  ultimoAcesso: string | null | undefined,
  agora = Date.now(),
): number | 'NUNCA' | null {
  if (ultimoAcesso === undefined) return null;
  if (ultimoAcesso === null) return 'NUNCA';
  const dias = Math.floor((agora - new Date(ultimoAcesso).getTime()) / 86_400_000);
  return dias >= DIAS_PARA_NOTAR_AUSENCIA ? dias : null;
}

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
  /**
   * A TAREFA "CADASTRAR AÇÃO DO DIÁRIO" — o NPU que o robô quer ver no acervo.
   *
   * Com ela o gesto da linha é cadastrar, não concluir: a tarefa fecha sozinha
   * quando a ação entra. Opcional pela janela de troca do deploy.
   */
  sugestaoDeCadastro?: { numeroCNJ: string } | null;
}

/**
 * EM QUE PÉ ESTÁ A CONSULTA QUE O ATENDIMENTO MARCOU — calculado na LEITURA pela
 * API (`situacaoDoEncaminhamento`), nunca gravado. "Ficou para trás" é consulta
 * pendente de dia anterior; entre várias, vale a mais recente não cancelada.
 */
export interface EncaminhamentoResumo {
  estado: 'AGENDADA' | 'HOJE' | 'EM_CONSULTA' | 'FICOU_PARA_TRAS' | 'ATENDIDA' | 'CANCELADA';
  compromissoId: string;
  inicio: string;
  /**
   * Nulo quando a consulta perdeu o responsável (a API manda `null`, e o tipo
   * dizia o contrário — conferido na revisão de 13/09/2026). Leia com `?.`.
   */
  responsavel: { id: string; nome: string; nomeExibicao: string | null } | null;
  linkReuniao: string | null;
  local: string | null;
}

export interface AtendimentoPendente {
  id: string;
  numero: number;
  canal: CanalAtendimento;
  desfecho: DesfechoAtendimento | null;
  createdAt: string;
  filiado: { id: string; nomeCompleto: string };
  /** A consulta que o atendimento marcou, se marcou. Opcional pela janela de troca. */
  encaminhamento?: EncaminhamentoResumo | null;
  /** Triagem ou consulta (15/09/2026). Ausente na API de antes. */
  fila?: FilaNaResposta;
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
  /**
   * O processo está na faixa LENTA da varredura (encerrado, arquivado…), que o
   * robô relê a cada sete dias em vez de toda noite. Muda a régua do atraso.
   */
  dormente?: boolean;
  /**
   * Já decidido no SERVIDOR, com a régua do ciclo deste processo — a tela não
   * recalcula. Ausente na API da janela de troca; aí a tela cai na régua antiga
   * de 48h, que é o comportamento de antes.
   */
  atrasada?: boolean;
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
    /** Nulo para quem não vê processos — a API nem conta. Ver `veProcessos`. */
    processosAtivos: number | null;
    /** Todos os processos, em qualquer status — o contexto do número de ativos. */
    /** Mesmo universo da tela de Processos: NÃO inclui os pré-processuais. */
    processosTotal: number | null;
    /** A fila que a lista padrão esconde, contada à parte. */
    processosPreProcessuais: number | null;
    /** @deprecated Todo pendente, inclusive o que só espera a consulta. Fica por uma versão (janela de troca). */
    atendimentosPendentes: number;
    /** Pendentes na fila da TRIAGEM: os que pedem uma ação dela (15/09/2026). Ausente na API de antes. */
    atendimentosComATriagem?: number;
    /** Pendentes esperando a consulta acontecer ou ser registrada. */
    atendimentosAguardandoConsulta?: number;
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
    /**
     * Os meus, na fila da TRIAGEM (15/09/2026). `semDesfecho` contava todo
     * pendente, inclusive o que só espera a consulta. Ausente na API de antes.
     */
    comATriagem?: number;
    filiadosHoje: number;
  } | null;
  alertas: {
    /** FICOU PARA TRÁS: aberta e o dia já virou. É o alarme. */
    atrasadas: number;
    /**
     * De HOJE, com a hora marcada já passada — informação, não alarme.
     *
     * Opcional porque a API pode ser a de antes durante a janela de troca do
     * deploy: web e API sobem em serviços separados.
     */
    passaramDaHora?: number;
    semMovimentacao: number;
    /**
     * QUAIS estão paradas — até 10, das mais antigas. É o que deixa a faixa
     * abrir a atividade certa em vez de jogar a pessoa na agenda inteira.
     *
     * Opcional pela janela de troca do deploy: a API de antes não manda, e aí
     * a faixa volta a ser só o número.
     */
    paradas?: {
      id: string;
      titulo: string;
      inicio: string;
      updatedAt: string;
      responsavel: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null } | null;
    }[];
    /**
     * A EQUIPE DO ADVOGADO — as tarefas em que o robô o pôs de reserva.
     *
     * `precisam`: ninguém está cuidando — o responsável está sem entrar há uma
     * semana ou mais (ou saiu do sistema), ou o dia virou. `acompanhando`: em dia
     * e com o dono por perto, de hoje a sete dias. Só no painel do advogado, e
     * opcional pela janela de troca do deploy.
     */
    daEquipe?: {
      precisam: {
        id: string;
        titulo: string;
        inicio: string;
        responsavel: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null };
        motivo: 'RESPONSAVEL_AUSENTE' | 'FICOU_PARA_TRAS';
        diasSemEntrar: number | null;
        inativo: boolean;
        /** "Dr. Carlos está sem entrar há 39 dias" — a frase vem da API, a mesma da faixa. */
        detalhe: string;
      }[];
      totalPrecisam: number;
      acompanhando: {
        id: string;
        titulo: string;
        inicio: string;
        responsavel: { id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null };
      }[];
      totalAcompanhando: number;
    };
    urgentes: number;
    /** Audiências designadas no DataJud e ainda fora da Agenda. */
    audienciasAAgendar: number;
  };
  /** Amostra do radar de audiências (o total vem em `alertas`). */
  audienciasAAgendar: AudienciaAAgendar[];
  atividadesHoje: CompromissoCard[];
  /**
   * O QUE VENCE DE AMANHÃ ATÉ +7 DIAS — a janela que não existia.
   *
   * A home tinha vencido, hoje e audiência da semana. Um PRAZO para amanhã não
   * cabia em nenhuma: aparecia só como número no cartão. Medido em 07/09/2026,
   * os SEIS compromissos abertos do sindicato caíam todos nessa faixa — a tela
   * dizia "nenhuma atividade agendada para hoje" e nada mais. Opcional porque a
   * API antiga não manda.
   */
  proximasAtividades?: CompromissoCard[];
  audienciasSemana: CompromissoCard[];
  /**
   * QUANTAS O "VER" DO BLOCO VAI ABRIR — count() com o recorte de 7 dias da
   * agenda (inclui a que ficou para trás e a concluída na janela), no mesmo
   * escopo do painel. A lista acima vem com `take: 8` e só as abertas de hoje em
   * diante: o selo contava a lista e dava 2 ao lado de "Minhas audiências 4".
   * Opcional pela janela de troca do deploy; sem ele, o selo não mostra número.
   */
  audienciasSemanaTotal?: number;
  pendenciasAtivas: CompromissoCard[];
  atendimentosPendentes: AtendimentoPendente[];
  movimentacoesRecentes: MovimentacaoRecente[];
  equipeHoje: {
    plantaoHoje: PlantaoItem[];
    proximoPlantao: {
      data: string;
      /**
       * COM AS HORAS — e sem elas o cartão só dizia a data.
       *
       * Medido: o próximo plantão costuma estar a QUATRO dias (a escala pula o
       * fim de semana), então "segunda-feira, 14/09" não responde a que horas
       * alguém volta a estar disponível.
       *
       * Opcional porque a API pode ser a de antes durante a janela de troca —
       * web e API sobem em serviços separados. Aí vale `advogados`, sem horas.
       */
      pessoas?: { horaInicio: string; horaFim: string; advogado: PessoaResumo }[];
      /** @deprecated Use `pessoas`. Some quando a web tiver girado. */
      advogados: PessoaResumo[];
    } | null;
    /*
      NULO sem acesso a escalas: a API corta o bloco no servidor (C7), e o tipo
      continuava prometendo o objeto. Conferido na revisão de 13/09/2026.
    */
  } | null;
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
     * EM_DIA      trouxe publicação há menos de 2 DIAS ÚTEIS
     * SILENCIOSA  já trouxe antes e parou há 2+ dias úteis
     *
     * DIAS ÚTEIS, e não horas: o Diário não circula no fim de semana — das
     * 1.408 publicações da produção, ZERO são de sábado ou domingo. Com corte
     * em horas, todo domingo a home acusava silêncio.
     */
    situacao: 'DESLIGADA' | 'PRIMEIRA' | 'EM_DIA' | 'SILENCIOSA';
    /** Dias úteis desde a última publicação. Opcional: API antiga não manda. */
    diasUteisSemNada?: number | null;
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
      /**
       * O ATO NOMEIA QUEM ESTÁ OLHANDO?
       *
       * Só tem sentido no escopo PESSOAL. O prazo corre para quem foi
       * INTIMADO, e isso é diferente de "o processo está vinculado a mim":
       * medido em 07/09/2026, a Dra. Jaqueline era citada em 4 publicações e o
       * painel dela mostrava zero, enquanto a Dra. Morgana via 32 das quais 6 a
       * citavam. Opcional porque a API antiga não manda.
       */
      meCita?: boolean;
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
   * O RITMO DO DIÁRIO, oito semanas — o gráfico de quem trabalha com processo.
   *
   * NULO para quem não vê processo e para integração desligada. Zero seria
   * "semana calma", que é outra coisa.
   */
  movimentoNoDiario: {
    semanas: { semana: string; total: number }[];
    total: number;
    pico: number;
    providencias: { chave: string; total: number }[];
    escopo: 'PESSOAL' | 'GLOBAL';
  } | null;
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
  /**
   * NULO PARA QUEM NÃO VÊ PROCESSO (18/09/2026).
   *
   * O bloco inteiro é do robô do DataJud e leva NPU, tribunal e o nome do
   * filiado nas duas listas. Ia sem condição para todo mundo — inclusive a
   * Triagem, que tem `processos: SEM_ACESSO`: a tela escondia e o payload
   * chegava. Nulo, e não objeto vazio, para a tela distinguir "não é para
   * você" de "está tudo em dia".
   */
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
    /**
     * Quantas falhas cabem em `falhasProcessos`. Menor que `falhas24h` quando o
     * corte agiu — e a tela diz isso em vez de fingir que a lista é tudo.
     * Ausente na API antiga.
     */
    falhasMostradas?: number;
    /** NPUs que o CNJ não encontra — conferência de cadastro, não falha. */
    desconhecidosNoCnj?: ProcessoDesconhecidoNoCnj[];
    /**
     * Quantos NPUs desconhecidos existem, antes do corte de 10 da API.
     *
     * Ausente na janela de troca (API antiga): a tela trata como "não sei" e
     * não anuncia corte nenhum, em vez de afirmar que a lista é tudo.
     */
    desconhecidosTotal?: number;
  } | null;
  /**
   * Carga da equipe — quem está sobrecarregado e quem está atrasado.
   * NULO para o advogado: é instrumento de gestão, não ranking do time.
   */
  cargaEquipe: {
    advogado: PessoaResumo;
    abertas: number;
    atrasadas: number;
    /**
     * A última vez que a pessoa usou o sistema: entrou, renovou a sessão ou
     * mexeu em alguma coisa. Opcional pela janela de troca do deploy.
     */
    ultimoAcesso?: string | null;
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
    /**
     * Até quando vale o link de recadastramento que está circulando (não usado,
     * não revogado, não expirado). Nulo quando não há. Opcional pela janela de
     * troca do deploy: a API de antes não manda.
     */
    linkAtivoAte?: string | null;
    /** Quando o filiado respondeu pelo link pela última vez. */
    respondeuPeloLinkEm?: string | null;
    /** Tem celular utilizável (principal OU secundário). */
    temCelular?: boolean;
  }[];
  /**
   * Quantos cadastros entram no critério, sem o corte da lista. É o que deixa o
   * cartão dizer "12 de 16" em vez de parecer o todo. Opcional pela janela de troca.
   */
  cadastrosACompletarTotal?: number;
  /**
   * AS FONTES EXTERNAS ESTÃO DE PÉ? Nulo para quem não coordena — é a única
   * pessoa que faz alguma coisa com a resposta.
   */
  integracoes:
    | {
        fonte: string;
        /**
         * `NAO_RODOU` é diferente de `PARADA`, e a diferença manda em quem se
         * procura: PARADA é "tentamos e não voltou" (CNJ, ponte, certificado);
         * NAO_RODOU é "ninguém tentou" (agendador, flag desligada).
         */
        situacao: 'OK' | 'INSTAVEL' | 'PARADA' | 'NAO_RODOU' | 'SEM_USO';
        ok24: number;
        falhas24: number;
        ultimoSucesso: string | null;
        /**
         * Dias ÚTEIS desde a última chamada que voltou.
         *
         * É o critério do atraso, e não "24h sem chamada": com uma varredura
         * diária, 24h dispara em qualquer soluço — um domingo, um feriado, uma
         * rodada que atrasou. Opcional: a API antiga não manda.
         */
        diasUteisSemSucesso?: number | null;
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
    /**
     * JÁ CUIDARAM DESTA PESSOA HOJE? (18/09/2026)
     *
     * O cartão era passivo e ninguém sabia se alguém já tinha falado com a
     * aniversariante — duas pessoas cumprimentavam a mesma e nenhuma a outra.
     * Nulo = ainda pede alguém. Opcional pela janela de troca do deploy.
     */
    decisao?: { desfecho: 'PARABENIZADO' | 'DEIXOU_PASSAR'; autor: string | null; em: string } | null;
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

/*
  CANCELADA NÃO É ALARME (15/09/2026). Era rosa e riscada: o vermelho dizia "deu
  errado" sobre uma decisão tomada, e o riscado atrapalhava a leitura a 400 px.
  A mesma regra do atendimento e da agenda: neutro.
*/
export const STATUS_COMP_COR: Record<StatusCompromisso, string> = {
  PENDENTE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  EM_ANDAMENTO: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  CONCLUIDO: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  CANCELADO: 'bg-muted text-muted-foreground',
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
/**
 * TÍTULO NÃO É NOME — 18/09/2026.
 *
 * "Boa noite 'dr. o quê?'", perguntou o dono ao abrir o painel de um advogado.
 * A saudação pegava a PRIMEIRA PALAVRA do nome de exibição, e quando ele começa
 * por "Dr." a tela cumprimentava o título: "Boa noite, Dr.". Os nove advogados
 * da casa estão cadastrados assim.
 *
 * Pular o tratamento devolve a pessoa. Se sobrar só o título — alguém cadastrado
 * como "Dra." e mais nada —, ele volta: cumprimentar por um tratamento é feio,
 * cumprimentar o vazio é defeito.
 */
const TRATAMENTOS = new Set([
  'dr', 'dra', 'drs', 'dras', 'sr', 'sra', 'srs', 'sras', 'exmo', 'exma', 'prof', 'profa',
]);

export function saudacao(nome: string): string {
  const h = new Date().getHours();
  const prefixo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
  const semTratamento = partes.filter(
    (p) => !TRATAMENTOS.has(p.replace(/\./g, '').toLowerCase()),
  );
  const primeiro = (semTratamento[0] ?? partes[0] ?? '').trim();
  return primeiro ? `${prefixo}, ${primeiro}` : prefixo;
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
 * O PRIMEIRO NOME DE UM NOME SOLTO.
 *
 * Irmã de `primeiroNome`, que recebe a PESSOA e prefere o nome de exibição.
 * Aqui só existe o texto — o aniversariante vem da consulta crua, sem o objeto
 * de pessoa. Nomes diferentes de propósito: duas funções com a mesma assinatura
 * e regras diferentes já custaram caro neste projeto.
 */
export function soOPrimeiroNome(nome: string): string {
  const primeiro = (nome || '').trim().split(/\s+/)[0] || nome;
  /*
    A BASE GRAVA EM CAIXA ALTA, e a tela não precisa gritar. "Você parabenizou
    JOANA?" soa como cobrança; "Você parabenizou Joana?" soa como pergunta. Só
    a primeira letra sobe — nome de duas letras ou vazio passa intacto.
  */
  if (!primeiro) return primeiro;
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
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
  /*
    ESCRITO PARA QUEM LÊ, NÃO PARA QUEM DEPURA.

    Os textos anteriores eram etiquetas de log: "NPU recusado pelo CNJ", "chave
    da API recusada", "erro 502 no CNJ". Quem abre o painel de manhã não decide
    nada com isso — precisa saber se É COM ELE, e o que fazer.

    Então cada motivo agora responde duas coisas na mesma frase: o que
    aconteceu e de quem é a bola. `passageiro` continua separando o que a
    próxima varredura resolve sozinha do que vai falhar de novo amanhã.
  */
  if (s === 404) {
    return { texto: 'o CNJ ainda não publicou este processo', passageiro: false };
  }
  if (s === 401 || s === 403) {
    return { texto: 'a chave de acesso ao CNJ foi recusada — é configuração nossa', passageiro: false };
  }
  if (s === 400 || s === 422) {
    return { texto: 'o CNJ não aceitou o número — confira se está digitado certo', passageiro: false };
  }
  /*
    429 É NOSSO, E O TEXTO DIZIA O CONTRÁRIO. "limite de consultas atingido"
    soa como restrição do CNJ; na verdade é a nossa varredura passando do teto
    de 20 req/min — foram 6 em 04/09/2026, antes do limitador entrar.
  */
  if (s === 429) {
    return { texto: 'nossa varredura passou do limite de consultas do CNJ', passageiro: true };
  }
  if (s && s >= 500) {
    return { texto: 'o sistema do tribunal estava fora do ar', passageiro: true };
  }
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
    return { texto: 'o CNJ demorou demais para responder (mais de 45s)', passageiro: true };
  }
  return {
    texto: s ? `o CNJ respondeu com erro ${s}` : 'o CNJ não respondeu',
    passageiro: true,
  };
}

/**
 * "AINDA NÃO PUBLICADO" x "ALGUÉM PRECISA OLHAR" — a mesma tela, dois recados.
 *
 * O índice público do CNJ demora a receber processo novo. Medido em
 * 07/09/2026: o único NPU que o CNJ não reconhece foi distribuído há 13 dias e
 * está PENDENTE — não há nada errado, e mandar "confira o número" ali é mandar
 * a equipe caçar um defeito que não existe.
 *
 * Passado um mês, a leitura vira ao contrário: aí o índice já deveria tê-lo, e
 * o palpite mais provável é número digitado errado. O corte tem de existir,
 * senão o aviso ou mente para tranquilizar ou mente para assustar.
 */
export const DIAS_ESPERA_RAZOAVEL_CNJ = 30;

export function esperaAindaRazoavel(desde: string | Date): boolean {
  const dias = (Date.now() - new Date(desde).getTime()) / 86_400_000;
  return dias < DIAS_ESPERA_RAZOAVEL_CNJ;
}

/** Dias inteiros desde a primeira tentativa — o número que vai no texto. */
export function diasEsperando(desde: string | Date): number {
  return Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 86_400_000));
}

/**
 * QUANDO O ROBÔ TENTOU PELA ÚLTIMA VEZ — "hoje às 05h47", "ontem", "12/09".
 *
 * Isto substitui o contador que estava na tela ("consultado 272× desde
 * 24/08/2026"), e a troca não é de estilo.
 *
 * MEDIDO NA PRODUÇÃO EM 25/09/2026, no NPU campeão: das 272 consultas, **260
 * são anteriores a 12/09** — dias de 14, 39, 41 e até 52 consultas ao MESMO
 * número, de um defeito de ritmo que foi corrigido. De 12/09 para cá foram
 * 12 consultas em 13 noites: **exatamente uma por noite**, igual a todo o
 * resto do acervo (medido: 1,0× por NPU por dia, todos os dias).
 *
 * Ou seja: o 272 era verdade como HISTÓRIA e mentira como descrição do
 * presente. Quem lia via desperdício onde já não há nenhum — e a conta nunca
 * mais desce, porque conta linha de log que ninguém apaga.
 *
 * O que decide alguma coisa é outra dupla: **há quanto tempo** o número é
 * recusado (isso sim cresce sozinho até virar problema) e **se o robô ainda
 * está tentando** — que é o que tranquiliza sem inventar número.
 */
export function ultimaTentativaDoCnj(iso: string | Date, agora = new Date()): string {
  const d = new Date(iso);
  const dia = (x: Date) => x.toLocaleDateString('pt-BR');
  const hora = () => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const ontem = new Date(agora.getTime() - 86_400_000);
  if (dia(d) === dia(agora)) return `hoje às ${hora()}`;
  if (dia(d) === dia(ontem)) return `ontem às ${hora()}`;
  return dia(d);
}

/**
 * OS QUE PASSARAM DA ESPERA, SEPARADOS DOS QUE AINDA ESTÃO NELA.
 *
 * A faixa decidia o tom com `itens.every(esperaAindaRazoavel)` — "BASTA UM
 * FORA DO PRAZO", escrevi na época, e para uma lista de um ou dois itens
 * estava certo. Em 25/09/2026 a lista tem SETE: um cadastrado há 32 dias (esse
 * merece suspeita) e quatro do TRT22 cadastrados há 11 (o índice do CNJ leva
 * mesmo esse tempo). O `every` fazia a tela mandar "conferir se o número está
 * digitado certo" para os SEIS que não têm nada de errado.
 *
 * É o mesmo defeito que já custou caro duas vezes aqui: acusar em bloco quem
 * não estava devendo ensina a equipe a ignorar a faixa inteira — e aí o único
 * que precisava de gente passa junto.
 *
 * A correção não é um segundo bloco (ver o painel em quatro zonas): é UMA
 * faixa, com os suspeitos NA FRENTE e marcados, e uma frase que diz quantos
 * são de cada tipo.
 */
export function separarDesconhecidos(itens: ProcessoDesconhecidoNoCnj[]): {
  passaramDoPrazo: ProcessoDesconhecidoNoCnj[];
  aindaNoPrazo: ProcessoDesconhecidoNoCnj[];
  ordenados: ProcessoDesconhecidoNoCnj[];
} {
  const passaramDoPrazo: ProcessoDesconhecidoNoCnj[] = [];
  const aindaNoPrazo: ProcessoDesconhecidoNoCnj[] = [];
  for (const i of itens) (esperaAindaRazoavel(i.desde) ? aindaNoPrazo : passaramDoPrazo).push(i);
  // O mais antigo primeiro dentro de cada grupo: é ele que mais pede alguém.
  const porIdade = (a: ProcessoDesconhecidoNoCnj, b: ProcessoDesconhecidoNoCnj) =>
    new Date(a.desde).getTime() - new Date(b.desde).getTime();
  passaramDoPrazo.sort(porIdade);
  aindaNoPrazo.sort(porIdade);
  return { passaramDoPrazo, aindaNoPrazo, ordenados: [...passaramDoPrazo, ...aindaNoPrazo] };
}

// ---------------------------------------------------------------------------
// Números que levam ao mesmo recorte (C11)
// ---------------------------------------------------------------------------

/**
 * O ENDEREÇO DA AGENDA PARA UM NÚMERO DO PAINEL.
 *
 * Quase todo número do painel abria outro número: "Atrasadas 3" levava à aba
 * Hoje, onde atrasada de dia anterior nunca aparece; "Esperando por: Morgana 4"
 * abria a agenda dela inteira, com equipe e reserva junto. A agenda lê estes
 * parâmetros com `lerUrlDaAgenda` — o teste passa cada link por ela e confere
 * que o recorte que chega é o que o número contou.
 *
 * `pessoa: 'eu'` é resolvido pela agenda com a sessão de quem clicou.
 */
export function linkDaAgenda(f: {
  aba: RecorteAgenda;
  pessoa?: string;
  reservaDe?: string;
  responsavel?: string;
  somenteResponsavel?: boolean;
  tipo?: string;
  urgentes?: boolean;
}): string {
  const p = new URLSearchParams();
  p.set('aba', f.aba);
  if (f.pessoa) p.set('pessoa', f.pessoa);
  if (f.reservaDe) p.set('reservaDe', f.reservaDe);
  if (f.responsavel) {
    p.set('responsavel', f.responsavel);
    if (f.somenteResponsavel) p.set('somenteResponsavel', '1');
  }
  if (f.tipo) p.set('tipo', f.tipo);
  if (f.urgentes) p.set('urgentes', '1');
  return `/agenda?${p.toString()}`;
}

/**
 * "PRAZOS ESTA SEMANA" ABRE OS PRAZOS QUE CONTOU.
 *
 * No escopo pessoal a API conta os prazos pela régua `daPessoa`; o link ia sem
 * `pessoa` e a agenda abria os prazos da casa inteira (revisão de 13/09/2026:
 * o cartão dizia 3 e o clique mostrava 11). Na gestão o número é da casa.
 */
export function linkDosPrazosDaSemana(escopo: ResumoDashboard['escopo']): string {
  return linkDaAgenda({ aba: '7dias', tipo: 'PRAZO', ...(escopo === 'PESSOAL' ? { pessoa: 'eu' } : {}) });
}

/**
 * O SELO DE "AUDIÊNCIAS DA SEMANA" — o total do recorte que o "Ver" abre, ou
 * nada. Sem o total (API de antes, na janela de troca), não mostrar número é
 * melhor que mostrar o tamanho da lista, que é outro conjunto.
 */
export function seloDasAudienciasDaSemana(r: Pick<ResumoDashboard, 'audienciasSemanaTotal'>): number | undefined {
  return typeof r.audienciasSemanaTotal === 'number' ? r.audienciasSemanaTotal : undefined;
}

/**
 * O TEXTO DO RODAPÉ DAS ATIVIDADES — número só quando o destino conta o mesmo.
 *
 * Quando o que ficou de fora pede atenção, o rodapé leva à aba "Pedem atenção"
 * e as ocultas saem dos totais da API. Senão leva a "7 dias", que conta também
 * as audiências e as próximas cortadas pelo `take` — conjuntos que o painel não
 * recebe. "Mais 6" abria uma aba com 20 (revisão de 13/09/2026); ali o texto
 * não afirma número.
 */
export function textoDoRodapeDasAtividades(o: { ocultas: number; atencaoOculta: number; pessoal: boolean }): string {
  if (o.atencaoOculta > 0) return `Mais ${o.ocultas} ${o.pessoal ? 'na agenda' : 'da equipe na agenda'}`;
  return o.pessoal ? 'Ver os próximos 7 dias na agenda' : 'Ver a agenda da equipe nos próximos 7 dias';
}

/**
 * A PARTIR DE QUANTOS DIAS SEM ANDAMENTO O PROCESSO ESTÁ "PARADO".
 *
 * O cartão dizia "há 30d" enquanto a API contava com 90 (`DIAS_ATE_DORMENTE`,
 * em `processos/utils/tpu.util.ts`). Um teste lê o número de lá: se a regra
 * mudar na API e não aqui, ele reprova.
 */
export const DIAS_PARA_PARADO = 90;

const FUSO_BR = 'America/Fortaleza';

function diaBR(instante: number): string {
  return new Date(instante - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** "15h20" no fuso de Teresina. */
function horaComH(d: Date): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: FUSO_BR,
  }).formatToParts(d);
  const h = partes.find((x) => x.type === 'hour')?.value ?? '';
  const m = partes.find((x) => x.type === 'minute')?.value ?? '';
  return `${h}h${m}`;
}

function diaMes(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: FUSO_BR });
}

/**
 * O ESTADO DO LINK DE RECADASTRAMENTO NA LINHA DO CARTÃO — estado, nunca evento.
 *
 * O sistema sabe se há link valendo e se o filiado respondeu; não sabe se a
 * mensagem chegou. Por isso nunca "enviado": "link ativo até 15h20" ou
 * "respondeu pelo link em 12/09". Link vencido não é dito (não há o que fazer
 * com ele); o que vale é a resposta, se houve.
 */
export function textoDoLinkDeRecadastro(
  item: { linkAtivoAte?: string | null; respondeuPeloLinkEm?: string | null },
  agora: number = Date.now(),
): string | null {
  if (item.linkAtivoAte) {
    const ate = new Date(item.linkAtivoAte);
    if (Number.isFinite(ate.getTime()) && ate.getTime() > agora) {
      return diaBR(ate.getTime()) === diaBR(agora)
        ? `link ativo até ${horaComH(ate)}`
        : `link ativo até ${diaMes(ate)}, ${horaComH(ate)}`;
    }
  }
  if (item.respondeuPeloLinkEm) {
    const em = new Date(item.respondeuPeloLinkEm);
    if (Number.isFinite(em.getTime())) return `respondeu pelo link em ${diaMes(em)}`;
  }
  return null;
}

/**
 * A MENSAGEM DE PARABÉNS — sem emoji.
 *
 * O emoji saía como quadrado em aparelho antigo e no WhatsApp Web de alguns
 * computadores da sede; e o nome vinha em CAIXA ALTA do cadastro ("Olá, MARIA!").
 */
export function mensagemDeAniversario(nome: string, sigla: string): string {
  const primeiro = (nome ?? '').trim().split(/\s+/)[0] ?? '';
  const bonito = primeiro ? primeiro.charAt(0).toLocaleUpperCase('pt-BR') + primeiro.slice(1).toLocaleLowerCase('pt-BR') : '';
  return bonito
    ? `Olá, ${bonito}! O ${sigla} deseja a você um feliz aniversário.`
    : `Olá! O ${sigla} deseja a você um feliz aniversário.`;
}

// ---------------------------------------------------------------------------
// Concluir pelo painel
// ---------------------------------------------------------------------------

/**
 * AS CONSULTAS QUE UMA CONCLUSÃO MUDA — as chaves de verdade.
 *
 * O bloco invalidava `['dashboard']` e `['agenda']`, que nenhuma consulta usa: a
 * linha concluída ficava com o botão por até 60 s, o segundo toque voltava 400
 * "já está concluída" e a faixa do topo continuava contando. O react-query
 * compara elemento a elemento; `'dashboard'` não casa com `'dashboard-resumo'`.
 *
 * `['processos']` e `['processo-dossie']` entraram em 13/09/2026: a conclusão
 * grava o andamento no processo e pode abrir um caso pré-processual. Pelo painel
 * a lista de Processos ficava sem o caso novo e a ficha aberta sem o andamento
 * até o cache vencer (30 s); a agenda invalidava só a lista. A agenda usa esta
 * mesma constante.
 *
 * `['atendimentos']` e `['atendimento']` entraram em 15/09/2026: concluir a
 * consulta nascida de um atendimento fecha o atendimento junto, e desfazer o
 * devolve. Sem elas, a lista e a gaveta da triagem diriam "Aguardando a
 * consulta" de um atendimento já concluído.
 */
export const CHAVES_DEPOIS_DE_CONCLUIR: readonly (readonly string[])[] = [
  ['dashboard-resumo'],
  ['compromissos'],
  ['compromisso'],
  ['minhas-pendencias'],
  ['processos'],
  ['processo-dossie'],
  ['atendimentos'],
  ['atendimento'],
];

// ---------------------------------------------------------------------------
// Atendimentos no painel: a fila da triagem (15/09/2026)
// ---------------------------------------------------------------------------

export const HREF_ATENDIMENTOS_COM_A_TRIAGEM = '/atendimentos?status=PENDENTE&fila=TRIAGEM';
export const HREF_ATENDIMENTOS_AGUARDANDO_CONSULTA = '/atendimentos?status=PENDENTE&fila=CONSULTA';

/**
 * O KPI DOS ATENDIMENTOS conta o que pede a triagem, não todo pendente.
 *
 * Em 14/09/2026 o #13 e o #14 somavam no "Atendimentos pendentes" com a
 * triagem sem nada a fazer: um esperava a consulta de hoje, o outro a de
 * quinta. Sem o campo novo (API de antes), o KPI de sempre.
 */
export function kpiDosAtendimentos(kpis: ResumoDashboard['kpis']): { label: string; valor: number; sub: string; href: string } {
  if (typeof kpis.atendimentosComATriagem === 'number') {
    return { label: 'Com a triagem', valor: kpis.atendimentosComATriagem, sub: 'pedem uma ação', href: HREF_ATENDIMENTOS_COM_A_TRIAGEM };
  }
  return { label: 'Atendimentos pendentes', valor: kpis.atendimentosPendentes, sub: 'aguardando resolução', href: '/atendimentos?status=PENDENTE' };
}

/**
 * O CARTÃO DOS ATENDIMENTOS: a lista é da triagem; o que espera a consulta vira
 * uma linha neutra com link ("e mais 2 aguardando a consulta"). O mesmo
 * atendimento não aparece em âmbar aqui e na agenda de quem atende.
 */
export function cartaoDosAtendimentos(r: Pick<ResumoDashboard, 'kpis' | 'atendimentosPendentes'>): {
  titulo: string;
  contagem: number;
  itens: AtendimentoPendente[];
  aguardandoConsulta: number;
  href: string;
  hrefAguardando: string;
  vazio: string;
} {
  const todos = r.atendimentosPendentes ?? [];
  const itens = todos.filter((a) => filaDe(a)?.fila !== 'CONSULTA');
  const comFila = typeof r.kpis.atendimentosComATriagem === 'number';
  const aguardandoConsulta = typeof r.kpis.atendimentosAguardandoConsulta === 'number'
    ? r.kpis.atendimentosAguardandoConsulta
    : todos.length - itens.length;
  return {
    titulo: comFila ? 'Com a triagem' : 'Atendimentos pendentes',
    contagem: comFila ? r.kpis.atendimentosComATriagem! : r.kpis.atendimentosPendentes,
    itens,
    aguardandoConsulta,
    href: comFila ? HREF_ATENDIMENTOS_COM_A_TRIAGEM : '/atendimentos?status=PENDENTE',
    hrefAguardando: HREF_ATENDIMENTOS_AGUARDANDO_CONSULTA,
    vazio: comFila ? 'Nenhum atendimento pedindo a triagem.' : 'Nenhum atendimento aguardando resolução.',
  };
}

/** A barra lateral da linha: âmbar só na fila da triagem. Sem fila (API de antes), âmbar como sempre. */
export function barraDoAtendimento(a: Pick<AtendimentoPendente, 'fila'>): string {
  const naFila = filaDe(a);
  if (naFila === undefined) return 'bg-amber-400';
  return naFila?.fila === 'TRIAGEM' ? 'bg-amber-400' : 'bg-border';
}

/*
  O MEU RECORTE DA FILA DA TRIAGEM (15/09/2026). A API conta o "Comigo, com a
  triagem" só pelos atendimentos que a pessoa registrou (`atendentePorId`), e o
  link abria a fila da casa inteira: 1 no número, 5 na lista, o erro do
  Panorama de novo. `atendente=me` leva o mesmo recorte para a lista.
*/
export const HREF_ATENDIMENTOS_COMIGO_COM_A_TRIAGEM = `${HREF_ATENDIMENTOS_COM_A_TRIAGEM}&atendente=me`;

/** "Comigo, com a triagem" pela fila; na API de antes, o "em aberto" de sempre. */
export function kpiDoBalcao(m: NonNullable<ResumoDashboard['minhaTriagem']>): { label: string; valor: number; sub: string; href: string } {
  if (typeof m.comATriagem === 'number') {
    return { label: 'Comigo, com a triagem', valor: m.comATriagem, sub: 'pedem uma ação', href: HREF_ATENDIMENTOS_COMIGO_COM_A_TRIAGEM };
  }
  return { label: 'Comigo, em aberto', valor: m.semDesfecho, sub: 'aguardando desfecho', href: '/atendimentos' };
}

// ---------------------------------------------------------------------------
// Publicação sem tarefa no painel (15/09/2026)
// ---------------------------------------------------------------------------

/**
 * POR QUE O ROBÔ NÃO CRIOU TAREFA, E O QUE O PAINEL OFERECE.
 *
 * O painel tratava todo motivo que não fosse NOTICIA_VELHA como "a ordem é para
 * a outra parte", inclusive a cópia do mesmo ato e o ato fora da janela, e
 * oferecia "Criar tarefa" numa cópia cuja irmã já tinha tarefa: duas tarefas
 * para o mesmo prazo. A explicação agora é a de MOTIVO_SEM_TAREFA, a mesma da
 * ficha do processo; na cópia não há "Criar tarefa", e a tarefa da irmã abre
 * quando a API diz qual é.
 *
 * A CÓPIA SEM IRMÃ COM TAREFA (15/09/2026). A cópia também nasce assim quando a
 * irmã ainda é proposta aberta na caixa: nada foi decidido, e a linha ficava
 * sem "Criar tarefa", sem "Abrir a tarefa" e com a frase "ato já decidido". O
 * POST da tarefa já cobre esse caso (liga a irmã aberta ou cria a tarefa e a
 * propaga às cópias), então o botão volta e a ajuda não afirma decisão.
 */
export const AJUDA_DA_COPIA_SEM_TAREFA =
  'O tribunal enviou o mesmo ato mais de uma vez, uma para cada intimado, e nenhuma cópia virou tarefa ainda. Se a outra cópia está na caixa de propostas, criar a tarefa aqui resolve as duas: não nasce tarefa repetida.';

export function explicacaoDaPublicacaoSemTarefa(p: {
  temTarefa: boolean;
  teor: { tarefaDispensadaMotivo?: string | null; tarefaDoMesmoAto?: { id: string } | null } | null | undefined;
}): { ajuda: string | null; podeCriar: boolean; tarefaDoMesmoAtoId: string | null } {
  if (p.temTarefa) return { ajuda: null, podeCriar: false, tarefaDoMesmoAtoId: null };
  const motivo = p.teor?.tarefaDispensadaMotivo ?? null;
  const ajuda = motivo ? MOTIVO_SEM_TAREFA[motivo]?.ajuda ?? null : null;
  if (motivo === 'COPIA_DO_MESMO_ATO') {
    const irma = p.teor?.tarefaDoMesmoAto?.id ?? null;
    if (!irma) return { ajuda: AJUDA_DA_COPIA_SEM_TAREFA, podeCriar: true, tarefaDoMesmoAtoId: null };
    return { ajuda, podeCriar: false, tarefaDoMesmoAtoId: irma };
  }
  return { ajuda, podeCriar: true, tarefaDoMesmoAtoId: null };
}

/**
 * A LINHA SAI DA FILA NA HORA — sem esperar a volta do servidor.
 *
 * Função pura sobre o resumo em cache: some das atrasadas e dos próximos dias;
 * nas de hoje vira CONCLUIDO (é o registro do dia e desce para o fim da fila); e
 * o contador do cabeçalho perde a unidade que ela ocupava. Se a API recusar, a
 * tela devolve o resumo de antes.
 */
export function concluirNoResumo(r: ResumoDashboard, id: string, agora: number = Date.now()): ResumoDashboard {
  const todas = [...(r.pendenciasAtivas ?? []), ...(r.atividadesHoje ?? []), ...(r.proximasAtividades ?? [])];
  const item = todas.find((c) => c.id === id);
  if (!item || item.status === 'CONCLUIDO' || item.status === 'CANCELADO') return r;

  const inicio = new Date(item.inicio).getTime();
  const atrasada = diaBR(inicio) < diaBR(agora);
  const passouDaHora = !atrasada && inicio < agora;

  return {
    ...r,
    alertas: {
      ...r.alertas,
      atrasadas: atrasada ? Math.max(0, r.alertas.atrasadas - 1) : r.alertas.atrasadas,
      ...(r.alertas.passaramDaHora !== undefined
        ? {
            passaramDaHora: passouDaHora
              ? Math.max(0, r.alertas.passaramDaHora - 1)
              : r.alertas.passaramDaHora,
          }
        : {}),
    },
    pendenciasAtivas: (r.pendenciasAtivas ?? []).filter((c) => c.id !== id),
    atividadesHoje: (r.atividadesHoje ?? []).map((c) =>
      c.id === id ? { ...c, status: 'CONCLUIDO' as const } : c,
    ),
    ...(r.proximasAtividades ? { proximasAtividades: r.proximasAtividades.filter((c) => c.id !== id) } : {}),
  };
}

/**
 * AS FATIAS DO GRÁFICO "ATENDIMENTOS POR CANAL".
 *
 * TRÊS CONSERTOS NUMA FUNÇÃO SÓ (18/09/2026), depois de o dono perguntar
 * "aparece um: 5, 5 o quê?" — e ele estava lendo o markup certo:
 *
 *  1. A COR SEGUIA A POSIÇÃO no array já filtrado, contra o contrato escrito da
 *     paleta ("a cor acompanha a ENTIDADE; filtrar um canal não pode repintar
 *     os que sobraram"). Um dia sem atendimento presencial repintava o WhatsApp.
 *     Aqui o índice é o do canal em `CANAIS`, que é fixo.
 *  2. O NÚMERO NÃO TINHA UNIDADE e o rótulo mais próximo estava a 200px. Cada
 *     fatia passa a carregar a frase inteira, que vira o `title` e o texto do
 *     leitor de tela.
 *  3. ERA UM BECO SEM SAÍDA. `/atendimentos?canal=X` já existia e ninguém
 *     chegava lá: a fatia agora leva à lista daquele canal.
 *
 * `fatia` é a participação arredondada; ela pode não somar 100 e isso é
 * esperado — a soma que vale é a dos ATENDIMENTOS, que é exata.
 */
export interface FatiaDeCanal {
  canal: string;
  nome: string;
  total: number;
  cor: string;
  fatia: number;
  href: string;
  descricao: string;
}

export function fatiasDosCanais(
  bruto: { canal: string; total: number }[],
  rotulo: Record<string, string>,
  ordemFixa: string[],
  paleta: string[],
): FatiaDeCanal[] {
  const comDados = bruto.filter((c) => c.total > 0);
  const soma = comDados.reduce((s, c) => s + c.total, 0);
  return comDados
    .map((c) => {
      const i = ordemFixa.indexOf(c.canal);
      const nome = rotulo[c.canal] ?? c.canal;
      const fatia = soma ? Math.round((c.total / soma) * 100) : 0;
      return {
        canal: c.canal,
        nome,
        total: c.total,
        // Canal que o web ainda não conhece (enum novo na API) não rouba a cor
        // de ninguém: cai na última da paleta, e o nome sai cru em vez de vazio.
        cor: paleta[(i < 0 ? paleta.length - 1 : i) % paleta.length],
        fatia,
        href: `/atendimentos?canal=${encodeURIComponent(c.canal)}`,
        descricao: `${nome}: ${c.total} ${c.total === 1 ? 'atendimento' : 'atendimentos'} (${fatia}%)`,
      };
    })
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * REGISTRA A DECISÃO SOBRE O ANIVERSÁRIO DE HOJE.
 *
 * Os DOIS desfechos são gravados. "Deixou passar" sem registro seria um botão
 * de fechar, e a casa não tem botão de fechar: o que faz um aviso sumir é o
 * FATO. E é o registro que impede duas pessoas de cumprimentarem a mesma
 * filiada enquanto ninguém fala com a outra.
 */
export async function registrarAniversario(dados: {
  pessoaId: string;
  tipo: 'FILIADO' | 'COLABORADOR';
  desfecho: 'PARABENIZADO' | 'DEIXOU_PASSAR';
}): Promise<{ ok: boolean }> {
  return (await api.post('/dashboard/aniversario', dados)).data;
}

/**
 * O QUE O CARTÃO DE ANIVERSARIANTES DIZ — e se ele ainda pede alguém.
 *
 * `pendentes` é o que move o cartão: enquanto houver um, ele fica aberto e
 * âmbar (âmbar pede você). Zerado, encolhe para UMA linha verde com o que foi
 * feito — não some, porque o fato de a casa ter cumprimentado três pessoas hoje
 * é boa notícia, e boa notícia vira linha, não desaparecimento.
 */
export function estadoDosAniversarios(
  itens: { decisao?: { desfecho: string } | null }[],
): { pendentes: number; parabenizados: number; deixouPassar: number; fechado: boolean } {
  const pendentes = itens.filter((p) => !p.decisao).length;
  const parabenizados = itens.filter((p) => p.decisao?.desfecho === 'PARABENIZADO').length;
  const deixouPassar = itens.filter((p) => p.decisao?.desfecho === 'DEIXOU_PASSAR').length;
  return {
    pendentes,
    parabenizados,
    deixouPassar,
    fechado: itens.length > 0 && pendentes === 0,
  };
}

/** "3 cumprimentados · 1 deixou passar" — o resumo do dia, sem zeros. */
export function resumoDosAniversarios(e: {
  parabenizados: number;
  deixouPassar: number;
}): string {
  const partes: string[] = [];
  if (e.parabenizados) {
    partes.push(
      e.parabenizados === 1 ? '1 pessoa cumprimentada' : `${e.parabenizados} pessoas cumprimentadas`,
    );
  }
  if (e.deixouPassar) {
    partes.push(e.deixouPassar === 1 ? '1 deixada para depois' : `${e.deixouPassar} deixadas para depois`);
  }
  return partes.join(' · ');
}
