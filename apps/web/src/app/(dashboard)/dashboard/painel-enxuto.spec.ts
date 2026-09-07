import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGINA = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const WIDGETS = readFileSync(
  join(__dirname, '../../../components/dashboard/widgets.tsx'),
  'utf8',
);
const LIMPO = readFileSync(
  join(__dirname, '../../../components/dashboard/o-que-esta-limpo.tsx'),
  'utf8',
);
const ATALHOS = readFileSync(
  join(__dirname, '../../../components/dashboard/atalhos-do-perfil.tsx'),
  'utf8',
);

/** O corpo de `Conteudo`, que é onde a ordem das zonas é decidida. */
const CONTEUDO = PAGINA.slice(PAGINA.indexOf('function Conteudo('), PAGINA.indexOf('// Blocos'));

/**
 * METADE DA PRIMEIRA TELA ERA O SISTEMA DIZENDO QUE NÃO TINHA O QUE DIZER.
 *
 * Medido no painel do administrador em 07/09/2026: das nove seções principais,
 * QUATRO estavam vazias ao mesmo tempo — nada na agenda de hoje, sem audiências
 * na semana, nada atrasado, nenhum atendimento na fila. E só 3 dos 11 blocos
 * somem sozinhos quando não têm conteúdo; os outros 8 desenhavam cartão
 * inteiro, com título, ícone, moldura e um "nenhum registro" no meio.
 */
describe('o painel não gasta cartão para dizer "nada aqui"', () => {
  it('os blocos vazios não são renderizados', () => {
    for (const guarda of [
      '!vazio.equipeHoje && <EquipeHoje',
      '!vazio.audienciasSemana && <AudienciasSemana',
      '!vazio.atividadesHoje && (',
      '!vazio.pendenciasAtivas && (',
      '!vazio.atendimentos && (',
      '!vazio.movimentacoes && <MovimentacoesRecentes',
      '!vazio.cargaEquipe && <CargaEquipe',
      '!vazio.contatos && <ContatosHoje',
    ]) {
      expect(CONTEUDO).toContain(guarda);
    }
  });

  /**
   * NÃO É ESCONDER — É PROPORÇÃO. "Agenda de hoje vazia" é a informação que o
   * advogado procura ao abrir; ela só não vale um cartão.
   */
  it('o que está limpo vira uma linha, e ela existe', () => {
    expect(CONTEUDO).toContain('const limpo: CoisaLimpa[] = [');
    expect(CONTEUDO).toContain('<OQueEstaLimpo itens={limpo} />');
  });

  /** Boa notícia depois do trabalho, nunca antes. */
  it('a linha do que está limpo fica por último', () => {
    expect(CONTEUDO.indexOf('<OQueEstaLimpo')).toBeGreaterThan(
      CONTEUDO.indexOf('<AcoesSemCadastro'),
    );
    expect(CONTEUDO.indexOf('<OQueEstaLimpo')).toBeGreaterThan(
      CONTEUDO.indexOf('<MovimentacoesRecentes'),
    );
  });

  it('e some inteira quando não há boa notícia', () => {
    expect(LIMPO).toContain('if (!itens.length) return null;');
  });

  /** Frases afirmativas: número zero não tranquiliza ninguém. */
  it('fala em frases, não em zeros', () => {
    expect(CONTEUDO).toContain("texto: 'Nada na agenda de hoje'");
    expect(CONTEUDO).not.toContain("texto: '0 ");
  });
});

/**
 * NÚMEROS SÃO ESTADO DO MUNDO; TRABALHO É O DIA DA PESSOA.
 *
 * A ordem anterior era números primeiro. "129 processos ativos" não é decisão
 * de ninguém; "30 ações do sindicato apareceram no Diário" é. Com os números na
 * frente, o que havia de real começava abaixo da primeira dobra.
 */
describe('a ordem das zonas do painel', () => {
  it('o que precisa de você vem antes dos números', () => {
    const acoes = CONTEUDO.indexOf('<AcoesSemCadastro');
    const publicacoes = CONTEUDO.indexOf('<PublicacoesDjen');
    const kpis = CONTEUDO.indexOf('{/* KPIs globais */}');
    expect(acoes).toBeGreaterThan(-1);
    expect(acoes).toBeLessThan(kpis);
    expect(publicacoes).toBeLessThan(kpis);
  });

  /**
   * A carteira pessoal continua ANTES de tudo: ela já é "o que precisa de
   * você", e é a única seção que fala do próprio usuário.
   */
  it('mas a carteira pessoal continua em primeiro', () => {
    expect(CONTEUDO.indexOf('minhaCarteira &&')).toBeLessThan(
      CONTEUDO.indexOf('<AcoesSemCadastro'),
    );
  });

  /**
   * Em dia tranquilo a zona inteira some (todo bloco dela se esconde sozinho) e
   * os números sobem para o topo naturalmente — que é onde devem estar quando
   * não há trabalho urgente.
   */
  it('a zona depende de blocos que se escondem sozinhos', () => {
    for (const bloco of ['SaudeDasIntegracoes', 'AvisoRobo', 'PublicacoesDjen']) {
      const i = PAGINA.indexOf(`function ${bloco}(`);
      expect(i).toBeGreaterThan(-1);
      expect(PAGINA.slice(i, i + 2500)).toContain('return null');
    }
  });
});

/**
 * "Atendimentos pendentes 0" ocupava o mesmo cartão, com o mesmo número de 30px
 * e o mesmo ícone colorido, que "Filiados ativos 7.279". Destaque igual para
 * tudo é destaque para nada — e o zero é, das duas, a que não pede nada.
 */
describe('o KPI zerado', () => {
  it('recua em vez de gritar', () => {
    expect(WIDGETS).toContain('const zerado = valor === 0;');
    expect(WIDGETS).toContain("zerado && 'border-dashed'");
    expect(WIDGETS).toContain("zerado ? 'bg-muted text-muted-foreground' : cor");
  });

  /** O cartão FICA: a grade não pode dançar conforme o dia. */
  it('mas continua ocupando o lugar dele', () => {
    expect(WIDGETS).not.toContain('if (zerado) return null');
  });
});

/**
 * MOBILE-FIRST NO QUE CUSTA ALTURA.
 *
 * Cabeçalho em quatro linhas e quatro pílulas quebrando em três: quase uma
 * dobra inteira do telefone antes do primeiro dado, e nada disso é decisão.
 */
describe('a altura gasta no celular', () => {
  it('a saudação encolhe e o selo do perfil some no telefone', () => {
    expect(PAGINA).toContain("'text-xl font-bold tracking-tight sm:text-2xl'".replace(/'/g, ''));
    expect(PAGINA).toContain('hidden rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline');
  });

  it('os atalhos ficam em uma linha que rola, e voltam a quebrar no desktop', () => {
    expect(ATALHOS).toContain('overflow-x-auto');
    expect(ATALHOS).toContain('sm:flex-wrap');
    expect(ATALHOS).toContain('sm:overflow-visible');
    // Sem `shrink-0` a pílula se espreme em vez de rolar.
    expect(ATALHOS).toContain('inline-flex shrink-0 items-center');
  });

  /** Some só a BARRA, nunca a rolagem — esconder a rolagem é que seria armadilha. */
  it('o utilitário da barra existe de verdade', () => {
    const CSS = readFileSync(join(__dirname, '../../globals.css'), 'utf8');
    expect(CSS).toContain('.scrollbar-none');
    expect(CSS).toContain('::-webkit-scrollbar');
  });
});

/**
 * NENHUMA MUDANÇA DE LAYOUT PODE ALARGAR PERMISSÃO.
 *
 * As guardas novas são todas `&&` sobre o cálculo de vazio — elas só podem
 * ESCONDER. Se alguma tivesse substituído um `pode.*`, um perfil passaria a ver
 * bloco de outro sem que nada na tela avisasse.
 */
describe('as guardas de vazio não mexem em permissão', () => {
  it('cada bloco guardado mantém o seu gate de módulo', () => {
    expect(CONTEUDO).toContain('pode.escalas && !vazio.equipeHoje');
    expect(CONTEUDO).toContain('pode.agenda && !vazio.audienciasSemana');
    expect(CONTEUDO).toContain('pode.agenda && !vazio.atividadesHoje');
    expect(CONTEUDO).toContain('pode.agenda && !vazio.pendenciasAtivas');
    expect(CONTEUDO).toContain('pode.atendimentos && !ehTriagem && !vazio.atendimentos');
  });

  /** O cálculo de vazio JÁ nasce recortado pela permissão: sem o módulo, não
      existe "vazio" a anunciar — anunciar seria contar que o módulo existe. */
  it('e o próprio cálculo de vazio respeita o módulo', () => {
    expect(CONTEUDO).toContain('audienciasSemana: pode.agenda &&');
    expect(CONTEUDO).toContain('movimentacoes: pode.processos &&');
    expect(CONTEUDO).toContain('equipeHoje: pode.escalas &&');
    expect(CONTEUDO).toContain('cargaEquipe: ehGestao &&');
  });
});
