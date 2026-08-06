import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrigemSincronizacao, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CorrelacaoService } from './correlacao.service';
import { ComunicacaoDjenDto, DjenService } from './djen.service';
import { FONTE_DJEN, SincronizacaoLogService } from './sincronizacao-log.service';

/** Resumo de uma varredura, para o log e para a rota manual. */
export interface ResumoVarreduraDjen {
  advogadosConsultados: number;
  processosConsultados: number;
  recebidas: number;
  /** Publicações gravadas (as repetidas são ignoradas pelo hash único). */
  ingeridas: number;
  /** Descartadas por não haver processo cadastrado com aquele NPU. */
  descartadas: number;
  falhas: number;
}

/**
 * Varredura e ingestão das publicações do DJEN.
 *
 * ESTRATÉGIA — varre por OAB, ingere só o que já está cadastrado
 *
 * A consulta por OAB é o transporte eficiente: uma chamada por advogado traz as
 * publicações de todos os tribunais (verificado: 22 siglas distintas numa única
 * consulta). Consultar processo a processo custaria uma chamada por item do
 * acervo, todo dia.
 *
 * Mas o que a API devolve é a carteira INTEIRA daquele advogado, e o sindicato
 * acompanha o próprio acervo — não os processos particulares de quem trabalha
 * nele. Então tudo que não casa com um `Processo.numeroCNJ` cadastrado é
 * DESCARTADO na ingestão: não vira linha, não guarda texto, não guarda parte,
 * não guarda OAB. Fica só a contagem no log, para que o volume seja visível sem
 * que o dado de terceiro seja persistido.
 *
 * Complemento por NPU: processos ativos que não receberam publicação nenhuma
 * pela via da OAB são consultados diretamente. É o caso do processo herdado ou
 * do substabelecimento que o tribunal não registrou — a OAB do sindicato não
 * consta do polo, e sem esta segunda passada aquelas intimações nunca
 * apareceriam.
 */
@Injectable()
export class DjenSyncService {
  private readonly logger = new Logger(DjenSyncService.name);

  /**
   * Processo ativo sem nenhuma publicação casada nos últimos N dias entra na
   * consulta por NPU. Trinta dias é largo o bastante para não consultar o mesmo
   * processo toda noite e curto o bastante para não deixar um processo mudo
   * passar um trimestre sem verificação.
   */
  private readonly DIAS_SEM_PUBLICACAO = 30;

  /**
   * Teto de processos consultados um a um por rodada.
   *
   * A cota do CNJ é de 20 requisições por minuto, e o serviço se segura em 14.
   * Sem teto, a lista cresceria com o acervo até a rodada passar do prazo da
   * trava do job — e duas execuções começariam a se sobrepor.
   *
   * 300 por noite ≈ 22 minutos de consultas. Como a ordem é "quem foi
   * consultado há mais tempo primeiro", o acervo inteiro é coberto em poucas
   * noites, sem nunca deixar uma fatia esquecida. Ajustável por ambiente.
   */
  private readonly maxProcessosPorRodada: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly djen: DjenService,
    private readonly logSync: SincronizacaoLogService,
    private readonly correlacao: CorrelacaoService,
  ) {
    this.maxProcessosPorRodada =
      Number(this.config.get('DJEN_MAX_PROCESSOS_POR_RODADA')) || 300;
  }

  /**
   * Varredura completa: OAB de cada advogado ativo + complemento por NPU.
   *
   * `aguardar` é injetado pelo chamador para que a cadência (e o respiro entre
   * chamadas) fique com o cron, que é quem conhece o rate limit — e para que a
   * rota manual possa rodar sem espera.
   */
  async varrer(aguardar: () => Promise<void> = async () => {}): Promise<ResumoVarreduraDjen> {
    const resumo: ResumoVarreduraDjen = {
      advogadosConsultados: 0,
      processosConsultados: 0,
      recebidas: 0,
      ingeridas: 0,
      descartadas: 0,
      falhas: 0,
    };

    const ate = new Date();
    const de = new Date(ate.getTime() - this.djen.janelaDias * 24 * 3_600_000);

    // ---- 1) Por OAB de cada advogado ativo ----
    const advogados = await this.prisma.user.findMany({
      where: { ativo: true, oab: { not: null }, oabUf: { not: null } },
      select: { id: true, oab: true, oabUf: true },
    });

    for (const adv of advogados) {
      try {
        const recebidas = await this.djen.buscarPorOab(adv.oab!, adv.oabUf!, de, ate);
        resumo.advogadosConsultados++;
        resumo.recebidas += recebidas.length;
        const r = await this.ingerir(recebidas, OrigemSincronizacao.CRON);
        resumo.ingeridas += r.ingeridas;
        resumo.descartadas += r.descartadas;
      } catch (err) {
        resumo.falhas++;
        // Isola a falha: um advogado com OAB inválida não pode derrubar a
        // varredura dos demais.
        this.logger.warn(
          `[DJEN-SYNC] Falha na OAB ${adv.oab}/${adv.oabUf}: ${(err as Error).message}`,
        );
      }
      await aguardar();
    }

    // ---- 2) Complemento por NPU ----
    for (const proc of await this.processosSemPublicacaoRecente()) {
      try {
        const recebidas = await this.djen.buscarPorProcesso(proc.numeroCNJ!);
        resumo.processosConsultados++;
        resumo.recebidas += recebidas.length;
        const r = await this.ingerir(recebidas, OrigemSincronizacao.CRON);
        resumo.ingeridas += r.ingeridas;
        resumo.descartadas += r.descartadas;
        // Carimba mesmo quando não veio nada: o rodízio mede QUANDO olhamos,
        // não se achamos. Sem isto, um processo silencioso seria reconsultado
        // toda noite e empurraria os outros para fora da rodada.
        await this.prisma.processo.update({
          where: { id: proc.id },
          data: { ultimaConsultaDjen: new Date() },
        });
      } catch (err) {
        resumo.falhas++;
        this.logger.warn(`[DJEN-SYNC] Falha no NPU ${proc.numeroCNJ}: ${(err as Error).message}`);
      }
      await aguardar();
    }

    // ---- 3) Correlação de tudo que está pendente ----
    await this.correlacionarPendentes();

    this.logger.log(
      `[DJEN-SYNC] ${resumo.advogadosConsultados} advogado(s) + ${resumo.processosConsultados} processo(s) — ` +
        `${resumo.recebidas} recebida(s), ${resumo.ingeridas} gravada(s), ` +
        `${resumo.descartadas} descartada(s) (processo não cadastrado), ${resumo.falhas} falha(s).`,
    );
    return resumo;
  }

  /** Varredura de UM processo — usada pelo botão da ficha. */
  async sincronizarProcesso(processoId: string): Promise<{ ingeridas: number; recebidas: number }> {
    const proc = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { numeroCNJ: true },
    });
    if (!proc?.numeroCNJ) return { ingeridas: 0, recebidas: 0 };

    const recebidas = await this.djen.buscarPorProcesso(proc.numeroCNJ);
    const r = await this.ingerir(recebidas, OrigemSincronizacao.MANUAL);
    // Quem clicou no botão espera ver a atividade criada agora, não amanhã.
    await this.correlacao.aplicarAposDjen(processoId);
    return { ingeridas: r.ingeridas, recebidas: recebidas.length };
  }

  /**
   * Correlaciona toda publicação ainda sem classificação.
   *
   * POR QUE UMA PASSADA PRÓPRIA, E NÃO UMA CHAMADA POR LOTE INGERIDO
   * O `hash` é único: uma publicação entra no banco UMA vez. Se a correlação
   * dela falhasse no mesmo instante (banco instável, nenhum usuário ativo para
   * receber a tarefa), ela nunca mais faria parte de um lote novo — e ficaria
   * gravada, invisível, sem nunca virar atividade. Varrer o pendente torna a
   * falha temporária, e não permanente.
   *
   * Também cobre o caso em que dois advogados são intimados no mesmo processo:
   * a correlação roda uma vez, no fim, em vez de uma por advogado.
   */
  private async correlacionarPendentes(): Promise<void> {
    const desde = new Date(Date.now() - this.DIAS_SEM_PUBLICACAO * 24 * 3_600_000);
    const processos = await this.prisma.processo.findMany({
      where: {
        comunicacoes: {
          some: { providencia: null, dataDisponibilizacao: { gte: desde } },
        },
      },
      select: { id: true },
    });

    let criadas = 0;
    let enriquecidas = 0;
    for (const p of processos) {
      const r = await this.correlacao.aplicarAposDjen(p.id);
      criadas += r.criadas;
      enriquecidas += r.enriquecidas;
    }

    if (criadas || enriquecidas) {
      this.logger.log(
        `[DJEN-SYNC] Correlação: ${criadas} atividade(s) criada(s), ` +
          `${enriquecidas} enriquecida(s) com o teor da publicação.`,
      );
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Grava as publicações que pertencem a processos cadastrados; descarta o resto.
   *
   * A gravação usa `createMany` com `skipDuplicates` sobre o índice único de
   * `hash`. Isso torna a operação idempotente NO BANCO: reprocessar a mesma
   * janela — o que a varredura faz de propósito todo dia, para absorver fim de
   * semana e feriado — não duplica nada e não exige leitura prévia.
   */
  private async ingerir(
    comunicacoes: ComunicacaoDjenDto[],
    origem: OrigemSincronizacao,
  ): Promise<{ ingeridas: number; descartadas: number }> {
    if (!comunicacoes.length) return { ingeridas: 0, descartadas: 0 };

    // Uma consulta só resolve o casamento de todos os NPUs do lote.
    const npus = [...new Set(comunicacoes.map((c) => c.numeroProcesso))];
    const processos = await this.prisma.processo.findMany({
      where: { numeroCNJ: { in: npus } },
      select: {
        id: true,
        numeroCNJ: true,
        instancias: { select: { id: true, orgaoJulgador: true } },
      },
    });
    const porNpu = new Map(processos.map((p) => [p.numeroCNJ!, p]));

    const doAcervo = comunicacoes.filter((c) => porNpu.has(c.numeroProcesso));
    const descartadas = comunicacoes.length - doAcervo.length;
    if (!doAcervo.length) return { ingeridas: 0, descartadas };

    const linhas = doAcervo.map((c) => {
      const processo = porNpu.get(c.numeroProcesso)!;
      return {
        hash: c.hash,
        numeroProcesso: c.numeroProcesso,
        processoId: processo.id,
        instanciaId: this.casarInstancia(processo.instancias, c.nomeOrgao),
        siglaTribunal: c.siglaTribunal,
        tipoComunicacao: c.tipoComunicacao,
        tipoDocumento: c.tipoDocumento,
        nomeOrgao: c.nomeOrgao,
        nomeClasse: c.nomeClasse,
        meio: c.meio,
        link: c.link,
        texto: c.texto,
        dataDisponibilizacao: new Date(`${c.dataDisponibilizacao}T00:00:00Z`),
        destinatarios: c.destinatarios as unknown as Prisma.InputJsonValue,
        advogados: c.advogados as unknown as Prisma.InputJsonValue,
      };
    });

    const { count } = await this.prisma.comunicacaoDjen.createMany({
      data: linhas,
      skipDuplicates: true,
    });

    // Uma linha de log por processo que recebeu publicação NOVA — mesma
    // granularidade do lado DataJud, para o diagnóstico ser comparável.
    if (count > 0) {
      const porProcesso = new Map<string, { npu: string; tribunal: string; n: number }>();
      for (const c of doAcervo) {
        const p = porNpu.get(c.numeroProcesso)!;
        const atual = porProcesso.get(p.id) ?? {
          npu: c.numeroProcesso,
          tribunal: c.siglaTribunal,
          n: 0,
        };
        atual.n++;
        porProcesso.set(p.id, atual);
      }
      for (const [processoId, info] of porProcesso) {
        await this.logSync.registrar({
          processoId,
          numeroCNJ: info.npu,
          tribunal: info.tribunal,
          fonte: FONTE_DJEN,
          origem,
          sucesso: true,
          novasMovimentacoes: info.n,
        });
      }
    }

    return { ingeridas: count, descartadas };
  }

  /**
   * Casa a publicação com a instância pelo nome do órgão julgador.
   *
   * Comparação normalizada (sem acento, maiúsculas): o DJEN escreve "Vara Única
   * da Comarca de Simões" e o DataJud, "VARA ÚNICA DE SIMÕES" — nunca batem por
   * igualdade literal. Sem casamento devolve null, e a publicação fica
   * pendurada no processo: é degradação aceitável, o vínculo com a instância é
   * conveniência de exibição, não requisito.
   */
  private casarInstancia(
    instancias: { id: string; orgaoJulgador: string | null }[],
    nomeOrgao: string | null,
  ): string | null {
    if (!nomeOrgao || instancias.length === 0) return null;
    if (instancias.length === 1) return instancias[0].id;

    const alvo = normalizar(nomeOrgao);
    if (!alvo) return null;

    const exata = instancias.find((i) => normalizar(i.orgaoJulgador) === alvo);
    if (exata) return exata.id;

    // Contido: "VARA UNICA DE SIMOES" ⊂ "VARA UNICA DA COMARCA DE SIMOES".
    const parcial = instancias.find((i) => {
      const nome = normalizar(i.orgaoJulgador);
      return !!nome && (nome.includes(alvo) || alvo.includes(nome));
    });
    return parcial?.id ?? null;
  }

  /**
   * Processos ativos que não receberam publicação casada recentemente.
   *
   * Encerrados com instância viva entram também — mesma regra da varredura do
   * DataJud: a baixa é de um grau, não do processo.
   *
   * RODÍZIO: ordena por `ultimaConsultaDjen` com os NUNCA consultados primeiro,
   * e corta no teto da rodada. É o que mantém a duração previsível num acervo
   * que cresce — e o que garante que a fatia deixada para trás hoje seja a
   * primeira de amanhã, em vez de ficar no escuro para sempre.
   */
  private processosSemPublicacaoRecente() {
    const desde = new Date(Date.now() - this.DIAS_SEM_PUBLICACAO * 24 * 3_600_000);
    return this.prisma.processo.findMany({
      where: {
        numeroCNJ: { not: null },
        OR: [
          { statusInterno: { in: ['ATIVO', 'PENDENTE'] } },
          { statusInterno: 'ENCERRADO', instancias: { some: { baixada: false } } },
        ],
        comunicacoes: { none: { createdAt: { gte: desde } } },
      },
      select: { id: true, numeroCNJ: true },
      orderBy: { ultimaConsultaDjen: { sort: 'asc', nulls: 'first' } },
      take: this.maxProcessosPorRodada,
    });
  }
}

/** MAIÚSCULAS sem acento, espaços colapsados — para comparar nome de órgão. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[^\x00-\x7F]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
