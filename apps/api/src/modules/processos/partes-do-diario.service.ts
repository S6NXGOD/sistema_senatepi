import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizarNome } from './utils/acao-nossa.util';

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

export type PoloDaParte = 'ATIVO' | 'PASSIVO';

export interface ParteDoAto {
  nome: string;
  polo: PoloDaParte;
}

export interface ParteEmDuvida extends ParteDoAto {
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

/** Sem acento, sem pontuação, sem caixa — a mesma régua de `PartesService`. */
export function comparavelParte(nome: unknown): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

const poloDoAto = (bruto: unknown): PoloDaParte =>
  String(bruto ?? '').trim().toUpperCase() === 'P' ? 'PASSIVO' : 'ATIVO';

interface PublicacaoLida {
  destinatarios: unknown;
  advogados: unknown;
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
): { repor: ParteDoAto[]; duvida: ParteEmDuvida[] } {
  // 1. Advogado não é parte — o Diário repete o nome dele entre os destinatários.
  const advogados = new Set<string>();
  for (const p of publicacoes) {
    for (const a of Array.isArray(p.advogados) ? (p.advogados as { nome?: string }[]) : []) {
      const k = comparavelParte(a?.nome);
      if (k) advogados.add(k);
    }
  }

  // 2. O ato inteiro, agrupado por nome, guardando TODOS os polos em que apareceu.
  const doAto = new Map<string, { nome: string; polos: Set<PoloDaParte> }>();
  for (const p of publicacoes) {
    for (const d of Array.isArray(p.destinatarios) ? (p.destinatarios as { nome?: string; polo?: string }[]) : []) {
      const nome = String(d?.nome ?? '').trim();
      const k = comparavelParte(nome);
      if (!k || advogados.has(k)) continue;
      const atual = doAto.get(k) ?? { nome, polos: new Set<PoloDaParte>() };
      atual.polos.add(poloDoAto(d?.polo));
      doAto.set(k, atual);
    }
  }
  if (!doAto.size) return { repor: [], duvida: [] };

  const naFicha = new Set(jaNaFicha.map((x) => comparavelParte(x.nome)));
  const nossaNaFicha = jaNaFicha.find((x) => x.parteExterna?.institucional);

  /*
    O LADO DO SINDICATO É A BÚSSOLA.

    Se o ato o põe num lado e a ficha noutro, a numeração de polos do ato é
    RECURSAL e não serve para posicionar mais ninguém neste processo. Um só
    teste, feito uma vez, decide por todas as partes.
  */
  const nossaNoAto = [...doAto.values()].find((x) => ehONossoSindicato(x.nome, sigla));
  const polosDivergem =
    !!nossaNaFicha && !!nossaNoAto && !(nossaNoAto.polos.size === 1 && nossaNoAto.polos.has(nossaNaFicha.polo as PoloDaParte));

  /*
    A EXPLICAÇÃO É PARA GENTE LER, então ela precisa fazer sentido em voz alta.

    A primeira versão dizia "o Diário põe o sindicato no polo ativo e a ficha no
    ativo" — contradição na cara de quem lê, porque o caso ali era outro: o ato
    nomeia o sindicato nos DOIS polos, e a frase imprimia só o primeiro. São
    duas situações diferentes e cada uma merece a sua frase.
  */
  const porqueDivergem = (() => {
    if (!nossaNoAto || !nossaNaFicha) return '';
    if (nossaNoAto.polos.size > 1) {
      return (
        'neste processo o Diário nomeia o próprio sindicato nos DOIS polos — é assim que ele ' +
        'escreve um recurso, e por isso a numeração de lados do ato não vale para posicionar ninguém aqui'
      );
    }
    return (
      `neste processo o Diário põe o sindicato no polo ${[...nossaNoAto.polos][0].toLowerCase()} ` +
      `e a ficha no ${nossaNaFicha.polo.toLowerCase()} — o ato está numerando os polos do RECURSO, não os da ação`
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
    const polo = [...e.polos][0];
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

  constructor(private readonly prisma: PrismaService) {}

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

  private async ler(processoId: string) {
    const [nos, publicacoes, partes, dispensadas] = await Promise.all([
      this.prisma.parteExterna.findFirst({
        where: { institucional: true },
        select: { nomeFantasia: true },
      }),
      this.prisma.comunicacaoDjen.findMany({
        where: { processoId },
        select: { destinatarios: true, advogados: true },
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
    ]);
    const sigla = nos?.nomeFantasia ?? null;
    if (!publicacoes.length) return { repor: [], duvida: [] };
    return lerPartesDoAto(publicacoes, partes, new Set(dispensadas.map((d) => d.nomeChave)), sigla);
  }
}
