import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BLOCO = readFileSync(join(__dirname, 'atividades-do-dia.tsx'), 'utf8');
const PAINEL = readFileSync(
  join(__dirname, '../../app/(dashboard)/dashboard/page.tsx'),
  'utf8',
);
const AGENDA = readFileSync(
  join(__dirname, '../../app/(dashboard)/agenda/page.tsx'),
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
    expect(BLOCO).toContain('border-b bg-muted/30 px-3 py-2');
  });

  it('e o painel passou a usar o bloco novo', () => {
    expect(PAINEL).toContain('<AtividadesDoDia');
    expect(PAINEL).toContain('proximas={data.proximasAtividades ?? []}');
  });

  /**
   * UMA FILA, TRÊS FONTES — e a terceira entrou depois, por redundância medida.
   *
   * O painel mostrava as atrasadas em TRÊS lugares: barra amarela com o número,
   * esta lista marcando-as, e um cartão "Pendências ativas" no rodapé. Em
   * 08/09/2026, das 8 pendências, AS 8 já estavam na lista de hoje. Agora
   * `atrasadas` (dias anteriores) entra na mesma fila e a ordem cronológica
   * põe o atrasado no topo sozinho.
   */
  it('junta atrasadas, hoje e próximos dias numa lista só', () => {
    expect(BLOCO).toContain('[...atrasadas, ...hoje, ...proximas]');
    // Reordena: as três consultas são independentes e podem intercalar.
    expect(BLOCO).toContain("new Date(a.inicio).getTime() - new Date(b.inicio).getTime()");
  });

  /**
   * O QUE JÁ FECHOU NÃO DISPUTA VAGA COM O QUE FALTA FAZER.
   *
   * `atividadesHoje` traz o dia inteiro, QUALQUER status. Com ordenação só por
   * horário, as concluídas de hoje se intercalavam entre as pendentes — e no
   * corte de cinco da visão de equipe, DUAS das cinco linhas visíveis eram
   * trabalho já feito (medido contra a produção em 09/09/2026, antes de subir).
   */
  /**
   * A JANELA DE TROCA DO DEPLOY — web e API sobem em serviços separados.
   *
   * A API passou a mandar em `pendenciasAtivas` só o que venceu em dia
   * anterior; antes mandava tudo com `inicio < agora`. Enquanto a web nova
   * falar com a API antiga, a MESMA atividade chega nas duas listas.
   */
  it('deduplica por id, para a janela de troca do deploy', () => {
    expect(BLOCO).toContain('new Map(');
    expect(BLOCO).toContain('.map((c) => [c.id, c]),');
  });

  it('as abertas vêm antes das já fechadas', () => {
    expect(BLOCO).toContain('const porEstado = Number(!estaAberta(a)) - Number(!estaAberta(b));');
    expect(BLOCO).toContain('if (porEstado !== 0) return porEstado;');
  });

  /** As duas chamadas do painel passam a lista de atrasadas. */
  it('o painel alimenta a fila com as atrasadas de dias anteriores', () => {
    expect(PAINEL.match(/atrasadas=\{data\.pendenciasAtivas \?\? \[\]\}/g) ?? []).toHaveLength(2);
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
    expect(BLOCO).toContain('concluirCompromisso(id, { desfecho');
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
    expect(BLOCO).toContain('flex flex-col gap-2 px-3 py-2.5 transition sm:flex-row sm:flex-wrap sm:items-center');
  });

  /** Hover não existe no telefone: esconder ação atrás dele é escondê-la. */
  it('nenhuma ação depende de hover', () => {
    expect(BLOCO).not.toContain('group-hover:opacity');
    expect(BLOCO).not.toContain('opacity-0');
  });

  /**
   * O AVISO NÃO PODE SUMIR NA TELA PEQUENA — foi o que eu fiz na primeira
   * versão (`hidden sm:inline` no contador de "passou da hora"), deixando o
   * cabeçalho do celular sem sinal nenhum de urgência.
   */
  it('os contadores do cabeçalho sobrevivem ao telefone', () => {
    const cabecalho = BLOCO.slice(BLOCO.indexOf('<h2 className='), BLOCO.indexOf('Abrir agenda'));
    expect(cabecalho).toContain('flex-wrap');
    /*
      A NEGATIVA MIRA A CLASSE, NÃO A PALAVRA. Escrita como
      `not.toContain('hidden')` ela reprovava o arquivo CORRIGIDO, porque o
      comentário que explica a remoção cita `hidden sm:inline`. É a quarta vez
      que esta base cai nisso — negativa em português bate no comentário.
    */
    expect(cabecalho).not.toContain('className="hidden');
    expect(cabecalho).not.toContain(' hidden shrink-0 rounded-full');
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
  it('a linha vencida se distingue, e ganha etiqueta', () => {
    expect(BLOCO).toContain("const atrasada = estado === 'ATRASADA';");
    expect(BLOCO).toContain('bg-amber-50/60');
    expect(BLOCO).toContain('Atrasada');
  });

  /**
   * DOIS ESTADOS, DOIS TONS — e antes eram um só, somando coisas diferentes.
   *
   * O robô agenda "Cadastrar ação do Diário" para as 15:00 do PRÓPRIO dia: às
   * 15:01 elas viravam etiqueta âmbar de "Atrasada". Eram 7 das 8 medidas.
   * Agora a etiqueta é só do que ficou para trás; o que passou da hora leva a
   * hora em âmbar, sem fundo na linha.
   */
  it('"passou da hora" é marca discreta, não etiqueta', () => {
    expect(BLOCO).toContain("const passouDaHora = estado === 'PASSOU_DA_HORA';");
    expect(BLOCO).toContain("passouDaHora && 'font-semibold text-amber-700");
    // O fundo da linha continua reservado ao atraso de verdade.
    expect(BLOCO).toContain("atrasada ? 'bg-amber-50/60");
  });

  /**
   * ÂMBAR, NÃO VERMELHO — decisão de 2026-09-08 que sobreviveu a uma tentativa
   * minha de trocar por rose no redesenho.
   *
   * O sistema não calcula vencimento processual: sabe só que o horário passou.
   * Das 8 atrasadas da produção, 7 eram "Cadastrar ação do Diário" marcadas
   * para as 15h do MESMO dia. Vermelho afirmaria perda de prazo que não houve.
   */
  it('em âmbar, não em vermelho', () => {
    const linha = BLOCO.slice(BLOCO.indexOf('const atrasada ='), BLOCO.indexOf('</li>'));
    expect(linha).not.toContain('bg-red-');
    expect(linha).not.toContain('text-red-');
    expect(linha).not.toContain('bg-rose-');
    expect(linha).not.toContain('text-rose-');
  });

  /** O número saiu da barra amarela e veio para o cabeçalho da fila. */
  it('o contador de atrasadas fica no cabeçalho, não numa barra separada', () => {
    expect(BLOCO).toContain("contar(totalAtrasadas, 'atrasada', 'atrasadas')");
    expect(PAINEL).not.toContain('atividades com horário vencido');
  });

  /**
   * O CONTADOR VEM DA API, NÃO DO TAMANHO DA LISTA.
   *
   * As três consultas têm `take:` (8, 12, 8). Contar as linhas recebidas diria
   * "3 atrasadas" quando existem 14 — mentindo para menos justamente no número
   * que não pode errar.
   */
  it('o número de atrasadas vem do count da API', () => {
    expect(BLOCO).toContain('totalAtrasadas: number;');
    expect(PAINEL).toContain('totalAtrasadas={alertas.atrasadas}');
    expect(PAINEL).toContain('totalPassaramDaHora={alertas.passaramDaHora ?? 0}');
  });
});

/**
 * DE QUEM É O ATRASO — a pergunta de quem coordena.
 *
 * Quem coordena não cumpre o prazo de ninguém: com "8 atrasadas" ele COBRA, e
 * para cobrar precisa de um nome. A lista trazia isso num avatar de 24px por
 * linha — obriga a ler linha por linha, somar de cabeça, e só nas cinco
 * visíveis. Medido em 09/09/2026: Morgana 4, Carlos 3, Ícaro 1.
 */
describe('a tira "Esperando por"', () => {
  it('conta a fila inteira, não só o que está visível', () => {
    expect(BLOCO).toContain('const porPessoa = pessoal');
    expect(BLOCO).toContain('.reduce((acc, c) => {');
    expect(BLOCO).not.toContain('atencaoVisivel.reduce(');
  });

  it('ordena por quem tem mais', () => {
    expect(BLOCO).toContain('.sort((a, b) => b.quantas - a.quantas)');
  });

  /** Na carteira própria seria o mesmo rosto uma vez só. */
  it('não aparece na carteira pessoal nem com uma pessoa só', () => {
    expect(BLOCO).toContain('{porPessoa.length > 1 && (');
  });

  it('cada nome leva à agenda já filtrada nele', () => {
    expect(BLOCO).toContain('href={`/agenda?responsavel=${pessoa.id}`}');
    expect(AGENDA).toContain("'responsavel',");
    expect(AGENDA).toContain("setResponsaveis([v]); setAba('aberto');");
  });
});

/**
 * O QUE A LINHA VOLTOU A DIZER.
 *
 * A crítica foi "a UI ficou muito feia", e o diagnóstico foi mais fundo que
 * estética: ao achatar o bloco antigo eu apaguei tudo que distinguia uma
 * atividade da outra. Duas linhas com o mesmo título e horários próximos
 * ficavam idênticas na tela.
 */
describe('a linha informa de novo', () => {
  it('mostra tipo, com a cor da Agenda', () => {
    expect(BLOCO).toContain('corDeTipo(c.tipo, tipos).ponto');
    expect(BLOCO).toContain('rotuloTipo(c.tipo, tipos)');
  });

  it('mostra contra quem é o processo — é o que separa dois títulos iguais', () => {
    expect(BLOCO).toContain('parteContrariaDoProcesso(c.processo)');
  });

  it('mostra o rosto de quem responde, só na visão de equipe', () => {
    expect(BLOCO).toContain('{!pessoal && c.responsavel && <AvatarMini pessoa={c.responsavel}');
  });

  it('mostra o selo de urgência da Agenda, não uma tarja própria', () => {
    expect(BLOCO).toContain('<SeloUrgente motivo={c.urgenteMotivo}');
  });

  /**
   * O BOTÃO NÃO PODE SER O ASSUNTO. Cinco botões sólidos empilhados pesavam
   * mais que os títulos; em tom claro ele continua achável e para de competir.
   */
  it('o botão de um toque é tom claro, não bloco sólido', () => {
    expect(BLOCO).toContain('border border-brand-200 bg-brand-50');
    expect(BLOCO).toContain('text-brand-900');
    // O sólido só no hover, nunca em repouso.
    expect(BLOCO).toContain('hover:bg-brand-800 hover:text-white');
    expect(BLOCO).not.toContain('rounded-md bg-brand-800 px-2.5');
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

/**
 * OS 1.230px DE AGENDA ALHEIA.
 *
 * No escopo GLOBAL a API manda a agenda de todo mundo. Medido pelo leitor do
 * workflow: administrador com 8 de hoje + 6 dos próximos = 14 linhas, ≈1.230px
 * — o bloco mais alto do painel inteiro, com o trabalho de outras pessoas.
 */
describe('a agenda da equipe tem teto', () => {
  it('corta em cinco na visão de equipe', () => {
    expect(BLOCO).toContain('const TETO_EQUIPE = 5;');
    expect(BLOCO).toContain('Math.max(0, TETO_EQUIPE - atencaoVisivel.length)');
  });

  /** Na carteira própria não há corte: é exatamente o que a pessoa veio ver. */
  it('mas a carteira pessoal mostra tudo', () => {
    expect(BLOCO).toContain('const vagasRestantes = pessoal');
    expect(BLOCO).toContain('? emDia.length');
  });

  /**
   * O CORTE NUNCA PODE ESCONDER O QUE PRECISA DE GENTE — e escondia.
   *
   * Medido em 09/09/2026 no painel do administrador: 8 atrasadas, teto de 5,
   * rodapé dizendo "Mais 14 da equipe na agenda". TRÊS atrasadas invisíveis, e
   * nada na tela avisando que o que sumiu era o que estava vencido.
   */
  it('o teto vale só para o que está EM DIA', () => {
    expect(BLOCO).toContain('const precisamDeGente = todas.filter(pedeAtencao);');
    expect(BLOCO).toContain('const emDia = todas.filter((c) => !pedeAtencao(c));');
    expect(BLOCO).toContain('const visiveis = [...atencaoVisivel, ...emDia.slice(0, vagasRestantes)];');
  });

  /** Teto duro de segurança: 40 atrasadas não podem virar 40 linhas. */
  it('há um teto duro para o que pede atenção, e ele é nomeado', () => {
    expect(BLOCO).toContain('const TETO_ATENCAO = 12;');
    expect(BLOCO).toContain('const atencaoOculta = precisamDeGente.length - atencaoVisivel.length;');
  });

  /** Esconder sem contar seria mentir sobre o tamanho da fila. */
  it('e diz quantas ficaram de fora, dizendo se estavam atrasadas', () => {
    expect(BLOCO).toContain('const ocultas = todas.length - visiveis.length;');
    expect(BLOCO).toContain("contar(atencaoOculta, 'delas atrasada', 'delas atrasadas')");
  });
});

/**
 * A CAIXA DE PROPOSTAS ERA INVISÍVEL PARA QUEM COORDENA.
 *
 * O painel pedia sempre a caixa pessoal. Administrador e coordenação não têm
 * OAB, então nenhuma proposta é endereçada a eles: os três admins e a
 * coordenação abriam o painel e a caixa não existia — inclusive para a proposta
 * ÓRFÃ, que foi a razão de o parâmetro `todas` ter sido escrito.
 */
describe('a caixa de quem coordena', () => {
  const CAIXA = readFileSync(join(__dirname, 'caixa-de-propostas.tsx'), 'utf8');

  it('gestão pede o escopo ampliado', () => {
    expect(CAIXA).toContain('listarPropostas(ehGestao)');
  });

  /** Chave distinta por escopo: senão o cache de um vaza para o outro. */
  it('e o cache separa os dois escopos', () => {
    expect(CAIXA).toContain("ehGestao ? 'com-orfas' : 'minhas'");
  });
});

/**
 * "09:00" NUMA LINHA DE AMANHÃ SE LÊ COMO ATRASO DE HOJE.
 *
 * A lista junta hoje e os próximos sete dias numa leitura cronológica só. O
 * bloco antigo separava em duas e ligava a data apenas na de baixo; ao achatar
 * a lista eu mostrei só a hora, e as atividades de amanhã passaram a parecer de
 * hoje. Foi um teste ANTIGO, do bloco removido, que apontou isso ao cair.
 */
describe('a data na linha', () => {
  it('hoje mostra só a hora; o resto ganha o dia', () => {
    expect(BLOCO).toContain('ehDeHoje(c.inicio) ? formatHora(c.inicio) : etiquetaDeDia(c.inicio)');
  });

  it('amanhã ganha a palavra, o resto ganha o dia da semana', () => {
    expect(BLOCO).toContain('if (dias === 1) return `amanhã ${hora}`;');
    expect(BLOCO).toContain("toLocaleDateString('pt-BR', { weekday: 'short' })");
  });

  /**
   * Fuso de Teresina: `new Date()` cru no contêiner UTC vira o dia às 21h e
   * mostraria "amanhã" a noite inteira. É o mesmo erro que já custou o robô de
   * cobranças marcar parcela vencida às 21:00 do dia dela.
   */
  it('compara dia de calendário brasileiro, não instante', () => {
    expect(BLOCO).toContain('new Date(iso).getTime() - 3 * 3_600_000');
  });
});
