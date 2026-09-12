import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  chaveOab,
  lerOabDigitada,
  mesclarAdvogadosDaParte,
  separarAdvogadosDoAto,
  type AdvogadoCitado,
} from './utils/advogados-do-ato.util';

/**
 * O DIÁRIO DIZ QUEM ATUA NO PROCESSO — e o sistema passa a saber.
 *
 * Toda intimação traz a lista de advogados do ato. Ela ficava gravada dentro da
 * publicação e não saía dali: a equipe do processo continuava sendo o que
 * alguém tivesse digitado, e os advogados da outra parte não existiam em lugar
 * nenhum. Medido na produção em 11/09/2026: 96 advogados de fora em 85
 * processos, e ZERO das 345 partes com advogado registrado.
 *
 * O QUE ESTA CLASSE FAZ, e o que ela se recusa a fazer:
 *
 *  - NOSSOS (a OAB bate com um usuário ativo) entram na EQUIPE do processo,
 *    marcados com origem `DJEN`. Nunca viram responsável: o dono do caso é o
 *    `principal`, e trocá-lo por causa de um ato seria mudar de dono toda vez
 *    que o tribunal intimasse outra pessoa da equipe.
 *  - QUEM FOI TIRADO À MÃO NÃO VOLTA: a lápide (`advogadosDispensados`) é
 *    consultada antes de qualquer inclusão.
 *  - OS DEMAIS viram advogados da parte CONTRÁRIA — e só quando há uma única
 *    parte no polo oposto. O CNJ não diz de quem cada advogado é (conferido na
 *    origem: o vínculo traz só `{advogado:{nome,numero_oab,uf_oab}}`), então com
 *    duas partes do outro lado o sistema não escolhe. Medido: 154 dos 168
 *    processos têm exatamente uma parte em cada polo, e nesses a inferência tem
 *    um candidato só.
 *  - NADA É SOBRESCRITO: advogado digitado por uma pessoa fica como está.
 */

/** Quantas publicações do processo alimentam a leitura. As mais novas primeiro. */
const PUBLICACOES_POR_PROCESSO = 60;

export interface ResultadoVinculoAdvogado {
  /** Advogados nossos acrescentados à equipe do processo. */
  equipe: number;
  /** Advogados da outra parte gravados na parte contrária. */
  naParte: number;
  /** Advogados de fora que ficaram sem lado (duas ou mais partes no polo oposto). */
  semLado: number;
}

const VAZIO: ResultadoVinculoAdvogado = { equipe: 0, naParte: 0, semLado: 0 };

@Injectable()
export class VinculoDeAdvogadoService {
  private readonly logger = new Logger(VinculoDeAdvogadoService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Nossos advogados ativos, indexados por "UF-número" da OAB. */
  private async nossosPorOab(): Promise<Map<string, string>> {
    const nossos = await this.prisma.user.findMany({
      where: { ativo: true, oab: { not: null }, oabUf: { not: null } },
      select: { id: true, oab: true, oabUf: true },
    });
    return new Map(nossos.map((a) => [chaveOab(a.oab, a.oabUf), a.id]));
  }

  /**
   * Aplica em VÁRIOS processos — o caminho da varredura da madrugada.
   *
   * Falha em um não derruba os outros: a publicação já está gravada, e o
   * vínculo é melhoria que a próxima rodada refaz.
   */
  async aplicarNosProcessos(processoIds: string[]): Promise<ResultadoVinculoAdvogado> {
    const ids = [...new Set(processoIds.filter(Boolean))];
    if (!ids.length) return { ...VAZIO };
    const porOab = await this.nossosPorOab();
    const total = { ...VAZIO };

    for (const id of ids) {
      try {
        const r = await this.aplicarNoProcesso(id, porOab);
        total.equipe += r.equipe;
        total.naParte += r.naParte;
        total.semLado += r.semLado;
      } catch (err) {
        this.logger.warn(
          `[DJEN] Não deu para ligar os advogados do processo ${id}: ${(err as Error).message}`,
        );
      }
    }

    if (total.equipe || total.naParte) {
      this.logger.log(
        `[DJEN] Advogados do ato: ${total.equipe} entrada(s) na equipe, ` +
          `${total.naParte} da outra parte` +
          `${total.semLado ? `, ${total.semLado} sem lado definido` : ''}.`,
      );
    }
    return total;
  }

  async aplicarNoProcesso(
    processoId: string,
    porOabPronto?: Map<string, string>,
  ): Promise<ResultadoVinculoAdvogado> {
    const porOab = porOabPronto ?? (await this.nossosPorOab());

    const [processo, publicacoes] = await Promise.all([
      this.prisma.processo.findUnique({
        where: { id: processoId },
        select: {
          id: true,
          advogados: { select: { advogadoId: true } },
          advogadosDispensados: { select: { advogadoId: true } },
          partes: {
            select: {
              id: true,
              polo: true,
              nome: true,
              advogados: true,
              filiadoId: true,
              parteExterna: { select: { institucional: true } },
            },
          },
        },
      }),
      this.prisma.comunicacaoDjen.findMany({
        where: { processoId },
        select: { advogados: true },
        orderBy: { dataDisponibilizacao: 'desc' },
        take: PUBLICACOES_POR_PROCESSO,
      }),
    ]);
    if (!processo || !publicacoes.length) return { ...VAZIO };

    const citados: AdvogadoCitado[] = publicacoes.flatMap((p) =>
      Array.isArray(p.advogados) ? (p.advogados as unknown as AdvogadoCitado[]) : [],
    );
    const { nossos, outros } = separarAdvogadosDoAto(citados, porOab);

    const equipe = await this.completarEquipe(processo, nossos);
    const { naParte, semLado } = await this.gravarNaParteContraria(processo, outros);
    return { equipe, naParte, semLado };
  }

  /**
   * OS ADVOGADOS QUE O ATO CITA E DE QUEM O SISTEMA NÃO SABE O LADO.
   *
   * É o que sobra quando há duas ou mais partes no polo contrário: o CNJ manda
   * a lista de advogados sem dizer quem representa quem, e escolher seria
   * inventar. Em vez de esconder, a ficha do processo mostra a lista e deixa
   * uma pessoa apontar em um toque — a mesma ideia da faixa "Ajude a contar
   * certo" em Contas Públicas.
   *
   * Também some da lista quem já foi atribuído a alguma parte, inclusive à mão.
   */
  async semLadoNoProcesso(processoId: string): Promise<AdvogadoCitado[]> {
    const [porOab, publicacoes, partes] = await Promise.all([
      this.nossosPorOab(),
      this.prisma.comunicacaoDjen.findMany({
        where: { processoId },
        select: { advogados: true },
        orderBy: { dataDisponibilizacao: 'desc' },
        take: PUBLICACOES_POR_PROCESSO,
      }),
      this.prisma.parteProcesso.findMany({ where: { processoId }, select: { advogados: true } }),
    ]);
    if (!publicacoes.length) return [];

    const citados = publicacoes.flatMap((p) =>
      Array.isArray(p.advogados) ? (p.advogados as unknown as AdvogadoCitado[]) : [],
    );
    const { outros } = separarAdvogadosDoAto(citados, porOab);

    const jaTemDono = new Set<string>();
    for (const parte of partes) {
      const lista = Array.isArray(parte.advogados)
        ? (parte.advogados as unknown as Array<{ oab?: string; numeroOab?: string; ufOab?: string }>)
        : [];
      for (const a of lista) {
        const digitada = lerOabDigitada(a?.oab);
        jaTemDono.add(chaveOab(a?.numeroOab ?? digitada.numeroOab, a?.ufOab ?? digitada.ufOab));
      }
    }
    return outros.filter((o) => !jaTemDono.has(chaveOab(o.numeroOab, o.ufOab)));
  }

  /**
   * ACRESCENTA à equipe; nunca tira, nunca promove.
   *
   * Tirar seria errado: o advogado pode ter atuado no começo do caso e o ato de
   * hoje não o citar. Promover mudaria o dono do caso, que é decisão de gente.
   */
  private async completarEquipe(
    processo: {
      id: string;
      advogados: { advogadoId: string }[];
      advogadosDispensados: { advogadoId: string }[];
    },
    nossos: string[],
  ): Promise<number> {
    const jaEsta = new Set(processo.advogados.map((a) => a.advogadoId));
    const dispensados = new Set(processo.advogadosDispensados.map((a) => a.advogadoId));
    const novos = nossos.filter((id) => !jaEsta.has(id) && !dispensados.has(id));
    if (!novos.length) return 0;

    const r = await this.prisma.processoAdvogado.createMany({
      data: novos.map((advogadoId) => ({
        processoId: processo.id,
        advogadoId,
        principal: false,
        origem: 'DJEN',
      })),
      skipDuplicates: true,
    });
    return r.count;
  }

  /**
   * OS ADVOGADOS DE FORA VÃO PARA A PARTE CONTRÁRIA — quando há uma só.
   *
   * O nosso lado é a parte com filiado ligado ou o próprio sindicato
   * (`institucional`) — a mesma regra que o cartão da agenda usa para dizer
   * "nós". Sem esse reconhecimento, ou com o sindicato nos dois polos, não há
   * "outro lado" para apontar, e o método não grava nada: o que ficou sem lado
   * é contado e aparece na tela como pendência de conferência.
   */
  private async gravarNaParteContraria(
    processo: {
      partes: {
        id: string;
        polo: string;
        nome: string;
        advogados: Prisma.JsonValue;
        filiadoId: string | null;
        parteExterna: { institucional: boolean } | null;
      }[];
    },
    outros: AdvogadoCitado[],
  ): Promise<{ naParte: number; semLado: number }> {
    if (!outros.length) return { naParte: 0, semLado: 0 };

    const nossoLado = processo.partes.filter((p) => p.filiadoId || p.parteExterna?.institucional);
    const polos = new Set(nossoLado.map((p) => p.polo));
    if (polos.size !== 1) return { naParte: 0, semLado: outros.length };

    const outroPolo = polos.has('ATIVO') ? 'PASSIVO' : 'ATIVO';
    const contrarias = processo.partes.filter((p) => p.polo === outroPolo);
    if (contrarias.length !== 1) return { naParte: 0, semLado: outros.length };

    const alvo = contrarias[0];
    const lista = mesclarAdvogadosDaParte(alvo.advogados, outros, new Date().toISOString());
    if (!lista) return { naParte: 0, semLado: 0 };

    await this.prisma.parteProcesso.update({
      where: { id: alvo.id },
      data: { advogados: lista as unknown as Prisma.InputJsonValue },
    });
    return { naParte: outros.length, semLado: 0 };
  }
}
