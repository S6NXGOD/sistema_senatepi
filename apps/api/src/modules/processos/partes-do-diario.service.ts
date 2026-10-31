import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarNome } from './utils/acao-nossa.util';
import { ladoDoAtoEhDaAcao } from './utils/lado-do-ato.util';
import { completarPolosQueFaltam, ParteDoCabecalho } from './utils/partes-do-cabecalho.util';
import { DjenService } from './djen.service';

/**
 * O DIÁRIO SABE QUEM ESTÁ NO PROCESSO — e a ficha passa a saber junto.
 *
 * POR QUE ISTO EXISTE
 * ---------------------------------------------------------------------------
 * A API Pública do DataJud não devolve partes (verificado em quatro tribunais);
 * é por isso que a aba "Partes" é onde o dado NASCE, digitado por alguém. Só
 * que digitar 30 nomes de um litisconsórcio ninguém faz, e o resultado apareceu
 * na medição de 12/09/2026: das 108 fichas com publicação, **43 tinham parte
 * que o tribunal nomeia no ato e que nunca foi cadastrada** — 51 partes ao todo.
 *
 * O ato do Diário traz `destinatarios: [{ nome, polo }]`. Isso é dado do
 * tribunal, não palpite. Repor o que ele afirma é o oposto de inventar.
 *
 * O QUE ESTA CLASSE SE RECUSA A FAZER — e cada recusa custou um erro para ser
 * aprendida:
 *
 *  1. ADVOGADO NÃO É PARTE. O Diário repete o nome do advogado entre os
 *     destinatários. Sem tirar, "MURILO MARCONES ALVES VELOSO" entraria como
 *     autor dos processos em que ele atua — foram 16 casos na simulação.
 *
 *  2. POLO EM RECURSO NÃO É POLO DA AÇÃO. O tribunal informa a posição
 *     RECURSAL: no Recurso Ordinário 0001095-45.2025.5.22.0004 a EBSERH aparece
 *     como `A` e o sindicato como `P`, enquanto na ação o sindicato é o autor.
 *     Quando o lado do sindicato no ato discorda do lado dele na ficha, o
 *     processo INTEIRO fica para uma pessoa: escolher seria trocar uma verdade
 *     por outra.
 *
 *  3. PARTE NOS DOIS POLOS não vira nada. Em recurso os dois lados recorrem, e
 *     a mesma empresa sai como recorrente numa publicação e recorrida noutra.
 *
 *  4. NADA É REMOVIDO OU SOBRESCRITO. Só acrescenta.
 *
 *  5. QUEM FOI TIRADO À MÃO NÃO VOLTA. A lápide (`partesDispensadas`) é
 *     consultada antes de qualquer inclusão — sem ela, apagar seria inútil e o
 *     robô desfaria decisão de gente toda madrugada.
 *
 * O que sobra das recusas não é jogado fora: vira a lista que a ficha do
 * processo mostra para alguém resolver em um toque.
 */

/** Quantas publicações do processo alimentam a leitura. As mais novas primeiro. */
const PUBLICACOES_POR_PROCESSO = 60;

/**
 * Nome de advogado da casa curto demais não serve de filtro.
 *
 * A comparação é por continência (o tribunal acrescenta sufixo ao nome), então
 * uma chave de poucas letras casaria dentro de uma razão social qualquer. Doze
 * caracteres sem espaço nem acento é, na prática, nome e sobrenome.
 */
const TAMANHO_MINIMO_DO_NOME_DA_CASA = 12;

/** Os três lados que o schema conhece — TERCEIRO existe e não pode ser ignorado. */
export type PoloDaParte = 'ATIVO' | 'PASSIVO' | 'TERCEIRO';

export interface ParteDoAto {
  nome: string;
  polo: PoloDaParte;
}

export interface ParteEmDuvida {
  nome: string;
  /**
   * O lado que o ato sugere — NULO quando o CNJ não classificou.
   *
   * Nulo aqui é informação, não falta dela: significa "o tribunal nomeou esta
   * parte e não disse de que lado". A tela mostra os três lados sem nenhum
   * realçado, porque não há sugestão a dar.
   */
  polo: PoloDaParte | null;
  /** Em português, o que impede o sistema de decidir sozinho. */
  porque: string;
}

export interface ResultadoReconciliacao {
  /** Partes acrescentadas porque o ato as nomeia e não havia dúvida de lado. */
  repostas: number;
  /** Partes que o ato nomeia e que ficaram para uma pessoa decidir. */
  emDuvida: number;
  /** Processos tocados. */
  processos: number;
}

const VAZIO: ResultadoReconciliacao = { repostas: 0, emDuvida: 0, processos: 0 };

/** De onde saíram as publicações lidas — a tela diz isso em uma linha. */
export type FonteDasPartes = 'acervo' | 'diario';

/** Advogado como o ato o nomeia. */
interface AdvogadoDoAto {
  nome?: unknown;
  numeroOab?: unknown;
  ufOab?: unknown;
}

/**
 * O que o Diário sabe sobre as partes de um processo que AINDA NÃO EXISTE aqui.
 *
 * `consultou: false` não é erro de ninguém: é "não deu para perguntar agora", e
 * a tela de cadastro continua funcionando sem isto — era assim que ela era
 * antes. Por isso cada recusa traz a frase pronta, em português.
 */
export interface PartesParaCadastro {
  consultou: boolean;
  /** Por que não deu, quando não deu. Nulo quando deu certo. */
  porque: string | null;
  fonte: FonteDasPartes | null;
  /** Partes com lado que o sistema assina — prontas para preencher o polo. */
  partes: ParteDoAto[];
  /** Nomes que o ato cita e cujo lado ele NÃO assina. */
  duvida: ParteEmDuvida[];
  /** O que o cabeçalho do ato diz sobre o lado que continuou vazio. */
  cabecalho: ParteDoCabecalho[];
  advogados: { nome: string; oab: string | null }[];
  publicacoes: number;
  /** Dia da publicação mais recente (yyyy-mm-dd). */
  ultimaEm: string | null;
}

const SEM_DIARIO: PartesParaCadastro = {
  consultou: false, porque: null, fonte: null,
  partes: [], duvida: [], cabecalho: [], advogados: [],
  publicacoes: 0, ultimaEm: null,
};

/**
 * Quanto a tela de cadastro espera pelo Diário antes de seguir sem ele.
 *
 * Não é o timeout da rede (esse é do `DjenService`): é o tempo que alguém
 * aguenta com o formulário aberto. A chamada que estourar continua correndo e
 * o resultado é descartado — preferível a um modal girando por minutos atrás
 * da fila da varredura.
 */
const ESPERA_MAXIMA_DA_TELA_MS = 15_000;

/** Sem acento, sem pontuação, sem caixa — a mesma régua de `PartesService`. */
export function comparavelParte(nome: unknown): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/**
 * O LADO QUE O ATO DIZ — e NULO quando ele não diz.
 *
 * Esta função já foi `=== 'P' ? 'PASSIVO' : 'ATIVO'`, e esse `else` era um
 * chute gravado como fato. O CNJ manda mesmo outra coisa: no
 * 0001335-13.2025.5.22.0108 ele mandou `T` para o MINISTÉRIO PÚBLICO DO
 * TRABALHO, e a primeira rodada da reconciliação escreveu o MPT como AUTOR do
 * processo. Uma ocorrência em 3.970 destinatários — rara, e errada do mesmo
 * jeito, porque quem lê a ficha não tem como desconfiar.
 *
 * Os dois irmãos que leem este mesmo campo já se recusavam a chutar
 * (`nossoPoloNoAto` devolve INDEFINIDO; o lote de sugestões filtra A/P estrito).
 * Eram três leitores do mesmo dado com três regras, e só a que chutava
 * escrevia no banco.
 */
const poloDoAto = (bruto: unknown): PoloDaParte | null => {
  switch (String(bruto ?? '').trim().toUpperCase()) {
    case 'A':
      return 'ATIVO';
    case 'P':
      return 'PASSIVO';
    // O schema tem o lugar certo para isto: assistente, litisconsorte, MP, perito.
    case 'T':
      return 'TERCEIRO';
    default:
      return null;
  }
};

interface PublicacaoLida {
  destinatarios: unknown;
  advogados: unknown;
  /**
   * A classe e o número do ATO — é o par que diz se o lado publicado serve.
   *
   * OBRIGATÓRIOS de propósito, mesmo podendo vir nulos do banco: quem chamar
   * esta leitura tem de passar por aqui e decidir. Opcionais, bastaria um
   * caller novo esquecer para o polo do RECURSO voltar a ser gravado como polo
   * da ação — o defeito que `lado-do-ato.util` mede em 39,2% de acerto.
   */
  nomeClasse: string | null;
  numeroProcesso: string | null;
}

interface ParteGravada {
  polo: string;
  nome: string;
  parteExterna: { institucional: boolean } | null;
}

/**
 * "ESTE NOME É O NOSSO SINDICATO?" — pela SIGLA, nunca pelo nome inteiro.
 *
 * Esta função nasceu de um teste vermelho, e o vermelho estava certo. Eu havia
 * comparado o nome da parte institucional na ficha com o nome no ato, e os dois
 * NUNCA batem:
 *
 *   cadastro:  "SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ"
 *   o Diário:  "SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI"
 *
 * Vírgula a mais, "AUXILIARES" no meio, "EM" no lugar de "DE", sem acento. Com
 * a comparação errada aconteciam DUAS coisas ruins de uma vez: a bússola que
 * detecta polo recursal nunca disparava, e o próprio sindicato era reposto como
 * uma segunda parte, com o nome do tribunal, ao lado do cadastro.
 *
 * A sigla é o apelido que o próprio tribunal repete — das 1.408 publicações do
 * acervo, 1.034 a trazem e ZERO trazem o nome sem ela. Fronteira de PALAVRA
 * porque "SENATEPI" casaria dentro de "PROSENATEPINHO", e o tribunal escreve
 * "2. SINDICATO ... - SENATEPI (RECORRIDO)". Mesma régua de `nossoPoloNoAto`.
 */
export function ehONossoSindicato(nome: unknown, sigla: string | null | undefined): boolean {
  const alvo = normalizarNome(sigla);
  // Sigla curta demais casaria dentro de qualquer razão social.
  if (alvo.length < 4) return false;
  return normalizarNome(String(nome ?? '')).split(' ').includes(alvo);
}

/**
 * A LEITURA PURA — o que o ato diz, sem tocar no banco.
 *
 * Separada do serviço de propósito: é aqui que moram as quatro recusas, e é
 * isto que o teste exercita com o ato real da produção. Devolve o que dá para
 * repor e o que precisa de gente, já explicado em português.
 */
export function lerPartesDoAto(
  publicacoes: PublicacaoLida[],
  jaNaFicha: ParteGravada[],
  dispensadas: Set<string>,
  /** A sigla do cadastro institucional — é por ela que nos reconhecemos no ato. */
  sigla: string | null | undefined,
  /**
   * Os advogados DA CASA, como estão no cadastro. Ver a recusa 1-B abaixo.
   */
  advogadosDaCasa: string[],
): { repor: ParteDoAto[]; duvida: ParteEmDuvida[] } {
  // 1. Advogado não é parte — o Diário repete o nome dele entre os destinatários.
  const advogados = new Set<string>();
  for (const p of publicacoes) {
    for (const a of Array.isArray(p.advogados) ? (p.advogados as { nome?: string }[]) : []) {
      const k = comparavelParte(a?.nome);
      if (k) advogados.add(k);
    }
  }

  /*
    1-B. E NEM SEMPRE O ATO TRAZ A LISTA DE ADVOGADOS PARA COMPARAR.

    A recusa 1 só funciona quando o MESMO ato que nomeia o advogado entre os
    destinatários também o nomeia entre os advogados. No TJPI isso falha de
    duas maneiras ao mesmo tempo: a publicação vem com `advogados: []`, e o
    tribunal escreve o nome com sufixo — "CARLOS HENRIQUE DE ALENCAR VIEIRA
    REGISTRADO(A) CIVILMENTE COMO CARLOS HENRIQUE DE ALENCAR VIEIRA" —, o que
    derrota qualquer comparação exata.

    Resultado medido na produção em 31/10/2026: o Dr. Carlos Henrique, advogado
    PRINCIPAL dos cinco processos, estava gravado como AUTOR em todos eles, com
    `origem = 'DJEN'`. A regra atual o removeu em 0 de 8 aparições. Os outros
    três da equipe apareceram 12 vezes e escaparam em 3.

    Por isso a casa entra pelo CADASTRO, não pelo ato: quem tem OAB nossa não é
    parte de processo de filiado. A comparação é por CONTINÊNCIA do nome
    cadastrado dentro do nome publicado, que é o que o sufixo exige, e só vale
    para nome longo — chave curta casaria dentro de qualquer razão social.
  */
  const daCasa = advogadosDaCasa
    .map((n) => comparavelParte(n))
    .filter((k) => k.length >= TAMANHO_MINIMO_DO_NOME_DA_CASA);
  const ehAdvogadoDaCasa = (k: string) => daCasa.some((c) => k.includes(c));

  /*
    2. O ato inteiro, agrupado por nome, guardando TODOS os polos em que apareceu.

    SÓ O ATO DA AÇÃO POSICIONA. O lado publicado num recurso noticiado dentro do
    número da ação de origem acerta 39,2% das vezes (medição de 31/10/2026, ver
    `lado-do-ato.util`) — pior que moeda ao ar, porque lá quem recorreu vira
    autor. Esse nome não é descartado: ele existe no processo e a ficha precisa
    dele. Só não ganha lado automático — vai para a fila de gente, com a frase.
  */
  const doAto = new Map<
    string,
    { nome: string; polos: Set<PoloDaParte>; semLado: boolean; soNoRecurso: boolean }
  >();
  for (const p of publicacoes) {
    const lado = ladoDoAtoEhDaAcao(p.nomeClasse, p.numeroProcesso);
    for (const d of Array.isArray(p.destinatarios) ? (p.destinatarios as { nome?: string; polo?: string }[]) : []) {
      const nome = String(d?.nome ?? '').trim();
      const k = comparavelParte(nome);
      if (!k || advogados.has(k) || ehAdvogadoDaCasa(k)) continue;
      const atual =
        doAto.get(k) ?? { nome, polos: new Set<PoloDaParte>(), semLado: false, soNoRecurso: true };
      const polo = poloDoAto(d?.polo);
      if (!lado.daAcao) {
        // O nome fica registrado; o lado dele, não.
        doAto.set(k, atual);
        continue;
      }
      atual.soNoRecurso = false;
      if (polo) atual.polos.add(polo);
      else atual.semLado = true;
      doAto.set(k, atual);
    }
  }
  if (!doAto.size) return { repor: [], duvida: [] };

  /** A frase do recurso, montada uma vez — ela é igual para todos os nomes. */
  const porqueRecurso =
    publicacoes
      .map((p) => ladoDoAtoEhDaAcao(p.nomeClasse, p.numeroProcesso))
      .find((x) => !x.daAcao)?.porque ?? '';

  const naFicha = new Set(jaNaFicha.map((x) => comparavelParte(x.nome)));
  const nossaNaFicha = jaNaFicha.find((x) => x.parteExterna?.institucional);

  /*
    O LADO DO SINDICATO É A BÚSSOLA.

    Se o ato o põe num lado e a ficha noutro, a numeração de polos do ato é
    RECURSAL e não serve para posicionar mais ninguém neste processo. Um só
    teste, feito uma vez, decide por todas as partes.
  */
  const nossaNoAto = [...doAto.values()].find((x) => ehONossoSindicato(x.nome, sigla));
  /*
    E A BÚSSOLA SÓ EXISTE SE UM ATO DA AÇÃO NOMEAR O SINDICATO.

    Com `polos` vazio ele apareceu só em ato de recurso, onde o lado não vale
    nem para ele — não há divergência a declarar, há ausência de agulha. Sem
    esta condição o `!(size === 1 && ...)` dava `true` por vacuidade e mandava
    para a fila de dúvida partes cujo lado veio de ato da ação (97,2% de
    acerto); e a frase, que imprime `[...polos][0]`, estourava num `undefined`.
    Apanhado simulando contra a produção, não por teste.
  */
  const temBussola = !!nossaNaFicha && !!nossaNoAto && nossaNoAto.polos.size > 0;
  const polosDivergem =
    temBussola && !(nossaNoAto!.polos.size === 1 && nossaNoAto!.polos.has(nossaNaFicha!.polo as PoloDaParte));

  /*
    A EXPLICAÇÃO É PARA GENTE LER, então ela precisa fazer sentido em voz alta.

    A primeira versão dizia "o Diário põe o sindicato no polo ativo e a ficha no
    ativo" — contradição na cara de quem lê, porque o caso ali era outro: o ato
    nomeia o sindicato nos DOIS polos, e a frase imprimia só o primeiro. São
    duas situações diferentes e cada uma merece a sua frase.
  */
  const porqueDivergem = (() => {
    if (!temBussola || !nossaNoAto || !nossaNaFicha) return '';
    if (nossaNoAto.polos.size > 1) {
      return (
        'neste processo o Diário nomeia o próprio sindicato nos DOIS polos — é assim que ele ' +
        'escreve um recurso, e por isso a numeração de lados do ato não vale para posicionar ninguém aqui'
      );
    }
    /*
      A FRASE MUDOU DE DIAGNÓSTICO QUANDO O RECURSO SAIU DA CONTA.

      Ela dizia "o ato está numerando os polos do RECURSO" — e era a explicação
      certa enquanto os atos de recurso entravam aqui. Agora eles são filtrados
      antes (`lado-do-ato.util`), então chegar a este ponto significa outra
      coisa: o Diário e a ficha discordam num ato DA AÇÃO, e um dos dois está
      errado. Nas duas consignações em pagamento do acervo é a ficha — ela põe
      o sindicato como autor de uma ação que o município moveu contra ele, e
      por tabela transforma outro sindicato no nosso adversário.

      Repetir a frase antiga mandaria quem lê procurar um recurso que não
      existe. O que a pessoa precisa saber é que há uma contradição e onde
      resolvê-la.
    */
    return (
      `o Diário põe o sindicato no polo ${[...nossaNoAto.polos][0].toLowerCase()} ` +
      `e a ficha no ${nossaNaFicha.polo.toLowerCase()} — um dos dois está errado, e enquanto ` +
      `isso não for resolvido na aba Partes o lado publicado não posiciona mais ninguém aqui`
    );
  })();

  const repor: ParteDoAto[] = [];
  const duvida: ParteEmDuvida[] = [];
  for (const [k, e] of doAto) {
    if (naFicha.has(k)) continue;
    if (dispensadas.has(k)) continue;
    // Já estamos na ficha com o nome do CADASTRO: o nome do tribunal é o mesmo
    // sindicato escrito de outro jeito, e entraria como uma segunda parte.
    if (nossaNaFicha && ehONossoSindicato(e.nome, sigla)) continue;
    const polo = [...e.polos][0] ?? null;
    /*
      SÓ APARECEU EM RECURSO — o nome vale, o lado não.

      Vem antes de tudo porque o motivo é outro: não é que o tribunal calou o
      lado, é que o lado que ele disse responde a outra pergunta. Sem esta
      recusa o nome cairia na frase "nomeia sem dizer de que lado", que é
      verdade sobre o MPT e mentira aqui.
    */
    if (e.soNoRecurso) {
      duvida.push({ nome: e.nome, polo: null, porque: porqueRecurso });
      continue;
    }
    /*
      O CNJ NÃO CLASSIFICOU — então o sistema também não classifica.

      Vem antes das outras recusas de propósito: sem lado, nem faz sentido
      perguntar se os polos divergem.
    */
    if (!polo || e.semLado) {
      duvida.push({
        nome: e.nome,
        polo,
        porque:
          'o Diário nomeia esta parte sem dizer de que lado ela está — acontece com ' +
          'Ministério Público, assistente e perito',
      });
      continue;
    }
    if (e.polos.size > 1) {
      duvida.push({
        nome: e.nome,
        polo,
        porque: 'o Diário lista esta parte nos dois polos — é assim que ele escreve um recurso',
      });
      continue;
    }
    if (polosDivergem) {
      duvida.push({ nome: e.nome, polo, porque: porqueDivergem });
      continue;
    }
    repor.push({ nome: e.nome, polo });
  }
  return { repor, duvida };
}

@Injectable()
export class PartesDoDiarioService {
  private readonly logger = new Logger(PartesDoDiarioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly djen: DjenService,
  ) {}

  /**
   * A rodada da madrugada. Falha num processo não derruba os outros: a
   * publicação já está gravada e a próxima rodada refaz.
   */
  async reconciliarTodos(): Promise<ResultadoReconciliacao> {
    const processos = await this.prisma.processo.findMany({
      where: { comunicacoes: { some: {} } },
      select: { id: true },
    });
    const total = { ...VAZIO };
    for (const p of processos) {
      try {
        const r = await this.reconciliar(p.id);
        total.repostas += r.repostas;
        total.emDuvida += r.emDuvida;
        if (r.repostas) total.processos++;
      } catch (err) {
        this.logger.warn(`[DJEN] Partes do processo ${p.id}: ${(err as Error).message}`);
      }
    }
    if (total.repostas || total.emDuvida) {
      this.logger.log(
        `[DJEN] Partes do ato: ${total.repostas} reposta(s) em ${total.processos} processo(s)` +
          `${total.emDuvida ? `, ${total.emDuvida} aguardando decisão de gente` : ''}.`,
      );
    }
    return total;
  }

  async reconciliar(processoId: string): Promise<ResultadoReconciliacao> {
    const { repor, duvida } = await this.ler(processoId);
    if (!repor.length) return { ...VAZIO, emDuvida: duvida.length };

    await this.prisma.$transaction(async (tx) => {
      for (const parte of repor) {
        const temPrincipal = await tx.parteProcesso.findFirst({
          where: { processoId, polo: parte.polo, principal: true },
          select: { id: true },
        });
        await tx.parteProcesso.create({
          data: {
            processoId,
            polo: parte.polo,
            papel: parte.polo === 'PASSIVO' ? 'Réu' : 'Autor',
            // Só vira principal quando o polo está vazio — nunca desbanca quem
            // já estava, que é onde mora a leitura "Autor × Réu" da lista.
            principal: !temPrincipal,
            nome: parte.nome,
            origem: 'DJEN',
          },
        });
      }
    });
    return { repostas: repor.length, emDuvida: duvida.length, processos: 1 };
  }

  /** O que o ato nomeia e o sistema não soube posicionar — para a ficha mostrar. */
  async emDuvida(processoId: string): Promise<ParteEmDuvida[]> {
    return (await this.ler(processoId)).duvida;
  }

  /**
   * QUEM ESTÁ DOS DOIS LADOS, NA HORA DE CADASTRAR — antes de existir ficha.
   *
   * POR QUE
   * -------------------------------------------------------------------------
   * A tela "Importar processo" consulta o DataJud, e o DataJud NÃO DEVOLVE
   * PARTES (verificado em quatro tribunais). O resultado é o que o dono viu em
   * 31/10/2026: a ficha abre com "Polo ativo — quem pede" em branco, e a única
   * coisa preenchida é o próprio sindicato, quando a fila do Diário o trouxe.
   * Das 42 ações que entraram pela fila, ONZE tinham um lado só — e em dez
   * delas esse lado era nós mesmos. Quem cadastra não tem como saber contra
   * quem está entrando, e vai procurar no site do tribunal.
   *
   * O Diário sabe. Das 2.537 publicações do acervo, 2.354 (93%) nomeiam os
   * DOIS lados em `destinatarios`; nas que não nomeiam, o cabeçalho do próprio
   * ato nomeia em 78%. O que faltava não era o dado — era alguém perguntar na
   * hora certa.
   *
   * COMO
   * -------------------------------------------------------------------------
   * 1. Se já temos publicação guardada deste número, ela basta: zero chamada
   *    ao CNJ. (Acontece quando o processo foi excluído e está voltando, ou
   *    quando a varredura guardou o ato de um processo irmão.)
   * 2. Senão, pergunta ao Diário UMA página. É uma consulta, não uma varredura.
   * 3. A leitura é a MESMA de `reconciliar` — `lerPartesDoAto`, com as quatro
   *    recusas e a régua do recurso. Prévia que recalcula é segunda regra, e
   *    segunda regra diverge (ver `planejarAtividade`).
   *
   * NUNCA GRAVA NADA. Devolve para a tela e quem decide é quem está olhando.
   */
  async paraCadastro(npu: string): Promise<PartesParaCadastro> {
    const numero = (npu || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }

    const [nos, locais, daCasa] = await Promise.all([
      this.prisma.parteExterna.findFirst({
        where: { institucional: true },
        select: { nomeFantasia: true },
      }),
      this.prisma.comunicacaoDjen.findMany({
        where: { numeroProcesso: numero },
        select: {
          destinatarios: true, advogados: true, nomeClasse: true,
          numeroProcesso: true, texto: true, dataDisponibilizacao: true,
        },
        orderBy: { dataDisponibilizacao: 'desc' },
        take: PUBLICACOES_POR_PROCESSO,
      }),
      this.advogadosDaCasa(),
    ]);
    const sigla = nos?.nomeFantasia ?? null;

    let publicacoes = locais;
    let fonte: FonteDasPartes = 'acervo';

    if (!publicacoes.length) {
      if (!this.djen.integracaoAtiva) return { ...SEM_DIARIO, porque: 'a leitura do Diário está desligada.' };
      if (this.djen.bloqueadoNaOrigem) {
        return { ...SEM_DIARIO, porque: 'o Diário está recusando consultas agora; tente em alguns minutos.' };
      }
      /*
        A TELA NÃO ESPERA A FILA DO CNJ.

        As chamadas ao DJEN são serializadas e a cota é de 20/min compartilhada:
        um clique durante a varredura das 5h ficaria parado atrás dela por
        minutos, com o modal girando. Quinze segundos é o limite do que alguém
        espera olhando um formulário — passou disso, a tela segue sem o Diário e
        diz isso em uma linha. Ver `senatepi-nao-cabe-na-requisicao`: a lição de
        06/10/2026 é responder na hora, não segurar a requisição.
      */
      let leitura;
      try {
        leitura = await Promise.race([
          this.djen.lerPorProcesso(numero, { maxPaginas: 1, esperarCota: false }),
          new Promise<null>((r) => setTimeout(() => r(null), ESPERA_MAXIMA_DA_TELA_MS)),
        ]);
      } catch (err) {
        this.logger.warn(`[DJEN] Partes para cadastro de ${numero}: ${(err as Error).message}`);
        return { ...SEM_DIARIO, porque: 'não foi possível falar com o Diário agora.' };
      }
      if (!leitura) {
        return { ...SEM_DIARIO, porque: 'o Diário está ocupado com a varredura; tente em alguns minutos.' };
      }
      publicacoes = leitura.itens.map((i) => ({
        destinatarios: i.destinatarios as unknown,
        advogados: i.advogados as unknown,
        nomeClasse: i.nomeClasse,
        numeroProcesso: i.numeroProcesso,
        texto: i.texto,
        dataDisponibilizacao: new Date(`${i.dataDisponibilizacao}T00:00:00Z`),
      }));
      fonte = 'diario';
    }

    if (!publicacoes.length) {
      return { ...SEM_DIARIO, consultou: true, fonte, porque: 'este processo ainda não apareceu no Diário.' };
    }

    // Ficha vazia e nenhuma lápide: o processo não existe ainda.
    const { repor, duvida } = lerPartesDoAto(publicacoes, [], new Set(), sigla, daCasa);

    /*
      E O CABEÇALHO FECHA O QUE SOBRA — a mesma regra da fila de sugestões.
      Só quando um dos dois lados continuou sem ninguém; com os dois cobertos,
      citar o ato só acrescentaria texto a uma tela que já respondeu.
    */
    const cobertos = new Set(repor.map((p) => (p.polo === 'ATIVO' ? 'A' : p.polo === 'PASSIVO' ? 'P' : 'T')));
    const cabecalho =
      cobertos.has('A') && cobertos.has('P')
        ? []
        : completarPolosQueFaltam(publicacoes[0].texto ?? '', [...cobertos]);

    const advogados = new Map<string, { nome: string; oab: string | null }>();
    for (const p of publicacoes) {
      for (const a of Array.isArray(p.advogados) ? (p.advogados as AdvogadoDoAto[]) : []) {
        const nome = String(a?.nome ?? '').trim();
        if (!nome) continue;
        const oab = [a?.numeroOab, a?.ufOab].filter(Boolean).join('/') || null;
        advogados.set(comparavelParte(nome), { nome, oab });
      }
    }

    return {
      consultou: true,
      porque: null,
      fonte,
      partes: repor,
      duvida,
      cabecalho,
      advogados: [...advogados.values()],
      publicacoes: publicacoes.length,
      ultimaEm: publicacoes[0].dataDisponibilizacao?.toISOString().slice(0, 10) ?? null,
    };
  }

  /**
   * Os advogados da casa, por nome. Cacheado por hora: a reconciliação roda
   * processo a processo e a equipe não muda no meio da madrugada.
   */
  private casaCache: { nomes: string[]; em: number } | null = null;

  private async advogadosDaCasa(): Promise<string[]> {
    const UMA_HORA = 3_600_000;
    if (this.casaCache && Date.now() - this.casaCache.em < UMA_HORA) return this.casaCache.nomes;
    const equipe = await this.prisma.user.findMany({
      where: { oab: { not: null } },
      select: { nome: true },
    });
    this.casaCache = { nomes: equipe.map((u) => u.nome), em: Date.now() };
    return this.casaCache.nomes;
  }

  private async ler(processoId: string) {
    const [nos, publicacoes, partes, dispensadas, daCasa] = await Promise.all([
      this.prisma.parteExterna.findFirst({
        where: { institucional: true },
        select: { nomeFantasia: true },
      }),
      this.prisma.comunicacaoDjen.findMany({
        where: { processoId },
        select: {
          destinatarios: true,
          advogados: true,
          // O par que decide se o lado publicado posiciona alguém.
          nomeClasse: true,
          numeroProcesso: true,
        },
        orderBy: { dataDisponibilizacao: 'desc' },
        take: PUBLICACOES_POR_PROCESSO,
      }),
      this.prisma.parteProcesso.findMany({
        where: { processoId },
        select: { polo: true, nome: true, parteExterna: { select: { institucional: true } } },
      }),
      this.prisma.parteProcessoDispensada.findMany({
        where: { processoId },
        select: { nomeChave: true },
      }),
      this.advogadosDaCasa(),
    ]);
    const sigla = nos?.nomeFantasia ?? null;
    if (!publicacoes.length) return { repor: [], duvida: [] };
    return lerPartesDoAto(
      publicacoes,
      partes,
      new Set(dispensadas.map((d) => d.nomeChave)),
      sigla,
      daCasa,
    );
  }
}
