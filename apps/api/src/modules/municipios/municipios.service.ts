import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { tenant } from '../../tenant/tenant.config';
import { chaveDeEnte, siglaDeUF } from './chave-de-ente.util';
import {
  situacaoFiscal,
  oQueIssoSignifica,
  PESO_SITUACAO,
  SituacaoFiscal,
} from './leitura-fiscal.util';

/**
 * MUNICÍPIOS — o catálogo do IBGE cruzado com a base do próprio sindicato.
 *
 * A tela existe por uma razão prática: quase toda contraparte do sindicato é um
 * município. Ele emprega o filiado, ele é o réu no processo, e é com ele que se
 * senta para negociar. Até agora o sistema sabia o nome dessa contraparte como
 * texto digitado; agora sabe QUEM é, e o que o Tesouro diz sobre as contas dela.
 */

/** Quantos itens uma página traz por padrão — o mesmo teto de Filiados. */
const PAGINA_PADRAO = 25;
const PAGINA_MAXIMA = 100;

export interface FiltrosMunicipio {
  /** 'M' (padrão), 'E' ou 'U'. Ver o comentário em `listar`. */
  esfera?: string;
  busca?: string;
  uf?: string;
  /** Só onde o sindicato tem filiado, organização ou processo. */
  soComVinculo?: boolean;
  /** Só quem está no prudencial ou acima — a lista de quem alega não poder pagar. */
  soAcimaDoLimite?: boolean;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class MunicipiosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * OS CÓDIGOS ONDE O SINDICATO ESTÁ. Uma consulta só, reaproveitada pela
   * listagem e pelo contador — se cada uma calculasse do seu jeito, o número do
   * chip e o número de linhas divergiriam, que é exatamente o defeito que já
   * apareceu nas filas de Processos.
   */
  /**
   * A VARREDURA JÁ PASSOU POR AQUI? — sem isto, "0 filiados" é uma mentira.
   *
   * Enquanto o casamento não roda, TODO contador de filiado e de organização
   * dá zero, e a ficha do Governo do Piauí dizia "0 filiados" havendo mais de
   * três mil no estado. Zero por não ter e zero por não ter perguntado são
   * coisas diferentes, e só uma delas é culpa de alguém.
   */
  private async ligacaoJaRodou(): Promise<boolean> {
    const [f, o] = await Promise.all([
      this.prisma.filiado.count({ where: { municipioOrigem: { not: null } } }),
      this.prisma.parteExterna.count({ where: { enteOrigem: { not: null } } }),
    ]);
    return f + o > 0;
  }

  private async codigosComVinculo(): Promise<number[]> {
    const [filiados, partes, processos] = await Promise.all([
      this.prisma.filiado.findMany({
        where: { municipioCodigo: { not: null } },
        select: { municipioCodigo: true },
        distinct: ['municipioCodigo'],
      }),
      this.prisma.parteExterna.findMany({
        where: { enteCodigo: { not: null } },
        select: { enteCodigo: true },
        distinct: ['enteCodigo'],
      }),
      this.prisma.processo.findMany({
        where: { municipioIBGE: { not: null } },
        select: { municipioIBGE: true },
        distinct: ['municipioIBGE'],
      }),
    ]);
    const s = new Set<number>();
    for (const f of filiados) if (f.municipioCodigo) s.add(f.municipioCodigo);
    for (const p of partes) if (p.enteCodigo) s.add(p.enteCodigo);
    for (const p of processos) if (p.municipioIBGE) s.add(p.municipioIBGE);
    return [...s];
  }

  /**
   * OS MUNICÍPIOS DE UMA UF, só código e nome — a lista que alimenta o seletor
   * de cidade dos formulários.
   *
   * Rota própria, e não a listagem paginada, por um motivo simples: o Piauí tem
   * 224 municípios e a paginação tem teto de 100. Um seletor que só enxerga os
   * cem primeiros esconde o resto do alfabeto sem avisar.
   *
   * Substitui a chamada que a tela fazia DIRETO ao IBGE do navegador. A troca
   * não é por desempenho: é que aquela chamada devolvia só o NOME, e nome não
   * identifica município no Brasil. Agora o formulário tem o código na mão.
   */
  async porUF(uf?: string) {
    const sigla = siglaDeUF(uf);
    if (!sigla) return [];
    return this.prisma.ente.findMany({
      where: { uf: sigla },
      select: { codigo: true, nome: true },
      orderBy: { nome: 'asc' },
    });
  }

  /**
   * BUSCA CURTA PARA SELETOR — atravessa as três esferas.
   *
   * A listagem paginada mostra só municípios de propósito (ver `listar`).
   * Um seletor precisa do contrário: quem vai dizer que o Hospital Getúlio
   * Vargas é do Estado do Piauí precisa achar o Estado digitando "piaui".
   *
   * Ordem: União e Estado antes dos municípios. São 28 contra 5.571, e quem
   * digita "piaui" quase sempre quer o governo estadual, não um dos oito
   * municípios cujo nome contém a palavra.
   */
  async buscar(termo?: string) {
    const chave = chaveDeEnte(termo);
    if (chave.length < 2) return [];
    return this.prisma.ente.findMany({
      where: { nomeNormalizado: { contains: chave } },
      select: { codigo: true, nome: true, uf: true, esfera: true },
      orderBy: [{ esfera: 'asc' }, { nome: 'asc' }],
      take: 20,
    });
  }

  async listar(f: FiltrosMunicipio) {
    const page = Math.max(1, Number(f.page) || 1);
    const pageSize = Math.min(PAGINA_MAXIMA, Math.max(1, Number(f.pageSize) || PAGINA_PADRAO));

    const where: Prisma.EnteWhereInput = {};
    const busca = chaveDeEnte(f.busca);
    if (busca) where.nomeNormalizado = { contains: busca };
    const uf = siglaDeUF(f.uf);
    if (uf) where.uf = uf;

    /*
      A LISTA É DE MUNICÍPIOS por padrão. O catálogo guarda também os 26
      estados, o Distrito Federal e a União — 28 linhas em 5.599 —, e eles
      aparecem no bloco de destaque, não misturados na paginação. Misturar
      colocaria "Piauí" entre "Picos" e "Pimenteiras" na ordem alfabética,
      onde ninguém procuraria um governo estadual.
    */
    where.esfera = f.esfera ?? 'M';

    let comVinculo: number[] | null = null;
    if (f.soComVinculo || f.soAcimaDoLimite) {
      comVinculo = await this.codigosComVinculo();
      if (f.soComVinculo) where.codigo = { in: comVinculo };
    }

    /*
      O FILTRO FISCAL não vira SQL. A situação depende de comparar o percentual
      com os limites que vieram na MESMA linha, e "acima do prudencial" não é uma
      coluna. Como o universo com indicador é pequeno — 72 municípios medidos na
      produção, contra 5.571 no catálogo —, ler esses e filtrar em memória é
      correto e legível. Fazer isto sobre o catálogo inteiro seria outra coisa, e
      é por isso que este ramo só existe junto com o recorte de vínculo.
    */
    if (f.soAcimaDoLimite) {
      const comIndicador = await this.ultimosPessoal(comVinculo ?? []);
      const acima = [...comIndicador.entries()]
        .filter(([, i]) => ['PRUDENCIAL', 'ACIMA_DO_TETO'].includes(situacaoFiscal(this.paraLeitura(i), i.updatedAt)))
        .map(([codigo]) => codigo);
      where.codigo = { in: acima };
    }

    const [total, itens] = await Promise.all([
      this.prisma.ente.count({ where }),
      this.prisma.ente.findMany({
        where,
        orderBy: [{ uf: 'asc' }, { nome: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const codigos = itens.map((m) => m.codigo);
    const [pessoal, saude, contagens] = await Promise.all([
      this.ultimosPessoal(codigos),
      this.ultimosSaude(codigos),
      this.contarVinculos(codigos),
    ]);

    const items = itens.map((m) => {
      const p = pessoal.get(m.codigo) ?? null;
      const s = situacaoFiscal(this.paraLeitura(p), m.siconfiConsultadoEm);
      return {
        codigo: m.codigo,
        nome: m.nome,
        uf: m.uf,
        esfera: m.esfera,
        consultadoEm: m.siconfiConsultadoEm,
        regiaoImediata: m.regiaoImediata,
        populacao: m.populacao,
        fiscal: p
          ? {
              situacao: s,
              percentualRcl: this.dec(p.percentualRcl),
              limiteMaximo: this.dec(p.limiteMaximo),
              limitePrudencial: this.dec(p.limitePrudencial),
              exercicio: p.exercicio,
              quadrimestre: p.quadrimestre,
            }
          : { situacao: (m.siconfiConsultadoEm ? 'SEM_DADO' : 'NAO_CONSULTADO') as SituacaoFiscal },
        saude: this.mapSaude(saude.get(m.codigo)),
        vinculos: contagens.get(m.codigo) ?? { filiados: 0, organizacoes: 0, processos: 0 },
      };
    });

    return { items, total, page, pageSize, totalPaginas: Math.ceil(total / pageSize) };
  }

  /**
   * A FICHA — identidade do IBGE, contas do Tesouro e a presença do sindicato,
   * numa resposta só. São três perguntas que sempre se fazem juntas antes de
   * uma audiência ou de uma mesa: quem é, como estão as contas, e o que temos lá.
   */
  async detalhe(codigo: number) {
    const m = await this.prisma.ente.findUnique({ where: { codigo } });
    if (!m) throw new NotFoundException('Município não encontrado no catálogo do IBGE.');

    const [seriePessoal, serieSaude, contagens, organizacoes] = await Promise.all([
      this.prisma.indicadorPessoalEnte.findMany({
        where: { enteCodigo: codigo },
        orderBy: [{ exercicio: 'desc' }, { quadrimestre: 'desc' }],
        take: 8,
      }),
      this.prisma.indicadorSaudeEnte.findMany({
        where: { enteCodigo: codigo },
        orderBy: [{ exercicio: 'desc' }, { bimestre: 'desc' }],
        take: 8,
      }),
      this.contarVinculos([codigo]),
      this.prisma.parteExterna.findMany({
        where: { enteCodigo: codigo, ativo: true },
        select: { id: true, nome: true, nomeFantasia: true, tipo: true, institucional: true },
        orderBy: { nome: 'asc' },
        take: 50,
      }),
    ]);

    const p = seriePessoal[0] ?? null;
    const s = situacaoFiscal(this.paraLeitura(p), m.siconfiConsultadoEm);

    return {
      codigo: m.codigo,
      nome: m.nome,
      uf: m.uf,
      esfera: m.esfera,
      consultadoEm: m.siconfiConsultadoEm,
      regiaoImediata: m.regiaoImediata,
      regiaoIntermediaria: m.regiaoIntermediaria,
      populacao: m.populacao,
      populacaoAno: m.populacaoAno,
      fiscal: p
        ? {
            situacao: s,
            explicacao: oQueIssoSignifica(s),
            percentualRcl: this.dec(p.percentualRcl),
            limiteMaximo: this.dec(p.limiteMaximo),
            limitePrudencial: this.dec(p.limitePrudencial),
            limiteAlerta: this.dec(p.limiteAlerta),
            despesaPessoal: this.dec(p.despesaPessoal),
            receitaCorrenteLiquida: this.dec(p.receitaCorrenteLiquida),
            exercicio: p.exercicio,
            quadrimestre: p.quadrimestre,
            atualizadoEm: p.updatedAt,
          }
        : {
            situacao: (m.siconfiConsultadoEm ? 'SEM_DADO' : 'NAO_CONSULTADO') as SituacaoFiscal,
            explicacao: oQueIssoSignifica(m.siconfiConsultadoEm ? 'SEM_DADO' : 'NAO_CONSULTADO'),
          },
      seriePessoal: seriePessoal.map((i) => ({
        exercicio: i.exercicio,
        quadrimestre: i.quadrimestre,
        percentualRcl: this.dec(i.percentualRcl),
        situacao: situacaoFiscal(this.paraLeitura(i), i.updatedAt),
      })),
      saude: this.mapSaude(serieSaude[0]),
      /**
       * A DESPESA DE SAÚDE POR HABITANTE só existe quando há população — e é ela
       * que permite comparar dois municípios de portes diferentes. Sem
       * população, o campo simplesmente não vai: um "R$ 0,00 por habitante"
       * seria pior que a ausência.
       */
      saudePorHabitante:
        serieSaude[0]?.despesaLiquidada && m.populacao
          ? Number(serieSaude[0].despesaLiquidada) / m.populacao
          : null,
      serieSaude: serieSaude.map((i) => ({
        exercicio: i.exercicio,
        bimestre: i.bimestre,
        percentualDespesa: this.dec(i.percentualDespesa),
      })),
      /*
        O ESTADO SE CONTA PELA UF INTEIRA. Filiado se liga a município e o
        processo carrega a comarca, que também é município: pela régua comum, a
        ficha do Governo do Piauí diria "0 filiados" — e há 2.639 só em Teresina.
      */
      vinculos:
        m.esfera === 'E'
          ? await this.presencaNaUF(m.uf, codigo)
          : (contagens.get(codigo) ?? { filiados: 0, organizacoes: 0, processos: 0 }),
      contagemPorUF: m.esfera === 'E',
      ligacaoJaRodou: await this.ligacaoJaRodou(),
      organizacoes,
      fonte: {
        catalogo: 'IBGE — Localidades',
        indicadores: 'SICONFI / Tesouro Nacional (RGF Anexo 01 e RREO Anexo 02)',
      },
    };
  }

  /**
   * OS ENTES QUE NÃO SÃO MUNICÍPIO — e por que eles têm bloco próprio.
   *
   * O Estado do Piauí é o SEGUNDO maior empregador do cadastro: 42 vínculos,
   * sendo 19 no Hospital Getúlio Vargas e 16 na SESAPI, e figura em 10
   * processos. Ele não é um item de uma lista de 5.571 — é uma das duas
   * contrapartes permanentes do sindicato.
   *
   * E os limites dele são OUTROS: o Executivo estadual tem teto de 49% da
   * receita corrente líquida, contra 54% do municipal (medido em 2026/Q1:
   * Governo do Piauí em 37,00%, com alerta 44,10 e prudencial 46,55). Quem
   * comparasse o percentual do Estado com o teto municipal concluiria o
   * contrário do que o número diz.
   */
  async destaques() {
    const ufDaCasa = (tenant.endereco?.uf ?? '').toUpperCase();
    const entes = await this.prisma.ente.findMany({
      where: { OR: [{ esfera: 'E', uf: ufDaCasa }, { esfera: 'U' }] },
      orderBy: { esfera: 'desc' },
    });
    if (!entes.length) return [];

    const codigos = entes.map((e) => e.codigo);
    const [pessoal, saude, contagens] = await Promise.all([
      this.ultimosPessoal(codigos),
      this.ultimosSaude(codigos),
      this.contarVinculos(codigos),
    ]);
    const jaRodou = await this.ligacaoJaRodou();
    /* O Estado se conta pela UF inteira; a União, pela ligação direta. */
    const naUF = new Map(
      await Promise.all(
        entes
          .filter((e) => e.esfera === 'E')
          .map(async (e) => [e.codigo, await this.presencaNaUF(e.uf, e.codigo)] as const),
      ),
    );

    return entes.map((m) => {
      const pp = pessoal.get(m.codigo) ?? null;
      return {
        codigo: m.codigo,
        nome: m.nome,
        uf: m.uf,
        esfera: m.esfera,
        consultadoEm: m.siconfiConsultadoEm,
        regiaoImediata: null,
        populacao: m.populacao,
        fiscal: pp
          ? {
              situacao: situacaoFiscal(this.paraLeitura(pp), m.siconfiConsultadoEm),
              percentualRcl: this.dec(pp.percentualRcl),
              limiteMaximo: this.dec(pp.limiteMaximo),
              limitePrudencial: this.dec(pp.limitePrudencial),
              exercicio: pp.exercicio,
              quadrimestre: pp.quadrimestre,
            }
          : { situacao: (m.siconfiConsultadoEm ? 'SEM_DADO' : 'NAO_CONSULTADO') as SituacaoFiscal },
        saude: this.mapSaude(saude.get(m.codigo)),
        vinculos:
          naUF.get(m.codigo) ??
          contagens.get(m.codigo) ?? { filiados: 0, organizacoes: 0, processos: 0 },
        /** Só o Estado conta pela UF — a tela precisa dizer isso ao lado do número. */
        contagemPorUF: naUF.has(m.codigo),
        ligacaoJaRodou: jaRodou,
      };
    });
  }

  /**
   * AS PENDÊNCIAS DE CONFERÊNCIA — o que a varredura NÃO conseguiu resolver, e
   * o que resolveu no degrau fraco.
   *
   * Existe porque a alternativa seria o sistema fingir que casou tudo. Medido na
   * produção: 20 filiados moram em "Monte Alegre", que existe no Pará e no Rio
   * Grande do Norte e NÃO existe no Piauí — nenhum algoritmo devia decidir isso
   * sozinho, e nenhuma tela devia esconder que ficou por decidir.
   */
  async pendencias() {
    /*
      "AINDA NÃO RODOU" NÃO É "NÃO BATE" — e a tela dizia a segunda coisa.

      A faixa amarela anunciava "3.016 filiados com cidade que não bate com o
      catálogo do IBGE: Teresina (2.138), TERESINA (186)...". Teresina bate,
      obviamente. O que havia era o casamento nunca ter sido executado: a
      consulta pedia `municipioCodigo: null`, e no primeiro dia isso é todo
      mundo. O sistema estava acusando o cadastro de um defeito que era dele.

      `jaRodou` é derivado, não uma flag guardada: se existe ao menos um
      registro com origem preenchida, a varredura já passou por aqui. Flag
      guardada envelheceria sozinha.
    */
    const [comOrigemFiliado, comOrigemOrg] = await Promise.all([
      this.prisma.filiado.count({ where: { municipioOrigem: { not: null } } }),
      this.prisma.parteExterna.count({ where: { enteOrigem: { not: null } } }),
    ]);
    const jaRodou = comOrigemFiliado + comOrigemOrg > 0;

    const [semMunicipio, porPreferencia, orgsSem, totalComCidade] = await Promise.all([
      this.prisma.filiado.groupBy({
        by: ['cidade', 'estado'],
        where: { municipioCodigo: null, cidade: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { cidade: 'desc' } },
        take: 40,
      }),
      this.prisma.filiado.groupBy({
        by: ['cidade', 'estado'],
        where: { municipioOrigem: 'PREFERENCIA_UF' },
        _count: { _all: true },
        orderBy: { _count: { cidade: 'desc' } },
        take: 20,
      }),
      this.prisma.parteExterna.count({ where: { enteCodigo: null, ativo: true } }),
      this.prisma.filiado.count({ where: { cidade: { not: null } } }),
    ]);

    return {
      ufDaCasa: (tenant.endereco?.uf ?? '').toUpperCase(),
      /** Falso = o botão "Ligar cadastros" nunca foi usado. A tela avisa isso, e não acusa o cadastro. */
      jaRodou,
      totalComCidade,
      filiadosSemMunicipio: jaRodou
        ? semMunicipio.map((g) => ({
            cidade: g.cidade,
            estado: g.estado,
            quantos: g._count._all,
          }))
        : [],
      ligadosPorPreferencia: porPreferencia.map((g) => ({
        cidade: g.cidade,
        estado: g.estado,
        quantos: g._count._all,
      })),
      organizacoesSemMunicipio: jaRodou ? orgsSem : 0,
    };
  }
  // ------------------------------------------------------------------ apoio

  private async ultimosPessoal(codigos: number[]) {
    if (!codigos.length) return new Map<number, Prisma.IndicadorPessoalEnteGetPayload<object>>();
    const todos = await this.prisma.indicadorPessoalEnte.findMany({
      where: { enteCodigo: { in: codigos } },
      orderBy: [{ exercicio: 'desc' }, { quadrimestre: 'desc' }],
    });
    const m = new Map<number, (typeof todos)[number]>();
    for (const i of todos) if (!m.has(i.enteCodigo)) m.set(i.enteCodigo, i);
    return m;
  }

  private async ultimosSaude(codigos: number[]) {
    if (!codigos.length) return new Map<number, Prisma.IndicadorSaudeEnteGetPayload<object>>();
    const todos = await this.prisma.indicadorSaudeEnte.findMany({
      where: { enteCodigo: { in: codigos } },
      orderBy: [{ exercicio: 'desc' }, { bimestre: 'desc' }],
    });
    const m = new Map<number, (typeof todos)[number]>();
    for (const i of todos) if (!m.has(i.enteCodigo)) m.set(i.enteCodigo, i);
    return m;
  }

  private async contarVinculos(codigos: number[]) {
    const vazio = new Map<number, { filiados: number; organizacoes: number; processos: number }>();
    if (!codigos.length) return vazio;
    const [filiados, orgs, processos] = await Promise.all([
      this.prisma.filiado.groupBy({
        by: ['municipioCodigo'],
        where: { municipioCodigo: { in: codigos } },
        _count: { _all: true },
      }),
      this.prisma.parteExterna.groupBy({
        by: ['enteCodigo'],
        where: { enteCodigo: { in: codigos }, ativo: true },
        _count: { _all: true },
      }),
      this.prisma.processo.groupBy({
        by: ['municipioIBGE'],
        where: { municipioIBGE: { in: codigos } },
        _count: { _all: true },
      }),
    ]);
    const pegar = (c: number) =>
      vazio.get(c) ?? { filiados: 0, organizacoes: 0, processos: 0 };
    for (const g of filiados)
      if (g.municipioCodigo)
        vazio.set(g.municipioCodigo, { ...pegar(g.municipioCodigo), filiados: g._count._all });
    for (const g of orgs)
      if (g.enteCodigo)
        vazio.set(g.enteCodigo, { ...pegar(g.enteCodigo), organizacoes: g._count._all });
    for (const g of processos)
      if (g.municipioIBGE) vazio.set(g.municipioIBGE, { ...pegar(g.municipioIBGE), processos: g._count._all });
    return vazio;
  }

  /**
   * A PRESENÇA DO SINDICATO NUM ENTE ESTADUAL — que não se conta do mesmo jeito.
   *
   * Filiado se liga a MUNICÍPIO, e processo carrega a comarca, que também é
   * município. Se o Estado do Piauí fosse contado pela mesma régua, a ficha dele
   * mostraria "0 filiados" — e há 2.639 só em Teresina. O que faz sentido para
   * um Estado é a soma do que existe na UF inteira.
   *
   * As organizações continuam contadas pela ligação direta: a Secretaria de
   * Estado da Saúde é do Estado, e o Hospital Getúlio Vargas — que não declara
   * ente no nome — não é atribuído a ninguém sem uma pessoa dizer.
   */
  private async presencaNaUF(uf: string, codigo: number) {
    /*
      `processos.municipio_ibge` é um inteiro solto, sem relação declarada — de
      propósito: ele guarda a COMARCA e tem código inválido dentro. Por isso a
      contagem passa pela lista de códigos da UF em vez de um join.
    */
    const daUF = await this.prisma.ente.findMany({
      where: { uf, esfera: 'M' },
      select: { codigo: true },
    });
    const codigos = daUF.map((e) => e.codigo);

    const [filiados, organizacoes, processos] = await Promise.all([
      this.prisma.filiado.count({ where: { municipioCodigo: { in: codigos } } }),
      this.prisma.parteExterna.count({ where: { enteCodigo: codigo, ativo: true } }),
      this.prisma.processo.count({ where: { municipioIBGE: { in: codigos } } }),
    ]);
    return { filiados, organizacoes, processos };
  }

  private mapSaude(i?: { exercicio: number; bimestre: number; percentualDespesa: Prisma.Decimal | null; despesaLiquidada: Prisma.Decimal | null } | null) {
    if (!i) return null;
    return {
      exercicio: i.exercicio,
      bimestre: i.bimestre,
      percentualDespesa: this.dec(i.percentualDespesa),
      despesaLiquidada: this.dec(i.despesaLiquidada),
    };
  }

  /**
   * O CLASSIFICADOR NÃO CONHECE O PRISMA — e é de propósito.
   *
   * `leitura-fiscal.util.ts` guarda a regra do art. 22 da LRF e o corte de
   * declaração impossível. Se ele importasse `Decimal`, a regra passaria a
   * depender do ORM e o teste dela precisaria de banco. Aqui o valor vira
   * número e a regra continua sendo aritmética pura.
   */
  private paraLeitura(i: {
    percentualRcl: Prisma.Decimal | null;
    limiteMaximo: Prisma.Decimal | null;
    limitePrudencial: Prisma.Decimal | null;
    limiteAlerta: Prisma.Decimal | null;
  } | null | undefined) {
    if (!i) return null;
    return {
      percentualRcl: this.dec(i.percentualRcl),
      limiteMaximo: this.dec(i.limiteMaximo),
      limitePrudencial: this.dec(i.limitePrudencial),
      limiteAlerta: this.dec(i.limiteAlerta),
    };
  }

  /** `Decimal` do Prisma vira number — a tela não sabe lidar com o objeto. */
  private dec(v: Prisma.Decimal | null | undefined): number | null {
    return v === null || v === undefined ? null : Number(v);
  }
}
