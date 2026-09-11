import { Injectable, Logger } from '@nestjs/common';
import { OrigemSincronizacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SincronizacaoLogService } from '../processos/sincronizacao-log.service';
import { SiconfiService, SiconfiIndisponivelError } from './siconfi.service';
import { pareceCodigoIBGE } from './chave-de-ente.util';
import { tenant } from '../../tenant/tenant.config';

/** A coluna `fonte` do log é TEXTO justamente para caber uma fonte nova sem migração. */
export const FONTE_SICONFI = 'SICONFI';

export interface ResultadoSync {
  municipios: number;
  comPessoal: number;
  comSaude: number;
  semPublicacao: number;
  falhas: number;
  duracaoMs: number;
}

/**
 * TRAZER OS INDICADORES DO TESOURO PARA DENTRO DO BANCO.
 *
 * QUAIS MUNICÍPIOS. Os que o sindicato realmente toca — quem tem filiado,
 * organização ou processo. Medido na produção em 10/09/2026: são 72, dos 5.571
 * do catálogo. Varrer o Brasil inteiro seriam 11 mil chamadas para alimentar uma
 * tela que ninguém abriria, e o Tesouro não merece isso.
 *
 * COM QUE FREQUÊNCIA. O RGF é quadrimestral e o RREO bimestral: o dado muda de
 * dois em dois meses, no melhor caso. Um job diário que refaz tudo seria 99% de
 * requisição repetida. Por isso a varredura só pega quem está DEFASADO, com
 * teto por rodada — a base inteira se renova em poucos dias e depois o job passa
 * quase todo dia sem fazer nada.
 *
 * O QUE NÃO SE FAZ AQUI: corrigir o número declarado. Se o município informou
 * uma folha maior que a receita, é isso que fica gravado. Quem classifica é
 * `leitura-fiscal.util.ts`, na LEITURA — a mesma regra que vale para o log de
 * auditoria: registro não se reescreve.
 */
@Injectable()
export class SiconfiSyncService {
  private readonly logger = new Logger(SiconfiSyncService.name);

  /**
   * Depois de quantos dias um indicador merece nova consulta. Vinte e cinco
   * cobre o pior caso do RREO (bimestral) sem perseguir dado que não mudou.
   */
  private static readonly DIAS_ATE_DEFASAR = 25;
  /** Teto por rodada, para o job da madrugada não virar uma varredura longa. */
  private static readonly POR_RODADA = 30;
  /** Respiro entre municípios — a API é pública e gratuita; não se abusa. */
  private static readonly PAUSA_MS = 250;

  constructor(
    private readonly prisma: PrismaService,
    private readonly siconfi: SiconfiService,
    private readonly log: SincronizacaoLogService,
  ) {}

  /**
   * OS MUNICÍPIOS QUE INTERESSAM — pelas três portas por onde um município
   * entra na vida do sindicato.
   *
   * O `JOIN` com o catálogo não é enfeite: é ele que descarta código inválido.
   * Medido na produção, `processos.municipio_ibge` traz 24 códigos distintos e
   * UM deles (`5149`, em 2 processos) não existe no IBGE — é código interno de
   * serventia que o DataJud devolveu no lugar do código do município. Sem o
   * filtro, esse número seria consultado no Tesouro, que responderia 200 com o
   * conteúdo de outro ente.
   */
  async codigosDeInteresse(): Promise<number[]> {
    const [filiados, partes, processos] = await Promise.all([
      this.prisma.filiado.findMany({
        where: { municipioCodigo: { not: null } },
        select: { municipioCodigo: true },
        distinct: ['municipioCodigo'],
      }),
      this.prisma.parteExterna.findMany({
        where: { enteCodigo: { not: null } },
        select: { enteCodigo: true },
        distinct: ['enteCodigo'],
      }),
      this.prisma.processo.findMany({
        where: { municipioIBGE: { not: null } },
        select: { municipioIBGE: true },
        distinct: ['municipioIBGE'],
      }),
    ]);

    const brutos = new Set<number>();
    for (const f of filiados) if (f.municipioCodigo) brutos.add(f.municipioCodigo);
    for (const p of partes) if (p.enteCodigo) brutos.add(p.enteCodigo);
    for (const p of processos) if (pareceCodigoIBGE(p.municipioIBGE)) brutos.add(p.municipioIBGE!);

    /*
      O ESTADO DA CASA E A UNIÃO ENTRAM SEMPRE, sem depender de ligação.

      Eles são contraparte permanente: o Estado do Piauí é o segundo maior
      empregador do cadastro (42 vínculos) e figura em 10 processos. Antes
      disto havia um nó: o Estado só entraria na varredura se alguma
      organização estivesse ligada a ele, e a ligação só ficaria interessante
      depois de ele ter indicador. A ficha dele ficava permanentemente vazia,
      dizendo que "não publicou" — sobre um ente que publica todo quadrimestre.
    */
    const permanentes = await this.prisma.ente.findMany({
      where: {
        OR: [{ esfera: 'E', uf: (tenant.endereco?.uf ?? '').toUpperCase() }, { esfera: 'U' }],
      },
      select: { codigo: true },
    });
    for (const e of permanentes) brutos.add(e.codigo);

    if (!brutos.size) return [];
    const existentes = await this.prisma.ente.findMany({
      where: { codigo: { in: [...brutos] } },
      select: { codigo: true },
    });
    return existentes.map((m) => m.codigo);
  }

  /**
   * QUEM MERECE NOVA CONSULTA — pelo CARIMBO da consulta, não pela existência
   * de indicador.
   *
   * A primeira versão olhava `indicadorPessoalEnte.updatedAt`. Quem não publica
   * nunca ganha linha de indicador, então os 14 entes que não publicam eram
   * reconsultados TODA noite, para sempre, e ainda ocupavam o teto da rodada no
   * lugar de quem tinha dado novo. Com o carimbo, quem foi perguntado ontem fica
   * quieto por 25 dias mesmo tendo respondido vazio.
   */
  private async defasados(codigos: number[], agora: Date, comTeto: boolean): Promise<number[]> {
    if (!codigos.length) return [];
    const corte = new Date(agora.getTime() - SiconfiSyncService.DIAS_ATE_DEFASAR * 86_400_000);
    const emDia = await this.prisma.ente.findMany({
      where: { codigo: { in: codigos }, siconfiConsultadoEm: { gte: corte } },
      select: { codigo: true },
    });
    const quietos = new Set(emDia.map((e) => e.codigo));
    const fila = codigos.filter((c) => !quietos.has(c));
    /*
      O TETO É DO JOB DA MADRUGADA, não de quem clicou.

      Ele existe para o cron não virar uma varredura longa: a base se renova em
      poucas noites e depois o job passa quase todo dia sem fazer nada. Mas quem
      aperta "atualizar do Tesouro" espera que atualize — receber "30 de 71" e
      ter de clicar três vezes é a tela mentindo sobre o que o botão faz.
    */
    return comTeto ? fila.slice(0, SiconfiSyncService.POR_RODADA) : fila;
  }
  /**
   * A VARREDURA. `codigosExplicitos` vem do botão "atualizar agora" da tela; sem
   * ele, o job escolhe sozinho quem está defasado.
   */
  async sincronizar(
    origem: OrigemSincronizacao,
    codigosExplicitos?: number[],
    agora = new Date(),
  ): Promise<ResultadoSync> {
    const inicio = Date.now();
    const alvo = codigosExplicitos?.length
      ? codigosExplicitos
      : await this.defasados(
          await this.codigosDeInteresse(),
          agora,
          origem === OrigemSincronizacao.CRON,
        );

    const r: ResultadoSync = {
      municipios: alvo.length,
      comPessoal: 0,
      comSaude: 0,
      semPublicacao: 0,
      falhas: 0,
      duracaoMs: 0,
    };

    for (const codigo of alvo) {
      try {
        const [pessoal, saude] = await Promise.all([
          this.siconfi.pessoal(codigo, agora),
          this.siconfi.saude(codigo, agora),
        ]);

        if (pessoal) {
          r.comPessoal += 1;
          await this.prisma.indicadorPessoalEnte.upsert({
            where: {
              enteCodigo_exercicio_quadrimestre: {
                enteCodigo: codigo,
                exercicio: pessoal.exercicio,
                quadrimestre: pessoal.quadrimestre,
              },
            },
            create: {
              enteCodigo: codigo,
              exercicio: pessoal.exercicio,
              quadrimestre: pessoal.quadrimestre,
              percentualRcl: pessoal.percentualRcl,
              limiteMaximo: pessoal.limiteMaximo,
              limitePrudencial: pessoal.limitePrudencial,
              limiteAlerta: pessoal.limiteAlerta,
              despesaPessoal: pessoal.despesaPessoal,
              receitaCorrenteLiquida: pessoal.receitaCorrenteLiquida,
            },
            update: {
              percentualRcl: pessoal.percentualRcl,
              limiteMaximo: pessoal.limiteMaximo,
              limitePrudencial: pessoal.limitePrudencial,
              limiteAlerta: pessoal.limiteAlerta,
              despesaPessoal: pessoal.despesaPessoal,
              receitaCorrenteLiquida: pessoal.receitaCorrenteLiquida,
            },
          });
        }

        if (saude) {
          r.comSaude += 1;
          await this.prisma.indicadorSaudeEnte.upsert({
            where: {
              enteCodigo_exercicio_bimestre: {
                enteCodigo: codigo,
                exercicio: saude.exercicio,
                bimestre: saude.bimestre,
              },
            },
            create: {
              enteCodigo: codigo,
              exercicio: saude.exercicio,
              bimestre: saude.bimestre,
              percentualDespesa: saude.percentualDespesa,
              despesaLiquidada: saude.despesaLiquidada,
            },
            update: {
              percentualDespesa: saude.percentualDespesa,
              despesaLiquidada: saude.despesaLiquidada,
            },
          });
        }

        if (!pessoal && !saude) r.semPublicacao += 1;

        /*
          O CARIMBO DA CONSULTA VAI SEMPRE, tenha vindo dado ou não. É ele que
          separa "o ente não publicou" de "ainda não perguntamos" — sem ele as
          duas situações são a mesma ausência de linha, e a tela acaba acusando
          o ente de uma falha que é nossa.
        */
        await this.prisma.ente.update({
          where: { codigo },
          data: { siconfiConsultadoEm: agora },
        });

        /*
          A POPULAÇÃO vem de carona nos dois relatórios e é a única fonte dela
          aqui: o catálogo de localidades do IBGE não publica população. Só
          escreve quando veio número — não se apaga o que já se sabia porque a
          consulta desta vez voltou vazia.
        */
        const populacao = pessoal?.populacao ?? saude?.populacao ?? null;
        if (populacao) {
          await this.prisma.ente.update({
            where: { codigo },
            data: { populacao, populacaoAno: pessoal?.exercicio ?? saude?.exercicio ?? null },
          });
        }
      } catch (e) {
        r.falhas += 1;
        const erro = e as SiconfiIndisponivelError;
        this.logger.warn(`[SICONFI] Falha no município ${codigo}: ${erro?.message ?? e}`);
        await this.log.registrar({
          fonte: FONTE_SICONFI,
          origem,
          sucesso: false,
          httpStatus: erro?.statusUpstream ?? null,
          mensagemErro: `município ${codigo}: ${erro?.message ?? String(e)}`,
        });
      }

      if (SiconfiSyncService.PAUSA_MS > 0) {
        await new Promise((ok) => setTimeout(ok, SiconfiSyncService.PAUSA_MS));
      }
    }

    r.duracaoMs = Date.now() - inicio;

    /*
      A LINHA DE RESUMO vai SEMPRE, mesmo com zero municípios. É o que distingue
      "a varredura rodou e não havia nada defasado" de "a varredura não rodou" —
      sem ela, as duas coisas ficam idênticas no log da manhã seguinte.
    */
    await this.log.registrar({
      fonte: FONTE_SICONFI,
      origem,
      sucesso: r.falhas === 0,
      novasMovimentacoes: r.comPessoal + r.comSaude,
      duracaoMs: r.duracaoMs,
      mensagemErro: r.falhas ? `${r.falhas} de ${r.municipios} municípios falharam` : null,
    });

    if (r.municipios > 0) {
      this.logger.log(
        `[SICONFI] ${r.municipios} municípios: ${r.comPessoal} com despesa de pessoal, ` +
          `${r.comSaude} com função saúde, ${r.semPublicacao} sem publicação, ` +
          `${r.falhas} falhas — ${Math.round(r.duracaoMs / 1000)}s.`,
      );
    }
    return r;
  }
}
