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
   * SEIS SEÇÕES, e não sete. O número de ITENS depende do cliente — cada
   * sindicato contrata os módulos que quer, e travar um total aqui quebraria o
   * teste na primeira instalação diferente. O que vale travar é a estrutura.
   */
  it('o menu cabe em seis seções', () => {
    expect(filtrarNav('ADMINISTRADOR', null)).toHaveLength(6);
  });

  /** O advogado é quem mais usa a lateral — nele o corte pesa mais. */
  it('o advogado não vê mais as vistas do acervo na lateral', () => {
    const hrefs = filtrarNav('ADVOGADO', null).flatMap((s) => s.itens).map((i) => i.href);
    expect(hrefs).toContain('/processos');
    expect(hrefs).not.toContain('/publicacoes');
    expect(hrefs).not.toContain('/panorama');
  });

  /**
   * A SEÇÃO JURÍDICA CABE EM CINCO LINHAS, e é ela que mede o inchaço.
   *
   * Travar o TOTAL do menu seria travar contra evolução: qualquer módulo novo
   * quebraria o teste sem que nada tivesse piorado. O que não pode voltar a
   * crescer é a seção de trabalho diário — foi onde as três vistas do mesmo
   * acervo competiam como se fossem três lugares.
   */
  it('a seção Jurídico não volta a inchar', () => {
    const juridico = NAV_SECOES.find((s) => s.titulo === 'Jurídico')!;
    expect(juridico.itens.length).toBeLessThanOrEqual(5);
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
