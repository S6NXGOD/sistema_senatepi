import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { filtrarNav, moduloDaRota, NAV_SECOES } from '../nav-items';

const RAIZ = path.resolve(__dirname, '../..');
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * AS TRÊS VISTAS DO MESMO ACERVO.
 *
 * Publicações e Panorama nasceram como itens de menu — erro meu. A seção
 * Jurídica foi de cinco para sete linhas, e "processos", "publicações dos
 * processos" e "panorama dos processos" passaram a competir como se fossem três
 * lugares. São o mesmo lugar visto de três alturas.
 */
describe('o menu não carrega as vistas do acervo', () => {
  const itens = NAV_SECOES.flatMap((s) => s.itens).map((i) => i.href);

  it('publicações e panorama saíram do menu', () => {
    expect(itens).toContain('/processos');
    expect(itens).not.toContain('/publicacoes');
    expect(itens).not.toContain('/panorama');
  });

  /**
   * AS ROTAS CONTINUAM, e continuam gateadas. Link salvo em favorito, atalho da
   * home e link colado no WhatsApp têm de abrir — e quem não tem o módulo de
   * processos não pode entrar por eles.
   */
  it('as rotas seguem permissionadas pelo módulo de processos', () => {
    expect(moduloDaRota('/publicacoes')).toBe('processos');
    expect(moduloDaRota('/panorama')).toBe('processos');
  });

  /** Duas seções de UM item cada eram dois títulos maiores que o conteúdo. */
  it('patronal e financeiro viraram uma seção só', () => {
    const titulos = NAV_SECOES.map((s) => s.titulo);
    expect(titulos).not.toContain('Patronal');
    expect(titulos).toContain('Financeiro');
    const financeiro = NAV_SECOES.find((s) => s.titulo === 'Financeiro')!;
    expect(financeiro.itens.map((i) => i.href)).toEqual(['/empresas', '/cobrancas']);
  });

  /**
   * SEIS SEÇÕES NO MÁXIMO, e não sete.
   *
   * O comentário original já dizia a regra certa — "o número depende do
   * cliente, travar um total quebraria na primeira instalação diferente" — e
   * mesmo assim travava a igualdade em 6. Quebrou exatamente como previsto: o
   * SINDSERM não contrata o Financeiro, tem CINCO seções, e a suíte inteira
   * dele ficava vermelha na CI por um menu que está correto.
   *
   * O que vale travar é o TETO (o menu não cresce) e a ausência de seção vazia
   * (título sem conteúdo é ruído em qualquer cliente).
   */
  it('o menu cabe em seis seções', () => {
    const secoes = filtrarNav('ADMINISTRADOR', null);
    expect(secoes.length).toBeGreaterThan(0);
    expect(secoes.length).toBeLessThanOrEqual(6);
    expect(secoes.filter((s) => s.itens.length === 0)).toEqual([]);
  });

  /** O advogado é quem mais usa a lateral — nele o corte pesa mais. */
  it('o advogado não vê mais as vistas do acervo na lateral', () => {
    const hrefs = filtrarNav('ADVOGADO', null).flatMap((s) => s.itens).map((i) => i.href);
    expect(hrefs).toContain('/processos');
    expect(hrefs).not.toContain('/publicacoes');
    expect(hrefs).not.toContain('/panorama');
  });

  /**
   * O QUE A TRAVA DE CINCO LINHAS REALMENTE PROTEGIA: a lista não cabendo.
   *
   * O número 5 era um proxy. A seção Jurídico foi para SEIS quando Municípios
   * entrou — e Municípios não é uma quarta vista do mesmo acervo, que era o
   * defeito original; é outro assunto, e é onde o advogado procura a
   * contraparte antes da audiência.
   *
   * Em vez de subir o número e seguir, a conta que ele representava passou a
   * ser feita: quanto a lista MEDE contra o que a tela oferece. A densidade da
   * barra foi reduzida junto (item de 40 para 36px, espaço entre seções de 16
   * para 12), o que devolveu ~120px.
   *
   * Medido: `100vh − 238px` de área útil (logo 64 + perfil 65 + rodapé 109).
   * Num Chrome maximizado em 1080p o viewport é ~937px, logo ~699px de lista.
   */
  const ALTURA = { item: 36, gapItem: 2, titulo: 16, gapSecao: 12, padding: 24 };

  const alturaDaLista = (secoes: ReturnType<typeof filtrarNav>) => {
    const itens = secoes.reduce((n, s) => n + s.itens.length, 0);
    return (
      ALTURA.padding +
      itens * (ALTURA.item + ALTURA.gapItem) +
      secoes.length * ALTURA.titulo +
      Math.max(0, secoes.length - 1) * ALTURA.gapSecao
    );
  };

  /**
   * OS DOIS PERFIS QUE MAIS USAM A LATERAL CABEM SEM ROLAR. Advogado e triagem
   * abrem o sistema todo dia e nunca deveriam procurar um item atrás do scroll.
   */
  it.each(['ADVOGADO', 'TRIAGEM'] as const)('a lateral cabe inteira para %s', (perfil) => {
    expect(alturaDaLista(filtrarNav(perfil, null))).toBeLessThanOrEqual(699);
  });

  /**
   * O ADMINISTRADOR AINDA ROLA UM POUCO, e isso é aceito: no cliente com todos
   * os módulos são dezesseis itens, ele é quem menos usa a lateral para
   * trabalhar, e o item aceso passou a se trazer para a vista sozinho
   * (`scrollIntoView` em `sidebar.tsx`). O teto abaixo é o que impede a
   * rolagem de voltar a esconder cinco linhas.
   *
   * NÃO se exige que haja rolagem: havia um `toBeGreaterThan(699)` aqui, isto
   * é, o teste OBRIGAVA o menu a não caber. Num cliente com menos módulos ele
   * cabe — e caber é melhor, não é defeito.
   */
  it('e para o administrador a rolagem fica curta', () => {
    const altura = alturaDaLista(filtrarNav('ADMINISTRADOR', null));
    expect(altura - 699).toBeLessThanOrEqual(120);
  });

  /**
   * E A SEÇÃO DE TRABALHO DIÁRIO continua sem virar depósito. O limite subiu de
   * cinco para seis com a densidade paga; o que não pode voltar são as VISTAS
   * do mesmo acervo, cobradas nos testes acima.
   */
  it('a seção Jurídico não vira depósito', () => {
    const juridico = NAV_SECOES.find((s) => s.titulo === 'Jurídico')!;
    expect(juridico.itens.length).toBeLessThanOrEqual(6);
  });
});

describe('a barra de abas', () => {
  const ABAS = ler('components/processos/abas-do-acervo.tsx');

  it('liga as três telas', () => {
    for (const href of ["'/processos'", "'/publicacoes'", "'/panorama'"]) {
      expect(ABAS).toContain(href);
    }
  });

  /**
   * Sem DJEN não há publicações. A trava saiu do menu e veio para cá; some a
   * aba, como sumia o item — aba que abre uma tela dizendo "desligado" é o
   * mesmo botão morto de antes.
   */
  it('esconde Publicações quando a integração está desligada', () => {
    expect(ABAS).toContain("const { djen } = useIntegracoes();");
    expect(ABAS).toContain("a.chave !== 'publicacoes' || djen");
  });

  /** Rola no celular em vez de quebrar, e diz qual está aberta. */
  it('é rolável e marca a aba atual para leitor de tela', () => {
    expect(ABAS).toContain('overflow-x-auto');
    expect(ABAS).toContain("aria-current={ativo ? 'page' : undefined}");
  });

  it('as três telas montam a barra', () => {
    expect(ler('app/(dashboard)/processos/page.tsx')).toContain('<AbasDoAcervo atual="lista" />');
    expect(ler('app/(dashboard)/publicacoes/page.tsx')).toContain(
      '<AbasDoAcervo atual="publicacoes" />',
    );
    expect(ler('app/(dashboard)/panorama/page.tsx')).toContain('<AbasDoAcervo atual="panorama" />');
  });
});
