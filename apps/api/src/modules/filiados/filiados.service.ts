import {
  ImageService,
  QrCodeService,
  StorageService,
  dataCalendario,
  gerarMatricula,
  mascararCpf,
  proximoSequencial,
  normalizarBusca,
  termosDeBusca,
} from '@core/infra';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AcaoAuditoria,
  MotivoDesfiliacao,
  Prisma,
  SituacaoFiliado,
  StatusAtendimento,
  StatusCompromisso,
  StatusParcela,
  StatusProcesso,
  TipoDocumento,
  TipoHistoricoFiliado,
  TipoPessoa,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

import { lerLogoDaMarca } from '../../common/assets.util';

import {
  calcularIdade,
  dependenteValidoParaEvento,
} from '../dependentes/dependentes.module';
import {
  montarCriacaoDependentes, montarSincronizacaoDependentes,
} from '../dependentes/dependentes.sync';
import { protegerImutaveis } from './campos-imutaveis';
import {
  ChangeSituacaoDto,
  CreateFiliadoDto,
  DesfiliarDto,
  ListFiliadosQueryDto,
  UpdateFiliadoDto,
} from './dto/filiado.dto';
import { tenant, enderecoEmLinha, contaEmLinha, rodapeInstitucional } from '../../tenant/tenant.config';

/**
 * Formatos aceitos — e a EXTENSÃO que cada um recebe ao ser gravado.
 *
 * O MAPA PASSOU A APONTAR PARA A EXTENSÃO, e não mais para `true`, porque era
 * dela que vinha o furo: o MIME era conferido aqui, mas a extensão gravada saía
 * de `arquivo.originalname` — escolhida por quem envia. Como o `/uploads` é
 * servido por `express.static`, quem manda no `Content-Type` da resposta é a
 * EXTENSÃO do arquivo em disco, não o MIME que validamos.
 *
 * A consequência era concreta: bastava enviar um PDF de verdade (MIME válido)
 * com o nome `laudo.svg`. O arquivo era aceito, gravado como `.svg` e servido
 * como `image/svg+xml` — e SVG executa script. Como o domínio é o da API, o
 * script rodaria na origem que serve TODOS os documentos pessoais.
 *
 * Derivando a extensão do MIME já validado, o nome enviado deixa de influenciar
 * qualquer coisa. É o mesmo desenho que `AnexosService` já usava.
 */
const MIME_PERMITIDOS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const VERDE_ESCURO = '#1B7F0A';
const VERDE_MEDIO = '#4FA11B';

/** Rótulos dos motivos de desfiliação — usados no PDF, no histórico e no log. */
export const MOTIVO_DESFILIACAO_LABEL: Record<MotivoDesfiliacao, string> = {
  APOSENTADORIA: 'Aposentadoria / Saída da Categoria',
  MUDANCA_ESTADO: 'Mudança de Estado / Transferência',
  MUDANCA_PROFISSAO: 'Mudança de Profissão',
  SOLICITACAO_PESSOAL: 'Solicitação Pessoal',
  INADIMPLENCIA: 'Inadimplência',
  OUTROS: 'Outros',
};

/**
 * A PRAÇA DA ASSINATURA — de onde o documento é datado.
 *
 * Estava escrita "Teresina/PI" no corpo de DOIS geradores de PDF. Hoje acerta,
 * porque os dois clientes ficam em Teresina; no dia em que um terceiro entrar,
 * o sistema passa a emitir documento oficial datado da cidade errada — e nada
 * quebra, então ninguém descobre. O endereço já está no `tenant.config`; era só
 * ler de lá.
 */
export function pracaDaAssinatura(): string {
  const cidade = tenant.endereco?.cidade?.trim();
  const uf = tenant.endereco?.uf?.trim();
  if (!cidade) return '';
  // Nome vem em CAIXA ALTA na configuração; num documento formal isso grita.
  const bonito = cidade.charAt(0).toUpperCase() + cidade.slice(1).toLowerCase();
  return uf ? `${bonito}/${uf.toUpperCase()}` : bonito;
}

/** Prefixo da matrícula sindical — `SEN-AAAA-NNNNNN`. */
const PREFIXO_MATRICULA = 'SEN';

/**
 * Quantas vezes recalcular a matrícula quando duas filiações simultâneas
 * disputam o mesmo número. Três cobre a corrida real; passando disso o problema
 * é outro e precisa aparecer.
 */
const TENTATIVAS_MATRICULA = 3;

/** A violação de unicidade é da MATRÍCULA (e não do CPF, que já foi checado)? */
function ehColisaoDeMatricula(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    ((e.meta?.target as string[] | undefined) ?? []).some((c) => c.includes('matricula'))
  );
}

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** 'AAAA-MM' → 'agosto/2026'. Devolve o próprio valor se vier fora do padrão. */
export function formatarMesCorte(valor: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!m) return valor;
  const mes = Number(m[2]);
  return mes >= 1 && mes <= 12 ? `${MESES_PT[mes - 1]}/${m[1]}` : valor;
}

@Injectable()
export class FiliadosService {
  private readonly logger = new Logger(FiliadosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly image: ImageService,
    private readonly storage: StorageService,
    private readonly qr: QrCodeService,
    private readonly audit: AuditService,
  ) {}

  async registrarHistorico(
    filiadoId: string,
    tipo: TipoHistoricoFiliado,
    descricao: string,
    autor?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await this.prisma.filiadoHistorico.create({
      data: { filiadoId, tipo, descricao, autor, metadata },
    });
  }

  async create(dto: CreateFiliadoDto, autor?: string) {
    const cpf = dto.cpf.replace(/\D/g, '');
    if (await this.prisma.filiado.findUnique({ where: { cpf } }))
      throw new BadRequestException('Já existe filiado com este CPF');

    const { vinculos, dependentes, ...dados } = dto;

    const filiado = await this.comMatriculaLivre((matricula) =>
      this.prisma.filiado.create({
        data: {
          ...dados,
          cpf,
          dataNascimento: dataCalendario(dto.dataNascimento),
          dataAdmissao: dataCalendario(dto.dataAdmissao),
          vinculoFuncional: dto.vinculoFuncional,
          // Filiação registrada AGORA. Campo próprio para o gráfico de crescimento
          // não depender de `createdAt`, que a importação legada sobrescrevia.
          dataFiliacao: new Date(),
          matricula,
          qrToken: this.qr.gerarToken(),
          vinculos: vinculos
            ? { create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })) }
            : undefined,
          // Dependentes já na filiação: sem dependente prévio, só há criação.
          dependentes: montarCriacaoDependentes(dependentes),
        },
        include: { vinculos: true, dependentes: true },
      }),
    );

    await this.registrarHistorico(
      filiado.id,
      TipoHistoricoFiliado.FILIACAO,
      'Filiação registrada.',
      autor,
    );
    return filiado;
  }

  /**
   * A PRÓXIMA MATRÍCULA SINDICAL — a partir da maior já emitida.
   *
   * ERA `count() + 1`, E ISSO DERRUBOU O CADASTRO EM PRODUÇÃO (14/08/2026).
   * Contar só acerta enquanto ninguém for excluído. Na primeira exclusão o
   * contador anda para trás e devolve uma matrícula que já existe; o índice
   * único recusa e — como nada é inserido — a contagem nunca mais muda. Não é
   * um cadastro que falha: é o cadastro inteiro parado, com
   * `Unique constraint failed on the fields: (matricula)` em toda tentativa,
   * até alguém mexer no banco.
   *
   * Só as matrículas no padrão `SEN-AAAA-NNNNNN` entram na conta. As da carga
   * legada têm outro formato e não devem empurrar o contador.
   */
  private async proximaMatricula(): Promise<string> {
    const emitidas = await this.prisma.filiado.findMany({
      where: { matricula: { startsWith: `${PREFIXO_MATRICULA}-` } },
      select: { matricula: true },
    });
    return gerarMatricula(
      PREFIXO_MATRICULA,
      proximoSequencial(PREFIXO_MATRICULA, emitidas.map((f) => f.matricula)),
    );
  }

  /**
   * Executa a criação com uma matrícula livre, reagindo à CORRIDA.
   *
   * Duas filiações simultâneas leem a mesma "maior emitida" e disputam o mesmo
   * número — o índice único recusa a segunda. Isso é raro e é legítimo; o que
   * não pode é virar erro na cara da secretaria, que foi como este defeito se
   * apresentou. Aqui a segunda simplesmente recalcula e tenta de novo.
   *
   * O limite de tentativas existe para que um defeito DIFERENTE que também
   * viole `matricula` não vire laço infinito — passando disso, o erro sobe
   * traduzido, e não como 500 cru.
   */
  private async comMatriculaLivre<T>(criar: (matricula: string) => Promise<T>): Promise<T> {
    for (let tentativa = 1; tentativa <= TENTATIVAS_MATRICULA; tentativa++) {
      const matricula = await this.proximaMatricula();
      try {
        return await criar(matricula);
      } catch (e) {
        if (!ehColisaoDeMatricula(e) || tentativa === TENTATIVAS_MATRICULA) {
          throw this.traduzir(e);
        }
        this.logger.warn(
          `Matrícula ${matricula} foi tomada por outra filiação simultânea; ` +
            `tentativa ${tentativa + 1} de ${TENTATIVAS_MATRICULA}.`,
        );
      }
    }
    // Inalcançável: o laço acima ou retorna ou lança.
    throw new ConflictException('Não foi possível gerar a matrícula.');
  }

  /**
   * Erro do Prisma → erro com mensagem.
   *
   * O `create` não traduzia nada, e por isso a falha de unicidade chegou à tela
   * como "Internal server error" — sem dizer que campo, sem dizer o que fazer.
   * Um 500 mudo custou um dia de cadastro parado antes de alguém abrir o log.
   */
  private traduzir(e: unknown): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const alvo = (e.meta?.target as string[] | undefined)?.join(', ') ?? 'um campo único';
      if (alvo.includes('cpf')) return new BadRequestException('Já existe filiado com este CPF.');
      if (alvo.includes('matricula'))
        return new ConflictException(
          'A matrícula gerada já está em uso. Tente cadastrar novamente; ' +
            'se persistir, avise o suporte (numeração de matrícula fora de sincronia).',
        );
      return new ConflictException(`Já existe um registro com este valor em: ${alvo}.`);
    }
    return e as Error;
  }

  /**
   * Ordenação da listagem — sempre com DESEMPATE por `id`.
   *
   * O desempate não é detalhe: 4.730 dos 7.180 filiados compartilham o
   * `created_at` com pelo menos um outro (a carga legada gravou a data da
   * planilha à meia-noite, e o maior empate tem 155 pessoas no mesmo
   * instante). `ORDER BY created_at DESC` sozinho deixa esses 4.730 em ordem
   * NÃO ESPECIFICADA — e o Postgres é livre para devolvê-los diferente a cada
   * consulta, inclusive entre dois OFFSETs da mesma paginação.
   *
   * O sintoma visível era "a lista aparece embaralhada". O sintoma invisível,
   * e pior, era a paginação furada: a mesma pessoa podia sair na página 2 e de
   * novo na 5, enquanto outra não saía em nenhuma. `id` é único, então basta
   * ele como último critério para a ordem virar total e estável.
   *
   * `filiacao_*` usa nulls:'last' de propósito — em DESC o Postgres traria os
   * NULOS primeiro, e a lista abriria com os 1.895 sem data conhecida.
   */
  private ordenacao(
    ordenar: ListFiliadosQueryDto['ordenar'],
  ): Prisma.FiliadoOrderByWithRelationInput[] {
    switch (ordenar) {
      case 'antigos':
        return [{ createdAt: 'asc' }, { id: 'asc' }];
      case 'nome':
        return [{ nomeCompleto: 'asc' }, { id: 'asc' }];
      case 'nome_desc':
        return [{ nomeCompleto: 'desc' }, { id: 'desc' }];
      case 'filiacao_recente':
        return [{ dataFiliacao: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
      case 'filiacao_antiga':
        return [{ dataFiliacao: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
      case 'recentes':
      default:
        // Padrão: último cadastrado primeiro.
        return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }

  async findAll(query: ListFiliadosQueryDto) {
    // Limites sãos, no mesmo padrão de ProcessosService.listar. `pageSize` não
    // tinha teto: `?pageSize=999999` devolvia os 7 mil filiados numa resposta
    // só — e, pior, o mapeamento abaixo gera uma URL assinada de foto POR
    // registro, então o custo não era só o JSON gigante, eram milhares de
    // chamadas ao storage numa requisição. Descoberto ao paginar de 1.000 em
    // 1.000 durante o teste desta mudança, e a API aceitou sem piscar.
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(query.pageSize) || 20));

    // BUSCA LIVRE — cada palavra digitada é exigida separadamente, sobre a
    // coluna já normalizada (minúscula, sem acento, pontuação virada espaço).
    //
    // Antes era um único ILIKE '%termo%' sobre o nome. Caixa e trecho parcial
    // funcionavam, mas duas coisas não:
    //   - acento: "ana celia" e "ana célia" devolviam conjuntos DIFERENTES
    //     (6 e 16), porque a base tem as duas grafias da mesma pessoa;
    //   - ordem: "mirela jesus" devolvia ZERO, mesmo existindo MIRELA
    //     CARVALHO DE JESUS, porque procurava a sequência literal.
    // Exigir cada palavra em separado resolve os dois de uma vez.
    const termos = termosDeBusca(query.busca);
    const termosNome = termosDeBusca(query.nome);

    const where: Prisma.FiliadoWhereInput = {
      situacao: query.situacao,
      cpf: query.cpf ? { startsWith: query.cpf.replace(/\D/g, '') } : undefined,
      numeroCoren: query.coren ? { contains: query.coren, mode: 'insensitive' } : undefined,
      // Cidade também ignora acento: "sao raimundo" encontra "São Raimundo".
      cidadeNormalizada: query.cidade
        ? { contains: normalizarBusca(query.cidade) }
        : undefined,
      AND: [
        ...termos.map((t) => ({ buscaNormalizada: { contains: t } })),
        ...termosNome.map((t) => ({ buscaNormalizada: { contains: t } })),
      ],
      // Intervalo por DATA DE FILIAÇÃO — o campo que carrega esse significado.
      // Antes filtrava `createdAt`, que é carimbo de quando a linha entrou no
      // banco: para os 5.285 vindos da planilha os dois coincidiam por acaso,
      // mas para quem foi cadastrado pelo sistema o filtro "filiados de 2021"
      // devolvia a data da digitação. Quem não tem data de filiação conhecida
      // fica fora do intervalo — é a resposta honesta, não dá para afirmar que
      // alguém se filiou num período que ninguém registrou.
      dataFiliacao:
        query.dataInicio || query.dataFim
          ? {
              gte: query.dataInicio ? new Date(query.dataInicio) : undefined,
              lte: query.dataFim ? new Date(query.dataFim + 'T23:59:59') : undefined,
            }
          : undefined,
    };

    const [registros, total] = await this.prisma.$transaction([
      this.prisma.filiado.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: this.ordenacao(query.ordenar),
        include: { _count: { select: { dependentes: true } } },
      }),
      this.prisma.filiado.count({ where }),
    ]);

    const data = await Promise.all(
      registros.map(async (f) => ({
        ...f,
        fotoUrl: f.fotoThumbKey
          ? await this.storage.getSignedUrl(f.fotoThumbKey).catch(() => null)
          : null,
      })),
    );

    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  /**
   * Autocomplete do cadastro legado de Filiados para telas administrativas —
   * ex.: alocação manual da Colônia. Busca por nome (contém) ou CPF (prefixo, só
   * dígitos). Retorna o PERFIL COMPLETO (para preencher a reserva sem redigitação):
   * nome, CPF, COREN, formação, e-mail, telefone, cidade, estado e vínculos/locais
   * de trabalho. Máx. 10 resultados.
   */
  async buscarParaAutocomplete(q: string) {
    const termo = (q ?? '').trim();
    if (termo.length < 2) return [];
    // Mesma normalização da listagem: quem digita "jose" precisa encontrar
    // "JOSÉ", e "maria silva" precisa encontrar "MARIA DA SILVA". Este
    // autocomplete alimenta a alocação da Colônia, onde errar a pessoa custa
    // mais caro do que na lista — é a última tela que deveria ser exigente
    // com acento.
    const termos = termosDeBusca(termo);
    if (termos.length === 0) return [];

    // Mapeia a formação do cadastro legado para o enum da Colônia (ENF/TEC/AUX).
    const MAP_FORMACAO: Record<string, 'ENFERMEIRO' | 'TECNICO' | 'AUXILIAR' | null> = {
      ENFERMEIRO: 'ENFERMEIRO',
      TECNICO_ENFERMAGEM: 'TECNICO',
      AUXILIAR_ENFERMAGEM: 'AUXILIAR',
      OUTRO: null,
    };

    const filiados = await this.prisma.filiado.findMany({
      where: { AND: termos.map((t) => ({ buscaNormalizada: { contains: t } })) },
      select: {
        id: true,
        nomeCompleto: true,
        cpf: true,
        numeroCoren: true,
        formacao: true,
        email: true,
        telefonePrincipal: true,
        telefoneSecundario: true,
        cidade: true,
        estado: true,
        vinculos: {
          select: { empresa: true, cargo: true, ordem: true },
          orderBy: { ordem: 'asc' },
        },
      },
      orderBy: { nomeCompleto: 'asc' },
      take: 10,
    });

    return filiados.map((f) => ({
      id: f.id,
      nome: f.nomeCompleto,
      cpf: f.cpf,
      cpfMascarado: mascararCpf(f.cpf),
      coren: f.numeroCoren,
      // Só os dígitos do COREN (o sufixo -ENF/-TE/-AE é derivado da formação no front).
      corenNumero: f.numeroCoren ? f.numeroCoren.replace(/\D/g, '').slice(0, 6) || null : null,
      formacao: f.formacao ? MAP_FORMACAO[f.formacao] ?? null : null,
      email: f.email,
      // Puxa o telefone principal; se estiver vazio/nulo, cai para o secundário
      // (evita "telefone não preenchido" na alocação quando só há o secundário).
      telefone: f.telefonePrincipal || f.telefoneSecundario || null,
      cidade: f.cidade,
      estado: f.estado,
      // Locais de trabalho a partir dos vínculos (ordenados).
      localTrabalho1: f.vinculos[0]?.empresa ?? null,
      localTrabalho2: f.vinculos[1]?.empresa ?? null,
      vinculos: f.vinculos.map((v) => ({ empresa: v.empresa, cargo: v.cargo })),
    }));
  }

  async findOne(id: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id },
      include: { vinculos: { orderBy: { ordem: 'asc' } }, dependentes: true, carteirinha: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');
    return filiado;
  }

  /** Perfil completo com tudo que a tela de perfil precisa. */
  async perfil(id: string) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        dependentes: { orderBy: { createdAt: 'asc' } },
        carteirinha: true,
        documentos: { orderBy: { createdAt: 'desc' } },
        historico: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado');

    const fotoUrl = filiado.fotoKey
      ? await this.storage.getSignedUrl(filiado.fotoKey).catch(() => null)
      : null;

    const dependentes = await Promise.all(
      filiado.dependentes.map(async (d) => ({
        ...d,
        idade: calcularIdade(d.dataNascimento),
        validoParaEvento: dependenteValidoParaEvento(d.tipo, d.dataNascimento),
        fotoUrl: d.fotoThumbKey
          ? await this.storage.getSignedUrl(d.fotoThumbKey).catch(() => null)
          : null,
      })),
    );

    const todosDocs = await Promise.all(
      filiado.documentos.map(async (d) => ({
        ...d,
        url: await this.storage.getSignedUrl(d.storageKey).catch(() => null),
      })),
    );
    const documentos = todosDocs.filter((d) => d.tipo !== TipoDocumento.TERMO_CONSENTIMENTO);
    const termos = todosDocs.filter((d) => d.tipo === TipoDocumento.TERMO_CONSENTIMENTO);

    return { ...filiado, fotoUrl, dependentes, documentos, termos };
  }

  /**
   * ATUALIZAÇÃO CADASTRAL — usada no atendimento e no autoatendimento.
   *
   * Difere de `update` num ponto: CPF, RG, nascimento e naturalidade já
   * preenchidos são protegidos. Corrigir esses dados é ato deliberado da
   * equipe, feito na tela de Editar (que chama `update` e não passa por aqui).
   */
  async atualizacaoCadastral(id: string, dto: UpdateFiliadoDto, autor?: string) {
    const atual = await this.prisma.filiado.findUnique({
      where: { id },
      select: { cpf: true, rg: true, ufRg: true, dataNascimento: true, naturalidade: true },
    });
    if (!atual) throw new NotFoundException('Filiado não encontrado');

    const { dados, ignorados } = protegerImutaveis(atual, dto as Record<string, unknown>);
    const filiado = await this.update(id, dados as UpdateFiliadoDto, autor, ignorados);
    return { ...filiado, camposProtegidos: ignorados };
  }

  /**
   * A DESFILIAÇÃO NÃO ENTRA NEM SAI PELO SELETOR DO FORMULÁRIO.
   *
   * O campo "Situação" da tela de edição é um `<select>` com as três opções, e
   * ele escrevia direto — o que abria duas portas dos fundos:
   *
   *  · ENTRAR: marcar DESFILIADO ali pulava tudo que a saída exige — motivo
   *    padronizado (é o que responde "quantos saíram por inadimplência?"),
   *    mês de corte, Termo assinado, histórico e auditoria. O cadastro ficava
   *    desfiliado sem que ninguém soubesse por quê nem desde quando;
   *
   *  · SAIR: voltar para ATIVO deixava os cinco campos da saída gravados, e o
   *    cadastro passava a mentir sobre si mesmo (ver `reativar`).
   *
   * Cada transição tem a sua porta, e cada porta exige o que a decisão exige.
   * O erro diz qual usar em vez de apenas recusar.
   */
  private async exigirPortaCerta(id: string, novaSituacao?: SituacaoFiliado) {
    if (!novaSituacao) return;
    const { situacao } = await this.prisma.filiado.findUniqueOrThrow({
      where: { id },
      select: { situacao: true },
    });
    if (novaSituacao === situacao) return;

    if (novaSituacao === SituacaoFiliado.DESFILIADO) {
      throw new BadRequestException(
        'Para desfiliar, use a ação "Desfiliar" — ela registra o motivo, o mês de corte e o Termo assinado.',
      );
    }
    if (situacao === SituacaoFiliado.DESFILIADO) {
      throw new BadRequestException(
        'Para reativar, use a ação "Reativar" — ela limpa os dados da saída e registra o motivo do retorno.',
      );
    }
  }

  async update(id: string, dto: UpdateFiliadoDto, autor?: string, protegidos: string[] = []) {
    await this.exigirPortaCerta(id, dto.situacao);
    await this.findOne(id);
    const { vinculos, dependentes, ...dados } = dto;

    const atuais = await this.prisma.dependente.findMany({
      where: { filiadoId: id },
      select: { id: true },
    });

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        ...dados,
        cpf: dto.cpf ? dto.cpf.replace(/\D/g, '') : undefined,
        dataNascimento: dataCalendario(dto.dataNascimento),
        dataAdmissao: dataCalendario(dto.dataAdmissao),
        vinculoFuncional: dto.vinculoFuncional,
        // Substitui os vínculos quando enviados
        vinculos: vinculos
          ? {
              deleteMany: {},
              create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })),
            }
          : undefined,
        // Mesma regra dos recadastramentos: a lista enviada vira a verdade.
        dependentes: montarSincronizacaoDependentes(dependentes, atuais),
      },
      include: { vinculos: true, dependentes: true },
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.ALTERACAO,
      'Dados cadastrais atualizados.' +
        (protegidos.length ? ` Campos protegidos ignorados: ${protegidos.join(', ')}.` : ''),
      autor,
      { campos: Object.keys(dados), protegidos },
    );
    return filiado;
  }

  async changeSituacao(id: string, dto: ChangeSituacaoDto, autor?: string) {
    // A mesma regra do formulário: DESFILIADO tem portas próprias nos dois
    // sentidos. Sem isto, a rota genérica de situação continuaria sendo o
    // atalho que contorna motivo, termo e auditoria.
    await this.exigirPortaCerta(id, dto.situacao);
    const atual = await this.findOne(id);
    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        situacao: dto.situacao,
        aprovadoEm:
          dto.situacao === SituacaoFiliado.ATIVO && !atual.aprovadoEm
            ? new Date()
            : undefined,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.MUDANCA_STATUS,
      `Situação alterada de ${atual.situacao} para ${dto.situacao}.${dto.motivo ? ' Motivo: ' + dto.motivo : ''}`,
      autor,
    );
    return filiado;
  }

  /**
   * O QUE FICA PARA TRÁS QUANDO ALGUÉM SAI.
   *
   * A desfiliação era uma decisão tomada às cegas: o modal pedia motivo e mês de
   * corte, e pronto. Só que o cadastro do filiado é o centro de meia dúzia de
   * módulos, e nenhum deles aparecia na hora de decidir — dívida em aberto,
   * processo em andamento, dependentes que perdem acesso junto, atividade
   * marcada na agenda de um advogado, triagem esperando resposta. Quem
   * confirmava não tinha como saber, e descobriria depois, por acaso.
   *
   * NÃO É UM BLOQUEIO, e a distinção é deliberada. Sair do sindicato é direito
   * do associado; recusar a saída porque há uma parcela aberta transformaria a
   * mensalidade em algema. O que o sistema deve fazer é MOSTRAR — para que a
   * secretaria cobre o que é devido, avise o advogado do caso em curso e
   * explique aos dependentes — em vez de deixar tudo isso ser descoberto
   * semanas depois.
   *
   * CONTAGENS, E NÃO LISTAS: a pergunta aqui é "tem algo pendurado?", e uma
   * resposta em números cabe no modal sem empurrar o botão para fora da tela.
   * Quem quiser o detalhe abre o dossiê, que já mostra tudo.
   */
  async levantarVinculos(id: string) {
    const f = await this.findOne(id);
    const emAberto = { in: [StatusParcela.PENDENTE, StatusParcela.VENCIDO] };

    const [
      parcelasAbertas,
      somaAberta,
      dependentes,
      processos,
      atividadesAbertas,
      atendimentosAbertos,
      carteirinhas,
    ] = await this.prisma.$transaction([
      this.prisma.parcelaCobranca.count({
        where: { cobranca: { filiadoId: id }, status: emAberto },
      }),
      this.prisma.parcelaCobranca.aggregate({
        where: { cobranca: { filiadoId: id }, status: emAberto },
        _sum: { valor: true },
      }),
      this.prisma.dependente.count({ where: { filiadoId: id } }),
      /**
       * Processos VIVOS em que ele é parte — e pela TABELA, não só pelo atalho
       * `Processo.filiadoId`. Um filiado pode figurar num processo coletivo sem
       * ser o "dono" dele, e é justamente esse caso que passaria despercebido.
       * Mesma lição do atalho/tabela que já escondeu a carteira do advogado.
       */
      this.prisma.processo.count({
        where: {
          statusInterno: {
            notIn: [
              StatusProcesso.ARQUIVADO,
              StatusProcesso.ENCERRADO,
              StatusProcesso.IMPROCEDENTE,
            ],
          },
          OR: [{ filiadoId: id }, { partes: { some: { filiadoId: id } } }],
        },
      }),
      this.prisma.compromisso.count({
        where: {
          filiadoId: id,
          status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] },
        },
      }),
      this.prisma.atendimento.count({
        where: { filiadoId: id, status: StatusAtendimento.PENDENTE },
      }),
      this.prisma.carteirinha.count({ where: { filiadoId: id } }),
    ]);

    return {
      nome: f.nomeCompleto,
      situacao: f.situacao,
      parcelasAbertas,
      valorAberto: Number(somaAberta._sum.valor ?? 0),
      dependentes,
      processos,
      atividadesAbertas,
      atendimentosAbertos,
      carteirinhas,
    };
  }

  /**
   * Desfiliação: marca a situação como DESFILIADO. O filiado deixa de ser aceito
   * em eventos e na Colônia de Férias (validado nos respectivos serviços), mas o
   * cadastro é preservado. Idempotente-seguro: bloqueia se já estiver desfiliado.
   */
  async desfiliar(id: string, dto: DesfiliarDto, autor?: string) {
    const atual = await this.findOne(id);
    if (atual.situacao === SituacaoFiliado.DESFILIADO)
      throw new BadRequestException('Este filiado já está desfiliado.');

    const observacoes = dto.observacoes?.trim() || null;
    const dataPedido = dto.dataPedido ? new Date(dto.dataPedido) : new Date();
    const mesCorte = dto.mesCorte ?? null;
    const rotulo = MOTIVO_DESFILIACAO_LABEL[dto.motivo];

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        situacao: SituacaoFiliado.DESFILIADO,
        motivoDesfiliacao: dto.motivo,
        desfiliacaoObservacoes: observacoes,
        desfiliadoEm: dataPedido,
        desfiliadoPor: autor ?? null,
        desfiliacaoMesCorte: mesCorte,
      },
    });

    // Linha do tempo do filiado (aba Documentos/Histórico do dossiê).
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.MUDANCA_STATUS,
      `Desfiliado — ${rotulo}.` +
        (mesCorte ? ` Última mensalidade: ${formatarMesCorte(mesCorte)}.` : '') +
        (observacoes ? ` ${observacoes}` : ''),
      autor,
      { motivo: dto.motivo, mesCorte, observacoes, dataPedido: dataPedido.toISOString() },
    );

    // Auditoria global: é onde se responde "quem desfiliou, quando e por quê".
    // Nunca derruba a operação — perder o log é ruim, perder a desfiliação é pior.
    await this.audit
      .registrar({
        userId: null,
        acao: AcaoAuditoria.UPDATE,
        entidade: 'Filiado',
        entidadeId: id,
        descricao:
          `Desfiliação de ${atual.nomeCompleto} — ${rotulo}` +
          (mesCorte ? ` (corte: ${formatarMesCorte(mesCorte)})` : ''),
        metadata: {
          motivo: dto.motivo,
          motivoLabel: rotulo,
          mesCorte,
          observacoes,
          dataPedido: dataPedido.toISOString(),
          autor: autor ?? null,
        },
      })
      .catch(() => undefined);

    return filiado;
  }

  /**
   * REATIVAÇÃO — desfazer a saída, e desfazer INTEIRA.
   *
   * O modal de desfiliação promete, com todas as letras, que "o cadastro será
   * preservado no histórico, podendo ser reativado futuramente". A promessa era
   * cumprida pela metade: dava para voltar a situação para ATIVO pelo seletor do
   * formulário de edição, e só isso acontecia. Os cinco campos da saída
   * — motivo, data, autor, mês de corte, observações — ficavam todos gravados.
   *
   * O ESTRAGO NÃO ERA COSMÉTICO. Um cadastro ATIVO carregando
   * `motivoDesfiliacao = INADIMPLENCIA` e `desfiliadoEm = 30/08/2026` mente para
   * quem vier depois:
   *
   *  · o Termo de Desfiliação, se gerado de novo, sai preenchido com o motivo
   *    ANTIGO (o gerador cai no que está no cadastro quando não recebe
   *    parâmetro) — um documento oficial afirmando uma saída que foi desfeita;
   *  · qualquer relatório por `desfiliadoEm` conta uma saída que não existe;
   *  · o dossiê exibe a tarja da desfiliação sobre alguém que está ativo.
   *
   * E o histórico dizia apenas "Dados cadastrais atualizados", porque a volta
   * passava pelo `update()` genérico. Quem lesse a linha do tempo meses depois
   * não teria como saber que houve uma reativação, nem por quê.
   *
   * Aqui o motivo é OBRIGATÓRIO pela mesma razão que ele é obrigatório na
   * saída: readmitir alguém é decisão da entidade, e decisão sem justificativa
   * registrada não pode ser revista depois.
   */
  async reativar(id: string, motivo: string, autor?: string) {
    const atual = await this.findOne(id);
    if (atual.situacao === SituacaoFiliado.ATIVO) {
      throw new BadRequestException('Este filiado já está ativo.');
    }

    const rotuloAnterior = atual.motivoDesfiliacao
      ? MOTIVO_DESFILIACAO_LABEL[atual.motivoDesfiliacao]
      : null;

    const filiado = await this.prisma.filiado.update({
      where: { id },
      data: {
        situacao: SituacaoFiliado.ATIVO,
        /**
         * LIMPA TUDO. Deixar qualquer um destes para trás recria exatamente o
         * defeito que este método existe para consertar.
         */
        motivoDesfiliacao: null,
        desfiliacaoObservacoes: null,
        desfiliadoEm: null,
        desfiliadoPor: null,
        desfiliacaoMesCorte: null,
        // Readmissão conta como aprovação nova quando nunca houve uma.
        aprovadoEm: atual.aprovadoEm ?? new Date(),
      },
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.MUDANCA_STATUS,
      `Reativado — ${motivo}` +
        (rotuloAnterior ? ` (saída anterior: ${rotuloAnterior}).` : '.'),
      autor,
      { de: atual.situacao, para: SituacaoFiliado.ATIVO, motivo, motivoSaidaAnterior: atual.motivoDesfiliacao },
    );

    await this.audit
      .registrar({
        userId: null,
        acao: AcaoAuditoria.UPDATE,
        entidade: 'Filiado',
        entidadeId: id,
        descricao: `Reativação de ${atual.nomeCompleto} — ${motivo}`,
        metadata: {
          de: atual.situacao,
          motivo,
          motivoSaidaAnterior: atual.motivoDesfiliacao,
          desfiliadoEmAnterior: atual.desfiliadoEm?.toISOString() ?? null,
          autor: autor ?? null,
        },
      })
      .catch(() => undefined);

    return filiado;
  }

  /** Exclusão permanente do cadastro (LGPD — Lei nº 13.709/2018). */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.filiado.delete({ where: { id } });
    return { ok: true };
  }

  async atualizarFoto(id: string, arquivo: Buffer, autor?: string) {
    const filiado = await this.findOne(id);
    const { fotoKey, fotoThumbKey } = await this.image.processarFoto(
      arquivo,
      `filiados/${id}`,
    );
    if (filiado.fotoKey) void this.storage.delete(filiado.fotoKey).catch(() => undefined);
    if (filiado.fotoThumbKey) void this.storage.delete(filiado.fotoThumbKey).catch(() => undefined);
    const atualizado = await this.prisma.filiado.update({
      where: { id },
      data: { fotoKey, fotoThumbKey },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.ALTERACAO,
      'Foto do filiado atualizada.',
      autor,
    );
    return atualizado;
  }

  // ---- Documentos ----
  async addDocumento(
    id: string,
    arquivo: Express.Multer.File,
    titulo: string,
    autor?: string,
    tipo?: string,
  ) {
    await this.findOne(id);
    const ext = MIME_PERMITIDOS[arquivo.mimetype];
    if (!ext)
      throw new BadRequestException('Formato não permitido. Use PDF, DOC, DOCX, JPG ou PNG.');

    // `randomUUID` no lugar de `Date.now()`: o carimbo de tempo é adivinhável, e
    // como a URL do arquivo É a credencial de acesso (ver `getSignedUrl` no
    // driver local), um nome previsível transforma "quem tem o link" em "quem
    // sabe a data". O id do filiado continua no caminho, mas ele só é conhecido
    // por quem já tem acesso ao cadastro.
    const storageKey = `filiados/${id}/documentos/${randomUUID()}.${ext}`;
    await this.storage.upload(storageKey, arquivo.buffer, arquivo.mimetype);

    // Tipo válido classifica o arquivo na aba Documentos; qualquer outra coisa
    // cai no genérico, em vez de derrubar o upload por causa de um rótulo.
    const tipoDoc =
      tipo && tipo in TipoDocumento
        ? (tipo as TipoDocumento)
        : TipoDocumento.DOCUMENTO_PESSOAL;

    const documento = await this.prisma.documento.create({
      data: {
        tipo: tipoDoc,
        titulo: titulo || arquivo.originalname,
        storageKey,
        mimeType: arquivo.mimetype,
        tamanhoBytes: arquivo.size,
        filiadoId: id,
      },
    });
    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.UPLOAD_DOCUMENTO,
      `Documento anexado: ${documento.titulo}.`,
      autor,
    );
    return documento;
  }

  async removeDocumento(filiadoId: string, documentoId: string) {
    const doc = await this.prisma.documento.findFirst({
      where: { id: documentoId, filiadoId },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    void this.storage.delete(doc.storageKey).catch(() => undefined);
    await this.prisma.documento.delete({ where: { id: documentoId } });
    return { ok: true };
  }

  // ---- QR Code ----
  async qrCode(id: string) {
    const filiado = await this.findOne(id);
    const payload = this.qr.montarPayload(filiado.id, TipoPessoa.FILIADO, filiado.qrToken);
    return { payload, imagem: await this.qr.gerarImagemDataUrl(payload) };
  }

  // ---- Histórico ----
  async historico(id: string) {
    await this.findOne(id);
    return this.prisma.filiadoHistorico.findMany({
      where: { filiadoId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---- Termo de Consentimento e Filiação (PDF) ----
  async gerarTermoPdf(id: string, autor?: string): Promise<Buffer> {
    const f = await this.findOne(id);

    // Textos legais fixos (inseridos exatamente como definidos pela diretoria).
    const TEXTO_DESCONTO =
      'O Enfermeiro, Auxiliar em enfermagem e Técnico em enfermagem, abaixo assinado, autoriza as ' +
      'instituições públicas da administração direta, indireta, funcional e privada, ao qual tenha vínculo ' +
      'como Servidor Público, Empregado Público e Empregado, respectivamente, a descontar em folha de ' +
      `pagamento / contracheque, em favor do ${tenant.sigla}, na ${contaEmLinha()}. A ` +
      'contribuição associativa mensal no valor de 1% sobre o maior vencimento básico ao qual esteja ' +
      `vinculado, em conformidade com os ${tenant.contribuicao?.artigoEstatuto ?? ''} do estatuto do ${tenant.sigla} e Art.: 584, alínea b, da ` +
      'CLT. Solicito que a Contribuição Sindical (Imposto Sindical) de que trata o Art.: 579 da CLT sejam ' +
      'repassadas ao sindicato supra na referida conta da Entidade Sindical Representativa da Categoria ' +
      'Base Territorial do Estado do Piauí Fundado em 30/11/2009 - Registro no Mtb/ sob nº ' +
      '46214.0005793/2018-86; Código da Entidade Sindical nº 19020-7 - CNPJ 11.378.331/0001-86.';
    const TEXTO_LGPD =
      'Em observância à Lei nº. 13.709/18 - Lei Geral de Proteção de Dados Pessoais (Fonte: Diário Oficial ' +
      'da União) e demais normativas aplicáveis sobre proteção de Dados Pessoais, manifesto-me de forma, ' +
      `livre, expressa e consciente, no sentido de autorizar o ${tenant.sigla} a realizar o tratamento de meus ` +
      'dados pessoais SEMPRE QUE FOR SOLICITADO. Consinto, ainda, com a utilização destes dados para as ' +
      'finalidades de representação sindical, emissão de carteirinha, controle de eventos e acesso a benefícios.';
    const RODAPE =
      rodapeInstitucional();

    const SEXO_LABEL: Record<string, string> = {
      MASCULINO: 'Masculino', FEMININO: 'Feminino', OUTRO: 'Outro',
    };
    const EC_LABEL: Record<string, string> = {
      SOLTEIRO: 'Solteiro(a)', CASADO: 'Casado(a)', DIVORCIADO: 'Divorciado(a)',
      VIUVO: 'Viúvo(a)', UNIAO_ESTAVEL: 'União estável', OUTRO: 'Outro',
    };
    const FORM_LABEL: Record<string, string> = {
      ENFERMEIRO: 'Enfermeiro(a)', TECNICO_ENFERMAGEM: 'Técnico(a) em Enfermagem',
      AUXILIAR_ENFERMAGEM: 'Auxiliar de Enfermagem', OUTRO: 'Outro',
    };

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const X = doc.page.margins.left;
      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const LINHA_VAZIA = '______________________';

      // Campo vazio (null/undefined) vira linha para preenchimento manual impresso.
      const ou = (v?: string | null) => {
        const s = v == null ? '' : String(v).trim();
        return s ? s : LINHA_VAZIA;
      };
      const fmt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : null);

      // Linha com um ou mais pares Rótulo (negrito) + valor (normal).
      const par = (pares: Array<[string, string]>) => {
        doc.fontSize(10.5);
        pares.forEach(([label, value], i) => {
          const last = i === pares.length - 1;
          doc.font('Times-Bold').fillColor('#111827').text(`${label}: `, { continued: true });
          doc.font('Times-Roman').fillColor('#1f2937').text(value, { continued: !last });
          if (!last) doc.font('Times-Roman').text('     ', { continued: true });
        });
        doc.moveDown(0.5);
      };

      // Título de seção com fundo cinza (aspecto de contrato).
      const secao = (titulo: string) => {
        doc.moveDown(0.7);
        if (doc.y > doc.page.height - 140) doc.addPage();
        const y = doc.y;
        doc.save().rect(X, y, W, 20).fill('#e5e7eb').restore();
        doc.fillColor('#111827').font('Times-Bold').fontSize(11).text(titulo, X + 8, y + 5.5, { width: W - 16 });
        doc.x = X;
        doc.y = y + 26;
        doc.font('Times-Roman').fillColor('#1f2937');
      };

      const subBloco = (titulo: string) => {
        doc.moveDown(0.15);
        doc.font('Times-Bold').fontSize(10).fillColor('#374151').text(titulo, X, doc.y);
        doc.moveDown(0.15);
        doc.fillColor('#1f2937');
      };

      const paragrafo = (texto: string) => {
        doc.font('Times-Roman').fontSize(10).fillColor('#1f2937')
          .text(texto, X, doc.y, { align: 'justify', width: W, lineGap: 1.5 });
        doc.moveDown(0.5);
      };

      // ---- Cabeçalho oficial (centralizado) ----
      doc.font('Times-Bold').fontSize(9.5).fillColor('#111827').text(
        `${tenant.sigla} - ${tenant.nome} | CNPJ: ${tenant.cnpj}`,
        X, doc.page.margins.top, { align: 'center', width: W },
      );
      doc.moveDown(0.5);
      doc.font('Times-Bold').fontSize(14).fillColor(VERDE_ESCURO)
        .text('FICHA DE FILIAÇÃO E TERMO DE CONSENTIMENTO', { align: 'center', width: W });
      doc.moveDown(0.2);
      doc.font('Times-Roman').fontSize(8.5).fillColor('#6b7280')
        .text(`Matrícula sindical: ${f.matricula}`, { align: 'center', width: W });
      doc.moveDown(0.35);
      const yh = doc.y;
      doc.moveTo(X, yh).lineTo(X + W, yh).strokeColor(VERDE_ESCURO).lineWidth(1).stroke();
      doc.moveDown(0.3);

      // ---- SEÇÃO 1 — Informações pessoais e de contato ----
      secao('SEÇÃO 1 - INFORMAÇÕES PESSOAIS E DE CONTATO');
      par([['Nome', ou(f.nomeCompleto)]]);
      par([
        ['CPF', ou(f.cpf ? mascararCpf(f.cpf) : null)],
        ['RG', ou(f.rg ? `${f.rg}${f.ufRg ? ' / ' + f.ufRg : ''}` : null)],
        ['Data de Nascimento', ou(fmt(f.dataNascimento))],
      ]);
      par([
        ['Sexo', ou(f.sexo ? SEXO_LABEL[f.sexo] ?? f.sexo : null)],
        ['Estado Civil', ou(f.estadoCivil ? EC_LABEL[f.estadoCivil] ?? f.estadoCivil : null)],
        ['Naturalidade/UF', ou(f.naturalidade)],
      ]);
      par([['Endereço', ou(f.endereco)], ['Nº', ou(f.numero)], ['Complemento', ou(f.complemento)]]);
      par([['Bairro', ou(f.bairro)], ['Cidade', ou(f.cidade)], ['UF', ou(f.estado)], ['CEP', ou(f.cep)]]);
      par([['Telefone', ou(f.telefonePrincipal)], ['Telefone 2', ou(f.telefoneSecundario)]]);
      par([['E-mail', ou(f.email)]]);

      // ---- SEÇÃO 2 — Informações profissionais ----
      secao('SEÇÃO 2 - INFORMAÇÕES PROFISSIONAIS');
      const formacaoTexto =
        f.formacao === 'OUTRO'
          ? f.formacaoOutro || 'Outro'
          : f.formacao ? FORM_LABEL[f.formacao] ?? f.formacao : null;
      par([['Formação Profissional', ou(formacaoTexto)], ['Nº COREN', ou(f.numeroCoren)]]);

      const v1 = f.vinculos?.[0];
      const v2 = f.vinculos?.[1];
      subBloco('Instituição 1');
      par([['Instituição', ou(v1?.empresa)], ['Cargo', ou(v1?.cargo)]]);
      par([['Matrícula', ou(v1?.matricula)], ['Data de Admissão', ou(fmt(f.dataAdmissao))]]);
      subBloco('Instituição 2');
      par([['Instituição', ou(v2?.empresa)], ['Cargo', ou(v2?.cargo)]]);
      par([['Matrícula', ou(v2?.matricula)], ['Data de Admissão', ou(null)]]);

      // ---- SEÇÃO 3 — Autorização de desconto sindical ----
      secao('SEÇÃO 3 - AUTORIZAÇÃO DE DESCONTO SINDICAL');
      paragrafo(TEXTO_DESCONTO);

      // ---- SEÇÃO 4 — Consentimento e tratamento de dados (LGPD) ----
      secao('SEÇÃO 4 - CONSENTIMENTO E TRATAMENTO DE DADOS (LGPD)');
      paragrafo(TEXTO_LGPD);

      // ---- Data + assinatura ----
      doc.moveDown(1.4);
      const dataFmt = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
      doc.font('Times-Roman').fontSize(10.5).fillColor('#1f2937')
        .text(`${pracaDaAssinatura()}, ${dataFmt}.`, X, doc.y, { width: W });
      doc.moveDown(2.4);
      const ys = doc.y;
      doc.moveTo(X + 110, ys).lineTo(X + W - 110, ys).strokeColor('#374151').lineWidth(0.8).stroke();
      doc.font('Times-Roman').fontSize(10).fillColor('#111827')
        .text('Assinatura do(a) Filiado(a)', X, ys + 6, { align: 'center', width: W });

      // ---- Rodapé fixo (repetido em todas as páginas) ----
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const fy = doc.page.height - 42;
        doc.moveTo(X, fy - 8).lineTo(X + W, fy - 8).strokeColor('#9ca3af').lineWidth(0.5).stroke();
        doc.font('Times-Roman').fontSize(7).fillColor('#4b5563')
          .text(RODAPE, X, fy, { align: 'center', width: W });
      }

      doc.end();
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.GERACAO_TERMO,
      'Termo de Consentimento e Filiação gerado.',
      autor,
    );
    return pdf;
  }

  // ---- Termo de Desfiliação (PDF) ----

  /**
   * Termo de Desfiliação pronto para assinatura.
   *
   * Redesenhado para parecer o que é: um documento oficial da entidade. Ganhou
   * faixa institucional com o logotipo, blocos numerados (identificação, motivo,
   * corte financeiro, declaração) e duas assinaturas — a do filiado e a da
   * diretoria, porque o termo só se completa quando a entidade também o recebe.
   *
   * Os dados podem vir por parâmetro (o modal gera o termo ANTES de confirmar a
   * saída, para o filiado assinar) ou do próprio cadastro, quando ele já está
   * desfiliado. O parâmetro vence, para o papel refletir o que está na tela.
   */
  async gerarTermoDesfiliacaoPdf(
    id: string,
    dados?: { motivo?: string; observacoes?: string; mesCorte?: string },
    autor?: string,
  ): Promise<Buffer> {
    const f = await this.findOne(id);

    // O motivo chega como slug do enum (vindo do modal) ou já como rótulo.
    const slug = dados?.motivo?.trim();
    const motivoLabel =
      (slug && MOTIVO_DESFILIACAO_LABEL[slug as MotivoDesfiliacao]) ||
      slug ||
      (f.motivoDesfiliacao ? MOTIVO_DESFILIACAO_LABEL[f.motivoDesfiliacao] : null);
    const observacoes = dados?.observacoes?.trim() || f.desfiliacaoObservacoes || null;
    const mesCorte = dados?.mesCorte?.trim() || f.desfiliacaoMesCorte || null;

    const RODAPE =
      rodapeInstitucional();

    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const X = doc.page.margins.left;
      const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const VAZIO = '_________________________________';
      const ou = (v?: string | null) => (v && String(v).trim() ? String(v) : VAZIO);

      // ---------------------------------------------------------------
      // Faixa institucional. O logotipo do acervo é BRANCO, então precisa de
      // fundo escuro — daí a faixa verde, a mesma da carteirinha e do crachá.
      // ---------------------------------------------------------------
      const ALT_FAIXA = 74;
      doc.rect(0, 0, doc.page.width, ALT_FAIXA).fill(VERDE_ESCURO);

      const logo = lerLogoDaMarca();
      if (logo) {
        try {
          doc.image(logo, X, 18, { fit: [150, 38] });
        } catch {
          doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text(tenant.sigla, X, 26);
        }
      } else {
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text(tenant.sigla, X, 26);
      }

      doc.font('Helvetica').fontSize(7.5).fillColor('#E8F5E3').text(
        `${tenant.nome}\nCNPJ: ${tenant.cnpj}`,
        X + W - 230,
        20,
        { align: 'right', width: 230, lineGap: 1.5 },
      );

      // Filete de acento sob a faixa — assina visualmente o documento.
      doc.rect(0, ALT_FAIXA, doc.page.width, 4).fill(VERDE_MEDIO);

      // ---------------------------------------------------------------
      // Título
      // ---------------------------------------------------------------
      doc.y = ALT_FAIXA + 26;
      doc
        .font('Times-Bold')
        .fontSize(16)
        .fillColor('#111827')
        .text('TERMO DE DESFILIAÇÃO', X, doc.y, {
          align: 'center',
          width: W,
          characterSpacing: 0.5,
        });
      doc.moveDown(0.25);
      doc
        .font('Times-Italic')
        .fontSize(9)
        .fillColor('#4b5563')
        .text('Formalização da saída do quadro associativo', { align: 'center', width: W });
      doc.moveDown(1.2);

      /** Cabeçalho de seção: barrinha verde + rótulo, para o olho achar o bloco. */
      const secao = (titulo: string) => {
        const y = doc.y;
        doc.rect(X, y, 3, 12).fill(VERDE_MEDIO);
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(VERDE_ESCURO)
          .text(titulo.toUpperCase(), X + 9, y + 1.5, { width: W - 9, characterSpacing: 0.6 });
        doc.y = y + 20;
      };

      /** Par rótulo/valor em duas colunas — cabe mais informação em menos papel. */
      const campo = (label: string, valor: string, col: 0 | 1, linha: number, base: number) => {
        const larguraCol = (W - 16) / 2;
        const px = X + col * (larguraCol + 16);
        const py = base + linha * 30;
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#6b7280')
          .text(label.toUpperCase(), px, py, { width: larguraCol, characterSpacing: 0.4 });
        doc
          .font('Times-Roman')
          .fontSize(11)
          .fillColor('#111827')
          .text(valor, px, py + 10, { width: larguraCol, ellipsis: true });
      };

      // ---------------------------------------------------------------
      // 1. Identificação
      // ---------------------------------------------------------------
      secao('1. Identificação do(a) Filiado(a)');
      const yIdent = doc.y;
      campo('Nome completo', ou(f.nomeCompleto), 0, 0, yIdent);
      campo('CPF', ou(f.cpf ? mascararCpf(f.cpf) : null), 1, 0, yIdent);
      campo('Matrícula sindical', ou(f.matricula), 0, 1, yIdent);
      campo('COREN', ou(f.numeroCoren), 1, 1, yIdent);
      doc.y = yIdent + 64;

      // ---------------------------------------------------------------
      // 2. Motivo
      // ---------------------------------------------------------------
      secao('2. Motivo da Desfiliação');
      doc
        .font('Times-Roman')
        .fontSize(11)
        .fillColor('#111827')
        .text(motivoLabel ?? VAZIO, X, doc.y, { width: W });
      doc.moveDown(0.5);
      if (observacoes) {
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#6b7280')
          .text('OBSERVAÇÕES', X, doc.y, { characterSpacing: 0.4 });
        doc.moveDown(0.15);
        doc
          .font('Times-Roman')
          .fontSize(10)
          .fillColor('#1f2937')
          .text(observacoes, X, doc.y, { width: W, align: 'justify', lineGap: 1.5 });
      }
      doc.moveDown(1);

      // ---------------------------------------------------------------
      // 3. Corte financeiro — o bloco que a folha de pagamento procura.
      // ---------------------------------------------------------------
      secao('3. Corte Financeiro');
      const yCorte = doc.y;
      doc.roundedRect(X, yCorte, W, 40, 4).fillAndStroke('#F4FAF2', VERDE_MEDIO);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#4b5563')
        .text('ÚLTIMA MENSALIDADE A SER DESCONTADA', X + 12, yCorte + 9, { characterSpacing: 0.4 });
      doc
        .font('Times-Bold')
        .fontSize(12)
        .fillColor(VERDE_ESCURO)
        .text(
          mesCorte ? formatarMesCorte(mesCorte) : 'A definir pelo setor financeiro',
          X + 12,
          yCorte + 21,
        );
      doc.y = yCorte + 54;

      // ---------------------------------------------------------------
      // 4. Declaração
      // ---------------------------------------------------------------
      secao('4. Declaração');
      doc
        .font('Times-Roman')
        .fontSize(10.5)
        .fillColor('#1f2937')
        .text(
          'Pelo presente instrumento, o(a) filiado(a) acima identificado(a) formaliza a sua DESFILIAÇÃO ' +
            `do quadro associativo do ${tenant.sigla}, deixando de contribuir e de usufruir dos benefícios e da ` +
            'representação sindical a partir desta data, nos termos do estatuto da entidade. Declara estar ' +
            'ciente de que o presente pedido não o exime de eventuais débitos anteriores ao mês de corte ' +
            'acima indicado.',
          X,
          doc.y,
          { align: 'justify', width: W, lineGap: 2.5 },
        );
      doc.moveDown(1.6);

      const dataFmt = new Date().toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      doc
        .font('Times-Roman')
        .fontSize(10.5)
        .fillColor('#1f2937')
        .text(`${pracaDaAssinatura()}, ${dataFmt}.`, X, doc.y, { width: W });

      // ---------------------------------------------------------------
      // Assinaturas — duas: quem sai e quem recebe.
      // ---------------------------------------------------------------
      doc.moveDown(3.2);
      const yAss = doc.y;
      const larguraAss = (W - 40) / 2;
      const assinatura = (rotulo: string, sub: string, col: 0 | 1) => {
        const px = X + col * (larguraAss + 40);
        doc
          .moveTo(px, yAss)
          .lineTo(px + larguraAss, yAss)
          .strokeColor('#374151')
          .lineWidth(0.8)
          .stroke();
        doc
          .font('Times-Bold')
          .fontSize(9.5)
          .fillColor('#111827')
          .text(rotulo, px, yAss + 6, { align: 'center', width: larguraAss });
        doc
          .font('Times-Roman')
          .fontSize(8)
          .fillColor('#6b7280')
          .text(sub, px, yAss + 19, { align: 'center', width: larguraAss });
      };
      assinatura('Assinatura do(a) Filiado(a)', ou(f.nomeCompleto), 0);
      assinatura('Diretoria / Secretaria', tenant.sigla, 1);

      // ---- Rodapé fixo (repetido em todas as páginas) ----
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const fy = doc.page.height - 42;
        doc
          .moveTo(X, fy - 8)
          .lineTo(X + W, fy - 8)
          .strokeColor(VERDE_MEDIO)
          .lineWidth(0.8)
          .stroke();
        doc
          .font('Helvetica')
          .fontSize(6.5)
          .fillColor('#4b5563')
          .text(RODAPE, X, fy, { align: 'center', width: W });
      }
      doc.end();
    });

    await this.registrarHistorico(
      id,
      TipoHistoricoFiliado.GERACAO_TERMO,
      'Termo de Desfiliação gerado.',
      autor,
    );
    return pdf;
  }
}
