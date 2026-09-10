import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

const PAINEL = ler('src/modules/dashboard/dashboard.module.ts');
const BUSCA = ler('src/modules/processos/djen-busca.service.ts');
const CONTROLLER = ler('src/modules/processos/djen.controller.ts');

/**
 * O BLOCO DO DJEN NA HOME — o último lugar que ficou sem o agrupamento.
 *
 * As cópias por destinatário foram agrupadas na gaveta da atividade, na aba do
 * processo e na tela de busca; o painel continuou listando cru, e o jurídico
 * abriu a home em 04/09/2026 com "Elaborar manifestação" duas vezes seguidas e
 * "Juntar documentos" duas vezes seguidas — quatro linhas para dois atos.
 */
describe('painel do DJEN na home', () => {
  /**
   * O LINK VIROU ATALHO, NÃO MAIS A CHAVE.
   *
   * A regra antiga agrupava só por link, e o tribunal passou a emitir um código
   * de validação POR DESTINATÁRIO — o mesmo ato aparecia duas vezes no painel.
   * Medido em 08/09/2026 sobre 1.433 publicações: entre pares do mesmo processo
   * e dia com links DIFERENTES, a mediana de semelhança é 0,973 e 262 de 303
   * passam de 0,9.
   *
   * A regra daqui é ESPELHO de `ehCopia` em `web/src/lib/publicacoes-irmas.ts`:
   * se as duas divergirem, o painel e a aba mostram números diferentes do mesmo
   * acervo e ninguém sabe em qual acreditar.
   */
  it('agrupa as cópias por dia + link OU semelhança de texto', () => {
    expect(PAINEL).toContain('private resumirPublicacoes(');
    expect(PAINEL).toContain('function ehCopiaDePublicacao(');
    const cmp = PAINEL.slice(PAINEL.indexOf('function ehCopiaDePublicacao('));
    // Mesmo dia é obrigatório: atos de dias diferentes chegaram a 0,921.
    expect(cmp).toContain('diaDaPublicacao(a.dataDisponibilizacao) !== diaDaPublicacao(b.dataDisponibilizacao)');
    // Link igual continua sendo aceite imediato — cópias reais chegam a 0,634.
    expect(cmp).toContain('if (a.link && b.link && a.link === b.link) return true;');
    expect(cmp).toContain('>= 0.9');
  });

  /**
   * O corte em seis vem DEPOIS do agrupamento. Cortar antes entregaria três
   * atos onde cabem seis — foi por isso que o `take` da consulta subiu.
   */
  it('busca folgado e corta depois de agrupar', () => {
    const consulta = PAINEL.slice(
      PAINEL.indexOf('As últimas com PROVIDÊNCIA'),
      PAINEL.indexOf('A ORGANIZAÇÃO DO PRÓPRIO SINDICATO'),
    );
    expect(consulta).toContain('take: 40,');
    const fn = PAINEL.slice(PAINEL.indexOf('private resumirPublicacoes('));
    /*
      O corte é DEPOIS de agrupar — e a asserção prova a ORDEM, não a distância.

      Antes ela olhava `fn.slice(0, 2200)`: um comentário novo no meio da função
      empurrava a linha para fora da janela e o teste caía sem que nada tivesse
      mudado de comportamento. Comparar as posições diz o que importa.
    */
    expect(fn).toContain('grupos.slice(0, 6)');
    expect(fn.indexOf('grupos_.push([pub])')).toBeLessThan(fn.indexOf('grupos.slice(0, 6)'));
  });

  /** O contador também conta ATOS: "4 publicações" onde havia 2 era mentira. */
  it('o volume de 7 dias conta atos, não cópias', () => {
    const fn = PAINEL.slice(PAINEL.indexOf('private situacaoDjen('));
    expect(fn.slice(0, 2600)).toContain('const atos = new Set(');
    expect(fn.slice(0, 2600)).toContain('publicacoes7d: atos.size,');
  });

  /**
   * ESCOPO DO ADVOGADO — e ele mudou de definição.
   *
   * Era só "os processos vinculados a mim". Mas quem é INTIMADO é quem está
   * nomeado no ato, e as duas listas divergem: medido em 07/09/2026, a
   * Dra. Jaqueline era citada em 4 publicações e via ZERO, enquanto a
   * Dra. Morgana via 32 das quais 6 a citavam. Hoje o recorte é a UNIÃO — quem
   * responde pelo caso continua vendo o ato mesmo quando a intimação saiu no
   * nome do colega. O detalhe está em `painel-do-advogado.spec.ts`.
   *
   * Sem recorte nenhum, cada advogado abriria a home vendo a publicação dos
   * processos dos outros sete: publicação alheia com cara de prazo ou é
   * conferida uma a uma, ou ensina a ignorar o bloco — e aí some junto a que
   * era dele.
   */
  it('o advogado vê o próprio acervo E o que o nomeia', () => {
    expect(PAINEL).toContain('const meuAcervo: Prisma.ProcessoWhereInput = souAdvogado');
    expect(PAINEL).toContain('? { advogados: { some: { advogadoId: user.id } } }');
    /*
      As duas consultas do DJEN respeitam o MESMO recorte. A contagem não exige
      a forma espalhada `...meuDjen,`: uma delas passou a entrar dentro de um
      `AND`, porque `meuDjen` traz uma chave `OR` e duas chaves `OR` no mesmo
      objeto não somam — a segunda sobrescreve a primeira, em silêncio.
    */
    const usados = (PAINEL.match(/meuDjen/g) ?? []).length;
    const declaracoes = (PAINEL.match(/const meuDjen/g) ?? []).length;
    expect(usados - declaracoes).toBeGreaterThanOrEqual(2);
    expect(PAINEL).toContain("escopo: 'GLOBAL' | 'PESSOAL',");
  });

  /**
   * `compromissoId` preenchido não basta: a atividade pode ter sido concluída
   * ou cancelada, e aí a publicação volta a ser notícia sem dono. É a diferença
   * entre "alguém está cuidando" e "isto pediu algo e ninguém pegou".
   */
  /**
   * "NUNCA VIROU TAREFA" É DIFERENTE DE "A TAREFA FECHOU".
   *
   * Concluída quer dizer que alguém fez; cancelada, que alguém decidiu que não
   * era para fazer — e a decisão fica registrada com motivo e categoria. Marcar
   * as duas como "sem tarefa" apagaria o trabalho humano. O risco de verdade é
   * o ato que pediu algo e nunca chegou a virar nada.
   */
  it('separa "nunca virou tarefa" de "a tarefa fechou"', () => {
    expect(PAINEL).toContain('semTarefa: pub.compromissoId === null,');
  });

  it('distingue tarefa ABERTA de tarefa qualquer', () => {
    expect(PAINEL).toContain('temTarefaAberta:');
    const fn = PAINEL.slice(PAINEL.indexOf('temTarefaAberta:'));
    expect(fn.slice(0, 200)).toContain("pub.compromisso?.status === 'PENDENTE'");
    expect(fn.slice(0, 200)).toContain("pub.compromisso?.status === 'EM_ANDAMENTO'");
  });

  /** Contra quem litigamos: piso de três, e o próprio sindicato fora. */
  it('os adversários recorrentes excluem o próprio sindicato', () => {
    expect(PAINEL).toContain('const MINIMO_PARA_SER_PADRAO = 3;');
    const bloco = PAINEL.slice(PAINEL.indexOf('const adversarios = await'));
    expect(bloco.slice(0, 900)).toContain('a.parteExternaId !== organizacaoDoSindicato?.id');
    expect(bloco.slice(0, 900)).toContain('a._count.processoId >= MINIMO_PARA_SER_PADRAO');
  });

  /** A organização do sindicato é achada pelo CNPJ do tenant, não pelo nome. */
  it('reconhece o sindicato pelo CNPJ do tenant', () => {
    expect(PAINEL).toContain("documento: tenant.cnpj.replace(/\\D/g, '')");
  });

  /**
   * O CORTE É NO BACKEND, não só na tela.
   *
   * A Triagem tem `processos: SEM_ACESSO` no preset do perfil, e a home
   * escondia os blocos jurídicos apenas no front — o teor das publicações, o
   * nome das partes contrárias e o do advogado de cada processo viajavam até o
   * navegador dela do mesmo jeito. É a regra que já estava escrita para
   * `cargaEquipe`, aplicada onde faltava.
   */
  it('quem não tem o módulo de processos não recebe o dado', () => {
    expect(PAINEL).toContain(
      "const veProcessos = nivelEfetivo(user.role, user.permissoes, 'processos') !== 'SEM_ACESSO';",
    );
    // As consultas nem chegam a rodar — não é filtro depois, é ausência antes.
    const guardas = PAINEL.split("!veProcessos").length - 1;
    expect(guardas).toBe(5);
    expect(PAINEL).toContain("if (!veProcessos) return [];");
  });

  /**
   * E O PAYLOAD VAZIO PRECISA SER HONESTO.
   *
   * Sem acesso as consultas não rodam, e a data da última publicação chega
   * nula — a regra de situação leria isso como PRIMEIRA e a tela diria que a
   * integração está ligada e nunca trouxe nada. Alarme falso sobre um sistema
   * saudável, hoje escondido só pelo gate de módulo do front. Depender disso é
   * depender da tela para não mentir.
   */
  it('sem acesso, o bloco vem inativo em vez de parecer quebrado', () => {
    expect(PAINEL).toContain("this.djenAtivo && veProcessos,");
  });
});

/**
 * A MESMA CARTEIRA, NA TELA DE BUSCA. O painel é resumo de sete dias; quem
 * precisa procurar vai para /publicacoes, e o advogado tem de chegar lá na
 * própria carteira em vez de na dos nove.
 */
describe('escopo pessoal na busca de publicações', () => {
  it('o filtro existe no serviço', () => {
    expect(BUSCA).toContain('meusProcessosDe?: string;');
    expect(BUSCA).toContain(
      "where.push({ processo: { advogados: { some: { advogadoId: filtro.meusProcessosDe } } } });",
    );
  });

  /**
   * O ID SAI DO TOKEN, NUNCA DA QUERY. Aceitar um `advogadoId` do cliente
   * deixaria qualquer um ler o acervo de qualquer colega mudando a URL.
   */
  it('o id de "meus" vem do usuário autenticado', () => {
    expect(CONTROLLER).toContain("meusProcessosDe: filtro.meus === 'true' ? user.id : undefined,");
    expect(CONTROLLER).not.toContain('advogadoId?: string');
  });
});

/**
 * "PEDE PROVIDÊNCIA" É "PEDE DE NÓS".
 *
 * Um ato cuja ordem é da reclamada tem providência classificada — o texto
 * realmente pede algo — mas pede de OUTRA PESSOA. Deixá-lo no bloco é a mesma
 * confusão que fazia o robô criar tarefa: "o ato pede algo" não é "o ato pede
 * algo de nós".
 */
describe('o bloco não lista o que é da parte contrária', () => {
  it('respeita o carimbo que o robô já grava', () => {
    const consulta = PAINEL.slice(
      PAINEL.indexOf('As últimas com PROVIDÊNCIA'),
      PAINEL.indexOf('A ORGANIZAÇÃO DO PRÓPRIO SINDICATO'),
    );
    expect(consulta).toContain("tarefaDispensadaMotivo: { not: 'ORDEM_DA_OUTRA_PARTE' }");

    /*
      E O NULO TEM DE ENTRAR JUNTO. `NOT: { motivo: 'X' }` vira `motivo <> 'X'`
      no SQL, que é NULO — não verdadeiro — quando a coluna é nula; a linha some.
      Nulo aqui significa "o robô nunca dispensou", ou seja a intimação NOVA,
      que é justamente o que o bloco existe para mostrar. Medido na produção em
      10/09/2026: 37 das 1.488 sumiam assim, e eram as mais recentes.
    */
    expect(consulta).toContain('{ tarefaDispensadaMotivo: null }');
    expect(consulta).not.toMatch(/NOT: \{ tarefaDispensadaMotivo:/);
  });

  /**
   * E só esse motivo: `NOTICIA_VELHA` e `FORA_DA_JANELA` continuam aparecendo.
   * Elas não têm tarefa por serem ANTIGAS, não por serem de outro — e ler o
   * que saiu no Diário sobre o próprio acervo continua sendo trabalho nosso.
   */
  it('mas não esconde as antigas', () => {
    const consulta = PAINEL.slice(
      PAINEL.indexOf('As últimas com PROVIDÊNCIA'),
      PAINEL.indexOf('A ORGANIZAÇÃO DO PRÓPRIO SINDICATO'),
    );
    expect(consulta).not.toContain('NOTICIA_VELHA');
    expect(consulta).not.toContain('FORA_DA_JANELA');
  });
});
