import { filtrarNav, moduloDaRota } from './nav-items';

/**
 * ITEM DE MENU QUE ABRE UMA TELA DIZENDO "DESLIGADO" É BOTÃO MORTO.
 *
 * A integração com o DJEN é ligada por variável de ambiente na API e pode estar
 * desligada num cliente e ligada em outro — sem rebuild do front. Por isso a
 * decisão não pode morar no `tenant.config` (resolvido no build): quem responde
 * é a API, em tempo de execução, e o menu segue a resposta.
 */

const ADMIN = 'ADMINISTRADOR';

const rotulos = (integracoes?: { djen?: boolean }) =>
  filtrarNav(ADMIN, null, integracoes)
    .flatMap((s) => s.itens)
    .map((i) => i.href);

describe('menu e integrações', () => {
  it('mostra Publicações quando o DJEN está ligado', () => {
    expect(rotulos({ djen: true })).toContain('/publicacoes');
  });

  it('esconde quando está desligado', () => {
    expect(rotulos({ djen: false })).not.toContain('/publicacoes');
  });

  /**
   * Enquanto a resposta não chega, o item fica fora. Aparecer meio segundo
   * depois faz o menu pular debaixo do dedo de quem já ia clicar.
   */
  it('esconde enquanto ainda não sabe', () => {
    expect(rotulos(undefined)).not.toContain('/publicacoes');
  });

  /** Os demais itens não podem depender de integração nenhuma. */
  it('não afeta o resto do menu', () => {
    const ligado = rotulos({ djen: true }).filter((h) => h !== '/publicacoes');
    expect(rotulos({ djen: false })).toEqual(ligado);
    expect(ligado).toContain('/processos');
    expect(ligado).toContain('/agenda');
  });

  /**
   * O gate de permissão deriva o módulo do MESMO `NAV_SECOES`. Sem isto, a
   * rota ficaria acessível por URL para quem não tem o módulo `processos`.
   */
  it('a rota é permissionada pelo módulo de processos', () => {
    expect(moduloDaRota('/publicacoes')).toBe('processos');
  });
});
