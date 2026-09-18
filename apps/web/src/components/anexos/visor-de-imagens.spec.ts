import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { jaNoAcervo } from '@/lib/anexos';

const AQUI = __dirname;
const ler = (rel: string) => readFileSync(path.join(AQUI, rel), 'utf8');

const VISOR = ler('visor-de-imagens.tsx');
const SECAO = ler('anexos-section.tsx');
const LIB = readFileSync(path.join(AQUI, '../../lib/anexos.ts'), 'utf8');

/**
 * VER O QUE É O ARQUIVO SEM BAIXAR CADA UM (18/09/2026).
 *
 * "Não dá pra ver um preview do que é cada coisa?" — não dava. A lista mostrava
 * um ícone genérico e o nome. Num atendimento com 17 fotos de celular
 * (IMG-20250818-WA0027.jpg e companhia) o nome não identifica nada: descobrir
 * qual é a carteira de trabalho custava baixar as 17.
 */
describe('a miniatura na lista de anexos', () => {
  it('imagem vira miniatura de verdade, e não ícone', () => {
    expect(SECAO).toContain('object-cover');
    expect(SECAO).toContain('loading="lazy"');
    expect(SECAO).toContain('src={anexo.url}');
  });

  /** Uma gaveta com 17 fotos não pode baixar 2 MB antes de alguém rolar. */
  it('não carrega as imagens todas de uma vez', () => {
    const bloco = SECAO.slice(SECAO.indexOf('A IMAGEM É A PRÓPRIA IDENTIFICAÇÃO'));
    expect(bloco.slice(0, 1400)).toContain('loading="lazy"');
  });

  /** A URL é assinada e vale uma hora: quadrado quebrado é pior que ícone. */
  it('volta ao ícone quando a miniatura falha', () => {
    expect(SECAO).toContain('setSemMiniatura(true)');
    expect(SECAO).toContain('const podeAbrir = imagem && !semMiniatura && !!onAbrir;');
  });

  /** PDF o navegador já exibe na aba; não há visor para ele, e é de propósito. */
  it('só imagem abre o visor', () => {
    expect(SECAO).toContain('anexos.filter((a) => ehImagem(a.tipoMime))');
  });
});

describe('o visor de imagens', () => {
  it('folheia com o teclado, e Esc fecha', () => {
    expect(VISOR).toContain("e.key === 'Escape'");
    expect(VISOR).toContain("e.key === 'ArrowLeft'");
    expect(VISOR).toContain("e.key === 'ArrowRight'");
  });

  /** Quem manda 17 fotos manda um documento em 17 pedaços: dá a volta. */
  it('as setas dão a volta em vez de travar na ponta', () => {
    expect(VISOR).toContain('(indice - 1 + imagens.length) % imagens.length');
    expect(VISOR).toContain('(indice + 1) % imagens.length');
  });

  it('não mostra seta com uma imagem só', () => {
    expect(VISOR).toContain('const varias = imagens.length > 1;');
    expect(VISOR).toContain('{varias && (');
  });

  /**
   * AS SETAS SOBRE A FOTO — conferido na tela (18/09/2026). A 400 px a imagem
   * ocupava a largura toda e espremia as setas para fora, justamente no
   * aparelho onde não existe teclado e elas são o único jeito de folhear.
   */
  it('as setas ficam sobre a foto, e cabem em qualquer largura', () => {
    const setas = VISOR.slice(VISOR.indexOf('function Seta'));
    expect(setas).toContain('absolute top-1/2');
    expect(setas).toContain('left-2');
    expect(setas).toContain('right-2');
  });

  /** A tela é usada no celular: alvo de dedo sobre a foto. */
  it('os controles são alvo de dedo', () => {
    const setas = VISOR.slice(VISOR.indexOf('function Seta'));
    expect(setas).toContain('h-11 w-11');
    expect(VISOR).toContain('h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/80');
  });

  it('diz onde você está quando há várias', () => {
    expect(VISOR).toContain('${indice! + 1} de ${imagens.length}');
  });

  /** Clicar na foto não pode fechar o visor; clicar no fundo, sim. */
  it('o clique na imagem não fecha', () => {
    const img = VISOR.slice(VISOR.indexOf('<img'), VISOR.indexOf('</div>', VISOR.indexOf('<img')));
    expect(img).toContain('onClick={(e) => e.stopPropagation()}');
  });

  it('a falha de carregamento vira frase, não quadrado quebrado', () => {
    expect(VISOR).toContain('setFalhou(true)');
    expect(VISOR).toContain('vale por uma hora');
  });

  /**
   * PORTAL PARA O BODY — conferido na tela (18/09/2026).
   *
   * Dentro da gaveta de atendimento o visor cobria só a gaveta, uma faixa à
   * direita. A gaveta anima com `transform`, e elemento transformado vira o
   * bloco de contenção de `position: fixed`: o `inset-0` passa a valer para ela.
   */
  it('sai da gaveta e cobre a janela inteira', () => {
    expect(VISOR).toContain("import { createPortal } from 'react-dom';");
    expect(VISOR).toContain('return createPortal(');
    expect(VISOR).toContain('document.body,');
  });

  /** Rolar o fundo atrás de um visor de tela cheia desorienta. */
  it('trava a rolagem do fundo e devolve ao fechar', () => {
    expect(VISOR).toContain("document.body.style.overflow = 'hidden';");
    expect(VISOR).toContain('document.body.style.overflow = antes;');
  });
});

/**
 * O ACERVO SE ANUNCIA (18/09/2026).
 *
 * "E avisado que existem documentos no acervo para nao colocar repetido?" Nao
 * era. O botao "Puxar do acervo" resolvia desde sempre -- para quem sabia que
 * ele existia. A triagem fotografa a CTPS, o advogado abre o processo e
 * fotografa de novo, e o mesmo documento passa a existir tres vezes.
 */
describe('o acervo avisa antes da cópia repetida', () => {
  it('o botão mostra quantos há para puxar', () => {
    expect(SECAO).toContain("const aPuxar = acervo.filter((i) => !i.jaVinculado).length;");
    expect(SECAO).toContain('{aPuxar > 0 && (');
  });

  /** Zero para puxar e o número seria ruído: some. */
  it('sem nada para puxar, o número não aparece', () => {
    expect(SECAO).toContain('aPuxar > 0');
  });

  it('o envio PARA e pergunta quando reconhece o arquivo', () => {
    expect(SECAO).toContain('if (achado?.achado && !ignorarRepetido)');
    expect(SECAO).toContain('Este arquivo já está no acervo');
  });

  /** Perguntar, nunca bloquear: o casamento por nome e tamanho pode errar. */
  it('"enviar assim mesmo" continua sendo uma saída', () => {
    expect(SECAO).toContain("cancelLabel=\"Enviar assim mesmo\"");
    expect(SECAO).toContain('void enviar([arquivo], true);');
  });

  /** Dezessete fotos não podem virar dezessete perguntas. */
  it('só o primeiro repetido interrompe o lote', () => {
    expect(SECAO).toContain('.find((x) => x.achado)');
  });
});

describe('jaNoAcervo', () => {
  const item = (nome: string, tamanho: number | null) =>
    ({ nomeArquivo: nome, tamanhoBytes: tamanho }) as never;

  it('casa por nome e tamanho', () => {
    const acervo = [item('CTPS.pdf', 1000)];
    expect(jaNoAcervo({ name: 'CTPS.pdf', size: 1000 }, acervo)).toBeTruthy();
    expect(jaNoAcervo({ name: 'CTPS.pdf', size: 2000 }, acervo)).toBeNull();
    expect(jaNoAcervo({ name: 'Outro.pdf', size: 1000 }, acervo)).toBeNull();
  });

  /** "CTPS.pdf" e "ctps.pdf " são o mesmo documento. */
  it('ignora caixa e espaço nas pontas', () => {
    const acervo = [item(' ctps.PDF ', 1000)];
    expect(jaNoAcervo({ name: 'CTPS.pdf', size: 1000 }, acervo)).toBeTruthy();
  });

  /** Sem tamanho gravado, o nome basta — é o que há. */
  it('aceita o item sem tamanho', () => {
    expect(jaNoAcervo({ name: 'a.pdf', size: 5 }, [item('a.pdf', null)])).toBeTruthy();
  });

  it('acervo vazio não acha nada', () => {
    expect(jaNoAcervo({ name: 'a.pdf', size: 5 }, [])).toBeNull();
  });

  /** Comparar bytes exigiria ler o arquivo inteiro antes de cada envio. */
  it('a regra não lê o conteúdo do arquivo', () => {
    const bloco = LIB.slice(LIB.indexOf('export function jaNoAcervo'));
    expect(bloco.slice(0, 500)).not.toContain('arrayBuffer');
    expect(bloco.slice(0, 500)).not.toContain('FileReader');
  });
});
