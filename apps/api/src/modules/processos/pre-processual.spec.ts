import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { StatusProcesso } from '@prisma/client';
import { PRE_PROCESSUAIS } from './processos.service';

/**
 * A MIGRAÇÃO DO NOME É ADITIVA — e tem de continuar sendo.
 *
 * Renomear o rótulo no enum (`ALTER TYPE ... RENAME VALUE`) parece a opção
 * limpa e é a que eu escrevi primeiro. Ela derruba a listagem de processos
 * durante o deploy: o contêiner ANTIGO ainda atende requisição contra o banco
 * já migrado, e tanto ler uma linha com o rótulo novo quanto CITAR o rótulo
 * velho num `notIn` viram erro (medido: "Value 'PRE_PROCESSUAL' not found in
 * enum" e Postgres 22P02).
 *
 * Estes casos existem para que a próxima pessoa que achar o rótulo duplicado
 * feio — e vai achar — descubra o motivo pelo teste, e não pelo incidente.
 */
const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');
/** Só o SQL que o Postgres executa — os comentários citam o que NÃO foi feito. */
const semComentarios = (sql: string) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

describe('pré-processual: os dois rótulos', () => {
  it('o enum do banco mantém os DOIS', () => {
    expect(StatusProcesso.PRE_PROCESSUAL).toBe('PRE_PROCESSUAL');
    expect(StatusProcesso.RASCUNHO).toBe('RASCUNHO');
  });

  it('a lista de leitura cobre os dois', () => {
    expect([...PRE_PROCESSUAIS].sort()).toEqual(['PRE_PROCESSUAL', 'RASCUNHO']);
  });

  it('a migração NÃO renomeia e NÃO rerrotula linha', () => {
    const sql = ler('prisma/migrations/20260814210000_equipe_urgencia_e_pre_processual/migration.sql');
    expect(sql).toMatch(/ADD VALUE IF NOT EXISTS 'PRE_PROCESSUAL'/);
    // Só aparece em comentário, explicando por que NÃO foi feito.
    const executavel = semComentarios(sql);
    expect(executavel).not.toMatch(/RENAME VALUE/);
    expect(executavel).not.toMatch(/SET\s+"?status_interno"?\s*=/i);
  });

  /**
   * O tropeço que a migração aditiva cria e o rename escondia: renomear o
   * rótulo faz o Postgres reescrever a expressão do CHECK sozinho; adicionar
   * não faz. Sem esta segunda migração, gravar um pré-processual estoura com
   * 23514 e o desfecho "processo novo" da agenda quebra em produção, sempre.
   */
  it('o CHECK do NPU aceita os dois rótulos, em migração separada', () => {
    const sql = ler('prisma/migrations/20260814210500_npu_nulo_tambem_no_pre_processual/migration.sql');
    expect(sql).toMatch(/processos_npu_obrigatorio_check/);
    expect(sql).toMatch(/IN \('RASCUNHO', 'PRE_PROCESSUAL'\)/);
    // Tem de estar FORA do arquivo que adiciona o rótulo (mesma transação = erro).
    const anterior = ler('prisma/migrations/20260814210000_equipe_urgencia_e_pre_processual/migration.sql');
    const executavel = semComentarios(anterior);
    expect(executavel).not.toMatch(/npu_obrigatorio/);
  });

  /** Escrever os dois espalharia o legado para linhas novas — só se LÊ os dois. */
  it('quem grava usa só o nome novo', () => {
    const agenda = ler('src/modules/agenda/agenda.service.ts');
    expect(agenda).toMatch(/statusInterno: StatusProcesso\.PRE_PROCESSUAL/);
    expect(agenda).not.toMatch(/statusInterno: StatusProcesso\.RASCUNHO/);
  });

  it('nenhum filtro de leitura compara com um literal só', () => {
    const svc = ler('src/modules/processos/processos.service.ts');
    expect(svc).not.toMatch(/statusInterno:\s*\{\s*not:\s*StatusProcesso\.PRE_PROCESSUAL/);
    expect(svc).not.toMatch(/statusInterno\s*!==\s*'PRE_PROCESSUAL'/);
  });

  /** Sem entrada no Record, a tela imprime `undefined` no lugar do status. */
  it('o front rotula e colore o legado igual ao novo', () => {
    const lib = readFileSync(path.join(RAIZ, '../../apps/web/src/lib/processos.ts'), 'utf8');
    expect(lib).toMatch(/RASCUNHO: 'Pré-processual'/);
    expect(lib).toMatch(/ehPreProcessual/);
    const cores = /STATUS_PROCESSO_COR[\s\S]*?\};/.exec(lib)?.[0] ?? '';
    expect(cores).toMatch(/RASCUNHO:/);
  });
});
