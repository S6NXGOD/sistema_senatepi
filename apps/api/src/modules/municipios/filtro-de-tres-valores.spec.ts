import { OrigemDaLigacao } from '@prisma/client';
import { VinculoDeEnteService } from './vinculo-de-ente.service';

/**
 * O FILTRO PRECISA SELECIONAR A LINHA NULA — e nenhum teste de formato prova isso.
 *
 * O QUE ACONTECEU. `casarFiliados` e `casarOrganizacoes` mandavam ao banco
 * `origem <> 'MANUAL'` para dizer "tudo que uma pessoa não decidiu". Em SQL isso
 * é NULO — não falso — quando a coluna é NULA, e `WHERE nulo` não traz a linha.
 * Como no primeiro dia TODAS as linhas têm a origem nula, a varredura ligou ZERO
 * de 3.150 filiados. Sem erro, sem exceção: o log gravou sucesso.
 *
 * Medido na produção em 10/09/2026, com o defeito no ar:
 *
 *   prisma.filiado.count({ where: { municipioOrigem: { not: 'MANUAL' } } })  ->  0
 *   select count(*) ... where (municipio_origem is null or <> 'MANUAL')      ->  3.150
 *
 * POR QUE O TESTE ANTERIOR NÃO PEGOU. Ele conferia o FORMATO do objeto de
 * filtro contra um Prisma falso — provou que a chamada acontece, não que ela
 * seleciona. É o mesmo defeito de método que já custou caro nesta base.
 *
 * O QUE ESTE TESTE FAZ DIFERENTE. Captura o filtro REAL que o serviço envia e o
 * aplica a linhas de mentira com um avaliador que respeita a lógica de três
 * valores do SQL. Se alguém voltar à forma ingênua, a linha nula deixa de ser
 * selecionada e o teste reprova — que é exatamente o que precisava ter
 * acontecido.
 */

/** VERDADEIRO, FALSO ou DESCONHECIDO — o terceiro valor é o ponto do arquivo. */
type Tri = true | false | null;

const eE = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === true && b === true ? true : null);
const ouOu = (a: Tri, b: Tri): Tri => (a === true || b === true ? true : a === false && b === false ? false : null);

/**
 * Aplica um `where` do Prisma a uma linha, com as regras do SQL:
 *
 *  · comparar QUALQUER coisa com NULO dá DESCONHECIDO — inclusive `<>`;
 *  · `campo: null` é a exceção: no Prisma significa `IS NULL`, que devolve
 *    verdadeiro ou falso, nunca desconhecido;
 *  · a linha só entra quando o resultado final é VERDADEIRO.
 */
function avaliar(where: Record<string, unknown>, linha: Record<string, unknown>): Tri {
  let acc: Tri = true;
  for (const [chave, cond] of Object.entries(where)) {
    if (chave === 'OR') {
      const ramos = cond as Array<Record<string, unknown>>;
      acc = eE(acc, ramos.reduce<Tri>((r, ramo) => ouOu(r, avaliar(ramo, linha)), false));
      continue;
    }
    if (chave === 'AND') {
      const ramos = cond as Array<Record<string, unknown>>;
      acc = eE(acc, ramos.reduce<Tri>((r, ramo) => eE(r, avaliar(ramo, linha)), true));
      continue;
    }
    if (chave === 'NOT') {
      const dentro = avaliar(cond as Record<string, unknown>, linha);
      // NOT(desconhecido) continua desconhecido — é assim no SQL.
      acc = eE(acc, dentro === null ? null : !dentro);
      continue;
    }

    const valor = linha[chave];
    if (cond === null) {
      acc = eE(acc, valor === null || valor === undefined); // IS NULL
    } else if (typeof cond === 'object' && cond !== null && 'not' in (cond as object)) {
      const alvo = (cond as { not: unknown }).not;
      if (alvo === null) {
        acc = eE(acc, !(valor === null || valor === undefined)); // IS NOT NULL
      } else {
        // `campo <> alvo`: DESCONHECIDO quando a coluna é nula.
        acc = eE(acc, valor === null || valor === undefined ? null : valor !== alvo);
      }
    } else {
      // `campo = valor`: DESCONHECIDO quando a coluna é nula.
      acc = eE(acc, valor === null || valor === undefined ? null : valor === cond);
    }
    if (acc === false) return false;
  }
  return acc;
}

/** O avaliador é a régua deste arquivo; se ele mentir, o resto não vale nada. */
describe('a régua: lógica de três valores do SQL', () => {
  it('comparar com nulo dá DESCONHECIDO, e desconhecido não seleciona', () => {
    expect(avaliar({ o: { not: 'MANUAL' } }, { o: null })).toBeNull();
    expect(avaliar({ o: 'MANUAL' }, { o: null })).toBeNull();
    expect(avaliar({ o: { not: 'MANUAL' } }, { o: 'UF_E_NOME' })).toBe(true);
    expect(avaliar({ o: { not: 'MANUAL' } }, { o: 'MANUAL' })).toBe(false);
  });

  it('`campo: null` é IS NULL, e esse responde sim ou não', () => {
    expect(avaliar({ o: null }, { o: null })).toBe(true);
    expect(avaliar({ o: null }, { o: 'MANUAL' })).toBe(false);
  });

  it('NOT de desconhecido continua desconhecido', () => {
    expect(avaliar({ NOT: { o: 'MANUAL' } }, { o: null })).toBeNull();
  });
});

/** Três linhas que cobrem os três estados possíveis da coluna de origem. */
const LINHAS = [
  { rotulo: 'nunca tocada (origem NULA) — 100% da base no primeiro dia', o: null, selecionar: true },
  { rotulo: 'ligada pelo robô numa rodada anterior', o: OrigemDaLigacao.UF_E_NOME, selecionar: true },
  { rotulo: 'decidida por uma pessoa', o: OrigemDaLigacao.MANUAL, selecionar: false },
];

describe('a varredura enxerga quem nunca foi tocado', () => {
  /** Captura o `where` que o serviço realmente envia ao banco. */
  async function filtroDeOrganizacoes(): Promise<Record<string, unknown>> {
    let capturado: Record<string, unknown> = {};
    const prismaFalso = {
      ente: { findMany: async () => [] },
      parteExterna: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          capturado = args.where;
          return [];
        },
        update: async () => ({}),
      },
    };
    await new VinculoDeEnteService(prismaFalso as never).casarOrganizacoes();
    return capturado;
  }

  async function filtroDeFiliados(): Promise<Record<string, unknown>> {
    let capturado: Record<string, unknown> = {};
    const prismaFalso = {
      ente: {
        findMany: async () => [
          { codigo: 2211001, uf: 'PI', esfera: 'M', nomeNormalizado: 'teresina' },
        ],
      },
      filiado: {
        groupBy: async () => [{ cidade: 'Teresina', estado: 'PI', _count: { _all: 1 } }],
        updateMany: async (args: { where: Record<string, unknown> }) => {
          capturado = args.where;
          return { count: 1 };
        },
      },
    };
    await new VinculoDeEnteService(prismaFalso as never).casarFiliados();
    return capturado;
  }

  it.each(LINHAS)('organizações — $rotulo', async ({ o, selecionar }) => {
    const where = await filtroDeOrganizacoes();
    expect(avaliar(where, { enteOrigem: o }) === true).toBe(selecionar);
  });

  it.each(LINHAS)('filiados — $rotulo', async ({ o, selecionar }) => {
    const where = await filtroDeFiliados();
    /*
      O CÓDIGO ACOMPANHA A ORIGEM, e isto não é detalhe do teste — é o estado
      real do banco. Linha nunca tocada tem as DUAS colunas nulas; linha já
      ligada tem as duas preenchidas.

      A primeira versão deste teste dava um código não-nulo à linha "nunca
      tocada", e por isso ela passou por cima do segundo defeito: o `NOT`
      composto, que com as duas colunas nulas também devolve desconhecido.
      Medido na produção: 2.138 filiados em Teresina viravam ZERO.
    */
    const linha = {
      cidade: 'Teresina',
      estado: 'PI',
      municipioOrigem: o,
      municipioCodigo: o === null ? null : 9_999_999,
    };
    expect(avaliar(where, linha) === true).toBe(selecionar);
  });

  /**
   * E O `NOT` QUE POUPA ESCRITA continua poupando: quando a linha JÁ está com o
   * mesmo par (código, origem), ela fica de fora. É o que impede a varredura de
   * reescrever milhares de linhas toda noite para não mudar nada.
   */
  it('quem já está com o valor certo não é reescrito', async () => {
    const where = await filtroDeFiliados();
    const jaCerta = {
      cidade: 'Teresina',
      estado: 'PI',
      municipioOrigem: OrigemDaLigacao.UF_E_NOME,
      municipioCodigo: 2211001,
    };
    expect(avaliar(where, jaCerta)).toBe(false);
  });
});
