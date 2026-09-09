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
      '!vazio.atendimentos && (',
      '!vazio.movimentacoes && <MovimentacoesRecentes',
      '!vazio.cargaEquipe && <CargaEquipe',
      /*
        "Pendências ativas" e "Contatos a fazer" SAÍRAM do painel — não é que
        deixaram de ter guarda de vazio, é que deixaram de existir.

        Pendência é atividade com o horário passado: as 8 medidas em 08/09/2026
        já estavam, todas, na lista de atividades. Contato é um dos dez tipos de
        atividade e ganhava cartão próprio sem critério, sem sequer um botão de
        resolver. Ver `atividades-do-dia.spec.ts`.
      */
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
    expect(CONTEUDO).toContain("texto: 'Nada atrasado'");
    expect(CONTEUDO).not.toContain("texto: '0 ");
  });

  /**
   * E A FRASE TEM DE DIZER O QUE A GUARDA MEDIU.
   *
   * `atividadesHoje` só colapsa quando hoje E os próximos 7 dias estão vazios —
   * o bloco mostra as duas listas. "Nada na agenda de hoje" afirmava menos do
   * que era verdade. E `pendenciasAtivas` é `inicio < agora`: são as VENCIDAS,
   * então "nenhuma pendência aberta" seria mentira com seis pendentes na semana.
   */
  it('a frase corresponde ao que a guarda mede', () => {
    expect(CONTEUDO).toContain('(data.proximasAtividades ?? []).length === 0');
    expect(CONTEUDO).toContain("texto: 'Nada na agenda desta semana'");
    expect(CONTEUDO).not.toContain("texto: 'Nenhuma pendência aberta'");
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


/**
 * AS TRÊS CÓPIAS DA MESMA ATRASADA — e por que só uma sobreviveu.
 *
 * Medido em 08/09/2026, painel do administrador: 8 atividades abertas com
 * horário passado. Elas apareciam:
 *
 *   1. na barra amarela  "8 atividades com horário vencido e ainda em aberto"
 *   2. na lista de atividades, marcadas de âmbar
 *   3. no cartão "Pendências ativas" do rodapé, listadas de novo
 *
 * Das 8, AS 8 estavam na lista de hoje — nenhuma vinha de dia anterior. A barra
 * era a pior das três porque dá o número sem dizer QUAIS: para agir era preciso
 * descer a página de qualquer jeito. Sobrou a lista, com o contador no próprio
 * cabeçalho dela.
 */
describe('o mesmo atraso não se repete no painel', () => {
  it('não existe mais barra amarela de atividades vencidas', () => {
    expect(CONTEUDO).not.toContain('atividades com horário vencido');
    expect(CONTEUDO).not.toContain('atividade com horário vencido');
  });

  it('não existe mais o bloco "Pendências ativas"', () => {
    expect(CONTEUDO).not.toContain('<PendenciasAtivas');
    expect(CONTEUDO).not.toContain('function PendenciasAtivas');
  });

  it('não existe mais o cartão "Contatos a fazer"', () => {
    expect(CONTEUDO).not.toContain('<ContatosHoje');
    expect(CONTEUDO).not.toContain('function ContatosHoje');
  });

  /**
   * A BARRA DE "PARADAS HÁ 7 DIAS" FICA — ela mede `updatedAt`, não `inicio`,
   * e não está em lista nenhuma do painel. Tirar as duas juntas seria perder
   * informação, não remover repetição.
   */
  it('a barra de atividades paradas continua', () => {
    expect(CONTEUDO).toContain('alertas.semMovimentacao > 0');
    expect(CONTEUDO).toContain('há mais de 7 dias.');
  });

  /**
   * "NADA ATRASADO" TEM DE OLHAR O CONTADOR, não a lista que agora só traz
   * dias anteriores — senão a tela anuncia dia limpo com 8 atrasadas de hoje
   * na página.
   */
  it('a frase "Nada atrasado" mede o contador, não a lista', () => {
    expect(CONTEUDO).toContain('atrasadas: pode.agenda && alertas.atrasadas === 0');
    expect(CONTEUDO).toContain("vazio.atrasadas && { texto: 'Nada atrasado'");
  });
});
