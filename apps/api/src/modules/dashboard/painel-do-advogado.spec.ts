import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { daPessoa } from '../agenda/equipe.util';
import { limitesDoDia, recorteAberto } from '../agenda/recortes.util';
import { wheresDoPainel } from './painel.regras';
import { adversarioDoProcesso, nomeCurtoDaParte, partesDaLinha } from './dashboard.module';

const DASH = readFileSync(join(__dirname, 'dashboard.module.ts'), 'utf8');
/* A consulta saiu daqui e virou regra unica: o relatorio individual do
 * advogado passou a precisar dela. Ver `publicacoes-que-citam.util`. */
const CITAM = readFileSync(
  join(__dirname, '../processos/utils/publicacoes-que-citam.util.ts'),
  'utf8',
);

/** 23h30 de 13/09/2026 em Teresina — no UTC, já é dia 14. */
const AGORA_BR = new Date('2026-09-13T23:30:00-03:00');
const MEU = daPessoa('adv1');

/**
 * "AS MINHAS PUBLICAÇÕES" ERRAVA NOS DOIS SENTIDOS.
 *
 * O recorte pessoal do Diário era só `processo: meuAcervo` — as publicações dos
 * processos em que o advogado está VINCULADO. Mas quem é intimado é quem está
 * NOMEADO no ato, e as duas listas divergem muito. Medido na produção em
 * 07/09/2026, janela de 30 dias com providência:
 *
 *      advogado             via acervo   que o citam
 *      Dra. Jaqueline            0            4     <- não via nenhuma das suas
 *      Dra. Morgana             32            6     <- 26 que não a citam
 *      Dr. Tiago                30           21
 *      Dr. Carlos Henrique      32           34     <- perdia 2
 *
 * O falso negativo é o grave: prazo corre para quem foi intimado, e a
 * Dra. Jaqueline abria o painel e via ZERO. Depois da correção, 0 → 4.
 */
describe('as publicações do advogado', () => {
  it('somam o acervo dele E os atos que o nomeiam', () => {
    expect(DASH).toContain('const meuDjen: Prisma.ComunicacaoDjenWhereInput = souAdvogado');
    expect(DASH).toContain('OR: [{ processo: meuAcervo }');
    expect(DASH).toContain('{ id: { in: idsQueMeCitam } }');
  });

  /**
   * As duas consultas do Diário usam o MESMO escopo — duas contas divergiriam.
   *
   * A contagem NÃO exige mais a forma `...meuDjen,` espalhada: uma das duas
   * passou a entrar dentro de um `AND`, porque `meuDjen` traz uma chave `OR` e
   * duas chaves `OR` no mesmo objeto não somam — a segunda sobrescreve a
   * primeira, em silêncio. Cobrar a sintaxe empurraria quem consertasse de volta
   * para o defeito; o que importa é que as duas consultas apliquem o recorte.
   */
  it('o contador e a lista usam o mesmo recorte', () => {
    const usados = (DASH.match(/meuDjen/g) ?? []).length;
    const declaracoes = (DASH.match(/const meuDjen/g) ?? []).length;
    expect(declaracoes).toBe(1);
    expect(usados - declaracoes).toBeGreaterThanOrEqual(2);
    // E o recorte antigo, por acervo apenas, não pode ter sobrado em lugar nenhum.
    expect(DASH).not.toContain('souAdvogado ? { processo: meuAcervo } : {}');
  });

  /**
   * O CASAMENTO É PELA OAB, NUNCA PELO NOME. O DJEN manda "ICARO SOL ALMONDES
   * SANTOS" e o cadastro tem "Ícaro Sol Almondes Santos"; casar por texto
   * perderia todo mundo com acento e ainda arriscaria homônimo.
   */
  it('liga pelo número e pela UF da OAB', () => {
    expect(DASH).toContain('private async publicacoesQueCitam(');
    expect(DASH).toContain('return publicacoesQueCitam(this.prisma, advogado, { de: desde });');
    expect(CITAM).toContain("regexp_replace(a->>'numeroOab', '[^0-9]', '', 'g')");
    expect(CITAM).toContain("upper(a->>'ufOab') = ${uf}");
  });

  /**
   * Recortar pela janela ANTES do `jsonb_array_elements`: sem isso a expansão
   * varreria as 1.408 publicações do acervo para responder sobre sete dias.
   */
  it('filtra a janela antes de expandir o JSON', () => {
    expect(CITAM.indexOf('data_disponibilizacao" >= ${janela.de}')).toBeLessThan(
      CITAM.indexOf('jsonb_array_elements'),
    );
  });

  /** Advogado sem OAB no cadastro cai no comportamento antigo, sem quebrar. */
  it('sem OAB, o vínculo por citação simplesmente não existe', () => {
    expect(CITAM).toContain('if (!numero || !uf) return [];');
  });

  /**
   * O QUE ME INTIMA VEM PRIMEIRO. O corte é em seis itens: um ato que nomeia o
   * advogado podia cair fora da lista por causa de três publicações do acervo
   * que chegaram um dia depois.
   */
  it('quem me cita disputa as vagas na frente', () => {
    expect(DASH).toContain('const citaA = a.some((p) => idsQueMeCitam.has(p.id)) ? 1 : 0;');
    expect(DASH).toContain('if (citaA !== citaB) return citaB - citaA;');
    // Dentro do grupo, a data continua mandando.
    expect(DASH).toContain('return b[0].dataDisponibilizacao.getTime() - a[0].dataDisponibilizacao.getTime();');
  });

  /** A tela precisa poder marcar — senão as seis linhas têm a mesma cara. */
  it('cada publicação diz se nomeia quem está olhando', () => {
    expect(DASH).toContain('meCita: grupo.some((p) => idsQueMeCitam.has(p.id))');
  });

  /**
   * Fora do escopo pessoal a pergunta não faz sentido: no painel da gestão o
   * selo acenderia sempre (ou nunca), e selo que não varia não informa.
   */
  it('o conjunto é vazio por padrão — nada acende fora do escopo pessoal', () => {
    expect(DASH).toContain('idsQueMeCitam: ReadonlySet<string> = new Set()');
  });
});

/**
 * A ORDEM, TESTADA PELO COMPORTAMENTO e não pelo texto do arquivo.
 *
 * As asserções acima garantem que o código está escrito; esta garante que ele
 * FAZ a coisa. É a regra que mais tem como regredir em silêncio: inverter o
 * sinal de um `-` na comparação continuaria compilando e passando em toda
 * verificação de string.
 */
describe('a ordem das publicações', () => {
  /** A mesma expressão de `resumirPublicacoes`, reproduzida aqui. */
  const ordenar = (
    grupos: { id: string; dataDisponibilizacao: Date }[][],
    idsQueMeCitam: ReadonlySet<string>,
  ) =>
    [...grupos]
      .sort((a, b) => {
        const citaA = a.some((p) => idsQueMeCitam.has(p.id)) ? 1 : 0;
        const citaB = b.some((p) => idsQueMeCitam.has(p.id)) ? 1 : 0;
        if (citaA !== citaB) return citaB - citaA;
        return b[0].dataDisponibilizacao.getTime() - a[0].dataDisponibilizacao.getTime();
      })
      .map((g) => g[0].id);

  const grupos = [
    [{ id: 'antiga', dataDisponibilizacao: new Date('2026-09-01') }],
    [{ id: 'nova', dataDisponibilizacao: new Date('2026-09-04') }],
    [{ id: 'meio', dataDisponibilizacao: new Date('2026-09-03') }],
  ];

  /**
   * NADA MUDA PARA A GESTÃO. O escopo GLOBAL passa um conjunto vazio, e a
   * ordem tem de continuar sendo a de antes: data, da mais nova para a mais
   * velha. Se este teste quebrar, a mudança vazou para quem não pediu.
   */
  it('sem escopo pessoal, é só data — igual a antes', () => {
    expect(ordenar(grupos, new Set())).toEqual(['nova', 'meio', 'antiga']);
  });

  /**
   * O ato que INTIMA vence o mais recente. É o caso que motivou a mudança: o
   * corte é em seis, e uma intimação podia cair fora por causa de três
   * publicações do acervo que chegaram um dia depois.
   */
  it('o que me cita passa na frente, mesmo sendo o mais antigo', () => {
    expect(ordenar(grupos, new Set(['antiga']))).toEqual(['antiga', 'nova', 'meio']);
  });

  /** Entre os que me citam, a data volta a mandar. */
  it('e entre eles a data decide', () => {
    expect(ordenar(grupos, new Set(['antiga', 'meio']))).toEqual(['meio', 'antiga', 'nova']);
  });
});

/**
 * O CORTE DE PERMISSÃO É NO BACKEND — e faltava para a agenda.
 *
 * As listas de compromisso carregam `filiado.nomeCompleto`, o nome do
 * responsável e as partes do processo. Quem tivesse `agenda: SEM_ACESSO` via
 * tudo isso chegar ao navegador; o que o impedia de LER era o `pode.agenda` da
 * tela. Nenhum usuário da produção está nessa condição hoje — mas 13 dos 14
 * têm permissão customizada (medido em 07/09/2026) e a tela de usuários oferece
 * SEM_ACESSO como opção. É a mesma regra que `veProcessos` já aplicava.
 */
describe('a agenda também se corta no servidor', () => {
  it('existe um gate de módulo para a agenda', () => {
    expect(DASH).toContain("const veAgenda = nivelEfetivo(user.role, user.permissoes, 'agenda') !== 'SEM_ACESSO';");
  });

  /** As QUATRO listas de compromisso, e não só a nova. */
  it('nenhuma lista de compromisso escapa do gate', () => {
    const gates = DASH.match(/!veAgenda \? Promise\.resolve\(\[\]\) : this\.prisma\.compromisso\.findMany/g) ?? [];
    expect(gates.length).toBe(4);
  });

  /**
   * Os CONTADORES seguem vindo: são agregados sem dado pessoal, e a tela já
   * decide quais cartões desenhar. O que passa a ser cortado é o conteúdo.
   */
  /*
    Desde 13/09/2026 o `where` do contador é `painel.atrasadas`, montado por
    `wheresDoPainel` com os recortes da agenda (o número e a aba que o link abre
    saem da mesma função). A regra em si é provada com linhas em
    `painel.regras.spec.ts`; aqui fica só que o contador continua sem gate.
  */
  it('e os contadores continuam — número não identifica ninguém', () => {
    expect(DASH).toContain('this.prisma.compromisso.count({ where: painel.atrasadas })');
  });

  /**
   * ATRASADA = FICOU PARA TRÁS, e o contador tem de bater com o do sino.
   *
   * O sistema tinha DUAS definições da palavra mais grave que usa: o sino
   * (`pendencias.service.ts`) conta o que sobrou de DIA ANTERIOR, o painel
   * contava tudo com a HORA passada. Em 08/09/2026 isso dava sino = 0 e painel
   * = "8 atrasadas", para a mesma pessoa no mesmo instante.
   */
  it('o contador de atrasadas usa o início do DIA, como o sino', () => {
    const sino = readFileSync(
      join(__dirname, '../agenda/pendencias.service.ts'),
      'utf8',
    );
    expect(sino).toContain('inicio: { lt: inicioDeHoje }');
    // O painel não pode mais chamar de atraso o que é de hoje.
    expect(DASH).not.toContain('status: ABERTOS, inicio: { lt: agora } } })');
  });

  /** O que é de hoje com a hora passada virou contador PRÓPRIO — informação. */
  /* O intervalo `gte: hojeIni, lt: agora` mora em `recortePassaramDaHora` (recortes.util) desde 13/09/2026. */
  it('"passou da hora" é um contador separado, e chega na resposta', () => {
    const { hojeIni } = limitesDoDia(AGORA_BR);
    const w = wheresDoPainel({}, AGORA_BR).passaramDaHora;
    expect(JSON.stringify(w)).toContain(JSON.stringify({ gte: hojeIni, lt: AGORA_BR }));
    expect(DASH).toContain('this.prisma.compromisso.count({ where: painel.passaramDaHora })');
    expect(DASH).toContain('passaramDaHora: passaramDaHoraCount');
  });

  /*
    A carga da equipe segue a mesma régua — senão a gestão vê outro número.

    Até 13/09/2026 eram dois agrupamentos por `responsavelId`. O clique abre a
    agenda da pessoa pela régua `daPessoa`, e o número passou a ser somado pela
    mesma régua (`contarAbertasPorPessoa`), com "atrasada" = o dia virou. A
    igualdade entre a carga e a aba que o link abre está provada com linhas em
    `painel.regras.spec.ts`; aqui, que o serviço usa aquela soma.
  */
  it('a carga da equipe usa a mesma definição', () => {
    const trecho = DASH.slice(DASH.indexOf('const cargaEquipe = !ehGestao'), DASH.indexOf('A CARTEIRA DO ADVOGADO'));
    expect(trecho).toContain('contarAbertasPorPessoa(abertasDaEquipeRaw, hojeIni)');
    expect(DASH).toContain('this.prisma.compromisso.findMany({ where: recorteAberto(), select: SELECAO_DAS_ABERTAS })');
    expect(DASH).not.toContain("by: ['responsavelId']");
  });

  /** Sem módulo de processos, nem a varredura de JSON do Diário roda. */
  it('a busca por citação não roda para quem não vê processos', () => {
    expect(DASH).toContain('const idsQueMeCitam = veProcessos');
  });
});

/**
 * O PRAZO DE AMANHÃ NÃO APARECIA EM LUGAR NENHUM.
 *
 * A home tinha três janelas: vencido (Pendências), HOJE (Atividades) e
 * audiência dos próximos 7 dias. Um PRAZO para amanhã não cabia em nenhuma —
 * o advogado via só o número no cartão "Prazos esta semana".
 *
 * Medido na produção em 07/09/2026: dos compromissos abertos do sindicato
 * inteiro, **os seis** caíam exatamente nessa faixa (zero vencidos, zero hoje,
 * zero audiências na semana). A home do Dr. Carlos Henrique dizia "nenhuma
 * atividade agendada para hoje" enquanto ele tinha prazo para 08/09 e 09/09.
 */
describe('as próximas atividades', () => {
  const bloco = DASH.slice(
    DASH.indexOf('O QUE VENCE NOS PRÓXIMOS DIAS'),
    DASH.indexOf('// Audiências da semana'),
  );

  it('o trecho existe', () => {
    expect(bloco.length).toBeGreaterThan(300);
  });

  /*
    Desde 13/09/2026 o `where` é `painel.proximasAtividades` (ver
    `wheresDoPainel`), e o fim deixou de ser "agora + 7 dias" para ser o fim do
    sétimo dia de Teresina — o mesmo limite da aba 7 dias. As quatro regras
    abaixo passam a ser conferidas no objeto que a função devolve, e não no
    texto; com linhas, em `painel.regras.spec.ts`.
  */
  const w = wheresDoPainel(MEU, AGORA_BR).proximasAtividades as { AND: unknown[] };
  const { hojeFim, fimDosSeteDias } = limitesDoDia(AGORA_BR);

  it('a lista usa o recorte da função', () => {
    expect(bloco).toContain('where: painel.proximasAtividades,');
  });

  it('começa onde o "hoje" termina e vai até o fim do sétimo dia', () => {
    expect(w.AND).toContainEqual({ inicio: { gte: hojeFim, lt: fimDosSeteDias } });
  });

  /** Só o que ainda está em aberto: tarefa concluída não é "próxima". */
  it('só conta o que está em aberto', () => {
    expect(w.AND).toContainEqual(recorteAberto());
  });

  /**
   * Audiência já tem bloco próprio logo acima. Repetir a mesma audiência em
   * dois cartões é exatamente o erro que a faixa do DJEN já cometeu.
   */
  it('deixa audiência de fora, que tem cartão próprio', () => {
    expect(w.AND).toContainEqual({ tipo: { not: 'AUDIENCIA' } });
  });

  /** Escopo pessoal do advogado vale aqui como em todo o resto do painel. */
  it('respeita o escopo do perfil', () => {
    expect(w.AND[0]).toBe(MEU);
  });

  it('e viaja na resposta', () => {
    expect(DASH).toContain('proximasAtividades,');
  });
});

/**
 * A LINHA DA PUBLICACAO PESAVA UMA RAZAO SOCIAL INTEIRA (18/09/2026).
 *
 * "Essa listagem de citacoes em publicacoes nao e pesada visualmente?" E -- e a
 * maior parte do peso era UM nome: "FEDERACAO DE SINDICATOS DE TRABALHADORES
 * TECNICO-ADMINISTRATIVOS EM INSTITUICOES DE ENSINO SUPERIOR PUBLICAS DO BRASIL
 * - FASUBRA" ocupa a linha toda e some truncada, dizendo menos que "FASUBRA".
 */
describe('o nome que cabe na linha', () => {
  const longo = 'FEDERAÇÃO DE SINDICATOS DE TRABALHADORES TÉCNICO-ADMINISTRATIVOS';

  it('usa o nome de fantasia do cadastro quando existe', () => {
    expect(nomeCurtoDaParte({ nome: longo, parteExterna: { nomeFantasia: 'FASUBRA' } }))
      .toBe('FASUBRA');
  });

  /** Sem fantasia, fica o nome dos autos — que é o que sempre foi. */
  it('cai no nome dos autos sem fantasia', () => {
    expect(nomeCurtoDaParte({ nome: longo })).toBe(longo);
    expect(nomeCurtoDaParte({ nome: longo, parteExterna: null })).toBe(longo);
    expect(nomeCurtoDaParte({ nome: longo, parteExterna: { nomeFantasia: '   ' } })).toBe(longo);
  });

  /** Não é abreviação adivinhada: o nome curto foi escolhido por gente. */
  it('o adversário do processo já sai curto', () => {
    const partes = [
      { nome: 'SENATEPI', polo: 'ATIVO', principal: true, parteExternaId: 'nos' },
      {
        nome: longo, polo: 'PASSIVO', principal: true, parteExternaId: 'x',
        parteExterna: { nomeFantasia: 'FASUBRA' },
      },
    ];
    expect(adversarioDoProcesso(partes, 'nos')).toBe('FASUBRA');
  });
});

/**
 * "FASUBRA x FASUBRA" -- O MESMO NOME DOS DOIS LADOS (18/09/2026).
 *
 * Quando o sindicato e o REU, as duas regras apontam para a MESMA parte: o autor
 * e quem esta no polo ativo, e o adversario e "o polo oposto ao nosso" -- que,
 * sendo nos o passivo, tambem e o ativo. A linha do painel imprimia a razao
 * social inteira DUAS VEZES, e era isso que a fazia ocupar duas alturas.
 */
describe('os dois lados da linha da publicação', () => {
  const fasubra = {
    nome: 'FEDERAÇÃO DE SINDICATOS - FASUBRA', polo: 'ATIVO', principal: true,
    parteExternaId: 'fas', parteExterna: { nomeFantasia: 'FASUBRA' },
  };
  const nos = { nome: 'SENATEPI', polo: 'PASSIVO', principal: true, parteExternaId: 'nos' };

  it('somos RÉU: o nome sai uma vez só', () => {
    const r = partesDaLinha([fasubra, nos], 'nos');
    expect(r.adversario).toBe('FASUBRA');
    expect(r.autor).toBeNull();
  });

  /** Somos autor: o autor já era calado, e o adversário distingue a linha. */
  it('somos AUTOR: só o adversário', () => {
    const r = partesDaLinha(
      [{ ...nos, polo: 'ATIVO' }, { ...fasubra, polo: 'PASSIVO' }],
      'nos',
    );
    expect(r.autor).toBeNull();
    expect(r.adversario).toBe('FASUBRA');
  });

  /** Representando o filiado: os DOIS informam, e são diferentes. */
  it('não somos parte: mostra os dois', () => {
    const filiada = {
      nome: 'MARIA DA SILVA', polo: 'ATIVO', principal: true,
      parteExternaId: null, filiadoId: 'f1',
    };
    const r = partesDaLinha([filiada, { ...fasubra, polo: 'PASSIVO' }], 'nos');
    expect(r.autor).toBe('MARIA DA SILVA');
    expect(r.adversario).toBe('FASUBRA');
  });
});
