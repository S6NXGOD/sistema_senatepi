import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import PDFDocument from 'pdfkit';
import { carimbarRodape } from './pdf-rodape.util';

/**
 * A FOLHA EM BRANCO DO TERMO DE DESFILIAÇÃO.
 *
 * Relatado em 31/08/2026: o termo saía com duas páginas e a segunda vazia. O
 * conteúdo não passava nem da metade da primeira — quem criava a página era o
 * RODAPÉ, escrito 8pt abaixo da margem inferior. Ver o comentário do utilitário.
 *
 * Este arquivo mede o número de páginas de verdade, gerando o PDF: é a única
 * forma de o teste falhar se alguém reintroduzir o padrão antigo.
 */
const RAIZ = path.resolve(__dirname, '../..');
const RODAPE = 'DIRETORIA SENATEPI - Rua Exemplo, 100 - Teresina/PI | (86) 3000-0000';

/** Reproduz o padrão ANTIGO, para provar que o teste mede o que diz medir. */
function paginasComRodapeSolto(): number {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.on('data', () => {});
  const X = doc.page.margins.left;
  const W = doc.page.width - X - doc.page.margins.right;
  doc.text('conteúdo curto', X, 120);
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(6.5).text(RODAPE, X, doc.page.height - 42, { align: 'center', width: W });
  }
  const n = doc.bufferedPageRange().count;
  doc.end();
  return n;
}

function paginasCom(opcoes: Parameters<typeof carimbarRodape>[2] = {}, conteudo = 'conteúdo curto'): number {
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  doc.on('data', () => {});
  doc.text(conteudo, doc.page.margins.left, 120);
  carimbarRodape(doc as never, RODAPE, opcoes);
  const n = doc.bufferedPageRange().count;
  doc.end();
  return n;
}

describe('rodapé em PDF A4', () => {
  it('o padrão ANTIGO realmente criava a folha extra (o teste mede o que diz)', () => {
    expect(paginasComRodapeSolto()).toBe(2);
  });

  it('um documento de uma página continua com UMA página', () => {
    expect(paginasCom()).toBe(1);
  });

  it('com numeração de páginas também não estoura', () => {
    expect(paginasCom({ numerarPaginas: true })).toBe(1);
  });

  it('sem filete também não estoura', () => {
    expect(paginasCom({ corDaLinha: null })).toBe(1);
  });

  /**
   * Um rodapé comprido não pode voltar a paginar por quebra de linha — daí o
   * `lineBreak: false`. O tenant SINDSERM tem endereço mais longo que o do
   * SENATEPI, e é exatamente esse tipo de diferença que reabre o defeito num
   * cliente só.
   */
  it('rodapé longo demais não quebra em duas linhas nem cria página', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    doc.on('data', () => {});
    doc.text('x', doc.page.margins.left, 120);
    carimbarRodape(doc as never, RODAPE.repeat(4));
    expect(doc.bufferedPageRange().count).toBe(1);
    doc.end();
  });

  /** A margem tem de voltar: o dossiê continua escrevendo depois de carimbar. */
  it('devolve a margem inferior que encontrou', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    doc.on('data', () => {});
    doc.text('x', doc.page.margins.left, 120);
    carimbarRodape(doc as never, RODAPE);
    expect(doc.page.margins.bottom).toBe(50);
    doc.end();
  });

  /** Documento longo: todas as páginas recebem o carimbo, nenhuma extra nasce. */
  it('carimba as duas páginas de um documento que legitimamente tem duas', () => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    doc.on('data', () => {});
    doc.text('linha\n'.repeat(200), doc.page.margins.left, 120);
    const antes = doc.bufferedPageRange().count;
    expect(antes).toBeGreaterThan(1);
    carimbarRodape(doc as never, RODAPE, { numerarPaginas: true });
    expect(doc.bufferedPageRange().count).toBe(antes);
    doc.end();
  });
});

/**
 * O defeito era IDÊNTICO nos três documentos A4 do sistema. Corrigir só o termo
 * deixaria a ficha de filiação e o dossiê de evento com a folha em branco — e
 * ninguém ligaria um ao outro na próxima vez que aparecesse.
 */
describe('os três documentos A4 usam o utilitário', () => {
  const arquivos = [
    'src/modules/filiados/filiados.service.ts',
    'src/modules/eventos/dossie-evento.service.ts',
  ];

  it.each(arquivos)('%s carimba pelo utilitário', (rel) => {
    const src = readFileSync(path.join(RAIZ, rel), 'utf8');
    expect(src).toContain('carimbarRodape(');
  });

  it('nenhum deles escreve rodapé na mão abaixo da margem', () => {
    for (const rel of arquivos) {
      const src = readFileSync(path.join(RAIZ, rel), 'utf8');
      // `page.height - N` seguido de um `text(` do rodapé é o padrão antigo.
      expect(`${rel}: ${/const (fy|yr) = doc\.page\.height - 42/.test(src)}`).toBe(`${rel}: false`);
    }
  });

  /** O termo de desfiliação é o que motivou tudo — vale um caso com nome. */
  it('o termo de desfiliação foi convertido', () => {
    const src = readFileSync(path.join(RAIZ, 'src/modules/filiados/filiados.service.ts'), 'utf8');
    const termo = src.slice(src.indexOf('async gerarTermoDesfiliacaoPdf('));
    expect(termo).toContain('carimbarRodape(');
  });
});
