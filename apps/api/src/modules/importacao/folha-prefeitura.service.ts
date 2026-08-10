import { QrCodeService } from '@core/infra';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AcaoAuditoria,
  ClassificacaoLinha,
  DecisaoConflito,
  MotivoConflito,
  PerfilImportacao,
  Prisma,
  StatusImportacao,
  TipoHistoricoFiliado,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { lerPlanilha } from './planilha.util';
import {
  Alteracao,
  BaseAtual,
  LinhaFolha,
  VinculoExistente,
  classificarLinha,
  camposParaCompletar,
  mapearColunas,
  normalizarLinha,
  normalizarMatricula,
  normalizarTexto,
} from './folha-prefeitura.util';
import { indexarOrganizacoes, organizacaoDoTexto } from './organizacao-vinculo.util';

const CHUNK = 500;

/**
 * IMPORTAÇÃO DA FOLHA DA PREFEITURA.
 *
 * Fluxo: upload → leitura/mapeamento → normalização → comparação com a base →
 * prévia → (decisão dos conflitos) → confirmação → importação → relatório.
 *
 * SEPARADO do `ImportacaoService` de propósito. Os dois compartilham as tabelas
 * `importacoes`/`importacao_linhas` e a tela, mas a regra de identidade é
 * OPOSTA: lá o CPF manda, aqui não existe CPF. Enfiar os dois no mesmo método
 * produziria um `if (perfil)` em cada parágrafo — e o pior lugar para um `if`
 * escondido é o código que decide se duas pessoas são a mesma.
 *
 * ISOLAMENTO POR CLIENTE: cada sindicato é um banco e um serviço (ver
 * `tenant.config`). Não há coluna de tenant para filtrar; o isolamento vem da
 * conexão. O que este serviço garante é não furar isso por outro caminho — só
 * usa `this.prisma`, nunca uma conexão montada à mão, e a rota é fechada por
 * `@ModuloTenant('filiados')`, então uma instalação sem o módulo não a expõe.
 */
@Injectable()
export class FolhaPrefeituraService {
  private readonly logger = new Logger(FolhaPrefeituraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Upload → prévia
  // --------------------------------------------------------------------------

  /**
   * Lê a planilha, compara com a base e grava a PRÉVIA. Nada é escrito em
   * filiados nesta etapa — só em `importacoes`/`importacao_linhas`.
   */
  async processarUpload(
    file: Express.Multer.File,
    userId: string | undefined,
    opts: { permitirReenvio?: boolean } = {},
  ) {
    const { cabecalhos, linhas: brutas } = await lerPlanilha(file);
    const colunas = mapearColunas(cabecalhos);

    const faltando = (['orgao', 'matricula', 'nome'] as const).filter(
      (c) => !colunas.some((m) => m.campo === c),
    );
    if (faltando.length > 0)
      throw new BadRequestException(
        `A planilha não tem a(s) coluna(s): ${faltando.join(', ')}. ` +
          `Colunas lidas: ${cabecalhos.join(', ')}.`,
      );

    // --- Mesmo arquivo já importado? ----------------------------------------
    // Hash do CONTEÚDO, não do nome: renomear "folha.xlsx" para "folha (1).xlsx"
    // é exatamente como a importação repetida acontece na prática.
    const hashArquivo = createHash('sha256').update(file.buffer).digest('hex');
    const anterior = await this.prisma.importacao.findFirst({
      where: { hashArquivo, status: StatusImportacao.CONCLUIDO },
      orderBy: { createdAt: 'desc' },
      select: { id: true, nomeArquivo: true, createdAt: true, importados: true },
    });
    if (anterior && !opts.permitirReenvio)
      throw new BadRequestException(
        `Este arquivo já foi importado em ` +
          `${anterior.createdAt.toLocaleDateString('pt-BR')} como "${anterior.nomeArquivo}" ` +
          `(${anterior.importados} cadastrados). Se quiser processar de novo, ` +
          `marque "importar mesmo assim".`,
      );

    const base = await this.carregarBase();

    const importacao = await this.prisma.importacao.create({
      data: {
        perfil: PerfilImportacao.FOLHA_PREFEITURA,
        nomeArquivo: file.originalname,
        tamanhoBytes: file.size,
        hashArquivo,
        status: StatusImportacao.VALIDANDO,
        total: brutas.length,
        mapeamento: colunas as unknown as Prisma.InputJsonValue,
        userId,
      },
    });

    const chavesNoArquivo = new Map<string, number>();
    const registros: Prisma.ImportacaoLinhaCreateManyInput[] = [];
    const contagem: Record<ClassificacaoLinha, number> = {
      NOVO: 0, ATUALIZACAO: 0, CONFLITO: 0, DUPLICIDADE: 0, ERRO: 0,
    };

    brutas.forEach((row, idx) => {
      const numeroLinha = idx + 1;
      const linha = normalizarLinha(row, colunas);
      const veredito = classificarLinha(linha, base, chavesNoArquivo, numeroLinha);
      contagem[veredito.classificacao]++;

      registros.push({
        importacaoId: importacao.id,
        linha: numeroLinha,
        dados: linha as unknown as Prisma.InputJsonValue,
        nome: linha.nome || null,
        cpf: linha.cpf || null,
        telefone: linha.telefone || null,
        matricula: linha.matricula || null,
        empresa: linha.orgao || null, // `empresa` guarda o Órgão
        lotacao: linha.lotacao || null,
        cargo: linha.cargo || null,
        quadro: linha.quadro || null,
        classificacao: veredito.classificacao as ClassificacaoLinha,
        motivoConflito: (veredito.motivo ?? null) as MotivoConflito | null,
        candidatoId: veredito.candidatoId ?? null,
        filiadoId: veredito.classificacao === 'ATUALIZACAO' ? veredito.candidatoId : null,
        vinculoId: veredito.vinculoId ?? null,
        alteracoes: veredito.alteracoes as unknown as Prisma.InputJsonValue,
        // `valido` = "pode ser importada sem intervenção". Conflito e
        // duplicidade não são erro de dado, mas também não entram sozinhos.
        valido: veredito.classificacao === 'NOVO' || veredito.classificacao === 'ATUALIZACAO',
        duplicadoNoSistema: veredito.classificacao === 'ATUALIZACAO',
        erros: veredito.erros as unknown as Prisma.InputJsonValue,
        avisos: veredito.avisos as unknown as Prisma.InputJsonValue,
        codigos: veredito.motivo ? [veredito.motivo] : [],
      });
    });

    for (let i = 0; i < registros.length; i += CHUNK) {
      await this.prisma.importacaoLinha.createMany({ data: registros.slice(i, i + CHUNK) });
    }

    const atualizada = await this.prisma.importacao.update({
      where: { id: importacao.id },
      data: {
        status: StatusImportacao.VALIDADO,
        validos: contagem.NOVO + contagem.ATUALIZACAO,
        comErro: contagem.ERRO,
        duplicados: contagem.DUPLICIDADE,
        conflitos: contagem.CONFLITO,
      },
    });

    // A PRÉVIA também é auditada. Ninguém "só olhou": saber quem subiu qual
    // arquivo e quando é metade da resposta quando um dado aparece trocado.
    await this.audit.registrar({
      userId,
      acao: AcaoAuditoria.IMPORT,
      entidade: 'Importacao',
      entidadeId: importacao.id,
      descricao:
        `Prévia da folha "${file.originalname}": ${contagem.NOVO} novos, ` +
        `${contagem.ATUALIZACAO} atualizações, ${contagem.CONFLITO} conflitos, ` +
        `${contagem.DUPLICIDADE} duplicidades, ${contagem.ERRO} erros.`,
      metadata: { ...contagem, hashArquivo, reenvio: !!anterior },
    });

    return { ...atualizada, reenvioDe: anterior?.id ?? null };
  }

  /**
   * Índices da base atual, carregados de uma vez.
   *
   * São ~4.000 linhas contra ~7.000 filiados: cabe em memória com folga, e uma
   * consulta por linha seriam 12.000 idas ao banco — a prévia levaria minutos e
   * seguraria uma conexão o tempo todo.
   */
  private async carregarBase(): Promise<BaseAtual> {
    const vinculos = await this.prisma.vinculoProfissional.findMany({
      select: {
        id: true,
        filiadoId: true,
        empresa: true,
        matricula: true,
        cargo: true,
        lotacao: true,
        quadro: true,
        descontoEmFolha: true,
        matriculaNormalizada: true,
        filiado: { select: { nomeCompleto: true, cpf: true } },
      },
    });

    const porMatricula = new Map<string, VinculoExistente>();
    for (const v of vinculos) {
      // Recalcula em vez de confiar só na coluna: vínculo criado pela tela
      // ainda não tem `matricula_normalizada` preenchida, e ignorá-lo faria a
      // importação criar um segundo vínculo para quem a secretaria acabou de
      // cadastrar.
      const chave = v.matriculaNormalizada ?? normalizarMatricula(v.matricula);
      if (!chave) continue;
      // Primeiro vence. Na Prefeitura não há repetição; num banco que tenha,
      // ficar com o primeiro é melhor que escolher ao acaso a cada execução.
      if (porMatricula.has(chave)) continue;
      porMatricula.set(chave, {
        vinculoId: v.id,
        filiadoId: v.filiadoId,
        filiadoNome: v.filiado.nomeCompleto,
        orgao: v.empresa,
        matricula: v.matricula ?? '',
        cargo: v.cargo,
        lotacao: v.lotacao,
        quadro: v.quadro,
        descontoEmFolha: v.descontoEmFolha,
        filiadoCpf: v.filiado.cpf,
      });
    }

    const filiados = await this.prisma.filiado.findMany({
      select: { id: true, nomeCompleto: true, matricula: true },
    });
    const porNome = new Map<string, { filiadoId: string; nome: string }[]>();
    const porMatriculaFiliado = new Map<string, { filiadoId: string; nome: string }>();
    for (const f of filiados) {
      const nome = normalizarTexto(f.nomeCompleto);
      if (nome) {
        const lista = porNome.get(nome) ?? [];
        lista.push({ filiadoId: f.id, nome: f.nomeCompleto });
        porNome.set(nome, lista);
      }
      const mat = normalizarMatricula(f.matricula);
      if (mat && !porMatriculaFiliado.has(mat))
        porMatriculaFiliado.set(mat, { filiadoId: f.id, nome: f.nomeCompleto });
    }

    return { porMatricula, porMatriculaFiliado, porNome };
  }

  // --------------------------------------------------------------------------
  // Prévia: consulta
  // --------------------------------------------------------------------------

  /**
   * Contagem por classificação — os números do topo da tela de revisão.
   *
   * Cinco `count` em vez de um `groupBy`: todos batem no índice
   * `(importacao_id, classificacao)`, saem numa transação só e devolvem zero
   * para a categoria vazia — o `groupBy` omite a linha inexistente e obrigaria
   * a preencher os buracos na mão de qualquer jeito.
   */
  async resumo(id: string) {
    const imp = await this.obter(id);
    const ordem = [
      ClassificacaoLinha.NOVO,
      ClassificacaoLinha.ATUALIZACAO,
      ClassificacaoLinha.CONFLITO,
      ClassificacaoLinha.DUPLICIDADE,
      ClassificacaoLinha.ERRO,
    ];
    const [novo, atualizacao, conflito, duplicidade, erro, conflitosPendentes] =
      await this.prisma.$transaction([
        ...ordem.map((c) =>
          this.prisma.importacaoLinha.count({ where: { importacaoId: id, classificacao: c } }),
        ),
        this.prisma.importacaoLinha.count({
          where: {
            importacaoId: id,
            classificacao: ClassificacaoLinha.CONFLITO,
            decisao: DecisaoConflito.PENDENTE,
          },
        }),
      ]);

    return {
      importacao: imp,
      contagem: {
        NOVO: novo,
        ATUALIZACAO: atualizacao,
        CONFLITO: conflito,
        DUPLICIDADE: duplicidade,
        ERRO: erro,
      },
      conflitosPendentes,
    };
  }

  async listarLinhas(
    id: string,
    params: { busca?: string; classificacao?: ClassificacaoLinha; page?: number },
  ) {
    const page = Number(params.page) || 1;
    const pageSize = 25;
    const where: Prisma.ImportacaoLinhaWhereInput = { importacaoId: id };
    if (params.classificacao) where.classificacao = params.classificacao;
    if (params.busca) {
      where.OR = [
        { nome: { contains: params.busca, mode: 'insensitive' } },
        { matricula: { contains: params.busca, mode: 'insensitive' } },
        { empresa: { contains: params.busca, mode: 'insensitive' } },
        { lotacao: { contains: params.busca, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.importacaoLinha.findMany({
        where,
        orderBy: { linha: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.importacaoLinha.count({ where }),
    ]);

    // Conflito só é decidível com o candidato à vista — nome, matrícula e
    // órgão de quem o sistema achou. Sem isso o operador decidiria no escuro.
    const candidatos = data.map((l) => l.candidatoId).filter((x): x is string => !!x);
    const fichas = candidatos.length
      ? await this.prisma.filiado.findMany({
          where: { id: { in: [...new Set(candidatos)] } },
          select: {
            id: true, nomeCompleto: true, matricula: true, cpf: true, situacao: true,
            vinculos: { select: { empresa: true, matricula: true, cargo: true, lotacao: true } },
          },
        })
      : [];
    const porId = new Map(fichas.map((f) => [f.id, f]));

    return {
      data: data.map((l) => ({ ...l, candidato: l.candidatoId ? porId.get(l.candidatoId) ?? null : null })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private async obter(id: string) {
    const imp = await this.prisma.importacao.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException('Importação não encontrada');
    if (imp.perfil !== PerfilImportacao.FOLHA_PREFEITURA)
      throw new BadRequestException('Esta importação não é uma folha da Prefeitura.');
    return imp;
  }

  // --------------------------------------------------------------------------
  // Decisão dos conflitos
  // --------------------------------------------------------------------------

  /**
   * Registra o que o operador decidiu sobre um conflito.
   *
   * `MESMA_PESSOA` aceita um `filiadoId` diferente do candidato sugerido: o
   * sistema aponta um palpite, mas quem decide pode saber de outro cadastro.
   */
  async decidirConflito(
    importacaoId: string,
    linhaId: string,
    dto: { decisao: DecisaoConflito; filiadoId?: string },
    autor?: string,
  ) {
    const imp = await this.obter(importacaoId);
    if (imp.status !== StatusImportacao.VALIDADO)
      throw new BadRequestException('A importação já saiu da fase de revisão.');

    const linha = await this.prisma.importacaoLinha.findFirst({
      where: { id: linhaId, importacaoId },
    });
    if (!linha) throw new NotFoundException('Linha não encontrada');
    if (linha.classificacao !== ClassificacaoLinha.CONFLITO)
      throw new BadRequestException('Esta linha não está em conflito.');

    let filiadoId = linha.candidatoId;
    if (dto.decisao === DecisaoConflito.MESMA_PESSOA) {
      filiadoId = dto.filiadoId ?? linha.candidatoId;
      if (!filiadoId)
        throw new BadRequestException('Informe a qual cadastro este vínculo pertence.');
      const existe = await this.prisma.filiado.findUnique({
        where: { id: filiadoId },
        select: { id: true },
      });
      if (!existe) throw new BadRequestException('O cadastro informado não existe.');
    }

    return this.prisma.importacaoLinha.update({
      where: { id: linhaId },
      data: {
        decisao: dto.decisao,
        decididoPor: autor,
        decididoEm: new Date(),
        // A decisão passa a valer como destino: MESMA_PESSOA anexa o vínculo ao
        // cadastro escolhido; PESSOA_DIFERENTE cria um novo (filiadoId nulo).
        filiadoId: dto.decisao === DecisaoConflito.MESMA_PESSOA ? filiadoId : null,
      },
    });
  }

  /** Aplica a mesma decisão a todos os conflitos de um motivo — mutirão. */
  async decidirEmLote(
    importacaoId: string,
    dto: { motivo: MotivoConflito; decisao: DecisaoConflito },
    autor?: string,
  ) {
    const imp = await this.obter(importacaoId);
    if (imp.status !== StatusImportacao.VALIDADO)
      throw new BadRequestException('A importação já saiu da fase de revisão.');
    // Em lote só se permite o que NÃO casa ninguém: criar cadastro novo ou
    // deixar de fora. "É a mesma pessoa" em massa é exatamente o merge
    // automático que este módulo existe para impedir — cada um precisa ser
    // olhado, porque o candidato é diferente em cada linha.
    if (dto.decisao === DecisaoConflito.MESMA_PESSOA)
      throw new BadRequestException(
        'Vincular a um cadastro existente exige decisão linha a linha — ' +
          'o candidato muda em cada caso.',
      );

    const { count } = await this.prisma.importacaoLinha.updateMany({
      where: {
        importacaoId,
        classificacao: ClassificacaoLinha.CONFLITO,
        motivoConflito: dto.motivo,
        decisao: DecisaoConflito.PENDENTE,
      },
      data: { decisao: dto.decisao, decididoPor: autor, decididoEm: new Date() },
    });
    return { atualizadas: count };
  }

  // --------------------------------------------------------------------------
  // Confirmação e execução
  // --------------------------------------------------------------------------

  async confirmar(
    id: string,
    dto: { ignorarConflitosPendentes?: boolean },
    ctx: { userId?: string; ip?: string; autor?: string },
  ) {
    const imp = await this.obter(id);
    if (imp.status === StatusImportacao.IMPORTANDO)
      throw new BadRequestException('Importação já está em andamento');
    if (imp.status === StatusImportacao.CONCLUIDO)
      throw new BadRequestException('Importação já concluída');

    const pendentes = await this.prisma.importacaoLinha.count({
      where: {
        importacaoId: id,
        classificacao: ClassificacaoLinha.CONFLITO,
        decisao: DecisaoConflito.PENDENTE,
      },
    });
    // Silêncio não vira ação: ou o operador decide, ou declara explicitamente
    // que quer deixar os conflitos de fora desta rodada.
    if (pendentes > 0 && !dto.ignorarConflitosPendentes)
      throw new BadRequestException(
        `Há ${pendentes} conflito(s) sem decisão. Decida cada um ou confirme ` +
          `"deixar os conflitos pendentes de fora desta importação".`,
      );

    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.IMPORTANDO,
        iniciadoEm: new Date(),
        processados: 0, importados: 0, atualizados: 0, ignorados: 0,
        vinculosCriados: 0, vinculosAtualizados: 0,
      },
    });

    void this.executar(id, ctx).catch(async (e) => {
      this.logger.error(`Falha na importação ${id}: ${e?.message}`);
      await this.prisma.importacao.update({
        where: { id },
        data: { status: StatusImportacao.ERRO, erroMensagem: String(e?.message ?? e) },
      });
    });

    return { ok: true, status: StatusImportacao.IMPORTANDO };
  }

  private async executar(id: string, ctx: { userId?: string; ip?: string; autor?: string }) {
    const inicio = Date.now();
    const autor = ctx.autor ?? 'Importação da folha';

    // NÃO se gera matrícula sindical aqui: a matrícula do cadastro é a da
    // Prefeitura, que vem na própria linha (ver `aplicarLinha`).
    //
    // Matrículas já ocupadas em `filiados` — para recusar a linha em vez de
    // estourar a unicidade no meio do lote.
    const matriculasUsadas = new Set(
      (await this.prisma.filiado.findMany({ select: { matricula: true } })).map((f) =>
        normalizarMatricula(f.matricula),
      ),
    );
    // Matrículas já ocupadas em vínculos — a trava de unicidade que vale mesmo
    // quando o índice único parcial não pôde ser criado na migration.
    const chavesUsadas = new Set(
      (
        await this.prisma.vinculoProfissional.findMany({
          where: { matriculaNormalizada: { not: null } },
          select: { matriculaNormalizada: true },
        })
      ).map((v) => v.matriculaNormalizada!),
    );
    // CPFs já ocupados — o export legado traz CPF e a coluna é única.
    const cpfsUsados = new Set(
      (await this.prisma.filiado.findMany({
        where: { cpf: { not: null } },
        select: { cpf: true },
      })).map((f) => f.cpf!),
    );
    /**
     * O cadastro de organizações, indexado por sigla e razão social.
     *
     * Carregado UMA vez: são dezenas de linhas e milhares de vínculos, e uma
     * consulta por linha multiplicaria por 4.000 uma resposta que não muda
     * durante a importação.
     *
     * É o que faz o vínculo nascer LIGADO ao órgão, em vez de guardar só o
     * nome dele. Sem isto, os 963 vínculos do SINDSERM ficaram com
     * `parteExternaId` nulo enquanto as 36 secretarias estavam cadastradas ali
     * do lado — e "quantos filiados na SEMEC?" passava a depender de agrupar
     * texto, que a folha seguinte pode escrever de outro jeito.
     */
    const organizacoes = indexarOrganizacoes(
      await this.prisma.parteExterna.findMany({
        where: { ativo: true },
        select: { id: true, nome: true, nomeFantasia: true },
      }),
    );

    let processados = 0, importados = 0, atualizados = 0, ignorados = 0;
    let vinculosCriados = 0, vinculosAtualizados = 0, comErro = 0;

    let cursor: string | undefined;
    for (;;) {
      const lote = await this.prisma.importacaoLinha.findMany({
        where: {
          importacaoId: id,
          // ERRO e DUPLICIDADE nunca entram. CONFLITO entra apenas com decisão.
          OR: [
            { classificacao: { in: [ClassificacaoLinha.NOVO, ClassificacaoLinha.ATUALIZACAO] } },
            {
              classificacao: ClassificacaoLinha.CONFLITO,
              decisao: { in: [DecisaoConflito.MESMA_PESSOA, DecisaoConflito.PESSOA_DIFERENTE] },
            },
          ],
        },
        orderBy: { id: 'asc' },
        take: CHUNK,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (lote.length === 0) break;
      cursor = lote[lote.length - 1].id;

      for (const registro of lote) {
        const linha = registro.dados as unknown as LinhaFolha;
        try {
          const resultado = await this.aplicarLinha(registro, linha, {
            id,
            autor,
            matriculasUsadas,
            chavesUsadas,
            cpfsUsados,
            organizacoes,
          });
          if (resultado.criouFiliado) importados++;
          else if (resultado.resultado === 'ATUALIZADO') atualizados++;
          if (resultado.resultado === 'IGNORADO') ignorados++;
          if (resultado.criouVinculo) vinculosCriados++;
          if (resultado.atualizouVinculo) vinculosAtualizados++;
        } catch (e: any) {
          comErro++;
          this.logger.warn(`Linha ${registro.linha} falhou: ${e?.message}`);
          await this.prisma.importacaoLinha.update({
            where: { id: registro.id },
            data: { resultado: 'ERRO', avisos: [String(e?.message ?? e)] as unknown as Prisma.InputJsonValue },
          });
        }
        processados++;
      }

      await this.prisma.importacao.update({
        where: { id },
        data: { processados, importados, atualizados, ignorados, vinculosCriados, vinculosAtualizados },
      });
    }

    // Conflitos deixados pendentes ou marcados como IGNORAR entram no contador
    // de ignorados — o relatório precisa fechar: total = tratados + deixados.
    const naoTratados = await this.prisma.importacaoLinha.count({
      where: {
        importacaoId: id,
        classificacao: ClassificacaoLinha.CONFLITO,
        decisao: { in: [DecisaoConflito.PENDENTE, DecisaoConflito.IGNORAR] },
      },
    });

    const duracaoMs = Date.now() - inicio;
    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.CONCLUIDO,
        finalizadoEm: new Date(),
        duracaoMs,
        processados, importados, atualizados,
        ignorados: ignorados + naoTratados,
        vinculosCriados, vinculosAtualizados,
        comErro,
      },
    });

    await this.audit.registrar({
      userId: ctx.userId,
      acao: AcaoAuditoria.IMPORT,
      entidade: 'Importacao',
      entidadeId: id,
      ip: ctx.ip,
      descricao:
        `Folha importada: ${importados} filiados criados, ${atualizados} atualizados, ` +
        `${vinculosCriados} vínculos criados, ${vinculosAtualizados} vínculos atualizados, ` +
        `${ignorados + naoTratados} deixados de fora, ${comErro} com erro.`,
      metadata: {
        importados, atualizados, vinculosCriados, vinculosAtualizados,
        ignorados: ignorados + naoTratados, comErro, duracaoMs,
      },
    });
  }

  /**
   * Aplica UMA linha. Tudo numa transação: ou a pessoa, o vínculo e o histórico
   * entram juntos, ou não entra nada — um filiado sem vínculo seria um cadastro
   * órfão que ninguém saberia de onde veio.
   */
  private async aplicarLinha(
    registro: { id: string; classificacao: ClassificacaoLinha | null; decisao: DecisaoConflito; filiadoId: string | null; vinculoId: string | null; linha: number },
    linha: LinhaFolha,
    ctx: {
      id: string;
      autor: string;
      /** Matrículas já usadas em `filiados`, normalizadas. */
      matriculasUsadas: Set<string>;
      /** Matrículas já usadas em vínculos, normalizadas. */
      chavesUsadas: Set<string>;
      /** CPFs já usados em `filiados` — só dígitos. */
      cpfsUsados: Set<string>;
      /** Sigla/razão social → id da organização, para ligar o vínculo ao órgão. */
      organizacoes: Map<string, string>;
    },
  ): Promise<{ resultado: string; criouFiliado: boolean; criouVinculo: boolean; atualizouVinculo: boolean }> {
    const chave = linha.chave;

    // Destino: quem já foi identificado (atualização) ou escolhido (conflito
    // resolvido como MESMA_PESSOA). Nulo = cadastro novo.
    const destinoId =
      registro.classificacao === ClassificacaoLinha.ATUALIZACAO ||
      registro.decisao === DecisaoConflito.MESMA_PESSOA
        ? registro.filiadoId
        : null;

    return this.prisma.$transaction(async (tx) => {
      // Reconferência DENTRO da transação: entre a prévia e a confirmação
      // alguém pode ter cadastrado essa mesma matrícula pela tela. Sem esta
      // checagem, a importação criaria o vínculo duplicado que a prévia
      // prometeu não criar.
      const vinculoAtual = chave
        ? await tx.vinculoProfissional.findFirst({ where: { matriculaNormalizada: chave } })
        : null;

      // Chave já ocupada por OUTRA linha desta mesma execução: desiste ANTES de
      // escrever qualquer coisa.
      //
      // A ordem importa. Se esta checagem viesse depois da criação do filiado —
      // como veio na primeira versão —, sair aqui deixaria para trás um cadastro
      // sem nenhum vínculo: uma pessoa no sistema que ninguém sabe de onde veio
      // nem onde trabalha, e que a própria importação não conseguiria explicar.
      if (chave && !vinculoAtual && ctx.chavesUsadas.has(chave)) {
        await this.gravarResultado(tx, registro.id, {
          resultado: 'IGNORADO',
          filiadoId: destinoId,
          alteracoes: {},
        });
        return { resultado: 'IGNORADO', criouFiliado: false, criouVinculo: false, atualizouVinculo: false };
      }

      let filiadoId = destinoId;
      let criouFiliado = false;

      if (vinculoAtual) {
        filiadoId = vinculoAtual.filiadoId;
      } else if (!filiadoId) {
        // A matrícula da Prefeitura vira a matrícula do cadastro, e ela é
        // ÚNICA em `filiados`. Se já pertence a outro cadastro (alguém digitou
        // no balcão e a prévia não pegou, ou a folha repetiu o número), a linha
        // para aqui com mensagem em vez de estourar a unicidade no meio do
        // lote — o arquivo continua intacto para uma segunda rodada.
        if (chave && ctx.matriculasUsadas.has(chave))
          throw new Error(
            `A matrícula ${linha.matricula} já pertence a outro cadastro. ` +
              `Confira quem é antes de importar esta linha.`,
          );

        // CPF é único em `filiados`. Se já é de outro cadastro, a linha para
        // com mensagem em vez de estourar a unicidade no meio do lote.
        if (linha.cpf && ctx.cpfsUsados.has(linha.cpf))
          throw new Error(
            `O CPF desta linha já pertence a outro cadastro. ` +
              `Confira antes de importar (matrícula ${linha.matricula}).`,
          );

        const filiado = await tx.filiado.create({
          data: {
            nomeCompleto: linha.nome,
            // Só o export legado traz estes; a folha mensal deixa tudo vazio,
            // e vazio aqui significa "não informado", nunca "apagar".
            cpf: linha.cpf || null,
            telefonePrincipal: linha.telefone || null,
            email: linha.email || null,
            endereco: linha.endereco || null,
            dataNascimento: linha.dataNascimento ? new Date(linha.dataNascimento) : null,
            dataAdmissao: linha.dataAdmissao ? new Date(linha.dataAdmissao) : null,
            // A MATRÍCULA DO CADASTRO É A DA PREFEITURA.
            //
            // O SINDSERM não emite matrícula sindical: a matrícula que o
            // filiado sabe de cor, apresenta no balcão e usa para entrar no
            // clube é a da Prefeitura. Gerar um "SIN-2026-000123" ao lado
            // criaria um segundo número que ninguém conhece — e a portaria
            // procuraria pelo número errado.
            matricula: linha.matricula,
            qrToken: this.qr.gerarToken(),
            // SEM data de filiação: a folha diz que a pessoa é servidora, não
            // quando ela se filiou ao sindicato. Inventar a data de hoje
            // criaria um pico falso no gráfico de crescimento — o mesmo erro
            // que a carga legada cometeu e que `dataFiliacao` existe para não
            // repetir. Quem se filiar pela tela ganha a data de verdade.
            //
            // SEM CARTEIRINHA, de propósito: ela só vale depois que o desconto
            // em folha é identificado, e é a tela de carteirinhas que emite
            // (`CarteirinhasService.emitir`). Emitir aqui entregaria carteirinha
            // válida a quem ainda não contribui.
            historico: {
              create: {
                tipo: TipoHistoricoFiliado.FILIACAO,
                descricao: `Cadastro criado pela importação da folha (${linha.orgao}, matrícula ${linha.matricula}).`,
                autor: ctx.autor,
                metadata: { importacaoId: ctx.id, linha: registro.linha } as Prisma.InputJsonValue,
              },
            },
          },
        });
        filiadoId = filiado.id;
        criouFiliado = true;
        if (chave) ctx.matriculasUsadas.add(chave);
        if (linha.cpf) ctx.cpfsUsados.add(linha.cpf);
      } else {
        // Cadastro existente: completa APENAS o que está vazio.
        const atual = await tx.filiado.findUnique({
          where: { id: filiadoId },
          select: {
            id: true, nomeCompleto: true, cpf: true, telefonePrincipal: true,
            email: true, endereco: true, dataNascimento: true, dataAdmissao: true,
          },
        });
        if (!atual) throw new Error(`Cadastro ${filiadoId} não existe mais.`);
        const completar = camposParaCompletar(linha, atual);
        if (Object.keys(completar).length > 0) {
          // As datas viajam como texto ISO no JSON da linha; o Prisma quer Date.
          const dados: Record<string, unknown> = { ...completar };
          for (const campo of ['dataNascimento', 'dataAdmissao'])
            if (dados[campo]) dados[campo] = new Date(dados[campo] as string);
          await tx.filiado.update({ where: { id: filiadoId }, data: dados });
        }
      }

      // --- Vínculo ---------------------------------------------------------
      const alvo =
        vinculoAtual ??
        (registro.vinculoId
          ? await tx.vinculoProfissional.findUnique({ where: { id: registro.vinculoId } })
          : null);

      let criouVinculo = false;
      let atualizouVinculo = false;
      const alteracoes: Record<string, Alteracao> = {};

      if (alvo && alvo.filiadoId === filiadoId) {
        // Só grava campo que a planilha TROUXE PREENCHIDO — vazio preserva.
        const data: Prisma.VinculoProfissionalUpdateInput = {};
        for (const campo of ['cargo', 'lotacao', 'quadro'] as const) {
          const novo = linha[campo];
          if (!novo) continue;
          const antigo = alvo[campo] ?? null;
          if (normalizarTexto(antigo) === normalizarTexto(novo)) continue;
          (data as Record<string, unknown>)[campo] = novo;
          alteracoes[campo] = { de: antigo, para: novo };
        }
        // Transferência de secretaria: a matrícula é a mesma, então é a mesma
        // pessoa e o mesmo vínculo — só o órgão mudou.
        if (linha.orgao && normalizarTexto(alvo.empresa) !== normalizarTexto(linha.orgao)) {
          data.empresa = linha.orgao;
          // A ligação acompanha a transferência: o texto novo aponta para outro
          // órgão, e deixar a ligação antiga faria o vínculo dizer uma coisa na
          // tela e outra no relatório. `disconnect` quando o órgão novo não está
          // no cadastro — nunca manter o anterior, que agora está errado.
          const orgaoNovo = organizacaoDoTexto(linha.orgao, ctx.organizacoes);
          data.parteExterna = orgaoNovo ? { connect: { id: orgaoNovo } } : { disconnect: true };
          alteracoes.orgao = { de: alvo.empresa, para: linha.orgao };
        }
        // Desconto em folha só muda quando a planilha INFORMOU (coluna Valor
        // presente). É o campo que libera a carteirinha; mexer nele por omissão
        // invalidaria a carteirinha de quem contribui.
        if (linha.temDesconto !== null && alvo.descontoEmFolha !== linha.temDesconto) {
          data.descontoEmFolha = linha.temDesconto;
          alteracoes.descontoEmFolha = {
            de: String(alvo.descontoEmFolha),
            para: String(linha.temDesconto),
          };
        }
        if (chave && alvo.matriculaNormalizada !== chave) data.matriculaNormalizada = chave;

        if (Object.keys(data).length > 0) {
          await tx.vinculoProfissional.update({ where: { id: alvo.id }, data });
          atualizouVinculo = Object.keys(alteracoes).length > 0;
        }
        await this.gravarResultado(tx, registro.id, {
          resultado: criouFiliado ? 'IMPORTADO' : 'ATUALIZADO',
          filiadoId,
          vinculoId: alvo.id,
          alteracoes,
        });
        if (atualizouVinculo)
          await this.registrarHistorico(tx, filiadoId!, alteracoes, ctx, linha, registro.linha);
        return {
          resultado: criouFiliado ? 'IMPORTADO' : 'ATUALIZADO',
          criouFiliado,
          criouVinculo,
          atualizouVinculo,
        };
      }

      // Não há vínculo com essa chave para este filiado → cria.
      // (A chave já estar ocupada por outra linha foi descartado lá em cima,
      // antes de qualquer escrita.)
      const ordem =
        (await tx.vinculoProfissional.count({ where: { filiadoId: filiadoId! } })) + 1;
      const novo = await tx.vinculoProfissional.create({
        data: {
          filiadoId: filiadoId!,
          // Órgão vazio vira um rótulo honesto em vez de string vazia: `empresa`
          // é obrigatória, e "" na tela pareceria um defeito do sistema.
          empresa: linha.orgao || 'NÃO INFORMADO NA FOLHA',
          // NASCE LIGADO ao órgão do cadastro quando a sigla bate. `null` é
          // resposta legítima — "NÃO INFORMADO NA FOLHA" não é organização
          // nenhuma, e órgão fora da lista fica para a secretaria cadastrar.
          parteExternaId: organizacaoDoTexto(linha.orgao, ctx.organizacoes),
          matricula: linha.matricula,
          cargo: linha.cargo || null,
          lotacao: linha.lotacao || null,
          quadro: linha.quadro || null,
          matriculaNormalizada: chave || null,
          ordem,
          // O desconto sai do que a folha EVIDENCIA (coluna Valor lida como
          // sim/não), não de uma suposição. Quando a folha não informa, fica
          // `false` — e a carteirinha, pendente, até alguém confirmar. Errar
          // para o lado do "não contribui" é recuperável; o contrário emite
          // carteirinha válida para quem não paga.
          descontoEmFolha: linha.temDesconto === true,
        },
      });
      if (chave) ctx.chavesUsadas.add(chave);
      criouVinculo = true;

      await this.gravarResultado(tx, registro.id, {
        resultado: criouFiliado ? 'IMPORTADO' : 'ATUALIZADO',
        filiadoId,
        vinculoId: novo.id,
        alteracoes: {
          orgao: { de: null, para: linha.orgao },
          matricula: { de: null, para: linha.matricula },
        },
      });

      if (!criouFiliado)
        await tx.filiadoHistorico.create({
          data: {
            filiadoId: filiadoId!,
            tipo: TipoHistoricoFiliado.ALTERACAO,
            descricao:
              `Vínculo funcional acrescentado pela importação da folha: ` +
              `${linha.orgao}, matrícula ${linha.matricula}` +
              `${linha.cargo ? `, ${linha.cargo}` : ''}.`,
            autor: ctx.autor,
            metadata: { importacaoId: ctx.id, linha: registro.linha } as Prisma.InputJsonValue,
          },
        });

      return {
        resultado: criouFiliado ? 'IMPORTADO' : 'ATUALIZADO',
        criouFiliado,
        criouVinculo,
        atualizouVinculo,
      };
    });
  }

  private async gravarResultado(
    tx: Prisma.TransactionClient,
    linhaId: string,
    dados: { resultado: string; filiadoId: string | null; vinculoId?: string; alteracoes: Record<string, Alteracao> },
  ) {
    await tx.importacaoLinha.update({
      where: { id: linhaId },
      data: {
        resultado: dados.resultado,
        filiadoId: dados.filiadoId,
        vinculoId: dados.vinculoId,
        alteracoes: dados.alteracoes as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Histórico do filiado com o ANTES e o DEPOIS de cada campo.
   *
   * É o que responde "por que o cargo dele mudou?" seis meses depois. Sem o
   * valor anterior, o histórico só diria que algo mudou — e o dado antigo teria
   * sumido para sempre, que é a definição de perder dado.
   */
  private async registrarHistorico(
    tx: Prisma.TransactionClient,
    filiadoId: string,
    alteracoes: Record<string, Alteracao>,
    ctx: { id: string; autor: string },
    linha: LinhaFolha,
    numeroLinha: number,
  ) {
    const ROTULO: Record<string, string> = {
      cargo: 'cargo', lotacao: 'lotação', quadro: 'quadro', orgao: 'órgão',
    };
    const descricao = Object.entries(alteracoes)
      .map(([campo, a]) => `${ROTULO[campo] ?? campo}: "${a.de ?? '(vazio)'}" → "${a.para}"`)
      .join('; ');

    await tx.filiadoHistorico.create({
      data: {
        filiadoId,
        tipo: TipoHistoricoFiliado.ALTERACAO,
        descricao: `Atualização pela folha (matrícula ${linha.matricula}). ${descricao}`,
        autor: ctx.autor,
        metadata: { importacaoId: ctx.id, linha: numeroLinha, alteracoes } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
