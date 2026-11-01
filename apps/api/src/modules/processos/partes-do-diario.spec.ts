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
  daCasa: string[] = EQUIPE,
) => lerPartesDoAto(pubs, ficha, dispensadas, SIGLA, daCasa);

/** Os advogados do escritório, como o cadastro os guarda. */
const EQUIPE = ['Carlos Henrique de Alencar Vieira', 'Murilo Marcones', 'Morgana Nualla'];

const SERVICO = readFileSync(join(__dirname, 'partes-do-diario.service.ts'), 'utf8');
const CRON = readFileSync(join(__dirname, 'djen-sync.service.ts'), 'utf8');
const PARTES = readFileSync(join(__dirname, 'partes.service.ts'), 'utf8');
const MIGRACAO = readFileSync(
  join(__dirname, '../../../prisma/migrations/20260912050000_partes_do_diario/migration.sql'),
  'utf8',
);

const NOS = 'SINDICATO DOS ENFERMEIROS, AUXILIARES E TECNICOS EM ENFERMAGEM DO ESTADO DO PIAUI - SENATEPI';
const NOS_CADASTRO = 'SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ';

/**
 * Um ato da AÇÃO, em primeiro grau — o caso comum e o único em que o lado
 * publicado posiciona alguém. Quem quiser testar recurso diz a classe.
 */
const pub = (
  destinatarios: { nome: string; polo: string }[],
  advogados: { nome: string }[] = [],
  classeENumero: { nomeClasse: string | null; numeroProcesso: string | null } = {
    nomeClasse: 'AÇÃO TRABALHISTA - RITO ORDINÁRIO',
    numeroProcesso: '00009785920225220004',
  },
) => ({ destinatarios, advogados, ...classeENumero });

/** O mesmo ato, publicado como RECURSO dentro do número da ação de origem. */
const pubDeRecurso = (destinatarios: { nome: string; polo: string }[], advogados: { nome: string }[] = []) =>
  pub(destinatarios, advogados, {
    nomeClasse: 'RECURSO ORDINÁRIO TRABALHISTA',
    numeroProcesso: '00009785920225220004',
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
   * O DIÁRIO E A FICHA DISCORDAM NUM ATO DA AÇÃO — e aí um dos dois está errado.
   *
   * A bússola nasceu do 0001095-45.2025.5.22.0004, em que a discordância vinha
   * do recurso; esse caminho hoje é barrado antes, por `lado-do-ato.util`. O
   * que sobra para a bússola é a contradição de verdade, e ela existe: nas duas
   * consignações em pagamento do acervo é a FICHA que está errada — ela põe o
   * sindicato como autor de uma ação que o município moveu contra ele.
   *
   * Nos dois casos a conduta é a mesma: ninguém é posicionado, e a frase diz
   * onde resolver.
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
    // A frase tem de fazer sentido em voz alta: dois lados DIFERENTES.
    expect(r.duvida[0].porque).toContain('sindicato no polo passivo');
    expect(r.duvida[0].porque).toContain('a ficha no ativo');
    // E tem de mandar a pessoa ao lugar onde se resolve, não a um recurso
    // inexistente — era o que dizia antes de o recurso sair desta conta.
    expect(r.duvida[0].porque).toContain('aba Partes');
    expect(r.duvida[0].porque).not.toContain('RECURSO');
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

  /**
   * O CNJ MANDA "T" — E O CHUTE VIROU DADO NA PRODUÇÃO.
   *
   * A primeira versão desta leitura fazia `=== 'P' ? 'PASSIVO' : 'ATIVO'`. O
   * `else` era um palpite gravado como fato, e o palpite aconteceu: no
   * 0001335-13.2025.5.22.0108 o Diário classificou o MINISTÉRIO PÚBLICO DO
   * TRABALHO como `T` e a reconciliação escreveu o MPT como AUTOR do processo.
   * Uma ocorrência em 3.970 destinatários — rara e errada do mesmo jeito,
   * porque quem lê a ficha não tem como desconfiar.
   */
  it('"T" é terceiro, e entra como terceiro', () => {
    const r = ler(
      [pub([{ nome: 'MINISTERIO PUBLICO DO TRABALHO', polo: 'T' }, { nome: NOS, polo: 'A' }])],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([{ nome: 'MINISTERIO PUBLICO DO TRABALHO', polo: 'TERCEIRO' }]);
  });

  it('polo que o CNJ não classificou NÃO vira ativo — vira pergunta', () => {
    for (const polo of ['', ' ', 'X', 'RECORRIDO']) {
      const r = ler(
        [pub([{ nome: 'PERITO FULANO DE TAL', polo }, { nome: NOS, polo: 'A' }])],
        naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
      );
      expect(r.repor).toEqual([]);
      expect(r.duvida).toHaveLength(1);
      expect(r.duvida[0].polo).toBeNull();
      expect(r.duvida[0].porque).toContain('sem dizer de que lado');
    }
  });

  it('destinatário sem o campo polo também vira pergunta', () => {
    const r = ler(
      [
        {
          destinatarios: [{ nome: 'ALGUEM SEM LADO' }],
          advogados: [],
          nomeClasse: 'AÇÃO TRABALHISTA - RITO ORDINÁRIO',
          numeroProcesso: '00009785920225220004',
        },
      ],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([]);
    expect(r.duvida[0].polo).toBeNull();
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
    expect(ler([], naFicha([]), new Set())).toEqual({ repor: [], duvida: [], nossoLado: null });
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
    expect(r).toEqual({ repor: [], duvida: [], nossoLado: null });
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

/**
 * O LADO DO RECURSO NÃO POSICIONA NINGUÉM NA AÇÃO.
 *
 * Os dois casos abaixo são da produção (31/10/2026) e são simétricos: num
 * deles a régua IMPEDE um erro, no outro ela DESTRAVA o acerto. É o par que
 * importa — uma régua que só sabe desconfiar custou 73 partes que o sistema
 * conhecia e se recusava a escrever.
 */
describe('o lado do recurso', () => {
  const RECLAMACAO = '00014043120235220006';
  const DA_ACAO = { nomeClasse: 'AÇÃO TRABALHISTA - RITO ORDINÁRIO', numeroProcesso: RECLAMACAO };
  const DO_RECURSO = { nomeClasse: 'RECURSO ORDINÁRIO TRABALHISTA', numeroProcesso: RECLAMACAO };

  it('ato só de recurso: o nome entra na dúvida, nunca na ficha', () => {
    const r = ler(
      [pub([{ nome: NOS, polo: 'P' }, { nome: 'CLINICA SANTA FE LTDA', polo: 'A' }], [], DO_RECURSO)],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([]);
    expect(r.duvida.map((x) => x.nome)).toEqual(['CLINICA SANTA FE LTDA']);
    expect(r.duvida[0].polo).toBeNull();
    expect(r.duvida[0].porque).toContain('recurso');
  });

  /*
    E ESTE É O GANHO. A ficha diz que somos autores; o ato da ação concorda; o
    recurso inverte os dois. Antes, o recurso envenenava a bússola — o
    sindicato aparecia nos dois lados, `polosDivergem` disparava e a clínica
    ficava para sempre na fila de dúvida. Agora o recurso é ignorado para
    efeito de lado e a ré entra onde sempre esteve.
  */
  it('mistura de ação e recurso: o lado sai do ato da AÇÃO', () => {
    const r = ler(
      [
        pub([{ nome: NOS, polo: 'P' }, { nome: 'CLINICA SANTA FE LTDA', polo: 'A' }], [], DO_RECURSO),
        pub([{ nome: NOS, polo: 'A' }, { nome: 'CLINICA SANTA FE LTDA', polo: 'P' }], [], DA_ACAO),
      ],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([{ nome: 'CLINICA SANTA FE LTDA', polo: 'PASSIVO' }]);
    expect(r.duvida).toEqual([]);
  });

  it('sem o sindicato em nenhum ato da ação, o lado do ato da ação ainda vale', () => {
    const r = ler(
      [pub([{ nome: 'HAPVIDA ASSISTENCIA MEDICA LTDA', polo: 'P' }], [], DA_ACAO)],
      naFicha([['MARIA DAS GRACAS', 'ATIVO']]),
    );
    expect(r.repor).toEqual([{ nome: 'HAPVIDA ASSISTENCIA MEDICA LTDA', polo: 'PASSIVO' }]);
  });

  /*
    Um recurso AUTUADO NO TRIBUNAL é o próprio registro: ali a posição recursal
    é a posição certa, e recusá-la deixaria em branco a única ficha que tem o
    dado. Medido: 10 de 10 acertos.
  */
  it('recurso com número próprio de 2º grau posiciona normalmente', () => {
    const r = ler(
      [
        pub([{ nome: 'MUNICIPIO DE COCAL', polo: 'A' }], [], {
          nomeClasse: 'AGRAVO DE INSTRUMENTO',
          numeroProcesso: '07562315720258180000',
        }),
      ],
      naFicha([[NOS_CADASTRO, 'PASSIVO', true]]),
    );
    expect(r.repor).toEqual([{ nome: 'MUNICIPIO DE COCAL', polo: 'ATIVO' }]);
  });
});

/**
 * ADVOGADO DA CASA NÃO É PARTE — nem quando o ato não traz lista de advogados.
 *
 * Produção, 31/10/2026: o Dr. Carlos Henrique, advogado PRINCIPAL de cinco
 * processos, estava gravado como AUTOR nos cinco, `origem = 'DJEN'`. A recusa
 * antiga comparava o destinatário com os advogados DAQUELE ato, e o TJPI
 * publica aquelas intimações sem lista de advogados e com o nome do advogado
 * seguido de "REGISTRADO(A) CIVILMENTE COMO ...".
 */
describe('advogado da casa', () => {
  const COM_SUFIXO =
    'CARLOS HENRIQUE DE ALENCAR VIEIRA REGISTRADO(A) CIVILMENTE COMO CARLOS HENRIQUE DE ALENCAR VIEIRA';

  it('o nome com sufixo do tribunal não vira autor', () => {
    const r = ler(
      [pub([{ nome: COM_SUFIXO, polo: 'A' }, { nome: 'MUNICIPIO DE ELESBAO VELOSO', polo: 'P' }])],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.repor).toEqual([{ nome: 'MUNICIPIO DE ELESBAO VELOSO', polo: 'PASSIVO' }]);
    expect(r.duvida).toEqual([]);
  });

  it('vale mesmo com o ato sem nenhum advogado listado', () => {
    const r = ler([pub([{ nome: 'MURILO MARCONES ALVES VELOSO', polo: 'A' }], [])], naFicha([]));
    expect(r.repor).toEqual([]);
  });

  /*
    E A TRAVA DO TAMANHO. Comparação por continência com chave curta casaria
    dentro de qualquer razão social; aqui a casa tem um nome curto de propósito.
  */
  it('nome curto no cadastro não filtra ninguém', () => {
    const r = ler(
      [pub([{ nome: 'ANA SOUZA SERVICOS MEDICOS LTDA', polo: 'P' }])],
      naFicha([]),
      new Set(),
      ['Ana'],
    );
    expect(r.repor).toEqual([{ nome: 'ANA SOUZA SERVICOS MEDICOS LTDA', polo: 'PASSIVO' }]);
  });
});

/**
 * A CONTRADIÇÃO VIRA RESPOSTA — e não só recusa.
 *
 * A bússola sempre soube que a ficha e o Diário discordavam; ela usava isso
 * para se calar. Quem abria a ficha via a lista de dúvidas crescer sem saber
 * por quê. Agora ela DIZ, e a ficha mostra o cabeçalho do ato ao lado.
 */
describe('o nosso lado em dúvida', () => {
  it('ficha e ato de acordo: não há nada a denunciar', () => {
    const r = ler(
      [pub([{ nome: NOS, polo: 'A' }, { nome: 'MUNICIPIO DE COCAL', polo: 'P' }])],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.nossoLado).toBeNull();
  });

  /* Produção: as duas consignações em pagamento do acervo. */
  it('ficha diz autor, ato da ação diz réu: a contradição é devolvida', () => {
    const r = ler(
      [pub([{ nome: 'MUNICIPIO DE COCAL', polo: 'A' }, { nome: NOS, polo: 'P' }], [], {
        nomeClasse: 'CONSIGNAÇÃO EM PAGAMENTO',
        numeroProcesso: '00013103620165220101',
      })],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.nossoLado).toEqual({ naFicha: 'ATIVO', noAto: 'PASSIVO' });
  });

  /*
    E O RECURSO NÃO DENUNCIA NINGUÉM. Lá o lado é o da posição recursal, e
    discordar da ficha é o esperado — não é ficha errada.
  */
  it('só ato de recurso não acusa a ficha', () => {
    const r = ler(
      [pubDeRecurso([{ nome: 'EMPRESA X', polo: 'A' }, { nome: NOS, polo: 'P' }])],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.nossoLado).toBeNull();
  });

  /* O sindicato nos dois polos é ato ambíguo, não ficha errada. */
  it('sindicato nos dois polos do mesmo ato não acusa a ficha', () => {
    const r = ler(
      [
        pub([{ nome: NOS, polo: 'A' }, { nome: 'EMPRESA X', polo: 'P' }]),
        pub([{ nome: NOS, polo: 'P' }, { nome: 'EMPRESA X', polo: 'A' }]),
      ],
      naFicha([[NOS_CADASTRO, 'ATIVO', true]]),
    );
    expect(r.nossoLado).toBeNull();
  });

  it('sem parte institucional na ficha, não há o que comparar', () => {
    const r = ler(
      [pub([{ nome: NOS, polo: 'P' }])],
      naFicha([['MARIA DAS GRACAS', 'ATIVO']]),
    );
    expect(r.nossoLado).toBeNull();
  });
});
