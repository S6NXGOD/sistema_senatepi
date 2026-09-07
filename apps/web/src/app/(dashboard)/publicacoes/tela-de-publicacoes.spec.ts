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
