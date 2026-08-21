import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { StatusProcesso } from '@prisma/client';
import { PRE_PROCESSUAIS, filtroDeStatus } from './processos.service';

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

  /**
   * A REGRESSÃO QUE APARECEU EM PRODUÇÃO, em 21/08/2026.
   *
   * A exclusão da listagem padrão estava certa e o portão que reconhece as três
   * portas de volta também — mas o filtro de igualdade rodava ANTES dele e
   * procurava o rótulo exato. Resultado: a aba "Pré-processuais" devolvia lista
   * vazia com o caso legado no banco. Ele sumia da lista padrão, como pedido, e
   * não voltava por porta nenhuma — que é exatamente o que o desenho jurava
   * impedir.
   */
  it.each([['PRE_PROCESSUAL'], ['RASCUNHO']] as const)(
    'filtrar por %s traz OS DOIS rótulos',
    (pedido) => {
      expect(filtroDeStatus(pedido as never)).toEqual({
        statusInterno: { in: PRE_PROCESSUAIS },
      });
    },
  );

  it('os demais status seguem sendo igualdade simples', () => {
    expect(filtroDeStatus(StatusProcesso.ATIVO)).toEqual({ statusInterno: 'ATIVO' });
    expect(filtroDeStatus(StatusProcesso.ARQUIVADO)).toEqual({ statusInterno: 'ARQUIVADO' });
  });

  it('sem status pedido, nenhum filtro entra', () => {
    expect(filtroDeStatus(undefined)).toBeNull();
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

  /**
   * NOMENCLATURA — porque um estado com dois nomes na tela vira dois estados na
   * cabeça de quem usa. Chegou a existir um momento em que concluir a atividade
   * disparava DOIS avisos ao mesmo tempo: "processo aberto em rascunho" (modal)
   * e "Caso aberto em fase pré-processual" (página).
   *
   * Aqui só o que o usuário LÊ. Identificador interno pode continuar com o nome
   * antigo — `rascunhoCriado` na resposta da API existe de propósito, para o
   * front anterior não quebrar durante a troca de contêiner.
   */
  it.each([
    ['src/components/agenda/compromisso-drawer.tsx'],
    ['src/components/agenda/concluir-modal.tsx'],
    ['src/components/processos/ajuizar-caso-modal.tsx'],
    ['src/components/processos/seletor-processo.tsx'],
    ['src/components/ui/selo-pre-processual.tsx'],
  ])('%s não mostra a palavra "rascunho" ao usuário', (arquivo) => {
    const src = readFileSync(path.join(RAIZ, '../../apps/web', arquivo), 'utf8');
    // Tira os comentários: eles explicam de onde viemos e citam o nome antigo
    // de propósito. O `.` do JS não casa quebra de linha, então `//.*` para no
    // fim da linha sozinho — sem precisar fatiar o arquivo.
    const semComentario = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*/g, '');
    const visivel = semComentario.replace(/rascunhoCriado/g, '');
    expect(visivel).not.toMatch(/[Rr]ascunho/);
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
