import { JOB_DATAJUD_SYNC, comTravaDeJob } from '@core/infra';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria, OrigemSincronizacao, PoloProcesso, Prisma, StatusProcesso, TipoAcaoProcesso,
} from '@prisma/client';
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
import {
  CODIGOS_TPU_EXECUCAO, FaseProcessual, GRAUS_RECURSAIS, faseDoProcesso,
} from './utils/fase.util';
import { atoAcionavel, diasParado, type NivelAtencao } from './utils/tpu.util';
import { etiquetasDerivadas } from './utils/etiquetas.util';
import { ORDENACAO, ordemValida } from './utils/ordenacao.util';
import { filtroDeVarredura, STATUS_VIVOS } from './utils/varredura.util';
import { NpuUtils } from './utils/npu.util';
import { montarUrgencia } from '../agenda/equipe.util';
import { normalizarCategoria, AREA_LABEL } from './areas.catalogo';
import { areaSugerida, areaSugeridaValida } from './utils/area-sugerida.util';

import { tenant } from '../../tenant/tenant.config';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/** LGPD: nas listas mostramos só o mínimo do filiado (nome/matrícula). */
const filiadoSel = { select: { id: true, nomeCompleto: true, matricula: true } } as const;
/**
 * O advogado NA LISTA — com foto.
 *
 * `avatarKey` entra junto com `avatarUrl` porque a foto enviada pelo sistema
 * mora no storage e nunca esteve em `avatarUrl`: quem resolve uma na outra é o
 * `AvataresInterceptor`, global. Pedir só a URL devolveria nulo para quem subiu
 * foto pelo próprio perfil — que é a maioria.
 *
 * `nomeExibicao` porque é como a pessoa é chamada na casa ("Dra. Shérad"), e é
 * o que faz o rosto ser reconhecido numa lista de trinta linhas.
 */
const advogadoSel = {
  select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true },
} as const;

/**
 * Partes na LISTA: o suficiente para montar "sindicato × empresa ré" numa linha
 * da tabela, sem trazer o dossiê inteiro de cada parte em 20 processos.
 */
const partesResumoSel = {
  select: { id: true, polo: true, papel: true, principal: true, nome: true },
  orderBy: PARTE_ORDER,
} as const;

/**
 * Quando a nota da equipe VALE — `dataFato` quando existe, senão `createdAt`.
 *
 * A mesma regra da linha do tempo e do gatilho de `ultimoMovimentoEm`: registrar
 * hoje um ato de semana passada não torna o processo movimentado hoje. Escrita
 * uma vez aqui porque a lista precisa dela em dois lugares (o aviso de dormência
 * e a coluna), e duas cópias divergiriam na primeira correção.
 */
function dataDaNota(nota?: { dataFato: Date | null; createdAt: Date } | null): Date | null {
  if (!nota) return null;
  return nota.dataFato ?? nota.createdAt;
}

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

/**
 * OS DOIS RÓTULOS QUE SIGNIFICAM "ainda não ajuizado".
 *
 * `PRE_PROCESSUAL` é o nome de agora; `RASCUNHO` é o que as linhas antigas
 * carregam. Os dois convivem de propósito — a migração que introduziu o nome
 * novo é ADITIVA, porque renomear o rótulo derrubaria a listagem de processos
 * no contêiner que ainda está no ar durante o deploy (a medição está no
 * comentário do enum, em `schema.prisma`).
 *
 * Quem GRAVA usa sempre `PRE_PROCESSUAL`. Quem LÊ tem de usar esta lista, ou
 * um processo antigo escapa do filtro e vai parar na varredura do CNJ sem ter
 * número para consultar.
 */
export const PRE_PROCESSUAIS: StatusProcesso[] = [
  StatusProcesso.PRE_PROCESSUAL,
  StatusProcesso.RASCUNHO,
];

/**
 * OS WHERES DOS FILTROS RÁPIDOS — a lista e o contador leem daqui, os dois.
 *
 * Ficam juntos porque contador que discorda da lista é pior do que contador
 * nenhum: a aba diz "3", a pessoa clica, aparecem 2, e a partir daí ela não
 * confia em número nenhum da tela. Enquanto a única definição estiver aqui, os
 * dois não têm como divergir.
 */
export const FILTRO_RAPIDO = {
  /** Casos abertos por desfecho da agenda e ainda não ajuizados. */
  preProcessuais: (): Prisma.ProcessoWhereInput => ({
    statusInterno: { in: PRE_PROCESSUAIS },
  }),
  /** Inclui os que a pessoa acompanha sem ser a responsável. */
  meus: (usuarioId: string): Prisma.ProcessoWhereInput => ({
    advogados: { some: { advogadoId: usuarioId } },
  }),
  /**
   * O alerta que a equipe precisa resolver — e SÓ ele.
   *
   * AÇÃO INSTITUCIONAL FICA DE FORA. Nela o sindicato figura no polo ativo em
   * nome da categoria inteira: não existe um filiado "dono", e o próprio schema
   * diz que cobrar o vínculo ali "seria forçar um dado que não existe". Sem
   * este recorte a fila virava alarme falso — medido na produção em 21/08/2026,
   * ela apontava SEIS processos, todos institucionais e todos corretos. Fila de
   * trabalho que aponta trabalho inexistente é pior que fila nenhuma: some
   * junto com ela o caso individual de verdade, que é o único que importa.
   */
  semFiliado: (): Prisma.ProcessoWhereInput => ({
    tipoAcao: TipoAcaoProcesso.INDIVIDUAL,
    filiadoId: null,
    partes: { none: { filiadoId: { not: null } } },
  }),
  /**
   * Processo sem réu cadastrado — não dá para saber contra quem se litiga, e o
   * DataJud nunca vai preencher isso sozinho.
   */
  semReu: (): Prisma.ProcessoWhereInput => ({
    partes: { none: { polo: 'PASSIVO' } },
  }),
  /**
   * O TRIBUNAL SE MEXEU NA JANELA.
   *
   * SÓ O CNJ, e o nome do chip passou a dizer isso. Antes ele também contava
   * nota interna, e o resultado na tela era um filtro de "7 dias" listando
   * processos com "há 1 ano" ao lado — porque a coluna mostrava o andamento do
   * tribunal e o filtro contava outra coisa. Ampliar o significado sem trocar o
   * rótulo foi meu erro; o certo era ajustar a JANELA.
   *
   * POR QUE 30 E 60, e não 7 e 15: o índice público do CNJ atrasa. Medido em
   * 31/08/2026 sobre o acervo inteiro — o andamento MAIS NOVO tinha 24 dias, e
   * a mediana era 41. Em 7 e em 15 dias o filtro devolvia ZERO por construção,
   * e um chip que nunca acende não é rigor, é enfeite. Em 30 e 60 ele devolve 7
   * e 27, que é a carteira que a equipe precisa olhar.
   *
   * O TRABALHO DA EQUIPE não sumiu: ele continua contando na ORDENAÇÃO
   * ("Movimentação recente", via `ultimoMovimentoEm`), que responde outra
   * pergunta — "o que mexeu por último", de qualquer origem. Duas perguntas,
   * dois nomes; era ter UM nome para as duas que confundia.
   */
  recentes: (dias: number, agora: Date): Prisma.ProcessoWhereInput => ({
    movimentacoes: {
      some: { dataMovimento: { gte: new Date(agora.getTime() - dias * 24 * 3600 * 1000) } },
    },
  }),
  /** Marcados como urgentes por uma pessoa. */
  urgentes: (): Prisma.ProcessoWhereInput => ({ urgente: true }),

  /**
   * DE QUE LADO O SINDICATO ESTÁ — três respostas, não duas.
   *
   * Medido em 04/09/2026 sobre os 127 processos: somos AUTOR em 93, não somos
   * PARTE em 31 (o filiado é a parte e nós somos o patrono) e somos RÉU em 3.
   * A terceira categoria é a que costuma ser esquecida, e é a maior depois da
   * primeira — "processo do sindicato" e "processo que o sindicato conduz" são
   * coisas diferentes, e a diferença muda quem responde por ele.
   *
   * A IDENTIFICAÇÃO É EXATA, não por nome. As 96 partes que são o sindicato
   * estão TODAS ligadas ao cadastro marcado `institucional` — conferido na
   * produção. Casar por texto ("SENATEPI", a razão social inteira, e o que mais
   * o tribunal escrever) erraria nas duas pontas.
   */
  nossoPapel: (papel: 'AUTOR' | 'REU' | 'REPRESENTANDO'): Prisma.ProcessoWhereInput => {
    const somosNos = { parteExterna: { institucional: true } };
    if (papel === 'AUTOR') return { partes: { some: { polo: 'ATIVO', ...somosNos } } };
    if (papel === 'REU') return { partes: { some: { polo: 'PASSIVO', ...somosNos } } };
    /*
      Não figuramos em polo nenhum: a ação é do filiado e nós somos o patrono.

      O `some: {}` NÃO É REDUNDANTE. Sem ele, um processo importado sem parte
      nenhuma entraria aqui — "não tem o sindicato entre as partes" é verdade
      trivial quando não há partes. Hoje são zero, mas a fila "Sem réu
      cadastrado" existe justamente porque isso acontece, e o número mentiria
      em silêncio no dia em que acontecer de novo.
    */
    return { AND: [{ partes: { some: {} } }, { partes: { none: somosNos } }] };
  },
} as const;

/**
 * O WHERE de "status = X" da listagem.
 *
 * Existe como função para poder ser testada sozinha: a regra que ela guarda —
 * pedir um dos dois rótulos do pré-processual traz OS DOIS — já foi esquecida
 * uma vez, e o sintoma foi mudo. A aba "Pré-processuais" devolvia lista vazia
 * com o caso legado bem ali no banco: ele saía da listagem padrão, como pedido,
 * e não voltava por porta nenhuma.
 */
export function filtroDeStatus(
  status?: StatusProcesso,
): Prisma.ProcessoWhereInput | null {
  if (!status) return null;
  return PRE_PROCESSUAIS.includes(status)
    ? { statusInterno: { in: PRE_PROCESSUAIS } }
    : { statusInterno: status };
}

/** Status que a varredura do CNJ nunca deve reler. */
const FORA_DA_VARREDURA: StatusProcesso[] = [
  StatusProcesso.ARQUIVADO,
  StatusProcesso.IMPROCEDENTE,
  ...PRE_PROCESSUAIS,
];

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
          // A área jurídica vem VALIDADA contra o catálogo — slug inventado
          // vira nulo em vez de gravar um valor que nenhum filtro encontra.
          categoria: normalizarCategoria(dto.categoria),
          statusInterno: dto.statusInterno ?? undefined,
          // `instancias` inteiro: os assuntos são a união de todos os graus.
          ...this.metadados(dados, sigla, instancias),
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
        // Réu(s) informado(s) já no modal de importação — é o momento em que o
        // operador tem o dado em mãos (o DataJud não devolve partes).
        parteContraria: dto.parteContraria ?? null,
        partesContrarias: dto.partesContrarias ?? null,
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

    // A área jurídica sai do que o CNJ acabou de contar — só quando o cadastro
    // não a informou. Roda AQUI porque depende das partes já semeadas.
    await this.deduzirAreaJuridica(processo.id);

    // Robô de prazos: as movimentações que acabaram de entrar podem já conter
    // intimações/audiências que exigem tarefa. Salvo em migração de acervo, em
    // que o prazo recente já foi cumprido fora do sistema — ver o comentário de
    // `criarTarefasDePrazo` no DTO.
    if (dto.criarTarefasDePrazo !== false) {
      await this.dispararAutomacao(processo.id);
    }

    /**
     * O processo pode nascer JÁ ENCERRADO.
     *
     * Nem todo processo importado está em andamento: é comum cadastrar um que
     * já foi arquivado, para ter o histórico. Sem esta reavaliação ele entrava
     * como ATIVO e só era corrigido na varredura da madrugada seguinte — ou
     * seja, a lista abria mostrando "Ativo" ao lado de "Arquivado" na coluna de
     * fase, duas afirmações que não podem ser verdade juntas.
     *
     * A mesma função da sincronização, com as mesmas travas: só mexe em
     * ATIVO/PENDENTE e registra a movimentação interna que explica.
     */
    await this.reavaliarStatusPorInstancias(processo.id);

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
      /*
        AQUI O ZERO CONTA, ao contrário do radar de audiências. Isto foi
        alguém CLICANDO em "Sincronizar": "fulano consultou o CNJ e não veio
        nada" é a resposta para "por que ninguém viu aquela movimentação?".
        O que muda é a frase — "sincronizado: 0 nova(s)" se lê como erro.
      */
      descricao:
        novas > 0
          ? `Processo ${proc.numeroCNJ} sincronizado — ${novas} movimentação(ões) nova(s)`
          : `Processo ${proc.numeroCNJ} sincronizado — nada novo no CNJ`,
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

  // -------------------------------------------------------------------------
  // REAVALIAÇÃO DAS INSTÂNCIAS (sob demanda, ao abrir a tela)
  // -------------------------------------------------------------------------

  /**
   * Relê no CNJ os processos que o parser MULTI-INSTÂNCIA ainda não viu.
   *
   * POR QUE EXISTE, SE JÁ HÁ VARREDURA NOTURNA
   * Depois de um deploy que muda a leitura das instâncias, o acervo fica com
   * dados do parser antigo até as 02:00 — e é justamente nesse intervalo que
   * alguém abre a lista, vê "1ª instância" num processo que corre em duas e
   * conclui que o sistema está errado. Isto encurta a espera para o tempo de
   * uma tela abrir.
   *
   * O QUE IMPEDE ISSO DE VIRAR UMA ENXURRADA NO CNJ
   *  1. `instanciasLidasEm` — cada processo é relido UMA vez, nunca mais. Sem o
   *     carimbo, cada abertura de tela reconsultaria tudo, para sempre.
   *  2. Teto por chamada (`limite`), com a mesma cadência da varredura noturna:
   *     sequencial, com respiro entre as chamadas.
   *  3. A mesma trava de job do robô — duas abas abertas, ou uma aba e o cron,
   *     não varrem em paralelo.
   *
   * Devolve quantos foram relidos e quantos ainda faltam, para a tela decidir
   * se pede outra rodada.
   */
  async reavaliarInstancias(
    limite = 10,
  ): Promise<{ reavaliados: number; restantes: number; executou: boolean; desalinhados: number }> {
    /**
     * O alinhamento de status é só BANCO — não custa chamada ao CNJ, e por isso
     * roda sempre, antes de qualquer outra coisa e independentemente da flag.
     *
     * Isto foi um erro meu de desenho: ele estava atrás do mesmo freio que
     * existe para poupar cota do CNJ (uma releitura por sessão do navegador).
     * Resultado: um processo cujas instâncias foram corrigidas por migração
     * continuava exibindo "Ativo" ao lado de "Arquivado" até a madrugada
     * seguinte, porque a sessão já tinha "gasto" sua releitura.
     */
    const desalinhados = await this.reconciliarStatus();

    // `limite = 0` é o pedido explícito de "só alinhe o status, não fale com o
    // CNJ" — é o que a tela manda quando já releu nesta sessão.
    if (limite <= 0) return { reavaliados: 0, restantes: 0, executou: true, desalinhados };

    if (!this.datajud.multiInstanciaAtiva) {
      // Sem a flag, reler não descobriria grau nenhum — só gastaria cota.
      return { reavaliados: 0, restantes: 0, executou: false, desalinhados };
    }

    const pendentes = await this.prisma.processo.findMany({
      where: {
        numeroCNJ: { not: null },
        instanciasLidasEm: null,
        // Arquivado e improcedente não mudam mais; reler seria gastar chamada
        // para confirmar o que já se sabe.
        statusInterno: { notIn: FORA_DA_VARREDURA },
      },
      select: { id: true },
      orderBy: { ultimaSincronizacao: 'asc' },
      take: Math.min(50, Math.max(1, limite)),
    });
    if (!pendentes.length) return { reavaliados: 0, restantes: 0, executou: true, desalinhados };

    const r = await comTravaDeJob(
      this.prisma,
      JOB_DATAJUD_SYNC,
      this.logger,
      { ttlMinutos: 10 },
      async () => {
        let reavaliados = 0;
        for (let i = 0; i < pendentes.length; i++) {
          try {
            await this.ressincronizarSilencioso(pendentes[i].id);
            reavaliados++;
          } catch (err) {
            // Falha isolada: o processo continua sem carimbo e entra na próxima
            // rodada (ou na varredura noturna). Nada de repetir agora — se o CNJ
            // recusou, insistir só queima cota.
            this.logger.warn(
              `[REAVALIAR] Falha no processo ${pendentes[i].id}: ${(err as Error).message}`,
            );
          }
          // Mesma cadência da varredura noturna: sequencial, com respiro.
          if (i < pendentes.length - 1) await new Promise((res) => setTimeout(res, 2_000));
        }
        return reavaliados;
      },
    );

    if (!r.executou) return { reavaliados: 0, restantes: pendentes.length, executou: false, desalinhados };

    const restantes = await this.prisma.processo.count({
      where: {
        numeroCNJ: { not: null },
        instanciasLidasEm: null,
        statusInterno: { notIn: FORA_DA_VARREDURA },
      },
    });
    return { reavaliados: r.resultado, restantes, executou: true, desalinhados };
  }

  /**
   * Processos cujo STATUS não corresponde mais às instâncias — sem tocar no CNJ.
   *
   * Reaproveita `reavaliarStatusPorInstancias`, que é quem sabe a regra (e
   * registra a movimentação interna explicando). Aqui só se descobre em QUEM
   * chamá-la: processo ATIVO/PENDENTE sem nenhuma instância viva, ou ENCERRADO
   * com alguma viva. Os dois sentidos, porque o desalinhamento acontece nos dois.
   */
  private async reconciliarStatus(): Promise<number> {
    const candidatos = await this.prisma.processo.findMany({
      where: {
        OR: [
          {
            statusInterno: { in: ['ATIVO', 'PENDENTE'] },
            instancias: { some: {}, none: { baixada: false } },
          },
          { statusInterno: 'ENCERRADO', instancias: { some: { baixada: false } } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    for (const c of candidatos) await this.reavaliarStatusPorInstancias(c.id);
    return candidatos.length;
  }

  /**
   * Quem pode figurar como advogado de um processo — SÓ o perfil ADVOGADO.
   *
   * A lista vinha de `listarResponsaveis`, da Agenda, que devolve todo usuário
   * ativo. Faz sentido lá: triagem e coordenação respondem por tarefas. Não faz
   * aqui — advogado do processo é quem tem capacidade postulatória, e oferecer
   * a recepção nesse campo é convidar ao erro de cadastro.
   *
   * Para alguém aparecer aqui, o caminho é dar-lhe o perfil ADVOGADO em
   * Usuários e Perfis — e não afrouxar este filtro.
   */
  listarAdvogados() {
    return this.prisma.user.findMany({
      where: { ativo: true, role: 'ADVOGADO' },
      orderBy: { nome: 'asc' },
      select: {
        id: true, nome: true, nomeExibicao: true, role: true,
        oab: true, oabUf: true, avatarUrl: true, avatarKey: true,
      },
    });
  }

  /*
   * `idsAtivos()` VIVIA AQUI e foi removido.
   *
   * Ele dizia ser "a varredura do robô" e filtrava `statusInterno: 'ATIVO'` —
   * mas a varredura é `idsParaSincronizar`, logo abaixo, e o filtro certo mora
   * em `filtroDeVarredura`. Ninguém o chamava (conferido em todo o `apps/`), e
   * era uma armadilha esperando: quem o usasse por engano deixaria de fora
   * PENDENTE, GANHO_EXECUCAO e o ENCERRADO com instância viva — três estados
   * cuja ausência da varredura já causou defeito documentado neste arquivo.
   */

  /**
   * IDs elegíveis à varredura noturna.
   *
   * A regra mora em `filtroDeVarredura` (`utils/varredura.util.ts`), com o
   * porquê de cada faixa e o teste que a trava. Em resumo: o que está vivo é
   * consultado toda noite; o que está dormente volta a ser consultado a cada
   * `DIAS_RECHECAGEM_DORMENTE` dias — porque "encerrado" não é "acabou para
   * sempre", e a promessa de reabrir sozinho precisa de alguém olhando.
   */
  async idsParaSincronizar(): Promise<string[]> {
    const rows = await this.prisma.processo.findMany({
      where: filtroDeVarredura(new Date()),
      select: { id: true },
      orderBy: { ultimaSincronizacao: 'asc' }, // prioriza os mais desatualizados
    });
    return rows.map((r) => r.id);
  }

  // -------------------------------------------------------------------------
  // 2) Leituras 100% do cache local (instantâneas)
  // -------------------------------------------------------------------------

  /**
   * Tradução da fase para `WHERE`.
   *
   * A precedência de `faseDoProcesso` vira exclusão explícita: EXECUCAO exige
   * "não recursal", CONHECIMENTO exige "nem recursal nem execução". Sem isso um
   * processo em grau de recurso apareceria em dois chips ao mesmo tempo.
   */
  private whereFase(fase: FaseProcessual): Prisma.ProcessoWhereInput {
    const graus: string[] = [...GRAUS_RECURSAIS];
    const recursal: Prisma.ProcessoWhereInput = {
      instancias: { some: { baixada: false, grau: { in: graus } } },
    };
    const comExecucao: Prisma.ProcessoWhereInput = {
      movimentacoes: { some: { codigoMovimento: { in: [...CODIGOS_TPU_EXECUCAO] } } },
    };
    // Sem NPU o caso ainda não foi ajuizado — a mesma primeira regra de
    // `faseDoProcesso`, e por isso ela vem antes de tudo aqui também. Todas as
    // outras fases passam a EXIGIR número, senão o pré-processual apareceria
    // junto com processo que corre.
    if (fase === 'PRE_PROCESSUAL') return { numeroCNJ: null };
    const ajuizado: Prisma.ProcessoWhereInput = { numeroCNJ: { not: null } };

    switch (fase) {
      // `some: {}` é obrigatório: sem ele, `none` também casaria com o processo
      // que não tem instância nenhuma, e ele iria parar no filtro "Arquivado".
      case 'ARQUIVADO':
        return { AND: [ajuizado, { instancias: { some: {}, none: { baixada: false } } }] };
      case 'RECURSAL':
        return { AND: [ajuizado, recursal] };
      case 'EXECUCAO':
        return { AND: [ajuizado, comExecucao, { NOT: recursal }, { NOT: { instancias: { some: {}, none: { baixada: false } } } }] };
      case 'CONHECIMENTO':
      default:
        return {
          AND: [
            ajuizado,
            { NOT: recursal },
            { NOT: comExecucao },
            { NOT: { instancias: { some: {}, none: { baixada: false } } } },
          ],
        };
    }
  }

  /**
   * O último ato pede alguma coisa de alguém — e ninguém pegou?
   *
   * TODA a regra mora em `atoAcionavel` (tpu.util.ts): dicionário, validade,
   * complemento, tarefa já criada e dispensa. Aqui só se escolhe ENTRE avisos,
   * nunca se decide se um aviso vale — foi a duplicação dessa decisão em dois
   * lugares que fez a lista mostrar 11 selos de prazo, nenhum deles recente e o
   * mais velho com 252 dias, enquanto a ficha do mesmo processo não mostrava
   * nada. Um dos dois estava mentindo, e era o que tinha regra própria.
   *
   * QUANDO NÃO HÁ ATO ACIONÁVEL, AINDA PODE HAVER O QUE DIZER. Um processo vivo
   * cujo último andamento é de oito meses atrás não tem prazo correndo — tem
   * inércia, que é problema diferente e merece nome diferente. O aviso de
   * dormência entra por último, só quando não há nada mais urgente: quem tem
   * prazo esta semana não precisa ser lembrado de que o processo andou pouco.
   *
   * A classificação vive no back porque o filtro, a ficha e a lista têm de
   * concordar — dicionário de TPU espelhado no front envelheceria só de um lado.
   */
  private alertaDaLinha(
    ultimo: {
      codigoMovimento: number | null;
      dataMovimento: Date;
      detalhe: string | null;
      compromissoId: string | null;
      dispensadoEm: Date | null;
    } | undefined,
    ultimaNotaInterna: Date | null,
    statusInterno: StatusProcesso,
    agora: Date,
  ): { nivel: NivelAtencao | 'PARADO'; rotulo: string } | null {
    if (!ultimo) return null;

    const ato = atoAcionavel(ultimo, agora);
    if (ato) return { nivel: ato.nivel, rotulo: ato.rotulo };

    /**
     * Dormência só faz sentido em processo VIVO. Arquivado e encerrado estão
     * parados porque acabaram — acusá-los seria transformar o acervo inteiro
     * num alerta permanente, que é o defeito que este trabalho veio corrigir.
     */
    if (!STATUS_VIVOS.includes(statusInterno)) return null;

    /**
     * VALE A MAIS RECENTE DAS DUAS FONTES.
     *
     * Trabalho no processo nem sempre passa pelo tribunal: negociação, cálculo,
     * contato com o filiado. Quem registrou uma nota semana passada está com o
     * caso na mão, e chamá-lo de parado seria cobrar de quem já está fazendo.
     */
    const ultimoSinal =
      ultimaNotaInterna && ultimaNotaInterna > ultimo.dataMovimento
        ? ultimaNotaInterna
        : ultimo.dataMovimento;

    const dias = diasParado(ultimoSinal, agora);
    if (dias == null) return null;

    const meses = Math.floor(dias / 30);
    return {
      nivel: 'PARADO',
      rotulo: meses >= 12
        ? `Parado há ${Math.floor(meses / 12)} ano${meses >= 24 ? 's' : ''}`
        : `Parado há ${meses} ${meses === 1 ? 'mês' : 'meses'}`,
    };
  }

  /**
   * OS NÚMEROS DAS ABAS.
   *
   * Nasceu de um problema concreto: a fila pré-processual É ESCONDIDA da lista
   * padrão de propósito, e sem contador não havia como saber que existia algo
   * lá. A pessoa tinha de clicar na aba e torcer. Um caso real ficou invisível
   * por dias exatamente assim.
   *
   * Cada aba usa o MESMO `FILTRO_RAPIDO` que a listagem — é o que garante que o
   * número bate com o que aparece ao clicar.
   *
   * A exclusão do pré-processual vale para TODAS as outras abas, igual à lista:
   * "sem réu cadastrado" não pode contar um caso que ainda nem foi ajuizado,
   * senão a aba promete três e entrega dois.
   */
  async contadores(usuarioId?: string) {
    const foraDoPre: Prisma.ProcessoWhereInput = {
      statusInterno: { notIn: PRE_PROCESSUAIS },
    };
    const e = (extra: Prisma.ProcessoWhereInput): Prisma.ProcessoWhereInput => ({
      AND: [foraDoPre, extra],
    });
    const agora = new Date();

    const [todos, preProcessuais, meus, semFiliado, semReu, recentes, urgentes] =
      await this.prisma.$transaction([
        this.prisma.processo.count({ where: foraDoPre }),
        this.prisma.processo.count({ where: FILTRO_RAPIDO.preProcessuais() }),
        // Sem usuário no contexto não há "meus": devolver o total inteiro aqui
        // seria pior que devolver zero — a aba mentiria para todo mundo.
        usuarioId
          ? this.prisma.processo.count({ where: e(FILTRO_RAPIDO.meus(usuarioId)) })
          : this.prisma.processo.count({ where: { id: '' } }),
        this.prisma.processo.count({ where: e(FILTRO_RAPIDO.semFiliado()) }),
        this.prisma.processo.count({ where: e(FILTRO_RAPIDO.semReu()) }),
        // 30 dias, e não 7: o índice do CNJ atrasa ~41 dias na mediana, e o
        // contador da aba tem de bater com o que a lista mostra ao clicar.
        this.prisma.processo.count({ where: e(FILTRO_RAPIDO.recentes(30, agora)) }),
        this.prisma.processo.count({ where: e(FILTRO_RAPIDO.urgentes()) }),
      ]);

    return { todos, preProcessuais, meus, semFiliado, semReu, recentes, urgentes };
  }

  /**
   * Ids dos processos cujo JSON de assuntos casa com o termo.
   *
   * SQL cru porque os assuntos vivem num array de objetos JSON, e o Prisma não
   * sabe procurar substring dentro dele. Devolve id, e quem monta a página é o
   * Prisma, com tipo.
   */
  private async idsPorAssunto(termo: string, exato: boolean): Promise<string[]> {
    const alvo = termo.trim();
    if (alvo.length < 3) return [];
    const linhas = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT p.id
      FROM processos p, jsonb_array_elements(coalesce(p.assuntos, '[]'::jsonb)) x
      WHERE CASE WHEN ${exato}
                 THEN btrim(x->>'nome') = ${alvo}
                 ELSE btrim(x->>'nome') ILIKE ${'%' + alvo + '%'}
            END
      LIMIT 2000
    `;
    return linhas.map((l) => l.id);
  }

  async listar(q: ListProcessosQueryDto, usuarioId?: string) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    /**
     * Ordem desconhecida cai no padrão em vez de estourar: o parâmetro vem da
     * URL, e um link antigo ou colado à mão não pode derrubar a tela inteira.
     */
    const ordem = ordemValida(q.ordem);
    const and: Prisma.ProcessoWhereInput[] = [];
    /**
     * PEDIR UM DOS DOIS RÓTULOS DO PRÉ-PROCESSUAL TRAZ OS DOIS.
     *
     * Para quem usa o sistema é um estado só; os dois nomes são acidente da
     * migração (ver `PRE_PROCESSUAIS`). Filtrar pela igualdade crua fazia a aba
     * "Pré-processuais" devolver lista VAZIA justamente onde estava o caso
     * antigo — ele saía da listagem padrão, como pedido, e não voltava por
     * porta nenhuma. O portão logo abaixo já reconhecia os dois; faltava o
     * filtro concordar com ele.
     */
    const porStatus = filtroDeStatus(q.statusInterno);
    if (porStatus) and.push(porStatus);
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
    /**
     * POLO — restringe a QUAL LADO a parte procurada está.
     *
     * Sem ele, procurar "Hapvida" devolve tanto o processo em que ela é ré
     * quanto aquele em que ela figura junto do sindicato, e os dois casos
     * significam coisas opostas. Vale para o filtro por parte cadastrada E
     * para a busca por nome, que é o jeito que se procura no dia a dia.
     */
    const noPolo = q.polo ? { polo: q.polo as PoloProcesso } : {};
    if (q.parteExternaId) {
      and.push({ partes: { some: { parteExternaId: q.parteExternaId, ...noPolo } } });
    } else if (q.polo) {
      // Polo sozinho, sem parte e sem busca: só faz sentido junto de um nome.
      // Sem esta guarda o filtro não faria nada e pareceria quebrado.
      if (!q.busca?.trim()) and.push({ partes: { some: noPolo } });
    }

    // ---- Filtros rápidos da tabela ----
    // "Meus processos": inclui os que o usuário acompanha sem ser o responsável.
    if (q.meus === 'true' && usuarioId) and.push(FILTRO_RAPIDO.meus(usuarioId));
    if (q.semFiliado === 'true') and.push(FILTRO_RAPIDO.semFiliado());
    if (q.semParteContraria === 'true') and.push(FILTRO_RAPIDO.semReu());
    if (q.etiqueta) and.push({ etiquetas: { has: q.etiqueta } });
    if (q.categoria) and.push({ categoria: q.categoria });
    if (q.urgente === 'true') and.push(FILTRO_RAPIDO.urgentes());
    if (q.nossoPapel) and.push(FILTRO_RAPIDO.nossoPapel(q.nossoPapel));
    // "Fase processual": o mesmo critério de `faseDoProcesso`, traduzido para
    // WHERE. As duas leituras têm de coincidir — um processo que a tabela mostra
    // como "Execução" precisa aparecer no filtro "Execução", senão o chip mente.
    if (q.fase) and.push(this.whereFase(q.fase));

    /**
     * O CASO PRÉ-PROCESSUAL FICA FORA DA LISTA POR PADRÃO.
     *
     * São duas filas de trabalho diferentes: uma tem NPU, tribunal e prazo
     * correndo; a outra ainda está sendo negociada e não tem nada disso. Juntas,
     * o pré-processual entra como uma linha quase vazia que empurra para baixo o
     * que a pessoa foi procurar — e estraga a contagem que a diretoria lê.
     *
     * TRÊS PORTAS O TRAZEM DE VOLTA, e nenhuma delas exige lembrar do
     * parâmetro: filtrar pela fase PRÉ-PROCESSUAL, filtrar por
     * `statusInterno=PRE_PROCESSUAL`, ou pedir explicitamente. É o que impede
     * que "sumir da lista padrão" vire "sumir".
     */
    const pediuPreProcessual =
      q.incluirPreProcessuais === 'true' ||
      q.fase === 'PRE_PROCESSUAL' ||
      PRE_PROCESSUAIS.includes(q.statusInterno as StatusProcesso);
    if (!pediuPreProcessual) {
      and.push({ statusInterno: { notIn: PRE_PROCESSUAIS } });
    }
    // "Com movimentação recente": houve andamento (do CNJ ou interno) na janela.
    if (q.movimentacaoRecente) {
      and.push(FILTRO_RAPIDO.recentes(Number(q.movimentacaoRecente) || 30, new Date()));
    }
    const busca = q.busca?.trim();
    /**
     * `?assunto=` — filtro EXATO por assunto, inclusive os secundários.
     *
     * É o link dos cartões do Panorama. Sem ele o atalho mentiria: aquela tela
     * conta os processos em que o assunto aparece em QUALQUER posição (das 24
     * vezes que "Piso Salarial da Categoria" aparece no acervo, só 11 são como
     * principal), e a listagem mostraria menos da metade. Atalho que muda o
     * número ao ser clicado é pior que atalho nenhum.
     *
     * Exato, e não `contains`: "Piso Salarial" é um assunto do CNJ e "Piso
     * Salarial da Categoria/Salário Mínimo Profissional" é outro.
     */
    if (q.assunto) {
      and.push({ id: { in: await this.idsPorAssunto(q.assunto, true) } });
    }

    if (busca) {
      /**
       * A busca livre também alcança os assuntos SECUNDÁRIOS.
       *
       * Antes ela só olhava `assuntoPrincipal`, e quem digitasse "insalubridade"
       * não achava o processo em que o adicional é o segundo pedido. São 177
       * assuntos secundários no acervo — mais que um por processo.
       */
      const porAssunto = await this.idsPorAssunto(busca, false);
      and.push({
        OR: [
          ...(porAssunto.length ? [{ id: { in: porAssunto } }] : []),
          { numeroCNJ: { contains: busca.replace(/\D/g, '') || busca } },
          // PRE_PROCESSUAL não tem NPU nem classe: o `titulo` é a única coisa pela
          // qual ele pode ser encontrado. Sem isto, um processo aberto por um
          // desfecho da agenda era invisível na busca até ser formalizado.
          { titulo: { contains: busca, mode: 'insensitive' } },
          { classeProcessual: { contains: busca, mode: 'insensitive' } },
          { assuntoPrincipal: { contains: busca, mode: 'insensitive' } },
          { filiado: { nomeCompleto: { contains: busca, mode: 'insensitive' } } },
          // Buscar pelo nome de QUALQUER parte — é assim que se acha "todos os
          // processos da Prontocare" digitando o nome dela na busca da tela.
          { partes: { some: { nome: { contains: busca, mode: 'insensitive' }, ...noPolo } } },
        ],
      });
    }
    const where: Prisma.ProcessoWhereInput = and.length ? { AND: and } : {};

    /**
     * UM relógio para a página inteira. Chamar `new Date()` dentro do `map`
     * daria um instante diferente por linha — irrelevante na prática, mas
     * suficiente para um teste de validade ficar intermitente na virada do dia,
     * e teste intermitente é teste que se aprende a ignorar.
     */
    const agoraDaLista = new Date();

    const [total, items] = await this.prisma.$transaction([
      this.prisma.processo.count({ where }),
      this.prisma.processo.findMany({
        where,
        orderBy: ORDENACAO[ordem],
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
          /**
           * A última nota da EQUIPE — só a data.
           *
           * Entra por causa do aviso de dormência: um processo em que o
           * advogado escreveu ontem não está parado, ainda que o tribunal não
           * publique nada há meses. Contar só o andamento do CNJ acusaria de
           * inércia justamente quem está trabalhando o caso por fora do
           * tribunal (negociação, cálculo, contato com o filiado).
           *
           * O painel do advogado já contava as duas fontes; a lista não. Era
           * mais um par de telas prestes a discordar sobre a mesma palavra.
           */
          movimentacoesInternas: {
            /**
             * SEM A PAPELADA DO ROBÔ. "Processo encerrado automaticamente" é
             * escrita do sistema, não trabalho no caso — contá-la fazia a lista
             * dizer que um processo arquivado tinha acabado de se mexer.
             */
            where: { origemSistema: false },
            orderBy: { createdAt: 'desc' },
            take: 1,
            /**
             * `descricao` e `dataFato` entram porque a COLUNA passou a mostrar
             * a última movimentação DE VERDADE, e não só a do CNJ. Era esse
             * descompasso que fazia o chip "7 dias" listar processos com "há 1
             * ano" ao lado: o filtro contava a nota, a coluna mostrava o
             * tribunal, e as duas coisas não conversavam.
             */
            select: { createdAt: true, dataFato: true, descricao: true },
          },
          // Só o resumo: a lista precisa avisar "este processo corre em dois
          // graus" sem carregar os metadados de cada um.
          instancias: {
            select: { grau: true, tribunal: true, baixada: true, principal: true },
            orderBy: { grau: 'asc' },
          },
          // ÚLTIMA MOVIMENTAÇÃO — data + o que foi. A coluna antes mostrava só a
          // CONTAGEM ("203 mov."), que não responde a pergunta que se faz ao
          // abrir a lista: "este processo andou? quando? o quê?".
          movimentacoes: {
            orderBy: { dataMovimento: 'desc' },
            take: 1,
            select: {
              dataMovimento: true, descricao: true, detalhe: true,
              codigoMovimento: true, compromissoId: true,
              // `dispensadoEm` entra porque o aviso passou a respeitá-la: quem
              // dispensou o alerta no radar não pode vê-lo voltar na lista.
              dispensadoEm: true,
            },
          },
          // Existe ato de execução? Uma linha basta — a fase só pergunta "sim ou
          // não", e trazer o histórico inteiro de 200 movimentos por processo só
          // para responder isso custaria a página inteira.
          _count: {
            select: {
              movimentacoes: true, partes: true, advogados: true,
            },
          },
        },
      }),
    ]);

    // Fase de cada processo, na mesma consulta: um `groupBy` sobre os códigos de
    // execução dos processos da página, em vez de N buscas.
    const comExecucao = new Set(
      (
        await this.prisma.movimentacaoProcessual.groupBy({
          by: ['processoId'],
          where: {
            processoId: { in: items.map((p) => p.id) },
            codigoMovimento: { in: [...CODIGOS_TPU_EXECUCAO] },
          },
        })
      ).map((r) => r.processoId),
    );

    return {
      // `confronto` pronto na resposta: a tabela mostra "Autor × Réu" sem
      // reimplementar a regra de qual parte é a principal em cada tela.
      items: items.map(({ partes, ...p }) => ({
        ...p,
        partes,
        confronto: this.partes.agruparPorPolo(partes).confronto,
        fase: faseDoProcesso({
          instancias: p.instancias,
          temMovimentoDeExecucao: comExecucao.has(p.id),
          semNumero: !p.numeroCNJ,
        }),
        alerta: this.alertaDaLinha(
          p.movimentacoes[0],
          dataDaNota(p.movimentacoesInternas[0]),
          p.statusInterno,
          agoraDaLista,
        ),
        /**
         * A ÚLTIMA MOVIMENTAÇÃO DE VERDADE — do tribunal ou nossa.
         *
         * A coluna mostrava só o andamento do CNJ, enquanto o chip "com
         * movimentação recente" contava também a nota da equipe. O resultado na
         * tela: um filtro de sete dias listando processos com "há 1 ano" ao
         * lado, porque as duas coisas respondiam perguntas diferentes com o
         * mesmo nome. Agora a coluna mostra o que o filtro conta.
         *
         * `origem` viaja junto para a tela poder dizer DE ONDE veio: "Publicação"
         * (tribunal) e "Peça protocolada" (equipe) merecem marcas diferentes —
         * sem isso, o andamento interno passaria por publicação oficial.
         */
        ultimaMovimentacao: (() => {
          const cnj = p.movimentacoes[0];
          const nota = p.movimentacoesInternas[0];
          const dNota = dataDaNota(nota);
          if (cnj && (!dNota || cnj.dataMovimento >= dNota)) {
            return {
              data: cnj.dataMovimento,
              descricao: cnj.descricao,
              detalhe: cnj.detalhe,
              origem: 'TRIBUNAL' as const,
            };
          }
          if (nota && dNota) {
            return {
              data: dNota,
              descricao: nota.descricao,
              detalhe: null,
              origem: 'EQUIPE' as const,
            };
          }
          return null;
        })(),
        /**
         * Etiquetas que o sistema mantém sozinho. Derivadas AQUI, na leitura, e
         * nunca gravadas: o que não é armazenado não fica desatualizado.
         */
        etiquetasAutomaticas: etiquetasDerivadas({
          tipoAcao: p.tipoAcao,
          classeProcessual: p.classeProcessual,
          assuntoPrincipal: p.assuntoPrincipal,
        }),
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
    const atual = await this.prisma.processo.findUnique({
      where: { id },
      select: {
        id: true, urgente: true, urgenteMotivo: true, urgenteEm: true, urgentePor: true,
      },
    });
    if (!atual) throw new NotFoundException('Processo não encontrado.');
    if (dto.filiadoId) await this.garantir('filiado', dto.filiadoId);
    if (dto.advogadoId) await this.garantir('user', dto.advogadoId);

    // Mesma regra e mesmo código da agenda: urgência sem motivo não entra.
    const urgencia = montarUrgencia(dto.urgente, dto.urgenteMotivo, { userId: ctx.userId }, atual);

    let categoria: string | null | undefined;
    if (dto.categoria !== undefined) {
      try {
        categoria = normalizarCategoria(dto.categoria);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }

    await this.prisma.processo.update({
      where: { id },
      data: {
        statusInterno: dto.statusInterno,
        etiquetas: dto.etiquetas === undefined ? undefined : this.normalizarEtiquetas(dto.etiquetas),
        // Preenchimento manual do que o CNJ não publica (ver `metadadosGerais`).
        valorCausa: dto.valorCausa === undefined ? undefined : dto.valorCausa,
        categoria,
        ...urgencia,
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
   * AJUIZAR UM CASO PRÉ-PROCESSUAL — o outro lado da criação por desfecho.
   *
   * O advogado tem duas saídas, e as duas são legítimas:
   *  a) informa o NPU e manda buscar no DataJud (`sincronizar: true`) — o
   *     rascunho vira um processo espelhado, com movimentações e tudo;
   *  b) informa o NPU (ou nem isso) e preenche os campos à mão — útil quando o
   *     tribunal ainda não indexou o processo no CNJ, o que é comum nos
   *     primeiros dias após a distribuição.
   *
   * Só sai de PRE_PROCESSUAL quem tem número: é a regra que o CHECK do banco também
   * garante, e o que impede um "processo ativo" que não existe em lugar nenhum.
   */
  async formalizar(id: string, dto: FormalizarProcessoDto, ctx: Ctx) {
    const atual = await this.prisma.processo.findUnique({
      where: { id },
      select: { id: true, numeroCNJ: true, statusInterno: true, titulo: true },
    });
    if (!atual) throw new NotFoundException('Processo não encontrado.');
    if (!PRE_PROCESSUAIS.includes(atual.statusInterno)) {
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
        // Sai de PRE_PROCESSUAL. PENDENTE (distribuído, sem movimentação) é
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
        data: {
          ...this.metadadosGerais(instancias[0], instancias),
          /**
           * Carimbo do parser multi-instância — só quando ele de fato rodou.
           *
           * Com a flag desligada, o cliente lê UM documento e o processo
           * continua sem conhecer os outros graus; marcá-lo como "lido" faria a
           * reavaliação pulá-lo justamente depois de a flag ser ligada, que é
           * quando ele mais precisa ser relido.
           */
          ...(this.datajud.multiInstanciaAtiva ? { instanciasLidasEm: new Date() } : {}),
        },
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
    if (!processo || !processo.instancias.length) return;

    const viva = temInstanciaViva(processo.instancias);

    /**
     * O OUTRO LADO DA TRAVA: processo ATIVO com todas as instâncias baixadas.
     *
     * A reavaliação só sabia REABRIR, então a lista exibia "todas baixadas" ao
     * lado de "Ativo · Fase de Execução" — duas afirmações que não podem ser
     * verdade juntas. Agora, quando o CNJ diz que todos os graus acabaram e não
     * há movimento depois da baixa em nenhum deles, o processo é encerrado.
     *
     * NÃO mexe em ARQUIVADO, SUSPENSO, IMPROCEDENTE, GANHO_EXECUCAO nem
     * PRE_PROCESSUAL: são decisões da equipe, e o robô não desfaz o que alguém
     * decidiu. Só ATIVO e PENDENTE — os dois estados que o próprio sistema
     * atribui — entram nesta conta.
     */
    if (!viva && (processo.statusInterno === 'ATIVO' || processo.statusInterno === 'PENDENTE')) {
      const graus = processo.instancias.map((i) => i.grau).join(', ');
      await this.prisma.processo.update({
        where: { id: processoId },
        data: { statusInterno: 'ENCERRADO' },
      });
      await this.prisma.movimentacaoInterna.create({
        data: {
          processoId,
          tipo: 'ATUALIZACAO',
          descricao:
            `Processo encerrado automaticamente: todas as instâncias (${graus}) receberam ` +
            'baixa definitiva ou trânsito em julgado, sem movimentação posterior. ' +
            'Se a execução continuar, o robô reabre sozinho na próxima movimentação.',
          statusAnterior: processo.statusInterno,
          statusNovo: 'ENCERRADO',
          notaInterna: false,
        // Papelada do robô: não conta como andamento do processo, nem no
        // filtro "movimentação recente" nem na ordenação. Ver `origemSistema`.
        origemSistema: true,
        },
      });
      this.logger.log(`[DATAJUD] ${processo.numeroCNJ}: encerrado — todas as instâncias baixadas.`);
      return;
    }

    /**
     * PENDENTE QUE FINALMENTE APARECEU NO CNJ VIRA ATIVO.
     *
     * O CASO. Todo processo cadastrado à mão nasce PENDENTE — é o padrão em
     * `criar()`. O rótulo quer dizer "distribuído, aguardando movimentação", e
     * é honesto no primeiro dia: o índice público do CNJ leva dias para
     * conhecer um processo recém-distribuído, então a ficha abre vazia mesmo.
     *
     * O BURACO. A reavaliação sabia encerrar e sabia reabrir, e não sabia esta
     * terceira transição. O processo era preenchido pelo robô — classe, vara,
     * quarenta andamentos — e continuava PENDENTE para sempre, dizendo
     * "aguardando movimentação" com a movimentação toda na tela ao lado.
     *
     * E NÃO ERA SÓ O RÓTULO. A carteira do advogado no painel conta
     * `statusInterno: ATIVO`; um processo travado em PENDENTE não aparecia
     * nela. É o mesmo defeito do "A ajuizar: 0" — um ZERO, que ninguém
     * questiona, escondendo trabalho real de alguém.
     *
     * A condição é a definição do próprio rótulo lida ao contrário: se há
     * instância viva E já existe andamento, então não se está mais aguardando
     * movimentação. Nada de adivinhação — é o CNJ afirmando que o processo
     * corre.
     */
    if (processo.statusInterno === 'PENDENTE' && viva) {
      const andamentos = await this.prisma.movimentacaoProcessual.count({
        where: { processoId },
      });
      if (andamentos > 0) {
        await this.prisma.processo.update({
          where: { id: processoId },
          data: { statusInterno: 'ATIVO' },
        });
        await this.prisma.movimentacaoInterna.create({
          data: {
            processoId,
            tipo: 'ATUALIZACAO',
            descricao:
              `Processo passou a Ativo: o CNJ publicou o processo e ele já registra ` +
              `${andamentos} andamento(s). Enquanto o índice do tribunal não o conhecia, ` +
              'ele ficou como Pendente (distribuído, aguardando movimentação).',
            statusAnterior: 'PENDENTE',
            statusNovo: 'ATIVO',
            notaInterna: false,
        // Papelada do robô: não conta como andamento do processo, nem no
        // filtro "movimentação recente" nem na ordenação. Ver `origemSistema`.
        origemSistema: true,
          },
        });
        this.logger.log(
          `[DATAJUD] ${processo.numeroCNJ}: PENDENTE → ATIVO (${andamentos} andamento(s) no CNJ).`,
        );
      }
      return;
    }

    if (processo.statusInterno !== 'ENCERRADO' || !viva) return;

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
        // Papelada do robô: não conta como andamento do processo, nem no
        // filtro "movimentação recente" nem na ordenação. Ver `origemSistema`.
        origemSistema: true,
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
          `A parte institucional (${tenant.sigla}) não está cadastrada. ` +
            'Cadastre-a em Partes e marque-a como institucional.',
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
  /**
   * PREENCHE A ÁREA JURÍDICA quando ninguém a informou.
   *
   * Em 31/08/2026, 42 dos 127 processos da produção estavam sem `categoria` —
   * um terço da base. Não é campo decorativo: é por ele que se filtra a
   * carteira e se conta quantas ações de cada matéria o sindicato tem em curso.
   * Com um terço em branco, todo relatório por área mentia por omissão.
   *
   * E a informação já estava lá: o tribunal diz o ramo da Justiça, o polo
   * passivo diz se o adversário é o poder público. Pedir que alguém
   * reclassificasse 42 processos à mão seria pedir que redigitasse o que o
   * sistema acabou de receber do CNJ.
   *
   * NUNCA SOBRESCREVE. Só age sobre o vazio — a classificação de uma pessoa
   * vale mais que a dedução, inclusive quando discordam. E deduz apenas quando
   * os sinais bastam: `areaSugerida` devolve nulo em vez de chutar.
   *
   * Fica registrado no histórico do processo, com o motivo, para que quem
   * discordar saiba de onde veio o rótulo e possa trocá-lo.
   */
  private async deduzirAreaJuridica(processoId: string) {
    const p = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: {
        categoria: true, tribunal: true, classeProcessual: true,
        assuntoPrincipal: true, tipoAcao: true,
        partes: { where: { polo: 'PASSIVO' }, select: { parteExterna: { select: { tipo: true } } } },
      },
    });
    if (!p || p.categoria) return;

    const deduzida = areaSugerida({
      tribunal: p.tribunal,
      classeProcessual: p.classeProcessual,
      assuntoPrincipal: p.assuntoPrincipal,
      tipoAcao: p.tipoAcao,
      reuPublico: p.partes.some((x) => x.parteExterna?.tipo === 'ORGAO_PUBLICO'),
    });
    if (!areaSugeridaValida(deduzida)) return;

    await this.prisma.processo.update({
      where: { id: processoId },
      data: { categoria: deduzida!.slug },
    });
    await this.prisma.movimentacaoInterna.create({
      data: {
        processoId,
        tipo: 'ATUALIZACAO',
        descricao:
          `Área jurídica definida automaticamente como "${AREA_LABEL[deduzida!.slug] ?? deduzida!.slug}" ` +
          `— ${deduzida!.porque}. Troque na ficha se discordar.`,
        notaInterna: true,
        // É o robô falando: não conta como movimentação do processo nem sobe a
        // linha na ordenação por andamento recente.
        origemSistema: true,
      },
    });
  }

  private async dispararAutomacao(processoId: string) {
    // ANTES DE TUDO: amarra as movimentações novas às publicações do DJEN que já
    // viraram atividade. É o fecho do circuito anti-duplicata — quando a
    // publicação chega primeiro (o que é comum, porque o diário sai antes de o
    // tribunal alimentar o índice do CNJ), a movimentação correspondente entra
    // aqui carimbada e o robô a pula pela trava que ele sempre teve.
    await this.correlacao.vincularMovimentacoesNovas(processoId);

    const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const pendentes = await this.prisma.movimentacaoProcessual.findMany({
      where: {
        processoId,
        compromissoId: null,
        dataMovimento: { gte: desde },
        // Dispensado no radar = "não é audiência" ou "já resolvi por fora".
        // Sem isto, a tarefa de confirmar a data da audiência voltaria a ser
        // criada toda noite depois de a pessoa ter dispensado o alerta.
        dispensadoEm: null,
      },
      orderBy: { dataMovimento: 'desc' },
      take: 50,
      select: {
        id: true, descricao: true, detalhe: true, conteudo: true, codigoMovimento: true,
        dataMovimento: true, ehAudiencia: true, audienciaData: true, compromissoId: true,
        complementos: true,
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
  private metadados(dados: ProcessoDatajud, sigla: string, todas: InstanciaDatajud[] = []) {
    return {
      ...this.metadadosGerais(dados, todas),
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
  private metadadosGerais(dados: ProcessoDatajud, todas: InstanciaDatajud[] = []) {
    /**
     * ASSUNTO É DE INSTÂNCIA, mas o processo precisa do conjunto.
     *
     * Em 4 dos 5 processos da produção os assuntos DIFEREM entre os graus — o 1º
     * trata de "Adicional de Insalubridade" e o 2º de "Multa de 40% do FGTS", no
     * mesmo processo. Guardar só os de uma instância (a primeira que o
     * Elasticsearch devolvesse) descartava o resto e, com ele, a etiqueta de
     * perícia, que lê justamente o assunto.
     *
     * Aqui vai a UNIÃO, sem repetir, começando pelos da instância escolhida
     * como referência — é o que a busca e as etiquetas precisam ver.
     */
    const vistos = new Set<string>();
    const assuntos: { nome: string | null; codigo: number | null; principal?: boolean }[] = [];
    for (const fonte of [dados, ...todas]) {
      for (const a of fonte.assuntos ?? []) {
        const chave = `${a.codigo ?? ''}|${(a.nome ?? '').trim().toUpperCase()}`;
        if (!a.nome || vistos.has(chave)) continue;
        vistos.add(chave);
        assuntos.push(a);
      }
    }

    return {
      assuntoPrincipal: dados.assuntoPrincipal,
      assuntos: (assuntos.length ? assuntos : (dados.assuntos ?? [])) as unknown as Prisma.InputJsonValue,
      municipioIBGE: dados.municipioIBGE,
      segredoJustica: dados.segredoJustica,
      prioridades: (dados.prioridades ?? []) as unknown as Prisma.InputJsonValue,
      // Só sobrescreve as partes quando o tribunal mandou alguma (não apaga o
      // que já havia numa sincronização que veio sem o bloco de partes).
      ...(dados.partes?.length
        ? { partesBrutas: dados.partes as unknown as Prisma.InputJsonValue }
        : {}),
      /**
       * VALOR DA CAUSA — mesma regra, e por um motivo concreto: a API pública do
       * CNJ NÃO publica este campo (conferido com `exists: valorCausa` nos
       * índices do TRT22 e do TJPI: zero documentos). Escrever `?? null` a cada
       * sincronização apagava, toda madrugada, o valor que alguém tivesse
       * digitado à mão — um dado some sem ninguém mexer nele, que é o pior tipo
       * de bug. Só grava quando o tribunal de fato informou.
       */
      ...(dados.valorCausa != null ? { valorCausa: dados.valorCausa } : {}),
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
