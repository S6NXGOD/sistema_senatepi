import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const SERVICE = readFileSync(path.join(__dirname, 'processos.service.ts'), 'utf8');
const MIGRACAO = readFileSync(
  path.join(
    __dirname, '..', '..', '..', 'prisma', 'migrations',
    '20260831140000_movimentacao_do_sistema', 'migration.sql',
  ),
  'utf8',
);

/**
 * O CHIP DE ANDAMENTO NÃO PODE ACENDER QUANDO O ROBÔ ARQUIVA.
 *
 * O defeito, visto na tela em 31/08/2026: o chip "7 dias" devolvia SEIS
 * processos, e a coluna "Última movimentação" mostrava "há 5 meses", "há 3
 * meses", "há 1 ano" — dois deles ARQUIVADOS. Um filtro de sete dias trazendo
 * processo parado há um ano parece, com razão, quebrado.
 *
 * A causa: o filtro casava `movimentacoesInternas.createdAt` sem olhar a
 * origem, e QUATRO das notas recentes eram do próprio sistema ("Processo
 * encerrado automaticamente: todas as instâncias receberam baixa"). O chip de
 * ATIVIDADE acendia exatamente quando o robô ARQUIVAVA o processo.
 */
describe('filtro "Andamento do tribunal"', () => {
  const recentes = SERVICE.slice(
    SERVICE.indexOf('recentes: (dias: number'),
    SERVICE.indexOf('urgentes:'),
  );

  it('o trecho existe (o teste não olha para o vazio)', () => {
    // O corpo é curto de propósito — a explicação mora no comentário ACIMA da
    // função, que fica fora deste recorte.
    expect(recentes.length).toBeGreaterThan(120);
  });

  /**
   * O CHIP VOLTOU A SER SÓ DO TRIBUNAL, e o rótulo passou a dizer isso.
   *
   * Contar nota interna resolvia a papelada do robô mas mantinha o descompasso
   * de fundo: a coluna mostrava o andamento do CNJ e o filtro contava outra
   * coisa. O conserto certo não era ampliar o significado — era ajustar a
   * JANELA, porque o índice público atrasa (mediana de 41 dias, medida em
   * 31/08/2026; o andamento mais novo do acervo tinha 24).
   */
  it('conta SÓ o andamento do CNJ', () => {
    expect(recentes).toContain('movimentacoes: {');
    expect(recentes).toContain('dataMovimento: { gte:');
    expect(recentes).not.toContain('movimentacoesInternas');
  });

  it('a janela padrão é de 30 dias — em 7 o filtro era zero por construção', () => {
    expect(SERVICE).toMatch(/FILTRO_RAPIDO\.recentes\(30, agora\)/);
    expect(SERVICE).toMatch(/Number\(q\.movimentacaoRecente\) \|\| 30/);
  });

});

/**
 * O QUE O FILTRO CONTA, A COLUNA MOSTRA.
 *
 * Era esse descompasso que fazia a tela parecer quebrada: o filtro contava a
 * nota da equipe, a coluna mostrava só o tribunal, e as duas respondiam
 * perguntas diferentes com o mesmo nome.
 */
describe('coluna "última movimentação"', () => {
  const bloco = SERVICE.slice(
    SERVICE.indexOf('ultimaMovimentacao: (() =>'),
    SERVICE.indexOf('etiquetasAutomaticas:'),
  );

  it('o trecho existe', () => {
    expect(bloco.length).toBeGreaterThan(300);
  });

  it('escolhe a mais recente entre tribunal e equipe', () => {
    expect(bloco).toMatch(/cnj && \(!dNota \|\| cnj\.dataMovimento >= dNota\)/);
  });

  it('diz de onde veio — publicação oficial não é anotação interna', () => {
    expect(bloco).toContain("origem: 'TRIBUNAL' as const");
    expect(bloco).toContain("origem: 'EQUIPE' as const");
  });

  it('a nota do robô nem chega aqui — é excluída no `select`', () => {
    const select = SERVICE.slice(
      SERVICE.indexOf('movimentacoesInternas: {', SERVICE.indexOf('const [total, items]')),
      SERVICE.indexOf('instancias: {', SERVICE.indexOf('const [total, items]')),
    );
    expect(select).toContain('where: { origemSistema: false }');
  });

  /**
   * `dataDaNota` é UMA função para as duas leituras (o aviso de dormência e a
   * coluna). Duas cópias divergiriam na primeira correção — foi assim que a
   * coluna e o filtro se separaram.
   */
  it('a regra da data da nota mora num lugar só', () => {
    expect(SERVICE).toContain('function dataDaNota(');
    const usos = SERVICE.match(/dataDaNota\(/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(3); // a definição + os dois usos
  });
});

/**
 * A ORDENAÇÃO SOFRIA DO MESMO MAL.
 *
 * `ultimoMovimentoEm` é mantida por gatilho a cada nota interna inserida, sem
 * distinguir origem — então os mesmos quatro processos subiam ao TOPO de
 * "Movimentação recente" no dia em que o robô os encerrou. Medido: 4 dos 47.
 */
describe('migração: o gatilho ignora a nota do sistema', () => {
  it('a coluna nasce NOT NULL com default — o contêiner antigo continua escrevendo', () => {
    expect(MIGRACAO).toMatch(/ADD COLUMN IF NOT EXISTS "origem_sistema" BOOLEAN NOT NULL DEFAULT false/);
  });

  it('o gatilho sai cedo quando a nota é do sistema', () => {
    expect(MIGRACAO).toMatch(/IF NEW\."origem_sistema" THEN\s*\n\s*RETURN NEW;/);
  });

  it('o backfill marca as notas que já existiam', () => {
    expect(MIGRACAO).toMatch(/SET "origem_sistema" = true[\s\S]*?WHERE "autor_id" IS NULL AND "status_novo" IS NOT NULL/);
  });

  /**
   * O gatilho SÓ AVANÇA — ele nunca corrigiria sozinho um valor alto demais
   * deixado pela contaminação. A coluna precisa ser reescrita do zero.
   */
  it('a coluna é RECALCULADA, não só corrigida daqui para frente', () => {
    const recalculo = MIGRACAO.slice(MIGRACAO.indexOf('--------------- recalculo'));
    expect(recalculo).toContain('UPDATE "processos" p');
    expect(recalculo).toContain('"origem_sistema" = false');
  });
});

/**
 * As três notas que `reavaliarStatusPorInstancias` grava (encerramento
 * automático, reabertura automática e PENDENTE→ATIVO) são do robô e precisam
 * declarar isso — senão a coluna e o filtro voltam a contá-las.
 */
describe('as notas do robô se declaram', () => {
  it('toda nota sem autor humano marca `origemSistema`', () => {
    const criacoes = SERVICE.split('movimentacaoInterna.create').slice(1);
    expect(criacoes.length).toBeGreaterThanOrEqual(3);
    for (const bruto of criacoes) {
      const corpo = bruto.slice(0, bruto.indexOf('});'));
      // Ou tem autor humano, ou se declara do sistema. Nunca nenhum dos dois.
      const temAutor = /autorId/.test(corpo);
      const declara = /origemSistema: true/.test(corpo);
      expect(temAutor || declara).toBe(true);
    }
  });
});
