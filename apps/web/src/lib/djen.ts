import { api, TIMEOUT_LONGO } from './api';
import { V } from '@/lib/vocabulario';

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
 * UMA PUBLICAÇÃO, COM O TEOR — para ler onde a pessoa já está.
 *
 * O painel listava "Analisar intimação · sem tarefa" e, ao clicar, levava para a
 * ficha do processo: o que o juiz escreveu, que é a única coisa capaz de
 * responder "isto é urgente?", ficava a mais dois cliques.
 */
export async function umaPublicacao(id: string): Promise<PublicacaoDjen & {
  processo: { id: string; numeroCNJ: string | null } | null;
  compromisso: { id: string; titulo: string; status: string; inicio: string } | null;
}> {
  return (await api.get(`/djen/publicacoes/${id}`)).data;
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

/** Busca no DJEN sob demanda (botão da ficha do processo). */
export async function sincronizarPublicacoes(
  processoId: string,
): Promise<{ ingeridas: number; recebidas: number }> {
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
}> {
  const { data } = await api.post('/djen/sincronizar', undefined, {
    timeout: 600_000,
    ...(dias ? { params: { dias } } : {}),
  });
  return data;
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
  situacao?: 'COM_TAREFA' | 'SEM_TAREFA';
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
  texto: string;
  dataDisponibilizacao: string;
  providencia: string | null;
  prazoMencionadoDias: number | null;
  tarefaPropostaEm: string;
  link: string | null;
  /** O trecho em que o juízo manda alguém fazer algo — a prévia que decide. */
  ordem: string | null;
  propostaPara: {
    id: string; nome: string; nomeExibicao: string | null; avatarUrl: string | null;
  } | null;
  processo: {
    id: string;
    numeroCNJ: string | null;
    partes: { nome: string; polo: string }[];
  } | null;
}

export async function listarPropostas(todas = false): Promise<PropostaDeTarefa[]> {
  return (await api.get('/djen/propostas', { params: todas ? { todas: '1' } : {} })).data;
}

export async function contarPropostas(todas = false): Promise<{ total: number }> {
  return (await api.get('/djen/propostas/contagem', { params: todas ? { todas: '1' } : {} })).data;
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
