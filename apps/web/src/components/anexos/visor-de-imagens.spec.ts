import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const AQUI = __dirname;
const ler = (rel: string) => readFileSync(path.join(AQUI, rel), 'utf8');

const VISOR = ler('visor-de-imagens.tsx');
const SECAO = ler('anexos-section.tsx');

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

  /** Rolar o fundo atrás de um visor de tela cheia desorienta. */
  it('trava a rolagem do fundo e devolve ao fechar', () => {
    expect(VISOR).toContain("document.body.style.overflow = 'hidden';");
    expect(VISOR).toContain('document.body.style.overflow = antes;');
  });
});
