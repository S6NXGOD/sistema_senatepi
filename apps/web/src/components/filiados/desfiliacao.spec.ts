import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const ler = (arquivo: string) => readFileSync(path.join(__dirname, arquivo), 'utf8');
const MODAL = ler('desfiliar-modal.tsx');
const ACOES = ler('filiado-row-actions.tsx');
const REATIVAR = ler('reativar-modal.tsx');
const VINCULOS = ler('vinculos-do-filiado.tsx');

/**
 * O ERRO DO ANEXO NÃO PODE SE PASSAR POR ERRO DA DESFILIAÇÃO.
 *
 * O upload do termo assinado dividia o `try` com a desfiliação, e o `catch`
 * dizia "Não foi possível desfiliar". Mentira cara: a saída estava gravada, o
 * operador achava que falhara, tentava de novo e levava "Este filiado já está
 * desfiliado" — concluindo que o sistema estava quebrado, quando o único
 * problema era um arquivo que não subiu.
 */
describe('erro do anexo não mente sobre a desfiliação', () => {
  const confirmar = MODAL.slice(
    MODAL.indexOf('async function confirmar()'),
    MODAL.indexOf('function baixarTermo()'),
  );

  it('o trecho existe (o teste não olha para o vazio)', () => {
    expect(confirmar.length).toBeGreaterThan(400);
  });

  it('o anexo tem `try` próprio', () => {
    const anexo = confirmar.slice(confirmar.indexOf('if (arquivo)'));
    expect(anexo).toMatch(/try \{/);
    expect(anexo).toContain('anexarDocumentoFiliado');
  });

  it('quando o anexo falha, a mensagem diz que a saída FOI registrada', () => {
    expect(confirmar).toMatch(/foi desfiliado\(a\), mas o termo assinado não subiu/);
    // E diz para onde ir — erro sem saída é erro que vira chamado.
    expect(confirmar).toMatch(/aba Documentos/);
  });

  it('mesmo com o anexo falhando, a tela se atualiza', () => {
    // Sem `onConfirmed()` aqui, a lista continuaria mostrando o filiado como
    // ativo — e a pessoa desfiliaria de novo.
    const anexo = confirmar.slice(confirmar.indexOf('if (arquivo)'));
    const catchDoAnexo = anexo.slice(anexo.indexOf('} catch {'), anexo.indexOf('toast.success'));
    expect(catchDoAnexo).toContain('onConfirmed()');
  });
});

/**
 * O MENU NÃO TEM ITEM MORTO.
 *
 * Para quem já saiu, o menu mostrava "Já desfiliado", desabilitado — um beco.
 * O modal de saída PROMETE que o cadastro "pode ser reativado futuramente", e o
 * único caminho era o seletor de situação do formulário, que voltava o status e
 * deixava motivo, data e mês de corte gravados.
 */
describe('menu da linha', () => {
  it('não existe mais o item desabilitado', () => {
    /*
     * Procura o DEFEITO (`disabled={jaDesfiliado}`), e não o rótulo: o
     * comentário que documenta esta correção cita "Já desfiliado" de propósito,
     * e um `not.toContain` cru reprovaria o código certo pela explicação dele.
     * O atributo também é a descrição mais honesta do problema — o que
     * incomodava era o beco, não a palavra.
     */
    expect(ACOES).not.toMatch(/disabled=\{jaDesfiliado\}/);
  });

  it('quem saiu vê Reativar; quem está no quadro vê Desfiliar', () => {
    expect(ACOES).toMatch(/jaDesfiliado \? \(/);
    expect(ACOES).toContain('Reativar');
    expect(ACOES).toContain('Desfiliar');
  });

  it('as duas ações abrem modais próprios', () => {
    expect(ACOES).toContain('<ReativarModal');
    expect(ACOES).toContain('<DesfiliarModal');
  });
});

describe('modal de reativação', () => {
  it('exige motivo com conteúdo — não aceita espaço em branco', () => {
    expect(REATIVAR).toMatch(/motivo\.trim\(\)\.length >= 5/);
    expect(REATIVAR).toMatch(/disabled=\{!valido \|\| salvando\}/);
  });

  it('avisa que os dados da saída serão apagados', () => {
    expect(REATIVAR).toMatch(/apagados/);
    // …e que a saída NÃO some do histórico: são coisas diferentes, e confundir
    // as duas faria alguém achar que reativar encobre a saída.
    expect(REATIVAR).toMatch(/linha\s*\n?\s*\*?\s*do tempo|linha do tempo/);
  });

  /** Mobile-first: no celular o modal encosta na base, onde o polegar alcança. */
  it('é folha inferior no celular e caixa centrada no desktop', () => {
    expect(REATIVAR).toContain('items-end');
    expect(REATIVAR).toContain('sm:items-center');
  });
});

/**
 * O PAINEL DE VÍNCULOS informa, não bloqueia. Sair do sindicato é direito do
 * associado; recusar a saída por causa de uma parcela aberta transformaria a
 * mensalidade em algema.
 */
describe('painel do que fica pendente', () => {
  it('aparece dentro do modal de desfiliação', () => {
    expect(MODAL).toContain('<VinculosDoFiliado');
  });

  it('diz explicitamente que não impede a saída', () => {
    expect(VINCULOS).toMatch(/Nada disso impede a saída/);
  });

  it('some quando não há nada — e diz que não há', () => {
    // Um bloco com seis zeros empurra o botão para fora da tela no celular e
    // ensina a pessoa a rolar sem ler. Mas silêncio total seria ambíguo.
    expect(VINCULOS).toMatch(/if \(!itens\.length\)/);
    expect(VINCULOS).toMatch(/Nada pendente neste cadastro/);
  });

  /**
   * FALHAR CALADO SERIA PIOR QUE NÃO TER O PAINEL: a ausência de avisos seria
   * lida como "não há pendências", e a pessoa confirmaria.
   */
  it('quando a consulta falha, avisa que NÃO SABE', () => {
    expect(VINCULOS).toMatch(/isError/);
    expect(VINCULOS).toMatch(/Não foi possível verificar pendências/);
  });

  it('não usa cache velho — é tela de decisão', () => {
    expect(VINCULOS).toMatch(/staleTime: 0/);
  });
});

/**
 * O SELETOR DE SITUAÇÃO NÃO OFERECE O QUE A API RECUSA.
 *
 * Marcar DESFILIADO no formulário pulava motivo padronizado, mês de corte,
 * Termo assinado, histórico e auditoria. A API passou a recusar as duas
 * transições — e um `<select>` com uma opção que só sabe dar erro é pior que
 * não ter a opção.
 */
describe('seletor de situação no formulário', () => {
  const FORM = ler('filiado-form.tsx');

  it('DESFILIADO fica fora das opções', () => {
    expect(FORM).toMatch(/SITUACOES\.filter\(\(s\) => s !== 'DESFILIADO'\)/);
  });

  it('quem já saiu vê o estado em campo travado, apontando para Reativar', () => {
    expect(FORM).toMatch(/inicial\?\.situacao === 'DESFILIADO'/);
    expect(FORM).toMatch(/Reativar/);
  });
});
