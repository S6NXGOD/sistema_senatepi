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
    expect(fn.slice(0, 700)).toContain('if (ok) setSeparar(null)');
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
 * E ELE PRECISA PARECER UM BOTÃO. Era texto cinza sem borda, do tamanho de uma
 * legenda, no meio de um cartão branco.
 */
describe('o controle de tirar do grupo', () => {
  const BLOCO = PAGINA.slice(
    PAGINA.indexOf('onClick={() => onForaDoGrupo(c)}'),
    PAGINA.indexOf('Não é a mesma pessoa') + 60,
  );

  it('tem borda, altura de dedo e contraste de gente', () => {
    expect(BLOCO).toContain('border border-dashed');
    expect(BLOCO).toContain('min-h-11'); // 44 px
    expect(BLOCO).toContain('font-medium');
    // Some o cinza-claro de legenda como cor final do texto.
    expect(BLOCO).not.toMatch(/text-xs\s+text-muted-foreground"/);
  });

  it('o hover diz que aquilo tira algo, sem pintar o cartão de alerta', () => {
    expect(BLOCO).toContain('hover:border-rose-300');
    expect(BLOCO).toContain('dark:hover:border-rose-900');
  });
});

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
