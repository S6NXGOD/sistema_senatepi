import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { moduloDaRota, NAV_SECOES } from '../nav-items';
import { senatepi } from '../../tenant/tenants/senatepi';
import { sindserm } from '../../tenant/tenants/sindserm';

const semComentarios = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const PAGINA = semComentarios(join(__dirname, '../../app/(dashboard)/recibos/page.tsx'));
const FILA = semComentarios(join(__dirname, 'fila-sem-recibo.tsx'));
const PAPEL = semComentarios(join(__dirname, 'recibo-print-modal.tsx'));
const EMITIR = semComentarios(join(__dirname, 'emitir-recibo-modal.tsx'));
const CANCELAR = semComentarios(join(__dirname, 'cancelar-recibo-modal.tsx'));
const CSS = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8').replace(/\r/g, '');
const ACOES_PARCELA = semComentarios(join(__dirname, '../cobrancas/parcela-actions.tsx'));

/**
 * A TELA DE RECIBOS — e o que ela promete além de "gerar um PDF".
 *
 * O pedido foi "resolver todos os problemas do sindicato com recibos, tanto
 * para gerar quanto para outras funções". Gerar é a parte fácil: o problema de
 * verdade é o pagamento que entrou e ninguém lembrou de dar recibo, a 2ª via
 * pedida três semanas depois, e o recibo errado que precisa sumir sem o número
 * sumir junto.
 */
describe('a tela tem o trabalho antes do número', () => {
  /**
   * A FILA VEM ANTES DA LISTA (`senatepi-painel-quatro-zonas`). Quem abre a
   * tela vê primeiro o que PEDE alguém, e só depois o acervo.
   */
  it('a fila de pendentes é desenhada antes do acervo', () => {
    const fila = PAGINA.indexOf('<FilaSemRecibo');
    // A busca é a primeira coisa do acervo; se ela vier antes da fila, a
    // ordem das zonas inverteu.
    const buscaDoAcervo = PAGINA.indexOf('Nome de quem pagou, CPF ou o número do recibo');
    expect(fila).toBeGreaterThan(0);
    expect(buscaDoAcervo).toBeGreaterThan(fila);
  });

  /** Bloco vazio vira UMA LINHA, e verde: "está tudo em dia" é desfecho bom. */
  it('sem pendência, o bloco encolhe para uma frase', () => {
    expect(FILA).toContain('if (!data.total)');
    expect(FILA).toContain('Todo pagamento registrado no caixa já tem recibo.');
    expect(FILA).toContain('text-emerald-700');
  });

  /** O contador é o número de verdade; a lista é cortada em 100. */
  it('a fila diz quando está cortada', () => {
    expect(FILA).toContain('data.truncada');
    expect(FILA).toContain('mostrando os {data.itens.length} mais recentes');
  });
});

describe('o acervo', () => {
  /**
   * O NÚMERO E A LISTA SAEM DO MESMO FILTRO (`senatepi-memo-e-chave-da-consulta`
   * e `senatepi-link-leva-o-recorte`): a `queryKey` é o próprio objeto de
   * filtro, e não uma lista de campos escrita à mão — que é como se esquece um.
   */
  it('a chave da consulta é o filtro inteiro', () => {
    expect(PAGINA).toContain("queryKey: ['recibos', filtro]");
    expect(PAGINA).toContain('queryFn: () => listarRecibos(filtro)');
  });

  /** Clicar em "2 cancelados" abre justamente esses dois, no mesmo recorte. */
  it('o número de cancelados leva ao recorte', () => {
    expect(PAGINA).toContain("trocarFiltro(() => setSituacao('CANCELADOS'))");
  });

  /**
   * NOME ACESSÍVEL SEMPRE, e CITANDO O NÚMERO. No desktop a palavra some
   * (`md:hidden`) e sobra o ícone: sem `aria-label` os dois botões ficavam sem
   * nome nenhum — foi o que a conferência de tela encontrou. E "Imprimir" seis
   * vezes na mesma tela não diz qual é qual.
   */
  it('imprimir e cancelar têm nome, e o nome diz qual recibo', () => {
    expect(PAGINA).toContain('aria-label={`Imprimir o recibo ${r.codigo}`}');
    expect(PAGINA).toContain('aria-label={`Cancelar o recibo ${r.codigo}`}');
  });

  /** Cancelado não some da lista: fica com tarja, e fora do total. */
  it('o cancelado aparece marcado, não escondido', () => {
    expect(PAGINA).toContain('function SeloCancelado()');
    expect(PAGINA).toContain('Cancelado');
    expect(PAGINA).toContain("{ valor: 'CANCELADOS', rotulo: 'Cancelados' }");
  });
});

describe('o papel', () => {
  /** Duas vias na mesma folha: uma vai, uma fica. É como o balcão usa. */
  it('sai em duas vias com o picote no meio', () => {
    expect(PAPEL).toContain('via="Via de quem pagou"');
    expect(PAPEL).toContain('via="Via do sindicato"');
    expect(PAPEL).toContain('function Picote()');
  });

  /**
   * O VALOR POR EXTENSO VEM DO SERVIDOR. Escrevê-lo aqui seria uma segunda
   * implementação da mesma frase, e a 2ª via poderia sair diferente da 1ª
   * (`senatepi-previa-le-a-mesma-regra`).
   */
  it('o extenso não é calculado na tela', () => {
    expect(PAPEL).toContain('{r.valorPorExtenso}');
    expect(PAPEL).not.toContain('function valorPorExtenso');
  });

  /** Papel não tem reticências (`senatepi-carne-impresso`). */
  it('nenhum campo do recibo é cortado', () => {
    expect(PAPEL).not.toContain('truncate');
  });

  /** Recibo cancelado reimpresso não pode parecer válido. */
  it('o cancelado sai carimbado, e avisa na tela antes de imprimir', () => {
    expect(PAPEL).toContain('CANCELADO');
    expect(PAPEL).toContain('Este recibo foi cancelado');
  });

  /**
   * O CSS DE IMPRESSÃO reconhece a raiz do recibo — e a do carnê continua
   * valendo. Sem a segunda exceção, o `body > *:not(...)` esconderia o recibo
   * e a folha sairia em branco.
   */
  it('a impressão mostra o recibo e esconde a aplicação', () => {
    expect(CSS).toContain('body > *:not(#carne-print-root):not(#recibo-print-root)');
    expect(CSS).toContain('#recibo-print-root .recibo-overlay');
    expect(CSS).toContain('#recibo-print-root .recibo-paper');
    expect(PAPEL).toContain('<div id="recibo-print-root">');
  });

  /** O fundo branco sai de um ELEMENTO, como no carnê — senão imprime preto. */
  it('a folha cobre a página por conta própria', () => {
    const bloco = CSS.slice(CSS.indexOf('#recibo-print-root .recibo-overlay'));
    expect(bloco.slice(0, 300)).toContain('min-height: 100vh');
    expect(bloco.slice(0, 300)).toContain('background: #fff');
  });
});

describe('emitir', () => {
  /** O que já está no caixa não se digita: o papel não pode divergir do livro. */
  it('com pagamento lançado, valor e data vêm de lá', () => {
    expect(EMITIR).toContain('const doCaixa = origem.tipo === \'PAGAMENTO\' ? origem.pagamento : null');
    expect(EMITIR).toContain('valor: doCaixa ? undefined : Number(valor)');
    expect(EMITIR).toContain('recebidoEm: doCaixa ? undefined : recebidoEm');
  });

  /** O campo abre VAZIO com exemplo no placeholder (`senatepi-encaminhamento-precisa-de-nome`). */
  it('o "referente a" tem exemplo, não texto pronto', () => {
    expect(EMITIR).toContain("placeholder=");
    expect(EMITIR).toContain('Ex.: 2ª via da carteirinha');
  });

  /** Quem paga pode não ser filiado: a busca é atalho, o nome digitado vale. */
  it('procurar no cadastro é opcional', () => {
    expect(EMITIR).toContain('Opcional — serve para o recibo aparecer na ficha da pessoa.');
    expect(EMITIR).toContain('comoDistinguir(f, repetidos.has(nomeComparavel(f.nome)))');
  });

  /** Emitir grava um número que não volta — e o diálogo diz isso antes. */
  it('avisa que o número não se repete', () => {
    expect(EMITIR).toContain('O número é gravado na hora e não se repete.');
  });

  /** Fechar por engano apaga o formulário: o fundo usa a regra da casa. */
  it('o clique no fundo segue a regra única de sobreposição', () => {
    expect(EMITIR).toContain('useSobreposicao(true,');
    expect(EMITIR).toContain('{...fundo}');
  });

  /** As chaves invalidadas existem — `['cobrancas']` não era chave de ninguém. */
  it('invalida as consultas que realmente existem', () => {
    expect(EMITIR).toContain("queryKey: ['cobrancas-filiado']");
    expect(EMITIR).toContain("queryKey: ['cobrancas-por-filiado']");
    expect(EMITIR).not.toContain("queryKey: ['cobrancas'] }");
  });
});

describe('cancelar', () => {
  it('o motivo é obrigatório e o botão espera por ele', () => {
    expect(CANCELAR).toContain('const MINIMO = 5;');
    expect(CANCELAR).toContain('confirmDisabled={motivo.trim().length < MINIMO}');
  });

  /** E o diálogo diz o que acontece — inclusive que o nome dele fica gravado. */
  it('explica que não apaga e que o nome fica', () => {
    expect(CANCELAR).toContain('não é apagado');
    expect(CANCELAR).toContain('não é\n            reaproveitado');
    expect(CANCELAR).toContain('Fica gravado no recibo e no histórico, com o seu nome.');
  });
});

describe('o recibo onde o dinheiro está', () => {
  /**
   * DAR A BAIXA E EMITIR O RECIBO É UM ATENDIMENTO, NÃO DOIS. A pessoa pagou,
   * a baixa saiu e ela está no balcão esperando o papel — mandá-la para outra
   * tela nesse momento é a fricção que faz o recibo não sair.
   */
  it('a baixa da parcela oferece o recibo em seguida', () => {
    expect(ACOES_PARCELA).toContain('onRecibo={podeMexerEmRecibo ?');
    expect(ACOES_PARCELA).toContain('<EmitirReciboModal');
  });

  /** Com recibo vivo, o menu oferece a 2ª via — e não um segundo recibo. */
  it('o menu troca de rótulo conforme já exista recibo', () => {
    expect(ACOES_PARCELA).toContain('const reciboVivo = parcela.recibo && !parcela.recibo.canceladoEm');
    expect(ACOES_PARCELA).toContain('Imprimir recibo {String(reciboVivo.numero).padStart(3, ');
    expect(ACOES_PARCELA).toContain('const podeEmitirRecibo = podeMexerEmRecibo && st === \'PAGO\' && !reciboVivo;');
  });

  /** As duas perguntas são separadas: ter cobranças não dá recibo. */
  it('a permissão lida é a de recibos, não a de cobranças', () => {
    expect(ACOES_PARCELA).toContain("nivelEfetivo(user?.role, user?.permissoes, 'recibos') === 'EDITAR'");
    expect(ACOES_PARCELA).toContain("moduloAtivo('recibos')");
  });
});

describe('o menu e o tenant', () => {
  it('a rota pertence ao módulo recibos', () => {
    expect(moduloDaRota('/recibos')).toBe('recibos');
    expect(moduloDaRota('/recibos/qualquer-coisa')).toBe('recibos');
  });

  it('o item mora no Financeiro, com ícone próprio', () => {
    const financeiro = NAV_SECOES.find((s) => s.titulo === 'Financeiro')!;
    const recibos = financeiro.itens.find((i) => i.href === '/recibos')!;
    expect(recibos.modulo).toBe('recibos');
    // Ícone IGUAL ao vizinho foi metade do motivo de duas telas serem lidas
    // como a mesma coisa (Organizações × Empresas).
    const cobrancas = financeiro.itens.find((i) => i.href === '/cobrancas')!;
    expect(recibos.icon).not.toBe(cobrancas.icon);
  });

  /** O SINDSERM não tem caixa: uma tela de recibo lá seria tela sem dinheiro. */
  it('o módulo está ligado só onde há caixa', () => {
    expect(senatepi.modulos).toContain('recibos');
    expect(sindserm.modulos).not.toContain('recibos');
    expect(sindserm.modulos).not.toContain('cobrancas');
  });
});
