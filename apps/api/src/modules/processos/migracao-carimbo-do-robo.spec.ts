import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { MOTIVO_ANDAMENTO_ANTIGO_LEGADO } from './automacao-prazos.service';

/**
 * A MIGRAÇÃO DO CARIMBO DO ROBÔ (17/09/2026) — colunas próprias, e o conserto
 * das linhas que o carimbo errado venha a produzir.
 *
 * Sem Postgres no teste, o SQL não roda aqui. O que se prova sem ele:
 *   · as três colunas existem no client com o tipo certo e opcionais;
 *   · é ADITIVA: nada de DROP, RENAME, NOT NULL nem ALTER COLUMN;
 *   · é IDEMPOTENTE: toda ADD COLUMN com IF NOT EXISTS, e o único UPDATE se
 *     desarma sozinho na segunda execução (a coluna que ele testa fica NULL);
 *   · o UPDATE NUNCA alcança dispensa feita por gente — duas travas.
 *
 * O SQL é lido SEM comentários: a migração explica em prosa justamente o que
 * não faz, e uma negativa casaria com a explicação. (Foi assim que um
 * `not.toContain` em português reprovou o arquivo já corrigido nesta base.)
 */
const PASTA = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
const NOVA = '20260917100000_carimbo_do_robo';

const cru = readFileSync(join(PASTA, NOVA, 'migration.sql'), 'utf8');
const sql = cru.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();

describe('as colunas do robô existem no client', () => {
  const modelo = Prisma.dmmf.datamodel.models.find((m) => m.name === 'MovimentacaoProcessual')!;
  const campo = (nome: string) => modelo.fields.find((f) => f.name === nome);

  /*
    O `@map` ENTRA NA PROVA. Conferir só nome e tipo do campo deixaria passar o
    único jeito de schema e SQL divergirem sem ninguém ver: um `@map` errado no
    schema (ou uma coluna com outro nome no SQL) mantém os testes verdes, o
    client acha que a coluna existe, e a primeira leitura da ficha estoura com
    "column does not exist" — em produção, não aqui.
  */
  it.each([
    ['avaliadoEm', 'avaliado_em', 'DateTime'],
    ['avaliadoPor', 'avaliado_por', 'String'],
    ['avaliadoMotivo', 'avaliado_motivo', 'String'],
  ])('%s vira a coluna %s, do tipo %s e opcional', (nome, coluna, tipo) => {
    const f = campo(nome)!;
    expect(f).toBeDefined();
    expect(f.type).toBe(tipo);
    expect(f.isRequired).toBe(false);
    expect(f.dbName ?? f.name).toBe(coluna);
    expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS "${coluna}"`));
  });

  it('a dispensa humana continua existindo, intacta', () => {
    // O conserto separa as duas decisões; não apaga a da pessoa.
    for (const nome of ['dispensadoEm', 'dispensadoPor', 'dispensadoMotivo']) {
      expect(campo(nome)).toBeDefined();
    }
  });

  /**
   * `avaliadoPor` sem chave estrangeira: é trilha de decisão, e apagar a pessoa
   * não pode travar nem ser travado por isto — o mesmo desenho de
   * `dispensadoPor` e de `tarefa_decidida_por`.
   */
  it('`avaliadoPor` não puxa relação', () => {
    expect(campo('avaliadoPor')!.relationName).toBeUndefined();
    expect(sql).not.toMatch(/FOREIGN KEY/i);
  });
});

describe('aditiva e idempotente', () => {
  it('as três colunas são criadas com guarda', () => {
    const adicoes = sql.match(/ADD COLUMN/gi) ?? [];
    const guardadas = sql.match(/ADD COLUMN IF NOT EXISTS/gi) ?? [];
    expect(adicoes.length).toBe(3);
    expect(guardadas.length).toBe(adicoes.length);
  });

  it('nada é derrubado, renomeado nem tornado obrigatório', () => {
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });

  it('não cria índice: as colunas são lidas com a linha, nunca filtradas sozinhas', () => {
    expect(sql).not.toMatch(/CREATE( UNIQUE)? INDEX/i);
  });
});

/**
 * O ÚNICO UPDATE — e ele MOVE, não inventa.
 *
 * Não é backfill: a decisão existe, foi gravada e está na coluna errada. Ela vai
 * para as colunas novas com a MESMA data, e a dispensa volta a NULL nessas
 * linhas — que é o que devolve o selo âmbar a elas.
 */
describe('a mudança das linhas carimbadas por engano', () => {
  const update = sql.slice(sql.search(/UPDATE /i));

  it('há exatamente um UPDATE, e nenhum INSERT ou DELETE', () => {
    expect((sql.match(/\bUPDATE\b/gi) ?? []).length).toBe(1);
    expect(sql).not.toMatch(/\bINSERT\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });

  it('a data da decisão é preservada — não vira a data da migração', () => {
    expect(update).toMatch(/"avaliado_em"\s*=\s*"dispensado_em"/);
    expect(update).not.toMatch(/now\(\)/i);
  });

  it('o motivo passa a valer o vocabulário que o código conhece', () => {
    // `ANDAMENTO_ANTIGO_SEM_TEOR` foi o nome de algumas horas; um motivo que o
    // código não conhece é um motivo que a tela não consegue explicar.
    expect(update).toMatch(/"avaliado_motivo"\s*=\s*'ANDAMENTO_ANTIGO'/);
    expect(update).toMatch(/"dispensado_motivo" = 'ANDAMENTO_ANTIGO_SEM_TEOR'/);
  });

  it('a dispensa volta a NULL nessas linhas — é o que reacende o selo', () => {
    for (const col of ['dispensado_em', 'dispensado_por', 'dispensado_motivo']) {
      expect(update).toMatch(new RegExp(`"${col}"\\s*=\\s*NULL`));
    }
  });

  /**
   * DUAS TRAVAS PARA NUNCA TOCAR EM DISPENSA DE GENTE: o motivo é exatamente o
   * que só o robô escreveu, E `dispensado_por IS NULL` — quando é uma pessoa, o
   * id dela está lá.
   */
  it('nunca alcança dispensa feita por uma pessoa', () => {
    expect(update).toMatch(/"dispensado_por" IS NULL/);
  });

  /**
   * IDEMPOTENTE POR CONSTRUÇÃO: a condição olha `dispensado_motivo`, que o
   * próprio UPDATE zera. Na segunda execução nenhuma linha casa.
   */
  it('a segunda execução não encontra mais nada para mover', () => {
    const condicao = update.slice(update.search(/WHERE/i));
    expect(condicao).toMatch(/"dispensado_motivo" = 'ANDAMENTO_ANTIGO_SEM_TEOR'/);
    const atribuicoes = update.slice(0, update.search(/WHERE/i));
    expect(atribuicoes).toMatch(/"dispensado_motivo" = NULL/);
  });
});

/**
 * A MIGRAÇÃO SOZINHA NÃO FECHA O BURACO — a janela de troca do deploy reabre.
 *
 * O deploy desta casa é em duas fases contra o MESMO banco: a migração roda
 * antes e o contêiner ANTIGO continua atendendo enquanto o novo sobe. É ele que
 * escreve `ANDAMENTO_ANTIGO_SEM_TEOR` nas colunas de gente. Uma sincronização
 * nessa janela — ou o cron das 02h caindo nela — recria exatamente o defeito que
 * a migração existe para desfazer, e dessa vez sem conserto: a migração é de
 * tiro único, o código novo não lê `dispensado_*` do robô, e sem selo âmbar não
 * há cartão com "Desfazer" para uma pessoa consertar à mão.
 *
 * Por isso o mesmo UPDATE roda em TODA varredura, com as mesmas duas travas.
 */
describe('o reparo também mora no código, e não só na migração', () => {
  const FONTE = readFileSync(join(__dirname, 'automacao-prazos.service.ts'), 'utf8');
  const reparo = FONTE.slice(FONTE.indexOf('private async repararCarimboNasColunasDeGente'));
  const corpo = reparo.slice(0, reparo.indexOf('private async avaliarPrazo'));

  it('o literal do motivo antigo é um só, nos dois lados', () => {
    // O SQL da migração e o reparo têm de procurar exatamente a mesma palavra.
    expect(MOTIVO_ANDAMENTO_ANTIGO_LEGADO).toBe('ANDAMENTO_ANTIGO_SEM_TEOR');
    expect(sql).toContain(MOTIVO_ANDAMENTO_ANTIGO_LEGADO);
  });

  it('o reparo carrega as DUAS travas da migração', () => {
    expect(corpo).toContain('MOTIVO_ANDAMENTO_ANTIGO_LEGADO');
    expect(corpo).toMatch(/"dispensado_por" IS NULL/);
  });

  it('preserva a data original da decisão do robô', () => {
    expect(corpo).toMatch(/COALESCE\("avaliado_em", "dispensado_em"\)/);
    expect(corpo).not.toMatch(/now\(\)/i);
  });

  it('roda em toda varredura, antes de avaliar qualquer andamento', () => {
    const processar = FONTE.slice(FONTE.indexOf('async processar('));
    const ateOLaco = processar.slice(0, processar.indexOf('for (const mov of ordenadas)'));
    expect(ateOLaco).toContain('await this.repararCarimboNasColunasDeGente(processoId)');
  });
});
