import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * AS TRÊS MIGRAÇÕES DA RODADA DE 14/09/2026 — o que o schema promete e o
 * banco recebe têm de ser a mesma coisa, e nada delas pode derrubar o deploy.
 *
 * Sem Postgres no teste, o SQL não roda aqui. O que se prova sem ele:
 *   · o campo do client gerado aponta para a coluna que a migração cria, com
 *     o tipo certo (um `@map` errado passa no typecheck e explode na primeira
 *     leitura);
 *   · tudo é aditivo e idempotente — nenhum DROP, RENAME ou `ALTER TYPE …
 *     RENAME` (na janela de troca o contêiner antigo atende com o banco já
 *     migrado, e DDL seco já derrubou a API por 1h30);
 *   · as chaves estrangeiras só são criadas dentro de bloco DO que confere
 *     `pg_constraint` pelo nome EXATO;
 *   · o valor novo do enum não é usado na migração que o cria.
 *
 * O SQL é lido SEM os comentários: as migrações explicam em prosa justamente o
 * que não fazem ("nenhum valor removido nem renomeado"), e uma negativa
 * casaria com a explicação.
 */
const PASTA = join(__dirname, 'migrations');

function sql(pasta: string): string {
  return readFileSync(join(PASTA, pasta, 'migration.sql'), 'utf8')
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOVAS = {
  diario: '20260914090000_leitura_do_diario',
  fechamento: '20260914090100_fechamento_do_atendimento',
  desafio: '20260914090200_desafio_de_um_fator',
} as const;

function modelo(nome: string) {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === nome);
  if (!m) throw new Error(`${nome} não existe no client gerado`);
  return m;
}

function campo(nomeModelo: string, nome: string) {
  const m = modelo(nomeModelo);
  const f = m.fields.find((x) => x.name === nome);
  if (!f) throw new Error(`${nomeModelo}.${nome} não existe no client gerado`);
  return { tabela: m.dbName ?? m.name, coluna: f.dbName ?? f.name, tipo: f.type, obrigatorio: f.isRequired };
}

describe('o campo do client aponta para a coluna que a migração cria', () => {
  const casos: Array<[string, string, string, string, RegExp]> = [
    ['User', 'djenLidoAte', 'DateTime', NOVAS.diario, /DATE/],
    ['Processo', 'djenHistoricoLidoEm', 'DateTime', NOVAS.diario, /TIMESTAMP\(3\)/],
    ['Atendimento', 'concluidoEm', 'DateTime', NOVAS.fechamento, /TIMESTAMP\(3\)/],
    ['Atendimento', 'concluidoPor', 'String', NOVAS.fechamento, /TEXT/],
    ['Atendimento', 'conclusaoObs', 'String', NOVAS.fechamento, /TEXT/],
    ['Atendimento', 'canceladoEm', 'DateTime', NOVAS.fechamento, /TIMESTAMP\(3\)/],
    ['Atendimento', 'canceladoPor', 'String', NOVAS.fechamento, /TEXT/],
    ['Atendimento', 'canceladoCategoria', 'String', NOVAS.fechamento, /TEXT/],
    ['Atendimento', 'canceladoMotivo', 'String', NOVAS.fechamento, /TEXT/],
  ];

  it.each(casos)('%s.%s', (nomeModelo, nome, tipo, pasta, tipoSql) => {
    const c = campo(nomeModelo, nome);
    expect(c.tipo).toBe(tipo);
    // Opcional: o contêiner antigo não conhece a coluna e continua inserindo
    // sem ela durante a janela de troca.
    expect(c.obrigatorio).toBe(false);
    const alter = new RegExp(
      `ALTER TABLE "${c.tabela}" ADD COLUMN IF NOT EXISTS "${c.coluna}" ${tipoSql.source};`,
    );
    expect(sql(pasta)).toMatch(alter);
  });

  it('são exatamente 7 colunas novas em atendimentos, e 1 em users e 1 em processos', () => {
    const contar = (pasta: string, tabela: string) =>
      (sql(pasta).match(new RegExp(`ALTER TABLE "${tabela}" ADD COLUMN`, 'g')) ?? []).length;
    expect(contar(NOVAS.fechamento, 'atendimentos')).toBe(7);
    expect(contar(NOVAS.diario, 'users')).toBe(1);
    expect(contar(NOVAS.diario, 'processos')).toBe(1);
  });
});

describe('aditivas e idempotentes', () => {
  it.each(Object.values(NOVAS))('%s', (pasta) => {
    const codigo = sql(pasta);
    expect(codigo.length).toBeGreaterThan(0);
    expect(codigo).not.toMatch(/\bDROP\b/i);
    expect(codigo).not.toMatch(/\bRENAME\b/i);
    expect(codigo).not.toMatch(/ALTER TYPE[^;]*\bRENAME\b/i);
    // Coluna NOT NULL quebra o INSERT do contêiner antigo; ALTER COLUMN
    // reescreve o que já existe. Nenhuma das duas cabe numa migração aditiva.
    expect(codigo).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
    expect(codigo).not.toMatch(/ALTER COLUMN/i);
    // Sem backfill nesta rodada: nenhuma escreve linha. A ação referencial da
    // FK (`ON DELETE SET NULL ON UPDATE CASCADE`) não é escrita: sai antes.
    const semAcaoDaFk = codigo.replace(
      /ON (DELETE|UPDATE) (SET NULL|SET DEFAULT|CASCADE|RESTRICT|NO ACTION)/gi,
      '',
    );
    expect(semAcaoDaFk).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);

    const adicoes = codigo.match(/ADD COLUMN/gi) ?? [];
    const guardadas = codigo.match(/ADD COLUMN IF NOT EXISTS/gi) ?? [];
    expect(guardadas.length).toBe(adicoes.length);
    const valores = codigo.match(/ADD VALUE/gi) ?? [];
    const valoresGuardados = codigo.match(/ADD VALUE IF NOT EXISTS/gi) ?? [];
    expect(valoresGuardados.length).toBe(valores.length);
    expect(adicoes.length + valores.length).toBeGreaterThan(0);
  });

  /** O Prisma aplica por ordem de nome: estas têm de estar juntas, na ordem do
   *  plano, depois de todas as anteriores. */
  it('nascem depois de todas as anteriores, em ordem', () => {
    const pastas = readdirSync(PASTA, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    // Juntas e em ordem. Deixaram de ser as últimas em 15/09/2026 (rodada 4,
    // ver `migracoes-rodada-4.spec.ts`): o que vem depois tem de ser de dia
    // posterior, nunca uma migração da rodada 3 esquecida no fim da fila.
    const inicio = pastas.indexOf(NOVAS.diario);
    expect(inicio).toBeGreaterThanOrEqual(0);
    expect(pastas.slice(inicio, inicio + 3)).toEqual(Object.values(NOVAS));
    for (const depois of pastas.slice(inicio + 3)) expect(depois >= '20260915').toBe(true);
  });
});

describe('as chaves estrangeiras do fechamento têm guarda', () => {
  const codigo = sql(NOVAS.fechamento);
  const fks: Array<[string, string]> = [
    ['atendimentos_concluido_por_fkey', 'concluido_por'],
    ['atendimentos_cancelado_por_fkey', 'cancelado_por'],
  ];

  it('toda ADD CONSTRAINT está dentro de um bloco DO', () => {
    const blocos = codigo.match(/DO \$\$.*?END \$\$;/g) ?? [];
    const dentro = blocos.join(' ').match(/ADD CONSTRAINT/g) ?? [];
    const total = codigo.match(/ADD CONSTRAINT/g) ?? [];
    expect(total.length).toBe(2);
    expect(dentro.length).toBe(total.length);
  });

  it.each(fks)('%s: confere pg_constraint pelo MESMO nome que cria, SET NULL para users', (nome, coluna) => {
    // Nome diferente entre a checagem e a criação vira DDL que não roda de
    // novo — e o `migrate deploy` passa a recusar tudo o que vem depois.
    expect(codigo).toContain(
      `IF NOT EXISTS ( SELECT 1 FROM pg_constraint WHERE conname = '${nome}' ) THEN ` +
        `ALTER TABLE "atendimentos" ADD CONSTRAINT "${nome}" ` +
        `FOREIGN KEY ("${coluna}") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;`,
    );
  });

  it('o nome da constraint é o que o Prisma daria à relação (sem drift no próximo migrate dev)', () => {
    // Convenção do Prisma 5 para FK: <tabela>_<coluna>_fkey.
    const m = modelo('Atendimento');
    for (const [rel, campoFk, onDelete] of [
      ['concluidoPorUsuario', 'concluidoPor', 'SetNull'],
      ['canceladoPorUsuario', 'canceladoPor', 'SetNull'],
    ] as const) {
      const f = m.fields.find((x) => x.name === rel);
      expect(f?.type).toBe('User');
      expect(f?.isRequired).toBe(false);
      expect(f?.relationFromFields).toEqual([campoFk]);
      expect(f?.relationOnDelete).toBe(onDelete);
      const coluna = campo('Atendimento', campoFk).coluna;
      expect(fks.map(([n]) => n)).toContain(`atendimentos_${coluna}_fkey`);
    }
  });

  it('os lados inversos existem em User', () => {
    const u = modelo('User');
    const inverso = (relacao: string) =>
      u.fields.find((x) => x.relationName === relacao && x.type === 'Atendimento');
    expect(inverso('AtendimentoConcluidoPor')?.isList).toBe(true);
    expect(inverso('AtendimentoCanceladoPor')?.isList).toBe(true);
  });
});

describe('o desafio de um fator', () => {
  const codigo = sql(NOVAS.desafio);

  it('a migração só adiciona os dois valores, e nada mais', () => {
    const comandos = codigo
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean);
    expect(comandos).toEqual([
      `ALTER TYPE "DesafioRecadastramento" ADD VALUE IF NOT EXISTS 'CPF'`,
      `ALTER TYPE "DesafioRecadastramento" ADD VALUE IF NOT EXISTS 'NASCIMENTO'`,
    ]);
  });

  it('o valor novo não é usado na mesma migração (o Postgres recusa na mesma transação)', () => {
    // Tirando os próprios ADD VALUE, nenhum literal novo pode aparecer.
    const resto = codigo.replace(/ALTER TYPE "DesafioRecadastramento" ADD VALUE IF NOT EXISTS '[A-Z_]+';/g, '');
    expect(resto.trim()).toBe('');
  });

  it('nenhuma outra migração da rodada usa os valores novos', () => {
    for (const pasta of [NOVAS.diario, NOVAS.fechamento]) {
      expect(sql(pasta)).not.toMatch(/'(CPF|NASCIMENTO)'/);
      expect(sql(pasta)).not.toMatch(/DesafioRecadastramento/);
    }
  });

  it('o enum do client tem os valores novos, e MATRICULA não entrou', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'DesafioRecadastramento');
    const valores = e?.values.map((v) => v.name);
    expect(valores).toEqual(['CPF_NASCIMENTO', 'COREN', 'NENHUM', 'CPF', 'NASCIMENTO']);
    expect(valores).not.toContain('MATRICULA');
  });

  it('o nome do tipo na migração é o do enum no banco', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'DesafioRecadastramento');
    expect(e?.dbName ?? e?.name).toBe('DesafioRecadastramento');
  });
});
