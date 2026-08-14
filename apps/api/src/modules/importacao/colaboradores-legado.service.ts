import { QrCodeService, dataCalendario, gerarMatricula } from '@core/infra';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AcaoAuditoria,
  ClassificacaoLinha,
  PerfilImportacao,
  Prisma,
  StatusColaborador,
  StatusImportacao,
  TipoHistoricoColaborador,
  TipoVinculo,
} from '@prisma/client';
import { createHash } from 'node:crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EstrategiaDependentes } from './colaboradores-legado.dto';
import {
  CODIGO_LABEL_COLABORADOR,
  ColaboradorLegado,
  DependenteLegado,
  LinhaNormalizada,
  NAO_INFORMADO,
  lerCsv,
  lerJson,
  marcarDuplicidadeNoArquivo,
  normalizarRegistro,
} from './colaboradores-legado.util';
import { lerPlanilha } from './planilha.util';

/** Linhas da prévia gravadas por `createMany` — o mesmo lote da folha. */
const CHUNK = 500;

/**
 * De quantas em quantas pessoas o contador de progresso vai ao banco.
 *
 * A tela recarrega de 800 em 800 ms; escrever a cada pessoa só multiplicaria
 * UPDATEs na MESMA linha de `importacoes`, todos disputando o lock dela.
 */
const PASSO_PROGRESSO = 25;

/**
 * IMPORTAÇÃO DA EQUIPE DO SINDICATO vinda do sistema antigo.
 *
 * Fluxo: upload → normalização → comparação com a base → PRÉVIA → confirmação →
 * execução → relatório. A prévia não escreve uma linha sequer em
 * `colaboradores`; só em `importacoes`/`importacao_linhas`.
 *
 * POR QUE NÃO TEM TELA DE DECISÃO DE CONFLITO, como a folha da Prefeitura tem.
 * Lá são ~4.000 filiados sem CPF, e casar pessoas pela matrícula produz centenas
 * de dúvidas legítimas que só um humano resolve. Aqui são as algumas DEZENAS de
 * pessoas que trabalham no sindicato, e o CPF — que `colaboradores.cpf` exige e
 * mantém único — responde a identidade sozinho. O que sobra de ambíguo é uma
 * matrícula que já pertence a outro CPF: isso vira ERRO na prévia, com o nome de
 * quem já a tem. Corrigir três linhas no arquivo é mais rápido, para quem opera,
 * do que percorrer uma fila de decisões — e é uma tela a menos para manter.
 *
 * IDEMPOTENTE POR CPF: rodar o mesmo arquivo duas vezes atualiza, não duplica.
 * É requisito, não elegância — migração real se roda três ou quatro vezes até o
 * arquivo da origem sair certo.
 *
 * ISOLAMENTO POR CLIENTE: cada sindicato é um banco e um serviço. Só usa
 * `this.prisma`, e a rota é fechada por `@ModuloTenant('colaboradores')`.
 */
@Injectable()
export class ColaboradoresLegadoService {
  private readonly logger = new Logger(ColaboradoresLegadoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qr: QrCodeService,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Upload → prévia
  // ==========================================================================

  async processarUpload(
    file: Express.Multer.File,
    userId: string | undefined,
    opts: { permitirReenvio?: boolean } = {},
  ) {
    const registros = await this.lerArquivo(file);

    // Hash do CONTEÚDO, não do nome: renomear "equipe.json" para "equipe (1).json"
    // é exatamente como a importação repetida acontece na prática.
    const hashArquivo = createHash('sha256').update(file.buffer).digest('hex');
    const anterior = await this.prisma.importacao.findFirst({
      where: {
        hashArquivo,
        status: StatusImportacao.CONCLUIDO,
        perfil: PerfilImportacao.COLABORADORES_LEGADO,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, nomeArquivo: true, createdAt: true, importados: true },
    });
    if (anterior && !opts.permitirReenvio)
      throw new BadRequestException(
        `Este arquivo já foi importado em ${anterior.createdAt.toLocaleDateString('pt-BR')} ` +
          `como "${anterior.nomeArquivo}" (${anterior.importados} cadastrados). ` +
          'Se quiser processar de novo, marque "importar mesmo assim".',
      );

    const linhas = registros.map((r, i) => normalizarRegistro(r, i + 1));
    marcarDuplicidadeNoArquivo(linhas);

    const base = await this.carregarBase();
    for (const linha of linhas) this.compararComABase(linha, base);

    const contagem = { NOVO: 0, ATUALIZACAO: 0, ERRO: 0 };
    const registrosLinha: Prisma.ImportacaoLinhaCreateManyInput[] = [];
    let dependentesNoArquivo = 0;

    const importacao = await this.prisma.importacao.create({
      data: {
        perfil: PerfilImportacao.COLABORADORES_LEGADO,
        nomeArquivo: file.originalname,
        tamanhoBytes: file.size,
        hashArquivo,
        status: StatusImportacao.VALIDANDO,
        total: linhas.length,
        userId,
      },
    });

    for (const linha of linhas) {
      const classificacao = linha.erros.length
        ? ClassificacaoLinha.ERRO
        : linha.existente
          ? ClassificacaoLinha.ATUALIZACAO
          : ClassificacaoLinha.NOVO;
      contagem[classificacao as 'NOVO' | 'ATUALIZACAO' | 'ERRO']++;
      if (classificacao !== ClassificacaoLinha.ERRO)
        dependentesNoArquivo += linha.dados.dependentes.length;

      registrosLinha.push({
        importacaoId: importacao.id,
        linha: linha.numero,
        dados: linha.dados as unknown as Prisma.InputJsonValue,
        nome: linha.dados.nome || null,
        cpf: linha.dados.cpf || null,
        matricula: linha.dados.matricula,
        telefone: linha.dados.telefone,
        // Reaproveita as colunas denormalizadas que a prévia já sabe exibir:
        // `empresa` recebe o contratante e `lotacao` recebe o setor.
        empresa: linha.dados.empresaNome,
        lotacao: linha.dados.setor,
        cargo: linha.dados.cargo,
        situacao: linha.dados.status,
        valido: linha.erros.length === 0,
        duplicadoNoSistema: !!linha.existente,
        erros: linha.erros.length ? linha.erros : undefined,
        avisos: linha.avisos.length ? linha.avisos : undefined,
        codigos: linha.codigos,
        classificacao,
        candidatoId: linha.existente?.id ?? null,
        alteracoes: linha.alteracoes as unknown as Prisma.InputJsonValue,
      });
    }

    // Em lotes, como a folha faz: um `createMany` de 20.000 linhas com um JSON
    // em cada uma vira uma instrução única gigantesca, e o teto de parâmetros
    // do PostgreSQL é o tipo de limite que só aparece com o arquivo do cliente.
    for (let i = 0; i < registrosLinha.length; i += CHUNK) {
      await this.prisma.importacaoLinha.createMany({ data: registrosLinha.slice(i, i + CHUNK) });
    }

    const atualizada = await this.prisma.importacao.update({
      where: { id: importacao.id },
      data: {
        status: StatusImportacao.VALIDADO,
        validos: contagem.NOVO + contagem.ATUALIZACAO,
        comErro: contagem.ERRO,
        duplicados: contagem.ATUALIZACAO,
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
        `Prévia da equipe legada "${file.originalname}": ${contagem.NOVO} novos, ` +
        `${contagem.ATUALIZACAO} já cadastrados, ${contagem.ERRO} com erro, ` +
        `${dependentesNoArquivo} dependentes.`,
      metadata: { ...contagem, dependentesNoArquivo, hashArquivo, reenvio: !!anterior },
    });

    return { ...atualizada, dependentesNoArquivo, reenvioDe: anterior?.id ?? null };
  }

  /**
   * JSON ou planilha — o formato do arquivo é acidente para quem importa.
   *
   * O JSON é o formato canônico (é o que o sistema antigo exporta, com os
   * dependentes aninhados); o CSV existe porque no meio do caminho alguém
   * reexporta como planilha. Ver `lerCsv` para as duas formas de dependente que
   * um CSV consegue expressar.
   */
  private async lerArquivo(file: Express.Multer.File) {
    if (/\.json$/i.test(file.originalname)) return lerJson(file.buffer);

    const { linhas, cabecalhos } = await lerPlanilha(file);
    // Guarda de layout: falhar aqui, com os cabeçalhos lidos, é muito melhor do
    // que produzir "Nome ausente" em todas as linhas de um arquivo perfeito cuja
    // coluna se chamava `name`.
    const temNome = linhas.some((l) =>
      Object.entries(l).some(([k, v]) => /nome|funcionario|colaborador/i.test(k) && v),
    );
    if (!temNome)
      throw new BadRequestException(
        'Não reconheci o layout: nenhuma coluna corresponde ao NOME da pessoa. ' +
          `Colunas lidas: ${cabecalhos.join(', ') || '(nenhuma)'}.`,
      );
    return lerCsv(linhas);
  }

  // ==========================================================================
  // Comparação com a base
  // ==========================================================================

  private async carregarBase() {
    const colaboradores = await this.prisma.colaborador.findMany({
      select: {
        id: true, nome: true, cpf: true, matricula: true, cargoId: true,
        departamentoId: true, status: true, tipoVinculo: true, email: true,
        telefone: true, dataAdmissao: true, dataNascimento: true,
      },
    });
    return {
      porCpf: new Map(colaboradores.map((c) => [c.cpf, c])),
      porMatricula: new Map(
        colaboradores
          .filter((c) => c.matricula)
          .map((c) => [c.matricula!.toUpperCase(), c]),
      ),
    };
  }

  private compararComABase(linha: LinhaNormalizada, base: BaseColaboradores) {
    const { cpf, matricula } = linha.dados;
    const existente = cpf ? base.porCpf.get(cpf) : undefined;
    if (existente) linha.existente = { id: existente.id, nome: existente.nome };

    /**
     * MATRÍCULA QUE JÁ É DE OUTRA PESSOA — erro, não conflito para decidir.
     *
     * `colaboradores.matricula` é única. Gravar assim mesmo estouraria a
     * unicidade no meio do lote, e o registro que já estava lá é o que circula
     * num crachá impresso. Duas matrículas iguais em dois crachás é o defeito
     * que a portaria não consegue resolver no balcão.
     */
    if (matricula) {
      const dona = base.porMatricula.get(matricula.toUpperCase());
      if (dona && dona.cpf !== cpf) {
        linha.erros.push(
          `A matrícula "${matricula}" já pertence a ${dona.nome} (CPF ${mascarar(dona.cpf)}). ` +
            'Corrija a matrícula na origem ou deixe-a em branco para o sistema gerar uma.',
        );
        linha.codigos.push('MATRICULA_DE_OUTRA_PESSOA');
      }
    }

    // O QUE ESTA LINHA VAI MUDAR, campo a campo. Sem isto, "12 atualizados" é um
    // número que ninguém consegue conferir depois — nem desfazer.
    if (existente) {
      const d = linha.dados;
      const alteracoes: Record<string, { de: unknown; para: unknown }> = {};
      const comparar = (campo: string, de: unknown, para: unknown) => {
        if (para !== null && para !== undefined && para !== '' && de !== para)
          alteracoes[campo] = { de, para };
      };
      comparar('nome', existente.nome, d.nome);
      comparar('status', existente.status, d.status);
      comparar('tipoVinculo', existente.tipoVinculo, d.tipoVinculo);
      comparar('email', existente.email, d.email);
      comparar('telefone', existente.telefone, d.telefone);
      comparar('dataAdmissao', diaDe(existente.dataAdmissao), d.dataAdmissao);
      comparar('dataNascimento', diaDe(existente.dataNascimento), d.dataNascimento);
      if (Object.keys(alteracoes).length) linha.alteracoes = alteracoes;

      // A matrícula do arquivo NÃO sobrescreve a que já existe: ela pode estar
      // impressa num crachá em circulação. Só preenche o vazio — e a divergência
      // fica visível em vez de silenciosa.
      if (d.matricula && existente.matricula && d.matricula !== existente.matricula) {
        linha.avisos.push(
          `Matrícula no arquivo ("${d.matricula}") difere da cadastrada ` +
            `("${existente.matricula}"). A cadastrada foi mantida — ela pode estar num crachá.`,
        );
        linha.codigos.push('MATRICULA_DIVERGENTE');
      }
    }
  }

  // ==========================================================================
  // Prévia — consulta
  // ==========================================================================

  async resumo(id: string) {
    const imp = await this.obter(id);
    const [novo, atualizacao, erro, comAviso, linhas] = await this.prisma.$transaction([
      this.contar(id, ClassificacaoLinha.NOVO),
      this.contar(id, ClassificacaoLinha.ATUALIZACAO),
      this.contar(id, ClassificacaoLinha.ERRO),
      this.prisma.importacaoLinha.count({
        where: { importacaoId: id, NOT: { avisos: { equals: Prisma.DbNull } } },
      }),
      this.prisma.importacaoLinha.findMany({
        where: { importacaoId: id },
        select: { codigos: true, dados: true, classificacao: true },
      }),
    ]);

    // Resumo AGRUPADO POR PROBLEMA. "38 linhas com erro" não diz o que fazer;
    // "38 linhas sem CPF" diz exatamente qual coluna consertar na origem.
    const porCodigo = new Map<string, number>();
    let dependentes = 0;
    for (const l of linhas) {
      for (const c of new Set(l.codigos)) porCodigo.set(c, (porCodigo.get(c) ?? 0) + 1);
      if (l.classificacao !== ClassificacaoLinha.ERRO)
        dependentes += (l.dados as unknown as ColaboradorLegado)?.dependentes?.length ?? 0;
    }

    return {
      importacao: imp,
      contagem: { NOVO: novo, ATUALIZACAO: atualizacao, ERRO: erro, COM_AVISO: comAviso },
      dependentes,
      problemas: [...porCodigo.entries()]
        .map(([codigo, total]) => ({
          codigo,
          rotulo: CODIGO_LABEL_COLABORADOR[codigo] ?? codigo,
          total,
        }))
        .sort((a, b) => b.total - a.total),
    };
  }

  private contar(importacaoId: string, classificacao: ClassificacaoLinha) {
    return this.prisma.importacaoLinha.count({ where: { importacaoId, classificacao } });
  }

  async listarLinhas(
    id: string,
    params: { busca?: string; classificacao?: string; page?: number },
  ) {
    await this.obter(id);
    const page = Number(params.page) || 1;
    const pageSize = 25;

    const where: Prisma.ImportacaoLinhaWhereInput = { importacaoId: id };
    if (params.classificacao === 'AVISO') {
      where.NOT = { avisos: { equals: Prisma.DbNull } };
    } else if (params.classificacao) {
      where.classificacao = params.classificacao as ClassificacaoLinha;
    }
    if (params.busca) {
      where.OR = [
        { nome: { contains: params.busca, mode: 'insensitive' } },
        { cpf: { contains: params.busca.replace(/\D/g, '') } },
        { matricula: { contains: params.busca, mode: 'insensitive' } },
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

    return {
      data: data.map((l) => ({
        ...l,
        // A prévia mostra a FAMÍLIA junto com a pessoa: é metade do que se está
        // importando, e conferir depois de gravado não é conferir.
        dependentes: (l.dados as unknown as ColaboradorLegado)?.dependentes ?? [],
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  private async obter(id: string) {
    const imp = await this.prisma.importacao.findUnique({ where: { id } });
    if (!imp) throw new NotFoundException('Importação não encontrada');
    if (imp.perfil !== PerfilImportacao.COLABORADORES_LEGADO)
      throw new BadRequestException('Esta importação não é de colaboradores.');
    return imp;
  }

  // ==========================================================================
  // Confirmação → execução
  // ==========================================================================

  async confirmar(
    id: string,
    dto: {
      atualizarExistentes?: boolean;
      dependentes?: EstrategiaDependentes;
      importarSomenteValidos?: boolean;
    },
    ctx: { userId?: string; ip?: string; autor?: string },
  ) {
    const imp = await this.obter(id);
    if (imp.status === StatusImportacao.IMPORTANDO)
      throw new BadRequestException('Importação já está em andamento');
    if (imp.status === StatusImportacao.CONCLUIDO)
      throw new BadRequestException('Importação já concluída');

    const comErro = await this.contar(id, ClassificacaoLinha.ERRO);
    // Silêncio não vira ação: ou o arquivo está limpo, ou o operador declara
    // que aceita deixar as linhas com erro de fora desta rodada.
    if (comErro > 0 && dto.importarSomenteValidos === false)
      throw new BadRequestException(
        `Há ${comErro} linha(s) com erro. Corrija o arquivo e envie de novo, ou ` +
          'marque "importar as linhas válidas mesmo assim".',
      );

    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.IMPORTANDO,
        iniciadoEm: new Date(),
        processados: 0, importados: 0, atualizados: 0, ignorados: 0,
        dependentesCriados: 0, dependentesRemovidos: 0,
      },
    });

    void this.executar(id, dto, ctx).catch(async (e) => {
      this.logger.error(`Falha na importação ${id}: ${e?.message}`);
      await this.prisma.importacao.update({
        where: { id },
        data: { status: StatusImportacao.ERRO, erroMensagem: String(e?.message ?? e) },
      });
    });

    return { ok: true, status: StatusImportacao.IMPORTANDO };
  }

  private async executar(
    id: string,
    dto: {
      atualizarExistentes?: boolean;
      dependentes?: EstrategiaDependentes;
    },
    ctx: { userId?: string; ip?: string; autor?: string },
  ) {
    const inicio = Date.now();
    const autor = ctx.autor ?? 'Importação da equipe';
    const atualizarExistentes = dto.atualizarExistentes !== false;
    const estrategia = dto.dependentes ?? EstrategiaDependentes.ACRESCENTAR;

    const linhas = await this.prisma.importacaoLinha.findMany({
      where: {
        importacaoId: id,
        classificacao: { in: [ClassificacaoLinha.NOVO, ClassificacaoLinha.ATUALIZACAO] },
      },
      orderBy: { linha: 'asc' },
    });

    const dados = linhas.map((l) => l.dados as unknown as ColaboradorLegado);
    // Cargos e departamentos resolvidos DE UMA VEZ, antes do laço: são FK
    // obrigatórias e se repetem muito (30 pessoas, 6 setores). Um upsert por
    // pessoa faria 60 idas ao banco para criar 6 linhas.
    const cargos = await this.resolverLista('cargo', dados.map((d) => d.cargo));
    const setores = await this.resolverLista('departamento', dados.map((d) => d.setor));
    const empresas = await this.indexarEmpresas();
    const proximaMatricula = await this.geradorDeMatricula();

    let importados = 0;
    let atualizados = 0;
    let ignorados = 0;
    let comErro = 0;
    let dependentesCriados = 0;
    let dependentesRemovidos = 0;
    let processados = 0;

    for (const linha of linhas) {
      const d = linha.dados as unknown as ColaboradorLegado;
      try {
        const resultado = await this.aplicarLinha(d, {
          cargoId: cargos.get(chave(d.cargo))!,
          departamentoId: setores.get(chave(d.setor))!,
          empresaId: d.empresaNome ? (empresas.get(chave(d.empresaNome)) ?? null) : null,
          atualizarExistentes,
          estrategia,
          autor,
          proximaMatricula,
        });

        if (resultado.acao === 'IMPORTADO') importados++;
        else if (resultado.acao === 'ATUALIZADO') atualizados++;
        else ignorados++;
        dependentesCriados += resultado.dependentesCriados;
        dependentesRemovidos += resultado.dependentesRemovidos;

        await this.prisma.importacaoLinha.update({
          where: { id: linha.id },
          data: { resultado: resultado.acao, colaboradorId: resultado.colaboradorId },
        });
      } catch (e) {
        /**
         * UMA LINHA QUE FALHA NÃO DERRUBA O LOTE.
         *
         * Numa carga de milhares, abortar na 12ª deixaria 11 dentro e o resto
         * fora, sem que a tela dissesse quais — e a segunda tentativa pararia de
         * novo no mesmo ponto. Cada pessoa é a sua própria unidade de sucesso, e
         * o erro fica gravado na linha dela.
         */
        comErro++;
        this.logger.warn(`Linha ${linha.linha} (${d.nome}): ${(e as Error)?.message}`);
        await this.prisma.importacaoLinha.update({
          where: { id: linha.id },
          data: {
            resultado: 'ERRO',
            erros: [...(linha.erros as string[] ?? []), `Falha ao gravar: ${(e as Error)?.message}`],
          },
        });
      }

      /**
       * PROGRESSO A CADA `PASSO_PROGRESSO`, e não a cada pessoa.
       *
       * Era um `increment: 1` por linha — numa carga de 8.000 isso são 8.000
       * UPDATEs na MESMA linha de `importacoes`, serializados pelo lock dela.
       * A barra da tela lê de 800 em 800 ms e não enxerga a diferença; o banco
       * enxerga. O `processados` final é escrito junto com o status CONCLUIDO,
       * logo abaixo, então o número não fica arredondado no fim.
       */
      processados++;
      if (processados % PASSO_PROGRESSO === 0) {
        await this.prisma.importacao.update({ where: { id }, data: { processados } });
      }
    }

    const duracaoMs = Date.now() - inicio;
    await this.prisma.importacao.update({
      where: { id },
      data: {
        status: StatusImportacao.CONCLUIDO,
        finalizadoEm: new Date(),
        duracaoMs,
        processados,
        importados,
        atualizados,
        ignorados,
        comErro,
        dependentesCriados,
        dependentesRemovidos,
      },
    });

    await this.audit.registrar({
      userId: ctx.userId,
      acao: AcaoAuditoria.IMPORT,
      entidade: 'Importacao',
      entidadeId: id,
      ip: ctx.ip,
      descricao:
        `Importação da equipe concluída: ${importados} cadastrados, ` +
        `${atualizados} atualizados, ${ignorados} ignorados, ${comErro} com falha. ` +
        `Dependentes: ${dependentesCriados} incluídos, ${dependentesRemovidos} removidos.`,
      metadata: {
        importados, atualizados, ignorados, comErro,
        dependentesCriados, dependentesRemovidos, duracaoMs,
        estrategiaDependentes: estrategia,
      },
    });
  }

  // ==========================================================================
  // Uma pessoa
  // ==========================================================================

  private async aplicarLinha(
    d: ColaboradorLegado,
    opts: {
      cargoId: string;
      departamentoId: string;
      empresaId: string | null;
      atualizarExistentes: boolean;
      estrategia: EstrategiaDependentes;
      autor: string;
      proximaMatricula: () => string;
    },
  ): Promise<{
    acao: 'IMPORTADO' | 'ATUALIZADO' | 'IGNORADO';
    colaboradorId: string | null;
    dependentesCriados: number;
    dependentesRemovidos: number;
  }> {
    const existente = await this.prisma.colaborador.findUnique({
      where: { cpf: d.cpf },
      select: { id: true, matricula: true },
    });

    if (existente && !opts.atualizarExistentes)
      return { acao: 'IGNORADO', colaboradorId: existente.id, dependentesCriados: 0, dependentesRemovidos: 0 };

    /**
     * A PESSOA E A FAMÍLIA DELA ENTRAM JUNTAS, ou nenhuma das duas.
     *
     * Sem a transação, uma falha ao gravar o terceiro filho deixaria o
     * colaborador cadastrado com metade dos dependentes — e a segunda rodada,
     * que casa por CPF, o veria como "já existe" e não completaria nada.
     */
    return this.prisma.$transaction(async (tx) => {
      const comuns = {
        nome: d.nome,
        tipoVinculo: d.tipoVinculo,
        status: d.status,
        statusMotivo: d.statusMotivo,
        dataNascimento: dataCalendario(d.dataNascimento) ?? null,
        dataAdmissao: dataCalendario(d.dataAdmissao) ?? null,
        telefone: d.telefone,
        email: d.email,
        cep: d.cep,
        logradouro: d.logradouro,
        numero: d.numero,
        bairro: d.bairro,
        cidade: d.cidade,
        uf: d.uf,
        cargoId: opts.cargoId,
        departamentoId: opts.departamentoId,
        // A regra do vínculo é a MESMA do cadastro pela tela: só PJ e
        // terceirizado guardam contratante. Ver `aplicarRegrasVinculo`.
        empresaId: temContratante(d.tipoVinculo) ? opts.empresaId : null,
        empresaNome: temContratante(d.tipoVinculo) ? d.empresaNome : null,
      };

      let colaboradorId: string;
      let acao: 'IMPORTADO' | 'ATUALIZADO';

      if (existente) {
        await tx.colaborador.update({
          where: { id: existente.id },
          data: {
            ...comuns,
            // Só preenche o vazio: a matrícula cadastrada pode estar impressa
            // num crachá em circulação (ver `compararComABase`).
            matricula: existente.matricula ?? d.matricula ?? opts.proximaMatricula(),
          },
        });
        colaboradorId = existente.id;
        acao = 'ATUALIZADO';
      } else {
        const criado = await tx.colaborador.create({
          data: {
            ...comuns,
            cpf: d.cpf,
            // A matrícula da ORIGEM é a que a pessoa sabe de cor; só quando ela
            // não vem é que o sistema emite a sua (FUNC-AAAA-NNNNNN).
            matricula: d.matricula ?? opts.proximaMatricula(),
            qrToken: this.qr.gerarToken(),
          },
          select: { id: true },
        });
        colaboradorId = criado.id;
        acao = 'IMPORTADO';
      }

      const familia = await this.sincronizarDependentes(
        tx,
        colaboradorId,
        d.dependentes,
        existente ? opts.estrategia : EstrategiaDependentes.ACRESCENTAR,
      );

      await tx.colaboradorHistorico.create({
        data: {
          colaboradorId,
          tipo: acao === 'IMPORTADO'
            ? TipoHistoricoColaborador.CADASTRO
            : TipoHistoricoColaborador.ALTERACAO,
          descricao:
            acao === 'IMPORTADO'
              ? `Cadastrado pela importação da equipe do sistema antigo${resumirFamilia(familia)}.`
              : `Dados atualizados pela importação da equipe do sistema antigo${resumirFamilia(familia)}.`,
          autor: opts.autor,
          metadata: { origem: 'IMPORTACAO_COLABORADORES_LEGADO', ...familia },
        },
      });

      return { acao, colaboradorId, ...familia };
    });
  }

  /**
   * A FAMÍLIA DO COLABORADOR, conforme a estratégia escolhida.
   *
   * O casamento é por CPF quando há CPF, e por NOME + NASCIMENTO quando não há —
   * criança sem CPF é a maioria dos dependentes, e sem a segunda chave toda
   * reimportação criaria o mesmo filho de novo.
   */
  private async sincronizarDependentes(
    tx: Prisma.TransactionClient,
    colaboradorId: string,
    novos: DependenteLegado[],
    estrategia: EstrategiaDependentes,
  ): Promise<{ dependentesCriados: number; dependentesRemovidos: number }> {
    if (estrategia === EstrategiaDependentes.MANTER)
      return { dependentesCriados: 0, dependentesRemovidos: 0 };

    const atuais = await tx.dependente.findMany({ where: { colaboradorId } });
    const chaveDe = (d: { cpf: string | null; nome: string; dataNascimento: Date | string }) =>
      d.cpf
        ? `cpf:${d.cpf}`
        : `nn:${chave(d.nome)}|${
            typeof d.dataNascimento === 'string'
              ? d.dataNascimento
              : d.dataNascimento.toISOString().slice(0, 10)
          }`;

    const existentes = new Map(atuais.map((a) => [chaveDe(a), a]));
    const vistos = new Set<string>();
    let criados = 0;

    for (const novo of novos) {
      const k = chaveDe(novo);
      if (vistos.has(k)) continue; // o mesmo dependente duas vezes no arquivo
      vistos.add(k);
      const jaTem = existentes.get(k);
      if (jaTem) {
        await tx.dependente.update({
          where: { id: jaTem.id },
          data: {
            nome: novo.nome,
            tipo: novo.tipo,
            cpf: novo.cpf,
            dataNascimento: dataCalendario(novo.dataNascimento),
          },
        });
        continue;
      }
      await tx.dependente.create({
        data: {
          colaboradorId,
          nome: novo.nome,
          tipo: novo.tipo,
          cpf: novo.cpf,
          dataNascimento: dataCalendario(novo.dataNascimento),
          qrToken: this.qr.gerarToken(),
        },
      });
      criados++;
    }

    let removidos = 0;
    if (estrategia === EstrategiaDependentes.SUBSTITUIR) {
      const sobrando = atuais.filter((a) => !vistos.has(chaveDe(a)));
      if (sobrando.length) {
        await tx.dependente.deleteMany({ where: { id: { in: sobrando.map((s) => s.id) } } });
        removidos = sobrando.length;
      }
    }

    return { dependentesCriados: criados, dependentesRemovidos: removidos };
  }

  // ==========================================================================
  // Listas de apoio
  // ==========================================================================

  /**
   * Cargos e departamentos: acha o que existe, cria o que falta, devolve os ids.
   *
   * CASA SEM DIFERENCIAR MAIÚSCULA E ACENTO. `nome` é único e o PostgreSQL
   * compara texto byte a byte, então "TI" e "Ti" caberiam os dois na tabela —
   * e o filtro por setor passaria a mostrar metade das pessoas. Quem chega
   * primeiro define a grafia; os seguintes se encaixam nela.
   */
  private async resolverLista(
    entidade: 'cargo' | 'departamento',
    nomes: string[],
  ): Promise<Map<string, string>> {
    const distintos = new Map<string, string>();
    for (const n of nomes) {
      const limpo = (n || '').trim() || NAO_INFORMADO;
      if (!distintos.has(chave(limpo))) distintos.set(chave(limpo), limpo);
    }

    const existentes =
      entidade === 'cargo'
        ? await this.prisma.cargo.findMany({ select: { id: true, nome: true } })
        : await this.prisma.departamento.findMany({ select: { id: true, nome: true } });
    const porChave = new Map(existentes.map((e) => [chave(e.nome), e.id]));

    for (const [k, nome] of distintos) {
      if (porChave.has(k)) continue;
      const criado =
        entidade === 'cargo'
          ? await this.prisma.cargo.create({ data: { nome }, select: { id: true } })
          : await this.prisma.departamento.create({ data: { nome }, select: { id: true } });
      porChave.set(k, criado.id);
    }

    return porChave;
  }

  /**
   * Empresas já cadastradas, por razão social e nome fantasia.
   *
   * SÓ LÊ, NUNCA CRIA. `empresas` é o dossiê PATRONAL — tem CNPJ obrigatório e
   * credencial de portal —, e a origem traz o contratante só pelo nome. Criar
   * uma linha ali para cada "Empresa Parceira" encheria o cadastro patronal de
   * empresas que não contribuem e não têm CNPJ real. Quando o nome casa com uma
   * que existe, o vínculo é feito; quando não casa, fica `empresaNome` em texto.
   */
  private async indexarEmpresas(): Promise<Map<string, string>> {
    const empresas = await this.prisma.empresa.findMany({
      select: { id: true, razaoSocial: true, nomeFantasia: true },
    });
    const indice = new Map<string, string>();
    for (const e of empresas) {
      indice.set(chave(e.razaoSocial), e.id);
      if (e.nomeFantasia) indice.set(chave(e.nomeFantasia), e.id);
    }
    return indice;
  }

  /**
   * Emissor de matrícula para quem chega sem uma.
   *
   * Lê o maior número JÁ EMITIDO uma vez e incrementa em memória. Consultar a
   * cada pessoa devolveria o mesmo número para todas dentro do mesmo lote, e o
   * índice único derrubaria a segunda em diante.
   */
  private async geradorDeMatricula(): Promise<() => string> {
    const emitidas = await this.prisma.colaborador.findMany({
      where: { matricula: { startsWith: 'FUNC-' } },
      select: { matricula: true },
    });
    let proximo = emitidas.reduce((max, { matricula }) => {
      const n = Number(/^FUNC-\d{4}-(\d+)$/.exec(matricula ?? '')?.[1]);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return () => gerarMatricula('FUNC', ++proximo);
  }
}

// ---------------------------------------------------------------------------

interface BaseColaboradores {
  porCpf: Map<string, { id: string; nome: string; cpf: string; matricula: string | null;
    status: StatusColaborador; tipoVinculo: TipoVinculo; email: string | null;
    telefone: string | null; dataAdmissao: Date | null; dataNascimento: Date | null }>;
  porMatricula: Map<string, { id: string; nome: string; cpf: string }>;
}

/** Comparação de texto sem acento e sem caixa — para casar nome de lista. */
function chave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Só PJ e terceirizado têm contratante — a mesma regra do cadastro pela tela. */
function temContratante(tipo: TipoVinculo): boolean {
  return tipo === TipoVinculo.PJ || tipo === TipoVinculo.TERCEIRIZADO;
}

function diaDe(d: Date | null): string | null {
  return d ? new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10) : null;
}

function mascarar(cpf: string): string {
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

function resumirFamilia(f: { dependentesCriados: number; dependentesRemovidos: number }): string {
  const partes: string[] = [];
  if (f.dependentesCriados) partes.push(`${f.dependentesCriados} dependente(s) incluído(s)`);
  if (f.dependentesRemovidos) partes.push(`${f.dependentesRemovidos} removido(s)`);
  return partes.length ? ` — ${partes.join(', ')}` : '';
}
