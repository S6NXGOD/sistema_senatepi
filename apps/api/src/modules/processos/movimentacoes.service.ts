import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { atoAcionavel, atoCritico } from './utils/tpu.util';
import { CODIGOS_TPU_EXECUCAO, faseDoProcesso } from './utils/fase.util';
import { etiquetasDerivadas } from './utils/etiquetas.util';
import { AuditService } from '../../common/audit/audit.service';
import { PartesService, PARTE_INCLUDE, PARTE_ORDER, ADVOGADO_INCLUDE } from './partes.service';
import {
  CORES_ANDAMENTO, CriarTipoAndamentoDto, AtualizarTipoAndamentoDto, RegistrarMovimentacaoDto,
} from './dto/movimentacoes.dto';

interface Ctx {
  userId?: string;
  role?: UserRole;
  ip?: string;
  userAgent?: string;
}

const TIPO_SELECT = {
  id: true, slug: true, nome: true, cor: true, ordem: true, ativo: true, sistema: true,
} satisfies Prisma.TipoAndamentoSelect;

const autorSel = { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } } as const;

/**
 * Nome -> slug estavel (MAIUSCULAS, sem acento, so A-Z/0-9/_).
 * NFD separa a letra-base do acento; removemos o que nao for ASCII basico.
 */
function slugificar(nome: string): string {
  const semAcento = nome.normalize('NFD').replace(/[^\x00-\x7F]/g, '');
  const base = semAcento
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'TIPO';
}

@Injectable()
export class MovimentacoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly partes: PartesService,
  ) {}

  // =========================================================================
  // Tipos de movimentação (cadastráveis)
  // =========================================================================

  listarTipos(incluirInativos = false) {
    return this.prisma.tipoAndamento.findMany({
      where: incluirInativos ? {} : { ativo: true },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
      select: TIPO_SELECT,
    });
  }

  async criarTipo(dto: CriarTipoAndamentoDto, ctx: Ctx) {
    const cor = this.validarCor(dto.cor);
    const slug = await this.slugUnico(slugificar(dto.nome));
    const ordem = dto.ordem ?? (await this.proximaOrdem());

    const tipo = await this.prisma.tipoAndamento.create({
      data: { slug, nome: dto.nome.trim(), cor, ordem, sistema: false },
      select: TIPO_SELECT,
    });
    await this.auditar(AcaoAuditoria.CREATE, 'TipoAndamento', tipo.id, ctx,
      `Tipo de movimentação "${tipo.nome}" criado`);
    return tipo;
  }

  async atualizarTipo(id: string, dto: AtualizarTipoAndamentoDto, ctx: Ctx) {
    const atual = await this.prisma.tipoAndamento.findUnique({ where: { id }, select: TIPO_SELECT });
    if (!atual) throw new NotFoundException('Tipo de movimentação não encontrado.');

    const tipo = await this.prisma.tipoAndamento.update({
      where: { id },
      data: {
        nome: dto.nome?.trim(),
        cor: dto.cor !== undefined ? this.validarCor(dto.cor) : undefined,
        ordem: dto.ordem,
        ativo: dto.ativo,
      },
      select: TIPO_SELECT,
    });
    await this.auditar(AcaoAuditoria.UPDATE, 'TipoAndamento', id, ctx,
      `Tipo de movimentação "${tipo.nome}" atualizado`);
    return tipo;
  }

  async removerTipo(id: string, ctx: Ctx) {
    const tipo = await this.prisma.tipoAndamento.findUnique({ where: { id }, select: TIPO_SELECT });
    if (!tipo) throw new NotFoundException('Tipo de movimentação não encontrado.');
    if (tipo.sistema) {
      throw new BadRequestException('Tipos padrão do sistema não podem ser excluídos — você pode ocultá-los (desativar).');
    }
    const emUso = await this.prisma.movimentacaoInterna.count({ where: { tipo: tipo.slug } });
    if (emUso > 0) {
      throw new ConflictException(
        `Este tipo está em uso por ${emUso} movimentação(ões). Desative-o em vez de excluir para preservar o histórico.`,
      );
    }
    await this.prisma.tipoAndamento.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, 'TipoAndamento', id, ctx,
      `Tipo de movimentação "${tipo.nome}" excluído`);
    return { ok: true };
  }

  // =========================================================================
  // Movimentações internas (andamentos registrados pela equipe)
  // =========================================================================

  /**
   * Registra um andamento no processo. Opcionalmente muda o status (carimbando
   * de/para na própria movimentação, para a linha do tempo contar a história) e
   * vincula um anexo já enviado.
   */
  async registrar(processoId: string, dto: RegistrarMovimentacaoDto, ctx: Ctx) {
    const processo = await this.prisma.processo.findUnique({
      where: { id: processoId },
      select: { id: true, numeroCNJ: true, statusInterno: true },
    });
    if (!processo) throw new NotFoundException('Processo não encontrado.');

    const tipo = await this.prisma.tipoAndamento.findUnique({
      where: { slug: dto.tipo },
      select: { slug: true, nome: true, ativo: true },
    });
    if (!tipo) throw new BadRequestException('Tipo de movimentação inválido.');
    if (!tipo.ativo) throw new BadRequestException('Este tipo de movimentação está desativado.');

    // O anexo precisa pertencer a ESTE processo (evita vincular arquivo alheio).
    if (dto.anexoId) {
      const anexo = await this.prisma.anexoDocumento.findUnique({
        where: { id: dto.anexoId },
        select: { processoId: true },
      });
      if (!anexo || anexo.processoId !== processoId) {
        throw new BadRequestException('Anexo inválido para este processo.');
      }
    }

    const mudaStatus = !!dto.novoStatus && dto.novoStatus !== processo.statusInterno;
    const dataFato = this.validarDataFato(dto.dataFato);

    const mov = await this.prisma.$transaction(async (tx) => {
      const criada = await tx.movimentacaoInterna.create({
        data: {
          processoId,
          tipo: tipo.slug,
          descricao: dto.descricao.trim(),
          dataFato,
          notaInterna: dto.notaInterna ?? false,
          anexoId: dto.anexoId || null,
          autorId: ctx.userId ?? null,
          statusAnterior: mudaStatus ? processo.statusInterno : null,
          statusNovo: mudaStatus ? dto.novoStatus : null,
        },
      });
      if (mudaStatus) {
        await tx.processo.update({
          where: { id: processoId },
          data: { statusInterno: dto.novoStatus },
        });
      }
      return criada;
    });

    await this.auditar(AcaoAuditoria.CREATE, 'MovimentacaoInterna', mov.id, ctx,
      `Movimentação "${tipo.nome}" registrada no processo ${processo.numeroCNJ}` +
        (dataFato ? ` (fato em ${dataFato.toLocaleDateString('pt-BR')})` : '') +
        (mudaStatus ? ` (status ${processo.statusInterno} → ${dto.novoStatus})` : ''),
      {
        processoId, tipo: tipo.slug, notaInterna: mov.notaInterna, mudouStatus: mudaStatus,
        dataFato: dataFato?.toISOString() ?? null,
      });
    return mov;
  }

  /**
   * Data do fato: aceita só o passado (com 1 dia de folga para fuso). Registrar
   * um ato "que aconteceu semana que vem" seria um erro de digitação, não uma
   * intenção — e furaria a ordenação da linha do tempo. Compromisso futuro é
   * papel da Agenda, não do histórico.
   */
  private validarDataFato(iso?: string): Date | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Data do fato inválida.');
    const limite = new Date(Date.now() + 24 * 3600 * 1000);
    if (d > limite) {
      throw new BadRequestException(
        'A data do fato não pode ser no futuro — para algo que ainda vai acontecer, use a Agenda.',
      );
    }
    return d;
  }

  /**
   * Exclui um andamento. Só o Administrador (regra global) — mas se a
   * movimentação tinha carimbado uma mudança de status, o status NÃO é revertido
   * automaticamente: reverter às cegas poderia contradizer andamentos posteriores.
   */
  async remover(id: string, ctx: Ctx) {
    const mov = await this.prisma.movimentacaoInterna.findUnique({
      where: { id },
      select: { id: true, tipo: true, processo: { select: { numeroCNJ: true } } },
    });
    if (!mov) throw new NotFoundException('Movimentação não encontrada.');

    await this.prisma.movimentacaoInterna.delete({ where: { id } });
    await this.auditar(AcaoAuditoria.DELETE, 'MovimentacaoInterna', id, ctx,
      `Movimentação removida do processo ${mov.processo.numeroCNJ}`, { tipo: mov.tipo });
    return { ok: true };
  }

  // =========================================================================
  // DOSSIÊ consolidado do processo (uma chamada → a tela inteira)
  // =========================================================================

  async dossie(processoId: string, ctx: Ctx) {
    const processo = await this.prisma.processo.findUnique({
      where: { id: processoId },
      include: {
        filiado: {
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true, situacao: true,
            telefonePrincipal: true, email: true, formacao: true,
          },
        },
        advogado: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } },
        // Partes (polo ativo × passivo) e a equipe que atua no processo.
        partes: { orderBy: PARTE_ORDER, include: PARTE_INCLUDE },
        advogados: {
          orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }],
          include: ADVOGADO_INCLUDE,
        },
        // Instâncias do processo: a timeline etiqueta cada andamento com o grau
        // que o praticou, e sem isto "Conclusão" do 1º e do 2º grau apareceriam
        // lado a lado, na mesma lista, sem nada que os distinguisse.
        instancias: {
          orderBy: [{ baixada: 'asc' }, { ultimoMovimentoEm: 'desc' }],
          include: { _count: { select: { movimentacoes: true } } },
        },
        movimentacoes: { orderBy: { dataMovimento: 'desc' } },
        movimentacoesInternas: {
          // Pela data do FATO quando informada; senão pela do registro.
          orderBy: [{ dataFato: 'desc' }, { createdAt: 'desc' }],
          include: {
            autor: autorSel,
            anexo: { select: { id: true, nomeArquivo: true, url: true, tipoMime: true, tamanhoBytes: true } },
          },
        },
        // Triagem(ns) que originaram/citam este processo.
        atendimentos: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, numero: true, canal: true, desfecho: true, createdAt: true,
            atendente: { select: { id: true, nome: true, nomeExibicao: true } },
          },
        },
        // Agenda vinculada (audiências, prazos, consultas). O DESFECHO vem
        // junto: "CONCLUIDO" sozinho não diz se houve acordo ou se o prazo foi
        // perdido, que é exatamente o que se procura aqui.
        compromissos: {
          orderBy: { inicio: 'desc' },
          select: {
            id: true, titulo: true, tipo: true, status: true, inicio: true, fim: true,
            local: true, urgente: true, origemAutomatica: true, descricao: true,
            desfecho: true, desfechoObs: true, concluidoEm: true,
            canceladoCategoria: true, canceladoMotivo: true,
            responsavel: { select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true } },
          },
        },
        anexos: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!processo) throw new NotFoundException('Processo não encontrado.');
    const polos = this.partes.agruparPorPolo(processo.partes);

    // Notas internas não vão para quem só pode VISUALIZAR o módulo? Aqui a regra
    // é mais simples e explícita: nota interna é da equipe — todos os perfis com
    // acesso ao módulo veem, mas o front a marca visualmente para não vazar em
    // impressões/extratos entregues ao filiado.
    const { movimentacoesInternas, movimentacoes, ...resto } = processo;

    // Linha do tempo UNIFICADA (DataJud + interna), mais recente primeiro.
    // Grau de cada instância, para etiquetar os andamentos sem um join por linha.
    const grauPorInstancia = new Map(resto.instancias.map((i) => [i.id, i.grau]));

    const linhaDoTempo = [
      ...movimentacoes.map((m) => ({
        id: m.id,
        origem: 'DATAJUD' as const,
        data: m.dataMovimento,
        descricao: m.descricao,
        codigoMovimento: m.codigoMovimento,
        /** Grau que praticou o ato. Null no histórico anterior às instâncias. */
        grau: m.instanciaId ? (grauPorInstancia.get(m.instanciaId) ?? null) : null,
        instanciaId: m.instanciaId,
        // Detalhamento do ato: é o que evita o advogado abrir o PJe.
        detalhe: m.detalhe,
        conteudo: m.conteudo,
        complementos: m.complementos,
        orgaoJulgador: m.orgaoJulgador,
        ehAudiencia: m.ehAudiencia,
        audienciaData: m.audienciaData,
      })),
      ...movimentacoesInternas.map((m) => ({
        id: m.id,
        origem: 'INTERNA' as const,
        // `data` é o que a timeline ordena e exibe: a data do FATO quando
        // informada. Assim a audiência de quarta lançada na sexta aparece na
        // quarta, ao lado das movimentações do CNJ do mesmo dia.
        data: m.dataFato ?? m.createdAt,
        /** Data do fato explícita (null = a movimentação vale pelo registro). */
        dataFato: m.dataFato,
        /** Carimbo de auditoria — a tela mostra "registrado em" quando difere. */
        registradoEm: m.createdAt,
        descricao: m.descricao,
        tipo: m.tipo,
        notaInterna: m.notaInterna,
        statusAnterior: m.statusAnterior,
        statusNovo: m.statusNovo,
        autor: m.autor,
        anexo: m.anexo,
      })),
    ].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    // Trilha de auditoria do processo e dos seus andamentos.
    const idsAndamentos = movimentacoesInternas.map((m) => m.id);
    const auditoria = await this.prisma.auditoria.findMany({
      where: {
        OR: [
          { entidade: 'Processo', entidadeId: processoId },
          ...(idsAndamentos.length ? [{ entidade: 'MovimentacaoInterna', entidadeId: { in: idsAndamentos } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, acao: true, entidade: true, descricao: true, createdAt: true, metadata: true,
        user: { select: { id: true, nome: true, nomeExibicao: true } },
      },
    });

    return {
      ...resto,
      movimentacoes, // cru do DataJud (compatibilidade)
      movimentacoesInternas,
      linhaDoTempo,
      /** Partes agrupadas + o confronto "Autor × Réu" pronto para o cabeçalho. */
      polos,
      /** Atos recentes que pedem o olho de alguém (ver utils/tpu.util.ts). */
      atencao: this.atencaoRequerida(movimentacoes),
      /** Por onde o processo passou — derivado, sem tabela nova. */
      historicoOrgaos: this.historicoOrgaos(movimentacoes),
      /**
       * Os atos que ENCERRARAM o processo, em ordem. Existe para a ficha poder
       * responder "por que isto está arquivado?" com fato, e não com rótulo.
       *
       * A pergunta foi feita de verdade: um processo com a etiqueta "Fase de
       * Execução" apareceu como Arquivado e pareceu erro do sistema. Não era —
       * a execução tinha sido extinta em novembro e o processo arquivado em
       * fevereiro. O sistema sabia disso e não mostrava; a etiqueta, escrita à
       * mão meses antes, era a única coisa visível. Um rótulo que ninguém
       * consegue conferir vira desconfiança do sistema inteiro.
       */
      marcosDoEncerramento: this.marcosDoEncerramento(movimentacoes),
      /** Etiquetas mantidas pelo sistema — derivadas na leitura (ver util). */
      etiquetasAutomaticas: etiquetasDerivadas({
        tipoAcao: resto.tipoAcao,
        classeProcessual: resto.classeProcessual,
        assuntoPrincipal: resto.assuntoPrincipal,
      }),
      /**
       * Fase processual, pela MESMA regra da lista (`fase.util.ts`). Vem daqui
       * para a ficha e a lista nunca discordarem — e é ela que sustenta o aviso
       * de etiqueta conflitante ("Fase de Execução" num processo em grau
       * recursal).
       */
      fase: faseDoProcesso({
        instancias: processo.instancias ?? [],
        semNumero: !processo.numeroCNJ,
        temMovimentoDeExecucao: movimentacoes.some(
          (m) => m.codigoMovimento != null && CODIGOS_TPU_EXECUCAO.includes(m.codigoMovimento as 11384 | 11385),
        ),
      }),
      auditoria,
      totais: {
        datajud: movimentacoes.length,
        internas: movimentacoesInternas.length,
        anexos: processo.anexos.length,
        compromissos: processo.compromissos.length,
        partes: processo.partes.length,
        advogados: processo.advogados.length,
        // Filiados vinculados: um processo coletivo tem vários.
        filiados: processo.partes.filter((p) => p.filiadoId).length,
      },
    };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private validarCor(cor?: string): string {
    if (!cor) return 'slate';
    return (CORES_ANDAMENTO as readonly string[]).includes(cor) ? cor : 'slate';
  }

  private async proximaOrdem(): Promise<number> {
    const ultimo = await this.prisma.tipoAndamento.aggregate({ _max: { ordem: true } });
    return (ultimo._max.ordem ?? 0) + 1;
  }

  private async slugUnico(base: string): Promise<string> {
    let slug = base;
    let n = 1;
    while (await this.prisma.tipoAndamento.findUnique({ where: { slug }, select: { id: true } })) {
      n += 1;
      slug = `${base}_${n}`.slice(0, 40);
    }
    return slug;
  }

  private auditar(
    acao: AcaoAuditoria,
    entidade: string,
    entidadeId: string,
    ctx: Ctx,
    descricao: string,
    metadata: Prisma.InputJsonValue = {},
  ) {
    return this.audit.registrar({
      userId: ctx.userId ?? null, acao, entidade, entidadeId, descricao,
      ip: ctx.ip, userAgent: ctx.userAgent, metadata,
    });
  }

  /**
   * Atos recentes que pedem atenção — e que AINDA NÃO viraram atividade.
   *
   * A condição `compromissoId: null` é o que separa alerta de ruído. O robô de
   * prazos já transforma em tarefa o que reconhece; o que sobra aqui é
   * justamente o que ele NÃO pegou — e é isso que alguém precisa olhar. Sem
   * esse recorte, a ficha marcaria "atenção" em todo processo movimentado,
   * inclusive nos que já estão devidamente na agenda, e a marca perderia valor
   * em uma semana.
   *
   * Janela de 30 dias: a mesma do robô. Ato de meses atrás não é pendência, é
   * histórico.
   */
  /**
   * Linha do tempo do fim: baixa, trânsito, extinção da execução, arquivamento
   * e eventual desarquivamento — só o que muda o ciclo de vida.
   *
   * Devolve vazio quando não houve nenhum: processo em curso não precisa
   * explicar que está em curso.
   */
  private marcosDoEncerramento(
    movimentacoes: { dataMovimento: Date; descricao: string; codigoMovimento: number | null }[],
  ) {
    /**
     * O RÓTULO VEM DO DICIONÁRIO — só o que ele não tem fica aqui.
     *
     * Esta era a TERCEIRA tabela de códigos TPU do sistema, e já tinha
     * divergido: 196 se chamava "Extinção da execução" aqui e "Execução
     * extinta" em `tpu.util.ts`. Duas telas, dois nomes, o mesmo ato — o começo
     * exato do problema que custou os onze selos falsos da listagem.
     *
     * Os dois códigos de execução ficam de fora do dicionário DE PROPÓSITO (ver
     * `CODIGOS_IGNORADOS_DE_PROPOSITO`): não devem virar aviso, porque já
     * mudam a fase do processo. Mas são marcos legítimos da linha do tempo, e
     * por isso ganham rótulo só aqui.
     */
    const SO_DAQUI: Record<number, string> = {
      11384: 'Liquidação iniciada',
      11385: 'Execução iniciada',
    };
    const rotuloDoMarco = (codigo: number): string | null =>
      SO_DAQUI[codigo] ??
      (atoCritico(codigo)?.nivel === 'ENCERRAMENTO' ? atoCritico(codigo)!.rotulo : null);

    return movimentacoes
      .filter((m) => m.codigoMovimento != null && rotuloDoMarco(m.codigoMovimento))
      .map((m) => ({
        codigo: m.codigoMovimento as number,
        rotulo: rotuloDoMarco(m.codigoMovimento as number) as string,
        data: m.dataMovimento,
        /** Reabre o ciclo: serve para a tela mostrar que o fim não foi o fim. */
        reabre: m.codigoMovimento === 893 || m.codigoMovimento === 11385 || m.codigoMovimento === 11384,
      }))
      .sort((a, b) => a.data.getTime() - b.data.getTime());
  }

  /**
   * Atos recentes que ainda pedem providência.
   *
   * A janela, a dispensa e o complemento agora moram todos em `atoAcionavel` —
   * antes esta função tinha a sua própria janela de 30 dias e a lista de
   * processos não tinha nenhuma, e as duas telas mostravam coisas diferentes
   * para o mesmo processo. Cada nível tem a sua validade (prazo 30 dias,
   * decisão 90), e é o dicionário que decide, não o chamador.
   */
  private atencaoRequerida(
    movimentacoes: {
      dataMovimento: Date;
      descricao: string;
      codigoMovimento: number | null;
      detalhe: string | null;
      compromissoId: string | null;
      dispensadoEm: Date | null;
    }[],
  ) {
    const agora = new Date();
    const itens = movimentacoes
      .flatMap((m) => {
        const ato = atoAcionavel(m, agora);
        return ato ? [{ nivel: ato.nivel, rotulo: ato.rotulo, data: m.dataMovimento, descricao: m.descricao }] : [];
      })
      .sort((a, b) => b.data.getTime() - a.data.getTime());

    return {
      total: itens.length,
      // O nível mais grave manda na cor da etiqueta: uma tutela pesa mais que um
      // prazo, e um prazo correndo pesa mais que uma decisão a ler.
      nivel: itens.find((i) => i.nivel === 'URGENTE')?.nivel
        ?? itens.find((i) => i.nivel === 'PRAZO')?.nivel
        ?? itens.find((i) => i.nivel === 'DECISAO')?.nivel
        ?? itens[0]?.nivel
        ?? null,
      itens: itens.slice(0, 5),
    };
  }

  /**
   * Por onde o processo passou, em ordem cronológica.
   *
   * DERIVADO das movimentações, sem tabela nova: cada andamento já guarda o
   * órgão que o praticou (`orgaoJulgador`), então a redistribuição aparece
   * sozinha como uma troca de órgão entre um ato e o seguinte. Uma tabela de
   * histórico exigiria migração, backfill e um segundo lugar para manter em dia
   * — e diria exatamente a mesma coisa que os dados já dizem.
   *
   * Retorna só as TROCAS, não um item por andamento.
   */
  private historicoOrgaos(movimentacoes: { dataMovimento: Date; orgaoJulgador: string | null }[]) {
    const cronologico = [...movimentacoes]
      .filter((m) => !!m.orgaoJulgador)
      .sort((a, b) => a.dataMovimento.getTime() - b.dataMovimento.getTime());

    const trechos: { orgao: string; de: Date; ate: Date; atos: number }[] = [];
    for (const m of cronologico) {
      const atual = trechos[trechos.length - 1];
      if (atual && atual.orgao === m.orgaoJulgador) {
        atual.ate = m.dataMovimento;
        atual.atos++;
      } else {
        trechos.push({ orgao: m.orgaoJulgador!, de: m.dataMovimento, ate: m.dataMovimento, atos: 1 });
      }
    }
    // Mais recente primeiro, como todo o resto da ficha.
    return trechos.reverse();
  }

}
