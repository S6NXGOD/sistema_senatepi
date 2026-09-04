import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { AcaoAuditoria, PoloProcesso, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  AdicionarParteDto, AtualizarParteDto, DefinirAdvogadosDto,
} from './dto/partes.dto';

interface Ctx {
  userId?: string;
  role?: UserRole;
  ip?: string;
  userAgent?: string;
}

/** Campos da parte devolvidos à tela (com os cadastros que ela referencia). */
export const PARTE_INCLUDE = {
  filiado: { select: { id: true, nomeCompleto: true, matricula: true, situacao: true } },
  parteExterna: {
    /**
     * `institucional` VIAJA ATÉ A TELA, e não é detalhe de cadastro.
     *
     * A lista de processos escondia o nome do autor em toda ação
     * INSTITUCIONAL, na premissa de que o autor é sempre o sindicato — e o selo
     * ao lado já diria isso. A premissa é falsa quando o sindicato é RÉU: hoje
     * há três processos assim (SINSEP, SINDHOSPI e uma contabilidade nos
     * processando). Sem esta flag, a tela não tem como distinguir, e a linha
     * passa a esconder justamente quem está nos processando.
     */
    select: {
      id: true, tipo: true, nome: true, nomeFantasia: true,
      documento: true, ativo: true, institucional: true,
    },
  },
} satisfies Prisma.ParteProcessoInclude;

export const ADVOGADO_INCLUDE = {
  advogado: {
    select: { id: true, nome: true, nomeExibicao: true, avatarUrl: true, avatarKey: true, oab: true, oabUf: true, ativo: true },
  },
} satisfies Prisma.ProcessoAdvogadoInclude;

/** Ordem de exibição: ativo → passivo → terceiros; principal sempre no topo. */
export const PARTE_ORDER: Prisma.ParteProcessoOrderByWithRelationInput[] = [
  { polo: 'asc' },
  { principal: 'desc' },
  { createdAt: 'asc' },
];

/** Papel padrão por polo quando a equipe não informa (rótulo neutro e correto). */
const PAPEL_PADRAO: Record<PoloProcesso, string> = {
  ATIVO: 'Autor',
  PASSIVO: 'Réu',
  TERCEIRO: 'Terceiro interessado',
};

/**
 * PartesService — quem processou quem, quem defende e quem é o filiado.
 *
 * Cobre três coisas que a tela trata como uma só:
 *  1) PARTES do processo (polo ativo × passivo × terceiros) — o "sindicato
 *     contra a empresa ré". Dado 100% nosso: a API Pública do DataJud não devolve
 *     partes (confirmado em TJPI, TRT22, TJSP e TRF1).
 *  2) FILIADOS vinculados — são partes com `filiadoId`, então um processo pode
 *     ter vários (ação plúrima/coletiva) sem tabela extra.
 *  3) ADVOGADOS da casa (N:N), com um responsável marcado como principal.
 *
 * Também é o ÚNICO ponto que escreve os atalhos denormalizados
 * `processos.filiado_id` / `processos.advogado_id` (ver `sincronizarAtalhos`).
 */
@Injectable()
export class PartesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Partes do processo
  // =========================================================================

  async listar(processoId: string) {
    await this.garantirProcesso(processoId);
    const partes = await this.prisma.parteProcesso.findMany({
      where: { processoId },
      orderBy: PARTE_ORDER,
      include: PARTE_INCLUDE,
    });
    return this.agruparPorPolo(partes);
  }

  /** Separa em polos e já entrega o par "Autor × Réu" pronto para o cabeçalho. */
  agruparPorPolo<T extends { polo: PoloProcesso; principal: boolean; nome: string }>(partes: T[]) {
    const ativo = partes.filter((p) => p.polo === 'ATIVO');
    const passivo = partes.filter((p) => p.polo === 'PASSIVO');
    const terceiros = partes.filter((p) => p.polo === 'TERCEIRO');
    const destaque = (lista: T[]) => lista.find((p) => p.principal) ?? lista[0] ?? null;
    /** É o próprio sindicato? Sai da flag do cadastro, não do nome. */
    const marcar = (p: T | null) =>
      p && {
        ...p,
        institucional:
          !!(p as { parteExterna?: { institucional?: boolean } }).parteExterna?.institucional,
      };
    return {
      ativo,
      passivo,
      terceiros,
      /** Confronto resumido — o que a lista de processos mostra numa linha. */
      confronto: {
        autor: marcar(destaque(ativo)),
        reu: marcar(destaque(passivo)),
        outrosAtivo: Math.max(0, ativo.length - 1),
        outrosPassivo: Math.max(0, passivo.length - 1),
      },
    };
  }

  async adicionar(processoId: string, dto: AdicionarParteDto, ctx: Ctx) {
    const processo = await this.garantirProcesso(processoId);
    const dados = await this.resolverIdentidade(dto);

    // Duplicidade: o mesmo cadastro não entra duas vezes no processo. O banco
    // também barra (índice único parcial) — aqui só damos a mensagem boa.
    if (dados.filiadoId || dados.parteExternaId) {
      const jaEsta = await this.prisma.parteProcesso.findFirst({
        where: {
          processoId,
          ...(dados.filiadoId ? { filiadoId: dados.filiadoId } : { parteExternaId: dados.parteExternaId }),
        },
        select: { id: true, polo: true },
      });
      if (jaEsta) {
        throw new ConflictException(
          `"${dados.nome}" já consta neste processo (${this.rotuloPolo(jaEsta.polo)}). Edite a parte existente em vez de duplicá-la.`,
        );
      }
    }

    const parte = await this.prisma.$transaction(async (tx) => {
      // Primeira parte do polo é sempre a principal — evita processo com partes
      // cadastradas e nenhum "Autor × Réu" para mostrar na lista.
      const primeiraDoPolo = !(await this.temParte(tx, processoId, dto.polo));
      const seraPrincipal = dto.principal || primeiraDoPolo;
      // Uma principal por polo: promover uma rebaixa a anterior.
      if (seraPrincipal) await this.rebaixarPrincipais(tx, processoId, dto.polo);
      const criada = await tx.parteProcesso.create({
        data: {
          processoId,
          polo: dto.polo,
          papel: dto.papel?.trim() || PAPEL_PADRAO[dto.polo],
          principal: seraPrincipal,
          nome: dados.nome,
          documento: dados.documento,
          filiadoId: dados.filiadoId,
          parteExternaId: dados.parteExternaId,
          advogados: this.normalizarAdvogadosDaParte(dto.advogados),
          observacao: dto.observacao?.trim() || null,
        },
        include: PARTE_INCLUDE,
      });
      await this.sincronizarAtalhos(tx, processoId);
      return criada;
    });

    await this.auditar(AcaoAuditoria.CREATE, 'ParteProcesso', parte.id, ctx,
      `${this.rotuloPolo(parte.polo)} "${parte.nome}" adicionado ao processo ${processo.numeroCNJ}`,
      { processoId, polo: parte.polo, vinculo: dados.filiadoId ? 'FILIADO' : dados.parteExternaId ? 'CADASTRO' : 'TEXTO_LIVRE' });
    return parte;
  }

  async atualizar(parteId: string, dto: AtualizarParteDto, ctx: Ctx) {
    const atual = await this.prisma.parteProcesso.findUnique({
      where: { id: parteId },
      select: {
        id: true, processoId: true, polo: true, nome: true, filiadoId: true, parteExternaId: true,
        processo: { select: { numeroCNJ: true } },
      },
    });
    if (!atual) throw new NotFoundException('Parte não encontrada.');

    // Só reprocessa a identidade quando o payload mexe nela; assim um PATCH de
    // papel/observação não exige reenviar nome e vínculo.
    const mexeuNaIdentidade =
      dto.filiadoId !== undefined || dto.parteExternaId !== undefined || dto.nome !== undefined;
    const dados = mexeuNaIdentidade
      ? await this.resolverIdentidade({
          ...dto,
          polo: dto.polo ?? atual.polo,
          nome: dto.nome ?? atual.nome,
          filiadoId: dto.filiadoId !== undefined ? dto.filiadoId : atual.filiadoId ?? undefined,
          parteExternaId:
            dto.parteExternaId !== undefined ? dto.parteExternaId : atual.parteExternaId ?? undefined,
        })
      : null;

    const polo = dto.polo ?? atual.polo;

    const parte = await this.prisma.$transaction(async (tx) => {
      if (dto.principal) await this.rebaixarPrincipais(tx, atual.processoId, polo, parteId);
      const salva = await tx.parteProcesso.update({
        where: { id: parteId },
        data: {
          polo: dto.polo,
          papel: dto.papel === undefined ? undefined : dto.papel?.trim() || PAPEL_PADRAO[polo],
          principal: dto.principal,
          ...(dados
            ? {
                nome: dados.nome,
                documento: dados.documento,
                filiadoId: dados.filiadoId,
                parteExternaId: dados.parteExternaId,
              }
            : {}),
          ...(dto.documento !== undefined && !dados ? { documento: this.digitos(dto.documento) } : {}),
          ...(dto.advogados !== undefined
            ? { advogados: this.normalizarAdvogadosDaParte(dto.advogados) }
            : {}),
          ...(dto.observacao !== undefined ? { observacao: dto.observacao?.trim() || null } : {}),
        },
        include: PARTE_INCLUDE,
      });
      await this.sincronizarAtalhos(tx, atual.processoId);
      return salva;
    });

    await this.auditar(AcaoAuditoria.UPDATE, 'ParteProcesso', parteId, ctx,
      `Parte "${parte.nome}" atualizada no processo ${atual.processo.numeroCNJ}`,
      { processoId: atual.processoId, polo: parte.polo });
    return parte;
  }

  async remover(parteId: string, ctx: Ctx) {
    const parte = await this.prisma.parteProcesso.findUnique({
      where: { id: parteId },
      select: {
        id: true, processoId: true, polo: true, nome: true,
        processo: { select: { numeroCNJ: true } },
      },
    });
    if (!parte) throw new NotFoundException('Parte não encontrada.');

    await this.prisma.$transaction(async (tx) => {
      await tx.parteProcesso.delete({ where: { id: parteId } });
      // Removida a principal, a próxima do polo assume — o processo não fica
      // com partes cadastradas e nenhum destaque.
      const proxima = await tx.parteProcesso.findFirst({
        where: { processoId: parte.processoId, polo: parte.polo },
        orderBy: { createdAt: 'asc' },
        select: { id: true, principal: true },
      });
      if (proxima && !proxima.principal) {
        const temPrincipal = await tx.parteProcesso.count({
          where: { processoId: parte.processoId, polo: parte.polo, principal: true },
        });
        if (!temPrincipal) {
          await tx.parteProcesso.update({ where: { id: proxima.id }, data: { principal: true } });
        }
      }
      await this.sincronizarAtalhos(tx, parte.processoId);
    });

    await this.auditar(AcaoAuditoria.DELETE, 'ParteProcesso', parteId, ctx,
      `Parte "${parte.nome}" removida do processo ${parte.processo.numeroCNJ}`,
      { processoId: parte.processoId, polo: parte.polo });
    return { ok: true };
  }

  // =========================================================================
  // Advogados da casa (N:N)
  // =========================================================================

  async listarAdvogados(processoId: string) {
    await this.garantirProcesso(processoId);
    return this.prisma.processoAdvogado.findMany({
      where: { processoId },
      orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }],
      include: ADVOGADO_INCLUDE,
    });
  }

  /**
   * Define a lista COMPLETA de advogados do processo (substitui a atual).
   * Enviar a lista inteira, e não deltas, evita o clássico "removi um e o
   * responsável sumiu" — o cálculo do principal é feito uma vez só, aqui.
   */
  async definirAdvogados(processoId: string, dto: DefinirAdvogadosDto, ctx: Ctx) {
    const processo = await this.garantirProcesso(processoId);
    const ids = [...new Set((dto.advogadoIds ?? []).filter(Boolean))];

    if (ids.length) {
      const achados = await this.prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true, ativo: true },
      });
      if (achados.length !== ids.length) {
        throw new BadRequestException('Um dos advogados informados não existe.');
      }
      const inativo = achados.find((u) => !u.ativo);
      if (inativo) {
        throw new BadRequestException(`"${inativo.nome}" está inativo e não pode ser vinculado ao processo.`);
      }
    }

    if (dto.principalId && !ids.includes(dto.principalId)) {
      throw new BadRequestException('O responsável precisa estar entre os advogados do processo.');
    }

    const atuais = await this.prisma.processoAdvogado.findMany({
      where: { processoId },
      select: { advogadoId: true, principal: true },
    });
    // Sem escolha explícita, preserva o responsável atual se ele permanece na
    // lista; senão o primeiro informado assume. Lista vazia = sem responsável.
    const principalAtual = atuais.find((a) => a.principal)?.advogadoId;
    const principalId =
      dto.principalId ??
      (principalAtual && ids.includes(principalAtual) ? principalAtual : ids[0]) ??
      null;

    await this.prisma.$transaction(async (tx) => {
      await tx.processoAdvogado.deleteMany({ where: { processoId, advogadoId: { notIn: ids.length ? ids : ['-'] } } });
      // Zera os principais antes de gravar o novo: o índice único parcial
      // (um principal por processo) não tolera dois verdadeiros nem por um
      // instante dentro da transação.
      await tx.processoAdvogado.updateMany({ where: { processoId }, data: { principal: false } });
      for (const advogadoId of ids) {
        await tx.processoAdvogado.upsert({
          where: { processoId_advogadoId: { processoId, advogadoId } },
          create: { processoId, advogadoId, principal: false },
          update: {},
        });
      }
      if (principalId) {
        await tx.processoAdvogado.update({
          where: { processoId_advogadoId: { processoId, advogadoId: principalId } },
          data: { principal: true },
        });
      }
      await this.sincronizarAtalhos(tx, processoId);
    });

    await this.auditar(AcaoAuditoria.UPDATE, 'Processo', processoId, ctx,
      `Advogados do processo ${processo.numeroCNJ} atualizados (${ids.length} no total)`,
      { processoId, advogados: ids.length, principalId });
    return this.listarAdvogados(processoId);
  }

  // =========================================================================
  // Atalhos denormalizados (processos.filiado_id / processos.advogado_id)
  // =========================================================================

  /**
   * Reescreve os atalhos do processo a partir da fonte de verdade (N:N).
   *
   * Filiado principal: a parte marcada como principal que for um filiado; se a
   * principal não for filiado (ex.: ação coletiva em que o autor é o próprio
   * sindicato), cai no filiado mais antigo entre as partes — assim o processo
   * continua aparecendo na carteira dele e nos filtros por filiado.
   *
   * Deve rodar SEMPRE dentro da transação que alterou os vínculos.
   */
  /**
   * "ESTA PARTE É ESTE FILIADO" — converte o vínculo NO LUGAR.
   *
   * O caminho antigo (`PATCH /processos/:id` com `filiadoId`) resolve o atalho
   * ADICIONANDO uma parte nova ao polo ativo. Para um processo que já tem a
   * pessoa lançada como texto livre, isso produz dois autores que são a mesma
   * pessoa — e o segundo vira o principal, empurrando o primeiro para baixo.
   *
   * Aqui a parte que já existe passa a apontar para o cadastro: o `nome`
   * continua sendo o dos autos (snapshot), o documento é completado a partir do
   * filiado quando faltava, e a ligação com a "parte externa" — que nunca
   * deveria ter sido criada para uma pessoa física — é desfeita.
   */
  async vincularFiliado(parteId: string, filiadoId: string, ctx: Ctx) {
    const parte = await this.prisma.parteProcesso.findUnique({
      where: { id: parteId },
      select: { id: true, processoId: true, nome: true, polo: true, documento: true, filiadoId: true },
    });
    if (!parte) throw new BadRequestException('Parte não encontrada.');
    if (parte.filiadoId === filiadoId) return this.buscarParte(parteId);

    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: { id: true, nomeCompleto: true, cpf: true },
    });
    if (!filiado) throw new BadRequestException('Filiado inválido.');

    // O mesmo filiado duas vezes no mesmo processo não é vínculo, é duplicata.
    const jaEsta = await this.prisma.parteProcesso.findFirst({
      where: { processoId: parte.processoId, filiadoId, id: { not: parteId } },
      select: { id: true },
    });
    if (jaEsta) {
      throw new ConflictException(
        `"${filiado.nomeCompleto}" já consta neste processo em outra parte. Remova a duplicada em vez de vincular as duas.`,
      );
    }

    const atualizada = await this.prisma.$transaction(async (tx) => {
      const r = await tx.parteProcesso.update({
        where: { id: parteId },
        data: {
          filiadoId,
          parteExternaId: null,
          documento: parte.documento || this.digitos(filiado.cpf),
        },
        include: PARTE_INCLUDE,
      });
      await this.sincronizarAtalhos(tx, parte.processoId);
      return r;
    });

    await this.auditar(
      AcaoAuditoria.UPDATE, 'ParteProcesso', parteId, ctx,
      `"${parte.nome}" identificada como o filiado "${filiado.nomeCompleto}"`,
      { processoId: parte.processoId, filiadoId, nomeNosAutos: parte.nome },
    );
    return atualizada;
  }

  private buscarParte(id: string) {
    return this.prisma.parteProcesso.findUnique({ where: { id }, include: PARTE_INCLUDE });
  }

  /**
   * As etiquetas em uso no acervo, da mais frequente para a menos.
   *
   * Alimenta a sugestão do formulário. Ver o comentário da rota em
   * `partes.controller.ts` para por que a lista fixa que existia antes estava
   * errada.
   */
  async etiquetasDoAcervo(
    parteExternaId?: string,
  ): Promise<{ etiqueta: string; processos: number; noReu?: number }[]> {
    const linhas = await this.prisma.$queryRaw<{ etiqueta: string; processos: bigint }[]>`
      SELECT e AS etiqueta, count(*) AS processos
        FROM processos, unnest(coalesce(etiquetas, ARRAY[]::text[])) AS e
       WHERE trim(e) <> ''
       GROUP BY 1
       ORDER BY 2 DESC, 1 ASC
       LIMIT 60
    `;
    const geral = linhas.map((l) => ({ etiqueta: l.etiqueta, processos: Number(l.processos) }));
    if (!parteExternaId) return geral;

    /*
      O QUE O ACERVO JÁ USOU CONTRA ESTE RÉU.

      A ÚNICA automação de etiqueta que os dados sustentam — e sustentam só
      pela metade, por isso ela ORDENA e nunca marca sozinha. Medido em
      04/09/2026, entre os oito réus com 3+ processos etiquetados, a etiqueta
      dominante cobre 70% ou mais em QUATRO: UNIMED tem `RETALIAÇÃO` nos sete,
      HAPVIDA em cinco de seis — e FMS/THE, o maior réu, fica em 33%.

      (As outras duas hipóteses foram medidas e DESCARTADAS: o assunto do CNJ
      não prevê o pedido — "Assistência Judiciária Gratuita" é o assunto de
      processos etiquetados INSALUBRIDADE, REAJUSTE e SELETIVO SIMPLIFICADO —
      e o ano da distribuição não prevê a CCT: `CCT 2018/2020` aparece em
      processos de 2021 a 2025.)
    */
    /*
      A COMPARAÇÃO É TEXTO CONTRA TEXTO, sem cast.

      `parte_externa_id` é TEXT (o Prisma gera cuid, não uuid). Eu tinha escrito
      `= $1::uuid` por hábito, e o Postgres recusa a comparação inteira:
      "operator does not exist: text = uuid". Vira 500 na tela — e só apareceu
      quando rodei a consulta contra dados de verdade, porque o teste anterior
      bateu numa API antiga que ainda estava de pé na porta.
    */
    const doReu = await this.prisma.$queryRaw<{ etiqueta: string; processos: bigint }[]>`
      SELECT e AS etiqueta, count(*) AS processos
        FROM processos p, unnest(coalesce(p.etiquetas, ARRAY[]::text[])) AS e
       WHERE trim(e) <> ''
         AND EXISTS (
           SELECT 1 FROM partes_processo pp
            WHERE pp.processo_id = p.id
              AND pp.polo = 'PASSIVO'
              AND pp.parte_externa_id = ${parteExternaId}
         )
       GROUP BY 1
       ORDER BY 2 DESC, 1 ASC
       LIMIT 20
    `;
    const mapa = new Map(doReu.map((l) => [l.etiqueta, Number(l.processos)]));
    return geral.map((g) => (mapa.has(g.etiqueta) ? { ...g, noReu: mapa.get(g.etiqueta) } : g));
  }

  async sincronizarAtalhos(tx: Prisma.TransactionClient, processoId: string) {
    const partesFiliado = await tx.parteProcesso.findMany({
      where: { processoId, filiadoId: { not: null } },
      orderBy: [{ principal: 'desc' }, { createdAt: 'asc' }],
      select: { filiadoId: true },
      take: 1,
    });
    const advPrincipal = await tx.processoAdvogado.findFirst({
      where: { processoId, principal: true },
      select: { advogadoId: true },
    });
    // Sem principal marcado (lista com um só, criado por rota antiga), assume o
    // primeiro — o atalho nunca fica nulo tendo advogado vinculado.
    const advQualquer = advPrincipal
      ? null
      : await tx.processoAdvogado.findFirst({
          where: { processoId },
          orderBy: { createdAt: 'asc' },
          select: { advogadoId: true },
        });

    await tx.processo.update({
      where: { id: processoId },
      data: {
        filiadoId: partesFiliado[0]?.filiadoId ?? null,
        advogadoId: advPrincipal?.advogadoId ?? advQualquer?.advogadoId ?? null,
      },
    });
  }

  /**
   * Compatibilidade do PATCH /processos/:id, que sempre aceitou `filiadoId` e
   * `advogadoId` avulsos. Em vez de escrever no atalho (que agora é derivado),
   * traduz a intenção para a fonte de verdade: vira a parte principal do polo
   * ativo / o advogado responsável.
   */
  async aplicarVinculosLegados(
    processoId: string,
    dto: { filiadoId?: string | null; advogadoId?: string | null },
    ctx: Ctx,
  ) {
    if (dto.filiadoId !== undefined) {
      if (dto.filiadoId) {
        const jaEParte = await this.prisma.parteProcesso.findFirst({
          where: { processoId, filiadoId: dto.filiadoId },
          select: { id: true },
        });
        if (jaEParte) {
          await this.atualizar(jaEParte.id, { principal: true }, ctx);
        } else {
          await this.adicionar(processoId, { polo: 'ATIVO', filiadoId: dto.filiadoId, principal: true }, ctx);
        }
      } else {
        // Desvincular: remove as partes que são filiado, preservando as demais.
        const doFiliado = await this.prisma.parteProcesso.findMany({
          where: { processoId, filiadoId: { not: null } },
          select: { id: true },
        });
        for (const p of doFiliado) await this.remover(p.id, ctx);
      }
    }

    if (dto.advogadoId !== undefined) {
      const atuais = await this.prisma.processoAdvogado.findMany({
        where: { processoId },
        select: { advogadoId: true },
      });
      const ids = atuais.map((a) => a.advogadoId);
      if (dto.advogadoId) {
        await this.definirAdvogados(
          processoId,
          { advogadoIds: [...new Set([...ids, dto.advogadoId])], principalId: dto.advogadoId },
          ctx,
        );
      } else {
        // Sem responsável: mantém a equipe, apenas nenhum marcado como principal.
        await this.prisma.$transaction(async (tx) => {
          await tx.processoAdvogado.updateMany({ where: { processoId }, data: { principal: false } });
          await this.sincronizarAtalhos(tx, processoId);
        });
      }
    }
  }

  /**
   * A ParteExterna que representa o próprio sindicato (polo ativo das ações
   * coletivas). Semeada na migração e localizada pela flag, não por um id
   * chumbado — assim a secretaria pode corrigir razão social/CNPJ pela tela.
   */
  async parteInstitucional(tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    return tx.parteExterna.findFirst({
      where: { institucional: true },
      select: { id: true, nome: true, documento: true },
    });
  }

  /**
   * Cria as partes informadas no momento da IMPORTAÇÃO, dentro da transação que
   * cria o processo. Silencioso e tolerante: importar um processo não pode
   * falhar porque o nome do réu veio vazio.
   *
   * POLO ATIVO — três caminhos, e nenhum deles cria cadastro provisório na
   * tabela de Filiados (regra explícita do fluxo):
   *
   *  • INSTITUCIONAL → a parte é o PRÓPRIO SINDICATO desta instalação, lido do
   *    banco por `ParteExterna.institucional`. Nunca um nome fixo: o mesmo
   *    código serve SENATEPI e SINDSERM, e cravar um deles aqui poria o
   *    sindicato errado no polo ativo de uma petição.
   *  • FILIADOS      → um ou mais filiados. O primeiro é o principal; os demais
   *    entram como litisconsortes do mesmo polo.
   *  • OUTRA         → grava só o nome digitado. Sem nome, o processo nasce sem
   *    polo ativo e a aba Partes mostra a pendência.
   */
  async semearNaImportacao(
    tx: Prisma.TransactionClient,
    processoId: string,
    entradas: {
      filiadoId?: string | null;
      /** Responsável (principal) — entra na equipe mesmo fora de `advogadosIds`. */
      advogadoId?: string | null;
      /** Demais advogados que atuam no caso. */
      advogadosIds?: string[] | null;
      filiado?: { nomeCompleto: string; cpf: string | null } | null;
      /** Filiados do polo ativo, na ordem escolhida (o 1º é o principal). */
      filiadosAtivos?: { id: string; nomeCompleto: string; cpf: string | null }[] | null;
      /** Polo ativo institucional: o próprio sindicato move a ação. */
      institucional?: boolean;
      /** Polo ativo avulso: parte conhecida só pelo nome. */
      poloAtivoAvulso?: { nome?: string; documento?: string } | null;
      /**
       * O POLO ATIVO COMO RELAÇÃO ORDENADA — tipos misturados, 1º é o principal.
       * Quando vem, vence `institucional`/`filiadosAtivos`/`poloAtivoAvulso`.
       */
      poloAtivoPartes?:
        | { nome: string; documento: string | null; filiadoId?: string; parteExternaId?: string }[]
        | null;
      /** Compatibilidade: um réu só. Quando vier junto com `partesContrarias`, entra como o primeiro. */
      parteContraria?: { nome?: string; documento?: string; parteExternaId?: string } | null;
      /** Litisconsórcio passivo — vários réus. O primeiro é o principal. */
      partesContrarias?: { nome?: string; documento?: string; parteExternaId?: string }[] | null;
    },
  ) {
    // ---- Polo ativo ----
    /*
      A RELAÇÃO EXPLÍCITA, quando a tela mandou uma.

      A cadeia `if/else if` logo abaixo é exclusiva por construção: ou o
      sindicato, OU os filiados, OU um nome avulso. Ela dá conta de 126 dos 127
      processos da produção — e não dá conta do litisconsórcio com outro
      sindicato, nem do sindicato entrando ao lado do filiado. Fica preservada
      porque é o que o payload antigo manda, e ele não pode parar de funcionar
      no dia do deploy.
    */
    if (entradas.poloAtivoPartes?.length) {
      let i = 0;
      const vistos = new Set<string>();
      for (const parte of entradas.poloAtivoPartes) {
        const nome = parte.nome?.trim();
        if (!nome) continue;
        const chave = parte.filiadoId ?? parte.parteExternaId ?? this.comparavel(nome);
        if (vistos.has(chave) || vistos.has(this.comparavel(nome))) continue;
        vistos.add(chave);
        vistos.add(this.comparavel(nome));
        await tx.parteProcesso.create({
          data: {
            processoId,
            polo: 'ATIVO',
            papel: PAPEL_PADRAO.ATIVO,
            principal: i === 0,
            nome,
            documento: this.digitos(parte.documento),
            filiadoId: parte.filiadoId ?? null,
            parteExternaId: parte.parteExternaId ?? null,
          },
        });
        i++;
      }
    } else if (entradas.institucional) {
      // O sindicato DESTA instalação, e não um nome escrito aqui: quem responde
      // é `ParteExterna.institucional`, mantida pelo `ParteInstitucionalSeed`.
      const sindicato = await this.parteInstitucional(tx);
      if (sindicato) {
        await tx.parteProcesso.create({
          data: {
            processoId,
            polo: 'ATIVO',
            papel: PAPEL_PADRAO.ATIVO,
            principal: true,
            nome: sindicato.nome,
            documento: sindicato.documento,
            parteExternaId: sindicato.id,
          },
        });
      }
    } else if (entradas.filiadosAtivos?.length) {
      // Litisconsórcio ativo: todos entram, o primeiro como principal.
      await tx.parteProcesso.createMany({
        data: entradas.filiadosAtivos.map((f, i) => ({
          processoId,
          polo: 'ATIVO' as const,
          papel: PAPEL_PADRAO.ATIVO,
          principal: i === 0,
          nome: f.nomeCompleto,
          documento: this.digitos(f.cpf),
          filiadoId: f.id,
        })),
      });
    } else if (entradas.poloAtivoAvulso?.nome?.trim()) {
      // Parte sem cadastro: fica como snapshot de nome. NUNCA vira Filiado.
      await tx.parteProcesso.create({
        data: {
          processoId,
          polo: 'ATIVO',
          papel: PAPEL_PADRAO.ATIVO,
          principal: true,
          nome: entradas.poloAtivoAvulso.nome.trim(),
          documento: this.digitos(entradas.poloAtivoAvulso.documento),
        },
      });
    } else if (entradas.filiadoId && entradas.filiado) {
      // Caminho antigo (payload sem `poloAtivo`) — preservado para não quebrar
      // integrações que ainda mandam só `filiadoId`.
      await tx.parteProcesso.create({
        data: {
          processoId,
          polo: 'ATIVO',
          papel: PAPEL_PADRAO.ATIVO,
          principal: true,
          nome: entradas.filiado.nomeCompleto,
          documento: this.digitos(entradas.filiado.cpf),
          filiadoId: entradas.filiadoId,
        },
      });
    }

    /**
     * POLO PASSIVO — vários réus (litisconsórcio).
     *
     * Era UM. E um só é a exceção, não a regra: reclamação contra hospital e
     * contra a empresa que terceiriza tem dois réus desde a petição inicial, e
     * ação contra o município costuma citar também a autarquia. Com uma parte
     * só, o segundo réu era digitado no campo de observação ou simplesmente não
     * era registrado — e "contra quem litigamos" deixava de ser uma pergunta
     * respondível pelo sistema.
     *
     * O PRIMEIRO É O PRINCIPAL: é ele que aparece no "Autor × Réu" da lista,
     * pela mesma regra que já vale no polo ativo.
     *
     * `parteContraria` (singular) continua aceito e entra na frente da lista —
     * é o contrato que a tela em produção usa hoje.
     */
    const contrarias = [
      ...(entradas.parteContraria ? [entradas.parteContraria] : []),
      ...(entradas.partesContrarias ?? []),
    ];
    let indicePassivo = 0;
    const jaVistos = new Set<string>();
    for (const contraria of contrarias) {
      if (!contraria?.parteExternaId && !contraria?.nome?.trim()) continue;
      let nome = contraria.nome?.trim() ?? '';
      let documento = this.digitos(contraria.documento);
      if (contraria.parteExternaId) {
        const cadastro = await tx.parteExterna.findUnique({
          where: { id: contraria.parteExternaId },
          select: { nome: true, documento: true },
        });
        if (cadastro) {
          nome = cadastro.nome;
          documento = cadastro.documento;
        }
      }
      if (!nome) continue;
      /*
        O MESMO RÉU DUAS VEZES — uma pelo cadastro, outra digitado à mão.

        A chave era `parteExternaId` OU `nome|documento`, e por isso não pegava
        justamente o caso que acontece: escolher "PRONTOCARE" no cadastro dá
        uma chave de id, digitar "PRONTOCARE CLINICA E ATENDIMENTOS LTDA" dá
        uma chave de nome, e as duas entravam. A lista do processo passava a
        mostrar "PRONTOCARE e mais 1" apontando para ela mesma — exatamente a
        duplicata que o aviso da tela tentava evitar.

        Agora as DUAS chaves são marcadas para cada réu que entra, e basta uma
        delas bater para o segundo ser descartado.
      */
      const porId = contraria.parteExternaId?.trim();
      const porNome = this.comparavel(nome);
      if ((porId && jaVistos.has(porId)) || jaVistos.has(porNome)) continue;
      if (porId) jaVistos.add(porId);
      jaVistos.add(porNome);

      await tx.parteProcesso.create({
        data: {
          processoId,
          polo: 'PASSIVO',
          papel: PAPEL_PADRAO.PASSIVO,
          principal: indicePassivo === 0,
          nome,
          documento,
          parteExternaId: contraria.parteExternaId || null,
        },
      });
      indicePassivo++;
    }

    // ---- Equipe de advogados ----
    // Um processo pode ser tocado por mais de um advogado. `advogadoId` é o
    // RESPONSÁVEL (principal) e entra na equipe mesmo que não venha na lista —
    // não faria sentido gravar um responsável fora da própria equipe.
    const equipe = [
      ...new Set([entradas.advogadoId, ...(entradas.advogadosIds ?? [])].filter(Boolean)),
    ] as string[];
    if (equipe.length) {
      await tx.processoAdvogado.createMany({
        data: equipe.map((advogadoId) => ({
          processoId,
          advogadoId,
          // Sem responsável explícito, o primeiro da lista assume — melhor que
          // um processo sem ninguém marcado como principal.
          principal: advogadoId === (entradas.advogadoId ?? equipe[0]),
        })),
        skipDuplicates: true,
      });
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Nome comparável: sem acento, sem pontuação, sem caixa.
   *
   * É o mesmo critério do `normalizarNome` da tela — os dois lados precisam
   * concordar sobre o que é "a mesma parte", senão a tela impede a duplicata e
   * a API deixa passar (ou o contrário, que é pior: a tela recusa o que o
   * banco aceitaria).
   */
  private comparavel(nome: string): string {
    return nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Resolve a identidade da parte a partir do vínculo informado.
   * `nome` é SEMPRE devolvido preenchido — é o snapshot de como a parte consta
   * nos autos, e é o que sobra se o cadastro vinculado for excluído depois.
   */
  private async resolverIdentidade(dto: {
    polo: PoloProcesso;
    filiadoId?: string | null;
    parteExternaId?: string | null;
    nome?: string;
    documento?: string;
  }): Promise<{ nome: string; documento: string | null; filiadoId: string | null; parteExternaId: string | null }> {
    const filiadoId = dto.filiadoId || null;
    const parteExternaId = dto.parteExternaId || null;

    if (filiadoId && parteExternaId) {
      throw new BadRequestException(
        'A parte é um filiado OU um cadastro externo — não os dois. Escolha um dos vínculos.',
      );
    }

    if (filiadoId) {
      const f = await this.prisma.filiado.findUnique({
        where: { id: filiadoId },
        select: { nomeCompleto: true, cpf: true },
      });
      if (!f) throw new BadRequestException('Filiado inválido.');
      return { nome: f.nomeCompleto, documento: this.digitos(f.cpf), filiadoId, parteExternaId: null };
    }

    if (parteExternaId) {
      const e = await this.prisma.parteExterna.findUnique({
        where: { id: parteExternaId },
        select: { nome: true, documento: true, ativo: true },
      });
      if (!e) throw new BadRequestException('Parte cadastrada inválida.');
      if (!e.ativo) throw new BadRequestException(`"${e.nome}" está desativada no cadastro de partes.`);
      return { nome: e.nome, documento: e.documento, filiadoId: null, parteExternaId };
    }

    const nome = dto.nome?.trim();
    if (!nome) {
      throw new BadRequestException(
        'Informe o nome da parte (ou vincule um filiado / uma parte já cadastrada).',
      );
    }

    /*
      O CPF IDENTIFICA — e digitá-lo já é dizer quem é a pessoa.

      Era aqui que o vínculo se perdia. Quem lançava a parte digitava nome e
      CPF, e a parte nascia como texto livre mesmo quando aquele CPF estava no
      cadastro de filiados desde sempre. O processo aparecia "sem filiado
      vinculado", a ficha do filiado não mostrava o processo, e ninguém tinha
      como saber que os dois eram a mesma pessoa — porque o NOME nos autos vem
      mais longo que o do cadastro ("SARA MACHADO MIRANDA LEAL BARBOSA" contra
      "SARA MACHADO MIRANDA"), e nenhuma busca por nome os aproximava.

      Só o CPF EXATO vincula sozinho. Nome parecido é sugestão, e sugestão
      passa por gente (ver `SugestaoFiliadoService`).
    */
    const documento = this.digitos(dto.documento);
    if (documento?.length === 11) {
      const filiadoDoCpf = await this.prisma.filiado.findFirst({
        where: { cpf: documento },
        select: { id: true, nomeCompleto: true },
      });
      if (filiadoDoCpf) {
        return {
          // O nome dos AUTOS é o que fica: é assim que a parte consta no
          // processo, e é por ele que a equipe reconhece a peça.
          nome,
          documento,
          filiadoId: filiadoDoCpf.id,
          parteExternaId: null,
        };
      }
    }

    return { nome, documento, filiadoId: null, parteExternaId: null };
  }

  private async temParte(tx: Prisma.TransactionClient, processoId: string, polo: PoloProcesso) {
    const n = await tx.parteProcesso.count({ where: { processoId, polo } });
    return n > 0;
  }

  private rebaixarPrincipais(
    tx: Prisma.TransactionClient,
    processoId: string,
    polo: PoloProcesso,
    exceto?: string,
  ) {
    return tx.parteProcesso.updateMany({
      where: { processoId, polo, principal: true, ...(exceto ? { id: { not: exceto } } : {}) },
      data: { principal: false },
    });
  }

  private normalizarAdvogadosDaParte(
    lista?: { nome?: string; oab?: string }[],
  ): Prisma.InputJsonValue | undefined {
    if (lista === undefined) return undefined;
    const limpos = (lista ?? [])
      .map((a) => ({ nome: a?.nome?.trim() || null, oab: a?.oab?.trim() || null }))
      .filter((a) => a.nome || a.oab)
      .slice(0, 20);
    return limpos as unknown as Prisma.InputJsonValue;
  }

  private digitos(v?: string | null): string | null {
    const d = (v ?? '').replace(/\D/g, '');
    return d.length ? d : null;
  }

  private rotuloPolo(polo: PoloProcesso): string {
    return polo === 'ATIVO' ? 'Polo ativo' : polo === 'PASSIVO' ? 'Polo passivo' : 'Terceiro';
  }

  private async garantirProcesso(id: string) {
    const p = await this.prisma.processo.findUnique({
      where: { id },
      select: { id: true, numeroCNJ: true },
    });
    if (!p) throw new NotFoundException('Processo não encontrado.');
    return p;
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
}
