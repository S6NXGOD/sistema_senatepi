import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { tenant } from '../../tenant/tenant.config';

/**
 * PADRÕES NO ACERVO — o que só aparece olhando os processos JUNTOS.
 *
 * Um sindicato não litiga contra cento e vinte réus diferentes: litiga contra os
 * mesmos empregadores, sobre as mesmas coisas, de novo e de novo. Cada advogado
 * cuida do seu processo e faz isso bem; ninguém tem por ofício somar o acervo e
 * perguntar "isto aqui é o mesmo problema seis vezes?".
 *
 * O QUE ESTE SERVIÇO NÃO FAZ. Ele não recomenda, não prevê e não pontua. Toda
 * linha que ele produz é contagem verificável — quantos processos, contra quem,
 * sobre qual assunto, com qual desfecho carimbado pelo próprio tribunal. A
 * leitura jurídica é de quem lê. Um painel que dissesse "ajuíze uma coletiva"
 * estaria opinando sobre estratégia processual com base em três linhas de banco,
 * e na primeira vez que errasse ninguém olharia de novo.
 *
 * Medido na produção em 04/09/2026, e é o que fez o serviço existir:
 *
 *  - 6 ações INDIVIDUAIS sobre "Indenização Relacionada ao Exercício do Direito
 *    de Greve", contra dois empregadores (Unimed 3, Hapvida 3), com procedência
 *    parcial nas seis;
 *  - "Acordo e Convenção Coletivos de Trabalho" em 28 processos contra 13
 *    empregadores DIFERENTES — o oposto: não é um réu, é a categoria.
 */

/**
 * Códigos TPU de julgamento. É o CNJ que os carimba; não inferimos desfecho.
 * Exportados porque o relatório conta as mesmas sentenças — dois arquivos com a
 * própria lista de códigos divergiriam em silêncio.
 */
export const PROCEDENCIA = 219;
export const IMPROCEDENCIA = 220;
export const PROCEDENCIA_PARCIAL = 221;

/**
 * RECURSO JULGADO — provido (237), provido em parte (238) ou negado (239).
 *
 * O desfecho que o Panorama lê é a SENTENÇA mais recente, e ela não é o
 * resultado final: medido na produção em 12/09/2026, 49 dos 109 processos
 * ativos julgados tinham um desses carimbos DEPOIS da última sentença — 16 dos
 * 30 improcedentes. Uma improcedência reformada por 237 continuava contando
 * como "sempre contra".
 *
 * Não reinterpretamos o acórdão (provido a favor de quem? depende do polo do
 * recorrente, que o carimbo não diz). Contamos quantos têm recurso julgado
 * depois, e com isso as leituras de "sempre" calam. É decisão jurídica, curta e
 * nomeada, como `ASSUNTOS_DE_RITO`.
 */
export const RECURSO_JULGADO = [237, 238, 239];

/**
 * Os status que ainda não são ação ajuizada. Os dois rótulos da mesma fase —
 * ver o enum `StatusProcesso` — e nunca um literal só.
 */
const NAO_AJUIZADO = ['PRE_PROCESSUAL', 'RASCUNHO'];

/**
 * ASSUNTOS QUE SÃO RITO, NÃO PEDIDO — e esta lista salvou a funcionalidade de
 * nascer mentindo.
 *
 * O primeiro resultado que este serviço produziu foi "3 processos contra a
 * FMS/THE sobre Assistência Judiciária Gratuita, os três improcedentes — a tese
 * não passa". Fui olhar os três: um discutia conversão em pecúnia, outro hora
 * extra, o terceiro irredutibilidade de vencimentos. Três pedidos diferentes. O
 * que eles tinham em comum era só a etiqueta do pedido de gratuidade, que o CNJ
 * marcou como assunto PRINCIPAL nos três.
 *
 * Etiqueta processual acompanha qualquer pedido, então ela cria padrão onde não
 * há. Estes treze códigos são de rito — gratuidade, honorários, ônus da prova,
 * liminar, nulidades de recurso — e ficam fora da detecção. Continuam visíveis
 * na ficha do processo; o que eles não fazem é fingir ser um padrão.
 *
 * FILTRA POR CÓDIGO, e não por nome: o nome vem do tribunal com espaço sobrando
 * ("Ônus da Prova ") e em duas grafias para o mesmo conceito (10655 e 12995,
 * ambos "Honorários Advocatícios"). O código é do CNJ e não muda.
 *
 * É uma decisão de domínio jurídico, não uma dedução do dado — está aqui, curta
 * e nomeada, para poder ser discutida e corrigida.
 */
export const ASSUNTOS_DE_RITO = [
  8843, // Assistência Judiciária Gratuita
  8867, // Substituição Processual
  8934, // Valor da Causa
  9196, // Liminar
  10655, // Honorários Advocatícios
  12416, // Tutela de Urgência
  12995, // Honorários Advocatícios (segunda grafia)
  13089, // Cerceamento de Defesa
  13184, // Honorários na Justiça do Trabalho
  13201, // Inépcia da Inicial
  13233, // Negativa de Prestação Jurisdicional
  13237, // Ônus da Prova
  14046, // Prescrição
];

/**
 * Pisos. Abaixo deles não é padrão, é coincidência — a mesma régua do bloco
 * "Contra quem litigamos" no painel.
 */
const MINIMO_CONCENTRACAO = 3;
/** Um pedido só vira "recorrente" quando se repete — abaixo disso é o caso. */
const MINIMO_PEDIDO_RECORRENTE = 3;
/**
 * Dispersão exige mais réus que a intuição sugere. Com quatro, "Indenização por
 * Dano Moral" entrava na lista — dez processos contra QUATRO réus, oito deles do
 * mesmo empregador. Isso é concentração usando roupa de dispersão. Cinco réus e
 * seis processos separam as duas coisas no acervo real.
 */
const MINIMO_DISPERSAO_PROCESSOS = 6;
const MINIMO_DISPERSAO_ADVERSARIOS = 5;

/** Quantos julgamentos bastam para o desfecho repetido significar algo. */
const MINIMO_JULGADOS = 2;

export type LeituraConcentracao =
  | 'DESFECHO_SEMPRE_CONTRA'
  | 'DESFECHO_SEMPRE_A_FAVOR'
  | 'COLETIVA_POSSIVEL'
  | 'REINCIDENCIA';

export interface Desfechos {
  julgados: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
}

/**
 * COMO AS AÇÕES TÊM SIDO JULGADAS — todas as ajuizadas, não só as ativas.
 *
 * Os desfechos de fora (`julgados`, `procedentes`…) contam o acervo ATIVO, e
 * era só isso que o Panorama lia. Só que decidido é justamente o que sai do
 * ativo: IMPROCEDENTE, GANHO_EXECUCAO e ENCERRADO são status próprios. Medido
 * em 12/09/2026, ENCERRADO tinha 21 julgados fora da conta. Um réu com três
 * improcedências ativas e duas procedências já em execução aparecia como
 * "sempre contrário".
 *
 * As duas perguntas ficam separadas: "quantas ações ativas" continua ATIVO (e o
 * link continua abrindo `status=ATIVO`); "como têm sido julgadas" olha a
 * história inteira, menos o pré-processual, que nunca foi ajuizado.
 */
export interface Historico extends Desfechos {
  /** Julgados com recurso julgado DEPOIS da última sentença — ver `RECURSO_JULGADO`. */
  comRecursoDepois: number;
}

export type TipoDoAdversario = 'JURIDICA' | 'FISICA' | 'ORGAO_PUBLICO';

export interface PedidoRecorrente {
  assunto: string;
  processos: number;
}

export interface Concentracao extends Desfechos {
  parteExternaId: string;
  adversario: string;
  /**
   * A natureza da parte. Existe para quem imprime: réu pessoa FÍSICA não pode
   * sair com o nome num papel da diretoria.
   */
  tipo: TipoDoAdversario | null;
  processos: number;
  individuais: number;
  desde: string | null;
  /** Os pedidos que se repetem em três ou mais das ações ativas contra este réu. */
  pedidos: PedidoRecorrente[];
  historico: Historico;
  /**
   * Mediana de dias da distribuição à sentença — nula com menos de três
   * julgados. Ver `medianaAteSentenca`.
   */
  medianaDias: number | null;
  /** Zero, uma ou duas leituras — nunca uma verdade única. Ver `lerConcentracao`. */
  leituras: LeituraConcentracao[];
}

export interface PorAno {
  ano: number;
  processos: number;
}

export interface Dispersao extends Desfechos {
  assunto: string;
  processos: number;
  adversarios: number;
  individuais: number;
  desde: string | null;
  historico: Historico;
  /**
   * Ações distribuídas por ano, do primeiro ao último — inclusive os anos
   * ZERADOS no meio. Sem eles a série mentiria por omissão: 2022 com quatro e
   * 2026 com doze, lado a lado, pareceria crescimento constante mesmo que
   * 2023, 2024 e 2025 não tivessem nenhuma.
   *
   * TODAS AS AJUIZADAS, e não só as que continuam ativas. Contando só as
   * ativas, o ano antigo encolhia por construção — já teve tempo de encerrar —
   * e a tendência pendia para "crescendo": em 12/09/2026, 2023 aparecia com 18
   * ações de 27 ajuizadas e 2024 com 12 de 20. É a régua de "Ações ajuizadas
   * por ano" dos Relatórios, para as duas telas desenharem a mesma série.
   */
  /** Mediana de dias da distribuição à sentença — ver `medianaAteSentenca`. */
  medianaDias: number | null;
  porAno: PorAno[];
}

/**
 * QUE LEITURAS ESTE PADRÃO PEDE — no plural, e isso importa.
 *
 * A primeira versão devolvia UMA leitura, escolhida por prioridade. Ela errava
 * no caso mais interessante do acervo: contra a Hapvida há três ações sobre
 * greve, TODAS individuais e TODAS com procedência parcial. Escolher entre
 * "vocês ganham isto sempre" e "isto podia ser uma ação só" é jogar fora metade
 * do achado — as duas coisas são verdade, e juntas é que sustentam a conversa.
 *
 * DESFECHO_SEMPRE_CONTRA é o mais caro de ignorar: cada processo isolado parece
 * azar, e só o conjunto mostra que o argumento não convence aquele juízo.
 *
 * O "SEMPRE" LÊ A HISTÓRIA, e cala diante de recurso. O desfecho vem de
 * `historico` (todas as ajuizadas), porque "sempre" dito sobre as que sobraram
 * ativas é sempre entre os sobreviventes. E basta UM julgado com recurso
 * julgado depois para as duas leituras de uniformidade saírem: a sentença não é
 * o resultado final, e 16 dos 30 improcedentes ativos tinham acórdão posterior.
 * A leitura de coletiva continua nas ativas — é sobre as ações em curso.
 */
export function lerConcentracao(c: {
  processos: number;
  individuais: number;
  historico: Historico;
}): LeituraConcentracao[] {
  const leituras: LeituraConcentracao[] = [];
  const h = c.historico;
  const podeDizerSempre = h.julgados >= MINIMO_JULGADOS && h.comRecursoDepois === 0;

  if (podeDizerSempre && h.improcedentes === h.julgados) leituras.push('DESFECHO_SEMPRE_CONTRA');
  if (podeDizerSempre && h.procedentes + h.parciais === h.julgados) {
    leituras.push('DESFECHO_SEMPRE_A_FAVOR');
  }
  if (c.individuais > c.processos / 2) leituras.push('COLETIVA_POSSIVEL');

  return leituras.length ? leituras : ['REINCIDENCIA'];
}

/**
 * UM PROCESSO AJUIZADO, como sai de `baseDoAcervo`: uma linha por processo, com
 * o adversário escolhido e o desfecho atual. Toda a conta do Panorama sai
 * destas linhas e dos temas — em memória, por uma função pura, para a régua dos
 * status e do recurso poder ser provada com fixture em vez de lida no SQL.
 *
 * O custo é baixo e medido: o acervo inteiro são poucas centenas de processos e
 * perto de mil pares processo–assunto.
 */
export interface LinhaDoAcervo {
  processoId: string;
  status: string;
  tipoAcao: string;
  /** Ano de distribuição pela mesma conta dos Relatórios; nulo sem data. */
  ano: number | null;
  dataDistribuicao: Date | null;
  parteExternaId: string | null;
  adversario: string | null;
  tipoAdversario: string | null;
  /** Código da sentença mais recente (219/220/221), nulo se não houve. */
  julgamento: number | null;
  /** Data dessa sentença — é o que permite medir quanto o caso levou. */
  dataJulgamento: Date | null;
  /** Recurso julgado (237/238/239) depois dessa sentença. */
  recursoDepois: boolean;
}

export interface TemaDoProcesso {
  processoId: string;
  assunto: string;
}

/**
 * Preenche os anos vazios entre o primeiro e o último.
 *
 * Um gráfico que pula de 2022 para 2026 desenha os dois pontos vizinhos e a
 * linha entre eles sobe bonito — escondendo três anos sem nenhuma ação. O ano
 * zerado é informação, não lacuna.
 */
export function serieCompleta(linhas: { ano: number; processos: number }[]): PorAno[] {
  if (!linhas.length) return [];
  const porAno = new Map(linhas.map((l) => [l.ano, l.processos]));
  const anos = [...porAno.keys()];
  const inicio = Math.min(...anos);
  const fim = Math.max(...anos);
  const serie: PorAno[] = [];
  for (let ano = inicio; ano <= fim; ano++) serie.push({ ano, processos: porAno.get(ano) ?? 0 });
  return serie;
}

const ehAtivo = (l: LinhaDoAcervo) => l.status === 'ATIVO';
const SENTENCAS = [PROCEDENCIA, IMPROCEDENCIA, PROCEDENCIA_PARCIAL];
const TIPOS_DE_ADVERSARIO: TipoDoAdversario[] = ['JURIDICA', 'FISICA', 'ORGAO_PUBLICO'];

/** Procedentes, parciais e improcedentes de um conjunto de processos. */
export function desfechosDe(linhas: LinhaDoAcervo[]): Desfechos {
  const julgadas = linhas.filter((l) => l.julgamento !== null && SENTENCAS.includes(l.julgamento));
  const com = (codigo: number) => julgadas.filter((l) => l.julgamento === codigo).length;
  return {
    julgados: julgadas.length,
    procedentes: com(PROCEDENCIA),
    parciais: com(PROCEDENCIA_PARCIAL),
    improcedentes: com(IMPROCEDENCIA),
  };
}

/**
 * O histórico de um conjunto: os desfechos de TODAS as ajuizadas, e quantas
 * delas tiveram recurso julgado depois da sentença.
 */
export function historicoDe(linhas: LinhaDoAcervo[]): Historico {
  const ajuizadas = linhas.filter((l) => !NAO_AJUIZADO.includes(l.status));
  return {
    ...desfechosDe(ajuizadas),
    comRecursoDepois: ajuizadas.filter(
      (l) => l.julgamento !== null && SENTENCAS.includes(l.julgamento) && l.recursoDepois,
    ).length,
  };
}

/** A distribuição mais antiga, como data pura. */
function desdeDe(linhas: LinhaDoAcervo[]): string | null {
  const datas = linhas
    .map((l) => l.dataDistribuicao?.getTime())
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return datas.length ? new Date(Math.min(...datas)).toISOString().slice(0, 10) : null;
}

/**
 * QUANTO TEMPO ATÉ A SENTENÇA — a pergunta que a diretoria faz e o Panorama
 * não respondia (18/09/2026).
 *
 * A tela contava QUANTAS e COMO foram julgadas, nunca EM QUANTO TEMPO. É o
 * número que decide se vale entrar com a ação: "contra esta operadora a
 * sentença sai em dois anos" muda a conversa com o filiado na porta.
 *
 * MEDIANA, não média: um caso parado sete anos por precatório puxaria a média
 * e descreveria um acervo que não existe. E ela CALA com menos de três
 * julgados — mediana de dois é o ponto médio de dois números, não um padrão.
 *
 * Mede da distribuição à SENTENÇA mais recente, que é o que o resto da tela
 * já usa. Não é o fim do processo: o recurso vem depois, e a ressalva ao lado
 * continua dizendo isso.
 */
export const MINIMO_PARA_MEDIANA = 3;

export function medianaAteSentenca(linhas: LinhaDoAcervo[]): number | null {
  const dias = linhas
    .filter((l) => l.julgamento !== null && SENTENCAS.includes(l.julgamento))
    .map((l) => {
      const de = l.dataDistribuicao?.getTime();
      const ate = l.dataJulgamento?.getTime();
      if (typeof de !== 'number' || typeof ate !== 'number') return null;
      const d = Math.round((ate - de) / 86_400_000);
      // Sentença anterior à distribuição é dado sujo, não caso relâmpago.
      return d >= 0 ? d : null;
    })
    .filter((d): d is number => d !== null)
    .sort((x, y) => x - y);

  if (dias.length < MINIMO_PARA_MEDIANA) return null;
  const meio = Math.floor(dias.length / 2);
  return dias.length % 2 ? dias[meio] : Math.round((dias[meio - 1] + dias[meio]) / 2);
}

const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

/**
 * OS DOIS PADRÕES, a partir das linhas do acervo e dos temas.
 *
 * QUEM ENTRA continua decidido pelo acervo ATIVO — pisos, pedidos repetidos,
 * réus distintos —, porque os cartões dizem "N ações ativas" e o link abre
 * `status=ATIVO`. O que muda é a pergunta sobre o passado: `historico` e a
 * série por ano olham todas as ajuizadas.
 */
export function montarPadroes(
  linhasBrutas: LinhaDoAcervo[],
  temasBrutos: TemaDoProcesso[],
): { concentracoes: Concentracao[]; dispersoes: Dispersao[] } {
  // Uma linha por processo, mesmo que a consulta repita alguma.
  const processos = new Map<string, LinhaDoAcervo>();
  for (const l of linhasBrutas) {
    if (!NAO_AJUIZADO.includes(l.status) && !processos.has(l.processoId)) processos.set(l.processoId, l);
  }
  const linhas = [...processos.values()];

  const temasDe = new Map<string, Set<string>>();
  const processosDoTema = new Map<string, Set<string>>();
  for (const t of temasBrutos) {
    const assunto = t.assunto?.trim();
    if (!assunto || !processos.has(t.processoId)) continue;
    temasDe.set(t.processoId, (temasDe.get(t.processoId) ?? new Set()).add(assunto));
    processosDoTema.set(assunto, (processosDoTema.get(assunto) ?? new Set()).add(t.processoId));
  }

  const individuais = (ls: LinhaDoAcervo[]) => ls.filter((l) => l.tipoAcao === 'INDIVIDUAL').length;

  /* O MESMO RÉU, O MESMO PEDIDO. */
  const doReu = new Map<string, LinhaDoAcervo[]>();
  for (const l of linhas) {
    if (!l.parteExternaId) continue;
    doReu.set(l.parteExternaId, [...(doReu.get(l.parteExternaId) ?? []), l]);
  }

  const concentracoes: Concentracao[] = [];
  for (const [parteExternaId, todas] of doReu) {
    const ativas = todas.filter(ehAtivo);
    if (ativas.length < MINIMO_CONCENTRACAO) continue;

    const porPedido = new Map<string, number>();
    for (const l of ativas) {
      for (const assunto of temasDe.get(l.processoId) ?? []) {
        porPedido.set(assunto, (porPedido.get(assunto) ?? 0) + 1);
      }
    }
    /*
      SÓ ENTRA QUEM TEM PEDIDO REPETIDO. Sem isso, esta lista seria a mesma do
      bloco "Contra quem litigamos" do painel, com mais colunas. O que faz disto
      um padrão não é "temos cinco ações contra a Hapvida" — é "temos a MESMA
      ação contra a Hapvida cinco vezes".
    */
    const pedidos = [...porPedido]
      .filter(([, n]) => n >= MINIMO_PEDIDO_RECORRENTE)
      .map(([assunto, n]) => ({ assunto, processos: n }))
      .sort((a, b) => b.processos - a.processos || porNome(a.assunto, b.assunto));
    if (!pedidos.length) continue;

    const tipo = todas[0].tipoAdversario as TipoDoAdversario | null;
    const historico = historicoDe(todas);
    const base = { processos: ativas.length, individuais: individuais(ativas), historico };
    concentracoes.push({
      parteExternaId,
      adversario: todas[0].adversario ?? '',
      tipo: tipo && TIPOS_DE_ADVERSARIO.includes(tipo) ? tipo : null,
      ...base,
      ...desfechosDe(ativas),
      desde: desdeDe(ativas),
      // Sobre TODAS as ajuizadas, como o histórico: o caso que já encerrou é
      // justamente o que tem duração completa para contar.
      medianaDias: medianaAteSentenca(todas),
      pedidos,
      leituras: lerConcentracao(base),
    });
  }
  concentracoes.sort((a, b) => b.processos - a.processos || porNome(a.adversario, b.adversario));

  /* O MESMO PEDIDO, MUITOS RÉUS. */
  const dispersoes: Dispersao[] = [];
  for (const [assunto, ids] of processosDoTema) {
    const todas = [...ids].map((id) => processos.get(id) as LinhaDoAcervo);
    const ativas = todas.filter(ehAtivo);
    if (ativas.length < MINIMO_DISPERSAO_PROCESSOS) continue;
    const reus = new Set(ativas.map((l) => l.parteExternaId).filter(Boolean));
    if (reus.size < MINIMO_DISPERSAO_ADVERSARIOS) continue;

    const porAno = new Map<number, number>();
    for (const l of todas) {
      if (l.ano === null || !Number.isFinite(l.ano)) continue;
      porAno.set(l.ano, (porAno.get(l.ano) ?? 0) + 1);
    }

    dispersoes.push({
      assunto,
      processos: ativas.length,
      adversarios: reus.size,
      individuais: individuais(ativas),
      ...desfechosDe(ativas),
      desde: desdeDe(ativas),
      historico: historicoDe(todas),
      medianaDias: medianaAteSentenca(todas),
      porAno: serieCompleta([...porAno].map(([ano, n]) => ({ ano, processos: n }))),
    });
  }
  dispersoes.sort((a, b) => b.processos - a.processos || porNome(a.assunto, b.assunto));

  return { concentracoes, dispersoes };
}

@Injectable()
export class PadroesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O acervo ATIVO, agrupado de duas formas — com o histórico ao lado.
   *
   * Sem recorte por advogado, de propósito: o padrão só existe olhando o acervo
   * inteiro. Três ações sobre greve divididas entre dois advogados são
   * invisíveis para cada um deles — e é justamente o caso que a tela existe
   * para mostrar. O acesso continua sendo o do módulo de processos, que já dá a
   * lista toda.
   */
  async levantar(): Promise<{
    concentracoes: Concentracao[];
    dispersoes: Dispersao[];
    /** De que lado a entidade está — ver `deQueLadoEstamos`. */
    nossoPapel: {
      autor: number;
      reu: number;
      representando: number;
      /** Ativos sem parte nenhuma: não entram em cartão algum. */
      semPartes: number;
      /** Sindicato nos dois polos: contado em autor E em réu. */
      ambosOsPolos: number;
    };
    acervoAtivo: number;
    geradoEm: string;
  }> {
    const base = this.comBase(tenant.cnpj.replace(/\D/g, ''));
    const naoAjuizado = Prisma.join(NAO_AJUIZADO);

    const [linhas, temas, acervoAtivo, nossoPapel] = await Promise.all([
      this.prisma.$queryRaw<LinhaDoAcervo[]>(Prisma.sql`
        ${base}
        SELECT p.id                                        AS "processoId",
               p.status_interno::text                      AS status,
               p.tipo_acao::text                           AS "tipoAcao",
               EXTRACT(YEAR FROM p.data_distribuicao)::int AS ano,
               p.data_distribuicao                         AS "dataDistribuicao",
               a.parte_externa_id                          AS "parteExternaId",
               coalesce(a.nome_fantasia, a.nome)           AS adversario,
               a.tipo                                      AS "tipoAdversario",
               j.codigo                                    AS julgamento,
               j.data_movimento                            AS "dataJulgamento",
               coalesce(j.recurso_depois, false)           AS "recursoDepois"
        FROM processos p
        LEFT JOIN adversario a ON a.processo_id = p.id
        LEFT JOIN julgamento j ON j.processo_id = p.id
        WHERE p.status_interno::text NOT IN (${naoAjuizado})
      `),
      this.prisma.$queryRaw<TemaDoProcesso[]>(Prisma.sql`
        ${base}
        SELECT t.processo_id AS "processoId", t.assunto AS assunto
        FROM tema t
        JOIN processos p ON p.id = t.processo_id
        WHERE p.status_interno::text NOT IN (${naoAjuizado})
      `),
      this.prisma.processo.count({ where: { statusInterno: 'ATIVO' } }),
      this.deQueLadoEstamos(),
    ]);

    return {
      ...montarPadroes(linhas, temas),
      nossoPapel,
      acervoAtivo,
      geradoEm: new Date().toISOString(),
    };
  }

  /**
   * DE QUE LADO A ENTIDADE ESTÁ — e são três respostas, não duas.
   *
   * Medido em 04/09/2026 sobre os 127 processos: AUTOR em 93, REPRESENTANDO em
   * 31 (o filiado é a parte e o sindicato é o patrono) e RÉU em 3. Não somam o
   * acervo à força: processo sem parte nenhuma não entra em "representando", e
   * o sindicato como TERCEIRO não entra em nenhum dos três.
   *
   * A terceira categoria é a esquecida e é a segunda maior: "processo do
   * sindicato" e "processo que o sindicato conduz" são coisas diferentes, e a
   * diferença muda quem responde por ele quando alguém pergunta.
   *
   * A IDENTIFICAÇÃO É PELA FLAG, nunca por nome: as 96 partes que são o
   * sindicato estão todas ligadas ao cadastro `institucional`, e casar por
   * texto ("SENATEPI", a razão social inteira, o que o tribunal escrever)
   * erraria nas duas pontas.
   */
  private async deQueLadoEstamos() {
    const somosNos = { parteExterna: { institucional: true } };
    /*
      SÓ O ACERVO ATIVO — o mesmo recorte do resto desta tela.

      Contava TODOS os status, e a tela dizia outra coisa: o rodapé fala em
      "149 processos ativos" e os três cartões somavam 184 em 12/09/2026
      (autor 144, representando 31, réu 9) — encerrados, pré-processuais e o
      rascunho juntos. E o clique mudava o número: "31 representando" abria
      uma lista de 27, porque a listagem deixa o pré-processual de fora. Hoje o
      cartão conta o ativo e o link leva `status=ATIVO`: número e lista
      respondem à mesma pergunta.
    */
    const ativo = { statusInterno: 'ATIVO' as const };
    /*
      TERCEIRO NÃO É POLO — a mesma correção de `FILTRO_RAPIDO.nossoPapel`, e
      tem de ser a mesma: o cartão conta e o link lista, e se as duas réguas
      discordarem o número abre uma lista de outro tamanho.
    */
    const emPolo = { polo: { in: ['ATIVO' as const, 'PASSIVO' as const] }, ...somosNos };
    /*
      OS DOIS NÚMEROS QUE FAZEM A CONTA FECHAR (18/09/2026).

      Os três cartões não cobrem o acervo, e a tela não dizia. Um processo
      ativo SEM PARTE NENHUMA não entra em cartão algum — de propósito, porque
      não dá para afirmar o lado — e o sindicato nos DOIS polos (reconvenção)
      é contado duas vezes. Com o rodapé anunciando "161 processos ativos"
      logo abaixo de três cartões somando 155, quem confere encontra um buraco
      de seis e nenhuma explicação.

      Todo processo ativo cai em exatamente uma destas caixas: sindicato no
      polo ativo, no passivo (podendo ser os dois), em nenhum polo mas com
      partes, ou sem partes. Devolvendo as duas bordas, a tela consegue dizer
      a verdade em vez de deixar a subtração para o leitor.
    */
    const [autor, reu, representando, semPartes, ambosOsPolos] = await Promise.all([
      this.prisma.processo.count({ where: { ...ativo, partes: { some: { polo: 'ATIVO', ...somosNos } } } }),
      this.prisma.processo.count({ where: { ...ativo, partes: { some: { polo: 'PASSIVO', ...somosNos } } } }),
      // `some: {}` junto: processo sem parte nenhuma não é "representamos o
      // filiado", é processo com cadastro incompleto. Ver o comentário gêmeo
      // em `FILTRO_RAPIDO.nossoPapel`.
      this.prisma.processo.count({
        where: { ...ativo, AND: [{ partes: { some: {} } }, { partes: { none: emPolo } }] },
      }),
      this.prisma.processo.count({ where: { ...ativo, partes: { none: {} } } }),
      this.prisma.processo.count({
        where: {
          ...ativo,
          AND: [
            { partes: { some: { polo: 'ATIVO', ...somosNos } } },
            { partes: { some: { polo: 'PASSIVO', ...somosNos } } },
          ],
        },
      }),
    ]);
    return { autor, reu, representando, semPartes, ambosOsPolos };
  }

  private comBase(cnpj: string): Prisma.Sql {
    return baseDoAcervo(cnpj);
  }
}

/**
 * As CTEs do acervo, fora da classe: o relatório conta adversários e assuntos
 * com a régua do Panorama. Duas cópias desta consulta discordariam sobre quem é
 * o réu de um processo — e a leitura de cada tela ficaria em dúvida.
 *
 * `nosso` é o sindicato: a FLAG `institucional` — a mesma de "De que lado
 * estamos" — ou o CNPJ do tenant. Era só o CNPJ, e bastava a linha
 * institucional estar sem documento (ou com outro) para o próprio sindicato
 * virar o "réu" de metade do acervo, enquanto os três cartões de papel o
 * achavam pela flag.
 *
 * `lado` é o polo de quem representamos em cada processo: o do sindicato, e,
 * sem ele entre as partes, o da parte ligada a um filiado. TERCEIRO não define
 * lado — sindicato assistente não diz quem é o adversário.
 *
 * `adversario` devolve UM por processo, do polo OPOSTO ao `lado`; sem lado, o
 * PASSIVO; nunca um TERCEIRO; sem candidato, nenhum. É a régua de
 * `adversarioDoProcesso` do painel. Antes escolhia "a principal, senão a
 * primeira por nome" sem olhar polo: numa ação CONTRA o sindicato o "réu" era o
 * autor, e o MPT ou o perito cadastrados como terceiro podiam ser o escolhido.
 * Um por processo continua valendo: 96 dos 105 processos ativos têm um
 * adversário só, e contar sob CADA corréu inventaria padrão no agregado — a
 * mesma ação apareceria como duas contra empresas do mesmo grupo. Só entra
 * parte CADASTRADA (com `parte_externa_id`): o padrão agrupa pelo cadastro.
 *
 * `tema` são os assuntos de mérito, TODOS eles e não só o principal. O CNJ
 * marca como principal o que quiser: das 24 vezes em que "Piso Salarial da
 * Categoria" aparece no acervo, só 11 são como principal. Os treze códigos de
 * rito ficam de fora — ver `ASSUNTOS_DE_RITO`.
 *
 * `julgamento` é a SENTENÇA mais recente de cada processo — somar primeiro grau
 * e recurso contaria duas vezes o mesmo caso — e diz se houve recurso julgado
 * depois dela (`recurso_depois`), porque a sentença não é o resultado final.
 * CTE que a consulta não cita o Postgres não executa: os Relatórios, que só
 * usam `adversario` e `tema`, não pagam por ela.
 */
export function baseDoAcervo(cnpj: string): Prisma.Sql {
    return Prisma.sql`
      WITH nosso AS (
        SELECT id FROM partes_externas
        WHERE institucional = true
           OR (${cnpj} <> '' AND documento = ${cnpj})
      ),
      lado AS (
        SELECT DISTINCT ON (pp.processo_id)
               pp.processo_id, pp.polo
        FROM partes_processo pp
        WHERE pp.polo <> 'TERCEIRO'
          AND (pp.filiado_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM nosso n WHERE n.id = pp.parte_externa_id))
        ORDER BY pp.processo_id,
                 EXISTS (SELECT 1 FROM nosso n WHERE n.id = pp.parte_externa_id) DESC,
                 pp.principal DESC,
                 pp.polo
      ),
      adversario AS (
        SELECT DISTINCT ON (pp.processo_id)
               pp.processo_id, pp.parte_externa_id, pe.nome, pe.nome_fantasia, pe.tipo::text AS tipo
        FROM partes_processo pp
        JOIN partes_externas pe ON pe.id = pp.parte_externa_id
        LEFT JOIN lado l ON l.processo_id = pp.processo_id
        WHERE pp.parte_externa_id IS NOT NULL
          AND pp.parte_externa_id NOT IN (SELECT id FROM nosso)
          AND pp.polo <> 'TERCEIRO'
          AND CASE WHEN l.polo IS NULL THEN pp.polo = 'PASSIVO' ELSE pp.polo <> l.polo END
        ORDER BY pp.processo_id, pp.principal DESC, pe.nome
      ),
      tema AS (
        SELECT DISTINCT p.id AS processo_id, btrim(x->>'nome') AS assunto
        FROM processos p, jsonb_array_elements(coalesce(p.assuntos, '[]'::jsonb)) x
        WHERE btrim(coalesce(x->>'nome', '')) <> ''
          AND coalesce((x->>'codigo')::int, 0) NOT IN (${Prisma.join(ASSUNTOS_DE_RITO)})
      ),
      julgamento AS (
        SELECT DISTINCT ON (m.processo_id)
               m.processo_id, m.codigo_movimento AS codigo, m.data_movimento,
               EXISTS (
                 SELECT 1 FROM movimentacoes_processuais r
                 WHERE r.processo_id = m.processo_id
                   AND r.codigo_movimento IN (${Prisma.join(RECURSO_JULGADO)})
                   AND r.data_movimento > m.data_movimento
               ) AS recurso_depois
        FROM movimentacoes_processuais m
        WHERE m.codigo_movimento IN (${PROCEDENCIA}, ${IMPROCEDENCIA}, ${PROCEDENCIA_PARCIAL})
        ORDER BY m.processo_id, m.data_movimento DESC
      )
    `;
}
