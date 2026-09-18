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
 * O BOTÃO, DA SEGUNDA VEZ. A borda tracejada continuou invisível porque o
 * problema não era contraste, era VOCABULÁRIO: neste sistema, controle
 * secundário é `Button variant="outline"`, e o olho reconhece a forma antes de
 * ler o texto.
 */
describe('o controle de tirar do grupo, segunda tentativa', () => {
  const BLOCO = PAGINA.slice(
    PAGINA.indexOf('DA SEGUNDA VEZ, UM BOTÃO DE VERDADE'),
    PAGINA.indexOf('Não é a mesma pessoa') + 40,
  );

  it('usa o Button do sistema, e não um botão desenhado à mão', () => {
    expect(BLOCO).toContain('variant="outline"');
    expect(BLOCO).not.toContain('border-dashed');
    expect(BLOCO).toContain('min-h-11'); // 44 px de alvo continua
  });

  it('e o rosa continua só no hover', () => {
    expect(BLOCO).toContain('hover:border-rose-300');
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
    for (const acao of ['Consolidar', 'Não é duplicado', 'Não é a mesma pessoa']) {
      expect(bloco).toContain(acao);
    }
    expect(bloco).toContain('Nenhum dado se perde');
    expect(bloco).toContain('nada é apagado');
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

  /** Zerado, ele é só mais uma linha na tela. */
  it('some quando ainda não há nada resolvido', () => {
    const bloco = PAGINA.slice(PAGINA.indexOf('function PlacarDaFila'));
    expect(bloco).toContain('if (resolvidos === 0) return null;');
  });

  /**
   * NÃO VAI PARA O SERVIDOR. Gravar isso viraria medida de desempenho de
   * pessoa, que é outra conversa e não é esta.
   */
  it('o número vive só na aba', () => {
    expect(PAGINA).not.toMatch(/api\.(post|put|patch)\([^)]*resolvidos/);
  });
});
