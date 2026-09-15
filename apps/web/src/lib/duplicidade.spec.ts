import { fraseDoDescarte, resumoDoCadastro } from './duplicidade';
import { moduloDaRota } from '@/components/nav-items';

/**
 * A ROTA DA FILA É DA PERMISSÃO PRÓPRIA (15/09/2026): quem o Administrador
 * liberou entra mesmo sem "Filiados", e quem edita filiados não entra só por isso.
 */
describe('a rota da fila de duplicados', () => {
  it('pertence a "Cadastros duplicados", e o resto de /filiados continua de Filiados', () => {
    expect(moduloDaRota('/filiados/duplicados')).toBe('duplicados');
    expect(moduloDaRota('/filiados')).toBe('filiados');
    expect(moduloDaRota('/filiados/abc-123')).toBe('filiados');
  });
});

/**
 * Os pares marcados como "pessoas diferentes" ganharam uma lista e uma volta
 * (15/09/2026). Estas frases são o que o Administrador lê para decidir se foi
 * engano — como MARIA DA CRUZ DE SOUSA, 3520 × 3746, marcada pela Coordenação.
 */
describe('pares marcados como pessoas diferentes', () => {
  it('diz quem marcou e o dia', () => {
    expect(fraseDoDescarte({ autor: 'Julian Helton', decididoEm: '2026-09-02T12:06:00.000Z' }))
      .toBe('Marcado por Julian Helton em 02/09/2026');
  });

  it('o dia é o de Teresina: 22h30 do dia 2 já é dia 3 em UTC', () => {
    expect(fraseDoDescarte({ autor: null, decididoEm: '2026-09-03T01:30:00.000Z' })).toBe('Marcado em 02/09/2026');
  });

  it('o resumo mostra o que ajuda a decidir e não inventa o que falta', () => {
    expect(resumoDoCadastro({ cidade: 'Teresina', cpf: '11122233344', dataNascimento: '1970-11-10T03:00:00.000Z' }))
      .toBe('Teresina · com CPF · nasc. 10/11/1970');
    expect(resumoDoCadastro({ cidade: '  ', cpf: null, dataNascimento: null })).toBe('sem CPF');
  });
});
