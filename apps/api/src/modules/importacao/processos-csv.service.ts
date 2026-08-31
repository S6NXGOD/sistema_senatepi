import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PerfilImportacao, StatusImportacao, TipoParteExterna } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ProcessosService } from '../processos/processos.service';
import { lerPlanilha } from './planilha.util';
import {
  avisoDeCompletar,
  conferirPlanilha,
  oQueCompletar,
  type EstadoNoBanco,
  type LinhaProcesso,
} from './processos-csv.util';

interface Ctx {
  userId?: string;
  nome?: string;
  ip?: string;
}

/** Escolhas de quem confirma a importação — ver `ConfirmarImportacaoProcessosDto`. */
export interface OpcoesImportacao {
  criarTarefasDePrazo?: boolean;
}

/**
 * IMPORTAÇÃO DE PROCESSOS EM LOTE.
 *
 * POR QUE ELA EXISTE. O acervo do jurídico vivia numa planilha de 82 linhas, e
 * a única porta de entrada do sistema era o diálogo de um processo por vez —
 * oitenta e duas vezes, à mão, cada uma esperando o CNJ responder.
 *
 * O QUE ELA **NÃO** FAZ, e é o ponto do desenho: ela não escreve processo no
 * banco. Ela chama `ProcessosService.importar`, o MESMO caminho do botão
 * "Importar Processo" — que consulta o DataJud, grava as instâncias, os
 * andamentos, dispara o robô de prazos e a auditoria. Um importador que
 * escrevesse direto criaria oitenta cascas vazias, sem movimento e sem
 * histórico, e ninguém descobriria até abrir a primeira ficha.
 *
 * POR QUE EM SEGUNDO PLANO. São 80+ consultas ao CNJ, com pausa de 2–3s e
 * resposta que já foi medida em 10 a 25 segundos. Quarenta minutos não cabem
 * num request HTTP. O padrão é o mesmo dos outros importadores do módulo:
 * `void this.executar(...)`, status `IMPORTANDO` no banco, e a tela perguntando
 * de tempos em tempos como vai.
 *
 * O QUE ACONTECE COM O QUE FALHA: nada além de ficar registrado. Uma linha que
 * o CNJ recusa não interrompe as outras — o resultado é uma lista do que entrou
 * e do que não entrou, com o motivo, para a equipe resolver as exceções à mão.
 */
@Injectable()
export class ProcessosCsvService {
  private readonly logger = new Logger(ProcessosCsvService.name);

  /**
   * Cadência com o CNJ — a mesma da varredura noturna.
   *
   * A cota da API pública é compartilhada e sensível a rajada. Importar 80
   * processos o mais rápido possível é o jeito mais garantido de levar 429 no
   * meio e terminar com metade do acervo dentro.
   */
  private readonly PAUSA_MIN = 2000;
  private readonly PAUSA_MAX = 3000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processos: ProcessosService,
  ) {}

  // ==========================================================================
  // 1) Upload e conferência
  // ==========================================================================

  async processarUpload(file: { originalname: string; buffer: Buffer }, ctx: Ctx) {
    const planilha = await lerPlanilha(file);
    const { linhas, problemasNoArquivo } = conferirPlanilha(planilha.cabecalhos, planilha.linhas);

    if (problemasNoArquivo.some((p) => p.startsWith('Falta a coluna'))) {
      throw new BadRequestException(problemasNoArquivo.join(' '));
    }

    /**
     * A CONFERÊNCIA CONTRA O BANCO acontece aqui, e não no util: quais NPUs já
     * estão cadastrados, quais advogados existem, quais réus já têm registro.
     * São perguntas ao Prisma, e mantê-las fora do util é o que deixa as
     * regras de formato testáveis sem subir meio módulo.
     */
    const npus = linhas.map((l) => l.npu).filter(Boolean);
    const existentes = await this.prisma.processo.findMany({
      where: { numeroCNJ: { in: npus } },
      select: { id: true, numeroCNJ: true, categoria: true, etiquetas: true },
    });
    const jaCadastrados = new Set(existentes.map((p) => p.numeroCNJ!));

    /**
     * As notas já gravadas entram na conferência para a prévia saber se o
     * ANDAMENTO da planilha é novidade ou repetição. Uma consulta só para o
     * lote inteiro — 82 consultas individuais numa tela que a pessoa está
     * olhando seria trocar a resposta imediata por meio minuto de espera.
     */
    const notas = existentes.length
      ? await this.prisma.movimentacaoInterna.findMany({
          where: { processoId: { in: existentes.map((p) => p.id) } },
          select: { processoId: true, descricao: true },
        })
      : [];
    const notasPorProcesso = new Map<string, string[]>();
    for (const n of notas) {
      const lista = notasPorProcesso.get(n.processoId) ?? [];
      lista.push(n.descricao ?? '');
      notasPorProcesso.set(n.processoId, lista);
    }
    const estadoPorNpu = new Map<string, EstadoNoBanco>(
      existentes.map((p) => [
        p.numeroCNJ!,
        {
          categoria: p.categoria,
          etiquetas: p.etiquetas ?? [],
          andamentos: notasPorProcesso.get(p.id) ?? [],
        },
      ]),
    );

    const emails = [...new Set(linhas.flatMap((l) => [l.advogadoEmail, ...l.equipeEmails]).filter(Boolean))];
    const usuarios = await this.prisma.user.findMany({
      where: { email: { in: emails }, ativo: true },
      select: { email: true },
    });
    const emailsConhecidos = new Set(usuarios.map((u) => u.email.toLowerCase()));

    let aCompletar = 0;
    let jaCompletos = 0;
    for (const l of linhas) {
      if (l.npu && jaCadastrados.has(l.npu)) {
        /**
         * NÃO é erro, e — desde a correção de 31/08/2026 — também não é
         * "pulada". A linha já cadastrada COMPLETA o que estiver vazio no
         * processo, e o aviso passa a dizer exatamente o quê.
         *
         * O texto antigo ("esta linha será pulada") virou mentira quando a
         * segunda passada ganhou o `completarExistente`, e mentira na prévia
         * é o pior tipo: foi ela que fez a tela desabilitar o botão de
         * importar quando TODAS as linhas já existiam, deixando o único
         * caminho para completar o acervo inalcançável.
         */
        const faltas = oQueCompletar(
          estadoPorNpu.get(l.npu) ?? { categoria: null, etiquetas: [], andamentos: [] },
          l,
        );
        /**
         * A linha já completa não ganha aviso — e é de propósito. A lista da
         * prévia mostra "linhas com algo a conferir"; encher as 82 com "nada a
         * fazer nesta linha" transforma a única lista útil da tela em parede.
         * Quem já está completo aparece no placar, que é onde a informação
         * cabe em um número.
         */
        if (faltas.length) {
          aCompletar++;
          l.avisos.push(avisoDeCompletar(faltas));
        } else {
          jaCompletos++;
        }
      }
      if (l.advogadoEmail && !emailsConhecidos.has(l.advogadoEmail)) {
        l.erros.push(`Advogado "${l.advogadoEmail}" não encontrado entre os usuários ativos.`);
      }
      for (const e of l.equipeEmails) {
        if (!emailsConhecidos.has(e)) l.avisos.push(`"${e}" não é usuário ativo — fora da equipe.`);
      }
    }

    const validos = linhas.filter((l) => !l.erros.length).length;
    const importacao = await this.prisma.importacao.create({
      data: {
        nomeArquivo: file.originalname,
        tamanhoBytes: file.buffer.length,
        perfil: PerfilImportacao.PROCESSOS_CSV,
        status: StatusImportacao.VALIDADO,
        total: linhas.length,
        validos,
        comErro: linhas.length - validos,
        userId: ctx.userId ?? null,
      },
      select: { id: true },
    });

    await this.prisma.importacaoLinha.createMany({
      data: linhas.map((l) => ({
        importacaoId: importacao.id,
        linha: l.linha,
        dados: l as unknown as object,
        valido: l.erros.length === 0,
        erros: l.erros,
        avisos: l.avisos,
      })),
    });

    return {
      id: importacao.id,
      total: linhas.length,
      validos,
      comErro: linhas.length - validos,
      jaCadastrados: linhas.filter((l) => jaCadastrados.has(l.npu)).length,
      /**
       * A tela precisa dos TRÊS números para saber se há trabalho a fazer.
       * Só `jaCadastrados` não distingue "80 processos a completar" de "80
       * processos que já estão completos" — e era essa indistinção que
       * desabilitava o botão nos dois casos.
       */
      novos: linhas.filter((l) => !l.erros.length && !jaCadastrados.has(l.npu)).length,
      aCompletar,
      jaCompletos,
      problemasNoArquivo,
    };
  }

  // ==========================================================================
  // 2) Prévia
  // ==========================================================================

  async resumo(id: string) {
    const imp = await this.prisma.importacao.findUnique({ where: { id } });
    if (!imp || imp.perfil !== PerfilImportacao.PROCESSOS_CSV) {
      throw new NotFoundException('Importação de processos não encontrada.');
    }
    return {
      id: imp.id,
      nomeArquivo: imp.nomeArquivo,
      status: imp.status,
      total: imp.total,
      validos: imp.validos,
      comErro: imp.comErro,
      processados: imp.processados,
      importados: imp.importados,
      /** Já existiam e receberam o que faltava — ver `oQueCompletar`. */
      completados: imp.atualizados,
      ignorados: imp.ignorados,
      criadoEm: imp.createdAt,
      finalizadoEm: imp.finalizadoEm,
      erroMensagem: imp.erroMensagem,
    };
  }

  async listarLinhas(id: string, filtro: { apenasProblemas?: boolean; page?: number }) {
    const page = Math.max(1, filtro.page ?? 1);
    const linhas = await this.prisma.importacaoLinha.findMany({
      where: {
        importacaoId: id,
        ...(filtro.apenasProblemas ? { OR: [{ valido: false }, { NOT: { avisos: { equals: [] } } }] } : {}),
      },
      orderBy: { linha: 'asc' },
      skip: (page - 1) * 50,
      take: 50,
      select: { linha: true, dados: true, valido: true, erros: true, avisos: true },
    });
    return linhas.map((l) => {
      const d = l.dados as unknown as LinhaProcesso;
      return {
        linha: l.linha,
        npu: d.npu,
        poloAtivo: d.poloAtivo,
        reu: d.reus?.map((r) => r.nome).join(', ') ?? '',
        valido: l.valido,
        erros: (l.erros as string[]) ?? [],
        avisos: (l.avisos as string[]) ?? [],
      };
    });
  }

  // ==========================================================================
  // 3) Execução
  // ==========================================================================

  async confirmar(id: string, ctx: Ctx, opcoes: OpcoesImportacao = {}) {
    const imp = await this.prisma.importacao.findUnique({ where: { id } });
    if (!imp || imp.perfil !== PerfilImportacao.PROCESSOS_CSV) {
      throw new NotFoundException('Importação de processos não encontrada.');
    }
    if (imp.status === StatusImportacao.IMPORTANDO) {
      throw new BadRequestException('Esta importação já está em andamento.');
    }
    if (imp.status === StatusImportacao.CONCLUIDO) {
      throw new BadRequestException('Esta importação já foi concluída.');
    }

    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.IMPORTANDO,
        processados: 0,
        importados: 0,
        ignorados: 0,
        iniciadoEm: new Date(),
      },
    });

    /**
     * FIRE-AND-FORGET, como os outros importadores do módulo. O `catch` não é
     * decoração: sem ele, uma falha inesperada deixaria a importação parada em
     * IMPORTANDO para sempre, e a tela ficaria girando sem nunca dizer o que
     * houve.
     */
    void this.executar(id, ctx, opcoes).catch(async (e) => {
      this.logger.error(`[IMPORT-PROCESSOS] ${id} falhou: ${(e as Error).message}`);
      await this.prisma.importacao
        .update({
          where: { id },
          data: { status: StatusImportacao.ERRO, erroMensagem: (e as Error).message.slice(0, 500) },
        })
        .catch(() => undefined);
    });

    return { ok: true, status: StatusImportacao.IMPORTANDO };
  }

  private async executar(id: string, ctx: Ctx, opcoes: OpcoesImportacao = {}) {
    const linhas = await this.prisma.importacaoLinha.findMany({
      where: { importacaoId: id, valido: true },
      orderBy: { linha: 'asc' },
      select: { id: true, dados: true },
    });

    let importados = 0;
    /**
     * COMPLETADOS têm contador PRÓPRIO, na coluna `atualizados` que o modelo já
     * tinha (zero migração, e a janela de troca do deploy agradece).
     *
     * Antes eles eram somados a `importados`, com o comentário "alguma coisa
     * entrou de fato". Entrou mesmo — mas a tela então dizia "82 importados"
     * numa passada que não criou processo nenhum, e quem lesse concluiria que
     * o acervo tinha sido duplicado. São dois fatos diferentes e precisam de
     * dois números.
     */
    let completados = 0;
    let ignorados = 0;
    let processados = 0;

    for (const registro of linhas) {
      const l = registro.dados as unknown as LinhaProcesso;
      processados++;
      // Só a criação de processo novo vai ao DataJud; completar é escrita local.
      let consultouOCnj = false;
      try {
        const resultado = await this.importarLinha(l, ctx, opcoes);
        consultouOCnj = resultado === 'IMPORTADO';
        if (resultado === 'IMPORTADO') importados++;
        else if (resultado === 'COMPLETADO') completados++;
        else ignorados++;
        await this.prisma.importacaoLinha.update({
          where: { id: registro.id },
          data: { avisos: [...(l.avisos ?? []), `Resultado: ${resultado}`] },
        });
      } catch (err) {
        /**
         * A linha que falhou conta como se tivesse consultado. A falha mais
         * provável é o próprio CNJ (404, 429, tempo esgotado), e nesse caso a
         * cota já foi gasta — presumir que não foi é justamente o caminho para
         * emendar a próxima chamada sem respiro e levar o 429 seguinte.
         */
        consultouOCnj = true;
        ignorados++;
        const motivo = (err as Error).message.slice(0, 300);
        this.logger.warn(`[IMPORT-PROCESSOS] linha ${l.linha} (${l.npu}): ${motivo}`);
        await this.prisma.importacaoLinha
          .update({
            where: { id: registro.id },
            data: { valido: false, erros: [...(l.erros ?? []), motivo] },
          })
          .catch(() => undefined);
      }

      await this.prisma.importacao
        .update({ where: { id }, data: { processados, importados, atualizados: completados, ignorados } })
        .catch(() => undefined);

      /**
       * A PAUSA É DÍVIDA COM O CNJ — e só existe quando houve consulta.
       *
       * Ficava FORA do try de propósito: a linha que falhou também consumiu
       * cota, e emendar a próxima sem respiro é o caminho para o 429. O que
       * estava errado era pausar TAMBÉM nas linhas que não falam com o CNJ.
       * Numa segunda passada — 82 linhas já cadastradas, nenhuma consulta —
       * eram 82 esperas de 2 a 3 segundos: três minutos e meio de nada, num
       * trabalho que é só escrita local. Eu havia dito ao jurídico que
       * levaria "segundos".
       */
      if (consultouOCnj && processados < linhas.length) await this.aguardar();
    }

    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.CONCLUIDO,
        processados,
        importados,
        atualizados: completados,
        ignorados,
        finalizadoEm: new Date(),
      },
    });
    this.logger.log(
      `[IMPORT-PROCESSOS] ${id} concluído — ${importados} importado(s), ` +
        `${completados} completado(s), ${ignorados} sem novidade.`,
    );
  }

  /** Devolve o que aconteceu com a linha, para o resumo poder contar. */
  private async importarLinha(
    l: LinhaProcesso,
    ctx: Ctx,
    opcoes: OpcoesImportacao = {},
  ): Promise<'IMPORTADO' | 'COMPLETADO' | 'JA_EXISTIA'> {
    const jaExiste = await this.prisma.processo.findUnique({
      where: { numeroCNJ: l.npu },
      select: { id: true, categoria: true, etiquetas: true },
    });
    if (jaExiste) return this.completarExistente(jaExiste, l, ctx.userId);

    const advogadoId = l.advogadoEmail ? await this.acharUsuario(l.advogadoEmail) : null;
    const equipeIds = (
      await Promise.all(l.equipeEmails.map((e) => this.acharUsuario(e)))
    ).filter((x): x is string => !!x);

    /**
     * FILIADO SÓ POR CPF. Casar por nome parecia tentador — e é exatamente como
     * se vincula o processo de uma pessoa ao cadastro de outra homônima. Sem
     * CPF o processo entra sem filiado, que foi a orientação e é o desfecho
     * seguro: um vínculo ausente se corrige na ficha; um vínculo errado só é
     * descoberto quando alguém recebe a intimação de um caso que não é seu.
     */
    const filiadoId = l.filiadoCpf ? await this.acharFiliado(l.filiadoCpf) : null;

    const partesContrarias: { parteExternaId: string }[] = [];
    for (const reu of l.reus) {
      const parteExternaId = await this.acharOuCriarParte(reu.nome, reu.cnpj);
      if (parteExternaId) partesContrarias.push({ parteExternaId });
    }

    await this.processos.importar(
      {
        numeroCNJ: l.npu,
        poloAtivo:
          l.poloAtivo === 'FILIADOS' && filiadoId
            ? { tipo: 'FILIADOS' as const, filiadoIds: [filiadoId] }
            : l.poloAtivo === 'OUTRA'
              ? { tipo: 'OUTRA' as const, nome: l.poloAtivoNome }
              : /**
                 * FILIADOS sem CPF cai em INSTITUCIONAL? NÃO — cairia numa
                 * mentira: diria que a ação é coletiva do sindicato quando é de
                 * uma pessoa. Vai como OUTRA com o nome que a planilha trouxe,
                 * que é verdade incompleta em vez de verdade trocada.
                 */
                l.poloAtivo === 'FILIADOS'
                ? { tipo: 'OUTRA' as const, nome: l.filiadoNome || 'Autor não identificado' }
                : { tipo: 'INSTITUCIONAL' as const },
        partesContrarias,
        ...(advogadoId ? { advogadoId } : {}),
        ...(equipeIds.length ? { advogadosIds: equipeIds } : {}),
        ...(l.categoria ? { categoria: l.categoria } : {}),
        ...(l.etiquetas.length ? { etiquetas: l.etiquetas } : {}),
        /**
         * MIGRAÇÃO DE ACERVO NÃO ABRE PRAZO, por padrão.
         *
         * O padrão aqui é o INVERSO do cadastro avulso, e de propósito: uma
         * planilha com dezenas de processos é, quase sempre, acervo que já
         * vinha sendo acompanhado fora do sistema. Ver o comentário de
         * `criarTarefasDePrazo` no DTO para o caso medido na produção.
         */
        criarTarefasDePrazo: opcoes.criarTarefasDePrazo === true,
      },
      { userId: ctx.userId, ip: ctx.ip },
    );

    if (l.andamento) await this.registrarAndamento(l, ctx.userId);
    return 'IMPORTADO';
  }

  /**
   * O PROCESSO JÁ ESTÁ NO SISTEMA — a segunda passada COMPLETA o que falta.
   *
   * Antes esta linha era simplesmente pulada, e isso parecia razoável até a
   * primeira carga real mostrar o contrário: 82 processos entraram sem área
   * jurídica (o campo se perdia no DTO da importação, defeito já corrigido), e
   * rodar a planilha de novo não consertava nada — todos voltavam como "já
   * existia". A correção do defeito ficava inútil para o acervo que ela mais
   * precisava alcançar.
   *
   * SÓ PREENCHE O QUE ESTÁ VAZIO. Nunca sobrescreve: se alguém corrigiu a área
   * na ficha, ou trocou uma etiqueta, a planilha não pode desfazer — ela é a
   * origem do dado, não a autoridade sobre ele. Etiqueta nova é ACRESCENTADA,
   * não substituída, pela mesma razão.
   */
  private async completarExistente(
    processo: { id: string; categoria: string | null; etiquetas: string[] },
    l: LinhaProcesso,
    autorId?: string,
  ): Promise<'COMPLETADO' | 'JA_EXISTIA'> {
    /**
     * A nota do jurídico só entra se ainda NÃO houver nenhuma igual — rodar a
     * planilha três vezes não pode empilhar o mesmo texto três vezes.
     */
    const andamentos = (
      await this.prisma.movimentacaoInterna.findMany({
        where: { processoId: processo.id },
        select: { descricao: true },
      })
    ).map((n) => n.descricao ?? '');

    // A MESMA função que a prévia usou para prometer. Ver `oQueCompletar`.
    const faltas = oQueCompletar(
      { categoria: processo.categoria, etiquetas: processo.etiquetas, andamentos },
      l,
    );
    if (!faltas.length) return 'JA_EXISTIA';

    const faltaCategoria = faltas.includes('CATEGORIA');
    const etiquetasNovas = faltas.includes('ETIQUETAS')
      ? l.etiquetas.filter((e) => !processo.etiquetas.includes(e))
      : [];
    const faltaNota = faltas.includes('ANDAMENTO');

    if (faltaCategoria || etiquetasNovas.length) {
      await this.prisma.processo.update({
        where: { id: processo.id },
        data: {
          ...(faltaCategoria ? { categoria: l.categoria } : {}),
          ...(etiquetasNovas.length
            ? { etiquetas: [...processo.etiquetas, ...etiquetasNovas] }
            : {}),
        },
      });
    }
    if (faltaNota) await this.registrarAndamento(l, autorId);
    return 'COMPLETADO';
  }

  /**
   * O resumo do jurídico entra como NOTA INTERNA, não como movimentação.
   *
   * Aquele texto ("Sentença de procedência. Acórdão reformando…") é leitura
   * humana do caso, e o CNJ jamais o devolveria. Ele não pode virar
   * `MovimentacaoProcessual`, que é o espelho do que o tribunal publicou —
   * misturar os dois faria a linha do tempo atribuir ao tribunal uma frase que
   * o sindicato escreveu.
   *
   * `dataFato` é o que impede a importação inteira de subir ao topo da lista de
   * uma vez: sem ela, oitenta notas datadas de hoje fariam o acervo todo
   * parecer recém-movimentado. Ver `ultimoMovimentoEm`.
   */
  private async registrarAndamento(l: LinhaProcesso, autorId?: string) {
    const processo = await this.prisma.processo.findUnique({
      where: { numeroCNJ: l.npu },
      select: { id: true, ultimoMovimentoEm: true },
    });
    if (!processo) return;

    /**
     * SEM DATA NA PLANILHA, A NOTA SE ANCORA NO ÚLTIMO FATO CONHECIDO.
     *
     * O acervo real veio com `andamento_data` vazio nas 82 linhas — a planilha
     * de origem registrava a SITUAÇÃO ("Sentença de procedência. Aguarda
     * R.O."), não a data em que ela mudou. Deixar `dataFato` nulo faz o gatilho
     * de `ultimo_movimento_em` cair no `created_at`, e aí os 82 processos
     * amanhecem todos com "movimentação hoje": a ordenação padrão da lista —
     * justamente a que existe para mostrar o que se mexeu — vira ruído.
     *
     * `ultimoMovimentoEm` é a data do fato mais recente que o sistema conhece
     * daquele processo (andamento do CNJ, em geral). Ancorar ali tem três
     * qualidades: não inventa data nova, é a afirmação mais verdadeira
     * disponível sobre quando aquela situação passou a valer, e o gatilho —
     * que só AVANÇA — vira um no-op garantido.
     *
     * Processo sem nenhum fato conhecido continua com nota sem data, e aí
     * "hoje" é mesmo a coisa mais recente que se sabe dele.
     */
    const dataFato = l.andamentoData
      ? new Date(`${l.andamentoData}T12:00:00-03:00`)
      : processo.ultimoMovimentoEm;

    await this.prisma.movimentacaoInterna.create({
      data: {
        processoId: processo.id,
        tipo: 'ATUALIZACAO',
        descricao: l.andamento,
        dataFato,
        /**
         * A pessoa que subiu a planilha é a autora do registro. Sem isto a nota
         * ficava sem autor E sem `origemSistema` — um híbrido que nenhuma das
         * duas leituras do sistema sabe classificar.
         */
        autorId: autorId ?? null,
        notaInterna: false,
        /**
         * NÃO é `origemSistema`. A frase foi escrita por uma pessoa do
         * jurídico; o que a trouxe para cá foi um robô, mas a autoria é humana
         * — e é por isso que ela DEVE contar como movimentação do processo.
         */
        origemSistema: false,
      },
    });
  }

  // ==========================================================================
  // Resolução de vínculos
  // ==========================================================================

  private async acharUsuario(email: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, ativo: true },
      select: { id: true },
    });
    return u?.id ?? null;
  }

  private async acharFiliado(cpf: string): Promise<string | null> {
    const f = await this.prisma.filiado.findFirst({ where: { cpf }, select: { id: true } });
    return f?.id ?? null;
  }

  /**
   * Acha a parte contrária ou cria uma nova.
   *
   * A BUSCA É POR CNPJ PRIMEIRO, e a ordem importa: `documento` é único, então
   * casar por ele é exato. O nome só entra quando não há CNPJ — e aí a
   * comparação é frouxa de propósito ("HAPVIDA" tem de achar "HAPVIDA
   * ASSISTENCIA MEDICA LTDA"), porque a planilha traz apelidos e o cadastro
   * traz razão social.
   *
   * Criar pelo apelido é a última opção, e deixa dívida: "MAT. MARQUES BASTOS"
   * vira um registro com esse nome até alguém abrir Organizações e corrigir
   * pela Receita. É melhor que não cadastrar — sem réu o processo não diz
   * contra quem litiga — mas não é bom, e a prévia avisa linha a linha.
   */
  private async acharOuCriarParte(nome: string, cnpj: string): Promise<string | null> {
    const limpo = nome.trim();
    if (!limpo) return null;

    if (cnpj && (cnpj.length === 14 || cnpj.length === 11)) {
      const porDoc = await this.prisma.parteExterna.findFirst({
        where: { documento: cnpj },
        select: { id: true },
      });
      if (porDoc) return porDoc.id;
    }

    const porNome = await this.prisma.parteExterna.findFirst({
      where: { nome: { contains: limpo, mode: 'insensitive' } },
      select: { id: true },
    });
    if (porNome) return porNome.id;

    const criada = await this.prisma.parteExterna.create({
      data: {
        nome: limpo,
        tipo: cnpj.length === 11 ? TipoParteExterna.FISICA : TipoParteExterna.JURIDICA,
        documento: cnpj.length === 14 || cnpj.length === 11 ? cnpj : null,
        observacoes: 'Cadastrada pela importação em lote — confira a razão social.',
      },
      select: { id: true },
    });
    return criada.id;
  }

  private aguardar(): Promise<void> {
    const ms = this.PAUSA_MIN + Math.floor(Math.random() * (this.PAUSA_MAX - this.PAUSA_MIN + 1));
    return new Promise((r) => setTimeout(r, ms));
  }
}
