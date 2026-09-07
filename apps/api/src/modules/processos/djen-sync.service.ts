import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrigemSincronizacao, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CorrelacaoService } from './correlacao.service';
import { ComunicacaoDjenDto, DjenService } from './djen.service';
import { FONTE_DJEN, SincronizacaoLogService } from './sincronizacao-log.service';
import { classificarProvidencia } from './utils/providencia.util';
import { nossoPoloNoAto, type PoloDetectado } from './utils/acao-nossa.util';

/** Resumo de uma varredura, para o log e para a rota manual. */
export interface ResumoVarreduraDjen {
  advogadosConsultados: number;
  processosConsultados: number;
  recebidas: number;
  /** Publicações gravadas (as repetidas são ignoradas pelo hash único). */
  ingeridas: number;
  /** Descartadas por não haver processo cadastrado com aquele NPU. */
  descartadas: number;
  /**
   * Das descartadas, quantas eram AÇÕES NOSSAS ainda sem cadastro.
   *
   * Fica no resumo porque é o único lugar onde o volume aparece: a publicação
   * de terceiro não é persistida, e sem este número ninguém saberia dizer se a
   * detecção está achando alguma coisa.
   */
  sugeridas: number;
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
  /**
   * A VARREDURA, com a garantia de deixar rastro até quando quebra.
   *
   * O resumo é gravado num `finally`: se `varrer` estourar no meio — banco
   * fora, correlação com defeito — a rodada teria acontecido e o log ficaria
   * vazio, e a tela diria "não rodou" sobre uma rodada que rodou e explodiu.
   * Seria trocar um diagnóstico errado por outro.
   */
  async varrer(
    aguardar: () => Promise<void> = async () => {},
    origem: OrigemSincronizacao = OrigemSincronizacao.CRON,
  ): Promise<ResumoVarreduraDjen> {
    const iniciadaEm = Date.now();
    const resumo: ResumoVarreduraDjen = {
      advogadosConsultados: 0,
      processosConsultados: 0,
      recebidas: 0,
      ingeridas: 0,
      descartadas: 0,
      sugeridas: 0,
      falhas: 0,
    };
    let quebrou: string | null = null;
    try {
      await this.executarVarredura(resumo, aguardar);
    } catch (err) {
      quebrou = (err as Error).message;
      throw err;
    } finally {
      await this.registrarResumo(resumo, origem, iniciadaEm, quebrou);
    }
    return resumo;
  }

  private async executarVarredura(
    resumo: ResumoVarreduraDjen,
    aguardar: () => Promise<void>,
  ): Promise<void> {
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
        resumo.sugeridas += r.sugeridas;
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
        resumo.sugeridas += r.sugeridas;
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
        `${resumo.descartadas} descartada(s) (processo não cadastrado, ` +
        `${resumo.sugeridas} sugerida(s) para cadastro), ${resumo.falhas} falha(s).`,
    );
  }

  /** Varredura de UM processo — usada pelo botão da ficha. */
  async sincronizarProcesso(processoId: string): Promise<{ ingeridas: number; recebidas: number }> {
    const proc = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { numeroCNJ: true },
    });
    if (!proc?.numeroCNJ) return { ingeridas: 0, recebidas: 0 };

    // `false` = não esperar a cota virar. Quem clicou está olhando a tela;
    // prender o botão por até um minuto é pior que dizer "tente em 40s".
    const recebidas = await this.djen.buscarPorProcesso(proc.numeroCNJ, false);
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

    await this.rotularForaDaJanela();
  }

  /**
   * O HISTÓRICO TAMBÉM PRECISA DE RÓTULO — e ele nunca passava pelo robô.
   *
   * A consulta por NPU traz o processo INTEIRO: a varredura de 04/09/2026 subiu
   * o acervo de 136 para 1.399 publicações, e 1.209 delas são de antes da
   * janela de 30 dias. Como `aplicarAposDjen` só olha os últimos 30 dias, essas
   * ficavam com `providencia` NULA para sempre — 86% da tela de Publicações sem
   * dizer do que trata cada ato, e o filtro por providência devolvendo quase
   * nada.
   *
   * ISTO NÃO CRIA TAREFA, e a garantia é estrutural, não uma promessa:
   *
   *  - `aplicarAposDjen` filtra `providencia: null`; ao rotular, a publicação
   *    deixa de ser candidata a virar atividade. Por isso só se rotula o que
   *    está FORA da janela — dentro dela, tirar o nulo seria roubar do robô uma
   *    publicação que ele ainda ia processar.
   *  - `parearAtrasadas` só grava `movimentacaoId`, e também só dentro da
   *    janela.
   *
   * É classificação para LEITURA, portanto. A que gera trabalho continua sendo
   * uma só, na passada normal.
   */
  private async rotularForaDaJanela(): Promise<void> {
    const desde = new Date(Date.now() - this.DIAS_SEM_PUBLICACAO * 24 * 3_600_000);
    const antigas = await this.prisma.comunicacaoDjen.findMany({
      where: { providencia: null, dataDisponibilizacao: { lt: desde } },
      select: { id: true, texto: true, tipoComunicacao: true },
      // Teto por passada: a primeira carga de um acervo grande não pode virar
      // uma transação de horas. O que sobrar entra amanhã.
      take: 2_000,
    });
    if (!antigas.length) return;

    let rotuladas = 0;
    for (const c of antigas) {
      const { providencia } = classificarProvidencia(c.texto, c.tipoComunicacao);
      await this.prisma.comunicacaoDjen.update({
        where: { id: c.id },
        data: { providencia },
      });
      rotuladas++;
    }
    this.logger.log(
      `[DJEN-SYNC] ${rotuladas} publicação(ões) do histórico classificada(s) para leitura ` +
        '(fora da janela de tarefa).',
    );
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
  /**
   * A SIGLA DO SINDICATO, LIDA DO CADASTRO E NÃO DE UMA CONSTANTE.
   *
   * São dois clientes no mesmo código. A parte marcada `institucional` guarda
   * `nomeFantasia = tenant.sigla`, e é ela que o resto do módulo já usa para
   * responder "somos nós?". Cacheada por rodada: a varredura chama a ingestão
   * uma vez por advogado, e a sigla não muda no meio.
   */
  private siglaCache: { valor: string | null; em: number } | null = null;

  private async siglaDoSindicato(): Promise<string | null> {
    const UMA_HORA = 3_600_000;
    if (this.siglaCache && Date.now() - this.siglaCache.em < UMA_HORA) {
      return this.siglaCache.valor;
    }
    const institucional = await this.prisma.parteExterna.findFirst({
      where: { institucional: true },
      select: { nomeFantasia: true },
    });
    this.siglaCache = { valor: institucional?.nomeFantasia ?? null, em: Date.now() };
    return this.siglaCache.valor;
  }

  /**
   * AS PUBLICAÇÕES QUE SÃO NOSSAS MAS NÃO ESTÃO CADASTRADAS.
   *
   * Recebe o que seria descartado e guarda apenas o que nomeia o sindicato
   * entre os destinatários. O texto do ato NÃO é guardado: para decidir se vale
   * cadastrar bastam o número, o tribunal, a classe e quem está de cada lado.
   * Guardar o teor de um processo que ainda não é nosso seria persistir mais do
   * que a decisão exige.
   *
   * `upsert` por NPU: a mesma ação aparece em várias publicações e em várias
   * rodadas, e não pode virar dez linhas na fila.
   */
  private async sugerirAcoesNossas(foraDoAcervo: ComunicacaoDjenDto[]): Promise<number> {
    if (!foraDoAcervo.length) return 0;
    const sigla = await this.siglaDoSindicato();
    if (!sigla) return 0;

    /*
      Agrupa por NPU ANTES de escrever: um lote traz várias publicações do mesmo
      processo, e dez `upsert` na mesma linha só gastam banco.
    */
    const porNpu = new Map<
      string,
      { c: ComunicacaoDjenDto; polo: PoloDetectado; n: number; de: Date; ate: Date }
    >();

    for (const c of foraDoAcervo) {
      const polo = nossoPoloNoAto(c.destinatarios, sigla);
      if (!polo) continue;
      const quando = new Date(`${c.dataDisponibilizacao}T00:00:00Z`);
      const atual = porNpu.get(c.numeroProcesso);
      if (atual) {
        atual.n++;
        if (quando < atual.de) atual.de = quando;
        if (quando > atual.ate) atual.ate = quando;
      } else {
        porNpu.set(c.numeroProcesso, { c, polo, n: 1, de: quando, ate: quando });
      }
    }
    if (!porNpu.size) return 0;

    let novas = 0;
    for (const [numeroCNJ, item] of porNpu) {
      /*
        A DECISÃO DE QUEM JÁ OLHOU NÃO SE DESFAZ SOZINHA. Se alguém ignorou esta
        ação, uma publicação nova amanhã não pode devolvê-la à fila — seria o
        sistema discutindo com a pessoa. O contador sobe; o status, não.
      */
      const criada = await this.prisma.sugestaoProcesso.upsert({
        where: { numeroCNJ },
        create: {
          numeroCNJ,
          siglaTribunal: item.c.siglaTribunal ?? null,
          nomeOrgao: item.c.nomeOrgao ?? null,
          nomeClasse: item.c.nomeClasse ?? null,
          nossoPolo: item.polo,
          partes: (item.c.destinatarios ?? null) as unknown as Prisma.InputJsonValue,
          advogados: (item.c.advogados ?? null) as unknown as Prisma.InputJsonValue,
          primeiraEm: item.de,
          ultimaEm: item.ate,
          publicacoes: item.n,
        },
        update: {
          publicacoes: { increment: item.n },
          ultimaEm: item.ate,
          /*
            O POLO SÓ MELHORA, nunca piora. A primeira publicação de um recurso
            pode listar só um lado e a seguinte listar os dois; o contrário
            também acontece. Sobrescrever com `INDEFINIDO` apagaria informação
            que já tínhamos.
          */
          ...(item.polo !== 'INDEFINIDO' ? { nossoPolo: item.polo } : {}),
        },
        select: { createdAt: true, updatedAt: true },
      });
      if (criada.createdAt.getTime() === criada.updatedAt.getTime()) novas++;
    }

    if (novas > 0) {
      this.logger.log(
        `[DJEN] ${novas} ação(ões) do ${sigla} encontrada(s) no Diário sem cadastro no acervo.`,
      );
    }
    return novas;
  }

  private async ingerir(
    comunicacoes: ComunicacaoDjenDto[],
    origem: OrigemSincronizacao,
  ): Promise<{ ingeridas: number; descartadas: number; sugeridas: number }> {
    if (!comunicacoes.length) return { ingeridas: 0, descartadas: 0, sugeridas: 0 };

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
    const foraDoAcervo = comunicacoes.filter((c) => !porNpu.has(c.numeroProcesso));
    const descartadas = foraDoAcervo.length;

    /*
      ANTES DE DESCARTAR, PERGUNTA SE É NOSSO.

      O que não casa com um processo cadastrado é descartado — e isso continua
      certo: a consulta por OAB devolve a carteira INTEIRA do advogado, e a
      causa particular dele não é assunto do sindicato.

      Só que junto ia o caso NOVO do próprio sindicato: ação recém-distribuída em
      que um dos nossos já está no polo, ainda sem cadastro aqui. O Diário
      anunciava e nós jogávamos fora. Agora ela vira SUGESTÃO.

      O filtro segue estreito: só quando o sindicato figura entre os
      destinatários. Nada de terceiro é persistido — a decisão de privacidade
      continua de pé, e o que sobra é exatamente o que é nosso.
    */
    const sugeridas = await this.sugerirAcoesNossas(foraDoAcervo);

    if (!doAcervo.length) return { ingeridas: 0, descartadas, sugeridas };

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
      const porProcesso = new Map<
        string,
        { npu: string; tribunal: string; n: number; publicadaEm: Date }
      >();
      for (const c of doAcervo) {
        const p = porNpu.get(c.numeroProcesso)!;
        const atual = porProcesso.get(p.id) ?? {
          npu: c.numeroProcesso,
          tribunal: c.siglaTribunal,
          n: 0,
          publicadaEm: new Date(0),
        };
        atual.n++;
        const quando = new Date(`${c.dataDisponibilizacao}T00:00:00Z`);
        if (quando > atual.publicadaEm) atual.publicadaEm = quando;
        porProcesso.set(p.id, atual);
      }

      /*
        A PUBLICAÇÃO TAMBÉM MOVE A ORDENAÇÃO.

        `ultimo_movimento_em` é a coluna que ordena "Movimentação recente", e ela
        era mantida só pelo gatilho das notas internas e pelo lado DataJud. O
        Diário não a tocava — medido em 07/09/2026: **37 processos tinham
        publicação mais nova do que a própria coluna que os ordena**, e um
        processo publicado anteontem aparecia abaixo de outro parado desde
        julho, na tela cujo nome é "movimentação recente".

        `updateMany` com `lt` no lugar de um `update` seco: a coluna SÓ AVANÇA.
        Uma publicação antiga que chegue atrasada na varredura não pode puxar o
        processo para trás.
      */
      for (const [processoId, info] of porProcesso) {
        await this.prisma.processo.updateMany({
          where: {
            id: processoId,
            OR: [{ ultimoMovimentoEm: null }, { ultimoMovimentoEm: { lt: info.publicadaEm } }],
          },
          data: { ultimoMovimentoEm: info.publicadaEm },
        });
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

    return { ingeridas: count, descartadas, sugeridas };
  }

  /**
   * A RODADA GRAVA QUE ELA ACONTECEU — mesmo sem trazer nada, mesmo quebrando.
   *
   * Este log só ganhava linha quando havia publicação NOVA para gravar (uma por
   * processo contemplado). Numa varredura de fim de semana, quando o Diário não
   * circula, a rodada corria inteira, consultava as oito OABs, não achava nada —
   * e não deixava rastro nenhum.
   *
   * A tela lia "nenhuma consulta bem-sucedida em 48h" e anunciava a integração
   * como PARADA, em vermelho. Foi o que o usuário viu num domingo à noite: as
   * 1.408 publicações do acervo não têm UMA de sábado ou domingo, e mesmo assim
   * o painel acusava defeito.
   *
   * O DataJud sempre registrou toda tentativa, frutífera ou não. Isto devolve a
   * simetria: uma linha por rodada, sem NPU — ela fala da rodada, não de um
   * processo.
   */
  private async registrarResumo(
    resumo: ResumoVarreduraDjen,
    origem: OrigemSincronizacao,
    iniciadaEm: number,
    quebrou: string | null,
  ): Promise<void> {
    /*
      TENTATIVAS, e não consultas BEM-SUCEDIDAS.

      Eu somava `advogadosConsultados + processosConsultados`, e os dois só são
      incrementados quando a chamada VOLTA. Rodando de verdade contra uma rede
      onde o CNJ recusa tudo, o resultado foi uma linha dizendo "varredura sem
      alvo" depois de 14 minutos consultando — a mensagem exata que se escreve
      para "não havia o que consultar". Só apareceu porque eu rodei.
    */
    const tentativas =
      resumo.advogadosConsultados + resumo.processosConsultados + resumo.falhas;
    const tudoFalhou = tentativas > 0 && resumo.falhas === tentativas;
    await this.logSync.registrar({
      fonte: FONTE_DJEN,
      origem,
      // Uma rodada em que TUDO falhou não é bem-sucedida. Uma que consultou e
      // não achou nada é — e é o caso normal de fim de semana.
      sucesso: !quebrou && tentativas > 0 && !tudoFalhou,
      novasMovimentacoes: resumo.ingeridas,
      duracaoMs: Date.now() - iniciadaEm,
      mensagemErro: quebrou
        ? `Varredura interrompida: ${quebrou}`
        : tentativas === 0
          ? 'Varredura sem alvo: nenhum advogado com OAB e nenhum processo elegível.'
          : tudoFalhou
            ? `Varredura sem resposta: as ${tentativas} consulta(s) falharam.`
            : resumo.falhas > 0
              ? `Varredura concluída com ${resumo.falhas} de ${tentativas} consulta(s) em falha.`
              : `Varredura concluída: ${tentativas} consulta(s), ${resumo.ingeridas} publicação(ões) nova(s)` +
                // A ação nossa ainda sem cadastro só é mensurável aqui: a publicação
                // de terceiro não é persistida, então sem esta frase ninguém saberia
                // se a detecção achou algo. Só aparece quando achou.
                (resumo.sugeridas > 0
                  ? `, ${resumo.sugeridas} ação(ões) nossa(s) sem cadastro.`
                  : '.'),
    });
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
