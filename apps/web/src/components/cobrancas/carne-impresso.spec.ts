import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
const modal = readFileSync(join(__dirname, 'carne-print-modal.tsx'), 'utf8');

/**
 * Só o bloco de impressão do carnê — as negativas não podem pegar o resto do
 * arquivo. Vai de `#carne-print-root` até o fim da regra `@page`, e não "mais
 * 200 caracteres": janela por contagem invade a seção seguinte, que foi o que
 * fez este próprio teste reprovar na primeira rodada.
 */
const impressao = (() => {
  const ini = css.indexOf('#carne-print-root');
  const page = css.indexOf('@page', ini);
  return css.slice(ini, css.indexOf('}', page) + 1);
})();

/**
 * A MESMA FATIA, SEM COMENTÁRIOS — e é ela que as negativas usam.
 *
 * Este teste reprovou o arquivo CORRIGIDO na primeira rodada: o comentário que
 * explica a mudança cita `size: A4` para dizer por que ele saiu, e o
 * `not.toMatch` casou com a explicação. Já aconteceu cinco vezes nesta base
 * (ver a negativa de `data-pura.spec`) — negativa mira CÓDIGO, nunca prosa.
 */
const semComentario = impressao.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * E O MESMO PARA O COMPONENTE. Sétima vez que uma negativa casa com a PROSA que
 * explica a mudança em vez de com o código — o comentário do filtro da
 * assinatura traz a tabela de medição, e a linha rejeitada aparece nela.
 * Negativa, neste repositório, lê sempre a versão sem comentários.
 */
const modalSemComentario = modal
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * "A FATURA QUANDO É EMITIDA EM A4 FICA COM AS BORDAS PRETAS. Deve ficar em A4
 * normal sem ficar com essas bordas. Ficar adaptado tanto para A4 em pé quanto
 * horizontal." — o dono, 24/09/2026.
 *
 * O QUE EU MEDI ANTES DE MEXER, e vale registrar porque contraria o print: aqui
 * a impressão sai BRANCA. Gerei o PDF pelo Chrome em retrato e em paisagem, com
 * e sem "gráficos de plano de fundo", e o arquivo pinta um retângulo branco de
 * página inteira (`1 1 1 rg 0 0 704 1033 re f`) nas quatro combinações.
 *
 * MAS A TELA BRANCA VINHA SÓ DO `html`/`body`. Como a sobreposição vira
 * `position: static` na impressão, ela tem a altura do CONTEÚDO — uns 8cm no
 * topo de uma folha de 29. Todo o resto dependia da tela de fundo do documento,
 * que é exatamente o que alguns visualizadores e drivers de PDF deixam
 * transparente. E transparente, num visualizador escuro, é preto.
 *
 * Os testes abaixo travam as quatro decisões.
 */
describe('o carnê impresso', () => {
  /** O branco sai de um ELEMENTO, não da tela de fundo do documento. */
  it('a folha cobre a página inteira, por conta própria', () => {
    expect(impressao).toContain('min-height: 100vh');
    expect(impressao).toMatch(/\.carne-overlay\s*\{[^}]*background:\s*#fff/);
    expect(impressao).toMatch(/\.carne-paper\s*\{[^}]*background:\s*#fff/);
  });

  /**
   * `size: A4` é `size: A4 RETRATO`. Quem escolhe paisagem na caixa de
   * impressão briga com o CSS — e ele pediu as duas.
   */
  it('a orientação é de quem imprime, não do CSS', () => {
    expect(impressao).toContain('size: auto');
    expect(semComentario).not.toMatch(/size:\s*A4/);
  });

  /**
   * Em paisagem a largura útil passa de 27cm. Sem limite, a etiqueta virava uma
   * fita horizontal com a assinatura no canto e um vão no meio.
   */
  it('a etiqueta não estica em paisagem', () => {
    expect(impressao).toContain('max-width: 186mm');
    expect(impressao).toContain('margin-left: auto');
    // O `max-width: none` de antes era o que deixava esticar.
    expect(semComentario).not.toContain('max-width: none');
  });

  /**
   * PAPEL NÃO TEM RETICÊNCIAS. "MARA BIANCA AMORIM CAMP…" no canhoto é o campo
   * mais importante do controle do sindicato virando adivinha — e não há como
   * clicar para ver o resto num papel.
   */
  it('nenhum campo do carnê é cortado com reticências', () => {
    const corpo = modalSemComentario.slice(modalSemComentario.indexOf('function MiniLinha'));
    expect(corpo).not.toContain('truncate');
  });

  /** E o que já estava certo continua: a navegação não sai no papel. */
  it('só o carnê é impresso', () => {
    expect(css).toContain('body > *:not(#carne-print-root)');
    expect(impressao).toContain('.no-print');
  });
});

/**
 * "E SE EU QUISER ENVIAR SÓ O CARNÊ DE UMA PARCELA? Sou obrigado enviar o carnê
 * inteiro no final das contas." — o dono, 24/09/2026.
 *
 * Era obrigado. E o pior: a ação já vivia no menu DE UMA parcela — clicar em
 * "Imprimir carnê" na parcela 2 mandava as doze. O rótulo dizia "carnê" porque
 * o código mandava o carnê; o menu prometia uma coisa e fazia outra.
 */
describe('imprimir uma parcela só', () => {
  const acoes = readFileSync(join(__dirname, 'parcela-actions.tsx'), 'utf8');
  const card = readFileSync(join(__dirname, 'filiado-cobrancas-card.tsx'), 'utf8');

  it('o menu da parcela manda a parcela, e diz isso no rótulo', () => {
    expect(acoes).toContain('Imprimir esta parcela');
    expect(acoes).toContain('parcelaId={parcela.id}');
  });

  it('o diálogo filtra pela parcela pedida', () => {
    expect(modal).toContain('.filter((p) => !somente || p.id === somente)');
  });

  /**
   * A ESCOLHA NÃO FICA PRESA. Quem abriu por engano pela parcela troca para o
   * carnê no próprio diálogo, sem fechar e procurar outro caminho.
   */
  it('dá para trocar entre a parcela e o carnê sem fechar', () => {
    expect(modal).toContain('Imprimir o carnê inteiro');
    expect(modal).toContain('Voltar para só esta parcela');
  });

  /** Com UMA parcela, "esta parcela" e "o carnê" são a mesma folha. */
  it('com uma parcela só, não oferece troca nenhuma', () => {
    expect(modal).toContain('const vale = total > 1;');
  });

  /** E o carnê inteiro ganhou o lugar dele: o cabeçalho da cobrança. */
  it('o carnê inteiro sai do cabeçalho da cobrança, com o número de folhas', () => {
    expect(card).toContain('setCarneInteiro(c.id)');
    expect(card).toContain('Carnê inteiro');
    expect(card).toContain('{c.parcelas.length > 1 &&');
  });

  /** No celular sobra o ícone e o número — o nome tem de existir em algum lugar. */
  it('o botão do celular tem nome acessível', () => {
    expect(card).toContain('aria-label={`Imprimir o carnê inteiro');
  });
});

/**
 * "A ASSINATURA DO PRESIDENTE TÁ COMO SE FOSSE UM FUNDO. Como se ela tivesse
 * colada."
 *
 * Baixei a imagem da produção e medi: PNG 243×52 COM canal alfa e **100% dos
 * pixels opacos** — uma foto do papel, com o papel dentro. Fundo de luminância
 * mediana 239 puxando para o verde; só 5,2% dos pixels são tinta.
 */
describe('a assinatura não é um adesivo', () => {
  it('o traço é separado do papel na hora de desenhar', () => {
    expect(modal).toContain('grayscale(1)_brightness(0.78)_contrast(7)');
  });

  /**
   * O `contrast(3)` "suave" derruba a tinta de 5,2% para 2,4% — clareia o traço
   * junto com o papel. Simulado sobre os pixels reais antes de escolher.
   */
  it('e o filtro escolhido não apaga o traço', () => {
    expect(modalSemComentario).not.toContain('brightness(1.1) contrast(3)');
  });
});
