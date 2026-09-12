import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { comparavelParte, ehONossoSindicato, lerPartesDoAto } from './partes-do-diario.service';

/** A sigla do cadastro institucional — é ela que nos reconhece no ato. */
const SIGLA = 'SENATEPI';

/** Açúcar: todo teste passa a mesma sigla, então ela fica implícita. */
const ler = (
  pubs: Parameters<typeof lerPartesDoAto>[0],
  ficha: Parameters<typeof lerPartesDoAto>[1],
  dispensadas: Set<string> = new Set(),
) => lerPartesDoAto(pubs, ficha, dispensadas, SIGLA);

const SERVICO = readFileSync(join(__dirname, 'partes-do-diario.service.ts'), 'utf8');
const CRON = readFileSync(join(__dirname, 'djen-sync.service.ts'), 'utf8');
const PARTES = readFileSync(join(__dirname, 'partes.service.ts'), 'utf8');
const MIGRACAO = readFileSync(
  join(__dirname, '../../../prisma/migrations/20260912050000_partes_do_diario/migration.sql'),
  'utf8',
);

const NOS = 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI';
const NOS_CADASTRO = 'SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ';

const pub = (destinatarios: { nome: string; polo: string }[], advogados: { nome: string }[] = []) => ({
  destinatarios,
  advogados,
});
const naFicha = (linhas: [string, string, boolean?][]) =>
  linhas.map(([nome, polo, institucional]) => ({
    nome,
    polo,
    parteExterna: institucional ? { institucional: true } : null,
  }));

/**
 * O ATO DIZ QUEM ESTÁ NO PROCESSO — e a ficha não tinha.
 *
 * Medido na produção em 12/09/2026: das 108 fichas com publicação, 43 têm parte
 * que o tribunal nomeia e que ninguém cadastrou (51 partes). O DataJud não
 * devolve partes, então tudo dependia de alguém copiar do PJe à mão — e copiar
 * trinta nomes de um litisconsórcio ninguém faz.
 */
describe('a parte que o Diário nomeia entra na ficha', () => {
  it('acrescenta quem falta, no polo que o ato diz', () => {
    const r = ler(
      [pub([{ nome: 'CLINICA SANTA FE LTDA', polo: 'P' }, { nome: NOS, polo: 'A' }])],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([{ nome: 'CLINICA SANTA FE LTDA', polo: 'PASSIVO' }]);
    expect(r.duvida).toEqual([]);
  });

  it('não repete quem já está lá, mesmo com acento e pontuação diferentes', () => {
    const r = ler(
      [pub([{ nome: 'MUNICIPIO DE SAO JOAO DA VARJOTA', polo: 'P' }])],
      naFicha([['Município de São João da Varjota', 'PASSIVO']]),
      new Set(),
    );
    expect(r.repor).toEqual([]);
  });

  /**
   * ADVOGADO NÃO É PARTE — e o Diário repete o nome dele entre os destinatários.
   *
   * Sem esta recusa, "MURILO MARCONES ALVES VELOSO" entrava como AUTOR dos
   * processos em que ele atua. Na simulação sobre a produção foram 16 nomes de
   * advogado prestes a virar parte.
   */
  it('recusa o advogado que aparece na lista de destinatários', () => {
    const r = ler(
      [
        pub(
          [
            { nome: 'MURILO MARCONES ALVES VELOSO', polo: 'A' },
            { nome: 'RANIERY AUGUSTO DO NASCIMENTO ALMEIDA', polo: 'A' },
            { nome: 'MUNICIPIO DE PARNAGUA', polo: 'P' },
          ],
          [{ nome: 'MURILO MARCONES ALVES VELOSO' }, { nome: 'RANIERY AUGUSTO DO NASCIMENTO ALMEIDA' }],
        ),
      ],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([{ nome: 'MUNICIPIO DE PARNAGUA', polo: 'PASSIVO' }]);
  });

  /**
   * O POLO DE UM RECURSO NÃO É O DA AÇÃO — caso real do 0001095-45.2025.5.22.0004.
   *
   * O Diário põe a EBSERH como `A` e o sindicato como `P` porque quem recorreu
   * foi a empresa; na ação, o sindicato é o autor. Posicionar MARCOS pelo polo
   * do ato o colocaria no lado errado da ficha para sempre.
   */
  it('quando o lado do sindicato discorda da ficha, ninguém é posicionado', () => {
    const r = ler(
      [
        pub([
          { nome: 'EMPRESA BRASILEIRA DE SERVICOS HOSPITALARES - EBSERH', polo: 'A' },
          { nome: 'MARCOS DENHILSON BENVINDO ITALIANO', polo: 'A' },
          { nome: NOS, polo: 'P' },
        ]),
      ],
      naFicha([
        [NOS_CADASTRO, 'ATIVO', true],
        ['EMPRESA BRASILEIRA DE SERVICOS HOSPITALARES - EBSERH', 'PASSIVO'],
      ]),
      new Set(),
    );
    expect(r.repor).toEqual([]);
    expect(r.duvida).toHaveLength(1);
    expect(r.duvida[0].nome).toBe('MARCOS DENHILSON BENVINDO ITALIANO');
    expect(r.duvida[0].porque).toContain('RECURSO');
    // A frase tem de fazer sentido em voz alta: dois lados DIFERENTES.
    expect(r.duvida[0].porque).toContain('sindicato no polo passivo');
    expect(r.duvida[0].porque).toContain('a ficha no ativo');
  });

  /**
   * QUANDO O ATO NOMEIA O PRÓPRIO SINDICATO NOS DOIS POLOS.
   *
   * Acontece em 2 dos 45 processos com dúvida na produção — e a primeira versão
   * da explicação saía contraditória ("o Diário põe o sindicato no polo ativo e
   * a ficha no ativo"), porque imprimia só o primeiro dos dois lados.
   */
  it('explica direito quando o ato nos põe nos dois lados', () => {
    const r = ler(
      [
        pub([{ nome: NOS, polo: 'A' }, { nome: 'MUNICIPIO DE COCAL', polo: 'P' }]),
        pub([{ nome: NOS, polo: 'P' }, { nome: 'MUNICIPIO DE COCAL', polo: 'P' }]),
      ],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([]);
    expect(r.duvida[0].porque).toContain('nos DOIS polos');
    expect(r.duvida[0].porque).not.toContain('e a ficha no');
  });

  it('parte que o ato lista nos dois polos fica para uma pessoa', () => {
    const r = ler(
      [
        pub([{ nome: 'HAPVIDA ASSISTENCIA MEDICA LTDA', polo: 'A' }, { nome: NOS, polo: 'A' }]),
        pub([{ nome: 'HAPVIDA ASSISTENCIA MEDICA LTDA', polo: 'P' }, { nome: NOS, polo: 'A' }]),
      ],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([]);
    expect(r.duvida[0].porque).toContain('nos dois polos');
  });

  /** Quem foi tirado à mão não volta na madrugada seguinte. */
  it('respeita a lápide', () => {
    const dispensada = new Set([comparavelParte('CLINICA SANTA FE LTDA')]);
    const r = ler(
      [pub([{ nome: 'CLINICA SANTA FE LTDA', polo: 'P' }])],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
      dispensada,
    );
    expect(r.repor).toEqual([]);
    expect(r.duvida).toEqual([]);
  });

  it('sem publicação, não faz nada', () => {
    expect(ler([], naFicha([]), new Set())).toEqual({ repor: [], duvida: [] });
  });

  /**
   * O CASO QUE COMEÇOU TUDO: o sindicato como RÉU.
   *
   * No 0000724-10.2017.5.10.0000 a FASUBRA processa onze sindicatos, o SENATEPI
   * entre eles. Com a ficha já reparada, o ato não tem nada a repor — e é isso
   * que prova que a reconciliação não fica cutucando processo já correto.
   */
  it('ficha completa não gera trabalho nenhum', () => {
    const r = ler(
      [
        pub([
          { nome: 'FEDERAÇÃO DE SINDICATOS - FASUBRA', polo: 'A' },
          { nome: NOS, polo: 'P' },
        ]),
      ],
      naFicha([
        ['FEDERAÇÃO DE SINDICATOS - FASUBRA', 'ATIVO'],
        [NOS_CADASTRO, 'PASSIVO', true],
      ]),
      new Set(),
    );
    expect(r).toEqual({ repor: [], duvida: [] });
  });
});

/**
 * O NOME DO SINDICATO NO ATO NÃO É O DO CADASTRO — e comparar os dois foi o
 * defeito que este arquivo pegou antes de subir.
 *
 * Com a comparação por nome inteiro aconteciam duas coisas ruins de uma vez: a
 * bússola do polo recursal nunca disparava, e o próprio sindicato voltava como
 * uma SEGUNDA parte, escrito do jeito do tribunal, ao lado do cadastro.
 */
describe('o sindicato se reconhece pela sigla', () => {
  it('acha a sigla no nome que o tribunal escreve', () => {
    expect(ehONossoSindicato(NOS, SIGLA)).toBe(true);
    expect(ehONossoSindicato('2. SINDICATO DOS ENFERMEIROS - SENATEPI (RECORRIDO)', SIGLA)).toBe(true);
  });

  it('não confunde outro sindicato com o nosso', () => {
    expect(ehONossoSindicato('SINDICATO DOS TRABALHADORES EM SAUDE DO PIAUI', SIGLA)).toBe(false);
    expect(ehONossoSindicato('SINDSERM', SIGLA)).toBe(false);
  });

  it('exige palavra inteira — não casa dentro de outra', () => {
    expect(ehONossoSindicato('PROSENATEPINHO LTDA', SIGLA)).toBe(false);
  });

  it('sigla curta demais não serve de chave', () => {
    expect(ehONossoSindicato('EMPRESA ABC LTDA', 'ABC')).toBe(false);
  });

  it('e o cadastro não vira uma segunda parte com o nome do tribunal', () => {
    const r = ler(
      [pub([{ nome: NOS, polo: 'A' }, { nome: 'CLINICA SANTA FE LTDA', polo: 'P' }])],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor.map((x) => x.nome)).toEqual(['CLINICA SANTA FE LTDA']);
  });
});

/** A régua de comparação tem de ser a mesma do resto da casa. */
describe('a régua de nome', () => {
  it('ignora acento, caixa, pontuação e espaço', () => {
    expect(comparavelParte(' Município de São João ')).toBe(comparavelParte('MUNICIPIO DE SAO JOAO'));
    expect(comparavelParte('LUZ SANTOS LTDA - ME')).toBe(comparavelParte('luz santos ltda me'));
  });
  it('nomes diferentes continuam diferentes', () => {
    expect(comparavelParte('MUNICIPIO DE COCAL')).not.toBe(comparavelParte('MUNICIPIO DE COCAL DOS ALVES'));
  });
});

describe('o robô roda sozinho e não desfaz decisão de gente', () => {
  it('a varredura da madrugada chama a reconciliação', () => {
    expect(CRON).toContain('await this.reporPartesDoAto();');
    expect(CRON).toContain('this.partesDoDiario.reconciliarTodos()');
  });

  it('a parte reposta fica marcada como vinda do Diário', () => {
    expect(SERVICO).toContain("origem: 'DJEN'");
  });

  it('nunca desbanca a parte principal que já existia', () => {
    expect(SERVICO).toContain('principal: !temPrincipal');
  });

  it('remover uma parte à mão grava a lápide', () => {
    const fn = PARTES.slice(PARTES.indexOf('async remover(parteId: string'));
    expect(fn.slice(0, 2600)).toContain('parteProcessoDispensada.upsert');
    expect(fn.slice(0, 2600)).toContain('dispensadoPor: ctx.userId');
  });

  it('a reconciliação só acrescenta — nunca apaga nem reescreve parte', () => {
    const fn = SERVICO.slice(SERVICO.indexOf('async reconciliar(processoId'));
    expect(fn).toContain('tx.parteProcesso.create');
    expect(fn).not.toContain('parteProcesso.delete');
    expect(fn).not.toContain('parteProcesso.update');
  });
});

/** A janela de troca do deploy exige migração aditiva e idempotente. */
describe('a migração é segura na janela de troca', () => {
  it('só acrescenta, e roda duas vezes sem quebrar', () => {
    expect(MIGRACAO).toContain('ADD COLUMN IF NOT EXISTS "origem" TEXT');
    expect(MIGRACAO).toContain('CREATE TABLE IF NOT EXISTS "partes_processo_dispensadas"');
    expect(MIGRACAO).toContain('CREATE INDEX IF NOT EXISTS');
    expect(MIGRACAO).not.toContain('DROP ');
    expect(MIGRACAO).not.toContain('RENAME ');
    expect(MIGRACAO).not.toMatch(/ADD COLUMN[^;]+NOT NULL(?![^;]*DEFAULT)/);
  });
});
