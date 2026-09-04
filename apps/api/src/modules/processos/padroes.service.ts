import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { tenant } from '../../tenant/tenant.config';

/**
 * PADRÕES NO ACERVO — o que só aparece olhando os processos JUNTOS.
 *
 * Um sindicato não litiga contra cento e vinte réus diferentes: litiga contra os
 * mesmos empregadores, sobre as mesmas coisas, de novo e de novo. Cada advogado
 * cuida do seu processo e faz isso bem; ninguém tem por ofício somar o acervo e
 * perguntar "isto aqui é o mesmo problema seis vezes?".
 *
 * O QUE ESTE SERVIÇO NÃO FAZ. Ele não recomenda, não prevê e não pontua. Toda
 * linha que ele produz é contagem verificável — quantos processos, contra quem,
 * sobre qual assunto, com qual desfecho carimbado pelo próprio tribunal. A
 * leitura jurídica é de quem lê. Um painel que dissesse "ajuíze uma coletiva"
 * estaria opinando sobre estratégia processual com base em três linhas de banco,
 * e na primeira vez que errasse ninguém olharia de novo.
 *
 * Medido na produção em 04/09/2026, e é o que fez o serviço existir:
 *
 *  - 6 ações INDIVIDUAIS sobre "Indenização Relacionada ao Exercício do Direito
 *    de Greve", contra dois empregadores (Unimed 3, Hapvida 3), com procedência
 *    parcial nas seis;
 *  - "Acordo e Convenção Coletivos de Trabalho" em 28 processos contra 13
 *    empregadores DIFERENTES — o oposto: não é um réu, é a categoria.
 */

/** Códigos TPU de julgamento. É o CNJ que os carimba; não inferimos desfecho. */
const PROCEDENCIA = 219;
const IMPROCEDENCIA = 220;
const PROCEDENCIA_PARCIAL = 221;

/**
 * ASSUNTOS QUE SÃO RITO, NÃO PEDIDO — e esta lista salvou a funcionalidade de
 * nascer mentindo.
 *
 * O primeiro resultado que este serviço produziu foi "3 processos contra a
 * FMS/THE sobre Assistência Judiciária Gratuita, os três improcedentes — a tese
 * não passa". Fui olhar os três: um discutia conversão em pecúnia, outro hora
 * extra, o terceiro irredutibilidade de vencimentos. Três pedidos diferentes. O
 * que eles tinham em comum era só a etiqueta do pedido de gratuidade, que o CNJ
 * marcou como assunto PRINCIPAL nos três.
 *
 * Etiqueta processual acompanha qualquer pedido, então ela cria padrão onde não
 * há. Estes treze códigos são de rito — gratuidade, honorários, ônus da prova,
 * liminar, nulidades de recurso — e ficam fora da detecção. Continuam visíveis
 * na ficha do processo; o que eles não fazem é fingir ser um padrão.
 *
 * FILTRA POR CÓDIGO, e não por nome: o nome vem do tribunal com espaço sobrando
 * ("Ônus da Prova ") e em duas grafias para o mesmo conceito (10655 e 12995,
 * ambos "Honorários Advocatícios"). O código é do CNJ e não muda.
 *
 * É uma decisão de domínio jurídico, não uma dedução do dado — está aqui, curta
 * e nomeada, para poder ser discutida e corrigida.
 */
const ASSUNTOS_DE_RITO = [
  8843, // Assistência Judiciária Gratuita
  8867, // Substituição Processual
  8934, // Valor da Causa
  9196, // Liminar
  10655, // Honorários Advocatícios
  12416, // Tutela de Urgência
  12995, // Honorários Advocatícios (segunda grafia)
  13089, // Cerceamento de Defesa
  13184, // Honorários na Justiça do Trabalho
  13201, // Inépcia da Inicial
  13233, // Negativa de Prestação Jurisdicional
  13237, // Ônus da Prova
  14046, // Prescrição
];

/**
 * Pisos. Abaixo deles não é padrão, é coincidência — a mesma régua do bloco
 * "Contra quem litigamos" no painel.
 */
const MINIMO_CONCENTRACAO = 3;
/** Um pedido só vira "recorrente" quando se repete — abaixo disso é o caso. */
const MINIMO_PEDIDO_RECORRENTE = 3;
/**
 * Dispersão exige mais réus que a intuição sugere. Com quatro, "Indenização por
 * Dano Moral" entrava na lista — dez processos contra QUATRO réus, oito deles do
 * mesmo empregador. Isso é concentração usando roupa de dispersão. Cinco réus e
 * seis processos separam as duas coisas no acervo real.
 */
const MINIMO_DISPERSAO_PROCESSOS = 6;
const MINIMO_DISPERSAO_ADVERSARIOS = 5;

/** Quantos julgamentos bastam para o desfecho repetido significar algo. */
const MINIMO_JULGADOS = 2;

export type LeituraConcentracao =
  | 'DESFECHO_SEMPRE_CONTRA'
  | 'DESFECHO_SEMPRE_A_FAVOR'
  | 'COLETIVA_POSSIVEL'
  | 'REINCIDENCIA';

export interface Desfechos {
  julgados: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
}

export interface PedidoRecorrente {
  assunto: string;
  processos: number;
}

export interface Concentracao extends Desfechos {
  parteExternaId: string;
  adversario: string;
  processos: number;
  individuais: number;
  desde: string | null;
  /** Os pedidos que se repetem em três ou mais das ações contra este réu. */
  pedidos: PedidoRecorrente[];
  /** Zero, uma ou duas leituras — nunca uma verdade única. Ver `lerConcentracao`. */
  leituras: LeituraConcentracao[];
}

export interface PorAno {
  ano: number;
  processos: number;
}

export interface Dispersao extends Desfechos {
  assunto: string;
  processos: number;
  adversarios: number;
  individuais: number;
  desde: string | null;
  /**
   * Ações distribuídas por ano, do primeiro ao último — inclusive os anos
   * ZERADOS no meio. Sem eles a série mentiria por omissão: 2022 com quatro e
   * 2026 com doze, lado a lado, pareceria crescimento constante mesmo que
   * 2023, 2024 e 2025 não tivessem nenhuma.
   */
  porAno: PorAno[];
}

/**
 * QUE LEITURAS ESTE PADRÃO PEDE — no plural, e isso importa.
 *
 * A primeira versão devolvia UMA leitura, escolhida por prioridade. Ela errava
 * no caso mais interessante do acervo: contra a Hapvida há três ações sobre
 * greve, TODAS individuais e TODAS com procedência parcial. Escolher entre
 * "vocês ganham isto sempre" e "isto podia ser uma ação só" é jogar fora metade
 * do achado — as duas coisas são verdade, e juntas é que sustentam a conversa.
 *
 * DESFECHO_SEMPRE_CONTRA é o mais caro de ignorar: cada processo isolado parece
 * azar, e só o conjunto mostra que o argumento não convence aquele juízo.
 */
export function lerConcentracao(c: {
  processos: number;
  individuais: number;
  julgados: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
}): LeituraConcentracao[] {
  const leituras: LeituraConcentracao[] = [];
  const decididoBastante = c.julgados >= MINIMO_JULGADOS;

  if (decididoBastante && c.improcedentes === c.julgados) leituras.push('DESFECHO_SEMPRE_CONTRA');
  if (decididoBastante && c.procedentes + c.parciais === c.julgados) {
    leituras.push('DESFECHO_SEMPRE_A_FAVOR');
  }
  if (c.individuais > c.processos / 2) leituras.push('COLETIVA_POSSIVEL');

  return leituras.length ? leituras : ['REINCIDENCIA'];
}

interface LinhaConcentracao {
  parteExternaId: string;
  adversario: string;
  processos: number;
  individuais: number;
  julgados: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
  desde: Date | null;
}

interface LinhaPedido {
  parteExternaId: string;
  assunto: string;
  processos: number;
}

interface LinhaPorAno {
  assunto: string;
  ano: number;
  processos: number;
}

interface LinhaDispersao {
  assunto: string;
  processos: number;
  adversarios: number;
  individuais: number;
  julgados: number;
  procedentes: number;
  parciais: number;
  improcedentes: number;
  desde: Date | null;
}

/**
 * Preenche os anos vazios entre o primeiro e o último.
 *
 * Um gráfico que pula de 2022 para 2026 desenha os dois pontos vizinhos e a
 * linha entre eles sobe bonito — escondendo três anos sem nenhuma ação. O ano
 * zerado é informação, não lacuna.
 */
export function serieCompleta(linhas: { ano: number; processos: number }[]): PorAno[] {
  if (!linhas.length) return [];
  const porAno = new Map(linhas.map((l) => [l.ano, l.processos]));
  const anos = [...porAno.keys()];
  const inicio = Math.min(...anos);
  const fim = Math.max(...anos);
  const serie: PorAno[] = [];
  for (let ano = inicio; ano <= fim; ano++) serie.push({ ano, processos: porAno.get(ano) ?? 0 });
  return serie;
}

@Injectable()
export class PadroesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O acervo ATIVO, agrupado de duas formas.
   *
   * Sem recorte por advogado, de propósito: o padrão só existe olhando o acervo
   * inteiro. Três ações sobre greve divididas entre dois advogados são
   * invisíveis para cada um deles — e é justamente o caso que a tela existe
   * para mostrar. O acesso continua sendo o do módulo de processos, que já dá a
   * lista toda.
   */
  async levantar(): Promise<{
    concentracoes: Concentracao[];
    dispersoes: Dispersao[];
    /** De que lado a entidade está — ver `deQueLadoEstamos`. */
    nossoPapel: { autor: number; reu: number; representando: number };
    acervoAtivo: number;
    geradoEm: string;
  }> {
    const base = this.comBase(tenant.cnpj.replace(/\D/g, ''));

    const [concentracoesRaw, pedidosRaw, dispersoesRaw, porAnoRaw, acervoAtivo, nossoPapel] =
      await Promise.all([
      this.prisma.$queryRaw<LinhaConcentracao[]>(Prisma.sql`
        ${base}
        SELECT a.parte_externa_id                 AS "parteExternaId",
               coalesce(a.nome_fantasia, a.nome)  AS adversario,
               count(DISTINCT p.id)::int          AS processos,
               count(DISTINCT p.id) FILTER (WHERE p.tipo_acao = 'INDIVIDUAL')::int AS individuais,
               count(DISTINCT j.processo_id)::int AS julgados,
               count(DISTINCT p.id) FILTER (WHERE j.codigo = ${PROCEDENCIA})::int         AS procedentes,
               count(DISTINCT p.id) FILTER (WHERE j.codigo = ${PROCEDENCIA_PARCIAL})::int AS parciais,
               count(DISTINCT p.id) FILTER (WHERE j.codigo = ${IMPROCEDENCIA})::int       AS improcedentes,
               min(p.data_distribuicao)           AS desde
        FROM processos p
        JOIN adversario a ON a.processo_id = p.id
        LEFT JOIN julgamento j ON j.processo_id = p.id
        WHERE p.status_interno = 'ATIVO'
        GROUP BY 1, 2
        HAVING count(DISTINCT p.id) >= ${MINIMO_CONCENTRACAO}
        ORDER BY count(DISTINCT p.id) DESC, 2
      `),
      /**
       * Os pedidos que se repetem, por réu. Consulta separada porque juntá-la à
       * de cima multiplicaria as linhas: cinco ações da Hapvida com quatro
       * assuntos cada apareceriam como quatro "padrões" da mesma situação. O
       * padrão é o RÉU; os pedidos são o que ele tem dentro.
       */
      this.prisma.$queryRaw<LinhaPedido[]>(Prisma.sql`
        ${base}
        SELECT a.parte_externa_id AS "parteExternaId",
               t.assunto          AS assunto,
               count(DISTINCT p.id)::int AS processos
        FROM processos p
        JOIN adversario a ON a.processo_id = p.id
        JOIN tema t ON t.processo_id = p.id
        WHERE p.status_interno = 'ATIVO'
        GROUP BY 1, 2
        HAVING count(DISTINCT p.id) >= ${MINIMO_PEDIDO_RECORRENTE}
        ORDER BY count(DISTINCT p.id) DESC, 2
      `),
      this.prisma.$queryRaw<LinhaDispersao[]>(Prisma.sql`
        ${base}
        SELECT t.assunto                          AS assunto,
               count(DISTINCT p.id)::int          AS processos,
               count(DISTINCT a.parte_externa_id)::int AS adversarios,
               count(DISTINCT p.id) FILTER (WHERE p.tipo_acao = 'INDIVIDUAL')::int AS individuais,
               count(DISTINCT j.processo_id)::int AS julgados,
               count(DISTINCT p.id) FILTER (WHERE j.codigo = ${PROCEDENCIA})::int         AS procedentes,
               count(DISTINCT p.id) FILTER (WHERE j.codigo = ${PROCEDENCIA_PARCIAL})::int AS parciais,
               count(DISTINCT p.id) FILTER (WHERE j.codigo = ${IMPROCEDENCIA})::int       AS improcedentes,
               min(p.data_distribuicao)           AS desde
        FROM processos p
        JOIN tema t ON t.processo_id = p.id
        LEFT JOIN adversario a ON a.processo_id = p.id
        LEFT JOIN julgamento j ON j.processo_id = p.id
        WHERE p.status_interno = 'ATIVO'
        GROUP BY 1
        HAVING count(DISTINCT p.id) >= ${MINIMO_DISPERSAO_PROCESSOS}
           AND count(DISTINCT a.parte_externa_id) >= ${MINIMO_DISPERSAO_ADVERSARIOS}
        ORDER BY count(DISTINCT p.id) DESC
      `),
      /**
       * A SÉRIE POR ANO de cada assunto. Consulta à parte pelo mesmo motivo dos
       * pedidos: junta à de cima, cada assunto viraria uma linha por ano e as
       * contagens de processo sairiam multiplicadas.
       */
      this.prisma.$queryRaw<LinhaPorAno[]>(Prisma.sql`
        ${base}
        SELECT t.assunto AS assunto,
               EXTRACT(YEAR FROM p.data_distribuicao)::int AS ano,
               count(DISTINCT p.id)::int AS processos
        FROM processos p
        JOIN tema t ON t.processo_id = p.id
        WHERE p.status_interno = 'ATIVO' AND p.data_distribuicao IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 2
      `),
      this.prisma.processo.count({ where: { statusInterno: 'ATIVO' } }),
      this.deQueLadoEstamos(),
    ]);

    const pedidosPorReu = new Map<string, PedidoRecorrente[]>();
    for (const linha of pedidosRaw) {
      const lista = pedidosPorReu.get(linha.parteExternaId) ?? [];
      lista.push({ assunto: linha.assunto, processos: linha.processos });
      pedidosPorReu.set(linha.parteExternaId, lista);
    }

    return {
      /**
       * SÓ ENTRA QUEM TEM PEDIDO REPETIDO. Sem isso, esta lista seria a mesma
       * do bloco "Contra quem litigamos" do painel, com mais colunas. O que faz
       * disto um padrão não é "temos cinco ações contra a Hapvida" — é "temos a
       * MESMA ação contra a Hapvida cinco vezes".
       */
      concentracoes: concentracoesRaw
        .filter((c) => (pedidosPorReu.get(c.parteExternaId) ?? []).length > 0)
        .map((c) => ({
          ...c,
          desde: c.desde ? c.desde.toISOString().slice(0, 10) : null,
          pedidos: pedidosPorReu.get(c.parteExternaId) ?? [],
          leituras: lerConcentracao(c),
        })),
      dispersoes: dispersoesRaw.map((d) => ({
        ...d,
        desde: d.desde ? d.desde.toISOString().slice(0, 10) : null,
        porAno: serieCompleta(porAnoRaw.filter((a) => a.assunto === d.assunto)),
      })),
      nossoPapel,
      acervoAtivo,
      geradoEm: new Date().toISOString(),
    };
  }

  /**
   * DE QUE LADO A ENTIDADE ESTÁ — e são três respostas, não duas.
   *
   * Medido em 04/09/2026 sobre os 127 processos: AUTOR em 93, REPRESENTANDO em
   * 31 (o filiado é a parte e o sindicato é o patrono) e RÉU em 3. As três
   * somam exatamente o acervo, sem sobreposição — é a partição, não uma
   * amostra.
   *
   * A terceira categoria é a esquecida e é a segunda maior: "processo do
   * sindicato" e "processo que o sindicato conduz" são coisas diferentes, e a
   * diferença muda quem responde por ele quando alguém pergunta.
   *
   * A IDENTIFICAÇÃO É PELA FLAG, nunca por nome: as 96 partes que são o
   * sindicato estão todas ligadas ao cadastro `institucional`, e casar por
   * texto ("SENATEPI", a razão social inteira, o que o tribunal escrever)
   * erraria nas duas pontas.
   */
  private async deQueLadoEstamos() {
    const somosNos = { parteExterna: { institucional: true } };
    const [autor, reu, representando] = await Promise.all([
      this.prisma.processo.count({ where: { partes: { some: { polo: 'ATIVO', ...somosNos } } } }),
      this.prisma.processo.count({ where: { partes: { some: { polo: 'PASSIVO', ...somosNos } } } }),
      // `some: {}` junto: processo sem parte nenhuma não é "representamos o
      // filiado", é processo com cadastro incompleto. Ver o comentário gêmeo
      // em `FILTRO_RAPIDO.nossoPapel`.
      this.prisma.processo.count({
        where: { AND: [{ partes: { some: {} } }, { partes: { none: somosNos } }] },
      }),
    ]);
    return { autor, reu, representando };
  }

  /**
   * As três CTEs que as duas consultas compartilham.
   *
   * `adversario` devolve UM por processo: o marcado como principal, senão o
   * primeiro por nome. Medido: 96 dos 105 processos ativos têm um adversário só,
   * e 102 das 112 partes adversas estão marcadas como principal. Contar o
   * processo sob CADA corréu seria verdade linha a linha e inventaria padrão no
   * agregado — a mesma ação apareceria como duas contra empresas do mesmo grupo.
   *
   * `tema` são os assuntos de mérito, TODOS eles e não só o principal. O CNJ
   * marca como principal o que quiser: das 24 vezes em que "Piso Salarial da
   * Categoria" aparece no acervo, só 11 são como principal. Usar o principal
   * jogaria fora mais da metade do sinal. Os treze códigos de rito ficam de fora
   * — ver `ASSUNTOS_DE_RITO`.
   *
   * `julgamento` devolve o desfecho ATUAL: o julgamento mais recente. Três
   * processos do acervo têm dois julgamentos (primeiro grau e recurso), e somar
   * os dois contaria uma improcedência já reformada como se ainda valesse.
   */
  private comBase(cnpj: string): Prisma.Sql {
    return Prisma.sql`
      WITH nosso AS (
        SELECT id FROM partes_externas WHERE documento = ${cnpj}
      ),
      adversario AS (
        SELECT DISTINCT ON (pp.processo_id)
               pp.processo_id, pp.parte_externa_id, pe.nome, pe.nome_fantasia
        FROM partes_processo pp
        JOIN partes_externas pe ON pe.id = pp.parte_externa_id
        WHERE pp.parte_externa_id IS NOT NULL
          AND pp.parte_externa_id NOT IN (SELECT id FROM nosso)
        ORDER BY pp.processo_id, pp.principal DESC, pe.nome
      ),
      tema AS (
        SELECT DISTINCT p.id AS processo_id, btrim(x->>'nome') AS assunto
        FROM processos p, jsonb_array_elements(coalesce(p.assuntos, '[]'::jsonb)) x
        WHERE btrim(coalesce(x->>'nome', '')) <> ''
          AND coalesce((x->>'codigo')::int, 0) NOT IN (${Prisma.join(ASSUNTOS_DE_RITO)})
      ),
      julgamento AS (
        SELECT DISTINCT ON (m.processo_id)
               m.processo_id, m.codigo_movimento AS codigo, m.data_movimento
        FROM movimentacoes_processuais m
        WHERE m.codigo_movimento IN (${PROCEDENCIA}, ${IMPROCEDENCIA}, ${PROCEDENCIA_PARCIAL})
        ORDER BY m.processo_id, m.data_movimento DESC
      )
    `;
  }
}
