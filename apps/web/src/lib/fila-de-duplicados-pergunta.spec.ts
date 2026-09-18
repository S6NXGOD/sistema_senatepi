import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const RAIZ = path.resolve(__dirname, '..');
const PAGINA = readFileSync(
  path.join(RAIZ, 'app/(dashboard)/filiados/duplicados/page.tsx'), 'utf8',
);

/**
 * "ESSE 'NÃO É A MESMA PESSOA' ESTÁ PRATICAMENTE INVISÍVEL E AO CLICAR VAI
 * DIRETAMENTE EXECUTANDO A AÇÃO." — 18/09/2026.
 *
 * As duas metades do relato eram verdade, e a segunda valia para as DUAS saídas
 * da fila: "não é duplicado" e "não é a mesma pessoa" gravavam no primeiro
 * toque, e a tecla N também. Num trabalho de dezenas de grupos seguidos, um
 * clique de raspão tira da fila um par que ninguém olhou — e o que sai da fila
 * não volta a aparecer sozinho (foi assim que MARIA DA CRUZ DE SOUSA sumiu).
 *
 * O conserto tem de servir a duas coisas que puxam para lados opostos: não
 * executar sem perguntar, e não transformar uma fila repetitiva num desfile de
 * diálogos. Por isso a pergunta é rápida — Enter confirma, Esc desiste — e o
 * texto dela diz QUEM sai, não "tem certeza?".
 */
describe('nada sai da fila sem perguntar', () => {
  it('as duas saídas abrem a pergunta em vez de gravar', () => {
    // Nenhum dos dois botões chama o gravador direto.
    expect(PAGINA).toContain("onNaoDuplicado={() => setSeparar({ tipo: 'grupo'");
    expect(PAGINA).toContain("onForaDoGrupo={(c) => setSeparar({ tipo: 'um'");
    expect(PAGINA).not.toMatch(/onNaoDuplicado=\{\(\) => naoDuplicado\(/);
    expect(PAGINA).not.toMatch(/onForaDoGrupo=\{\(c\) => foraDoGrupo\(/);
  });

  /** A tecla é um atalho para o botão, não uma porta lateral sem pergunta. */
  it('a tecla N também pergunta', () => {
    const atalhos = PAGINA.slice(PAGINA.indexOf('function aoTeclar('), PAGINA.indexOf('window.addEventListener'));
    expect(atalhos).toContain("setSeparar({ tipo: 'grupo', grupo: g })");
    expect(atalhos).not.toContain('void naoDuplicado(g)');
  });

  /**
   * COM A PERGUNTA NA TELA, O TECLADO É DELA. O diálogo para Enter e Esc na
   * captura, mas as setas chegavam à página: trocar o grupo ATRÁS do diálogo
   * faria a confirmação valer para outro par.
   */
  it('o teclado da página cala enquanto há diálogo aberto', () => {
    const atalhos = PAGINA.slice(PAGINA.indexOf('function aoTeclar('), PAGINA.indexOf('window.addEventListener'));
    expect(atalhos).toContain('if (fundindo || separar) return;');
  });

  /** Fechar em cima de um erro faria a falha parecer sucesso. */
  it('a pergunta só fecha quando a gravação deu certo', () => {
    const fn = PAGINA.slice(PAGINA.indexOf('async function confirmarSeparacao'));
    expect(fn.slice(0, 700)).toContain('if (ok) { setSeparar(null);');
  });

  /**
   * ENTER SÓ NO QUE TEM VOLTA. Separar volta pelo Desfazer e pela lista do fim
   * da página; consolidar APAGA cadastro. E no modo foco o Enter já abre a
   * consolidação — se o diálogo dela também confirmasse com Enter, duas teclas
   * seguidas apagariam um cadastro.
   */
  it('o Enter confirma a separação e NÃO a consolidação', () => {
    const separar = PAGINA.slice(PAGINA.indexOf('open={!!separar}'), PAGINA.indexOf('open={!!fundindo}'));
    expect(separar).toContain('confirmarComEnter');
    const fundir = PAGINA.slice(PAGINA.indexOf('open={!!fundindo}'));
    expect(fundir.slice(0, 900)).not.toContain('confirmarComEnter');
    expect(fundir.slice(0, 900)).toContain('variant="destructive"');
  });

  /** Separar não apaga nada: a pergunta é âmbar, não vermelha. */
  it('a pergunta da separação não se veste de exclusão', () => {
    const separar = PAGINA.slice(PAGINA.indexOf('open={!!separar}'), PAGINA.indexOf('open={!!fundindo}'));
    expect(separar).not.toContain('variant="destructive"');
  });
});

/**
 * A PRIMEIRA TENTATIVA FOI COSMÉTICA. Trocar texto cinza por borda tracejada
 * não resolveu — ver "o controle de tirar do grupo, segunda tentativa", abaixo,
 * que é o teste que ficou.
 */

/**
 * TRÊS CABEM NUMA LINHA. Com duas colunas fixas, o grupo de três desenhava dois
 * cartões em cima, um embaixo e meia tela vazia — e o trabalho aqui é comparar
 * lado a lado.
 */
describe('a grade acompanha o tamanho do grupo', () => {
  it('três ou mais ganham a terceira coluna no desktop', () => {
    expect(PAGINA).toContain("grupo.candidatos.length >= 3 && 'lg:grid-cols-3'");
  });

  it('e no celular continua um embaixo do outro', () => {
    expect(PAGINA).toContain("'grid gap-3 md:grid-cols-2'");
  });
});

/**
 * "AINDA ACHO MUITO IGUAL A ANTES E EXTREMAMENTE CHATO." — 18/09/2026.
 *
 * Estava certo, e o meu conserto anterior (borda tracejada no botão) era
 * cosmético. O tédio desta fila é aritmético, e os números da produção dizem
 * onde ele mora:
 *
 *   · 1.174 grupos — 947 de dois cadastros, 197 de três;
 *   · 3.259 dos 7.033 filiados (46%) não têm NENHUM dos sete campos comparados,
 *     e 2.208 têm um só;
 *   · a tela desenhava 20.920 células e só 6.557 tinham conteúdo: 69% de traço;
 *   · em 533 grupos existe UM campo preenchido no grupo inteiro; em 143, nenhum.
 *
 * Ou seja: o olho varria oito linhas por cartão para achar uma. Não é a cor do
 * botão — é a quantidade de nada que a tela mandava ler.
 */
describe('a tela mostra o que existe, e não o que falta', () => {
  it('as linhas do cartão saem dos campos que ALGUÉM preencheu', () => {
    expect(PAGINA).toContain('CAMPOS_COMPARADOS.filter(({ chave }) =>');
    expect(PAGINA).toContain('grupo.candidatos.some((c) => temValor(');
    /*
      A NEGATIVA É DENTRO DO CARTÃO, e não no arquivo inteiro: `ResumoFusao`
      percorre `CAMPOS_COMPARADOS` de propósito, para listar o que vai ser
      copiado na consolidação. Proibir no arquivo reprovaria o uso certo — é a
      armadilha que esta base já pagou com negativa em prosa.
    */
    const cartao = PAGINA.slice(PAGINA.indexOf('function CandidatoCard'));
    expect(cartao).toContain('campos.map(({ chave, rotulo })');
    expect(cartao.slice(0, cartao.indexOf('function ResumoSeparacao')))
      .not.toContain('CAMPOS_COMPARADOS.map');
  });

  it('"Locais de trabalho" só aparece quando alguém tem algum', () => {
    expect(PAGINA).toContain('grupo.candidatos.some((c) => c.vinculos > 0)');
    expect(PAGINA).toContain('{mostrarVinculos && (');
  });

  /** Cartão sem nenhum campo não pode virar um retângulo mudo. */
  it('quando não sobra campo nenhum, a tela diz isso com palavra', () => {
    expect(PAGINA).toContain('Nenhum outro dado cadastrado.');
  });
});

/**
 * A DICA DE QUAL MANTER — "com dica para deixar o que está mais rico de dados".
 */
describe('qual cadastro é o mais completo', () => {
  it('cada cartão diz quantos dados carrega', () => {
    expect(PAGINA).toContain('frasesDaRiqueza(dados)');
    expect(PAGINA).toContain('quantosDados(c as unknown as Record<string, unknown>)');
  });

  /** Com empate não existe "o mais completo": fingir que existe é sortear. */
  it('a etiqueta só sai quando há um líder único e ele tem algo', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('const idMaisRico'));
    expect(bloco.slice(0, 600)).toContain('maior > 0 && lideres.length === 1');
  });
});

/**
 * O CONTROLE, DA TERCEIRA VEZ — agora era HIERARQUIA, não contraste.
 *
 * "Tô achando o botão grande e o card pequeno, não me parece ter harmonia": um
 * Button de largura cheia pendurado sob um cartão de três linhas, três vezes no
 * mesmo grupo. A ação pertence ao cartão, então virou o RODAPÉ dele — a borda
 * foi para o invólucro e os dois viraram um objeto só.
 */
describe('o controle de tirar do grupo, terceira tentativa', () => {
  const BLOCO = PAGINA.slice(
    PAGINA.indexOf('A SAÍDA DE UM SÓ MORA DENTRO DO CARTÃO'),
    PAGINA.indexOf('function CandidatoCard'),
  );

  /** Âncora invertida vira string vazia, e string vazia passa em `not.toContain`. */
  it('a fatia examinada não está vazia', () => {
    expect(BLOCO.length).toBeGreaterThan(500);
    expect(BLOCO).toContain('Tirar do grupo');
  });

  it('o cartão e a ação ficam num invólucro só, e a borda é dele', () => {
    expect(BLOCO).toContain('flex flex-col overflow-hidden rounded-xl border');
    expect(BLOCO).toContain('border-t'); // o fio que separa cartão e rodapé
  });

  /** O cartão não pode mais desenhar a própria borda, senão ficam duas. */
  it('o cartão perde a borda própria', () => {
    const cartao = PAGINA.slice(PAGINA.indexOf('function CandidatoCard'));
    expect(cartao.slice(0, 900)).not.toContain("'rounded-xl border p-3 text-left transition'");
    expect(cartao.slice(0, 900)).toContain("'flex-1 p-3 text-left transition'");
  });

  /** Alvo de dedo no celular; no desktop o ponteiro não precisa de 44 px. */
  it('continua alvo de dedo no celular e encolhe no desktop', () => {
    expect(BLOCO).toContain('min-h-11');
    expect(BLOCO).toContain('md:h-9');
  });

  it('e o rosa continua só no hover', () => {
    expect(BLOCO).toContain('hover:bg-rose-50');
    expect(BLOCO).not.toContain('bg-rose-50 text-rose');
  });
});

/**
 * A EXPLICAÇÃO QUE FALTAVA. Três botões com verbos parecidos e nenhum lugar
 * dizendo o que cada um faz com o cadastro — a dúvida mais cara é a que ninguém
 * faz em voz alta: "isto apaga o dado da pessoa?".
 */
describe('como funciona esta fila', () => {
  it('explica as três decisões, cada uma com o efeito no cadastro', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function ComoFunciona'));
    for (const acao of ['Consolidar', 'Não é duplicado', 'Tirar do grupo']) {
      expect(bloco).toContain(acao);
    }
    expect(bloco).toContain('nada é apagado');
  });

  /**
   * "NENHUM DADO SE PERDE" ERA FALSO E ESTAVA AQUI COMO EXIGÊNCIA (18/09/2026).
   *
   * Campo preenchido diferente nos dois lados: vale o do mantido e o outro ia
   * embora com o registro. O texto prometia o contrário, e o teste cobrava a
   * promessa — um teste pode fixar uma mentira tão bem quanto uma verdade.
   */
  it('não promete que nada se perde: diz o que acontece com o valor divergente', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function ComoFunciona'));
    expect(bloco).not.toContain('Nenhum dado se perde');
    expect(bloco).toContain('vale o do');
    expect(bloco).toContain('histórico');
  });

  /** A filiação é a exceção da fusão, e a tela tem de dizer qual é. */
  it('avisa que a filiação mais antiga prevalece', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function ComoFunciona'));
    expect(bloco).toContain('mais antiga');
    expect(bloco).toContain('Tempo de sindicato');
  });

  it('e responde "na dúvida, qual manter?"', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function ComoFunciona'));
    expect(bloco).toContain('Na dúvida, qual manter?');
    expect(bloco).toContain('mais dados');
    expect(bloco).toContain('CPF em um só');
  });

  /** Recolhido por padrão: quem já sabe não passa por cima disso todo dia. */
  it('nasce fechado e tem alvo de dedo', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function ComoFunciona'));
    expect(bloco.slice(0, 400)).toContain('useState(false)');
    expect(bloco).toContain('min-h-11');
    expect(bloco).toContain('aria-expanded={aberto}');
  });
});

/**
 * O PLACAR — a resposta honesta a "deixa menos tedioso". Não é medalha nem
 * ponto: é mostrar que a pilha diminui.
 */
describe('o placar da fila', () => {
  it('conta o que foi resolvido nesta sessão, nas três decisões', () => {
    expect((PAGINA.match(/setResolvidos\(\(n\) => n \+ 1\)/g) ?? []).length).toBe(2);
    expect(PAGINA).toContain('<PlacarDaFila resolvidos={resolvidos}');
  });

  /**
   * APARECE DESDE A PRIMEIRA TELA (18/09/2026). Antes tinha
   * `if (resolvidos === 0) return null` e só nascia depois da primeira decisão —
   * quem chegava via a pilha e nada dizendo que ela acaba. Era literalmente o
   * motivo de "não notei gamificação alguma": o único elemento que dá forma à
   * tarefa estava escondido até você já ter trabalhado.
   */
  it('mostra o tamanho da fila antes de qualquer decisão', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function PlacarDaFila'));
    expect(bloco).not.toContain('if (resolvidos === 0) return null;');
    expect(bloco).toContain('if (total === 0) return null;');
    expect(bloco).toContain('grupos para revisar');
    expect(bloco).toContain('Nenhum resolvido nesta sessão');
  });

  /** Celular não tem teclado: a dica de atalho some lá em vez de virar ruído. */
  it('a dica do teclado não aparece no celular', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function PlacarDaFila'));
    expect(bloco).toContain('hidden text-xs text-muted-foreground md:block');
    const foco = PAGINA.slice(PAGINA.indexOf('A legenda dos atalhos'));
    expect(foco.slice(0, 300)).toContain('hidden flex-wrap');
    expect(foco.slice(0, 300)).toContain('md:flex');
  });

  /** Barra em zero com zero resolvido: promessa de progresso é mentira barata. */
  it('a barra não finge progresso que não houve', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function PlacarDaFila'));
    expect(bloco).toContain('resolvidos === 0 ? 0 : Math.max(2, pct)');
  });

  /**
   * NÃO VAI PARA O SERVIDOR. Gravar isso viraria medida de desempenho de
   * pessoa, que é outra conversa e não é esta.
   */
  it('o número vive só na aba', () => {
    expect(PAGINA).not.toMatch(/api\.(post|put|patch)\([^)]*resolvidos/);
  });
});

/**
 * O LOTE PRECISA DIZER QUE É A MAIOR PARTE DO TRABALHO — 18/09/2026.
 *
 * O painel anunciava "825 podem ser consolidados de uma vez" logo acima de abas
 * somando 1.174, e as duas informações nunca se encontravam. Quem olha a fila vê
 * mil e pouco e desiste antes de perceber que a maioria sai num clique — medido:
 * dos 947 pares do acervo, só 26 são empate de verdade com dados divergentes, e
 * apenas 12 têm CPF diferente nos dois (esses nunca podem ser fundidos).
 *
 * Dizer o que SOBRA é o que transforma pilha sem fim em tarefa com fim.
 */
describe('o lote conversa com a fila', () => {
  const LOTE = readFileSync(
    path.join(RAIZ, 'components/filiados/lote-duplicados.tsx'), 'utf8',
  );

  it('a página passa o tamanho da fila para o painel', () => {
    expect(PAGINA).toContain('<LoteDuplicados gruposNaFila={(data ?? []).length} />');
  });

  it('e o painel diz quantos sobram depois', () => {
    expect(LOTE).toContain('sobram ${restamDepois.toLocaleString(\'pt-BR\')} para olhar um a um');
    expect(LOTE).toContain('depois disto não sobra nada para revisar');
  });

  /**
   * NÚMERO INVENTADO É PIOR QUE NÚMERO NENHUM: enquanto a fila não chegou, a
   * frase não aparece. E o lote conta PARES, a fila conta GRUPOS — a subtração
   * nunca pode ficar negativa.
   */
  it('não inventa número antes de a fila chegar, nem deixa negativo', () => {
    expect(LOTE).toContain('gruposNaFila === undefined ? null');
    expect(LOTE).toContain('gruposNaFila - gruposFechados');
  });

  /**
   * A CONTA SUBTRAÍA PARES DE GRUPOS (18/09/2026). Um grupo de três gera dois
   * pares: 925 pares saem de 798 grupos, e o painel prometia 498 quando sobram
   * 625. Errar por baixo é pior que não dizer — a pessoa termina o lote e
   * encontra 127 grupos que ninguém avisou.
   */
  it('subtrai GRUPOS fechados, não pares', () => {
    expect(LOTE).toContain('data?.gruposResolvidos ?? total');
    expect(LOTE).not.toContain('gruposNaFila - total');
  });

  /**
   * O PAINEL AFIRMAVA ALGO FALSO — 18/09/2026.
   *
   * "O cadastro removido tem apenas nome e matrícula" era o texto. Medido na
   * base: 868 dos 925 removidos têm DATA DE FILIAÇÃO, e em 91 ela é mais antiga
   * que a do cadastro que fica. A data não pontua e não é contradição, então
   * atravessava o critério do lote sem ser vista.
   */
  it('não diz mais que o removido só tem nome e matrícula', () => {
    expect(LOTE).not.toContain('apenas nome e matrícula');
    expect(LOTE).toContain('só nome, matrícula e a data de filiação');
  });

  it('conta em quantos a filiação antiga é preservada, e só quando há', () => {
    expect(LOTE).toContain('{!!data?.recuamFiliacao && (');
    expect(LOTE).toContain('tempo de sindicato não se perde');
  });
});

/**
 * O MODO QUE NINGUÉM ACHOU (18/09/2026).
 *
 * "Um por vez" existia desde o começo — um grupo na tela, decidido pelo teclado.
 * Só que o seletor era um botão de 12 px encostado na direita das abas e a
 * LISTA abria por padrão. O antídoto do tédio estava pronto e desligado, atrás
 * de uma nota de rodapé. Daí "não notei diferença".
 */
describe('um por vez é o padrão', () => {
  /*
    A fatia termina na explicação da aba: `text-xs` é legítimo LÁ, e uma
    negativa larga reprovava o arquivo certo por causa do vizinho.
  */
  const INICIO = PAGINA.indexOf('aria-label="Como revisar"');
  const SELETOR = PAGINA.slice(INICIO, PAGINA.indexOf('</div>', INICIO));

  it('a fatia examinada não está vazia', () => {
    expect(INICIO).toBeGreaterThan(0);
    expect(SELETOR.length).toBeGreaterThan(400);
  });

  it('a tela abre em foco, não na lista', () => {
    expect(PAGINA).toContain("useState<'lista' | 'foco'>('foco')");
  });

  it('o seletor tem tamanho de controle, não de legenda', () => {
    expect(SELETOR).toContain('Um por vez');
    expect(SELETOR).toContain('min-h-9');
    expect(SELETOR).toContain('text-sm');
    expect(SELETOR).not.toContain('text-xs');
  });

  /** Estado de botão de alternância precisa chegar a quem usa leitor de tela. */
  it('diz qual está ativo para a tecnologia assistiva', () => {
    expect(SELETOR).toContain("aria-pressed={modo === 'foco'}");
    expect(SELETOR).toContain("aria-pressed={modo === 'lista'}");
  });
});
