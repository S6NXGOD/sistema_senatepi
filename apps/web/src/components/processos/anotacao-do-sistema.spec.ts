import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const FICHA = ler('components/processos/processo-detalhe-sheet.tsx');
const TIPOS = ler('lib/movimentacoes.ts');
const API = readFileSync(
  path.resolve(RAIZ, '../../api/src/modules/processos/movimentacoes.service.ts'),
  'utf8',
);

/**
 * NOTA DE ROBÔ E NOTA DE ADVOGADO NÃO PODEM TER O MESMO PESO.
 *
 * Medido na produção em 03/09/2026: das 149 movimentações internas, 54 foram
 * escritas pelo sistema — "Área jurídica definida automaticamente como
 * Administrativo" — e 104 por pessoas, incluindo o histórico do caso importado
 * do sistema antigo. As duas saíam na linha do tempo como cartão inteiro, com
 * borda colorida e selo de tipo.
 *
 * A bandeira `origemSistema` já existia no banco, já estava correta nas 149
 * linhas e já era respeitada no cálculo de "movimentação recente". Só não
 * chegava à tela.
 */
describe('anotação do sistema na linha do tempo', () => {
  it('a API manda a bandeira junto com a movimentação interna', () => {
    expect(API).toContain('origemSistema: m.origemSistema,');
  });

  it('o tipo do front conhece a bandeira', () => {
    expect(TIPOS).toContain('origemSistema: boolean;');
  });

  it('a tela desenha a anotação do sistema em uma linha discreta', () => {
    expect(FICHA).toContain('if (item.origemSistema) {');
    const bloco = FICHA.slice(FICHA.indexOf('if (item.origemSistema) {'));
    expect(bloco.slice(0, 900)).toContain('border-dashed');
    expect(bloco.slice(0, 900)).toContain('text-muted-foreground');
  });

  /** Ela vem ANTES do cartão da nota humana — senão nunca seria alcançada. */
  it('e a checagem vem antes do cartão comum', () => {
    expect(FICHA.indexOf('if (item.origemSistema) {')).toBeLessThan(
      FICHA.indexOf('const cor = corTipoMov(item.tipo, tipos);'),
    );
  });

  /**
   * APAGAR SERIA PIOR QUE ESCONDER. A anotação explica por que o processo tem
   * a área jurídica que tem — é registro de auditoria, e some da leitura mas
   * não do histórico.
   */
  it('continua na linha do tempo, não é filtrada fora', () => {
    const bloco = FICHA.slice(FICHA.indexOf('if (item.origemSistema) {'));
    expect(bloco.slice(0, 900)).toContain('{item.descricao}');
    expect(bloco.slice(0, 900)).not.toContain('return null');
  });
});
