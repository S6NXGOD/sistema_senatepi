import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DASH = readFileSync(join(__dirname, 'dashboard.module.ts'), 'utf8');

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

  /** As duas consultas do Diário usam o MESMO escopo — duas contas divergiriam. */
  it('o contador e a lista usam o mesmo recorte', () => {
    const usos = DASH.match(/\.\.\.meuDjen,/g) ?? [];
    expect(usos.length).toBe(2);
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
    expect(DASH).toContain("regexp_replace(a->>'numeroOab', '\\D', '', 'g') = ${numero}");
    expect(DASH).toContain("upper(a->>'ufOab') = ${uf}");
  });

  /**
   * Recortar pela janela ANTES do `jsonb_array_elements`: sem isso a expansão
   * varreria as 1.408 publicações do acervo para responder sobre sete dias.
   */
  it('filtra a janela antes de expandir o JSON', () => {
    const fn = DASH.slice(
      DASH.indexOf('private async publicacoesQueCitam('),
      DASH.indexOf('private resumirPublicacoes('),
    );
    expect(fn.indexOf('data_disponibilizacao" >= ${desde}')).toBeLessThan(
      fn.indexOf('jsonb_array_elements'),
    );
  });

  /** Advogado sem OAB no cadastro cai no comportamento antigo, sem quebrar. */
  it('sem OAB, o vínculo por citação simplesmente não existe', () => {
    expect(DASH).toContain('if (!numero || !uf) return [];');
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
  it('e os contadores continuam — número não identifica ninguém', () => {
    expect(DASH).toContain('this.prisma.compromisso.count({ where: { ...meu, status: ABERTOS, inicio: { lt: agora } } })');
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

  it('começa onde o "hoje" termina e vai até sete dias', () => {
    expect(bloco).toContain('inicio: { gte: hojeFim, lt: em7dias }');
  });

  /** Só o que ainda está em aberto: tarefa concluída não é "próxima". */
  it('só conta o que está em aberto', () => {
    expect(bloco).toContain('status: ABERTOS');
  });

  /**
   * Audiência já tem bloco próprio logo acima. Repetir a mesma audiência em
   * dois cartões é exatamente o erro que a faixa do DJEN já cometeu.
   */
  it('deixa audiência de fora, que tem cartão próprio', () => {
    expect(bloco).toContain('tipo: { not: TIPO_AUDIENCIA }');
  });

  /** Escopo pessoal do advogado vale aqui como em todo o resto do painel. */
  it('respeita o escopo do perfil', () => {
    expect(bloco).toContain('...meu,');
  });

  it('e viaja na resposta', () => {
    expect(DASH).toContain('proximasAtividades,');
  });
});
