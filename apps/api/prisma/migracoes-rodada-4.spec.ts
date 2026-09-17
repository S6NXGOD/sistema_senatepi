import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * A MIGRAÇÃO DA RODADA DE 15/09/2026 — o atendimento fecha sozinho quando o
 * advogado conclui a consulta (4 de 4 consultas concluídas exigiram fechar o
 * atendimento à mão depois).
 *
 * Sem Postgres no teste, o SQL não roda aqui. O que se prova sem ele:
 *   · os dois campos do client apontam para as colunas que a migração cria,
 *     com o tipo certo e opcionais;
 *   · tudo é aditivo e idempotente — nenhum DROP, RENAME, NOT NULL, ALTER
 *     COLUMN nem escrita de linha (sem backfill);
 *   · a chave estrangeira só é criada dentro de bloco DO que confere
 *     `pg_constraint` pelo nome EXATO, com SET NULL para `compromissos`;
 *   · a relação nova não sequestrou a relação antiga Atendimento ↔ Compromisso
 *     (a origem da consulta), que continua sem nome e em `atendimento_id`;
 *   · é a última da fila.
 *
 * O SQL é lido SEM os comentários: a migração explica em prosa justamente o
 * que não faz ("SEM BACKFILL"), e uma negativa casaria com a explicação.
 */
const PASTA = join(__dirname, 'migrations');
const NOVA = '20260915090000_conclusao_pela_consulta';
const FK = 'atendimentos_conclusao_consulta_id_fkey';

function sql(pasta: string): string {
  return readFileSync(join(PASTA, pasta, 'migration.sql'), 'utf8')
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const casos: Array<[string, string]> = [
    ['conclusaoOrigem', 'conclusao_origem'],
    ['conclusaoConsultaId', 'conclusao_consulta_id'],
  ];

  it.each(casos)('Atendimento.%s → %s', (nome, coluna) => {
    const c = campo('Atendimento', nome);
    expect(c.tabela).toBe('atendimentos');
    expect(c.coluna).toBe(coluna);
    // Texto, não enum: origem nova não pode pedir migração de tipo.
    expect(c.tipo).toBe('String');
    // Opcional: o contêiner antigo não conhece a coluna e continua inserindo
    // sem ela durante a janela de troca.
    expect(c.obrigatorio).toBe(false);
    expect(sql(NOVA)).toContain(`ALTER TABLE "atendimentos" ADD COLUMN IF NOT EXISTS "${coluna}" TEXT;`);
  });

  it('são exatamente 2 colunas novas, ambas em atendimentos', () => {
    const codigo = sql(NOVA);
    expect((codigo.match(/ADD COLUMN/g) ?? []).length).toBe(2);
    expect((codigo.match(/ALTER TABLE "atendimentos" ADD COLUMN/g) ?? []).length).toBe(2);
  });
});

describe('aditiva e idempotente', () => {
  const codigo = sql(NOVA);

  it('não remove, não renomeia, não reescreve', () => {
    expect(codigo.length).toBeGreaterThan(0);
    expect(codigo).not.toMatch(/\bDROP\b/i);
    expect(codigo).not.toMatch(/\bRENAME\b/i);
    // Coluna NOT NULL quebra o INSERT do contêiner antigo; ALTER COLUMN
    // reescreve o que já existe.
    expect(codigo).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
    expect(codigo).not.toMatch(/ALTER COLUMN/i);
    expect(codigo).not.toMatch(/\bADD VALUE\b/i);
  });

  it('sem backfill: nenhuma linha é escrita', () => {
    // A ação referencial da FK (`ON DELETE SET NULL ON UPDATE CASCADE`) não é
    // escrita de linha: sai antes da checagem.
    const semAcaoDaFk = codigo.replace(
      /ON (DELETE|UPDATE) (SET NULL|SET DEFAULT|CASCADE|RESTRICT|NO ACTION)/gi,
      '',
    );
    expect(semAcaoDaFk).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });

  it('toda ADD COLUMN tem IF NOT EXISTS', () => {
    const adicoes = codigo.match(/ADD COLUMN/gi) ?? [];
    const guardadas = codigo.match(/ADD COLUMN IF NOT EXISTS/gi) ?? [];
    expect(adicoes.length).toBeGreaterThan(0);
    expect(guardadas.length).toBe(adicoes.length);
  });

  /**
   * O Prisma aplica por ORDEM DE NOME, e o que precisa continuar verdadeiro é
   * que esta migração não furou a fila das que já existiam quando foi escrita.
   *
   * Era "é a última da fila", e era — até a rodada seguinte chegar
   * (`20260917100000_carimbo_do_robo`, de 17/09/2026). Exigir que a de 15/09
   * siga sendo a última transformaria este teste num alarme que dispara em toda
   * migração nova, sem nada a ver com o que ele existe para proteger.
   */
  it('não furou a fila', () => {
    const pastas = readdirSync(PASTA, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(pastas[pastas.indexOf(NOVA) - 1]).toBe('20260914090200_desafio_de_um_fator');
  });
});

describe('a chave estrangeira da consulta que fechou tem guarda', () => {
  const codigo = sql(NOVA);

  it('a única ADD CONSTRAINT está dentro de um bloco DO', () => {
    const blocos = codigo.match(/DO \$\$.*?END \$\$;/g) ?? [];
    const dentro = blocos.join(' ').match(/ADD CONSTRAINT/g) ?? [];
    const total = codigo.match(/ADD CONSTRAINT/g) ?? [];
    expect(total.length).toBe(1);
    expect(dentro.length).toBe(total.length);
  });

  it('confere pg_constraint pelo MESMO nome que cria, SET NULL para compromissos', () => {
    // Nome diferente entre a checagem e a criação vira DDL que não roda de
    // novo — e o `migrate deploy` passa a recusar tudo o que vem depois.
    expect(codigo).toContain(
      `IF NOT EXISTS ( SELECT 1 FROM pg_constraint WHERE conname = '${FK}' ) THEN ` +
        `ALTER TABLE "atendimentos" ADD CONSTRAINT "${FK}" ` +
        `FOREIGN KEY ("conclusao_consulta_id") REFERENCES "compromissos"("id") ON DELETE SET NULL ON UPDATE CASCADE; END IF;`,
    );
    // E o nome aparece exatamente duas vezes: na checagem e na criação.
    expect(codigo.split(FK).length - 1).toBe(2);
  });

  it('o nome da constraint é o que o Prisma daria à relação (sem drift no próximo migrate dev)', () => {
    // Convenção do Prisma 5 para FK: <tabela>_<coluna>_fkey.
    const f = modelo('Atendimento').fields.find((x) => x.name === 'conclusaoConsulta');
    expect(f?.type).toBe('Compromisso');
    expect(f?.isRequired).toBe(false);
    expect(f?.isList).toBe(false);
    expect(f?.relationName).toBe('AtendimentoConcluidoPelaConsulta');
    expect(f?.relationFromFields).toEqual(['conclusaoConsultaId']);
    expect(f?.relationToFields).toEqual(['id']);
    expect(f?.relationOnDelete).toBe('SetNull');
    const { tabela, coluna } = campo('Atendimento', 'conclusaoConsultaId');
    expect(`${tabela}_${coluna}_fkey`).toBe(FK);
    expect(modelo('Compromisso').dbName).toBe('compromissos');
  });

  it('o lado inverso existe em Compromisso, e é lista', () => {
    const inverso = modelo('Compromisso').fields.filter(
      (x) => x.relationName === 'AtendimentoConcluidoPelaConsulta',
    );
    expect(inverso).toHaveLength(1);
    expect(inverso[0].type).toBe('Atendimento');
    expect(inverso[0].isList).toBe(true);
  });

  it('a relação antiga (a ORIGEM da consulta) continua a mesma', () => {
    // Duas relações entre os mesmos modelos: se a nova tivesse tomado o lugar
    // da antiga, `compromisso.atendimento` passaria a ler a consulta que fechou.
    const origem = modelo('Compromisso').fields.find((x) => x.name === 'atendimento');
    expect(origem?.type).toBe('Atendimento');
    expect(origem?.relationFromFields).toEqual(['atendimentoId']);
    expect(origem?.relationName).not.toBe('AtendimentoConcluidoPelaConsulta');
    const lista = modelo('Atendimento').fields.find((x) => x.name === 'compromissos');
    expect(lista?.relationName).toBe(origem?.relationName);
    expect(lista?.isList).toBe(true);
  });
});
