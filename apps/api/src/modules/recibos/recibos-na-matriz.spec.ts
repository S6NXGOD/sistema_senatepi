import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULO_KEYS, PRESETS_PERFIL, nivelEfetivo } from '../../common/permissions/permissoes.constants';
import { senatepi } from '../../tenant/tenants/senatepi';
import { sindserm } from '../../tenant/tenants/sindserm';

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CONTROLLER = readFileSync(join(__dirname, 'recibos.controller.ts'), 'utf8').replace(/\r/g, '');
const CODIGO = semComentarios(CONTROLLER);
const SCHEMA = readFileSync(
  join(__dirname, '../../../prisma/schema.prisma'),
  'utf8',
).replace(/\r/g, '');
const MIGRACAO = readFileSync(
  join(__dirname, '../../../prisma/migrations/20261006120000_recibos/migration.sql'),
  'utf8',
).replace(/\r/g, '');

/**
 * QUEM PODE EMITIR UM RECIBO — a decisão de permissão deste módulo, por escrito.
 *
 * `recibos` nasceu como MÓDULO PRÓPRIO, e não como aba de `cobrancas`. A razão
 * é uma medição: na produção de 06/10/2026 há 4 usuários de TRIAGEM, e o preset
 * do perfil tem `cobrancas: SEM_ACESSO`. Quem recebe dinheiro no balcão é
 * justamente a Triagem — pendurar o recibo em Cobranças daria o absurdo de a
 * pessoa que pega o dinheiro não poder entregar o papel.
 *
 * O preço de uma chave nova está pago e contado: uma linha a mais na matriz de
 * cada usuário, e uma linha a mais no menu do administrador (a rolagem da
 * lateral dele foi de 89 para 127 px — ver `abas-do-acervo.spec.ts`).
 */
describe('o módulo recibos na matriz', () => {
  it('é chave própria, e a matriz inteira continua declarada', () => {
    expect(MODULO_KEYS).toContain('recibos');
    // Nenhum perfil pode ficar sem a chave: ausência no preset é SEM_ACESSO
    // silencioso, e silêncio aqui é o defeito que a tela não explica.
    for (const perfil of Object.keys(PRESETS_PERFIL) as (keyof typeof PRESETS_PERFIL)[]) {
      expect(PRESETS_PERFIL[perfil]).toHaveProperty('recibos');
    }
  });

  it('o balcão emite; quem litiga, não', () => {
    expect(PRESETS_PERFIL.TRIAGEM.recibos).toBe('EDITAR');
    expect(PRESETS_PERFIL.COORDENACAO.recibos).toBe('EDITAR');
    expect(PRESETS_PERFIL.ADVOGADO.recibos).toBe('SEM_ACESSO');
    // E a razão de não ser aba de cobranças, travada aqui:
    expect(PRESETS_PERFIL.TRIAGEM.cobrancas).toBe('SEM_ACESSO');
  });

  /** As duas perguntas são independentes — é para isso que a chave é própria. */
  it('ter cobranças não dá recibo, e ter recibo não dá cobranças', () => {
    expect(nivelEfetivo('TRIAGEM' as never, { cobrancas: 'EDITAR' }, 'recibos')).toBe('EDITAR');
    expect(nivelEfetivo('ADVOGADO' as never, { cobrancas: 'EDITAR' }, 'recibos')).toBe('SEM_ACESSO');
    expect(nivelEfetivo('ADVOGADO' as never, { recibos: 'EDITAR' }, 'cobrancas')).toBe('SEM_ACESSO');
  });
});

describe('o controller segue a matriz, e só ela', () => {
  it('declara o módulo nos dois decoradores', () => {
    expect(CODIGO).toContain("@ModuloTenant('recibos')");
    expect(CODIGO).toContain("@Modulo('recibos')");
  });

  /**
   * SEM `@Roles` — `senatepi-matriz-e-a-unica-politica`. Um perfil chumbado
   * aqui seria uma segunda autorização que a tela de permissões não mostra e
   * que o administrador não consegue sobrepor.
   */
  it('não existe segunda política', () => {
    expect(CODIGO).not.toMatch(/(^|\s)@Roles\(/m);
    expect(CODIGO).not.toContain('@OperacaoDeSistema()');
    expect(CODIGO).not.toContain('@ExclusaoDelegada()');
  });

  /**
   * A ROTA ESTÁTICA VEM ANTES DE `:id` — `senatepi-rotas-que-colidem`. Com
   * `@Get(':id')` registrado primeiro, `/recibos/pendentes` cairia nele e a
   * fila de trabalho inteira responderia "Recibo não encontrado".
   */
  it('pendentes é declarada antes de :id', () => {
    const pendentes = CODIGO.indexOf("@Get('pendentes')");
    const porId = CODIGO.indexOf("@Get(':id')");
    expect(pendentes).toBeGreaterThanOrEqual(0);
    expect(porId).toBeGreaterThan(pendentes);
  });

  /**
   * CANCELAR É PATCH, e não DELETE. Não é uma esquiva da trava global de
   * exclusão ("só o Administrador apaga"): é que nada é apagado — o número
   * fica queimado, com motivo e autor, e a linha permanece no acervo.
   */
  it('não há rota de apagar recibo', () => {
    expect(CODIGO).toContain("@Patch(':id/cancelar')");
    expect(CODIGO).not.toContain('@Delete(');
  });
});

/**
 * O MÓDULO É DO SENATEPI — e a ausência no SINDSERM é decisão, não esquecimento.
 *
 * O SINDSERM não contrata `cobrancas`: a contribuição dele vem por desconto em
 * folha da Prefeitura, e não há conta de caixa cadastrada. Uma tela de recibo
 * ali seria uma tela sem dinheiro para receber. O código é compartilhado; ligar
 * é acrescentar `'recibos'` à lista do tenant, nos dois lados.
 */
describe('a instalação decide se tem a tela', () => {
  it('o SENATEPI tem; o SINDSERM não', () => {
    expect(senatepi.modulos).toContain('recibos');
    expect(sindserm.modulos).not.toContain('recibos');
  });

  /** E a razão: lá não há o módulo financeiro que daria lastro ao recibo. */
  it('onde não há caixa, não há recibo', () => {
    expect(sindserm.modulos).not.toContain('cobrancas');
  });
});

/**
 * A MIGRAÇÃO É ADITIVA E IDEMPOTENTE — `senatepi-ddl-a-mao-derruba-o-deploy` e
 * `senatepi-deploy-janela-de-troca`. Durante a troca de contêiner, o antigo
 * atende contra o banco JÁ migrado: tabela nova ele ignora, mas um `ALTER` numa
 * tabela existente, ou um valor novo em enum existente, o derruba.
 */
describe('o banco do recibo', () => {
  it('a migração só cria, e cria se não existir', () => {
    expect(MIGRACAO).toContain('CREATE TABLE IF NOT EXISTS "recibos"');
    expect(MIGRACAO).not.toMatch(/ALTER TABLE "(?!recibos")/);
    expect(MIGRACAO).not.toContain('DROP ');
    expect(MIGRACAO).not.toContain('ALTER TYPE');
    for (const idx of [
      'recibos_exercicio_numero_key',
      'recibo_vivo_por_movimentacao',
      'recibo_vivo_por_parcela',
    ]) {
      expect(MIGRACAO).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS "${idx}"`);
    }
  });

  /**
   * UM RECIBO **VIVO** POR LASTRO, por índice PARCIAL — e não por `@unique`.
   *
   * O `@unique` de coluna estava lá e passou em 26 testes de unidade. O que o
   * derrubou foi chamar a rota: cancelar e reemitir do MESMO lançamento (a
   * razão número um de cancelar) batia na unicidade e devolvia 500. O índice
   * parcial conta só o que está vivo; o cancelado continua apontando para o
   * lastro, que é o que mantém a trilha.
   */
  it('a unicidade do lastro ignora o cancelado', () => {
    for (const idx of ['recibo_vivo_por_movimentacao', 'recibo_vivo_por_parcela']) {
      const i = MIGRACAO.indexOf(idx);
      expect(i).toBeGreaterThan(0);
      expect(MIGRACAO.slice(i, i + 220)).toContain('WHERE "cancelado_em" IS NULL');
    }
    // E a coluna NÃO é `@unique` no modelo: se voltar a ser, o 500 volta.
    const modelo = SCHEMA.slice(SCHEMA.indexOf('model Recibo {'));
    const corpo = modelo.slice(0, modelo.indexOf('\n}'));
    expect(corpo).not.toMatch(/movimentacaoId String\? @unique/);
    expect(corpo).not.toMatch(/parcelaId\s+String\? @unique/);
  });

  /**
   * A FORMA DE PAGAMENTO É TEXTO, E NÃO ENUM. As formas mudam (hoje PIX, ontem
   * boleto) e acrescentar valor a enum existente faz o Prisma do contêiner
   * ANTIGO estourar ao ler a linha — derrubando a listagem inteira, não só
   * aquela. Mesma decisão do comprovante da parcela, em 25/09/2026.
   */
  it('forma de pagamento é texto livre', () => {
    expect(MIGRACAO).toContain('"forma_pagamento"  TEXT NOT NULL');
    expect(SCHEMA).toContain("formaPagamento String @map(\"forma_pagamento\")");
  });

  /**
   * O NÚMERO NÃO SE REPETE DENTRO DO EXERCÍCIO, e quem garante é o BANCO. A
   * trava de transação no serviço evita a colisão; este índice é o que impede
   * que duas vias com números diferentes circulem se a trava falhar.
   */
  it('o par exercício+número é único no banco', () => {
    expect(SCHEMA).toContain('@@unique([exercicio, numero])');
  });

  /**
   * APAGAR A COBRANÇA NÃO APAGA O RECIBO. `SetNull`, e nunca `Cascade`: o papel
   * já está na mão de alguém, e some do sistema não o faz sumir do mundo.
   */
  it('as ligações são SetNull, não Cascade', () => {
    const modelo = SCHEMA.slice(SCHEMA.indexOf('model Recibo {'));
    const corpo = modelo.slice(0, modelo.indexOf('\n}'));
    expect(corpo.match(/onDelete: SetNull/g)).toHaveLength(4);
    expect(corpo).not.toContain('onDelete: Cascade');
  });
});
