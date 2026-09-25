import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService, dataCalendario } from '@core/infra';
import {
  AcaoAuditoria,
  Prisma,
  StatusParcela,
  StatusRecadastramento,
  TipoHistoricoFiliado,
} from '@prisma/client';
import { CobrancasService } from '../cobrancas/cobrancas.service';
import { FiliadosService } from '../filiados/filiados.service';
import { camposDoLink, vinculosPeloLink } from '../recadastramento/dados-do-link';
import { CAMPOS_DO_CADASTRO_PELO_LINK } from '../recadastramento/dto/recadastro-publico.dto';
import { montarSincronizacaoDependentes } from '../dependentes/dependentes.sync';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CarteirinhasService } from '../carteirinhas/carteirinhas.module';
import { moduloAtivo } from '../../tenant/tenant.config';
import { ondeEstaAgora, traduzirMovimento } from './linguagem-do-processo.util';
import { diaDeCalendarioBR } from '../processos/utils/data-br.util';
import { AtualizarMeuCadastroDto } from './dto/portal-filiado.dto';
import {
  ROTULO_FORMACAO,
  ROTULO_SITUACAO_FILIADO,
} from '../carteirinhas/rotulos-do-cartao.util';

/**
 * O QUE O FILIADO VÊ DE SI MESMO.
 *
 * ESTE ARQUIVO É UM CORTE DE VISIBILIDADE, não um CRUD. Cada `select` aqui é
 * uma decisão sobre o que uma pessoa de fora do sindicato pode ler, de um
 * celular, num computador compartilhado. O que não está escrito não sai.
 *
 * AS TRÊS COISAS QUE NUNCA SAEM, e por quê:
 *
 * 1. **Dado de outra pessoa.** Um processo pode ter VÁRIOS filiados como parte
 *    (ação coletiva/plúrima — o schema documenta isso). Listar "as partes"
 *    mostraria o nome e o CPF de um filiado para outro. O portal fala do
 *    processo, nunca de quem mais está nele.
 * 2. **Nota interna.** `movimentacoesInternas` é a conversa da equipe sobre o
 *    caso — estratégia, avaliação de chance, o que se combinou. É o mesmo corte
 *    que o dossiê já faz no papel.
 * 3. **Vocabulário de trabalho.** Etiquetas, urgência e o motivo dela, fila,
 *    responsável interno: é como o sindicato ORGANIZA o serviço, e ler isso de
 *    fora só gera pergunta que a secretaria vai ter de responder.
 *
 * O que SAI do processo é o que já está nos autos: número, classe, assunto,
 * órgão julgador, distribuição e as movimentações do TRIBUNAL.
 */

/** Como cada status interno se chama para quem é parte, e não para a equipe. */
const SITUACAO_DO_PROCESSO: Record<string, string> = {
  PRE_PROCESSUAL: 'Em preparação',
  RASCUNHO: 'Em preparação',
  ATIVO: 'Em andamento',
  PENDENTE: 'Aguardando movimentação',
  SUSPENSO: 'Suspenso',
  ARQUIVADO: 'Arquivado',
  ENCERRADO: 'Encerrado',
  GANHO_EXECUCAO: 'Ganho — em execução',
  IMPROCEDENTE: 'Julgado improcedente',
};

/** Quantas movimentações do tribunal a ficha carrega. */
const MOVIMENTACOES_NA_FICHA = 30;

/**
 * O que serve de comprovante: foto do app do banco ou PDF.
 *
 * A lista é MENOR que a dos anexos (sem DOC/DOCX) porque comprovante de
 * pagamento não vem em Word — e cada formato aceito é um a mais para a
 * secretaria conseguir abrir do celular dela.
 */
const MIME_DO_COMPROVANTE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/** 10 MB: uma foto de celular passa longe disso, e um PDF de banco também. */
const COMPROVANTE_TAMANHO_MAX = 10 * 1024 * 1024;

/** O mesmo teto do link público de recadastramento. */
const FOTO_TAMANHO_MAX = 8 * 1024 * 1024;

@Injectable()
export class PortalFiliadoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly carteirinhas: CarteirinhasService,
    private readonly storage: StorageService,
    // O PIX é o MESMO que o carnê imprime: uma segunda implementação geraria
    // dois códigos para a mesma parcela, e o banco aceitaria os dois.
    private readonly cobrancasDaCasa: CobrancasService,
    // O mesmo processamento de foto que a equipe usa — recorte, miniatura e o
    // apagar da anterior. Duas implementações gerariam duas miniaturas.
    private readonly filiados: FiliadosService,
  ) {}

  // =========================================================================
  // Home
  // =========================================================================

  /**
   * O resumo da primeira tela.
   *
   * Números, não listas: a home diz o que existe e cada bloco leva para a aba.
   * Contar aqui é uma consulta barata e evita a tela que baixa tudo para
   * mostrar três totais.
   */
  async resumo(filiadoId: string) {
    const cobrancasLigadas = moduloAtivo('cobrancas');

    const [filiado, processos, emAberto, recadosNovos] = await Promise.all([
      this.prisma.filiado.findUnique({
        where: { id: filiadoId },
        select: {
          nomeCompleto: true,
          matricula: true,
          situacao: true,
          dataFiliacao: true,
          carteirinha: { select: { numero: true, validaAte: true } },
        },
      }),
      this.contarProcessos(filiadoId),
      cobrancasLigadas ? this.contarParcelasEmAberto(filiadoId) : Promise.resolve(null),
      this.contarRecadosNovos(filiadoId),
    ]);
    if (!filiado) throw new NotFoundException('Cadastro não encontrado.');

    return {
      nomeCompleto: filiado.nomeCompleto,
      matricula: filiado.matricula,
      situacao: filiado.situacao,
      situacaoRotulo: ROTULO_SITUACAO_FILIADO[filiado.situacao],
      // NULO quando a carga legada não trouxe a data — a tela mostra "—" em vez
      // de inventar um ano. Ver o comentário do campo no schema.
      dataFiliacao: filiado.dataFiliacao,
      carteirinha: filiado.carteirinha
        ? { numero: filiado.carteirinha.numero, validaAte: filiado.carteirinha.validaAte }
        : null,
      processos,
      /** `null` (e não zero) quando o cliente não tem o módulo: a aba nem existe. */
      cobrancas: emAberto,
      /*
        O RECADO NOVO É O ÚNICO AVISO DO PORTAL, e por isso sobe para a home:
        alguém escreveu para ESTA pessoa e está esperando. Tudo o mais na home é
        estado; isto é gente falando com gente.
      */
      recadosNovos,
    };
  }

  // =========================================================================
  // Carteirinha
  // =========================================================================

  async carteirinha(filiadoId: string) {
    /*
      A CARTEIRINHA NASCE AQUI SE PRECISAR, e é o que torna esta aba honesta.

      Antes ela dizia "ainda não foi emitida — peça na secretaria" para os 168
      ativos sem cartão. Hoje a emissão é automática ao pedir o documento, então
      mandar a pessoa pedir seria mandá-la esperar por um clique que ninguém
      precisa dar. Falha (não-ATIVO) cai no `catch` e a aba explica.
    */
    await this.carteirinhas.garantirCarteirinha(filiadoId).catch(() => null);

    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: {
        nomeCompleto: true,
        matricula: true,
        situacao: true,
        formacao: true,
        formacaoOutro: true,
        dataFiliacao: true,
        carteirinha: { select: { numero: true, emitidaEm: true, validaAte: true } },
      },
    });
    if (!filiado) throw new NotFoundException('Cadastro não encontrado.');

    return {
      emitida: !!filiado.carteirinha,
      numero: filiado.carteirinha?.numero ?? null,
      emitidaEm: filiado.carteirinha?.emitidaEm ?? null,
      validaAte: filiado.carteirinha?.validaAte ?? null,
      nomeCompleto: filiado.nomeCompleto,
      matricula: filiado.matricula,
      categoria: filiado.formacao ? ROTULO_FORMACAO[filiado.formacao] : null,
      categoriaOutro: filiado.formacaoOutro,
      dataFiliacao: filiado.dataFiliacao,
      situacaoRotulo: ROTULO_SITUACAO_FILIADO[filiado.situacao],
    };
  }

  /**
   * O PDF da carteirinha — o MESMO que a secretaria emite.
   *
   * Reaproveita `CarteirinhasService` de propósito: uma segunda implementação
   * seria um segundo cartão, que divergiria do primeiro na primeira mudança de
   * desenho. Ver a regra da prévia que recalcula.
   */
  async carteirinhaPdf(filiadoId: string) {
    return this.carteirinhas.gerarPdf(filiadoId);
  }

  // =========================================================================
  // Cadastro
  // =========================================================================

  async cadastro(filiadoId: string) {
    const f = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: {
        nomeCompleto: true,
        matricula: true,
        cpf: true,
        rg: true,
        ufRg: true,
        dataNascimento: true,
        situacao: true,
        dataFiliacao: true,
        formacao: true,
        formacaoOutro: true,
        numeroCoren: true,
        endereco: true,
        numero: true,
        complemento: true,
        bairro: true,
        cidade: true,
        estado: true,
        cep: true,
        telefonePrincipal: true,
        telefoneSecundario: true,
        email: true,
        sexo: true,
        estadoCivil: true,
        naturalidade: true,
        dataAdmissao: true,
        fotoKey: true,
        vinculos: {
          orderBy: { ordem: 'asc' },
          select: { empresa: true, cargo: true, matricula: true },
        },
        dependentes: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, nome: true, tipo: true, dataNascimento: true },
        },
      },
    });
    if (!f) throw new NotFoundException('Cadastro não encontrado.');

    /*
      A RESPOSTA DIZ O QUE PODE SER MUDADO, em vez de deixar a tela adivinhar.

      Sem isto, o formulário do portal e o DTO do servidor seriam duas listas
      escritas à mão que combinam hoje e divergem na primeira alteração — e a
      divergência apareceria como campo que a pessoa preenche e o servidor
      ignora em silêncio.
    */
    return {
      ...f,
      editaveis: CAMPOS_QUE_O_FILIADO_EDITA,
      /** A foto atual, se houver — o portal é onde ela finalmente vai existir. */
      fotoUrl: f.fotoKey ? await this.storage.getSignedUrl(f.fotoKey).catch(() => null) : null,
    };
  }

  /**
   * O filiado corrige os PRÓPRIOS dados, e vale na hora.
   *
   * "O que o filiado recadastrar e digitar é o dado válido, não precisa alguém
   * confirmar nada." — o dono, 24/09/2026. É como o link de recadastramento já
   * funciona: `tx.filiado.update` incondicional, sem fila de conferência.
   *
   * A auditoria é o que torna isso seguro de aceitar: toda alteração fica
   * registrada com autor, data e o que mudou, então a secretaria consegue
   * desfazer o que quer que tenha sido digitado errado.
   */
  async atualizarCadastro(filiadoId: string, dto: AtualizarMeuCadastroDto, ctx: Ctx) {
    const antes = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      include: { vinculos: true, dependentes: true },
    });
    if (!antes) throw new NotFoundException('Cadastro não encontrado.');

    /*
      OS MESMOS FILTROS DO LINK, e de propósito.

      `camposDoLink` é a defesa em profundidade que existe desde 14/09: o DTO já
      recusa o que não está na lista, mas se um dia a rota perder a tipagem pela
      CLASSE, o serviço ainda copia só o que está aqui — `situacao`, `matricula`
      e `cobrancas` não chegam ao Prisma nem se vierem no corpo.

      `vinculosPeloLink` preserva o que a EQUIPE registrou no vínculo
      (`descontoEmFolha`, a ligação com a organização, quadro e lotação): a
      lista enviada SUBSTITUI a gravada, e sem essa herança o filiado apagaria,
      sem saber, em qual folha o financeiro desconta.
    */
    const dados = camposDoLink(dto as unknown as Record<string, unknown>);
    const temVinculos = Array.isArray(dto.vinculos);
    const temDependentes = Array.isArray(dto.dependentes);
    if (!Object.keys(dados).length && !temVinculos && !temDependentes) {
      throw new BadRequestException('Nada para atualizar.');
    }

    const antesJson: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify({ ...antes, fotoKey: undefined, fotoThumbKey: undefined }),
    );

    const depois = await this.prisma.$transaction(async (tx) => {
      return tx.filiado.update({
        where: { id: filiadoId },
        data: {
          ...(dados as Prisma.FiliadoUpdateInput),
          dataNascimento: dataCalendario(dados.dataNascimento as string | undefined),
          dataAdmissao: dataCalendario(dados.dataAdmissao as string | undefined),
          vinculos: temVinculos
            ? {
                deleteMany: {},
                create: vinculosPeloLink(dto.vinculos ?? [], antes.vinculos),
              }
            : undefined,
          dependentes: temDependentes
            ? montarSincronizacaoDependentes(dto.dependentes, antes.dependentes)
            : undefined,
        },
        include: { vinculos: true, dependentes: true },
      });
    });

    /*
      ISTO É UM RECADASTRAMENTO, e entra no histórico como tal.

      "Aqui não era pra ser possível o filiado fazer um recadastramento?" — era.
      Gravar só o `filiado.update` deixaria a mudança invisível: a secretaria
      veria os dados novos sem saber de onde vieram nem o que havia antes. O
      registro guarda o de→para, igual ao do link, e é o que permite desfazer o
      que tiver sido digitado errado.
    */
    await this.prisma.recadastramento.create({
      data: {
        filiadoId,
        status: StatusRecadastramento.PENDENTE,
        dadosAnteriores: antesJson,
        dadosNovos: JSON.parse(JSON.stringify(dados)) as Prisma.InputJsonValue,
        observacao: 'Atualizado pelo próprio filiado no portal (login por CPF e senha).',
      },
    });
    await this.prisma.filiadoHistorico.create({
      data: {
        filiadoId,
        tipo: TipoHistoricoFiliado.RECADASTRAMENTO,
        descricao: 'Cadastro atualizado pelo próprio filiado no portal.',
        autor: `${antes.nomeCompleto} (portal)`,
      },
    });

    const mudou = Object.keys(dados).filter(
      (c) =>
        JSON.stringify((antes as Record<string, unknown>)[c]) !==
        JSON.stringify((depois as Record<string, unknown>)[c]),
    );

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: filiadoId,
      descricao:
        `Cadastro atualizado pelo PRÓPRIO filiado no portal: ${antes.nomeCompleto}` +
        (mudou.length ? ` (${mudou.join(', ')})` : ''),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { matricula: antes.matricula, campos: mudou },
    });

    return { ...(await this.cadastro(filiadoId)), alterados: mudou };
  }

  /**
   * A FOTO, tirada do próprio celular.
   *
   * MEDIDO: **1 de 5.810** filiados ativos tem foto. Nenhum esforço da
   * secretaria vai resolver isso — quem tem a câmera na mão é a pessoa, e o
   * portal é o primeiro lugar do sistema onde ela está logada com o celular.
   *
   * Reaproveita `FiliadosService.atualizarFoto`: é o mesmo processamento
   * (recorte, miniatura, storage) que a equipe usa, e o mesmo apagar da foto
   * antiga. Uma segunda implementação geraria duas miniaturas de tamanhos
   * diferentes para a mesma pessoa.
   */
  async atualizarMinhaFoto(filiadoId: string, arquivo: Express.Multer.File, ctx: Ctx) {
    if (!arquivo) throw new BadRequestException('Envie a foto.');
    if (!/^image\/(jpe?g|png|webp)$/i.test(arquivo.mimetype)) {
      throw new BadRequestException('Envie uma foto JPG, PNG ou WEBP.');
    }
    if (arquivo.size > FOTO_TAMANHO_MAX) {
      throw new BadRequestException('A foto passa de 8 MB. Tire outra com menos resolução.');
    }

    const f = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: { nomeCompleto: true, matricula: true },
    });
    if (!f) throw new NotFoundException('Cadastro não encontrado.');

    await this.filiados.atualizarFoto(filiadoId, arquivo.buffer, `${f.nomeCompleto} (portal)`);

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: filiadoId,
      descricao: `Foto enviada pelo PRÓPRIO filiado no portal: ${f.nomeCompleto}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { matricula: f.matricula },
    });

    const atual = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: { fotoKey: true },
    });
    return {
      fotoUrl: atual?.fotoKey
        ? await this.storage.getSignedUrl(atual.fotoKey).catch(() => null)
        : null,
    };
  }

  // =========================================================================
  // Processos
  // =========================================================================

  /**
   * Os processos em que a pessoa é parte.
   *
   * O `OR` cobre as duas formas de vínculo que o sistema tem: o atalho
   * `filiadoId` (parte principal) e o N:N de `partes_processo` (ação coletiva).
   * Ler só o atalho esconderia justamente as coletivas, que são onde mais gente
   * está.
   */
  private vinculoDoFiliado(filiadoId: string): Prisma.ProcessoWhereInput {
    return { OR: [{ filiadoId }, { partes: { some: { filiadoId } } }] };
  }

  /** Quantos recados do sindicato esta pessoa ainda não abriu. */
  private contarRecadosNovos(filiadoId: string) {
    return this.prisma.recadoDoProcesso.count({
      where: { vistoEm: null, processo: this.vinculoDoFiliado(filiadoId) },
    });
  }

  private async contarProcessos(filiadoId: string) {
    const [total, emAndamento] = await Promise.all([
      this.prisma.processo.count({ where: this.vinculoDoFiliado(filiadoId) }),
      this.prisma.processo.count({
        where: {
          AND: [
            this.vinculoDoFiliado(filiadoId),
            { statusInterno: { in: ['ATIVO', 'PENDENTE', 'GANHO_EXECUCAO'] } },
          ],
        },
      }),
    ]);
    return { total, emAndamento };
  }

  async processos(filiadoId: string) {
    const lista = await this.prisma.processo.findMany({
      where: this.vinculoDoFiliado(filiadoId),
      orderBy: [{ ultimoMovimentoEm: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        numeroCNJ: true,
        titulo: true,
        classeProcessual: true,
        assuntoPrincipal: true,
        orgaoJulgador: true,
        tribunal: true,
        dataDistribuicao: true,
        statusInterno: true,
        ultimoMovimentoEm: true,
        segredoJustica: true,
        _count: { select: { recados: { where: { vistoEm: null } } } },
      },
    });
    return lista.map(({ _count, ...p }) => ({
      ...this.apresentarProcesso(p),
      recadosNovos: _count.recados,
    }));
  }

  async processo(filiadoId: string, processoId: string) {
    const p = await this.prisma.processo.findFirst({
      // O `AND` com o vínculo é o que impede trocar o id na URL e ler o
      // processo de outra pessoa. Sem ele o portal seria uma janela aberta.
      where: { AND: [{ id: processoId }, this.vinculoDoFiliado(filiadoId)] },
      select: {
        id: true,
        numeroCNJ: true,
        titulo: true,
        classeProcessual: true,
        assuntoPrincipal: true,
        orgaoJulgador: true,
        tribunal: true,
        dataDistribuicao: true,
        statusInterno: true,
        ultimoMovimentoEm: true,
        segredoJustica: true,
        valorCausa: true,
        grau: true,
        advogado: { select: { nome: true } },
        movimentacoes: {
          orderBy: { dataMovimento: 'desc' },
          take: MOVIMENTACOES_NA_FICHA,
          // `conteudo` e `complementos` ficam de fora: é o TEOR do ato, que
          // costuma nomear as outras partes e os advogados delas.
          select: {
            id: true,
            dataMovimento: true,
            descricao: true,
            orgaoJulgador: true,
            codigoMovimento: true,
          },
        },
        recados: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, texto: true, autorNome: true, createdAt: true, vistoEm: true },
        },
      },
    });
    if (!p) throw new NotFoundException('Processo não encontrado.');

    /*
      MARCA COMO VISTO AO ABRIR, e não num botão.

      Um "marcar como lido" obrigaria a pessoa a fazer a contabilidade do
      advogado. O carimbo é dado por MOSTRAR — a mesma régua dos avisos da
      equipe. Falhar aqui não pode derrubar a ficha: o recado continua na tela.
    */
    const naoVistos = p.recados.filter((r) => !r.vistoEm).map((r) => r.id);
    if (naoVistos.length) {
      await this.prisma.recadoDoProcesso
        .updateMany({ where: { id: { in: naoVistos } }, data: { vistoEm: new Date() } })
        .catch(() => null);
    }

    const { advogado, movimentacoes, recados, valorCausa, grau, ...resto } = p;
    return {
      ...this.apresentarProcesso(resto),
      valorCausa: valorCausa ? Number(valorCausa) : null,
      grau,
      /** O advogado do sindicato que responde pelo caso — quem a pessoa procura. */
      advogadoResponsavel: advogado?.nome ?? null,
      /*
        ONDE ESTÁ AGORA, numa frase. É a primeira coisa que alguém quer saber, e
        a linha do tempo não responde: ela conta a história de trás para a
        frente e exige ler três itens para montar o presente.
      */
      agora: ondeEstaAgora(movimentacoes),
      recados: recados.map((r) => ({ ...r, novo: !r.vistoEm })),
      /*
        A TRADUÇÃO É DO SERVIDOR. Fazer no navegador significaria manter o
        dicionário da TPU em dois lugares — e o dia em que os dois divergissem,
        o advogado e o filiado leriam nomes diferentes para o mesmo ato.
      */
      movimentacoes: movimentacoes.map((m) => ({
        id: m.id,
        dataMovimento: m.dataMovimento,
        orgaoJulgador: m.orgaoJulgador,
        ...traduzirMovimento(m.codigoMovimento, m.descricao),
      })),
      totalDeMovimentacoes: movimentacoes.length,
    };
  }

  private apresentarProcesso(p: {
    id: string;
    numeroCNJ: string | null;
    titulo: string | null;
    classeProcessual: string | null;
    assuntoPrincipal: string | null;
    orgaoJulgador: string | null;
    tribunal: string | null;
    dataDistribuicao: Date | null;
    statusInterno: string;
    ultimoMovimentoEm: Date | null;
    segredoJustica: boolean;
  }) {
    return {
      ...p,
      situacao: SITUACAO_DO_PROCESSO[p.statusInterno] ?? p.statusInterno,
      /*
        SEM NÚMERO, A FASE EXPLICA. `numeroCNJ` é nulo justamente na fase
        pré-processual, e uma ficha em branco pareceria erro de carregamento
        para quem não sabe que existe caso antes da ação.
      */
      identificacao: p.numeroCNJ ?? 'Ainda sem número — caso em preparação',
    };
  }

  // =========================================================================
  // Cobranças
  // =========================================================================

  /** O cliente tem o módulo? O SINDSERM não tem: lá a contribuição é em folha. */
  private exigirModuloDeCobrancas() {
    if (!moduloAtivo('cobrancas')) {
      throw new ForbiddenException('Esta instalação não trabalha com cobrança pelo sistema.');
    }
  }

  private async contarParcelasEmAberto(filiadoId: string) {
    const abertas = await this.prisma.parcelaCobranca.findMany({
      where: { cobranca: { filiadoId }, status: { not: StatusParcela.PAGO } },
      select: { valor: true, dataVencimento: true },
    });
    /*
      VENCIDA SE COMPARA POR DIA, NUNCA COM `new Date()`.

      `dataVencimento` é coluna `@db.Date`: chega como meia-noite UTC. Comparar
      com o instante de agora marcaria como vencida a parcela que vence HOJE, a
      partir da primeira hora do dia. `diaDeCalendarioBR()` devolve o dia de
      Teresina na mesma forma, e aí os dois lados falam a mesma língua.
    */
    const hoje = diaDeCalendarioBR();
    return {
      emAberto: abertas.length,
      vencidas: abertas.filter((p) => p.dataVencimento < hoje).length,
      total: abertas.reduce((s, p) => s + Number(p.valor), 0),
    };
  }

  async cobrancas(filiadoId: string) {
    this.exigirModuloDeCobrancas();
    const cobrancas = await this.prisma.cobranca.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tipo: true,
        descricao: true,
        valorTotal: true,
        createdAt: true,
        parcelas: {
          orderBy: { numero: 'asc' },
          select: {
            id: true,
            numero: true,
            // `@db.Date`: são DIAS de calendário, não instantes. Vão cruas para
            // a tela, que tem `formatDataPura` — formatar aqui no fuso do
            // servidor anda um dia para trás.
            dataCompetencia: true,
            dataVencimento: true,
            valor: true,
            status: true,
            dataPagamento: true,
            comprovanteNome: true,
            comprovanteEnviadoEm: true,
          },
        },
      },
    });

    return cobrancas.map((c) => ({
      ...c,
      valorTotal: Number(c.valorTotal),
      parcelas: c.parcelas.map(({ comprovanteNome, comprovanteEnviadoEm, ...p }) => ({
        ...p,
        valor: Number(p.valor),
        /*
          O ESTADO "MANDEI O COMPROVANTE" É DERIVADO, e não um status novo no
          enum — ver o comentário da migração: um valor de enum desconhecido
          derruba o Prisma do contêiner antigo na janela de troca do deploy.
        */
        comprovante: comprovanteEnviadoEm
          ? { nome: comprovanteNome, enviadoEm: comprovanteEnviadoEm }
          : null,
      })),
    }));
  }

  /**
   * O PIX DE UMA PARCELA — o mesmo que o carnê imprime.
   *
   * Sob demanda, e não junto da lista: o QR é um data URL de alguns KB, e um
   * carnê de doze parcelas faria a primeira tela do celular baixar meio mega de
   * imagem que ninguém pediu.
   */
  async pixDaParcela(filiadoId: string, parcelaId: string) {
    this.exigirModuloDeCobrancas();
    await this.minhaParcela(filiadoId, parcelaId);
    return this.cobrancasDaCasa.gerarPixParcela(parcelaId);
  }

  /**
   * O COMPROVANTE QUE O PRÓPRIO FILIADO ENVIA.
   *
   * "o filiado pode consultar débitos em aberto… e pagar, além de anexar
   * comprovante" — o dono, 25/09/2026.
   *
   * O ENVIO NÃO DÁ BAIXA, e não deve dar: quem confirma que o dinheiro entrou é
   * a secretaria, olhando o extrato. O que muda aqui é que ela passa a ter o
   * comprovante ANTES de procurar — e o filiado para de mandar foto por
   * WhatsApp para um número que ninguém lê no fim de semana.
   */
  async enviarComprovante(
    filiadoId: string,
    parcelaId: string,
    arquivo: Express.Multer.File,
    ctx: Ctx,
  ) {
    this.exigirModuloDeCobrancas();
    if (!arquivo) throw new BadRequestException('Envie o arquivo do comprovante.');

    const ext = MIME_DO_COMPROVANTE[arquivo.mimetype];
    if (!ext) {
      throw new BadRequestException('Envie uma foto (JPG ou PNG) ou um PDF.');
    }
    if (arquivo.size > COMPROVANTE_TAMANHO_MAX) {
      throw new BadRequestException('O arquivo passa de 10 MB. Tire uma foto menor ou envie o PDF.');
    }

    const parcela = await this.minhaParcela(filiadoId, parcelaId);
    if (parcela.status === StatusParcela.PAGO) {
      throw new BadRequestException('Esta parcela já consta como paga — não precisa de comprovante.');
    }

    // Chave opaca (LGPD): o caminho no storage nunca leva o nome original.
    const storageKey = `cobrancas/${parcela.cobrancaId}/comprovantes/${randomUUID()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);

    const nome = (arquivo.originalname || `comprovante.${ext}`)
      .replace(/[^\w.\- ]+/g, '')
      .slice(0, 120);

    const atualizada = await this.prisma.parcelaCobranca.update({
      where: { id: parcelaId },
      data: { comprovanteKey: storageKey, comprovanteNome: nome, comprovanteEnviadoEm: new Date() },
      select: { comprovanteNome: true, comprovanteEnviadoEm: true },
    });

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ParcelaCobranca',
      entidadeId: parcelaId,
      descricao: `Comprovante de pagamento enviado pelo filiado no portal (parcela ${parcela.numero}).`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cobrancaId: parcela.cobrancaId, arquivo: nome },
    });

    return { nome: atualizada.comprovanteNome, enviadoEm: atualizada.comprovanteEnviadoEm };
  }

  /**
   * A parcela É DESTA PESSOA — ou não existe para ela.
   *
   * O id vem da URL, então esta é a única coisa entre o portal e a conta de
   * outro filiado. 404 e não 403: quem tenta não descobre nem que a parcela
   * existe.
   */
  private async minhaParcela(filiadoId: string, parcelaId: string) {
    const parcela = await this.prisma.parcelaCobranca.findFirst({
      where: { id: parcelaId, cobranca: { filiadoId } },
      select: { id: true, numero: true, status: true, cobrancaId: true },
    });
    if (!parcela) throw new NotFoundException('Parcela não encontrada.');
    return parcela;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private somenteOsEditaveis(dto: AtualizarMeuCadastroDto): Record<string, string | null> {
    const dados: Record<string, string | null> = {};
    for (const campo of CAMPOS_QUE_O_FILIADO_EDITA) {
      const valor = (dto as Record<string, unknown>)[campo];
      if (valor === undefined) continue;
      const texto = typeof valor === 'string' ? valor.trim() : '';
      /*
        APAGAR É UMA ESCOLHA VÁLIDA: quem trocou de telefone e não tem o novo
        prefere o campo vazio a um número que não atende mais. String vazia vira
        NULO para o banco não guardar '' e '  ' como valores diferentes de vazio
        — é o que fez a contagem de "sem CPF" divergir entre duas telas.
      */
      dados[campo] = texto === '' ? null : texto;
    }
    return dados;
  }
}

interface Ctx {
  ip?: string;
  userAgent?: string;
}

/**
 * OS CAMPOS QUE O FILIADO MUDA SOZINHO — os MESMOS do link, por construção.
 *
 * Era uma lista própria de dez campos (endereço e contato) enquanto o link
 * mandado por WhatsApp deixava atualizar o cadastro inteiro. Duas portas para a
 * mesma pessoa, com regras diferentes, e a mais completa era a que exigia
 * alguém lembrar de enviar.
 *
 * Reexportado daqui porque é isto que a tela lê para montar o formulário: uma
 * segunda lista no navegador viraria campo que a pessoa preenche e o servidor
 * ignora em silêncio.
 */
export const CAMPOS_QUE_O_FILIADO_EDITA = CAMPOS_DO_CADASTRO_PELO_LINK;
