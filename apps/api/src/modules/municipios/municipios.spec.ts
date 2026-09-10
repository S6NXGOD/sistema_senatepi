import { OrigemDaLigacao } from '@prisma/client';
import {
  chaveDeEnte,
  chavesDoTexto,
  siglaDeUF,
  pareceCodigoIBGE,
} from './chave-de-ente.util';
import { situacaoFiscal, oQueIssoSignifica, PERCENTUAL_IMPOSSIVEL } from './leitura-fiscal.util';
import { VinculoDeEnteService } from './vinculo-de-ente.service';
import { SiconfiService } from './siconfi.service';
import { EnteSeedService } from './ente-seed.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * OS CASOS DESTE ARQUIVO SAÍRAM DA PRODUÇÃO, não da imaginação.
 *
 * Cada grafia esquisita aqui foi contada no banco do SENATEPI em 10/09/2026, e
 * cada número fiscal foi lido da resposta do Tesouro. Um teste de casamento de
 * texto escrito com exemplos inventados prova que a função faz o que o autor
 * imaginou; escrito com o que existe, prova que ela serve para esta base.
 */

describe('a chave de texto de um município', () => {
  it('ignora caixa e acento — três grafias de Teresina viram uma', () => {
    for (const grafia of ['Teresina', 'TERESINA', 'teresina']) {
      expect(chaveDeEnte(grafia)).toBe('teresina');
    }
    expect(chaveDeEnte('Parnaíba')).toBe(chaveDeEnte('PARNAIBA'));
  });

  /**
   * A CHAVE É LITERAL — não corta sufixo. É `chavesDoTexto` que levanta a
   * hipótese de o fim ser sigla de estado, e ela vem DEPOIS da leitura literal.
   */
  it('a chave canônica não corta nada do nome', () => {
    expect(chaveDeEnte('Teresina-PI')).toBe('teresina pi');
    expect(chaveDeEnte('Sento Sé')).toBe('sento se');
  });

  /** Quatro registros reais trazem a UF grudada no nome da cidade. */
  it('a segunda leitura descola a UF grudada e diz qual é', () => {
    for (const grafia of ['Teresina-PI', 'Teresina PI']) {
      const l = chavesDoTexto(grafia);
      expect(l[0]).toEqual({ chave: 'teresina pi', ufSugerida: null });
      expect(l[1]).toEqual({ chave: 'teresina', ufSugerida: 'PI' });
    }
    expect(chavesDoTexto('ALTOS-PI')[1]).toEqual({ chave: 'altos', ufSugerida: 'PI' });
    expect(chavesDoTexto('timon-ma')[1]).toEqual({ chave: 'timon', ufSugerida: 'MA' });
  });

  /**
   * SENTO SÉ, NA BAHIA (código 2930204) — o único dos 5.571 cujo nome oficial
   * termina com sigla de estado ("Sé" = Sergipe). A leitura literal vem
   * primeiro justamente por causa dele: ao contrário, viraria "sento" e quem
   * mora lá ficaria para sempre sem município.
   */
  it('nome oficial que termina em sigla de estado é lido inteiro primeiro', () => {
    const l = chavesDoTexto('Sento Sé');
    expect(l[0].chave).toBe('sento se');
    expect(l[0].ufSugerida).toBeNull();
  });

  it('texto sem sufixo tem uma leitura só', () => {
    expect(chavesDoTexto('Teresina')).toEqual([{ chave: 'teresina', ufSugerida: null }]);
    expect(chavesDoTexto('')).toEqual([]);
  });
  it('trata o apóstrofo como separador', () => {
    expect(chaveDeEnte("Olho d'Água")).toBe('olho d agua');
    expect(chaveDeEnte('OLHO D AGUA')).toBe('olho d agua');
  });

  /**
   * NÃO CORRIGE DIGITAÇÃO — e isto é a decisão, não a limitação.
   *
   * Aproximar por distância de edição casaria "Bom Jesus" com "Bom Jesus do
   * Piauí", que são municípios diferentes e ambos existem no Piauí. Um erro que
   * fica visível na tela de pendências é melhor que um acerto silencioso na
   * cidade errada.
   */
  it('não inventa correção para erro de digitação', () => {
    expect(chaveDeEnte('TERSINA')).toBe('tersina');
    expect(chaveDeEnte('teesina')).not.toBe('teresina');
  });

  it('a UF é reconhecida por sigla e por extenso, e só assim', () => {
    expect(siglaDeUF('pi')).toBe('PI');
    expect(siglaDeUF('Piauí')).toBe('PI');
    expect(siglaDeUF('MARANHÃO')).toBe('MA');
    // "PL" é um registro real do cadastro. Não existe, e não vira nada.
    expect(siglaDeUF('PL')).toBeNull();
    expect(siglaDeUF('')).toBeNull();
  });

  /**
   * O DataJud gravou `5149` em dois processos — código interno de serventia, não
   * do IBGE. Consultado no Tesouro, um código inválido devolve 200 com os dados
   * de OUTRO ente: o descarte tem de acontecer antes da consulta.
   */
  it('recusa código que não tem cara de IBGE', () => {
    expect(pareceCodigoIBGE(2211001)).toBe(true); // Teresina
    expect(pareceCodigoIBGE(5300108)).toBe(true); // Brasília
    expect(pareceCodigoIBGE(5149)).toBe(false);
    expect(pareceCodigoIBGE(0)).toBe(false);
    expect(pareceCodigoIBGE(null)).toBe(false);
  });
});

/**
 * A REGRA FISCAL — os limites vêm da resposta do Tesouro, e o corte de
 * plausibilidade impede que uma declaração impossível vire argumento.
 */
describe('o que o percentual de despesa com pessoal significa', () => {
  const LIMITES = { limiteMaximo: 54, limitePrudencial: 51.3, limiteAlerta: 48.6 };

  it('classifica pelos limites que a própria API informou', () => {
    // Teresina, 1º quadrimestre de 2026.
    expect(situacaoFiscal({ percentualRcl: 43.29, ...LIMITES })).toBe('REGULAR');
    expect(situacaoFiscal({ percentualRcl: 49, ...LIMITES })).toBe('ALERTA');
    // Joca Marques.
    expect(situacaoFiscal({ percentualRcl: 52.33, ...LIMITES })).toBe('PRUDENCIAL');
    // Altos.
    expect(situacaoFiscal({ percentualRcl: 56.52, ...LIMITES })).toBe('ACIMA_DO_TETO');
  });

  /**
   * O TETO NÃO ESTÁ CRAVADO EM 54. Ele muda por esfera e por poder — o
   * Legislativo municipal tem 6%. Com o número no código, a classificação
   * erraria em silêncio no dia em que o módulo lesse câmara municipal.
   */
  it('usa o limite que veio, e não um 54 chumbado', () => {
    const camara = { limiteMaximo: 6, limitePrudencial: 5.7, limiteAlerta: 5.4 };
    expect(situacaoFiscal({ percentualRcl: 6.5, ...camara })).toBe('ACIMA_DO_TETO');
    // O mesmo 6,5% no Executivo seria folgadamente regular.
    expect(situacaoFiscal({ percentualRcl: 6.5, ...LIMITES })).toBe('REGULAR');
  });

  /**
   * ESPERANTINA DECLAROU 360,24%.
   *
   * Conferido na origem: R$ 112.109.827,61 de folha em doze meses contra uma RCL
   * de R$ 31.120.559,07. A API está certa; a declaração é que não fecha. Levar
   * isso para uma mesa de negociação como fato seria desmentido no mesmo minuto.
   */
  it('separa estouro real de declaração impossível', () => {
    expect(situacaoFiscal({ percentualRcl: 360.24, ...LIMITES })).toBe('INCONSISTENTE');
    expect(situacaoFiscal({ percentualRcl: 326.88, ...LIMITES })).toBe('INCONSISTENTE');
    expect(situacaoFiscal({ percentualRcl: 243.94, ...LIMITES })).toBe('INCONSISTENTE');

    // E o corte NÃO pode engolir quem estourou o teto de verdade — são os casos
    // que mais interessam ao sindicato.
    for (const real of [54.22, 54.25, 56.52]) {
      expect(situacaoFiscal({ percentualRcl: real, ...LIMITES })).toBe('ACIMA_DO_TETO');
    }
    expect(PERCENTUAL_IMPOSSIVEL).toBeGreaterThan(54);
  });

  it('sem número não é zero, é ausência', () => {
    expect(situacaoFiscal({ percentualRcl: null, ...LIMITES })).toBe('SEM_DADO');
    expect(situacaoFiscal(null)).toBe('SEM_DADO');
  });

  /** A tela mostra a CONSEQUÊNCIA; quem negocia precisa da resposta, não da sigla. */
  it('cada situação explica o que muda na prática', () => {
    expect(oQueIssoSignifica('PRUDENCIAL')).toContain('proibido de conceder aumento');
    expect(oQueIssoSignifica('REGULAR')).toContain('não há impedimento');
    expect(oQueIssoSignifica('INCONSISTENTE')).toContain('não fecha');
  });
});

/**
 * O CASAMENTO — a decisão pura, sem banco.
 *
 * O índice abaixo é um recorte fiel do catálogo: nomes que existem em uma UF só,
 * nomes repetidos com um candidato no Piauí, e um repetido SEM candidato no
 * Piauí (que é o caso que tem de ficar sem resposta).
 */
describe('de que município é este texto', () => {
  const servico = new VinculoDeEnteService(null as never);

  const M = (codigo: number, uf: string) => ({ codigo, uf, esfera: 'M' });
  const idx = new Map<string, Array<{ codigo: number; uf: string; esfera: string }>>([
    ['teresina', [M(2211001, 'PI')]],
    ['parnaiba', [M(2207702, 'PI')]],
    ['piracuruca', [M(2208304, 'PI')]],
    ['timon', [M(2112209, 'MA')]],
    ['capitao de campos', [M(2202406, 'PI')]],
    // repetido, com exatamente um no Piauí
    ['batalha', [M(2701001, 'AL'), M(2201150, 'PI')]],
    // repetido e SEM nenhum no Piauí — 20 filiados moram assim
    ['monte alegre', [M(1504802, 'PA'), M(2407500, 'RN')]],
  ]);

  it('UF mais nome é a ligação forte', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'TERESINA', uf: 'PI' })).toEqual({
      codigo: 2211001,
      origem: OrigemDaLigacao.UF_E_NOME,
    });
    expect(servico.resolverMunicipio(idx, { cidade: 'Timon', uf: 'MA' })?.codigo).toBe(2112209);
  });

  it('a UF grudada no nome também serve de UF', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'Teresina-PI', uf: null })).toEqual({
      codigo: 2211001,
      origem: OrigemDaLigacao.UF_E_NOME,
    });
  });

  it('sem UF, nome único no Brasil resolve sozinho', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'Piracuruca' })).toEqual({
      codigo: 2208304,
      origem: OrigemDaLigacao.NOME_UNICO,
    });
  });

  /**
   * "Batalha" existe em AL e PI. Para um sindicato do Piauí é o do Piauí — mas
   * isso é aposta razoável, não fato, e por isso ganha origem própria: é ela que
   * a tela de conferência mostra primeiro.
   */
  it('nome repetido resolve pela UF da casa, e fica marcado como tal', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'Batalha' })).toEqual({
      codigo: 2201150,
      origem: OrigemDaLigacao.PREFERENCIA_UF,
    });
  });

  it('nome repetido sem candidato na UF da casa não vira palpite', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'Monte Alegre' })).toBeNull();
  });

  /**
   * "TERESINA/MA" é um registro real. Os dois campos se contradizem e não há
   * como saber qual está errado; gravar Teresina/PI aqui seria escolher ignorar
   * a informação que o cadastro deu.
   */
  it('UF informada que não contém o município NÃO cai para o nome único', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'Teresina', uf: 'MA' })).toBeNull();
  });

  it('texto que não existe no catálogo fica sem resposta', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'TERSINA', uf: 'CE' })).toBeNull();
    expect(servico.resolverMunicipio(idx, { cidade: '' })).toBeNull();
    expect(servico.resolverMunicipio(idx, { cidade: null })).toBeNull();
  });

  it('abreviação de nome de ente é expandida', () => {
    expect(servico.resolverMunicipio(idx, { cidade: 'cap de campos' })?.codigo).toBe(2202406);
  });
});

/**
 * O NOME DA ORGANIZAÇÃO — a ÚNICA prova aceita para ligar organização a ente.
 *
 * Endereço não vale, e o exemplo que decidiu isso é o Hospital Getúlio Vargas:
 * fica em Teresina, e quem paga a folha dos 19 filiados que trabalham lá é o
 * Estado do Piauí. Ligar pelo endereço poria o RGF da prefeitura embaixo deles.
 */
describe('que ente o nome de uma organização declara', () => {
  const servico = new VinculoDeEnteService(null as never);
  const E = (codigo: number, uf: string, esfera: string) => ({ codigo, uf, esfera });
  const idx = new Map<string, Array<{ codigo: number; uf: string; esfera: string }>>([
    ['piaui', [E(22, 'PI', 'E')]],
    ['maranhao', [E(21, 'MA', 'E')]],
    ['piracuruca', [E(2208304, 'PI', 'M')]],
    ['parnaiba', [E(2207702, 'PI', 'M')]],
    ['corrente', [E(2202901, 'PI', 'M')]],
    ['alto longa', [E(2200301, 'PI', 'M')]],
    ['landri sales', [E(2205706, 'PI', 'M')]],
    ['capitao de campos', [E(2202406, 'PI', 'M')]],
    ['sento se', [E(2930204, 'BA', 'M')]],
    // repetido no Brasil e presente no Piauí — o mesmo caso de 'Bom Jesus'
    ['bom jesus', [E(2501807, 'PB', 'M'), E(2201903, 'PI', 'M')]],
  ]);
  const doNome = (nome: string) => servico.resolverPeloNome(idx, nome);

  it('reconhece o município por extenso, abreviado e com a UF grudada', () => {
    expect(doNome('MUNICIPIO DE PIRACURUCA')?.codigo).toBe(2208304);
    expect(doNome('MUN. DE ALTO LONGÁ')?.codigo).toBe(2200301);
    expect(doNome('MUNICÍPIO DE PARNAIBA-PI')?.codigo).toBe(2207702);
    expect(doNome('Prefeitura Municipal de Corrente')?.codigo).toBe(2202901);
    expect(doNome('MUN. DE CAP. DE CAMPOS')?.codigo).toBe(2202406);
  });

  /** O que vem depois do travessão é órgão interno, não o ente. */
  it('ignora o complemento depois do travessão', () => {
    expect(doNome('MUNICIPIO DE LANDRI SALES - SECRETARIA DE SAUDE')?.codigo).toBe(2205706);
  });

  /**
   * O ESTADO E A UNIÃO — o motivo de o catálogo não ser só de municípios.
   * Medido: o Estado do Piauí é o 2º maior empregador do cadastro (42 vínculos)
   * e figura em 10 processos.
   */
  it('reconhece o ente estadual, inclusive pela secretaria', () => {
    expect(doNome('ESTADO DO PIAUI')).toEqual({ codigo: 22, origem: OrigemDaLigacao.NOME_DE_ENTE });
    expect(doNome('Governo do Estado do Piauí')?.codigo).toBe(22);
    expect(doNome('SECRETARIA DE ESTADO DA SAÚDE DO PIAUÍ')?.codigo).toBe(22);
  });

  it('reconhece a União', () => {
    expect(doNome('UNIÃO FEDERAL')).toEqual({ codigo: 1, origem: OrigemDaLigacao.NOME_DE_ENTE });
    expect(doNome('União')?.codigo).toBe(1);
  });

  /**
   * O FALSO POSITIVO QUE QUASE PASSOU, e que uma busca por substring cometeria:
   * o nome completo do PRÓPRIO SINDICATO termina em "DO ESTADO DO PIAUÍ". Ele é
   * parte em 101 processos; classificá-lo como o Governo do Piauí poria o RGF
   * estadual na ficha do sindicato.
   */
  it('não confunde o próprio sindicato com o Estado', () => {
    expect(doNome('SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ')).toBeNull();
  });

  /**
   * E NÃO INVENTA ENTE para quem não declara nenhum — nem por topônimo no meio
   * do nome ("Brasileira" é município do Piauí), nem por hospital que por acaso
   * fica numa cidade.
   */
  it('devolve nulo para quem não declara ente', () => {
    for (const nome of [
      'SOCIEDADE BRASILEIRA CAMINHO DE DAMASCO',
      'HOSPITAL DE URGÊNCIA DE TERESINA',
      'HOSPITAL GETÚLIO VARGAS',
      'UNIMED TERESINA COOPERATIVA',
      'MATERNIDADE DONA EVANGELINA ROSA',
    ]) {
      expect(doNome(nome)).toBeNull();
    }
  });

  /** Nome oficial que termina em sigla de estado continua inteiro. */
  it('não mutila Sento Sé', () => {
    expect(doNome('Prefeitura Municipal de Sento Sé')?.codigo).toBe(2930204);
  });
});
/**
 * A JANELA DE PERÍODOS do SICONFI.
 *
 * Municípios pequenos publicam com atraso e alguns não publicam: perguntar só
 * pelo período corrente devolveria vazio para boa parte do interior, e vazio
 * aqui é indistinguível de "não existe".
 */
describe('que períodos o SICONFI é consultado', () => {
  const svc = new SiconfiService({ get: () => undefined } as never);
  const janelaQ = (d: Date) =>
    (svc as unknown as { janelaQuadrimestres(a: Date): Array<[number, number]> }).janelaQuadrimestres(d);
  const janelaB = (d: Date) =>
    (svc as unknown as { janelaBimestres(a: Date): Array<[number, number]> }).janelaBimestres(d);

  it('começa no período corrente e anda para trás, sem repetir', () => {
    const j = janelaQ(new Date('2026-09-10T12:00:00Z'));
    expect(j[0]).toEqual([2026, 3]);
    expect(j[1]).toEqual([2026, 2]);
    expect(j).toContainEqual([2025, 3]);
    expect(new Set(j.map((x) => x.join('-'))).size).toBe(j.length);
  });

  it('vira o ano para trás corretamente', () => {
    const j = janelaQ(new Date('2026-01-15T12:00:00Z'));
    expect(j[0]).toEqual([2026, 1]);
    expect(j[1]).toEqual([2025, 3]);
    expect(j[2]).toEqual([2025, 2]);
  });

  /**
   * A HORA É DE TERESINA. O contêiner roda em UTC: às 00:30 do dia 1º de maio em
   * Teresina já são 03:30 do dia 1º em UTC — mas às 22:00 do dia 30 de abril
   * daqui, em UTC já é dia 1º. Ler o mês pelo fuso do processo pediria um
   * período que ninguém publicou.
   */
  it('o período corrente é lido no fuso de Teresina', () => {
    // 01/05/2026 às 01:00 UTC = 30/04/2026 às 22:00 em Teresina -> ainda abril.
    const j = janelaB(new Date('2026-05-01T01:00:00Z'));
    expect(j[0]).toEqual([2026, 2]); // abril é o 2º bimestre
  });

  it('bimestres também não repetem e viram o ano', () => {
    const j = janelaB(new Date('2026-02-10T12:00:00Z'));
    expect(j[0]).toEqual([2026, 1]);
    expect(j[1]).toEqual([2025, 6]);
    expect(new Set(j.map((x) => x.join('-'))).size).toBe(j.length);
  });
});

/**
 * O SEED NÃO PODE SEGURAR O BOOT.
 *
 * Medido contra a produção: 5.571 linhas em 6,0 segundos. O Nest só passa a
 * atender depois que todo `onApplicationBootstrap` resolve, e um deploy que não
 * responde ao health check volta atrás. O teste não olha o código: chama o
 * gancho com um Prisma que demora e cobra que ele TENHA VOLTADO antes.
 */
describe('a carga do catálogo sai do caminho crítico', () => {
  it('o gancho de boot retorna sem esperar a inserção', async () => {
    let terminou = false;
    const prismaLento = {
      municipio: {
        count: async () => {
          await new Promise((ok) => setTimeout(ok, 40));
          return 0;
        },
        createMany: async () => {
          await new Promise((ok) => setTimeout(ok, 40));
          terminou = true;
          return { count: 0 };
        },
      },
    };
    const seed = new EnteSeedService(prismaLento as never);

    const devolvido = seed.onApplicationBootstrap();
    // Nem promete nada, nem terminou: o boot seguiu.
    expect(devolvido).toBeUndefined();
    expect(terminou).toBe(false);

    // E o trabalho continua acontecendo depois.
    await new Promise((ok) => setTimeout(ok, 250));
  });
});

/**
 * A MIGRAÇÃO É ADITIVA — o contêiner ANTIGO atende contra este banco já migrado
 * durante a janela de troca. Uma coluna NOT NULL, um DROP ou um RENAME aqui
 * derrubam a versão que ainda está no ar.
 *
 * As linhas de comentário saem antes da conferência: a explicação em português
 * fala de "remover" e "renomear", e já houve teste neste repositório que
 * reprovou o arquivo CORRETO por bater no comentário.
 */
describe('a migração dos entes é segura na janela de troca', () => {
  const SQL = readFileSync(
    join(
      __dirname,
      '../../../prisma/migrations/20260910180000_entes_publicos_e_indicadores_fiscais/migration.sql',
    ),
    'utf8',
  );
  const codigo = SQL.replace(/--.*$/gm, '');

  it('não remove, não renomeia e não troca tipo', () => {
    for (const proibido of [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /RENAME/i, /ALTER\s+COLUMN/i]) {
      expect(codigo).not.toMatch(proibido);
    }
  });

  /** O contêiner antigo insere sem citar as colunas novas — elas têm de ser nuláveis. */
  it('as colunas acrescentadas ao cadastro são nuláveis', () => {
    const acrescimos = codigo.match(/ALTER TABLE [^;]+ADD COLUMN[^;]+;/gi) ?? [];
    expect(acrescimos.length).toBeGreaterThanOrEqual(4);
    for (const linha of acrescimos) {
      expect(linha).toMatch(/IF NOT EXISTS/i);
      expect(linha).not.toMatch(/NOT NULL/i);
    }
  });

  /** Roda em um banco por sindicato, e já houve DDL que derrubou a API por reexecução. */
  it('cria tabela, índice e constraint de forma idempotente', () => {
    for (const criacao of codigo.match(/CREATE (TABLE|UNIQUE INDEX|INDEX)[^(]*/gi) ?? []) {
      expect(criacao).toMatch(/IF NOT EXISTS/i);
    }
    /*
      TODA `ADD CONSTRAINT` tem de estar dentro do seu bloco de guarda. A
      contagem é comparada com a das guardas, e não com um número escrito à mão:
      assim, acrescentar uma constraint sem guarda REPROVA, em vez de exigir que
      alguém lembre de atualizar o teste.
    */
    const constraints = (codigo.match(/ADD CONSTRAINT/gi) ?? []).length;
    const guardas = (codigo.match(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/gi) ?? []).length;
    expect(constraints).toBeGreaterThan(0);
    expect(guardas).toBe(constraints);
  });

  /**
   * O ÚNICO DE (uf, nome) TEM DE SER PARCIAL. Medido no catálogo: QUATRO estados
   * têm o mesmo nome de um município da própria UF — Amapá, Rio de Janeiro, São
   * Paulo e Goiás. Sem o recorte por esfera, o banco recusaria a carga do
   * catálogo na primeira subida.
   */
  it('o único de nome por UF vale só para municípios', () => {
    const unico = codigo.match(/CREATE UNIQUE INDEX[^;]*entes_uf_nome_normalizado_key[^;]*;/i)?.[0];
    expect(unico).toBeDefined();
    expect(unico).toMatch(/WHERE\s+"esfera"\s*=\s*'M'/i);
  });

  /** Pessoa mora em município, não em Estado nem na União. */
  it('o município do filiado é barrado por CHECK se não for município', () => {
    expect(codigo).toMatch(/filiados_municipio_codigo_check/);
    expect(codigo).toMatch(/"municipio_codigo"\s*>=\s*1100000/);
  });

  /**
   * O DataJud grava a COMARCA em `processos.municipio_ibge`, e um dos códigos
   * gravados (`5149`) nem é do IBGE. Uma FK ali faria a migração falhar — e
   * migração que falha é API que não sobe.
   */
  it('não cria chave estrangeira a partir de processos', () => {
    expect(codigo).not.toMatch(/ALTER TABLE "processos"/i);
  });

  /** Apagar um ente do catálogo não pode levar o filiado junto. */
  it('o cadastro sobrevive à remoção de um ente', () => {
    const doCadastro = codigo.match(/ALTER TABLE "(filiados|partes_externas)"[^;]*FOREIGN KEY[^;]*;/gi) ?? [];
    expect(doCadastro.length).toBe(2);
    for (const fk of doCadastro) expect(fk).toMatch(/ON DELETE SET NULL/i);
  });
});

/**
 * A ESCOLHA DE UMA PESSOA NÃO SE DESFAZ SOZINHA.
 *
 * O robô só consegue provar 21 das 77 organizações; as outras 56 dependem de
 * alguém que sabe que o Hospital Getúlio Vargas é do Estado. Se a varredura da
 * madrugada passasse por cima dessa escolha, o trabalho de quem preencheu
 * sumiria toda noite — e ninguém saberia por quê.
 *
 * O teste não olha o código: chama a varredura com um Prisma falso e confere o
 * FILTRO que ela mandou para o banco.
 */
describe('a varredura respeita quem foi decidido à mão', () => {
  it('as organizações marcadas MANUAL ficam fora da consulta', async () => {
    let filtro: unknown = null;
    const prismaFalso = {
      ente: { findMany: async () => [] },
      parteExterna: {
        findMany: async (args: { where: unknown }) => {
          filtro = args.where;
          return [];
        },
        update: async () => ({}),
      },
    };
    const servico = new VinculoDeEnteService(prismaFalso as never);
    await servico.casarOrganizacoes();

    expect(filtro).toEqual({ enteOrigem: { not: OrigemDaLigacao.MANUAL } });
  });

  it('e os filiados também — o updateMany carrega a mesma exclusão', async () => {
    const filtros: unknown[] = [];
    const prismaFalso = {
      ente: { findMany: async () => [{ codigo: 2211001, uf: 'PI', esfera: 'M', nomeNormalizado: 'teresina' }] },
      filiado: {
        groupBy: async () => [{ cidade: 'Teresina', estado: 'PI', _count: { _all: 3 } }],
        updateMany: async (args: { where: unknown }) => {
          filtros.push(args.where);
          return { count: 3 };
        },
      },
    };
    const servico = new VinculoDeEnteService(prismaFalso as never);
    const r = await servico.casarFiliados();

    expect(r.ligados).toBe(3);
    expect(filtros).toHaveLength(1);
    expect(filtros[0]).toMatchObject({ municipioOrigem: { not: OrigemDaLigacao.MANUAL } });
  });

  /**
   * E NÃO GASTA ESCRITA no que já está certo — o `NOT` do mesmo par (código,
   * origem) é o que impede a varredura de reescrever 3.107 linhas toda noite
   * para não mudar nada.
   */
  it('não regrava o que já está com o mesmo valor', async () => {
    let onde: Record<string, unknown> = {};
    const prismaFalso = {
      ente: { findMany: async () => [{ codigo: 2211001, uf: 'PI', esfera: 'M', nomeNormalizado: 'teresina' }] },
      filiado: {
        groupBy: async () => [{ cidade: 'Teresina', estado: 'PI', _count: { _all: 1 } }],
        updateMany: async (args: { where: Record<string, unknown> }) => {
          onde = args.where;
          return { count: 0 };
        },
      },
    };
    await new VinculoDeEnteService(prismaFalso as never).casarFiliados();
    expect(onde.NOT).toEqual({
      municipioCodigo: 2211001,
      municipioOrigem: OrigemDaLigacao.UF_E_NOME,
    });
  });
});
