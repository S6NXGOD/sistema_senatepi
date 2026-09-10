import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGINA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const CARTAO = readFileSync(
  join(__dirname, '../../../components/processos/publicacao-djen-card.tsx'),
  'utf8',
);
const CARD_PAINEL = readFileSync(
  join(__dirname, '../../../components/dashboard/acoes-sem-cadastro.tsx'),
  'utf8',
);

/**
 * O FILTRO DE ADVOGADO FICAVA PRESO, E EM SILÊNCIO.
 *
 * `citaAdvogado` não entrava em `temFiltro` nem em `limpar()`. Escolher "Intimou
 * Dra. Shérad" e depois clicar em "Limpar filtros" devolvia a lista ainda
 * filtrada por ela — com o botão de limpar já sumido, porque `temFiltro` não
 * o via. A pessoa concluía que o acervo tinha 4 publicações.
 */
describe('os filtros da tela de publicações', () => {
  it('o filtro de advogado conta como filtro e é limpo junto', () => {
    expect(PAGINA).toContain("chave: 'adv'");
    expect(PAGINA).toContain("setCitaAdvogado('');");
    // `temFiltro` deriva da lista — não há mais uma segunda enumeração para
    // esquecer de atualizar quando entrar o próximo filtro.
    expect(PAGINA).toContain('const temFiltro = ativos.length > 0;');
  });

  /** Etiqueta por filtro: dá para tirar um sem perder os outros. */
  it('cada filtro ativo vira etiqueta que sai sozinha', () => {
    expect(PAGINA).toContain('ativos.map((f) => (');
    expect(PAGINA).toContain('f.limpar();');
    expect(PAGINA).toContain('Limpar tudo');
  });

  /**
   * NO CELULAR OS FILTROS COMEÇAM FECHADOS — eram uma tela inteira de controles
   * antes da primeira publicação. As etiquetas ficam FORA do bloco colapsável,
   * senão fechar esconderia o motivo de a lista estar curta.
   */
  it('no celular os filtros colapsam, com o número de ativos no botão', () => {
    expect(PAGINA).toContain('const [filtrosAbertos, setFiltrosAbertos] = useState(false);');
    expect(PAGINA).toContain("cn('space-y-3', !filtrosAbertos && 'hidden lg:block')");
    expect(PAGINA).toContain('lg:hidden');
    // O contador no botão: fechado sem ele seria fechado e mentiroso.
    expect(PAGINA).toContain('{ativos.length}');
  });

  it('e o plural do total é escolhido, não escapado', () => {
    expect(PAGINA).toContain("=== 1 ? 'publicação' : 'publicações'");
    expect(PAGINA).not.toContain('publicação(ões)');
  });
});

/**
 * METADE DO QUE SE LIA NA LISTA ERA TIMBRE DE TRIBUNAL.
 *
 * Medido nas 1.420 publicações da produção: 1.185 (83%) começam com o mesmo
 * cabeçalho institucional, 302 caracteres em média, e o cartão mostra ~600
 * antes do "Ler tudo". O cabeçalho repete órgão, número e partes que o próprio
 * cartão já exibe acima, estruturado.
 */
describe('o cartão de publicação', () => {
  it('esconde o timbre no resumo e o devolve inteiro ao expandir', () => {
    expect(CARTAO).toContain('separarTimbre(pub.texto)');
    expect(CARTAO).toContain('const textoVisivel = inteiro ? pub.texto : corpo;');
  });

  /**
   * Duas linhas diziam a mesma coisa: "Autor × Réu" e depois "Intimado: <os
   * mesmos dois>, truncado". 92% das publicações intimam os dois polos.
   */
  it('resume os intimados em vez de repetir as partes', () => {
    expect(CARTAO).toContain('const dosDoisLados = polos.has(\'A\') && polos.has(\'P\');');
    expect(CARTAO).toContain('Intimados: os dois lados');
  });

  /** A minoria é o que informa: um polo só muda a leitura do ato. */
  it('mas nomeia quem foi intimado quando é um lado só', () => {
    expect(CARTAO).toContain('.map((d) => capitalizar(d.nome as string))');
  });
});

/**
 * A FILA DO DIÁRIO NO PAINEL — como card, nunca como faixa.
 *
 * A faixa global mostrava o mesmo número em cima de TODA tela e o usuário
 * reclamou com razão: trinta itens que levam dias para conferir viram
 * cabeçalho, e cabeçalho ninguém lê. O painel é a primeira tela de todo login.
 */
describe('o card de ações sem cadastro no painel', () => {
  /**
   * SAIU DE `minhas-pendencias` PARA A FILA DE VERDADE.
   *
   * A primeira versão reusava a consulta do sino para não gastar requisição, e
   * a linha resultante era "Movemos · 08053442320218180031": vinte dígitos e
   * uma palavra. O usuário pediu polo, partes e a foto do advogado — nada disso
   * o sino carrega. A fila carrega, e é a MESMA chave de cache da tela de
   * Processos, então quem for para lá em seguida não paga de novo.
   */
  it('lê a fila, que traz partes, polo e advogados', () => {
    expect(CARD_PAINEL).toContain("queryKey: ['processos', 'sugestoes']");
    expect(CARD_PAINEL).toContain('advogadosNossos');
  });

  it('some quando não há fila', () => {
    expect(CARD_PAINEL).toContain('if (!permitido || !fila.length) return null;');
  });

  /** Vermelho é do que venceu. Isto é trabalho a fazer. */
  it('não se pinta de vermelho', () => {
    expect(CARD_PAINEL).not.toContain('text-red-');
    expect(CARD_PAINEL).not.toContain('bg-red-');
  });

  /**
   * QUEM CADASTRA, e não quem apenas vê. O card só oferece um botão —
   * "Cadastrar" — e desenhá-lo para quem levaria 403 ao clicar é oferecer um
   * caminho que não existe.
   */
  it('exige permissão de EDITAR processos, não de ver', () => {
    expect(CARD_PAINEL).toContain("podeEditar(user?.role, user?.permissoes, 'processos')");
    expect(CARD_PAINEL).toContain('enabled: permitido,');
  });

  it('cada linha leva ao cadastro daquele NPU', () => {
    expect(CARD_PAINEL).toContain('href={`/processos?cadastrar=${s.numeroCNJ}`}');
  });

  /**
   * O ADVERSÁRIO, e não "Autor × Réu": o nome do sindicato é o mesmo nas trinta
   * linhas e gastaria a largura toda. O que muda — e decide se alguém abre — é
   * quem está do outro lado.
   */
  it('mostra o adversário, nunca o próprio sindicato', () => {
    expect(CARD_PAINEL).toContain("const oPoloDeles = s.nossoPolo === 'PASSIVO' ? 'A' : 'P';");
    // Em recurso o sindicato figura nos dois polos: nunca é o adversário.
    expect(CARD_PAINEL).toContain('!palavras(n).includes(nosso)');
  });

  /**
   * Rodado contra a produção: 23 das 30 rendem um nome. Nas outras 7 a
   * publicação listou só o nosso lado — e elas trazem a CLASSE, que informa
   * mais ("Cumprimento de Sentença contra a Fazenda Pública") do que a verdade
   * inútil "parte não informada".
   */
  it('cai para a classe da ação quando não há adversário no ato', () => {
    expect(CARD_PAINEL).toContain('function descreverAcao');
    expect(CARD_PAINEL).toContain('s.nomeClasse');
    expect(CARD_PAINEL).toContain('capitalizar(classe)');
  });

  /** O rosto responde "esta é minha" numa fila coletiva de trinta. */
  it('mostra a foto de quem foi citado no ato', () => {
    expect(CARD_PAINEL).toContain('<AvatarPessoa');
    expect(CARD_PAINEL).toContain('citado neste ato');
  });
});

/**
 * A PROVIDÊNCIA É O CAMPO QUE SE VARRE, e estava desenhada como o resto.
 *
 * Numa lista de 1.420 atos a pergunta é sempre "o que eu tenho de FAZER aqui?".
 * A resposta é a providência, e ela era uma pílula cinza de 10px, do mesmo peso
 * da sigla do tribunal e do nome do órgão.
 */
describe('a leitura rápida da lista', () => {
  it('a providência ganha cor por família de esforço', () => {
    expect(PAGINA).toContain('PROVIDENCIA_COR[grupo.principal.providencia]');
    // Providência nova aparece neutra em vez de herdar a cor errada em silêncio.
    expect(PAGINA).toContain('?? PROVIDENCIA_COR_PADRAO');
  });

  /**
   * "03/09/2026" obriga a fazer a subtração de cabeça, uma vez por cartão. A
   * data exata continua no `title`, que é o que serve para citar num pedido.
   */
  it('a data vira "há N dias" enquanto isso ainda informa', () => {
    expect(CARTAO).toContain('quandoSaiu(pub.dataDisponibilizacao)');
    /*
      A DATA SAIU DA DICA DO MOUSE E FOI PARA A TELA.

      O comentário do cartão prometia "a data exata continua no `title` e, no
      desktop, ao lado" — e o "ao lado" nunca existiu. No telefone não há hover,
      então a data simplesmente não estava em lugar nenhum.

      `formatDataPura`, e não `formatData`: `data_disponibilizacao` é `@db.Date`
      e chega como meia-noite UTC. Com `formatData` a tela mostrava um dia a
      menos em TODAS as 500 publicações medidas — e é dela que se conta prazo.
    */
    expect(CARTAO).toContain('{formatDataPura(pub.dataDisponibilizacao)}');
    // E não se repete quando o relativo JÁ é a data (acima de 60 dias).
    expect(CARTAO).toContain('const ehDataCurta =');
    expect(CARTAO).toContain('{!ehDataCurta && (');
    // Passado o limite, o relativo informa MENOS que a data.
    expect(CARTAO).toContain('if (dias <= 60) return `há ${dias} dias`;');
  });

  /**
   * `dataDisponibilizacao` é coluna DATE (meia-noite UTC). Contar por
   * milissegundo faria a publicação de hoje virar "ontem" às 21h — o mesmo erro
   * de fuso que mordeu o robô de cobranças.
   */
  it('compara dia de calendário, não instante', () => {
    expect(CARTAO).toContain('const agoraBR = new Date(Date.now() - 3 * 3_600_000);');
    expect(CARTAO).toContain('Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())');
  });
});

/**
 * O QUE A TELA DIZ QUANDO DÁ ERRADO.
 *
 * A importação em lote consulta o CNJ uma vez por ação: é normal que 27 passem
 * e 3 falhem. A versão anterior listava os NPUs e parava — e sem o motivo não
 * há o que fazer com a informação: tentar de novo? corrigir o número? esperar
 * o CNJ voltar? São três ações diferentes.
 */
describe('o aviso de falha parcial no cadastro em lote', () => {
  const FILA = readFileSync(
    join(__dirname, '../../../components/processos/acoes-encontradas.tsx'),
    'utf8',
  );

  it('agrupa as falhas pelo motivo, não por item', () => {
    expect(FILA).toContain('const porMotivo = new Map<string, string[]>();');
    expect(FILA).toContain('${npus.join(\', \')} — ${motivo}');
  });

  /** Doze segundos de aviso não comportam cinco parágrafos. */
  it('mostra dois motivos e conta o resto', () => {
    expect(FILA).toContain('.slice(0, 2)');
    expect(FILA).toContain('e mais ${porMotivo.size - 2} motivo(s)');
  });

  /** Backend que não explicou não pode virar string vazia na tela. */
  it('tem texto para o motivo ausente', () => {
    expect(FILA).toContain("'motivo não informado'");
  });
});

/**
 * O DIÁLOGO NÃO PODE PÔR NINGUÉM NOS DOIS POLOS.
 *
 * Caso real do print, 0001023-67.2025.5.22.0001: recurso com 24 publicações, e
 * o formulário abriu com a EBSERH no polo ativo E no passivo, o SENATEPI
 * idem — um processo em que a empresa processa a si mesma, com cara de dado
 * conferido.
 */
describe('o diálogo de importar diante de um recurso', () => {
  const DIALOGO = readFileSync(
    join(__dirname, '../../../components/processos/importar-processo-dialog.tsx'),
    'utf8',
  );

  it('detecta a parte repetida nos dois polos e não a distribui', () => {
    expect(DIALOGO).toContain('const ambos = new Set(');
    expect(DIALOGO).toContain('.filter((n) => !ambos.has(chave(n)))');
    expect(DIALOGO).toContain('setPoloAtivo(semAmbiguas(nosAtivos));');
    expect(DIALOGO).toContain('setNosDoisPolos(');
  });

  /**
   * Não adivinha o lado: o polo de um recurso é a posição RECURSAL, não a da
   * ação original. A faixa pergunta, com um clique por parte.
   */
  it('pergunta o lado em vez de chutar', () => {
    expect(DIALOGO).toContain('function resolverAmbigua');
    expect(DIALOGO).toContain('Polo ativo');
    expect(DIALOGO).toContain('Polo passivo');
    expect(DIALOGO).toContain('não diz de');
  });

  /** Dois cliques não podem virar duas linhas iguais. */
  it('não duplica se a pessoa já tinha acrescentado o nome à mão', () => {
    expect(DIALOGO).toContain('jaEstaNaLista(atual, parte) ? atual : [...atual, parte]');
  });

  /**
   * A faixa fica no alto da coluna das partes; ao rolar até o rodapé ela sai da
   * tela. Importar sem resolver é permitido, mas não pode ser silencioso.
   */
  it('avisa no rodapé o que vai ficar de fora', () => {
    expect(DIALOGO).toContain('ainda sem lado escolhido');
    expect(DIALOGO).toContain('Dá para completar depois, na aba Partes');
  });

  /** Abrir o diálogo na mão não pode herdar a ambiguidade do último aberto. */
  it('limpa a ambiguidade quando não vem da fila', () => {
    expect(DIALOGO).toContain('setNosDoisPolos([]);');
  });
});

/**
 * DE QUEM É O PRAZO — a pergunta que o aviso não fazia.
 *
 * "O texto menciona prazo de 15 dias" e ponto. Mas o tribunal publica o MESMO
 * ato para todos os intimados e a ordem costuma ser de um lado só: no
 * 0000978-59.2022.5.22.0004 o teor manda a RECLAMADA recolher em 15 dias, e o
 * robô criou "Elaborar manifestação" na agenda de um advogado nosso. Das 14
 * tarefas que o robô criou, CINCO já tinham sido canceladas à mão.
 */
describe('o aviso de prazo na publicação', () => {
  it('muda de tom quando a ordem é da parte contrária', () => {
    expect(CARTAO).toContain("pub.tarefaDispensadaMotivo === 'ORDEM_DA_OUTRA_PARTE'");
    expect(CARTAO).toContain('dirigido à');
    expect(CARTAO).toContain('parte contrária');
  });

  /**
   * Continua mostrando o número: saber que o adversário tem 15 dias é útil. O
   * que muda é parar de sugerir que alguém aqui precisa agir.
   */
  it('mas não esconde o prazo', () => {
    const trecho = CARTAO.slice(CARTAO.indexOf("=== 'ORDEM_DA_OUTRA_PARTE'"));
    expect(trecho).toContain('{pub.prazoMencionadoDias} dias');
    expect(trecho).toContain('crie a');
  });

  /** Sem prazo no texto, a ausência de tarefa ainda precisa de explicação. */
  it('explica a ausência de tarefa mesmo sem prazo citado', () => {
    expect(CARTAO).toContain('MOTIVO_SEM_TAREFA[pub.tarefaDispensadaMotivo]');
    expect(CARTAO).toContain('Sem tarefa ·');
  });

  /** Publicação COM tarefa não ganha aviso de ausência — seria contraditório. */
  it('não explica ausência quando a tarefa existe', () => {
    expect(CARTAO).toContain('!pub.compromissoId &&');
  });
});

/**
 * O QUE ESTAVA GUARDADO E NUNCA CHEGAVA À TELA.
 *
 * A API sempre mandou `tipoDocumento`; o cartão o ignorava. Medido nas 1.490
 * publicações da produção — 100% preenchido:
 *
 *   Notificação ............ 927      Acórdão ................ 192
 *   Distribuição ........... 160      DECISÃO MONOCRÁTICA ....  35
 *   Intimação ..............  90      Decisão .................  25
 *
 * São 252 atos decisórios (17%) que apareciam com o mesmo peso visual de uma
 * lista de distribuição. E o `tipoComunicacao` que o cartão já mostrava é
 * "Intimação" em 88% dos casos — quase constante, quase sem informação.
 */
describe('o tipo de documento chega à tela', () => {
  it('o cartão mostra o documento guardado', () => {
    expect(CARTAO).toContain('const documento = (pub.tipoDocumento ?? ');
    expect(CARTAO).toContain('{documentoVisivel}');
  });

  /** Acórdão e decisão mudam o rumo; notificação é rotina. */
  it('e destaca o que é ato decisório', () => {
    expect(CARTAO).toContain('const ehDecisao = /ac[óo]rd[ãa]o|decis[ãa]o|senten[çc]a/i.test(documento)');
    expect(CARTAO).toContain('Ato decisório — muda o rumo do caso');
  });

  /**
   * SÓ QUANDO ACRESCENTA: "Intimação" no tipo de comunicação e "Intimação" no
   * documento é a mesma palavra duas vezes.
   */
  it('não repete o que o tipo de comunicação já disse', () => {
    expect(CARTAO).toContain("documento.toLowerCase() !== (pub.tipoComunicacao ?? '').trim().toLowerCase()");
  });
});
