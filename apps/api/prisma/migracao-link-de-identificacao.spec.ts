import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

/**
 * A MIGRAÇÃO DO LINK DE IDENTIFICAÇÃO — 22/09/2026.
 *
 * Sem Postgres no teste o SQL não roda aqui. O que dá para provar sem ele é
 * exatamente o que já derrubou este sistema uma vez: DDL que não é aditiva
 * (1h30 de API fora), e valor de enum USADO na mesma transação que o criou —
 * que o Postgres recusa, e que faria a migração falhar no deploy.
 *
 * O SQL é lido SEM COMENTÁRIOS, como no guarda da rodada anterior. A migração
 * explica em prosa justamente o que ela NÃO faz ("nenhum valor removido nem
 * renomeado"), e uma busca por "DROP" casaria com a explicação em vez de com o
 * comando — o teste passaria a reprovar o arquivo correto.
 */
const PASTA = '20260922120000_link_de_identificacao';

const sql = readFileSync(join(__dirname, 'migrations', PASTA, 'migration.sql'), 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .trim();

describe('a migração que cria IDENTIFICACAO', () => {
  it('acrescenta o valor, de forma idempotente', () => {
    expect(sql).toBe(`ALTER TYPE "DesafioRecadastramento" ADD VALUE IF NOT EXISTS 'IDENTIFICACAO';`);
  });

  /**
   * SOZINHA, E É O MOTIVO DE ELA TER PASTA PRÓPRIA. O Postgres não deixa USAR
   * um valor de enum na mesma transação que o criou. Uma linha que gravasse ou
   * comparasse com 'IDENTIFICACAO' aqui derrubaria o deploy inteiro — e a
   * asserção acima, de igualdade exata, é o que garante que nada mais entre.
   */
  it('não usa o valor que acabou de criar', () => {
    const resto = sql.replace(
      /ALTER TYPE "DesafioRecadastramento" ADD VALUE IF NOT EXISTS '[A-Z_]+';/g,
      '',
    );
    expect(resto.trim()).toBe('');
  });

  /**
   * ADITIVA. Na janela de troca o contêiner ANTIGO atende contra o banco já
   * migrado; remover ou renomear valor é o jeito de ele quebrar ao ler uma
   * linha que não entende.
   */
  it('não remove, não renomeia e não apaga nada', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i);
  });

  it('o schema e o banco combinam sobre o valor novo', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'DesafioRecadastramento');
    expect(e?.values.map((v) => v.name)).toContain('IDENTIFICACAO');
    expect(e?.dbName ?? e?.name).toBe('DesafioRecadastramento');
  });

  /**
   * O CONTÊINER ANTIGO FALHA FECHADO, e é a direção certa de falhar.
   *
   * Se durante a janela de troca um link IDENTIFICACAO chegasse ao contêiner
   * velho, ele quebraria ao desserializar o enum e responderia 500 — ninguém
   * entra sem conferência. O que garante que isso nem aconteça é o código
   * velho não GERAR o valor novo: para ele, ficha em branco ainda é NENHUM, e
   * NENHUM não gera link. Esta asserção trava a última linha da hierarquia,
   * que é onde alguém mexeria sem perceber a consequência no deploy.
   */
  it('o valor novo entrou no FIM da hierarquia, depois de todos os outros', () => {
    const e = Prisma.dmmf.datamodel.enums.find((x) => x.name === 'DesafioRecadastramento');
    const valores = e?.values.map((v) => v.name) ?? [];
    expect(valores[valores.length - 1]).toBe('IDENTIFICACAO');
  });
});
