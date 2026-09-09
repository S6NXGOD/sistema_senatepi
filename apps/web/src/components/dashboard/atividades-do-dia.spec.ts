import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BLOCO = readFileSync(join(__dirname, 'atividades-do-dia.tsx'), 'utf8');
const PAINEL = readFileSync(
  join(__dirname, '../../app/(dashboard)/dashboard/page.tsx'),
  'utf8',
);

/**
 * "ESSA PARTE DE ATIVIDADES OCUPA MUITO ESPAÇO" — a queixa literal do usuário.
 *
 * Era um `SectionCard` (ícone de 20px, título, contador em pílula, barra de
 * ação — 56px só de cabeçalho) embrulhando DUAS listas empilhadas, cada uma com
 * o próprio subtítulo. Três molduras para mostrar quatro linhas em média.
 */
describe('o bloco de atividades encolheu', () => {
  it('não usa mais SectionCard nem subtítulos por lista', () => {
    expect(BLOCO).not.toContain('<SectionCard');
    expect(BLOCO).not.toContain('BlocoDeDia');
    // Cabeçalho de uma linha: py-2, não a barra de 56px do SectionCard.
    expect(BLOCO).toContain('border-b px-3 py-2');
  });

  it('e o painel passou a usar o bloco novo', () => {
    expect(PAINEL).toContain('<AtividadesDoDia');
    expect(PAINEL).toContain('proximas={data.proximasAtividades ?? []}');
  });

  /** Hoje e próximos dias na MESMA lista — a separação custava uma moldura. */
  it('junta hoje e próximos dias numa lista só', () => {
    expect(BLOCO).toContain('const todas = [...hoje, ...proximas];');
  });
});

/**
 * RESOLUÇÃO RÁPIDA — o pedido explícito.
 *
 * O botão de um toque saiu de MEDIÇÃO: nas 41 conclusões da produção, dois
 * desfechos respondem por 60% de tudo, e em PRAZO foram 11 de 11.
 */
describe('resolver sem sair do painel', () => {
  it('cada tipo tem o desfecho que a equipe realmente usa', () => {
    expect(BLOCO).toContain("PRAZO: { slug: 'PRAZO_CUMPRIDO'");
    expect(BLOCO).toContain("CONSULTA_JURIDICA: { slug: 'DUVIDA_ESCLARECIDA'");
  });

  /** `desfecho` é o único campo obrigatório — conferido no DTO da API. */
  it('conclui com um toque, sem modal', () => {
    expect(BLOCO).toContain('concluirCompromisso(id, { desfecho })');
  });

  /** Iniciar é a única transição que não pede dado nenhum. */
  it('iniciar também é inline', () => {
    expect(BLOCO).toContain("mudarStatusCompromisso(id, 'EM_ANDAMENTO')");
  });

  /**
   * O QUE NÃO PODE SER UM TOQUE. Audiência e perícia têm desfechos que mudam o
   * rumo do caso ("houve acordo?", "laudo entregue?") — fechar isso por
   * adivinhação é pior que um clique a mais, porque o desfecho alimenta o
   * relatório e o seguimento.
   */
  it('audiência e perícia NÃO ganham botão de um toque', () => {
    const tabela = BLOCO.slice(
      BLOCO.indexOf('const DESFECHO_RAPIDO'),
      BLOCO.indexOf('export function AtividadesDoDia'),
    );
    expect(tabela).not.toContain('AUDIENCIA:');
    expect(tabela).not.toContain('PERICIA:');
  });
});

/**
 * MOBILE-FIRST. Sete das oito atividades vencidas da produção estão num
 * telefone antes de estarem num monitor.
 */
describe('o bloco no celular', () => {
  it('a linha quebra no telefone e alinha no desktop', () => {
    expect(BLOCO).toContain('flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center');
  });

  /** Hover não existe no telefone: esconder ação atrás dele é escondê-la. */
  it('nenhuma ação depende de hover', () => {
    expect(BLOCO).not.toContain('group-hover:opacity');
    expect(BLOCO).not.toContain('opacity-0');
  });

  /** O rótulo longo do desfecho não cabe em 375px — vira "Concluir". */
  it('o rótulo do botão encolhe no telefone', () => {
    expect(BLOCO).toContain('hidden sm:inline');
    expect(BLOCO).toContain('sm:hidden');
  });

  /**
   * Navegação por `Link`, não por `router.push`: preserva clique do meio,
   * "abrir em nova aba" e o pré-carregamento do Next.
   */
  it('navega por Link', () => {
    expect(BLOCO).toContain('href={href(c.id)}');
    /*
      A negativa mira CÓDIGO, não prosa: a primeira versão batia no comentário
      que explica por que `router.push` foi descartado, e reprovava o arquivo
      corrigido. É o mesmo erro que já custou quatro correções nesta base.
    */
    expect(BLOCO).not.toContain('router.push(');
    expect(BLOCO).not.toContain('window.location.href =');
  });
});

/** O horário vencido precisa saltar — 8 das 15 abertas já venceram. */
describe('o que já venceu', () => {
  it('a linha vencida se distingue', () => {
    expect(BLOCO).toContain('venceu && ');
    expect(BLOCO).toContain('bg-amber-50/50');
  });

  /** Âmbar, não vermelho: o sistema não calcula vencimento processual. */
  it('em âmbar, não em vermelho', () => {
    const linha = BLOCO.slice(BLOCO.indexOf('const venceu'), BLOCO.indexOf('</li>'));
    expect(linha).not.toContain('bg-red-');
    expect(linha).not.toContain('text-red-');
  });
});

/**
 * A ORDEM MUDA POR PERFIL — e é o maior ganho, maior que o corte de blocos.
 *
 * O advogado abre o painel para saber o que ELE tem de fazer hoje. Isso estava
 * depois da carteira, da zona do Diário E da grade de números: no telefone,
 * meia dúzia de rolagens antes do primeiro prazo.
 *
 * Para quem coordena a ordem é outra — a agenda da equipe é contexto, e o que
 * precisa de decisão vem primeiro.
 */
describe('a posição do bloco muda com o escopo', () => {
  it('na carteira pessoal, atividades vêm antes da zona de trabalho', () => {
    const pessoal = PAINEL.indexOf('{escopoPessoal && pode.agenda && !vazio.atividadesHoje && (');
    const zona1 = PAINEL.indexOf('ZONA 1 — O QUE PRECISA DE VOCÊ');
    expect(pessoal).toBeGreaterThan(-1);
    expect(pessoal).toBeLessThan(zona1);
  });

  it('e na visão de equipe fica na grade, como contexto', () => {
    expect(PAINEL).toContain('{!escopoPessoal && pode.agenda && !vazio.atividadesHoje && (');
  });

  /** Nunca nos dois lugares ao mesmo tempo. */
  it('as duas posições são mutuamente exclusivas', () => {
    expect(PAINEL).toContain('{escopoPessoal && pode.agenda');
    expect(PAINEL).toContain('{!escopoPessoal && pode.agenda');
  });
});

/**
 * O CORTE POR PERFIL NÃO PODE ALARGAR PERMISSÃO — só esconder.
 *
 * Gráfico é instrumento de gestão; aniversariante é trabalho de quem atende.
 * Nenhum dos dois é o dia do advogado. Mas a guarda é sempre `&&` sobre o gate
 * de módulo que já existia: se alguém trocasse `pode.filiados` por `ehGestao`,
 * um perfil passaria a ver o que não podia.
 */
describe('o que saiu do painel do advogado', () => {
  it('gráficos ficam com quem coordena', () => {
    expect(PAINEL).toContain('{ehGestao && (');
    const trecho = PAINEL.slice(PAINEL.indexOf('GRÁFICO É INSTRUMENTO DE GESTÃO'));
    expect(trecho.slice(0, 900)).toContain('<GraficoTendencia');
  });

  it('aniversariantes idem, e o gate de módulo continua', () => {
    expect(PAINEL).toContain('{!ehTriagem && ehGestao && pode.filiados && (');
  });

  /** A Triagem vê aniversariantes lá em cima — `!ehTriagem` é não repetir. */
  it('a Triagem continua vendo os aniversariantes dela', () => {
    const topo = PAINEL.slice(0, PAINEL.indexOf('ZONA 1 — O QUE PRECISA DE VOCÊ') + 8000);
    expect(topo).toContain('<Aniversariantes');
  });
});

/**
 * A DOBRA DO TELEFONE — 600px, e o que cabe nela.
 *
 * Medido por leitura do CSS: `SectionCard` custa 73px de moldura antes de
 * qualquer conteúdo, `KpiCard` 100px, `EmptyState` 124px. A "Minha carteira"
 * com seis KPIs em `grid-cols-2` dava três fileiras = 364px, e vinha ANTES das
 * atividades: o advogado rolava 446px para ver o primeiro prazo.
 */
describe('o que o advogado vê sem rolar', () => {
  it('as atividades vêm antes até da carteira', () => {
    const atividades = PAINEL.indexOf('{escopoPessoal && pode.agenda && !vazio.atividadesHoje && (');
    const carteira = PAINEL.indexOf('{minhaCarteira && (');
    expect(atividades).toBeGreaterThan(-1);
    expect(atividades).toBeLessThan(carteira);
  });

  /** Seis KPIs em duas fileiras, não três: 364px viram ~216px. */
  it('a carteira cabe em duas fileiras no telefone', () => {
    expect(PAINEL).toContain('grid grid-cols-3 gap-2 sm:gap-4 lg:grid-cols-6');
    expect(PAINEL).not.toContain('grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6');
  });
});

/**
 * A CAIXA DE PROPOSTAS COM QUATRO ITENS DAVA 898px — mais que a dobra inteira.
 * Cada proposta custava 192px: NPU numa linha só para si, prévia em três linhas.
 */
describe('a proposta encolheu', () => {
  const CAIXA = readFileSync(join(__dirname, 'caixa-de-propostas.tsx'), 'utf8');

  it('o NPU divide a linha com o adversário', () => {
    expect(CAIXA).toContain('flex min-w-0 items-baseline gap-1.5 text-sm');
  });

  it('e a prévia para em duas linhas', () => {
    expect(CAIXA).toContain('line-clamp-2');
  });

  /** O nome do adversário é o que decide — ele trunca por último. */
  it('o número trunca antes do nome', () => {
    const linha = CAIXA.slice(CAIXA.indexOf('items-baseline'), CAIXA.indexOf('line-clamp-2'));
    expect(linha).toContain('min-w-0 flex-1 truncate');
    expect(linha).toContain('.slice(0, 11)');
  });
});
