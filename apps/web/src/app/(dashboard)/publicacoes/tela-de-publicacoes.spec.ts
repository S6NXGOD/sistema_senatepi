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
  it('não usa requisição nova — a mesma chave do sino', () => {
    expect(CARD_PAINEL).toContain("queryKey: ['minhas-pendencias']");
  });

  it('some quando não há fila', () => {
    expect(CARD_PAINEL).toContain('if (!acoes || acoes.total === 0) return null;');
  });

  /** Vermelho é do que venceu. Isto é trabalho a fazer. */
  it('não se pinta de vermelho', () => {
    expect(CARD_PAINEL).not.toContain('text-red-');
    expect(CARD_PAINEL).not.toContain('bg-red-');
  });

  /** Mesmo gate do sino: a rota é @Modulo('agenda'). */
  it('respeita a permissão de quem vê', () => {
    expect(CARD_PAINEL).toContain("podeVer(user?.role, user?.permissoes, 'agenda')");
    expect(CARD_PAINEL).toContain('enabled: permitido,');
  });

  /** Cada linha abre o cadastro já preenchido — vem pronto do backend. */
  it('cada linha leva direto ao cadastro', () => {
    expect(CARD_PAINEL).toContain('href={e.href}');
    expect(CARD_PAINEL).toContain('Cadastrar');
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
    expect(CARTAO).toContain('title={formatData(pub.dataDisponibilizacao)}');
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
