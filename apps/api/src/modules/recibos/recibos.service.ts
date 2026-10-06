import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, Prisma, StatusParcela, TipoMovimentacao } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { valorPorExtenso } from '../../common/valor-por-extenso.util';
import { diaBR, instanteDoTextoBR } from '../processos/utils/data-br.util';
import { tenant } from '../../tenant/tenant.config';
import {
  CancelarReciboDto,
  EmitirReciboDto,
  ListarRecibosQueryDto,
} from './dto/recibos.dto';

interface Ctx {
  ip?: string;
  userAgent?: string;
  userId?: string;
}

/**
 * A TRAVA DA NUMERAÇÃO. Dois atendentes emitindo ao mesmo tempo tirariam o
 * mesmo `MAX+1` e o segundo bateria na UNIQUE — erro feio num balcão com
 * alguém esperando o papel. `pg_advisory_xact_lock` serializa SÓ a numeração
 * daquele exercício, dentro da transação, e solta sozinha no commit.
 *
 * O número é arbitrário; só precisa ser estável e não colidir com outra trava
 * do sistema (hoje não há nenhuma).
 */
const TRAVA_DA_NUMERACAO = 817_263;

/** Só dígitos — CPF e CNPJ entram com máscara pela tela. */
const soDigitos = (v?: string | null) => (v ?? '').replace(/[^0-9]/g, '') || null;

/** "007/2026" — é assim que o recibo é citado em ofício e em prestação de contas. */
export const codigoDoRecibo = (numero: number, exercicio: number) =>
  `${String(numero).padStart(3, '0')}/${exercicio}`;

/**
 * "08/2026" a partir de `dataCompetencia` — e NÃO passa por `diaBR`.
 *
 * `dataCompetencia` é coluna `@db.Date`: chega do Postgres como MEIA-NOITE UTC.
 * Descontar as três horas de Teresina ali volta um dia — e no dia 1º do mês
 * volta um MÊS. A primeira versão disto usava `diaBR` e o recibo da parcela de
 * agosto saía "competência 07/2026"; o teste pegou antes de subir
 * (`senatepi-data-pura`).
 *
 * Instante de verdade (`recebidoEm`, `dataPagamento`) continua lendo por
 * `diaBR`, que é o certo para `timestamp`.
 */
/**
 * A DATA QUE A PESSOA ESCOLHEU NO `<input type="date">` É UM DIA DE TERESINA.
 *
 * `new Date('2026-10-06')` é 00:00 em LONDRES, ou seja, 21h do dia 5 aqui — e o
 * recibo sairia com a data de ontem, impresso e assinado. A regra já existe no
 * projeto (`instanteDoTextoBR`) e é só não contorná-la: texto só com dia vira o
 * instante em que aquele dia começa em Teresina; texto com hora continua sendo
 * o instante que diz ser.
 */
const instanteEscolhido = (texto?: string) =>
  texto ? instanteDoTextoBR(texto) : null;

const competenciaDaDataPura = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;

@Injectable()
export class RecibosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Leitura
  // -------------------------------------------------------------------------

  /**
   * O ACERVO DE RECIBOS, com os totais do MESMO recorte.
   *
   * `senatepi-link-leva-o-recorte`: o número do cabeçalho e a lista saem do
   * mesmo filtro. Somar tudo e listar uma página seria mostrar "R$ 12.400"
   * sobre vinte linhas que somam R$ 900.
   */
  async listar(q: ListarRecibosQueryDto) {
    /*
      DOIS FILTROS, e a diferença é o que o resumo CONTA.

      `recorte` é o período, a busca e o exercício — o que a pessoa escolheu.
      `where` é isso MAIS a situação (válidos/cancelados), que é só qual aba
      da lista está aberta.

      Contar os cancelados dentro de `where` dava sempre ZERO: na aba padrão
      ele já exige `canceladoEm: null`, e pedir "cancelados entre os não
      cancelados" é uma contradição que o banco responde com 0 sem reclamar.
      Na tela, dois recibos cancelados viravam "0 cancelados".
    */
    const recorte = this.filtro(q, { comSituacao: false });
    const where = this.filtro(q);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));

    const [itens, total, validos, cancelados, exercicios] = await Promise.all([
      this.prisma.recibo.findMany({
        where,
        orderBy: [{ exercicio: 'desc' }, { numero: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          filiado: { select: { id: true, nomeCompleto: true, matricula: true } },
          empresa: { select: { id: true, razaoSocial: true } },
        },
      }),
      this.prisma.recibo.count({ where }),
      // O total em dinheiro IGNORA cancelado: recibo cancelado não é receita.
      this.prisma.recibo.aggregate({
        where: { AND: [recorte, { canceladoEm: null }] },
        _sum: { valor: true },
        _count: true,
      }),
      this.prisma.recibo.count({ where: { AND: [recorte, { NOT: { canceladoEm: null } }] } }),
      this.prisma.recibo.groupBy({ by: ['exercicio'], orderBy: { exercicio: 'desc' } }),
    ]);

    return {
      itens: itens.map((r) => this.resumo(r)),
      total,
      page,
      pageSize,
      resumo: {
        quantidadeValida: validos._count,
        valorValido: Number(validos._sum.valor ?? 0),
        cancelados,
      },
      exercicios: exercicios.map((e) => e.exercicio),
    };
  }

  private filtro(
    q: ListarRecibosQueryDto,
    opcoes: { comSituacao?: boolean } = {},
  ): Prisma.ReciboWhereInput {
    const and: Prisma.ReciboWhereInput[] = [];

    if (q.exercicio) and.push({ exercicio: q.exercicio });
    if (q.filiadoId) and.push({ filiadoId: q.filiadoId });

    /*
      `VALIDOS` é o padrão: quem abre a tela quer ver os recibos que valem. Os
      cancelados continuam alcançáveis pelo filtro — some da vista, nunca do
      acervo.
    */
    const situacao = q.situacao ?? 'VALIDOS';
    if (opcoes.comSituacao !== false) {
      if (situacao === 'VALIDOS') and.push({ canceladoEm: null });
      if (situacao === 'CANCELADOS') and.push({ NOT: { canceladoEm: null } });
    }

    if (q.de) and.push({ recebidoEm: { gte: instanteDoTextoBR(q.de) } });
    // `ate` é INCLUSIVO: o dia escolhido inteiro, até o fim dele em Teresina.
    if (q.ate) {
      const fim = instanteDoTextoBR(q.ate);
      fim.setUTCDate(fim.getUTCDate() + 1);
      and.push({ recebidoEm: { lt: fim } });
    }

    const busca = (q.busca ?? '').trim();
    if (busca) {
      const digitos = soDigitos(busca);
      const numero = /^\d{1,6}$/.test(busca) ? Number(busca) : null;
      and.push({
        OR: [
          { pagadorNome: { contains: busca, mode: 'insensitive' } },
          { referente: { contains: busca, mode: 'insensitive' } },
          ...(digitos ? [{ pagadorDocumento: { contains: digitos } }] : []),
          // Procurar "7" acha o recibo nº 7 — é assim que se procura no balcão.
          ...(numero !== null ? [{ numero }] : []),
        ],
      });
    }

    return and.length ? { AND: and } : {};
  }

  /**
   * UM RECIBO, com tudo que o papel precisa — inclusive o valor por extenso,
   * que é calculado AQUI e não na tela.
   *
   * `senatepi-previa-le-a-mesma-regra`: se a tela escrevesse o extenso, haveria
   * duas implementações da mesma frase, e a 2ª via poderia sair diferente da 1ª.
   */
  async obter(id: string) {
    const r = await this.prisma.recibo.findUnique({
      where: { id },
      include: {
        filiado: { select: { id: true, nomeCompleto: true, matricula: true, cpf: true } },
        empresa: { select: { id: true, razaoSocial: true, cnpj: true } },
        parcela: {
          select: {
            numero: true,
            dataCompetencia: true,
            cobranca: { select: { tipo: true, _count: { select: { parcelas: true } } } },
          },
        },
      },
    });
    if (!r) throw new NotFoundException('Recibo não encontrado.');

    const [emitente, cancelador] = await Promise.all([
      this.nomeDoUsuario(r.emitidoPor),
      this.nomeDoUsuario(r.canceladoPor),
    ]);

    return {
      ...this.resumo(r),
      valorPorExtenso: valorPorExtenso(r.valor.toFixed(2)),
      /*
        O CABEÇALHO DO PAPEL VEM DAQUI, e não do `tenant.config` do web.

        CNPJ, endereço e telefone só existem no tenant da API — e é melhor
        assim: dado legal em dois lugares divergiria, e o recibo de um cliente
        sairia com o CNPJ do outro. Foi exatamente o que quase aconteceu com a
        ficha de filiação, que tinha os números escritos à mão no gerador.
      */
      emitente: this.emitente(),
      emitidoPorNome: emitente,
      canceladoPorNome: cancelador,
      filiado: r.filiado,
      empresa: r.empresa,
      parcela: r.parcela
        ? {
            numero: r.parcela.numero,
            total: r.parcela.cobranca._count.parcelas,
            tipo: r.parcela.cobranca.tipo,
            competencia: r.parcela.dataCompetencia,
          }
        : null,
    };
  }

  /** Os dados institucionais que todo recibo carrega no alto. */
  private emitente() {
    const e = tenant.endereco;
    return {
      sigla: tenant.sigla,
      nome: tenant.nome,
      nomeCurto: tenant.nomeCurto ?? tenant.sigla,
      cnpj: tenant.cnpj ?? tenant.registro?.cnpj ?? null,
      registroSindical: tenant.registro?.sindical ?? null,
      endereco: e
        ? `${e.logradouro} — ${e.bairro}, ${e.cidade}/${e.uf} — CEP ${e.cep}`
        : null,
      telefone: tenant.contato?.telefone ?? null,
      email: tenant.contato?.email ?? null,
      cidade: e?.cidade ?? null,
    };
  }

  private async nomeDoUsuario(id: string | null) {
    if (!id) return null;
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { nome: true, nomeExibicao: true },
    });
    return u?.nomeExibicao || u?.nome || null;
  }

  private resumo(r: {
    id: string;
    exercicio: number;
    numero: number;
    valor: Prisma.Decimal;
    referente: string;
    formaPagamento: string;
    recebidoEm: Date;
    pagadorNome: string;
    pagadorDocumento: string | null;
    emitidoEm: Date;
    canceladoEm: Date | null;
    canceladoMotivo: string | null;
    movimentacaoId: string | null;
    parcelaId: string | null;
    filiadoId: string | null;
    empresaId: string | null;
    filiado?: { id: string; nomeCompleto: string; matricula: string } | null;
    empresa?: { id: string; razaoSocial: string } | null;
  }) {
    return {
      id: r.id,
      exercicio: r.exercicio,
      numero: r.numero,
      codigo: codigoDoRecibo(r.numero, r.exercicio),
      valor: Number(r.valor),
      referente: r.referente,
      formaPagamento: r.formaPagamento,
      recebidoEm: r.recebidoEm,
      pagadorNome: r.pagadorNome,
      pagadorDocumento: r.pagadorDocumento,
      emitidoEm: r.emitidoEm,
      cancelado: r.canceladoEm !== null,
      canceladoEm: r.canceladoEm,
      canceladoMotivo: r.canceladoMotivo,
      movimentacaoId: r.movimentacaoId,
      parcelaId: r.parcelaId,
      filiadoId: r.filiadoId,
      empresaId: r.empresaId,
      filiadoNome: r.filiado?.nomeCompleto ?? null,
      filiadoMatricula: r.filiado?.matricula ?? null,
      empresaNome: r.empresa?.razaoSocial ?? null,
    };
  }

  /**
   * O TRABALHO ANTES DO NÚMERO: dinheiro que entrou no caixa e ainda não tem
   * papel (`senatepi-painel-quatro-zonas`).
   *
   * Este é o problema real do sindicato, e não "gerar um PDF bonito". Ninguém
   * esquece o recibo de quem está esperando no balcão; esquece-se do pagamento
   * que caiu na conta e de quem pediu o papel três semanas depois.
   *
   * A FILA SAI DAS ENTRADAS DO CAIXA, e não das parcelas pagas, porque é a
   * entrada que existe em TODOS os casos: baixa de parcela, repasse patronal e
   * lançamento à mão têm todos um lançamento de ENTRADA. Varrer parcelas
   * deixaria o repasse de fora — e o repasse é o valor mais alto da casa
   * (R$ 5.000 na produção, contra R$ 396,60 de todas as parcelas somadas).
   */
  async pendentes() {
    const where: Prisma.MovimentacaoWhereInput = {
      tipo: TipoMovimentacao.ENTRADA,
      /*
        SEM RECIBO **VIVO** — e não "sem recibo". Um lançamento cujo único
        recibo foi cancelado VOLTA para a fila: o dinheiro entrou e continua
        sem papel válido. `none` com o filtro dentro é o que diz isso; `recibos:
        { none: {} }` diria "nunca teve recibo", que é outra pergunta.
      */
      recibos: { none: { canceladoEm: null } },
    };
    const [movs, total] = await Promise.all([
      this.prisma.movimentacao.findMany({
        where,
        orderBy: { data: 'desc' },
        take: 100,
        select: {
          id: true,
          valor: true,
          descricao: true,
          data: true,
          origem: true,
          conta: { select: { nome: true } },
          parcela: {
            select: {
              id: true,
              numero: true,
              dataCompetencia: true,
              cobranca: {
                select: {
                  tipo: true,
                  _count: { select: { parcelas: true } },
                  filiado: {
                    select: { id: true, nomeCompleto: true, cpf: true, matricula: true },
                  },
                },
              },
            },
          },
          contribuicaoPatronal: {
            select: {
              /* Competência patronal é TEXTO "AAAA-MM" (ordena como texto), e não data. */
              mesReferencia: true,
              empresa: { select: { id: true, razaoSocial: true, cnpj: true } },
            },
          },
        },
      }),
      this.prisma.movimentacao.count({ where }),
    ]);

    return {
      total,
      /** A lista é cortada em 100; o contador acima é o número de verdade. */
      truncada: total > movs.length,
      itens: movs.map((m) => {
        const f = m.parcela?.cobranca.filiado;
        const e = m.contribuicaoPatronal?.empresa;
        return {
          movimentacaoId: m.id,
          parcelaId: m.parcela?.id ?? null,
          valor: Number(m.valor),
          data: m.data,
          descricao: m.descricao,
          origem: m.origem,
          conta: m.conta.nome,
          /* Quem pagou, já deduzido — a tela não adivinha nem pergunta de novo. */
          pagadorNome: f?.nomeCompleto ?? e?.razaoSocial ?? null,
          pagadorDocumento: f?.cpf ?? e?.cnpj ?? null,
          filiadoId: f?.id ?? null,
          empresaId: e?.id ?? null,
          referenteSugerido: this.referenteSugerido(m),
        };
      }),
    };
  }

  /** A frase do "referente a" que a tela já traz preenchida, e que dá para trocar. */
  private referenteSugerido(m: {
    descricao: string;
    parcela?: {
      numero: number;
      dataCompetencia: Date;
      cobranca: { tipo: string; _count: { parcelas: number } };
    } | null;
    contribuicaoPatronal?: { mesReferencia: string } | null;
  }): string {
    if (m.parcela) {
      const { numero, cobranca } = m.parcela;
      const rotulo = cobranca.tipo === 'MENSALIDADE' ? 'Mensalidade sindical' : 'Contribuição';
      return `${rotulo} — parcela ${numero}/${cobranca._count.parcelas}, competência ${competenciaDaDataPura(m.parcela.dataCompetencia)}`;
    }
    if (m.contribuicaoPatronal) {
      const [ano, mes] = m.contribuicaoPatronal.mesReferencia.split('-');
      return `Contribuição patronal — competência ${mes}/${ano}`;
    }
    return m.descricao;
  }

  // -------------------------------------------------------------------------
  // Emissão
  // -------------------------------------------------------------------------

  /**
   * EMITIR — as três portas, e o que cada uma exige.
   *
   * Tudo dentro de UMA transação, com a trava da numeração tomada antes de ler
   * o último número. O recibo avulso cria a ENTRADA no caixa aqui dentro: ou
   * nascem os dois, ou não nasce nenhum. Papel sem lastro no livro é como a
   * contabilidade e a gaveta começam a divergir.
   */
  async emitir(dto: EmitirReciboDto, ctx: Ctx) {
    if (dto.parcelaId && dto.movimentacaoId)
      throw new BadRequestException('Escolha uma origem só: a parcela OU o lançamento do caixa.');

    const base = dto.parcelaId
      ? await this.daParcela(dto)
      : dto.movimentacaoId
        ? await this.daMovimentacao(dto)
        : await this.doAvulso(dto);

    /*
      O EXERCÍCIO É O ANO EM TERESINA, e não o do relógio do contêiner (UTC).
      Um recebimento às 22h de 31/12 entraria no exercício seguinte, e a
      numeração do ano que fecha ganharia um recibo fantasma.
    */
    const exercicio = Number(diaBR(base.recebidoEm).slice(0, 4));

    const criado = await this.prisma.$transaction(async (tx) => {
      /*
        `::int` NOS DOIS, e não é enfeite.

        O Prisma manda todo número de JavaScript como `bigint`, e o
        Postgres só tem `pg_advisory_xact_lock(int, int)` e
        `(bigint)` — a mistura `(bigint, bigint)` NÃO EXISTE. Sem o
        cast, toda emissão morria com 42883, e o teste de unidade
        passava porque conferia o TEXTO do SQL
        (`senatepi-teste-que-afirma-a-chamada`). Quem pegou foi rodar.
      */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAVA_DA_NUMERACAO}::int, ${exercicio}::int)`;

      const ultimo = await tx.recibo.findFirst({
        where: { exercicio },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      });
      const numero = (ultimo?.numero ?? 0) + 1;

      // O avulso precisa de lastro: a entrada nasce junto, na mesma transação.
      let movimentacaoId = base.movimentacaoId;
      if (!movimentacaoId && base.contaBancariaId) {
        const mov = await tx.movimentacao.create({
          data: {
            contaBancariaId: base.contaBancariaId,
            tipo: TipoMovimentacao.ENTRADA,
            valor: base.valor,
            descricao: `Recibo ${codigoDoRecibo(numero, exercicio)} — ${base.referente}`,
            data: base.recebidoEm,
            origem: 'RECIBO',
            criadaPor: ctx.userId,
          },
        });
        movimentacaoId = mov.id;
      }

      return tx.recibo.create({
        data: {
          exercicio,
          numero,
          valor: base.valor,
          referente: base.referente,
          formaPagamento: base.formaPagamento,
          recebidoEm: base.recebidoEm,
          pagadorNome: base.pagadorNome,
          pagadorDocumento: base.pagadorDocumento,
          movimentacaoId,
          parcelaId: base.parcelaId,
          filiadoId: base.filiadoId,
          empresaId: base.empresaId,
          emitidoPor: ctx.userId ?? 'sistema',
        },
      });
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'Recibo',
      entidadeId: criado.id,
      descricao: `Emitiu o recibo ${codigoDoRecibo(criado.numero, criado.exercicio)} de R$ ${Number(criado.valor).toFixed(2)} para ${criado.pagadorNome}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        parcelaId: criado.parcelaId,
        movimentacaoId: criado.movimentacaoId,
        formaPagamento: criado.formaPagamento,
      },
    });

    return this.obter(criado.id);
  }

  /** A parcela do carnê: tudo vem dela, inclusive o lançamento que a baixa criou. */
  private async daParcela(dto: EmitirReciboDto) {
    const p = await this.prisma.parcelaCobranca.findUnique({
      where: { id: dto.parcelaId },
      include: {
        // Só o vivo: o cancelado não impede a reemissão.
        recibos: { where: { canceladoEm: null }, select: { numero: true, exercicio: true }, take: 1 },
        cobranca: {
          select: {
            tipo: true,
            _count: { select: { parcelas: true } },
            filiado: { select: { id: true, nomeCompleto: true, cpf: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Parcela não encontrada.');
    if (p.status !== StatusParcela.PAGO)
      throw new BadRequestException('Só dá para emitir recibo de parcela PAGA — dê a baixa primeiro.');
    const vivo = p.recibos[0];
    if (vivo)
      throw new BadRequestException(
        `Esta parcela já tem o recibo ${codigoDoRecibo(vivo.numero, vivo.exercicio)}. Imprima a 2ª via em vez de emitir outro.`,
      );

    const f = p.cobranca.filiado;
    const rotulo = p.cobranca.tipo === 'MENSALIDADE' ? 'Mensalidade sindical' : 'Contribuição';
    return {
      /* `valorPago` e não `valor`: o recibo diz o que ENTROU, com juros ou desconto. */
      valor: Number(p.valorPago ?? p.valor),
      referente:
        dto.referente?.trim() ||
        `${rotulo} — parcela ${p.numero}/${p.cobranca._count.parcelas}, competência ${competenciaDaDataPura(p.dataCompetencia)}`,
      formaPagamento: dto.formaPagamento,
      recebidoEm: instanteEscolhido(dto.recebidoEm) ?? p.dataPagamento ?? new Date(),
      pagadorNome: dto.pagadorNome?.trim() || f.nomeCompleto,
      pagadorDocumento: soDigitos(dto.pagadorDocumento ?? f.cpf),
      movimentacaoId: p.movimentacaoId,
      parcelaId: p.id,
      filiadoId: f.id,
      empresaId: null as string | null,
      contaBancariaId: null as string | null,
    };
  }

  /** Uma entrada que já está no caixa (repasse patronal, lançamento à mão). */
  private async daMovimentacao(dto: EmitirReciboDto) {
    const m = await this.prisma.movimentacao.findUnique({
      where: { id: dto.movimentacaoId },
      include: {
        recibos: { where: { canceladoEm: null }, select: { numero: true, exercicio: true }, take: 1 },
        parcela: {
          select: {
            id: true,
            cobranca: {
              select: { filiado: { select: { id: true, nomeCompleto: true, cpf: true } } },
            },
          },
        },
        contribuicaoPatronal: {
          select: { empresa: { select: { id: true, razaoSocial: true, cnpj: true } } },
        },
      },
    });
    if (!m) throw new NotFoundException('Lançamento não encontrado.');
    if (m.tipo !== TipoMovimentacao.ENTRADA)
      throw new BadRequestException('Recibo é de dinheiro que ENTROU; este lançamento é uma saída.');
    const vivo = m.recibos[0];
    if (vivo)
      throw new BadRequestException(
        `Este lançamento já tem o recibo ${codigoDoRecibo(vivo.numero, vivo.exercicio)}.`,
      );

    const f = m.parcela?.cobranca.filiado;
    const e = m.contribuicaoPatronal?.empresa;
    const nome = dto.pagadorNome?.trim() || f?.nomeCompleto || e?.razaoSocial;
    if (!nome)
      throw new BadRequestException('Diga quem pagou: este lançamento não aponta para ninguém.');

    return {
      valor: Number(m.valor),
      referente: dto.referente?.trim() || m.descricao,
      formaPagamento: dto.formaPagamento,
      recebidoEm: instanteEscolhido(dto.recebidoEm) ?? m.data,
      pagadorNome: nome,
      pagadorDocumento: soDigitos(dto.pagadorDocumento ?? f?.cpf ?? e?.cnpj),
      movimentacaoId: m.id,
      parcelaId: m.parcela?.id ?? null,
      filiadoId: dto.filiadoId ?? f?.id ?? null,
      empresaId: dto.empresaId ?? e?.id ?? null,
      contaBancariaId: null as string | null,
    };
  }

  /**
   * O AVULSO — dinheiro que entrou sem carnê e sem repasse: a 2ª via da
   * carteirinha, a diária da colônia, a inscrição do evento, o acordo pago no
   * balcão. É o caso que hoje sai em papel timbrado preenchido à mão.
   */
  private async doAvulso(dto: EmitirReciboDto) {
    if (!dto.valor) throw new BadRequestException('Informe o valor recebido.');
    if (!dto.referente?.trim())
      throw new BadRequestException('Diga a que se refere — é o que a pessoa lê no papel.');
    if (!dto.pagadorNome?.trim()) throw new BadRequestException('Informe quem pagou.');

    const conta = await this.contaDoAvulso(dto.contaBancariaId);
    return {
      valor: dto.valor,
      referente: dto.referente.trim(),
      formaPagamento: dto.formaPagamento,
      recebidoEm: instanteEscolhido(dto.recebidoEm) ?? new Date(),
      pagadorNome: dto.pagadorNome.trim(),
      pagadorDocumento: soDigitos(dto.pagadorDocumento),
      movimentacaoId: null as string | null,
      parcelaId: null as string | null,
      filiadoId: dto.filiadoId ?? null,
      empresaId: dto.empresaId ?? null,
      contaBancariaId: conta,
    };
  }

  /**
   * COM UMA CONTA SÓ, NÃO SE PERGUNTA. O sindicato tem uma ("CONTA SINDICATO",
   * medido em 06/10/2026) — obrigar a escolher entre uma opção é um campo que
   * só serve para errar.
   */
  private async contaDoAvulso(escolhida?: string) {
    if (escolhida) {
      const c = await this.prisma.contaBancaria.findUnique({ where: { id: escolhida } });
      if (!c || !c.ativo) throw new BadRequestException('Conta de destino inválida ou inativa.');
      return c.id;
    }
    const ativas = await this.prisma.contaBancaria.findMany({
      where: { ativo: true },
      select: { id: true },
      take: 2,
    });
    if (!ativas.length)
      throw new BadRequestException(
        'Não há conta de caixa cadastrada. Cadastre uma em Financeiro antes de emitir.',
      );
    if (ativas.length > 1)
      throw new BadRequestException('Escolha a conta de destino do valor recebido.');
    return ativas[0].id;
  }

  // -------------------------------------------------------------------------
  // Cancelamento
  // -------------------------------------------------------------------------

  /**
   * CANCELAR NÃO APAGA, e não devolve o número.
   *
   * O recibo cancelado continua na lista, com a tarja, o motivo e o nome de
   * quem cancelou — e o papel reimpresso sai carimbado CANCELADO. Numeração
   * com buraco é numeração que ninguém audita; numeração reaproveitada é pior,
   * porque dois documentos diferentes circulam com o mesmo número.
   *
   * A ENTRADA NO CAIXA NÃO É DESFEITA, de propósito: o dinheiro entrou. Se o
   * papel saiu errado, reemite-se a partir do mesmo lançamento — e é por isso
   * que a unicidade do lastro é um índice PARCIAL (`WHERE cancelado_em IS
   * NULL`) e não um `@unique` de coluna: com o único simples, a reemissão
   * morria com erro de banco, que foi o 500 encontrado na conferência de
   * 06/10/2026. Se o pagamento foi estornado, quem desfaz é o financeiro.
   */
  async cancelar(id: string, dto: CancelarReciboDto, ctx: Ctx) {
    const r = await this.prisma.recibo.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Recibo não encontrado.');
    if (r.canceladoEm) throw new BadRequestException('Este recibo já está cancelado.');

    await this.prisma.recibo.update({
      where: { id },
      data: {
        canceladoEm: new Date(),
        canceladoPor: ctx.userId ?? null,
        canceladoMotivo: dto.motivo.trim(),
      },
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Recibo',
      entidadeId: id,
      descricao: `Cancelou o recibo ${codigoDoRecibo(r.numero, r.exercicio)}: ${dto.motivo.trim()}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { valor: Number(r.valor), pagador: r.pagadorNome },
    });

    return this.obter(id);
  }
}
