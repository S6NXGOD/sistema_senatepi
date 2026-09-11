import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AcaoAuditoria, OrigemDaLigacao, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { tenant } from '../../tenant/tenant.config';
import { chaveDeEnte, siglaDeUF } from './chave-de-ente.util';
import {
  avisoDoCalendario,
  comparavel,
  folgaAtePrudencial,
  mediana,
  oQueIssoSignifica,
  situacaoFiscal,
} from './leitura-fiscal.util';
import {
  coberturaDoCadastro,
  ondeAtuamos,
  presencaPorEnte,
  PRESENCA_VAZIA,
  type Presenca,
} from './presenca.util';
import {
  ESCOPOS,
  FILTROS_DE_SITUACAO,
  montarLista,
  ORDENS,
  type Escopo,
  type FiltroDeSituacao,
  type LeituraDaLista,
  type Ordem,
  type SaudeDaLista,
} from './lista-de-entes.util';
import { sugerirMunicipios } from './sugestoes-de-cidade.util';

/**
 * CONTAS PÚBLICAS — o catálogo do IBGE cruzado com o Tesouro e com a base do
 * próprio sindicato.
 *
 * A tela existe por uma razão prática: quase toda contraparte do sindicato é um
 * ente público. Ele emprega o filiado, ele é o réu no processo, e é com ele que
 * se senta para negociar. A primeira coisa que ele diz na mesa é "a Lei de
 * Responsabilidade Fiscal não deixa" — e aqui dá para conferir antes.
 *
 * (A rota e o módulo continuam `municipios`: URL e chave de permissão são
 * identificadores, não texto. O nome que as pessoas leem é outro.)
 */

/** Quantos itens uma página traz por padrão — o mesmo teto de Filiados. */
const PAGINA_PADRAO = 25;
const PAGINA_MAXIMA = 100;

/**
 * A UNIÃO NÃO É LIDA POR ESTA INTEGRAÇÃO — e a ficha não pode dizer que ela
 * "não publicou". Ver `destaques`.
 */
const EXPLICACAO_DA_UNIAO =
  'Esta integração não lê a LRF da União: o relatório dela vem aberto por órgão, num formato diferente do de estados e municípios. Nada aqui afirma se ela publicou ou não.';

/** O catálogo de municípios muda quando o IBGE cria um — uma hora de cache sobra. */
const CATALOGO_VALE_MS = 3_600_000;

/**
 * ABAIXO DISTO, A MEDIANA É ANEDOTA. Com três municípios, "a mediana do
 * Piauí" é o do meio dos três — e a frase soaria como estatística do estado.
 */
const MINIMO_NA_UF = 5;
const MINIMO_NA_REGIAO = 4;

export interface FiltrosMunicipio {
  escopo?: string;
  busca?: string;
  uf?: string;
  situacao?: string;
  ordem?: string;
  /** Legado da tela anterior — ver `escopoPedido` e `situacaoPedida`. */
  soComVinculo?: boolean;
  soAcimaDoLimite?: boolean;
  esfera?: string;
  page?: number;
  pageSize?: number;
}

type LeituraCompleta = LeituraDaLista & {
  despesaPessoal: number | null;
  receitaCorrenteLiquida: number | null;
  atualizadoEm: Date;
};

/** `Decimal` do Prisma vira number — a tela não sabe lidar com o objeto. */
function dec(v: Prisma.Decimal | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * O RECORTE PEDIDO. A tela anterior mandava `soComVinculo=true` e nada mais;
 * durante a janela de troca do deploy ela ainda pode chegar, e cai no padrão,
 * que é o mesmo recorte.
 */
function escopoPedido(f: FiltrosMunicipio): Escopo {
  return (ESCOPOS as readonly string[]).includes(f.escopo ?? '') ? (f.escopo as Escopo) : 'atuacao';
}

function situacaoPedida(f: FiltrosMunicipio): FiltroDeSituacao | null {
  if ((FILTROS_DE_SITUACAO as readonly string[]).includes(f.situacao ?? '')) {
    return f.situacao as FiltroDeSituacao;
  }
  return f.soAcimaDoLimite ? 'impedidos' : null;
}

@Injectable()
export class MunicipiosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get ufDaCasa(): string {
    return (tenant.endereco?.uf ?? '').toUpperCase();
  }

  /**
   * O CATÁLOGO FIXO, EM MEMÓRIA — nome, UF, chave de busca e região dos 5.571
   * municípios. É o que a lista lê a cada tecla da busca, e ele não muda de
   * uma consulta para a outra. O que muda (quando o Tesouro foi consultado e a
   * população que veio com ele) é lido à parte, fresco, e são algumas centenas
   * de linhas.
   *
   * Catálogo vazio NÃO entra no cache: a carga do IBGE roda em segundo plano
   * na subida, e uma lista pedida antes dela terminar ficaria vazia por uma
   * hora.
   */
  private catalogo: {
    em: number;
    entes: Array<{ codigo: number; nome: string; uf: string; nomeNormalizado: string; regiaoImediata: string | null }>;
  } | null = null;

  private async catalogoMunicipal() {
    const agora = Date.now();
    if (this.catalogo && agora - this.catalogo.em < CATALOGO_VALE_MS) return this.catalogo.entes;
    const entes = await this.prisma.ente.findMany({
      where: { esfera: 'M' },
      select: { codigo: true, nome: true, uf: true, nomeNormalizado: true, regiaoImediata: true },
    });
    if (entes.length) this.catalogo = { em: agora, entes };
    return entes;
  }

  /**
   * A VARREDURA JÁ PASSOU POR AQUI? — sem isto, "0 filiados" é uma mentira.
   *
   * Enquanto o casamento não roda, TODO contador de filiado e de organização
   * dá zero. Zero por não ter e zero por não ter perguntado são coisas
   * diferentes, e só uma delas é culpa de alguém.
   */
  private async ligacaoJaRodou(): Promise<boolean> {
    const [f, o] = await Promise.all([
      this.prisma.filiado.count({ where: { municipioOrigem: { not: null } } }),
      this.prisma.parteExterna.count({ where: { enteOrigem: { not: null } } }),
    ]);
    return f + o > 0;
  }

  /**
   * OS MUNICÍPIOS DE UMA UF, só código e nome — a lista que alimenta o seletor
   * de cidade dos formulários.
   *
   * Rota própria, e não a listagem paginada: o Piauí tem 224 municípios e a
   * paginação tem teto de 100. Um seletor que só enxerga os cem primeiros
   * esconde o resto do alfabeto sem avisar.
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
   * Quem vai dizer que o Hospital Getúlio Vargas é do Estado do Piauí precisa
   * achar o Estado digitando "piaui". União e Estado vêm antes dos municípios:
   * são 28 contra 5.571, e quem digita "piaui" quase sempre quer o governo
   * estadual, não um dos oito municípios cujo nome contém a palavra.
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

  /**
   * A LISTA — só municípios. Estado e União têm bloco próprio (`destaques`):
   * misturados na ordem alfabética, "Piauí" cairia entre "Picos" e
   * "Pimenteiras", onde ninguém procuraria um governo estadual.
   *
   * As decisões (recorte, situação, ordem, contagens) moram em
   * `lista-de-entes.util.ts`, sem banco, onde o teste as cobra.
   */
  async listar(f: FiltrosMunicipio) {
    const page = Math.max(1, Number(f.page) || 1);
    const pageSize = Math.min(PAGINA_MAXIMA, Math.max(1, Number(f.pageSize) || PAGINA_PADRAO));
    const escopo = escopoPedido(f);
    const ordem: Ordem = (ORDENS as readonly string[]).includes(f.ordem ?? '')
      ? (f.ordem as Ordem)
      : 'presenca';

    const [catalogo, carimbos, pessoal, saude, presenca] = await Promise.all([
      this.catalogoMunicipal(),
      this.prisma.ente.findMany({
        where: {
          esfera: 'M',
          OR: [{ siconfiConsultadoEm: { not: null } }, { populacao: { not: null } }],
        },
        select: { codigo: true, siconfiConsultadoEm: true, populacao: true },
      }),
      this.ultimosPessoal(),
      this.ultimosSaude(),
      presencaPorEnte(this.prisma),
    ]);
    const frescos = new Map(carimbos.map((c) => [c.codigo, c]));
    const entes = catalogo.map((e) => ({
      ...e,
      populacao: frescos.get(e.codigo)?.populacao ?? null,
      siconfiConsultadoEm: frescos.get(e.codigo)?.siconfiConsultadoEm ?? null,
    }));

    return montarLista({
      entes,
      pessoal,
      saude,
      presenca,
      atuacao: ondeAtuamos(presenca),
      ufDaCasa: this.ufDaCasa,
      filtros: {
        escopo,
        busca: f.busca,
        uf: escopo === 'brasil' ? siglaDeUF(f.uf) : null,
        situacao: situacaoPedida(f),
        ordem,
        page,
        pageSize,
      },
    });
  }

  /**
   * A FICHA — identidade do IBGE, contas do Tesouro e a presença do sindicato,
   * numa resposta só. São as perguntas que se fazem juntas antes de uma mesa:
   * pode dar aumento, quanto cabe, como está perto dos vizinhos, e o que temos
   * lá.
   */
  async detalhe(codigo: number) {
    const m = await this.prisma.ente.findUnique({ where: { codigo } });
    if (!m) throw new NotFoundException('Ente não encontrado no catálogo do IBGE.');

    const [seriePessoal, serieSaude, presencas, organizacoes, jaRodou, cobertura, comparacao, semGoverno] =
      await Promise.all([
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
        presencaPorEnte(this.prisma),
        this.prisma.parteExterna.findMany({
          where: { enteCodigo: codigo, ativo: true },
          select: { id: true, nome: true, nomeFantasia: true, tipo: true, institucional: true },
          orderBy: { nome: 'asc' },
          take: 50,
        }),
        this.ligacaoJaRodou(),
        coberturaDoCadastro(this.prisma),
        m.esfera === 'M' ? this.comparacao(m.uf, m.regiaoImediata) : Promise.resolve(null),
        m.esfera !== 'M' ? this.orgaosPublicosSemGoverno() : Promise.resolve(null),
      ]);

    const ehUniao = m.esfera === 'U';
    const p = !ehUniao && seriePessoal[0] ? this.leitura(seriePessoal[0]) : null;
    const s = ehUniao ? 'NAO_CONSULTADO' : situacaoFiscal(p, m.siconfiConsultadoEm);
    const presenca: Presenca = { ...(presencas.get(codigo) ?? PRESENCA_VAZIA) };

    /*
      QUEM PAGA O HGV? Enquanto os órgãos públicos do cadastro não disserem de
      qual governo são, "trabalham para o Estado" fica baixo por falta de
      cadastro, não de gente. A ficha do Estado diz isso, com os nomes — um
      aviso sem exemplo não é lido. O total vem de uma contagem própria: os
      exemplos saem de uma lista com teto.
    */
    const exemplos = (semGoverno?.itens ?? [])
      .filter((o) => o.filiados > 0)
      .slice(0, 3)
      .map((o) => o.nome);

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
      foraDaUF: m.uf !== this.ufDaCasa,
      fiscal: p
        ? {
            situacao: s,
            explicacao: oQueIssoSignifica(s),
            percentualRcl: p.percentualRcl,
            limiteMaximo: p.limiteMaximo,
            limitePrudencial: p.limitePrudencial,
            limiteAlerta: p.limiteAlerta,
            despesaPessoal: p.despesaPessoal,
            receitaCorrenteLiquida: p.receitaCorrenteLiquida,
            exercicio: p.exercicio,
            quadrimestre: p.quadrimestre,
            atualizadoEm: p.atualizadoEm,
            folga: folgaAtePrudencial(p, s),
          }
        : { situacao: s, explicacao: ehUniao ? EXPLICACAO_DA_UNIAO : oQueIssoSignifica(s) },
      /** O que os limites não dizem: fim de mandato e ano de eleição. */
      calendario: avisoDoCalendario(m.esfera, new Date()),
      comparacao,
      seriePessoal: seriePessoal.map((i) => {
        const l = this.leitura(i);
        return {
          exercicio: i.exercicio,
          quadrimestre: i.quadrimestre,
          percentualRcl: l.percentualRcl,
          situacao: situacaoFiscal(l, i.updatedAt),
        };
      }),
      saude: this.mapSaude(serieSaude[0]),
      /**
       * A DESPESA DE SAÚDE POR HABITANTE só existe quando há população — e é
       * ela que permite comparar dois municípios de portes diferentes. Sem
       * população o campo não vai: "R$ 0,00 por habitante" seria pior que nada.
       */
      saudePorHabitante:
        serieSaude[0]?.despesaLiquidada && m.populacao
          ? Number(serieSaude[0].despesaLiquidada) / m.populacao
          : null,
      serieSaude: serieSaude.map((i) => ({
        exercicio: i.exercicio,
        bimestre: i.bimestre,
        percentualDespesa: dec(i.percentualDespesa),
      })),
      presenca,
      /** Compatibilidade com a tela anterior na janela de troca — ver `LinhaDaLista`. */
      vinculos: {
        filiados: m.esfera === 'M' ? presenca.moram : presenca.trabalham,
        organizacoes: presenca.organizacoes,
        processos: presenca.acoesContra,
      },
      contagemPorUF: false,
      ligacaoJaRodou: jaRodou,
      cobertura,
      orgaosPublicosSemGoverno:
        m.esfera === 'M' ? null : { total: semGoverno?.comFiliados ?? 0, exemplos },
      organizacoes,
      fonte: {
        catalogo: 'IBGE — Localidades',
        indicadores: 'SICONFI / Tesouro Nacional (RGF Anexo 01 e RREO Anexo 02)',
      },
    };
  }

  /**
   * COMO ESTÁ PERTO DOS VIZINHOS — a mediana do estado e da região imediata.
   *
   * "Teresina gasta 43,29% com pessoal" vira argumento quando se sabe que a
   * mediana do Piauí é 46%: a capital está MAIS folgada que o município típico
   * do estado. Sem a comparação, o número fica solto na mesa.
   *
   * Entra o último relatório de cada município, só de declaração que fecha
   * (ver `comparavel`), e a tela sempre diz QUANTOS entraram.
   */
  private async comparacao(uf: string, regiao: string | null) {
    const linhas = await this.prisma.indicadorPessoalEnte.findMany({
      where: { ente: { uf, esfera: 'M' } },
      orderBy: [{ exercicio: 'desc' }, { quadrimestre: 'desc' }],
      select: {
        enteCodigo: true,
        percentualRcl: true,
        limiteMaximo: true,
        limitePrudencial: true,
        limiteAlerta: true,
        ente: { select: { regiaoImediata: true } },
      },
    });
    const vistos = new Set<number>();
    const naUF: number[] = [];
    const naRegiao: number[] = [];
    for (const l of linhas) {
      if (vistos.has(l.enteCodigo)) continue;
      vistos.add(l.enteCodigo);
      const leitura = {
        percentualRcl: dec(l.percentualRcl),
        limiteMaximo: dec(l.limiteMaximo),
        limitePrudencial: dec(l.limitePrudencial),
        limiteAlerta: dec(l.limiteAlerta),
      };
      if (!comparavel(leitura)) continue;
      naUF.push(leitura.percentualRcl as number);
      if (regiao && l.ente.regiaoImediata === regiao) naRegiao.push(leitura.percentualRcl as number);
    }
    return {
      uf: naUF.length >= MINIMO_NA_UF ? { uf, mediana: mediana(naUF), n: naUF.length } : null,
      regiao:
        regiao && naRegiao.length >= MINIMO_NA_REGIAO
          ? { nome: regiao, mediana: mediana(naRegiao), n: naRegiao.length }
          : null,
    };
  }

  /**
   * O GOVERNO DO ESTADO DA CASA — o único ente que não é município com bloco
   * próprio na tela.
   *
   * O Estado do Piauí é contraparte permanente do sindicato: emprega gente nossa
   * (SESAPI, e hospitais como o HGV quando o cadastro disser que são dele) e é
   * réu em 8 ações. Os limites dele também são OUTROS: teto de 49% da receita
   * contra 54% do municipal — por isso o bloco é separado e diz o teto.
   *
   * A UNIÃO SAIU, e por um motivo que não é de gosto: a tela dizia que ela "não
   * publicou o Relatório de Gestão Fiscal" — acusação falsa. Conferido no
   * Tesouro em 11/09/2026: o RGF da União existe (632 linhas no 3º
   * quadrimestre de 2025), mas vem aberto por órgão, com outras contas e o
   * percentual em outra escala, e esta integração lê o formato de estados e
   * municípios. Para um sindicato que negocia com prefeituras e com o Estado, a
   * LRF da União não muda conversa nenhuma; mostrá-la errada muda.
   */
  async destaques() {
    const entes = await this.prisma.ente.findMany({
      where: { esfera: 'E', uf: this.ufDaCasa },
    });
    if (!entes.length) return [];

    const codigos = entes.map((e) => e.codigo);
    const [pessoal, saude, presencas, jaRodou] = await Promise.all([
      this.ultimosPessoal(codigos),
      this.ultimosSaude(codigos),
      presencaPorEnte(this.prisma),
      this.ligacaoJaRodou(),
    ]);

    return entes.map((m) => {
      const p = pessoal.get(m.codigo) ?? null;
      const situacao = situacaoFiscal(p, m.siconfiConsultadoEm);
      const presenca: Presenca = { ...(presencas.get(m.codigo) ?? PRESENCA_VAZIA) };
      return {
        codigo: m.codigo,
        nome: m.nome,
        uf: m.uf,
        esfera: m.esfera,
        consultadoEm: m.siconfiConsultadoEm,
        regiaoImediata: null,
        populacao: m.populacao,
        foraDaUF: false,
        fiscal: p
          ? {
              situacao,
              percentualRcl: p.percentualRcl,
              limiteMaximo: p.limiteMaximo,
              limitePrudencial: p.limitePrudencial,
              exercicio: p.exercicio,
              quadrimestre: p.quadrimestre,
            }
          : { situacao },
        saude: saude.get(m.codigo) ?? null,
        presenca,
        vinculos: {
          filiados: presenca.trabalham,
          organizacoes: presenca.organizacoes,
          processos: presenca.acoesContra,
        },
        contagemPorUF: false,
        ligacaoJaRodou: jaRodou,
        /** O cartão do Estado avisa quando o calendário manda mais que o percentual. */
        calendario: avisoDoCalendario(m.esfera, new Date()),
      };
    });
  }

  /**
   * O QUE O SISTEMA NÃO CONSEGUIU LIGAR SOZINHO — e um jeito de resolver com um
   * clique cada.
   *
   * Existe porque a alternativa seria fingir que casou tudo. Medido na produção
   * em 11/09/2026: 43 filiados em 16 grafias que o catálogo não reconhece, e 6
   * órgãos públicos com filiados (HGV, Instituto Natan Portella, HUT...) que
   * não dizem de qual governo são.
   */
  async pendencias() {
    /*
      "AINDA NÃO RODOU" NÃO É "NÃO BATE". Antes do primeiro casamento, todo
      filiado está sem município e toda organização sem ente — anunciar isso
      como defeito do cadastro seria o sistema acusando alguém de uma falha dele.
    */
    const jaRodou = await this.ligacaoJaRodou();

    const [semMunicipio, porPreferencia, orgsSemEnte, totalComCidade, semGoverno, cobertura, [semResolver]] =
      await Promise.all([
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
        this.orgaosPublicosSemGoverno(),
        coberturaDoCadastro(this.prisma),
        /*
          O TOTAL, e não a soma da lista: a lista tem teto de 40 grafias, e a
          faixa "43 filiados com cidade que o sistema não reconheceu" não pode
          depender de caberem todas.
        */
        this.prisma.$queryRaw<Array<{ n: number }>>`
          SELECT COUNT(*)::int AS n
            FROM filiados
           WHERE municipio_codigo IS NULL
             AND cidade IS NOT NULL
             AND btrim(cidade) <> ''`,
      ]);

    /* Cidade em branco não é grafia a resolver — é cadastro sem cidade, contado à parte. */
    const grupos = jaRodou ? semMunicipio.filter((g) => (g.cidade ?? '').trim() !== '') : [];
    const catalogo = grupos.length
      ? await this.prisma.ente.findMany({
          where: { esfera: 'M' },
          select: { codigo: true, nome: true, uf: true, nomeNormalizado: true },
        })
      : [];

    return {
      ufDaCasa: this.ufDaCasa,
      /** Falso = o botão "Ligar cadastros" nunca foi usado. A tela avisa isso, e não acusa o cadastro. */
      jaRodou,
      totalComCidade,
      totalSemMunicipio: jaRodou ? Number(semResolver?.n ?? 0) : 0,
      filiadosSemMunicipio: grupos.map((g) => ({
        cidade: g.cidade,
        estado: g.estado,
        quantos: g._count._all,
        sugestoes: sugerirMunicipios(g.cidade, g.estado, catalogo, this.ufDaCasa),
      })),
      ligadosPorPreferencia: porPreferencia.map((g) => ({
        cidade: g.cidade,
        estado: g.estado,
        quantos: g._count._all,
      })),
      organizacoesSemMunicipio: jaRodou ? orgsSemEnte : 0,
      orgaosSemGoverno: jaRodou ? semGoverno : { total: 0, comFiliados: 0, itens: [] },
      cobertura,
    };
  }

  /**
   * ÓRGÃOS PÚBLICOS SEM GOVERNO — o recorte é o TIPO que o próprio cadastro
   * declarou (ORGAO_PUBLICO), não um palpite pelo nome.
   *
   * Palpite pelo nome traria "Fundação Municipal de Saúde" e deixaria de fora o
   * HGV; e cobrar que alguém diga o governo de uma clínica privada faria o
   * aviso nunca sumir, que é o jeito mais rápido de ensinar a ignorá-lo.
   */
  private async orgaosPublicosSemGoverno() {
    const [itens, total, [comFiliados]] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; nome: string; filiados: number }>>`
        SELECT pe.id,
               COALESCE(NULLIF(btrim(pe.nome_fantasia), ''), pe.nome) AS nome,
               (COUNT(DISTINCT f.id) FILTER (WHERE f.situacao = 'ATIVO'))::int AS filiados
          FROM partes_externas pe
          LEFT JOIN vinculos_profissionais v ON v.parte_externa_id = pe.id
          LEFT JOIN filiados f ON f.id = v.filiado_id
         WHERE pe.tipo = 'ORGAO_PUBLICO'
           AND pe.ente_codigo IS NULL
           AND pe.ativo
         GROUP BY pe.id
         ORDER BY 3 DESC, 2 ASC
         LIMIT 12`,
      this.prisma.parteExterna.count({
        where: { tipo: 'ORGAO_PUBLICO', enteCodigo: null, ativo: true },
      }),
      /* Contagem própria — a lista acima tem teto, e contar dentro dela mentiria acima de doze. */
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n
          FROM partes_externas pe
         WHERE pe.tipo = 'ORGAO_PUBLICO'
           AND pe.ente_codigo IS NULL
           AND pe.ativo
           AND EXISTS (
             SELECT 1
               FROM vinculos_profissionais v
               JOIN filiados f ON f.id = v.filiado_id
              WHERE v.parte_externa_id = pe.id
                AND f.situacao = 'ATIVO'
           )`,
    ]);
    return {
      total,
      comFiliados: Number(comFiliados?.n ?? 0),
      itens: itens.map((i) => ({ id: i.id, nome: i.nome, filiados: Number(i.filiados) })),
    };
  }

  /**
   * LIGAR UMA GRAFIA A UM MUNICÍPIO — "Monte Alegre" é Monte Alegre do Piauí.
   *
   * ESCREVE SÓ OS DOIS CAMPOS DERIVADOS, `municipio_codigo` e
   * `municipio_origem`. O texto que a pessoa digitou no cadastro fica como
   * está: quem tem EDITAR em Contas Públicas não ganha, por esta porta, o
   * direito de reescrever o endereço de um filiado. É o mesmo contrato de
   * "Ligar cadastros".
   *
   * SÓ QUEM AINDA NÃO TEM MUNICÍPIO. Filiado com a mesma grafia que alguém já
   * ligou à mão (ou que o casamento resolveu) não é tocado — a pendência é
   * sobre o que sobrou.
   *
   * MANUAL, e a partir daí nenhuma varredura desfaz.
   */
  async ligarCidade(
    dto: { cidade: string; estado?: string | null; codigo: number },
    userId?: string,
  ) {
    const ente = await this.prisma.ente.findUnique({
      where: { codigo: dto.codigo },
      select: { codigo: true, nome: true, uf: true, esfera: true },
    });
    if (!ente || ente.esfera !== 'M') {
      throw new BadRequestException(
        'Escolha um município do catálogo do IBGE — filiado mora em município, não em Estado.',
      );
    }
    const estado = dto.estado ?? null;
    const r = await this.prisma.filiado.updateMany({
      where: { cidade: dto.cidade, estado, municipioCodigo: null },
      data: { municipioCodigo: ente.codigo, municipioOrigem: OrigemDaLigacao.MANUAL },
    });
    const grafia = `${dto.cidade}${estado ? '/' + estado : ''}`;
    await this.audit.registrar({
      userId: userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      descricao: `Ligou ${r.count} filiado(s) com a cidade escrita "${grafia}" ao município ${ente.nome}/${ente.uf}`,
      metadata: { cidade: dto.cidade, estado, municipio: ente.codigo, ligados: r.count },
    });
    return { ligados: r.count, municipio: { codigo: ente.codigo, nome: ente.nome, uf: ente.uf } };
  }

  /**
   * DIZER DE QUAL GOVERNO É UMA ORGANIZAÇÃO — o HGV é do Estado do Piauí.
   *
   * O mesmo que o seletor de ente faz no cadastro de Organizações, trazido
   * para onde a falta aparece. E pelo mesmo contrato de `ligarCidade`: grava só
   * `ente_codigo` e `ente_origem`, nunca nome, documento ou endereço.
   */
  async ligarOrganizacao(dto: { parteExternaId: string; enteCodigo: number }, userId?: string) {
    const [org, ente] = await Promise.all([
      this.prisma.parteExterna.findUnique({
        where: { id: dto.parteExternaId },
        select: { id: true, nome: true, ativo: true },
      }),
      this.prisma.ente.findUnique({
        where: { codigo: dto.enteCodigo },
        select: { codigo: true, nome: true, uf: true, esfera: true },
      }),
    ]);
    if (!org || !org.ativo) throw new NotFoundException('Organização não encontrada.');
    if (!ente) throw new BadRequestException('Ente não encontrado no catálogo.');

    /*
      SÓ QUEM AINDA NÃO TEM GOVERNO — a condição vai no próprio UPDATE.

      Esta porta existe para resolver a PENDÊNCIA. Sem a condição, ela
      trocaria o governo que alguém escolheu à mão em Organizações — e com uma
      matriz em que a pessoa edita Contas Públicas mas não Organizações, seria
      uma escrita no cadastro de organização por uma porta lateral. Trocar um
      governo já dito é decisão do cadastro de Organizações.
    */
    const r = await this.prisma.parteExterna.updateMany({
      where: { id: org.id, ativo: true, enteCodigo: null },
      data: { enteCodigo: ente.codigo, enteOrigem: OrigemDaLigacao.MANUAL },
    });
    if (!r.count) {
      throw new ConflictException(
        'Esta organização já tem governo definido. Para trocar, use o cadastro de Organizações.',
      );
    }
    const quem =
      ente.esfera === 'M'
        ? `Município de ${ente.nome}/${ente.uf}`
        : ente.esfera === 'E'
          ? `Governo do Estado — ${ente.nome}`
          : ente.nome;
    await this.audit.registrar({
      userId: userId ?? null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'ParteExterna',
      entidadeId: org.id,
      descricao: `Disse que "${org.nome}" responde ao ${quem}`,
      metadata: { ente: ente.codigo },
    });
    return { id: org.id, ente: { codigo: ente.codigo, nome: ente.nome, uf: ente.uf, esfera: ente.esfera } };
  }

  // ------------------------------------------------------------------ apoio

  /** O último relatório de pessoal de cada ente (de todos, se não houver lista). */
  private async ultimosPessoal(codigos?: number[]) {
    const todos = await this.prisma.indicadorPessoalEnte.findMany({
      where: codigos ? { enteCodigo: { in: codigos } } : undefined,
      orderBy: [{ exercicio: 'desc' }, { quadrimestre: 'desc' }],
    });
    const m = new Map<number, LeituraCompleta>();
    for (const i of todos) if (!m.has(i.enteCodigo)) m.set(i.enteCodigo, this.leitura(i));
    return m;
  }

  private async ultimosSaude(codigos?: number[]) {
    const todos = await this.prisma.indicadorSaudeEnte.findMany({
      where: codigos ? { enteCodigo: { in: codigos } } : undefined,
      orderBy: [{ exercicio: 'desc' }, { bimestre: 'desc' }],
    });
    const m = new Map<number, SaudeDaLista>();
    for (const i of todos) {
      if (!m.has(i.enteCodigo)) m.set(i.enteCodigo, this.mapSaude(i) as SaudeDaLista);
    }
    return m;
  }

  /**
   * O CLASSIFICADOR NÃO CONHECE O PRISMA — e é de propósito. A regra da LRF em
   * `leitura-fiscal.util.ts` é aritmética pura, testável sem banco; aqui o
   * `Decimal` vira número antes de chegar nela.
   */
  private leitura(i: Prisma.IndicadorPessoalEnteGetPayload<object>): LeituraCompleta {
    return {
      percentualRcl: dec(i.percentualRcl),
      limiteMaximo: dec(i.limiteMaximo),
      limitePrudencial: dec(i.limitePrudencial),
      limiteAlerta: dec(i.limiteAlerta),
      exercicio: i.exercicio,
      quadrimestre: i.quadrimestre,
      despesaPessoal: dec(i.despesaPessoal),
      receitaCorrenteLiquida: dec(i.receitaCorrenteLiquida),
      atualizadoEm: i.updatedAt,
    };
  }

  private mapSaude(
    i?: {
      exercicio: number;
      bimestre: number;
      percentualDespesa: Prisma.Decimal | null;
      despesaLiquidada: Prisma.Decimal | null;
    } | null,
  ): SaudeDaLista | null {
    if (!i) return null;
    return {
      exercicio: i.exercicio,
      bimestre: i.bimestre,
      percentualDespesa: dec(i.percentualDespesa),
      despesaLiquidada: dec(i.despesaLiquidada),
    };
  }
}
