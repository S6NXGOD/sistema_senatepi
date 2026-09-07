import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICE = readFileSync(join(__dirname, 'processos.service.ts'), 'utf8');
const DJEN_SYNC = readFileSync(join(__dirname, 'djen-sync.service.ts'), 'utf8');
const MIGRACAO = readFileSync(
  join(
    __dirname, '..', '..', '..', 'prisma', 'migrations',
    '20260907050000_djen_move_a_ordenacao', 'migration.sql',
  ),
  'utf8',
);

/**
 * O CHIP "ANDAMENTO DO TRIBUNAL" ERA ZERO POR CONSTRUÇÃO — pela segunda vez.
 *
 * O usuário mandou o print: chip "Andamento do tribunal 0" com a janela em 30
 * dias, e a lista ao lado mostrando "01/09/2026 · há 6 dias". Duas afirmações
 * contraditórias na mesma tela.
 *
 * Medido na produção em 07/09/2026, sobre o acervo inteiro:
 *
 *      janela   só DataJud   só DJEN   as duas
 *       7 dias        0           5         5
 *      15 dias        0          21        21
 *      30 dias        0          32        32
 *      60 dias       56          41        64
 *
 * O andamento MAIS NOVO do DataJud tinha 30 dias e a mediana de atraso era 62.
 * Nenhuma janela curta podia devolver outra coisa. Da primeira vez eu abri a
 * janela (7/15 → 30/60); o índice atrasou mais e o remendo venceu. A causa era
 * o DJEN estar fora da conta — e é do DJEN que sai a intimação com prazo.
 */
describe('o filtro conta as duas portas do tribunal', () => {
  const recentes = SERVICE.slice(
    SERVICE.indexOf('recentes: (dias: number'),
    SERVICE.indexOf('urgentes:'),
  );

  it('o trecho existe (o teste não olha para o vazio)', () => {
    expect(recentes.length).toBeGreaterThan(120);
  });

  it('soma andamento do DataJud OU publicação no Diário', () => {
    expect(recentes).toContain('OR: [');
    expect(recentes).toContain('movimentacoes: { some: { dataMovimento: { gte: corte } } }');
    expect(recentes).toContain('comunicacoes: { some: { dataDisponibilizacao: { gte: corte } } }');
  });

  /** O trabalho da equipe continua fora: ele responde à ORDENAÇÃO, não ao chip. */
  it('e não conta nota interna', () => {
    expect(recentes).not.toContain('movimentacoesInternas');
  });

  /** Uma data só, usada nas duas pernas — duas contas divergiriam na primeira edição. */
  it('as duas fontes usam o mesmo corte', () => {
    expect(recentes).toContain('const corte = new Date(agora.getTime() - dias * 24 * 3600 * 1000)');
    expect((recentes.match(/gte: corte/g) ?? []).length).toBe(2);
  });
});

/**
 * A COLUNA MOSTRA O QUE O FILTRO CONTA — a regra que já custou duas correções.
 *
 * Se o filtro passa a enxergar o Diário e a coluna não, o descompasso volta ao
 * contrário: o chip diz "mexeu" e a linha mostra data velha.
 */
describe('a coluna "última movimentação" lê as três fontes', () => {
  const bloco = SERVICE.slice(
    SERVICE.indexOf('ultimaMovimentacao: (() =>'),
    SERVICE.indexOf('etiquetasAutomaticas:'),
  );

  it('o trecho existe', () => {
    expect(bloco.length).toBeGreaterThan(300);
  });

  it('considera DataJud, Diário e equipe', () => {
    expect(bloco).toContain('const cnj = p.movimentacoes[0]');
    expect(bloco).toContain('const pub = p.comunicacoes[0]');
    expect(bloco).toContain('const nota = p.movimentacoesInternas[0]');
  });

  it('cada uma se declara, para a tela dar ícone diferente', () => {
    expect(bloco).toContain("origem: 'TRIBUNAL' as const");
    expect(bloco).toContain("origem: 'DIARIO' as const");
    expect(bloco).toContain("origem: 'EQUIPE' as const");
  });

  /**
   * `dataDisponibilizacao` é `@db.Date` — chega à meia-noite — e a nota interna
   * tem hora cheia. No mesmo dia a nota ganharia sempre, e a tela diria "nós"
   * onde quem falou foi o juízo.
   */
  it('a mais recente vence, e o empate não vai para a nota', () => {
    expect(bloco).toContain('candidatos.reduce((a, b) => (b.data > a.data ? b : a))');
    expect(bloco.indexOf("origem: 'TRIBUNAL'")).toBeLessThan(bloco.indexOf("origem: 'EQUIPE'"));
    expect(bloco.indexOf("origem: 'DIARIO'")).toBeLessThan(bloco.indexOf("origem: 'EQUIPE'"));
  });

  /** A publicação precisa chegar na listagem — senão o bloco acima lê `undefined`. */
  it('a listagem traz a última publicação de cada processo', () => {
    const select = SERVICE.slice(
      SERVICE.indexOf('const [total, items]'),
      SERVICE.indexOf('ultimaMovimentacao: (() =>'),
    );
    expect(select).toContain('comunicacoes: {');
    expect(select).toContain("orderBy: { dataDisponibilizacao: 'desc' }");
  });
});

/**
 * A ORDENAÇÃO SOFRIA DO MESMO MAL, e essa era a mais silenciosa.
 *
 * `ultimo_movimento_em` ordena "Movimentação recente" e era mantida só pelo
 * gatilho das notas internas e pelo lado DataJud. Medido: **37 processos com
 * publicação no Diário mais nova do que a própria coluna que os ordena** — um
 * processo publicado anteontem aparecia abaixo de outro parado desde julho.
 */
describe('a publicação move a ordenação', () => {
  it('a ingestão atualiza `ultimoMovimentoEm`', () => {
    expect(DJEN_SYNC).toContain('await this.prisma.processo.updateMany({');
    expect(DJEN_SYNC).toContain('data: { ultimoMovimentoEm: info.publicadaEm }');
  });

  /**
   * SÓ AVANÇA. Uma publicação antiga que chegue atrasada na varredura não pode
   * puxar o processo para trás na lista.
   */
  it('e nunca faz a coluna recuar', () => {
    expect(DJEN_SYNC).toContain('OR: [{ ultimoMovimentoEm: null }, { ultimoMovimentoEm: { lt: info.publicadaEm } }]');
  });

  it('guarda a publicação MAIS NOVA do lote, não a última lida', () => {
    expect(DJEN_SYNC).toContain('if (quando > atual.publicadaEm) atual.publicadaEm = quando;');
  });

  /** O passado não se conserta sozinho: sem backfill, os 37 esperariam meses. */
  it('a migração recalcula o que já estava gravado', () => {
    expect(MIGRACAO).toContain('UPDATE "processos" p');
    expect(MIGRACAO).toContain('max("data_disponibilizacao")');
    expect(MIGRACAO).toMatch(/d\.pub > p\."ultimo_movimento_em"/);
  });

  /**
   * JANELA DE TROCA: o contêiner ANTIGO serve tráfego contra o banco já
   * migrado. Só `UPDATE` de valor passa — criar, renomear ou remover coluna o
   * derrubaria.
   */
  it('a migração é aditiva — não cria, não renomeia, não remove', () => {
    expect(MIGRACAO).not.toMatch(/\b(DROP|ALTER TABLE|CREATE TABLE|RENAME)\b/i);
  });
});
