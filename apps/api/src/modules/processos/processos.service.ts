import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, OrigemSincronizacao, Prisma, TipoAcaoProcesso } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  DatajudService, InstanciaDatajud, ParteDatajud, ProcessoDatajud,
} from './datajud.service';
import { CorrelacaoService } from './correlacao.service';
import { InstanciasService } from './instancias.service';
import { SincronizacaoLogService } from './sincronizacao-log.service';
import { AutomacaoPrazosService } from './automacao-prazos.service';
import { PartesService, PARTE_INCLUDE, PARTE_ORDER, ADVOGADO_INCLUDE } from './partes.service';
import {
  AtualizarProcessoDto,
  FormalizarProcessoDto,
  ImportarProcessoDto,
  ListProcessosQueryDto,
} from './dto/processos.dto';
import { CpfMatcherUtils } from './utils/cpf-matcher.util';
import { escolherPrincipal, temInstanciaViva } from './utils/instancia.util';
import { NpuUtils } from './utils/npu.util';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/** LGPD: nas listas mostramos só o mínimo do filiado (nome/matrícula). */
const filiadoSel = { select: { id: true, nomeCompleto: true, matricula: true } } as const;
const advogadoSel = { select: { id: true, nome: true } } as const;

/**
 * Partes na LISTA: o suficiente para montar "SENATEPI × PRONTOCARE" numa linha
 * da tabela, sem trazer o dossiê inteiro de cada parte em 20 processos.
 */
const partesResumoSel = {
  select: { id: true, polo: true, papel: true, principal: true, nome: true },
  orderBy: PARTE_ORDER,
} as const;

/** Data do andamento mais recente de uma instância recém-vinda do CNJ. */
function ultimoMovimento(instancia: ProcessoDatajud): Date | null {
  let maior = -Infinity;
  for (const m of instancia.movimentacoes) {
    const t = new Date(m.dataMovimento).getTime();
    if (Number.isFinite(t) && t > maior) maior = t;
  }
  return maior > -Infinity ? new Date(maior) : null;
}

/**
 * Instância que responde pelo processo ANTES de os movimentos entrarem no banco.
 *
 * É uma escolha provisória: `baixada` só é conhecida depois de gravar os
 * andamentos e rodar `instanciaBaixada` sobre eles, então aqui todas contam
 * como vivas e a decisão sai pelo andamento mais recente.
 * `InstanciasService.definirPrincipal` reavalia com a regra completa, dentro da
 * mesma transação, e corrige os atalhos. Serve para dar ao `create` do processo
 * um conjunto de metadados coerente — nunca como palavra final.
 */
function instanciaProvisoria(instancias: InstanciaDatajud[]): InstanciaDatajud {
  const escolhida = escolherPrincipal(
    instancias.map((i) => ({ ...i, ultimoMovimentoEm: ultimoMovimento(i), baixada: false })),
  );
  return escolhida ?? instancias[0];
}

@Injectable()
export class ProcessosService {
  private readonly logger = new Logger(ProcessosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly datajud: DatajudService,
    private readonly instancias: InstanciasService,
    private readonly logSync: SincronizacaoLogService,
    private readonly partes: PartesService,
    private readonly automacao: AutomacaoPrazosService,
    private readonly correlacao: CorrelacaoService,
  ) {}

  // -------------------------------------------------------------------------
  // 1) IMPORTAR (On-Demand): consulta o DATAJUD e CRIA o cache local.
  //    Se o processo já existe → 409 (use "Sincronizar" para atualizar).
  // -------------------------------------------------------------------------

  async importar(dto: ImportarProcessoDto, ctx: Ctx) {
    const numero = (dto.numeroCNJ || '').replace(/\D/g, '');
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }

    // (a) Já existe localmente? → conflito.
    const existente = await this.prisma.processo.findUnique({
      where: { numeroCNJ: numero },
      select: { id: true },
    });
    if (existente) {
      throw new ConflictException(
        'Processo já importado — use "Sincronizar" para atualizar as movimentações.',
      );
    }

    if (dto.advogadoId) await this.garantir('user', dto.advogadoId);
    // Equipe: valida de uma vez e aponta QUAL id não existe, em vez de falhar
    // no meio da transação com um erro de FK.
    if (dto.advogadosIds?.length) {
      const ids = [...new Set(dto.advogadosIds)];
      const achados = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const faltando = ids.filter((id) => !achados.some((u) => u.id === id));
      if (faltando.length) {
        throw new BadRequestException(`Advogado não encontrado: ${faltando.join(', ')}.`);
      }
    }

    // (a2) Polo ativo. `poloAtivo` é o caminho novo (institucional / vários
    //      filiados / parte avulsa); `filiadoId` sozinho segue aceito para não
    //      quebrar quem já chamava a rota assim.
    const polo = await this.resolverPoloAtivo(dto);
    if (!polo.institucional && !polo.filiados.length && dto.filiadoId) {
      await this.garantir('filiado', dto.filiadoId);
    }

    // (b) Tribunal: usa o informado ou deriva do próprio NPU.
    const sigla = dto.tribunal?.trim() || NpuUtils.siglaTribunal(numero);
    if (!sigla) {
      throw new BadRequestException(
        'Não foi possível identificar o tribunal a partir do NPU; informe a sigla (ex.: TJPI, TRF1, TRT22).',
      );
    }

    // (c) Busca no DATAJUD (timeout/erros do CNJ tratados no DatajudService).
    //     Vêm TODAS as instâncias do NPU — 1º grau, 2º grau, juizado, turma
    //     recursal —, cada uma com o próprio histórico de andamentos.
    const t0 = Date.now();
    let instancias: InstanciaDatajud[];
    try {
      instancias = await this.datajud.buscarInstanciasPorNPU(numero, sigla);
    } catch (err) {
      await this.logSync.registrar({
        numeroCNJ: numero, tribunal: sigla, origem: OrigemSincronizacao.IMPORTACAO,
        sucesso: false, httpStatus: this.logSync.statusDe(err),
        mensagemErro: (err as Error).message, duracaoMs: Date.now() - t0,
      });
      throw err;
    }
    if (!instancias.length) {
      await this.logSync.registrar({
        numeroCNJ: numero, tribunal: sigla, origem: OrigemSincronizacao.IMPORTACAO,
        sucesso: false, mensagemErro: 'Não localizado no índice do tribunal.',
        duracaoMs: Date.now() - t0,
      });
      throw new NotFoundException('Processo não localizado no DATAJUD para o tribunal informado.');
    }

    const dados = instanciaProvisoria(instancias);
    const totalMovimentacoes = instancias.reduce((n, i) => n + i.movimentacoes.length, 0);

    // (d) Cria Processo + Movimentações + Partes numa única transação.
    //     O filiado e o advogado informados viram, respectivamente, a parte
    //     principal do polo ativo e o advogado responsável — os atalhos
    //     `filiadoId`/`advogadoId` são gravados junto, já derivados.
    const filiado =
      !polo.institucional && !polo.filiados.length && dto.filiadoId
        ? await this.prisma.filiado.findUnique({
            where: { id: dto.filiadoId },
            select: { nomeCompleto: true, cpf: true },
          })
        : null;

    // Atalho `Processo.filiadoId`: continua sendo o filiado PRINCIPAL, para a
    // ficha do filiado e o dashboard seguirem funcionando sem varrer as partes.
    // Ação institucional não tem dono — fica nulo, e é isso mesmo.
    const filiadoPrincipal = polo.institucional
      ? null
      : (polo.filiados[0]?.id ?? dto.filiadoId ?? null);

    const processo = await this.prisma.$transaction(async (tx) => {
      const p = await tx.processo.create({
        data: {
          numeroCNJ: numero,
          filiadoId: filiadoPrincipal,
          advogadoId: dto.advogadoId || null,
          tipoAcao: polo.institucional
            ? TipoAcaoProcesso.INSTITUCIONAL
            : TipoAcaoProcesso.INDIVIDUAL,
          etiquetas: this.normalizarEtiquetas(dto.etiquetas),
          statusInterno: dto.statusInterno ?? undefined,
          ...this.metadados(dados, sigla),
        },
      });
      // Instâncias + movimentações de cada uma, e a eleição da principal (que
      // reescreve os atalhos gravados acima com a regra completa).
      await this.instancias.sincronizar(tx, p.id, instancias);

      await this.partes.semearNaImportacao(tx, p.id, {
        filiadoId: dto.filiadoId,
        advogadoId: dto.advogadoId,
        advogadosIds: dto.advogadosIds,
        filiado,
        filiadosAtivos: polo.filiados,
        institucional: polo.institucional,
        poloAtivoAvulso: polo.avulso,
        // Réu informado já no modal de importação — é o momento em que o
        // operador tem o dado em mãos (o DataJud não devolve partes).
        parteContraria: dto.parteContraria ?? null,
      });
      return p;
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'Processo',
      entidadeId: processo.id,
      descricao:
        `Processo ${numero} importado do DATAJUD (${sigla.toUpperCase()}, ` +
        `${instancias.length} instância(s), ${totalMovimentacoes} mov.)`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        numeroCNJ: numero,
        tribunal: sigla.toUpperCase(),
        movimentacoes: totalMovimentacoes,
        instancias: instancias.map((i) => ({ grau: i.grau, movimentacoes: i.movimentacoes.length })),
      },
    });
    await this.logSync.registrar({
      processoId: processo.id, numeroCNJ: numero, tribunal: sigla,
      origem: OrigemSincronizacao.IMPORTACAO, sucesso: true,
      novasMovimentacoes: totalMovimentacoes, duracaoMs: Date.now() - t0,
    });

    // Robô de prazos: as movimentações que acabaram de entrar podem já conter
    // intimações/audiências que exigem tarefa.
    await this.dispararAutomacao(processo.id);

    // (e) Resposta com partes desmascaradas (apenas o filiado vinculado — LGPD).
    const detalhe = await this.detalhe(processo.id);
    const partes = await this.desmascararPartes(dados.partes, dto.filiadoId);
    return { ...detalhe, partes };
  }

  // -------------------------------------------------------------------------
  // 3) RESSINCRONIZAR (PATCH /:id/sincronizar): rebusca no DATAJUD e insere
  //    APENAS as movimentações ausentes; atualiza `ultimaSincronizacao`.
  // -------------------------------------------------------------------------

  async ressincronizar(id: string, ctx: Ctx) {
    const proc = await this.carregarParaSync(id);
    if (!proc) throw new NotFoundException('Processo não encontrado.');

    const { dados, novas } = await this.mesclarDoDatajud(proc, OrigemSincronizacao.MANUAL);

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Processo',
      entidadeId: id,
      descricao: `Processo ${proc.numeroCNJ} sincronizado: ${novas} nova(s) movimentação(ões)`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { numeroCNJ: proc.numeroCNJ, novasMovimentacoes: novas },
    });

    const detalhe = await this.detalhe(id);
    const partes = await this.desmascararPartes(dados?.partes ?? [], proc.filiadoId ?? undefined);
    return { ...detalhe, novasMovimentacoes: novas, partes };
  }

  // -------------------------------------------------------------------------
  // Sincronização silenciosa (usada pelo robô de madrugada). NÃO audita nem
  // desmascara — apenas mescla as movimentações novas. Pode lançar (o cron trata).
  // -------------------------------------------------------------------------

  async ressincronizarSilencioso(id: string): Promise<{ novas: number }> {
    const proc = await this.carregarParaSync(id);
    if (!proc) return { novas: 0 };
    const { novas } = await this.mesclarDoDatajud(proc, OrigemSincronizacao.CRON);
    return { novas };
  }

  /** IDs de todos os processos ATIVOS (varredura do robô). */
  async idsAtivos(): Promise<string[]> {
    const rows = await this.prisma.processo.findMany({
      where: { statusInterno: 'ATIVO' },
      select: { id: true },
      orderBy: { ultimaSincronizacao: 'asc' }, // prioriza os mais desatualizados
    });
    return rows.map((r) => r.id);
  }

  /**
   * IDs elegíveis à varredura noturna: ATIVOS e PENDENTES. Processos
   * arquivados não são consultados — não mudam mais e só gastariam cota da API
   * do CNJ. RASCUNHOS ficam de fora por construção (não têm NPU), e o
   * `numeroCNJ: { not: null }` é o cinto de segurança: mesmo que alguém mude o
   * status de um rascunho à mão, o robô não tenta consultar o nada.
   *
   * ENCERRADOS COM INSTÂNCIA VIVA TAMBÉM ENTRAM. O status é do PROCESSO, mas a
   * baixa acontece por GRAU: o 2º grau transita em julgado, o processo é
   * encerrado — e o cumprimento de sentença segue correndo no 1º grau, sem
   * ninguém olhando. É o caso que motivou a tabela de instâncias, e deixá-lo de
   * fora da varredura tornaria toda a funcionalidade inútil: o sistema saberia
   * que o 1º grau está vivo e mesmo assim pararia de consultá-lo.
   */
  async idsParaSincronizar(): Promise<string[]> {
    const rows = await this.prisma.processo.findMany({
      where: {
        numeroCNJ: { not: null },
        OR: [
          { statusInterno: { in: ['ATIVO', 'PENDENTE'] } },
          { statusInterno: 'ENCERRADO', instancias: { some: { baixada: false } } },
        ],
      },
      select: { id: true },
      orderBy: { ultimaSincronizacao: 'asc' }, // prioriza os mais desatualizados
    });
    return rows.map((r) => r.id);
  }

  // -------------------------------------------------------------------------
  // 2) Leituras 100% do cache local (instantâneas)
  // -------------------------------------------------------------------------

  async listar(q: ListProcessosQueryDto, usuarioId?: string) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const and: Prisma.ProcessoWhereInput[] = [];
    if (q.statusInterno) and.push({ statusInterno: q.statusInterno });
    if (q.tribunal) and.push({ tribunal: { equals: q.tribunal, mode: 'insensitive' } });
    // Filiado/advogado casam com QUALQUER vínculo, não só o principal: numa ação
    // plúrima o filiado buscado costuma ser o terceiro da lista, e num processo
    // com dois advogados o segundo também precisa achá-lo.
    // O atalho `Processo.filiadoId` entra no OR junto com a tabela de partes:
    // ele é derivado dela e deveria bastar a segunda condição, mas um processo
    // que perdeu a linha de parte (correção manual, importação antiga) ficaria
    // invisível na busca por filiado — e é exatamente onde essa busca é usada
    // para vincular uma atividade a um processo existente.
    if (q.filiadoId) {
      and.push({
        OR: [{ filiadoId: q.filiadoId }, { partes: { some: { filiadoId: q.filiadoId } } }],
      });
    }
    if (q.advogadoId) and.push({ advogados: { some: { advogadoId: q.advogadoId } } });
    // Todos os processos de uma parte externa (ex.: tudo contra a PRONTOCARE).
    if (q.parteExternaId) and.push({ partes: { some: { parteExternaId: q.parteExternaId } } });

    // ---- Filtros rápidos da tabela ----
    // "Meus processos": inclui os que o usuário acompanha sem ser o responsável.
    if (q.meus === 'true' && usuarioId) and.push({ advogados: { some: { advogadoId: usuarioId } } });
    // "Sem filiado vinculado": o alerta que a equipe precisa resolver.
    if (q.semFiliado === 'true') and.push({ filiadoId: null, partes: { none: { filiadoId: { not: null } } } });
    // "Sem parte contrária": processo sem réu cadastrado — não dá para saber
    // contra quem se litiga, e o DataJud nunca vai preencher isso sozinho.
    if (q.semParteContraria === 'true') and.push({ partes: { none: { polo: 'PASSIVO' } } });
    if (q.etiqueta) and.push({ etiquetas: { has: q.etiqueta } });
    // "Com movimentação recente": houve andamento (do CNJ ou interno) na janela.
    if (q.movimentacaoRecente) {
      const dias = Number(q.movimentacaoRecente) || 7;
      const desde = new Date(Date.now() - dias * 24 * 3600 * 1000);
      and.push({
        OR: [
          { movimentacoes: { some: { dataMovimento: { gte: desde } } } },
          { movimentacoesInternas: { some: { createdAt: { gte: desde } } } },
        ],
      });
    }
    const busca = q.busca?.trim();
    if (busca) {
      and.push({
        OR: [
          { numeroCNJ: { contains: busca.replace(/\D/g, '') || busca } },
          // RASCUNHO não tem NPU nem classe: o `titulo` é a única coisa pela
          // qual ele pode ser encontrado. Sem isto, um processo aberto por um
          // desfecho da agenda era invisível na busca até ser formalizado.
          { titulo: { contains: busca, mode: 'insensitive' } },
          { classeProcessual: { contains: busca, mode: 'insensitive' } },
          { assuntoPrincipal: { contains: busca, mode: 'insensitive' } },
          { filiado: { nomeCompleto: { contains: busca, mode: 'insensitive' } } },
          // Buscar pelo nome de QUALQUER parte — é assim que se acha "todos os
          // processos da Prontocare" digitando o nome dela na busca da tela.
          { partes: { some: { nome: { contains: busca, mode: 'insensitive' } } } },
        ],
      });
    }
    const where: Prisma.ProcessoWhereInput = and.length ? { AND: and } : {};

    const [total, items] = await this.prisma.$transaction([
      this.prisma.processo.count({ where }),
      this.prisma.processo.findMany({
        where,
        orderBy: { ultimaSincronizacao: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, numeroCNJ: true, classeProcessual: true, assuntoPrincipal: true,
          orgaoJulgador: true, tribunal: true, grau: true, dataDistribuicao: true,
          valorCausa: true, statusInterno: true, ultimaSincronizacao: true,
          etiquetas: true, segredoJustica: true, tipoAcao: true,
          filiado: filiadoSel, advogado: advogadoSel,
          partes: partesResumoSel,
          advogados: { select: { principal: true, advogado: advogadoSel } },
          // Só o resumo: a lista precisa avisar "este processo corre em dois
          // graus" sem carregar os metadados de cada um.
          instancias: {
            select: { grau: true, baixada: true, principal: true },
            orderBy: { grau: 'asc' },
          },
          _count: { select: { movimentacoes: true, partes: true, advogados: true } },
        },
      }),
    ]);

    return {
      // `confronto` pronto na resposta: a tabela mostra "Autor × Réu" sem
      // reimplementar a regra de qual parte é a principal em cada tela.
      items: items.map(({ partes, ...p }) => ({
        ...p,
        partes,
        confronto: this.partes.agruparPorPolo(partes).confronto,
      })),
      total,
      page,
      pageSize,
      totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async detalhe(id: string) {
    const processo = await this.prisma.processo.findUnique({
      where: { id },
      include: {
        filiado: filiadoSel,
        advogado: advogadoSel,
        partes: { orderBy: PARTE_ORDER, include: PARTE_INCLUDE },
        advogados: { orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }], include: ADVOGADO_INCLUDE },
        // A instância viva e mais recente primeiro: é a que a tela abre.
        instancias: {
          orderBy: [{ baixada: 'asc' }, { ultimoMovimentoEm: 'desc' }],
          include: { _count: { select: { movimentacoes: true } } },
        },
        movimentacoes: { orderBy: { dataMovimento: 'desc' } },
      },
    });
    if (!processo) throw new NotFoundException('Processo não encontrado.');
    return { ...processo, polos: this.partes.agruparPorPolo(processo.partes) };
  }

  async atualizar(id: string, dto: AtualizarProcessoDto, ctx: Ctx) {
    const atual = await this.prisma.processo.findUnique({ where: { id }, select: { id: true } });
    if (!atual) throw new NotFoundException('Processo não encontrado.');
    if (dto.filiadoId) await this.garantir('filiado', dto.filiadoId);
    if (dto.advogadoId) await this.garantir('user', dto.advogadoId);

    await this.prisma.processo.update({
      where: { id },
      data: {
        statusInterno: dto.statusInterno,
        etiquetas: dto.etiquetas === undefined ? undefined : this.normalizarEtiquetas(dto.etiquetas),
      },
    });

    // `filiadoId`/`advogadoId` NÃO são gravados direto: eles são atalhos
    // derivados das tabelas N:N. Traduzimos a intenção do payload antigo
    // (vincular filiado / definir responsável) para a fonte de verdade, que
    // reescreve os atalhos no fim.
    if (dto.filiadoId !== undefined || dto.advogadoId !== undefined) {
      await this.partes.aplicarVinculosLegados(
        id,
        { filiadoId: dto.filiadoId, advogadoId: dto.advogadoId },
        ctx,
      );
    }
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'Processo', entidadeId: id,
      descricao: 'Dados internos do processo atualizados', ip: ctx.ip, userAgent: ctx.userAgent, metadata: {},
    });
    return this.detalhe(id);
  }

  /**
   * FORMALIZAR UM RASCUNHO — o outro lado da criação a partir de um desfecho.
   *
   * O advogado tem duas saídas, e as duas são legítimas:
   *  a) informa o NPU e manda buscar no DataJud (`sincronizar: true`) — o
   *     rascunho vira um processo espelhado, com movimentações e tudo;
   *  b) informa o NPU (ou nem isso) e preenche os campos à mão — útil quando o
   *     tribunal ainda não indexou o processo no CNJ, o que é comum nos
   *     primeiros dias após a distribuição.
   *
   * Só sai de RASCUNHO quem tem número: é a regra que o CHECK do banco também
   * garante, e o que impede um "processo ativo" que não existe em lugar nenhum.
   */
  async formalizar(id: string, dto: FormalizarProcessoDto, ctx: Ctx) {
    const atual = await this.prisma.processo.findUnique({
      where: { id },
      select: { id: true, numeroCNJ: true, statusInterno: true, titulo: true },
    });
    if (!atual) throw new NotFoundException('Processo não encontrado.');
    if (atual.statusInterno !== 'RASCUNHO') {
      throw new BadRequestException('Este processo já está formalizado.');
    }

    const numero = (dto.numeroCNJ || '').replace(/\D/g, '');
    if (!numero) {
      throw new BadRequestException('Informe o número único (NPU) para formalizar o processo.');
    }
    if (numero.length !== 20) {
      throw new BadRequestException('NPU inválido — informe os 20 dígitos do número único (CNJ).');
    }

    const jaExiste = await this.prisma.processo.findUnique({
      where: { numeroCNJ: numero },
      select: { id: true },
    });
    if (jaExiste && jaExiste.id !== id) {
      throw new ConflictException(
        'Já existe um processo cadastrado com este número. Vincule a atividade a ele em vez de duplicar.',
      );
    }

    const sigla = dto.tribunal?.trim() || NpuUtils.siglaTribunal(numero) || null;

    await this.prisma.processo.update({
      where: { id },
      data: {
        numeroCNJ: numero,
        tribunal: sigla ? sigla.toUpperCase() : undefined,
        classeProcessual: dto.classeProcessual?.trim() || undefined,
        assuntoPrincipal: dto.assuntoPrincipal?.trim() || undefined,
        orgaoJulgador: dto.orgaoJulgador?.trim() || undefined,
        dataDistribuicao: dto.dataDistribuicao ? new Date(dto.dataDistribuicao) : undefined,
        valorCausa: dto.valorCausa ?? undefined,
        // Sai de RASCUNHO. PENDENTE (distribuído, sem movimentação conhecida) é
        // o estado honesto até o CNJ responder alguma coisa.
        statusInterno: dto.statusInterno ?? 'PENDENTE',
      },
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Processo',
      entidadeId: id,
      descricao: `Rascunho formalizado como processo ${numero}${dto.sincronizar ? ' (com busca no DataJud)' : ' (preenchimento manual)'}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { numeroCNJ: numero, sincronizou: !!dto.sincronizar },
    });

    // Busca no CNJ é opcional e NÃO pode derrubar a formalização: se o DataJud
    // estiver fora do ar, o processo já está formalizado e o botão
    // "Sincronizar" do detalhe resolve depois.
    if (dto.sincronizar) {
      try {
        await this.ressincronizar(id, ctx);
      } catch (err) {
        this.logger.warn(
          `[FORMALIZAR] ${numero}: formalizado, mas a busca no DataJud falhou — ${(err as Error).message}`,
        );
        return { ...(await this.detalhe(id)), avisoSincronizacao: (err as Error).message };
      }
    }
    return this.detalhe(id);
  }

  /**
   * Exclui o processo e tudo que depende dele (movimentações e anexos são
   * removidos em cascata pelo banco). Restrito ao Administrador pela regra global.
   */
  async remover(id: string, ctx: Ctx) {
    const proc = await this.prisma.processo.findUnique({
      where: { id },
      select: { id: true, numeroCNJ: true, _count: { select: { movimentacoes: true, anexos: true } } },
    });
    if (!proc) throw new NotFoundException('Processo não encontrado.');

    await this.prisma.processo.delete({ where: { id } }); // cascade: movimentações + anexos

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.DELETE,
      entidade: 'Processo',
      entidadeId: id,
      descricao: `Processo ${proc.numeroCNJ} excluído (${proc._count.movimentacoes} movimentação[ões], ${proc._count.anexos} anexo[s])`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { numeroCNJ: proc.numeroCNJ },
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Carrega o mínimo para sincronizar.
   *
   * Não traz mais as movimentações: a deduplicação passou a ser feita por
   * INSTÂNCIA, dentro de `InstanciasService`, que busca só as da instância que
   * está processando. Carregar o histórico inteiro do processo aqui era
   * desperdício crescente — um processo antigo tem centenas de andamentos, e
   * todos eram trazidos a cada varredura noturna.
   */
  private carregarParaSync(id: string) {
    return this.prisma.processo.findUnique({
      where: { id },
      select: { id: true, numeroCNJ: true, tribunal: true, filiadoId: true },
    });
  }

  /**
   * Núcleo do merge incremental (compartilhado pelo botão e pelo robô): rebusca
   * no DATAJUD e insere APENAS as movimentações ausentes, sempre refrescando os
   * metadados e o carimbo de `ultimaSincronizacao`.
   */
  private async mesclarDoDatajud(
    proc: {
      id: string;
      // Processos administrativos podem não ter NPU — o tipo acompanha o schema.
      numeroCNJ: string | null;
      tribunal: string | null;
    },
    origem: OrigemSincronizacao = OrigemSincronizacao.MANUAL,
  ): Promise<{ dados: ProcessoDatajud | null; novas: number }> {
    // Processo sem NPU (administrativo, por exemplo) não existe no DataJud —
    // não há o que sincronizar, e tentar geraria erro do CNJ a cada varredura.
    const numeroCNJ = proc.numeroCNJ;
    if (!numeroCNJ) {
      throw new BadRequestException(
        'Processo sem número único (CNJ) — a sincronização com o DataJud não se aplica.',
      );
    }
    const sigla = proc.tribunal?.trim() || NpuUtils.siglaTribunal(numeroCNJ);
    if (!sigla) {
      throw new BadRequestException('Tribunal do processo desconhecido; não é possível sincronizar.');
    }

    // Toda chamada ao CNJ é registrada — inclusive as que falham (é o que
    // permite auditar o robô noturno na manhã seguinte).
    const t0 = Date.now();
    let instancias: InstanciaDatajud[];
    try {
      instancias = await this.datajud.buscarInstanciasPorNPU(numeroCNJ, sigla);
    } catch (err) {
      await this.logSync.registrar({
        processoId: proc.id,
        numeroCNJ,
        tribunal: sigla,
        origem,
        sucesso: false,
        httpStatus: this.logSync.statusDe(err),
        mensagemErro: (err as Error).message,
        duracaoMs: Date.now() - t0,
      });
      throw err;
    }

    // Sem retorno agora: apenas registra a tentativa (não apaga o cache).
    if (!instancias.length) {
      await this.prisma.processo.update({
        where: { id: proc.id },
        data: { ultimaSincronizacao: new Date() },
      });
      await this.logSync.registrar({
        processoId: proc.id, numeroCNJ, tribunal: sigla, origem,
        sucesso: true, novasMovimentacoes: 0, duracaoMs: Date.now() - t0,
        mensagemErro: 'Processo não localizado no índice do tribunal.',
      });
      return { dados: null, novas: 0 };
    }

    // A mesclagem por instância mora em InstanciasService: a chave de igualdade
    // é (data, código TPU, descrição) DENTRO DE CADA GRAU, e não do processo —
    // o 1º e o 2º grau praticam atos homônimos, e tratá-los como o mesmo fato
    // apagaria o andamento de um dos dois.
    const resultado = await this.prisma.$transaction(async (tx) => {
      const r = await this.instancias.sincronizar(tx, proc.id, instancias);
      // Metadados não ligados ao grau (assunto, valor da causa, partes brutas).
      // Os que descrevem a instância — tribunal, classe, órgão, grau — são
      // escritos por `definirPrincipal`, dentro da chamada acima.
      await tx.processo.update({
        where: { id: proc.id },
        data: this.metadadosGerais(instancias[0]),
      });
      return r;
    });

    if (resultado.enriquecidas) {
      this.logger.log(
        `[DATAJUD] ${proc.numeroCNJ}: ${resultado.enriquecidas} movimentação(ões) antiga(s) enriquecida(s) com complementos.`,
      );
    }

    // REABERTURA: um grau baixado não encerra o processo se outro ainda corre.
    // É o caso do 2º grau com baixa definitiva e o 1º em cumprimento de
    // sentença — antes disso, a baixa tirava o processo da varredura e o
    // andamento do 1º grau deixava de ser visto.
    await this.reavaliarStatusPorInstancias(proc.id);

    await this.logSync.registrar({
      processoId: proc.id, numeroCNJ, tribunal: sigla, origem,
      sucesso: true, novasMovimentacoes: resultado.novas, duracaoMs: Date.now() - t0,
    });

    // ROBÔ DE PRAZOS. Roda FORA da transação de propósito — se a automação
    // falhar, o cache do processo já está salvo (perder um lembrete é
    // aceitável; perder a sincronização não).
    await this.dispararAutomacao(proc.id);

    return { dados: instanciaProvisoria(instancias), novas: resultado.novas };
  }

  /**
   * Devolve um processo ENCERRADO ao acompanhamento quando alguma instância
   * ainda está viva.
   *
   * O status é do PROCESSO, mas a baixa é de um GRAU. Sem esta reavaliação, a
   * baixa definitiva no 2º grau encerrava o processo inteiro, ele saía de
   * `idsParaSincronizar` e o cumprimento de sentença correndo no 1º grau
   * passava a andar sem que ninguém visse.
   *
   * Só reabre o que o ROBÔ encerrou (ENCERRADO). Arquivado, suspenso ou
   * improcedente são decisões da equipe e o sistema não as desfaz sozinho.
   */
  private async reavaliarStatusPorInstancias(processoId: string): Promise<void> {
    const processo = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        statusInterno: true,
        numeroCNJ: true,
        instancias: { select: { grau: true, baixada: true } },
      },
    });
    if (!processo || processo.statusInterno !== 'ENCERRADO') return;
    if (!temInstanciaViva(processo.instancias)) return;

    const vivas = processo.instancias.filter((i) => !i.baixada).map((i) => i.grau);
    await this.prisma.processo.update({
      where: { id: processoId },
      data: { statusInterno: 'ATIVO' },
    });
    // O histórico do processo precisa DIZER por que ele reabriu — senão a
    // equipe encontra um processo ativo que ela mesma tinha encerrado, sem
    // explicação nenhuma.
    await this.prisma.movimentacaoInterna.create({
      data: {
        processoId,
        // Slug semeado em `tipos_movimentacao` — reabertura é uma atualização
        // de estado do processo, não um ato processual novo.
        tipo: 'ATUALIZACAO',
        descricao:
          `Processo reaberto automaticamente: a instância ${vivas.join(', ')} ` +
          'continua sem baixa definitiva e recebeu andamento novo no DataJud.',
        statusAnterior: 'ENCERRADO',
        statusNovo: 'ATIVO',
        notaInterna: false,
      },
    });
    this.logger.log(
      `[DATAJUD] ${processo.numeroCNJ}: reaberto — instância(s) ${vivas.join(', ')} ainda ativa(s).`,
    );
  }

  /**
   * Interpreta a escolha de POLO ATIVO feita no modal de importação.
   *
   * Regra inegociável do fluxo: nenhuma das opções cria cadastro provisório na
   * tabela de Filiados. "Outra parte" grava apenas o nome como snapshot da
   * parte, e "definir depois" não grava nada — o processo entra com o polo
   * ativo em aberto, que a aba Partes mostra como pendência.
   *
   * Valida os filiados de uma vez (um `IN`), em vez de N consultas: a mensagem
   * de erro precisa apontar QUAL id não existe.
   */
  private async resolverPoloAtivo(dto: ImportarProcessoDto): Promise<{
    institucional: boolean;
    filiados: { id: string; nomeCompleto: string; cpf: string | null }[];
    avulso: { nome?: string; documento?: string } | null;
  }> {
    const p = dto.poloAtivo;
    if (!p) return { institucional: false, filiados: [], avulso: null };

    if (p.tipo === 'INSTITUCIONAL') {
      const senatepi = await this.partes.parteInstitucional();
      if (!senatepi) {
        throw new BadRequestException(
          'A parte institucional (SENATEPI) não está cadastrada. Cadastre-a em Partes e marque-a como institucional.',
        );
      }
      return { institucional: true, filiados: [], avulso: null };
    }

    if (p.tipo === 'FILIADOS') {
      const ids = [...new Set((p.filiadoIds ?? []).filter(Boolean))];
      if (!ids.length) {
        throw new BadRequestException('Selecione ao menos um filiado para o polo ativo.');
      }
      const achados = await this.prisma.filiado.findMany({
        where: { id: { in: ids } },
        select: { id: true, nomeCompleto: true, cpf: true },
      });
      const faltando = ids.filter((id) => !achados.some((f) => f.id === id));
      if (faltando.length) {
        throw new BadRequestException(`Filiado não encontrado: ${faltando.join(', ')}.`);
      }
      // Preserva a ordem escolhida na tela — o 1º é o principal.
      const porId = new Map(achados.map((f) => [f.id, f]));
      return { institucional: false, filiados: ids.map((id) => porId.get(id)!), avulso: null };
    }

    // OUTRA — nome digitado ou nada ("definir depois").
    const nome = p.nome?.trim();
    return {
      institucional: false,
      filiados: [],
      avulso: nome ? { nome, documento: p.documento } : null,
    };
  }

  /**
   * Aciona o robô sobre as movimentações do processo que ainda não geraram
   * evento (`compromissoId` nulo). Buscar do banco em vez de reaproveitar o
   * array garante que cada linha leve o próprio id — é ele que trava a
   * idempotência.
   *
   * JANELA DE 30 DIAS: um andamento de meses atrás geraria uma tarefa já
   * vencida — ruído puro numa agenda que precisa ser confiável. Só entra o que
   * ainda é acionável.
   */
  private async dispararAutomacao(processoId: string) {
    // ANTES DE TUDO: amarra as movimentações novas às publicações do DJEN que já
    // viraram atividade. É o fecho do circuito anti-duplicata — quando a
    // publicação chega primeiro (o que é comum, porque o diário sai antes de o
    // tribunal alimentar o índice do CNJ), a movimentação correspondente entra
    // aqui carimbada e o robô a pula pela trava que ele sempre teve.
    await this.correlacao.vincularMovimentacoesNovas(processoId);

    const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const pendentes = await this.prisma.movimentacaoProcessual.findMany({
      where: { processoId, compromissoId: null, dataMovimento: { gte: desde } },
      orderBy: { dataMovimento: 'desc' },
      take: 50,
      select: {
        id: true, descricao: true, detalhe: true, conteudo: true, codigoMovimento: true,
        dataMovimento: true, ehAudiencia: true, audienciaData: true, compromissoId: true,
      },
    });
    await this.automacao.processar(processoId, pendentes);
  }

  /**
   * Metadados públicos do DATAJUD prontos para gravar no Processo.
   *
   * Tudo que a tela precisa fica PERSISTIDO aqui — abrir o processo depois é
   * leitura 100% local, sem tocar no CNJ. As partes vão para `partesBrutas`
   * (JSON) de propósito: quando o CPF não casa com um Filiado, o dado do
   * tribunal fica guardado sem criar rascunho na tabela de filiados.
   *
   * Usado só na CRIAÇÃO do processo, com a instância provisoriamente escolhida.
   * Na sincronização, os campos ligados ao grau vêm de
   * `InstanciasService.definirPrincipal`; aqui ficam apenas os gerais.
   */
  private metadados(dados: ProcessoDatajud, sigla: string) {
    return {
      ...this.metadadosGerais(dados),
      classeProcessual: dados.classeProcessual,
      classeCodigo: dados.classeCodigo,
      orgaoJulgador: dados.orgaoJulgador,
      orgaoJulgadorCodigo: dados.orgaoJulgadorCodigo,
      tribunal: dados.tribunal ?? sigla.toUpperCase(),
      dataDistribuicao: dados.dataDistribuicao ? new Date(dados.dataDistribuicao) : null,
      grau: dados.grau,
      formato: dados.formato,
      sistema: dados.sistema,
      nivelSigilo: dados.nivelSigilo,
      atualizadoNoCnjEm: dados.atualizadoNoCnjEm ? new Date(dados.atualizadoNoCnjEm) : null,
    };
  }

  /**
   * Metadados que NÃO pertencem a um grau específico.
   *
   * Assunto, valor da causa, sigilo e partes são do processo como um todo e vêm
   * iguais em todas as instâncias. Os que descrevem a instância — tribunal,
   * classe, órgão julgador, grau — ficam de fora de propósito: escrevê-los aqui
   * criaria um segundo escritor dos atalhos de `Processo`, e eles voltariam a
   * apontar para uma instância arbitrária logo depois de `definirPrincipal`
   * ter escolhido a certa.
   */
  private metadadosGerais(dados: ProcessoDatajud) {
    return {
      assuntoPrincipal: dados.assuntoPrincipal,
      assuntos: (dados.assuntos ?? []) as unknown as Prisma.InputJsonValue,
      municipioIBGE: dados.municipioIBGE,
      valorCausa: dados.valorCausa ?? null,
      segredoJustica: dados.segredoJustica,
      prioridades: (dados.prioridades ?? []) as unknown as Prisma.InputJsonValue,
      // Só sobrescreve as partes quando o tribunal mandou alguma (não apaga o
      // que já havia numa sincronização que veio sem o bloco de partes).
      ...(dados.partes?.length
        ? { partesBrutas: dados.partes as unknown as Prisma.InputJsonValue }
        : {}),
      ultimaSincronizacao: new Date(),
    };
  }

  /**
   * Desmascara o CPF apenas da parte que corresponder ao filiado vinculado.
   * LGPD (Lei nº 13.709/2018): usa somente o CPF do próprio filiado (titular já
   * conhecido) com finalidade de representação/defesa jurídica. Terceiros ficam
   * mascarados.
   */
  private async desmascararPartes(
    partes: ParteDatajud[],
    filiadoId?: string,
  ): Promise<Array<ParteDatajud & { documentoDesmascarado?: boolean }>> {
    if (!Array.isArray(partes) || partes.length === 0) return [];
    const cpfFiliado = filiadoId ? await this.cpfDoFiliado(filiadoId) : null;
    return CpfMatcherUtils.aplicar(partes, cpfFiliado);
  }

  private async cpfDoFiliado(id: string): Promise<string | null> {
    const f = await this.prisma.filiado.findUnique({ where: { id }, select: { cpf: true } });
    return f?.cpf ?? null;
  }

  /** Etiquetas: apara, remove vazias e duplicatas, limita tamanho e quantidade. */
  private normalizarEtiquetas(v?: string[]): string[] {
    if (!Array.isArray(v)) return [];
    const limpas = v
      .map((e) => String(e ?? '').trim().slice(0, 40))
      .filter((e) => e.length > 0);
    return [...new Set(limpas)].slice(0, 12);
  }

  private async garantir(tipo: 'filiado' | 'user', id: string) {
    const achou =
      tipo === 'filiado'
        ? await this.prisma.filiado.findUnique({ where: { id }, select: { id: true } })
        : await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!achou) throw new BadRequestException(`${tipo === 'filiado' ? 'Filiado' : 'Advogado'} inválido.`);
  }
}
