import {
  soDigitos,
  sqlDasPublicacoesQueCitam,
  temInscricao,
} from './publicacoes-que-citam.util';

/**
 * A BARRA QUE SUMIA — e por que o teste tem de olhar o SQL COZIDO.
 *
 * Três lugares escreviam `'\D'` dentro de um template literal para tirar os
 * não-dígitos da OAB. Em JavaScript, `\D` num template é escape desconhecido e
 * a barra some: o Postgres recebia `regexp_replace(numeroOab, 'D', '', 'g')`,
 * que tira a LETRA D. Uma OAB escrita "12.345" continuava "12.345" e nunca
 * casava com o "12345" do cadastro — a publicação sumia do painel do advogado
 * sem erro nenhum, sem log, sem nada.
 *
 * NENHUM TESTE DE TEXTO DE ARQUIVO PEGARIA ISSO: no arquivo estava escrito
 * exatamente o que o autor quis dizer. Só olhando a string que o Prisma
 * realmente monta é que a barra ausente aparece.
 */
describe('o SQL que casa a OAB', () => {
  const sql = (opcoes = {}) => sqlDasPublicacoesQueCitam('12345', 'PI', opcoes).sql;

  it('não depende de escape nenhum para tirar os não-dígitos', () => {
    expect(sql()).toContain("regexp_replace(a->>'numeroOab', '[^0-9]', '', 'g')");
  });

  /** O defeito que existiu em produção, travado para não voltar. */
  it('NUNCA manda o regex que tira a letra D', () => {
    expect(sql()).not.toContain("'D'");
  });

  it('casa por número e UF, nunca por nome', () => {
    expect(sql()).toContain("upper(a->>'ufOab')");
    expect(sql()).not.toContain("a->>'nome'");
  });

  /** Sem o recorte antes, a expansão varre as 1.408 publicações do acervo. */
  it('recorta a data antes de expandir o JSON', () => {
    const s = sql({ de: new Date('2026-09-01') });
    expect(s.indexOf('data_disponibilizacao')).toBeLessThan(s.indexOf('jsonb_array_elements'));
  });

  it('sem janela, não inventa filtro de data', () => {
    expect(sql()).not.toContain('data_disponibilizacao');
  });

  it('o fim do período é exclusivo', () => {
    expect(sql({ ate: new Date('2026-10-01') })).toContain('data_disponibilizacao" <');
  });

  it('o limite só entra quando pedido', () => {
    expect(sql()).not.toContain('LIMIT');
    expect(sql({ limite: 5000 })).toContain('LIMIT');
  });
});

describe('a inscrição na OAB', () => {
  it('sem número ou sem UF não há vínculo por citação', () => {
    expect(temInscricao(null)).toBe(false);
    expect(temInscricao({ oab: '', oabUf: 'PI' })).toBe(false);
    expect(temInscricao({ oab: '12345', oabUf: '' })).toBe(false);
    expect(temInscricao({ oab: '  ', oabUf: 'PI' })).toBe(false);
  });

  /** O cadastro escreve "12.345" e o DJEN manda "12345" — ou o contrário. */
  it('a pontuação não atrapalha dos dois lados', () => {
    expect(temInscricao({ oab: '12.345', oabUf: 'pi' })).toBe(true);
    expect(soDigitos('12.345-PI')).toBe('12345');
    expect(soDigitos(null)).toBe('');
  });
});
