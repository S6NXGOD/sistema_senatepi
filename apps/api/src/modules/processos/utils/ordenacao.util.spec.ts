import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { ORDENACAO, ORDEM_PADRAO, ORDENS_PROCESSO, ordemValida } from './ordenacao.util';

/**
 * A LISTA ORDENA PELO QUE O PROCESSO FEZ, NÃO PELO QUE O ROBÔ FEZ.
 *
 * O defeito: `orderBy: { ultimaSincronizacao: 'desc' }`. Esse carimbo é
 * reescrito pela varredura noturna em TODO o acervo na mesma madrugada, então
 * os valores se agrupam na janela do cron — "mais recente" acabava sendo "quem
 * o robô terminou por último". Um processo com sentença de ontem podia cair na
 * página 3 atrás de trinta dormentes.
 */
describe('ordem padrão', () => {
  it('é a movimentação recente', () => {
    expect(ORDEM_PADRAO).toBe('movimentacao');
  });

  it('usa `ultimoMovimentoEm`, e NUNCA `ultimaSincronizacao`', () => {
    const chaves = JSON.stringify(ORDENACAO);
    expect(chaves).toContain('ultimoMovimentoEm');
    expect(chaves).not.toContain('ultimaSincronizacao');
  });

  it('processo sem andamento vai para o FIM de "movimentação recente"', () => {
    expect(ORDENACAO.movimentacao[0]).toEqual({
      ultimoMovimentoEm: { sort: 'desc', nulls: 'last' },
    });
  });

  it('e para o TOPO de "parados há mais tempo" — é o extremo da inércia', () => {
    expect(ORDENACAO.parados[0]).toEqual({
      ultimoMovimentoEm: { sort: 'asc', nulls: 'first' },
    });
  });

  /**
   * Sem desempate estável, dois processos com a mesma data podem trocar de
   * lugar entre uma consulta e outra — e aí a página 2 repete uma linha da 1 e
   * some com outra. O defeito aparece como "processo sumiu da lista".
   */
  it('toda ordem tem desempate estável', () => {
    for (const ordem of ORDENS_PROCESSO) {
      const criterios = ORDENACAO[ordem];
      expect(criterios.length).toBeGreaterThanOrEqual(2);
      expect(criterios[criterios.length - 1]).toEqual({ id: 'desc' });
    }
  });

  it('toda ordem declarada tem implementação', () => {
    for (const ordem of ORDENS_PROCESSO) {
      expect(ORDENACAO[ordem]).toBeDefined();
    }
    expect(Object.keys(ORDENACAO).sort()).toEqual([...ORDENS_PROCESSO].sort());
  });
});

/**
 * O parâmetro vem da barra de endereços. Um link salvo nos favoritos com uma
 * ordem que deixou de existir tem de ABRIR A LISTA, não devolver 400 numa tela
 * que a equipe usa todo dia.
 */
describe('ordem vinda da URL', () => {
  it.each([...ORDENS_PROCESSO])('aceita "%s"', (o) => {
    expect(ordemValida(o)).toBe(o);
  });

  it.each([undefined, null, '', 'valorCausa', 'DROP TABLE', 'movimentação'])(
    'cai no padrão em vez de estourar: %p',
    (bruta) => {
      expect(ordemValida(bruta as string)).toBe(ORDEM_PADRAO);
    },
  );
});

/**
 * A COLUNA É MANTIDA POR GATILHO, e o gatilho tem de sobreviver a quem editar a
 * migração sem ler o porquê. Estes testes leem o SQL: são cinco caminhos de
 * escrita de andamento no sistema, e manter a coluna no serviço significaria
 * lembrar de todos os cinco para sempre.
 */
describe('a migração que sustenta a ordem', () => {
  const SQL = readFileSync(
    path.join(
      __dirname, '..', '..', '..', '..',
      'prisma', 'migrations', '20260825120000_ultimo_movimento_do_processo', 'migration.sql',
    ),
    'utf8',
  );

  it('a coluna é NULÁVEL — o contêiner antigo insere sem conhecê-la', () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS "ultimo_movimento_em" TIMESTAMP\(3\)/);
    expect(SQL).not.toMatch(/ultimo_movimento_em"?\s+TIMESTAMP\(3\)\s+NOT NULL/);
  });

  it('há gatilho nas DUAS fontes de andamento', () => {
    expect(SQL).toContain('ON "movimentacoes_processuais"');
    expect(SQL).toContain('ON "movimentacoes_internas"');
  });

  /**
   * Em 25/08/2026, 51 instâncias novas despejaram 2.033 movimentos históricos
   * de uma vez. Sem o `GREATEST`, cada um desses despejos puxaria o processo
   * para trás e o faria parecer parado no dia seguinte a ter andado.
   */
  it('o gatilho SÓ AVANÇA — andamento antigo não puxa o processo para trás', () => {
    expect(SQL).toContain('GREATEST');
    expect(SQL).toMatch(/"ultimo_movimento_em" IS NULL OR "ultimo_movimento_em" < quando/);
  });

  it('nota interna vale por `data_fato`, como na linha do tempo', () => {
    expect(SQL).toMatch(/COALESCE\(NEW\."data_fato", NEW\."created_at"\)/);
  });

  it('o acervo existente é preenchido — senão a ordem nasce vazia', () => {
    expect(SQL).toMatch(/UPDATE "processos" p/);
    expect(SQL).toContain('UNION ALL');
  });

  it('o índice acompanha a direção da consulta', () => {
    expect(SQL).toMatch(/CREATE INDEX IF NOT EXISTS[\s\S]*DESC NULLS LAST/);
  });

  it('é puramente aditiva — nada de DROP/RENAME na janela de troca', () => {
    // O contêiner antigo atende contra o banco já migrado; remover ou renomear
    // qualquer coisa o derrubaria. Ver a memória da janela de troca do deploy.
    expect(SQL).not.toMatch(/DROP COLUMN|RENAME|DROP TABLE/);
  });
});
