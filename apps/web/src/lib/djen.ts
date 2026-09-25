import { api, TIMEOUT_LONGO } from './api';
import { V } from '@/lib/vocabulario';
import type { CoberturaDoDiario } from './djen-cobertura';

/**
 * Publicações e intimações do DJEN (Diário de Justiça Eletrônico Nacional).
 *
 * Complementa o DataJud: o CNJ entrega o rótulo do ato ("Expedição de
 * documento"), o DJEN entrega o TEOR — que é onde está a providência e o prazo.
 */

export interface PublicacaoDjen {
  id: string;
  hash: string;
  siglaTribunal: string;
  /** Intimação | Edital | Citação | Lista de distribuição. */
  tipoComunicacao: string | null;
  /** Texto livre, varia por tribunal — exibição apenas. */
  tipoDocumento: string | null;
  nomeOrgao: string | null;
  nomeClasse: string | null;
  /** D = Diário Nacional; E = Plataforma de Editais. */
  meio: string | null;
  link: string | null;
  /** Teor integral do ato. */
  texto: string;
  dataDisponibilizacao: string;
  /** Providência classificada a partir do texto. */
  providencia: string | null;
  /** Prazo que o TEXTO menciona — sugestão, não vencimento calculado. */
  prazoMencionadoDias: number | null;
  /** Atividade da agenda criada ou enriquecida por esta publicação. */
  compromissoId: string | null;
  /**
   * POR QUE o robô não criou tarefa — `NOTICIA_VELHA` ou `ORDEM_DA_OUTRA_PARTE`.
   *
   * Sem tarefa E sem motivo significa uma coisa só: o robô devia ter criado e
   * não criou. É o que separa decisão de falha, e é o que a faixa lê.
   */
  tarefaDispensadaMotivo: string | null;
  /**
   * A ordem do ato é NOSSA? Calculado na leitura, pela mesma regra do robô.
   *
   * `null` = indefinido, e a tela não afirma nada. Diferente de
   * `tarefaDispensadaMotivo`, que guarda o que o robô decidiu NO DIA — as duas
   * podem discordar sem contradição: um ato pode ter sido dispensado por ser
   * antigo E trazer ordem da parte contrária.
   */
  ordemEhNossa?: boolean | null;
  /** Movimentação do DataJud que descreve o mesmo fato. */
  movimentacaoId: string | null;
  destinatarios: { nome: string | null; polo: string | null }[] | null;
  advogados: { nome: string | null; numeroOab: string | null; ufOab: string | null }[] | null;
}

export interface StatusDjen {
  ativo: boolean;
  /**
   * O CNJ está recusando as consultas vindas do servidor (bloqueio do CDN por
   * origem da requisição). Não é limite de uso nem falha do sistema — nenhuma
   * tentativa a mais resolve.
   */
  bloqueadoNaOrigem?: boolean;
  janelaDias: number;
  publicacoes: number;
  /** Advogados que a varredura por OAB alcança. Zero aqui explica silêncio. */
  advogadosComOab: number;
  /**
   * Quem deveria ser consultado por OAB e não tem OAB no cadastro (14/09/2026).
   * Ausente na API anterior: a tela de Usuários não mostra a linha
   * (`idsSemOab` em lib/djen-cobertura.ts).
   */
  advogadosSemOab?: { id: string; nome: string }[];
}

/**
 * Rótulos das providências. O back devolve o slug; a tradução mora aqui porque
 * é texto de interface, e não regra.
 */
export const PROVIDENCIA_LABEL: Record<string, string> = {
  ANALISAR_INTIMACAO: 'Analisar intimação',
  ELABORAR_MANIFESTACAO: 'Elaborar manifestação',
  JUNTAR_DOCUMENTOS: 'Juntar documentos',
  ANALISAR_SENTENCA: 'Analisar sentença',
  AVALIAR_RECURSO: 'Avaliar recurso',
  PREPARAR_AUDIENCIA: 'Preparar audiência',
  SOLICITAR_DOCUMENTOS_FILIADO: `Solicitar documentos ao ${V.filiado}`,
  COMUNICAR_FILIADO: `Comunicar ${V.filiado}`,
};

/**
 * A COR DA PROVIDÊNCIA — porque é por ela que se varre a lista.
 *
 * São 1.420 publicações e a pergunta de quem rola a tela é sempre a mesma: "o
 * que eu tenho de FAZER aqui?". A resposta é a providência, e ela estava
 * desenhada como todo o resto — pílula cinza de 10px, do mesmo peso do tribunal
 * e do órgão. Nada puxava o olho para o único campo que muda a decisão.
 *
 * Três famílias, e a divisão é por ESFORÇO E RELÓGIO, não por assunto:
 *
 *  · ÂMBAR — tem peça a escrever ou data marcada. É o que consome dia de
 *    trabalho: manifestação, recurso, documento a juntar, audiência a preparar.
 *  · AZUL — é leitura e decisão. Não se resolve escrevendo; resolve-se lendo e
 *    decidindo se vira outra coisa.
 *  · VERDE — é contato com gente. Sai do jurídico e vai para a secretaria.
 *
 * Cinza é a rede: providência nova que alguém acrescentar aparece neutra em vez
 * de quebrar a tela ou, pior, herdar a cor errada em silêncio.
 */
export const PROVIDENCIA_COR: Record<string, string> = {
  ELABORAR_MANIFESTACAO:
    'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  AVALIAR_RECURSO: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  JUNTAR_DOCUMENTOS: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  PREPARAR_AUDIENCIA: 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300',

  ANALISAR_INTIMACAO: 'bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  ANALISAR_SENTENCA: 'bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-300',

  COMUNICAR_FILIADO:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  SOLICITAR_DOCUMENTOS_FILIADO:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
};

/** Neutro para o que ainda não tem cor — nunca herdar a de outra família. */
export const PROVIDENCIA_COR_PADRAO =
  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

/**
 * O QUE DIZER QUANDO NÃO HÁ TAREFA.
 *
 * "Sem tarefa" era silêncio, e silêncio numa tela jurídica se lê como falha.
 * São duas decisões diferentes do robô, e a diferença muda o que a pessoa faz:
 * notícia velha ela ignora; ordem da outra parte ela pode querer conferir, e
 * um prazo perdido do adversário às vezes é o que ela está esperando.
 */
export const MOTIVO_SEM_TAREFA: Record<string, { curto: string; ajuda: string }> = {
  NOTICIA_VELHA: {
    curto: 'Anterior ao acompanhamento',
    ajuda:
      'O ato saiu antes de este processo entrar no sistema — não havia como avisar na época, e uma tarefa criada agora nasceria vencida.',
  },
  FORA_DA_JANELA: {
    curto: 'Ato antigo, só classificado',
    ajuda:
      'A publicação é anterior à janela de acompanhamento diário. Ela foi lida e classificada para consulta, mas não gera tarefa — uma atividade criada agora nasceria vencida.',
  },
  ORDEM_DA_OUTRA_PARTE: {
    curto: 'Prazo da parte contrária',
    ajuda:
      'O ato manda a outra parte fazer algo e não há ordem dirigida a nós. Se você discordar, a atividade pode ser criada à mão na Agenda.',
  },
  // 14/09/2026: o tribunal manda uma cópia do mesmo ato por destinatário (mesmo
  // link). A decisão tomada sobre a primeira vale para as outras.
  COPIA_DO_MESMO_ATO: {
    curto: 'Cópia de um ato já decidido',
    ajuda:
      'O tribunal enviou o mesmo ato mais de uma vez, uma para cada intimado. A decisão sobre a primeira cópia vale para esta: não nasce proposta nem tarefa repetida.',
  },
};

/**
 * Estado da integração. É a única rota que responde com o DJEN desligado — as
 * demais devolvem 404 de propósito.
 */
export async function statusDjen(): Promise<StatusDjen> {
  const { data } = await api.get<StatusDjen>('/djen/status');
  return data;
}

/**
 * Processos vivos em que o Diário nunca trouxe nada — ver `vivosSemAtoNoDiario`
 * na API. Não é falha: a via está aberta e por ela nunca passou ato nenhum.
 */
export interface SemAtoNoDiario {
  total: number;
  exemplos: { processoId: string; numeroCNJ: string | null; movimentacoes: number }[];
}

export async function semAtoNoDiario(): Promise<SemAtoNoDiario> {
  const { data } = await api.get<SemAtoNoDiario>('/djen/sem-ato');
  return data;
}


/**
 * UMA PUBLICAÇÃO, COM O TEOR — para ler onde a pessoa já está.
 *
 * O painel listava "Analisar intimação · sem tarefa" e, ao clicar, levava para a
 * ficha do processo: o que o juiz escreveu, que é a única coisa capaz de
 * responder "isto é urgente?", ficava a mais dois cliques.
 */
export async function umaPublicacao(id: string): Promise<PublicacaoDjen & {
  processo: { id: string; numeroCNJ: string | null } | null;
  compromisso: { id: string; titulo: string; status: string; inicio: string } | null;
  /** A tarefa da irmã do mesmo ato (cópia pelo link). Opcional: a API antiga não manda. */
  tarefaDoMesmoAto?: { id: string; titulo: string; status: string; inicio: string } | null;
}> {
  return (await api.get(`/djen/publicacoes/${id}`)).data;
}

/**
 * A PRÉVIA DA TAREFA — o que a publicação VAI virar, sem virar.
 *
 * Data, urgência e dono são decididos pelo sistema. Criar às cegas é pedir
 * confiança e depois conferência; mostrar antes é mais barato que desfazer.
 *
 * Vem do MESMO cálculo que a criação usa (`planejarAtividade`, na API), então o
 * que aparece aqui é literalmente o que vai ser gravado. `null` significa "não
 * há o que planejar" — a tela explica em vez de oferecer um botão que falharia.
 */
export interface PreviaDaTarefa {
  titulo: string;
  /** Slug do tipo de evento (PRAZO, AUDIENCIA, CONTATO…). */
  tipo: string;
  /** Quando cai na agenda — 9h de Teresina, nunca no passado. */
  inicio: string;
  descricao: string;
  urgente: boolean;
  /** Nunca vazio quando `urgente`: marca sem motivo é a pior da tela. */
  urgenteMotivo: string | null;
  /** O prazo calculado já venceu quando a publicação chegou? */
  atrasado: boolean;
  idadeDias: number;
  diasDoLembrete: number;
  responsavel: { id: string; nome: string; nomeExibicao: string | null } | null;
}

export async function previaDaTarefa(id: string): Promise<PreviaDaTarefa | null> {
  return (await api.get(`/djen/publicacoes/${id}/previa-da-tarefa`)).data;
}

/**
 * "ISTO PRECISA VIRAR TAREFA" — em um toque.
 *
 * A atividade nasce para o DONO DO CASO, não para quem clicou: clicar aqui é
 * dizer "isto precisa ser feito", não "eu faço". Quem quiser puxar para si tem
 * o botão "Assumir" na própria atividade.
 *
 * Idempotente: se já existe tarefa aberta, devolve a mesma (`criada: false`).
 */
export async function criarTarefaDaPublicacao(
  id: string,
): Promise<{ compromissoId: string; criada: boolean }> {
  return (await api.post(`/djen/publicacoes/${id}/tarefa`)).data;
}

export async function listarPublicacoes(processoId: string): Promise<PublicacaoDjen[]> {
  const { data } = await api.get<PublicacaoDjen[]>(`/djen/processo/${processoId}`);
  return data;
}

/**
 * POR ONDE ESTE PROCESSO É ACOMPANHADO NO DIÁRIO — calculado na API.
 *
 * A frase sai de `fraseDaCobertura` (lib/djen-cobertura.ts). Rota nova de
 * 14/09/2026: na janela de troca a API antiga responde 404, e a aba só não
 * mostra a linha.
 */
export async function coberturaDoDiario(processoId: string): Promise<CoberturaDoDiario> {
  const { data } = await api.get<CoberturaDoDiario>(`/djen/processo/${processoId}/cobertura`);
  return data;
}

/**
 * O que o "Buscar no DJEN" devolve. `historico`, `bateuNoTeto` e `interrompida`
 * chegaram na API de 14/09/2026; opcionais pela janela de troca.
 */
export interface ResultadoDaBuscaNoDjen {
  ingeridas: number;
  recebidas: number;
  /** A leitura foi a do histórico inteiro (primeira vez deste processo). */
  historico?: boolean;
  /** Parou no teto de páginas: pode haver publicação que não veio. */
  bateuNoTeto?: boolean;
  /** Uma página depois da primeira falhou (em geral, a cota do CNJ). */
  interrompida?: boolean;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * A FRASE DO TOQUE EM "BUSCAR NO DJEN" (15/09/2026).
 *
 * A ficha dizia "Nenhuma publicação nova no DJEN." até quando a leitura tinha
 * parado pela cota no meio do histórico: a pessoa concluía que não havia nada,
 * e havia. Leitura parcial é AVISO (âmbar), nunca sucesso; o histórico lido
 * diz quantas vieram, porque "nenhuma nova" num processo que acabou de trazer
 * 40 atos antigos soa como falha.
 */
export function avisoDaBuscaNoDjen(r: ResultadoDaBuscaNoDjen): { tom: 'SUCESSO' | 'AVISO'; texto: string } {
  const novas = r.ingeridas > 0 ? `${plural(r.ingeridas, 'publicação nova', 'publicações novas')}. ` : '';
  if (r.interrompida) {
    return {
      tom: 'AVISO',
      texto: `${novas}Leitura parcial: o limite de consultas do CNJ foi atingido. Tente de novo em 1 minuto.`,
    };
  }
  if (r.bateuNoTeto) {
    return {
      tom: 'AVISO',
      texto: `${novas}Leitura parcial: este processo tem mais publicações do que cabe numa leitura. As mais antigas podem não ter vindo.`,
    };
  }
  if (r.historico) {
    if (r.recebidas === 0) return { tom: 'SUCESSO', texto: 'Histórico do Diário lido: nenhuma publicação para este processo.' };
    const quantas = plural(r.recebidas, 'publicação', 'publicações');
    const dasQuais = r.ingeridas === 0 ? 'nenhuma nova' : plural(r.ingeridas, 'nova', 'novas');
    return { tom: 'SUCESSO', texto: `Histórico do Diário lido: ${quantas}, ${dasQuais}.` };
  }
  return {
    tom: 'SUCESSO',
    texto: r.ingeridas > 0 ? plural(r.ingeridas, 'publicação nova.', 'publicações novas.') : 'Nenhuma publicação nova no DJEN.',
  };
}

/** Busca no DJEN sob demanda (botão da ficha do processo). */
export async function sincronizarPublicacoes(
  processoId: string,
): Promise<ResultadoDaBuscaNoDjen> {
  // Consulta o CNJ, tribunal a tribunal — não cabe no timeout de leitura.
  const { data } = await api.post(`/djen/processo/${processoId}/sincronizar`, undefined, {
    timeout: TIMEOUT_LONGO,
  });
  return data;
}

/** O acompanhamento de todas as instâncias está ligado? */
/**
 * A VARREDURA COMPLETA, pedida por alguém — o botão "Buscar agora" da home.
 *
 * POR QUE A HOME PRECISA DELE. O aviso de que as publicações estão
 * desatualizadas era só um aviso: dizia o diagnóstico e não dava saída nenhuma.
 * Alarme sem alavanca é o que ensina a ignorar alarme — quem lê não pode fazer
 * nada e aprende que a faixa é paisagem.
 *
 * SÓ ADMINISTRADOR: a rota percorre a OAB de todos os advogados e consulta o
 * CNJ dezenas de vezes, respeitando a cota. Pode levar minutos — por isso o
 * timeout longo.
 */
export async function varrerDjenAgora(
  /**
   * DIAS DE HISTÓRICO — só na colheita inicial.
   *
   * Sem isto, a varredura usa a janela diária (3 dias), que é o que basta para o
   * fluxo: processo já cadastrado também é consultado por NPU, e essa consulta
   * traz o histórico inteiro dele. A janela só limita a descoberta de ação NOVA,
   * que aparece exclusivamente pela busca por OAB.
   */
  dias?: number,
): Promise<{
  advogadosConsultados: number;
  processosConsultados: number;
  recebidas: number;
  ingeridas: number;
  descartadas: number;
  /** Das descartadas, quantas eram ações NOSSAS ainda sem cadastro. */
  sugeridas: number;
  falhas: number;
  /** Por que falharam, do motivo mais frequente para o menos. */
  motivosDeFalha?: Record<string, number>;
}> {
  const { data } = await api.post('/djen/sincronizar', undefined, {
    timeout: 600_000,
    ...(dias ? { params: { dias } } : {}),
  });
  return data;
}

/**
 * O QUE DIZER DEPOIS DA BUSCA — e por que não basta olhar `ingeridas`.
 *
 * 21/09/2026, o dono: "Aqui deu 'busca concluída e nada novo no diário' mas a
 * barra amarela persiste. Realmente a busca foi um sucesso?"
 *
 * Não foi. O log da produção daquele minuto: "Varredura sem resposta: as 165
 * consulta(s) falharam." A tela só olhava `ingeridas === 0` e concluía "nada
 * novo" — a mesma frase para "o Diário não tinha nada" e para "o Diário não
 * respondeu nada". São coisas opostas: a primeira é boa notícia, a segunda é um
 * buraco de informação que ninguém percebe.
 *
 * Quatro respostas, e o tom segue a régua da casa: consequência na frente,
 * nunca comemorar o que não aconteceu.
 */
export type TomDaBusca = 'ok' | 'aviso' | 'erro';

export function resultadoDaVarredura(r: {
  ingeridas: number;
  falhas: number;
  advogadosConsultados: number;
  processosConsultados: number;
}): { tom: TomDaBusca; texto: string } {
  const tentativas = r.advogadosConsultados + r.processosConsultados + r.falhas;
  const respondeu = tentativas - r.falhas;

  if (tentativas === 0) {
    return { tom: 'aviso', texto: 'Nada a consultar: nenhum advogado com OAB no cadastro.' };
  }
  /* NENHUMA respondeu: não se sabe nada sobre o Diário, e dizer "nada novo"
     seria afirmar justamente o que não se apurou. */
  if (respondeu === 0) {
    return {
      tom: 'erro',
      texto: `O Diário não respondeu a nenhuma das ${tentativas} consultas. Nada foi buscado — a faixa continua até uma busca voltar com resposta.`,
    };
  }
  if (r.falhas > 0) {
    const achou = r.ingeridas > 0 ? `${r.ingeridas} publicação(ões) nova(s), mas ` : '';
    return {
      tom: 'aviso',
      texto: `${achou}${r.falhas} de ${tentativas} consultas falharam — pode haver publicação que não chegou.`,
    };
  }
  return r.ingeridas > 0
    ? { tom: 'ok', texto: `${r.ingeridas} publicação(ões) nova(s) do Diário.` }
    : { tom: 'ok', texto: `Busca concluída: ${tentativas} consultas responderam, nada novo no Diário.` };
}

export async function statusDatajud(): Promise<{ multiInstancia: boolean }> {
  const { data } = await api.get<{ multiInstancia: boolean }>('/datajud/status');
  return data;
}

// ---------------------------------------------------------------------------
// Busca no acervo já baixado
// ---------------------------------------------------------------------------

/**
 * O que a API do CNJ NÃO faz, esta busca faz.
 *
 * `nomeParte` e `nomeAdvogado` existem no Comunica PJe e são IGNORADOS pelo
 * servidor deles — mandar um nome inexistente devolve exatamente o mesmo
 * resultado. Mas os dois vêm DENTRO de cada publicação e são guardados aqui,
 * então procurar por parte é impossível na origem e trivial no acervo.
 */
export interface FiltroPublicacoes {
  /**
   * Só o que CITA este advogado (por OAB) — diferente de `meus`, que é por
   * acervo. O prazo corre para quem foi INTIMADO, e as duas listas divergem.
   */
  citaAdvogado?: string;
  q?: string;
  providencia?: string;
  tribunal?: string;
  /** SEM_DECISAO: com providência, sem tarefa e sem motivo de dispensa — a fila. */
  situacao?: 'COM_TAREFA' | 'SEM_TAREFA' | 'SEM_DECISAO';
  /** Só as disponibilizadas nos últimos N dias — a mesma conta do painel. */
  dias?: number;
  pagina?: number;
  limite?: number;
}

export interface PublicacaoNaBusca extends PublicacaoDjen {
  /**
   * As PARTES vêm junto do processo. Sem elas a lista não diz de quem é o
   * caso, e reconhecer um ato entre 984 vira leitura de cabeçalho de acórdão.
   */
  processo: {
    id: string;
    numeroCNJ: string | null;
    partes?: { nome: string; polo: string }[];
  } | null;
  compromisso: { id: string; titulo: string; status: string; inicio: string } | null;
}

export interface ResultadoPublicacoes {
  total: number;
  pagina: number;
  limite: number;
  paginas: number;
  itens: PublicacaoNaBusca[];
}

export async function buscarPublicacoes(filtro: FiltroPublicacoes): Promise<ResultadoPublicacoes> {
  const params = Object.fromEntries(
    Object.entries(filtro).filter(([, v]) => v !== undefined && v !== '' && v !== null),
  );
  const { data } = await api.get<ResultadoPublicacoes>('/djen/publicacoes', { params });
  return data;
}

export interface FacetasDjen {
  tribunais: { sigla: string; total: number }[];
  providencias: { slug: string; total: number }[];
}

export async function facetasPublicacoes(): Promise<FacetasDjen> {
  const { data } = await api.get<FacetasDjen>('/djen/publicacoes/facetas');
  return data;
}

/**
 * A CAIXA DE ENTRADA DO ADVOGADO — proposta de tarefa, não tarefa.
 *
 * O robô prova de quem é a ordem em 15,8% dos atos e prova que é da outra parte
 * em 4,1%; nos 80% restantes não sabe. Criar tarefa nesses 80% enchia a agenda
 * de trabalho alheio; não criar perderia prazo. Quem decide é o advogado, em um
 * segundo, olhando o trecho da ordem.
 *
 * Só o INDECISO passa por aqui: ordem nossa provada com prazo escrito vira
 * tarefa direto.
 */
export interface PropostaDeTarefa {
  id: string;
  numeroProcesso: string;
  siglaTribunal: string | null;
  nomeOrgao: string | null;
  nomeClasse: string | null;
  tipoComunicacao: string | null;
  /**
   * O COMEÇO DO TEOR, e só quando a prévia precisa dele.
   *
   * Vinha inteiro (2.476 caracteres em média) para até 100 publicações a cada
   * abertura do painel, para alimentar uma prévia de 180. Hoje a API manda nulo
   * quando já recortou a `ordem` — que é o caso em 70% dos atos.
   */
  texto: string | null;
  dataDisponibilizacao: string;
  providencia: string | null;
  prazoMencionadoDias: number | null;
  tarefaPropostaEm: string;
  link: string | null;
  /** O trecho em que o juízo manda alguém fazer algo — a prévia que decide. */
  ordem: string | null;
  /**
   * CONTRA QUEM É O PROCESSO, resolvido pela regra canônica do painel.
   *
   * O cartão calculava isto sozinho, pegando a parte do polo passivo — e
   * imprimia o nome do PRÓPRIO SINDICATO quando a ação era contra ele. Agora
   * vem pronto: uma regra, um dono.
   */
  adversario: string | null;
  /**
   * Como a proposta envelheceu — ver `seloDaProposta`.
   *
   * OPCIONAIS PELA JANELA DE TROCA DO DEPLOY (18/09/2026), como o resto deste
   * arquivo já faz. Web e API sobem em serviços separados: com o campo
   * obrigatório, os minutos em que o web novo fala com a API velha escreviam
   * "parada há undefined d" na tela. Sem os três, toda proposta é tratada como
   * NOVA — que é exatamente o comportamento de antes deles existirem.
   */
  estado?: EstadoDaProposta;
  /** Dias inteiros desde que o robô propôs. */
  diasNaCaixa?: number;
  /** Dias de calendário desde a disponibilização do ato. */
  diasDoAto?: number;
  propostaPara: {
    id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null;
  } | null;
  processo: {
    id: string;
    numeroCNJ: string | null;
  } | null;
}

/**
 * O QUE ACONTECE COM UMA PROPOSTA QUE ENVELHECE — a pergunta do dono.
 *
 * "Elas somem depois que perdem o prazo?" Não somem: não há corte de data
 * nenhum nesta caixa, nem em listar nem em contar, e não vai haver — o corte
 * nunca esconde o que pede atenção. O que mudou é que a proposta do dia 60
 * deixou de ser desenhada igual à do dia 1.
 *
 * Os três estados são derivados no servidor (`situacaoDaProposta`), porque a
 * régua é a mesma que o robô usa para desistir de esperar. Aqui só se lê.
 */
export type EstadoDaProposta = 'NOVA' | 'PARADA' | 'FORA_DA_JANELA';

/** Quantas linhas a caixa abre antes do "ver as outras". */
export const MOSTRAR_NA_CAIXA = 4;

/**
 * O CORTE NUNCA ESCONDE O QUE PEDE ATENÇÃO.
 *
 * Quatro vagas fixas, com a fila ordenada pelo que está parado, deixavam a
 * quinta parada escondida atrás de um "ver as outras" que ninguém abre. O corte
 * continua existindo — é o que impede a caixa de virar uma segunda agenda —,
 * mas ele cede para tudo que já pede uma pessoa. O que fica escondido é sempre
 * recente, e recente é o que ainda tem tempo.
 */
export function quantasMostrar(itens: { estado?: EstadoDaProposta }[]): number {
  // Sem `estado` (API da janela de troca) o item conta como NOVA: o corte volta
  // a ser o de antes, e não "tudo pede alguém".
  return Math.max(MOSTRAR_NA_CAIXA, itens.filter((i) => estadoOu(i.estado) !== 'NOVA').length);
}

/** O estado que a API mandou, ou NOVA — ver a nota da janela de troca acima. */
export function estadoOu(estado: EstadoDaProposta | undefined): EstadoDaProposta {
  return estado ?? 'NOVA';
}

/**
 * O RODAPÉ DIZ O QUE FICOU ESCONDIDO — inclusive quando não devia ter ficado.
 *
 * "Ver as outras 7" não diz se vale a pena abrir, e a pessoa aprende a não
 * abrir. Como o corte cede para o que pede alguém, o normal é o rodapé poder
 * AFIRMAR que nada parado está escondido — e é essa afirmação que torna o corte
 * confiável. Se algum dia um parado escapar (ordem do servidor diferente da
 * esperada), o rodapé conta em vez de mentir: ele lê o que está de fato
 * escondido, não o que deveria estar.
 *
 * Nulo quando não sobrou nada — bloco vazio não vira linha nem botão.
 */
export function rodapeDaCaixa(escondidas: { estado?: EstadoDaProposta }[]): string | null {
  if (!escondidas.length) return null;
  const paradas = escondidas.filter((i) => estadoOu(i.estado) !== 'NOVA').length;
  if (paradas) {
    return `Ver as outras ${escondidas.length} — ${paradas === 1 ? '1 parada' : `${paradas} paradas`}`;
  }
  return `Ver as outras ${escondidas.length}, nenhuma parada`;
}

export interface SeloDaProposta {
  /** O selo curto, ao lado da providência. Nulo quando não há nada a dizer. */
  rotulo: string | null;
  /** A frase que diz o que acontece se ninguém decidir. */
  recado: string | null;
  /** Âmbar pede você. Novidade não é pendência: proposta nova não pede nada. */
  pedeVoce: boolean;
}

/**
 * O QUE A LINHA DIZ SOBRE A PRÓPRIA IDADE.
 *
 * Nada aqui promete o que o robô vai fazer. A rede do `escalarEsquecidas` tem
 * uma segunda condição que só o teor responde (todo prazo do ato pode ser da
 * outra parte), e anunciar uma tarefa que ele pode recusar é o erro do alarme
 * que contradizia o robô. A linha afirma só fatos: quantos dias, e que nada
 * muda sem alguém.
 *
 * PROPOSTA NOVA NÃO PEDE NADA. É a mesma regra da reserva: só vira pendência
 * quando ninguém cuidou. Selo em item de hoje é o jeito mais rápido de ensinar
 * a equipe a ignorar selo.
 */
export function seloDaProposta(p: {
  estado?: EstadoDaProposta;
  diasNaCaixa?: number;
  diasDoAto?: number;
}): SeloDaProposta {
  const estado = estadoOu(p.estado);
  // Zero em vez de `undefined`: o selo nunca escreve "parada há undefined d".
  const diasNaCaixa = p.diasNaCaixa ?? 0;
  const diasDoAto = p.diasDoAto ?? 0;
  if (estado === 'FORA_DA_JANELA') {
    return {
      rotulo: 'ato antigo',
      recado: `O ato tem ${diasDoAto} dias: tarefa aberta agora já nasce atrasada.`,
      pedeVoce: true,
    };
  }
  if (estado === 'PARADA') {
    return {
      rotulo: `parada há ${diasNaCaixa}d`,
      recado: 'Ninguém decidiu ainda — e nada muda sozinho.',
      pedeVoce: true,
    };
  }
  return { rotulo: null, recado: null, pedeVoce: false };
}

export async function listarPropostas(todas = false): Promise<PropostaDeTarefa[]> {
  return (await api.get('/djen/propostas', { params: todas ? { todas: '1' } : {} })).data;
}

export async function aceitarProposta(id: string) {
  return (await api.post(`/djen/propostas/${id}/aceitar`)).data;
}

export async function recusarProposta(id: string, motivo?: string) {
  return (await api.post(`/djen/propostas/${id}/recusar`, { motivo })).data;
}

/**
 * MOTIVOS PRONTOS PARA RECUSAR — um toque em vez de um parágrafo.
 *
 * Campo livre numa tela de celular é o jeito mais rápido de o motivo vir vazio,
 * e o motivo é o único dado que diz ONDE a regra erra. Três opções cobrem o que
 * a auditoria encontrou; a quarta abre o texto livre para o que não couber.
 */
export const MOTIVOS_DE_RECUSA = [
  { slug: 'OUTRA_PARTE', label: 'O prazo é da outra parte' },
  { slug: 'JA_RESOLVIDO', label: 'Já foi resolvido' },
  { slug: 'SEM_PROVIDENCIA', label: 'Não pede nada de nós' },
] as const;
