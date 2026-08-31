import {
  conteudoDisposto,
  dataParaNome,
  modoPorExtensao,
  nomeDeArquivo,
  pedacoDeNome,
} from './nome-de-arquivo.util';

/**
 * OITO DOCUMENTOS DO SISTEMA BAIXAVAM COM UUID NO NOME.
 *
 * `carteirinha-9f58939f-fb64-41ee-bfc2-f0def1c6e02c.pdf`. Quem baixa doze
 * carteirinhas numa tarde fica com doze arquivos indistinguíveis na pasta, e a
 * única forma de saber qual é qual é abrir um por um.
 */
describe('nome do arquivo', () => {
  it('monta a partir dos pedaços que identificam o documento', () => {
    expect(nomeDeArquivo(['Carteirinha', 'MARIA APARECIDA DA CONCEIÇÃO'], 'pdf'))
      .toBe('Carteirinha - MARIA APARECIDA DA CONCEIÇÃO.pdf');
  });

  it('pedaço vazio some, sem deixar separador solto', () => {
    expect(nomeDeArquivo(['Termo', null, undefined, ''], 'pdf')).toBe('Termo.pdf');
    expect(nomeDeArquivo([null, 'Só isto'], 'pdf')).toBe('Só isto.pdf');
  });

  it('nenhum pedaço útil vira "documento", não vira ".pdf"', () => {
    expect(nomeDeArquivo([null, '   '], 'pdf')).toBe('documento.pdf');
  });

  it('mantém acento e hífen — o nome é lido por gente', () => {
    expect(nomeDeArquivo(['Crachá', 'MAT. MARQUES-BASTOS'], 'pdf'))
      .toBe('Crachá - MAT. MARQUES-BASTOS.pdf');
  });

  it('a extensão é normalizada, com ou sem ponto', () => {
    expect(nomeDeArquivo(['x'], '.PDF')).toBe('x.pdf');
    expect(nomeDeArquivo(['x'], 'xlsx')).toBe('x.xlsx');
  });

  it('nome quilométrico é cortado antes do limite do sistema de arquivos', () => {
    const n = nomeDeArquivo(['A'.repeat(400)], 'pdf');
    expect(n.length).toBeLessThanOrEqual(125);
    expect(n.endsWith('.pdf')).toBe(true);
  });

  /** `CON.pdf` não pode ser salvo no Windows. Custa uma linha tratar. */
  it('nome reservado do Windows ganha sufixo', () => {
    expect(nomeDeArquivo(['CON'], 'pdf')).toBe('CON_.pdf');
    expect(nomeDeArquivo(['LPT1'], 'pdf')).toBe('LPT1_.pdf');
  });
});

/**
 * A PARTE QUE É SEGURANÇA, E NÃO ESTÉTICA.
 *
 * O nome vem de dado do usuário — nome do filiado, nome do arquivo que ele
 * subiu. Uma quebra de linha ali dentro parte o `Content-Disposition` em dois e
 * deixa quem controla o dado escrever cabeçalhos arbitrários na resposta.
 */
describe('sanitização', () => {
  it('caractere de controle não passa — é injeção de cabeçalho', () => {
    const veneno = 'nota\r\nSet-Cookie: sessao=roubada';
    expect(pedacoDeNome(veneno)).not.toMatch(/[\r\n]/);
    expect(conteudoDisposto(nomeDeArquivo([veneno], 'pdf'))).not.toMatch(/[\r\n]/);
  });

  it.each([
    ['barra', 'a/b'],
    ['contrabarra', 'a\\b'],
    ['aspas', 'a"b'],
    ['dois-pontos', 'a:b'],
    ['asterisco', 'a*b'],
    ['interrogação', 'a?b'],
    ['pipe', 'a|b'],
    ['menor/maior', 'a<b'],
  ])('%s vira espaço', (_rotulo, bruto) => {
    expect(pedacoDeNome(bruto)).toBe('a b');
  });

  /**
   * Depois de as barras virarem espaço sobram os pontos, e um nome começando
   * com ponto fica oculto no Linux e no macOS.
   */
  it('travessia de diretório não sobrevive nem como nome oculto', () => {
    const n = nomeDeArquivo(['../../etc/passwd'], 'pdf');
    expect(n).not.toContain('/');
    expect(n).not.toContain('\\');
    expect(n.startsWith('.')).toBe(false);
    expect(n).toBe('etc passwd.pdf');
  });
});

/**
 * ACENTO EM CABEÇALHO HTTP. Cabeçalho é ASCII; `filename="João.pdf"` cru vira
 * mojibake ou é descartado inteiro. A RFC 5987/6266 manda os dois campos.
 */
describe('Content-Disposition', () => {
  it('manda a versão ASCII e a UTF-8', () => {
    const v = conteudoDisposto('Carteirinha - João.pdf');
    expect(v).toContain('inline; filename="Carteirinha - Joao.pdf"');
    expect(v).toContain("filename*=UTF-8''");
    expect(v).toContain(encodeURIComponent('Carteirinha - João.pdf'));
  });

  it('o campo ASCII não carrega byte não-ASCII', () => {
    const ascii = conteudoDisposto('Crachá - Íris Gonçalves.pdf').match(/filename="([^"]*)"/)![1];
    expect(ascii).toMatch(/^[ -~]*$/);
    expect(ascii).toBe('Cracha - Iris Goncalves.pdf');
  });

  it('aspas no nome não escapam do campo', () => {
    const v = conteudoDisposto('a"b.pdf');
    expect(v).toContain('filename="a b.pdf"');
    // Uma aspa a mais quebraria o cabeçalho em dois campos.
    expect(v.match(/"/g)!.length).toBe(2);
  });

  it('attachment quando pedido', () => {
    expect(conteudoDisposto('planilha.xlsx', 'attachment')).toMatch(/^attachment;/);
  });

  /** Nome sem ponto não tem extensão — separar às cegas dava "x.x". */
  it('nome sem extensão não duplica', () => {
    expect(conteudoDisposto('relatorio')).toContain('filename="relatorio.bin"');
  });
});

describe('inline ou attachment', () => {
  it.each(['a.pdf', 'a.PDF', 'a.jpg', 'a.png'])('%s abre na aba', (n) => {
    expect(modoPorExtensao(n)).toBe('inline');
  });

  it.each(['a.docx', 'a.doc', 'a.xlsx', 'a.csv', 'a.zip'])('%s baixa', (n) => {
    expect(modoPorExtensao(n)).toBe('attachment');
  });

  /** SVG é imagem e é documento ativo: baixa, para não virar vetor de XSS. */
  it('svg baixa, mesmo sendo imagem', () => {
    expect(modoPorExtensao('a.svg')).toBe('attachment');
  });
});

describe('data no nome', () => {
  it('formato ISO curto, que ordena sozinho na pasta', () => {
    expect(dataParaNome(new Date(2026, 7, 31))).toBe('2026-08-31');
    expect(dataParaNome(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
