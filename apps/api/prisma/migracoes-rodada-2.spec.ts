import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * AS QUATRO MIGRAÇÕES DA RODADA DE 13/09/2026 — o que o schema promete e o
 * banco recebe têm de ser a mesma coisa.
 *
 * Não há Postgres no teste (e nada de banco nesta rodada), então o SQL não
 * roda aqui. O que dá para provar sem ele, e é o que já derrubou deploy:
 *   · o campo do client gerado aponta para a coluna que a migração cria (um
 *     `@map` errado passa no typecheck e explode na primeira leitura);
 *   · tudo é aditivo e idempotente (DDL seco derrubou a API por 1h30);
 *   · o backfill da origem roda na ordem certa e não reescreve o que já tem
 *     origem.
 *
 * O SQL é lido SEM os comentários: as migrações explicam em prosa justamente o
 * que não fazem ("sem `AT TIME ZONE`"), e uma negativa casaria com a
 * explicação.
 */
const PASTA = join(__dirname, 'migrations');

function sql(pasta: string): string {
  return readFileSync(join(PASTA, pasta, 'migration.sql'), 'utf8')
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

const NOVAS = {
  assunto: '20260913010000_assunto_outro_do_atendimento',
  link: '20260913010100_link_da_reuniao',
  decidida: '20260913010200_publicacao_decidida',
  origem: '20260913010300_origem_do_andamento',
} as const;

function campo(modelo: string, nome: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelo);
  const f = m?.fields.find((x) => x.name === nome);
  if (!m || !f) throw new Error(`${modelo}.${nome} não existe no client gerado`);
  return { tabela: m.dbName ?? m.name, coluna: f.dbName ?? f.name, tipo: f.type, obrigatorio: f.isRequired };
}

describe('o campo do client aponta para a coluna que a migração cria', () => {
  const casos: Array<[string, string, string, string, RegExp]> = [
    ['Atendimento', 'assuntoOutro', 'String', NOVAS.assunto, /VARCHAR\(80\)/],
    ['Compromisso', 'linkReuniao', 'String', NOVAS.link, /TEXT/],
    ['ComunicacaoDjen', 'tarefaDecididaEm', 'DateTime', NOVAS.decidida, /TIMESTAMP\(3\)/],
    ['ComunicacaoDjen', 'tarefaDecididaPor', 'String', NOVAS.decidida, /TEXT/],
    ['MovimentacaoInterna', 'origem', 'String', NOVAS.origem, /TEXT/],
  ];

  it.each(casos)('%s.%s', (modelo, nome, tipo, pasta, tipoSql) => {
    const c = campo(modelo, nome);
    expect(c.tipo).toBe(tipo);
    // Opcional: a janela de troca exige coluna nula — o contêiner antigo não a
    // conhece e continua inserindo sem ela.
    expect(c.obrigatorio).toBe(false);
    const alter = new RegExp(
      `ALTER TABLE "${c.tabela}" ADD COLUMN IF NOT EXISTS "${c.coluna}" ${tipoSql.source};`,
    );
    expect(sql(pasta)).toMatch(alter);
  });
});

describe('aditivas e idempotentes', () => {
  it.each(Object.values(NOVAS))('%s', (pasta) => {
    const codigo = sql(pasta);
    expect(codigo).not.toMatch(/\bDROP\b/i);
    expect(codigo).not.toMatch(/\bRENAME\b/i);
    // Coluna NOT NULL é o que quebra o INSERT do contêiner antigo. Só na
    // definição da coluna: `autor_id IS NOT NULL` do backfill é filtro, não DDL.
    expect(codigo).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
    const adicoes = codigo.match(/ADD COLUMN/gi) ?? [];
    const guardadas = codigo.match(/ADD COLUMN IF NOT EXISTS/gi) ?? [];
    expect(adicoes.length).toBeGreaterThan(0);
    expect(guardadas.length).toBe(adicoes.length);
  });

  /** O Prisma aplica por ordem de nome: estas têm de ser as últimas da fila,
   *  na ordem em que dependem umas das outras. */
  it('nascem depois de todas as anteriores, em ordem', () => {
    const pastas = readdirSync(PASTA, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    // Juntas e em ordem. Deixaram de ser as últimas em 14/09/2026 (rodada 3,
    // ver `migracoes-rodada-3.spec.ts`): o que vem depois tem de ser de dia
    // posterior, nunca uma migração da rodada 2 esquecida no fim da fila.
    const inicio = pastas.indexOf(NOVAS.assunto);
    expect(inicio).toBeGreaterThanOrEqual(0);
    expect(pastas.slice(inicio, inicio + 4)).toEqual(Object.values(NOVAS));
    for (const depois of pastas.slice(inicio + 4)) expect(depois >= '20260914').toBe(true);
  });
});

describe('o backfill da origem do andamento', () => {
  const codigo = sql(NOVAS.origem);
  const updates = codigo.split(/(?=UPDATE )/).filter((t) => t.startsWith('UPDATE '));

  it('são três atualizações: CONVERSAO, CONCLUSAO e por último IMPORTACAO', () => {
    // A conversa que abre o caso pré-processual é do mesmo autor, no processo
    // da atividade, milissegundos antes de `concluido_em`: se a regra do eco
    // rodasse primeiro, ela a rotularia CONCLUSAO.
    expect(updates).toHaveLength(3);
    expect(updates[0]).toContain(`SET "origem" = 'CONVERSAO'`);
    expect(updates[1]).toContain(`SET "origem" = 'CONCLUSAO'`);
    expect(updates[2]).toContain(`SET "origem" = 'IMPORTACAO'`);
  });

  /**
   * 13/09/2026: sem esta atualização, as notas da carga de planilha de 31/08
   * (82 na produção, todas em nome de quem subiu o arquivo) ficavam com origem
   * nula, e o Uso e produtividade as contava como andamentos lançados à mão.
   * A seleção abaixo é a que deu exatamente 82 na leitura da produção.
   */
  it('a importação casa pela linha da planilha de processos: mesmo texto e mesmo NPU em dígitos', () => {
    const imp = updates[2];
    expect(imp).toContain('m."autor_id" IS NOT NULL');
    expect(imp).toContain(`m."tipo" = 'ATUALIZACAO'`);
    expect(imp).toContain('m."processo_id" = p."id"');
    expect(imp).toContain('JOIN "importacoes" i ON i."id" = l."importacao_id"');
    expect(imp).toContain(`i."perfil"::text = 'PROCESSOS_CSV'`);
    expect(imp).toContain(`l."dados"::jsonb->>'andamento' = m."descricao"`);
    // UMA barra no arquivo: com standard_conforming_strings ligado (padrão do
    // Postgres), '\D' chega ao regex como "não dígito". Duas barras virariam
    // "barra seguida de D" e nenhum NPU com máscara casaria.
    expect(imp).toContain(
      `regexp_replace(coalesce(l."dados"::jsonb->>'npu', ''), '\\D', '', 'g') = regexp_replace(coalesce(p."numero_cnj", ''), '\\D', '', 'g')`,
    );
    expect(imp).not.toContain('\\\\D');
  });

  it('nenhuma reescreve andamento que já tem origem (rodar de novo é inócuo)', () => {
    for (const u of updates) expect(u).toContain('m."origem" IS NULL');
  });

  it('nenhuma toca a nota do robô', () => {
    for (const u of updates) expect(u).toContain('m."origem_sistema" = false');
  });

  it('a conversão só vale para o caso aberto pela atividade, na mesma transação', () => {
    expect(updates[0]).toContain('p."origem_compromisso_id" IS NOT NULL');
    expect(updates[0]).toContain(
      `m."created_at" BETWEEN p."created_at" - INTERVAL '5 seconds' AND p."created_at" + INTERVAL '5 seconds'`,
    );
  });

  it('o eco exige o mesmo autor e ±5 s da conclusão — pela coluna OU pelo histórico', () => {
    const eco = updates[1];
    expect(eco).toContain('m."autor_id" IS NOT NULL');
    expect(eco).toContain('c."processo_id" = m."processo_id"');
    expect(eco).toContain('c."concluido_por" = m."autor_id"');
    expect(eco).toContain(
      `c."concluido_em" BETWEEN m."created_at" - INTERVAL '5 seconds' AND m."created_at" + INTERVAL '5 seconds'`,
    );
    // `concluido_em` guarda só a última conclusão; o eco de uma conclusão
    // anterior (concluiu, reabriu, concluiu de novo) só o histórico alcança.
    expect(eco).toContain(`h."acao" = 'CONCLUIDO'`);
    expect(eco).toContain('h."autor_id" = m."autor_id"');
  });

  it('compara TIMESTAMP(3) direto, sem converter fuso', () => {
    expect(codigo).not.toMatch(/AT TIME ZONE/i);
  });
});

describe('a decisão da publicação não é inventada para o passado', () => {
  it('a migração só cria as colunas, sem UPDATE', () => {
    // Olhando o que já existe não se distingue "aceita por gente" de
    // "escalada pelo robô": preencher seria afirmar uma decisão que ninguém
    // registrou.
    expect(sql(NOVAS.decidida)).not.toMatch(/\bUPDATE\b/i);
  });
});

/**
 * `compromissos_historico.acao` é TEXTO, não enum. Conferido para o desfazer
 * da conclusão (D6): ele pode registrar a própria ação sem migração de
 * `ALTER TYPE`. Se alguém um dia transformar a coluna em enum, este teste
 * avisa que valores novos passam a exigir migração.
 */
describe('a ação do histórico da atividade', () => {
  it('é String no client gerado', () => {
    const c = campo('CompromissoHistorico', 'acao');
    expect(c.tipo).toBe('String');
    const m = Prisma.dmmf.datamodel.models.find((x) => x.name === 'CompromissoHistorico')!;
    expect(m.fields.find((f) => f.name === 'acao')!.kind).toBe('scalar');
  });
});
