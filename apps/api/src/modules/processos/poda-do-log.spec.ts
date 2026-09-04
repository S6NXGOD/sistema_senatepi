import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const CRON = readFileSync(
  path.resolve(__dirname, '../../../src/modules/processos/processos-cron.service.ts'),
  'utf8',
);

/**
 * A ÚNICA TABELA QUE ESTE SISTEMA APAGA SOZINHO.
 *
 * Medido em 04/09/2026: o banco inteiro tem 48 MB. Não há risco de volume —
 * o que existe é telemetria crescendo sem freio (1.176 linhas de log em 31
 * dias) e ninguém para olhar. A poda é higiene, não emergência, e por isso é
 * deliberadamente estreita.
 */
describe('poda do log de sincronização', () => {
  it('apaga só o log, e só o que passou de 90 dias', () => {
    expect(CRON).toContain('const DIAS_DE_LOG = 90;');
    expect(CRON).toContain('this.prisma.logSincronizacaoDatajud.deleteMany({');
    expect(CRON).toContain('where: { createdAt: { lt: corte } }');
  });

  /**
   * NADA MAIS É APAGADO. Auditoria é prova num sistema jurídico; as linhas de
   * importação são o histórico de como o acervo entrou; publicações e
   * movimentações SÃO o acervo. Este teste é a trava contra alguém, um dia,
   * "aproveitar o job" para limpar mais.
   */
  it('não toca em auditoria, importação, publicações nem movimentações', () => {
    const fn = CRON.slice(CRON.indexOf('private async podarLogAntigo()'));
    const corpo = fn.slice(0, fn.indexOf('private async varrer()'));
    for (const tabela of [
      'auditoria',
      'importacaoLinha',
      'comunicacaoDjen',
      'movimentacaoProcessual',
      'compromisso',
      'processo.delete',
    ]) {
      expect(corpo).not.toContain(tabela);
    }
    // Um `deleteMany` só no método inteiro.
    expect(corpo.match(/deleteMany/g) ?? []).toHaveLength(1);
  });

  /** A poda é acessório: falhar nela não pode derrubar a sincronização. */
  it('roda depois da varredura e engole o próprio erro', () => {
    expect(CRON).toContain('await this.podarLogAntigo().catch((e) =>');
    expect(CRON.indexOf('() => this.varrer(),')).toBeLessThan(
      CRON.indexOf('await this.podarLogAntigo()'),
    );
  });
});
