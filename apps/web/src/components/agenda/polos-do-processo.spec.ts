import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { papelQueAcrescenta } from './polos-do-processo';

/**
 * O PAPEL SÓ APARECE QUANDO ACRESCENTA.
 *
 * Todo ATIVO num processo de conhecimento é "Autor" e todo PASSIVO é "Réu".
 * Repetir isso ao lado de cada nome, embaixo de um título que já diz "Polo
 * ativo", é ruído — e ruído num bloco novo é o jeito mais rápido de fazer a
 * equipe parar de ler o bloco.
 *
 * Mas em execução o ativo vira "Exequente", em recurso "Recorrente", e aí a
 * palavra carrega informação que o polo não dá.
 */
describe('papel que acrescenta', () => {
  it('esconde o papel óbvio do polo', () => {
    expect(papelQueAcrescenta('ATIVO', 'Autor')).toBeNull();
    expect(papelQueAcrescenta('PASSIVO', 'Réu')).toBeNull();
    expect(papelQueAcrescenta('TERCEIRO', 'Terceiro interessado')).toBeNull();
  });

  it('não se importa com caixa, acento ou espaço em volta', () => {
    expect(papelQueAcrescenta('PASSIVO', '  reu ')).toBeNull();
    expect(papelQueAcrescenta('PASSIVO', 'RÉU')).toBeNull();
    expect(papelQueAcrescenta('ATIVO', 'autor')).toBeNull();
  });

  it('mostra o papel que a fase mudou', () => {
    expect(papelQueAcrescenta('ATIVO', 'Exequente')).toBe('Exequente');
    expect(papelQueAcrescenta('ATIVO', 'Recorrente')).toBe('Recorrente');
    expect(papelQueAcrescenta('PASSIVO', 'Executado')).toBe('Executado');
    expect(papelQueAcrescenta('PASSIVO', 'Litisconsorte passivo')).toBe('Litisconsorte passivo');
  });

  it('preserva a grafia original de quem cadastrou', () => {
    // Compara normalizado, mas EXIBE o que a pessoa escreveu.
    expect(papelQueAcrescenta('ATIVO', 'EXEQUENTE')).toBe('EXEQUENTE');
  });

  it('sem papel, nada a mostrar', () => {
    expect(papelQueAcrescenta('ATIVO', null)).toBeNull();
    expect(papelQueAcrescenta('ATIVO', undefined)).toBeNull();
    expect(papelQueAcrescenta('ATIVO', '   ')).toBeNull();
  });

  /** Polo desconhecido não some da tela: sem regra, o papel é informação. */
  it('polo fora da lista mostra o papel', () => {
    expect(papelQueAcrescenta('OUTRO', 'Assistente')).toBe('Assistente');
  });
});

/**
 * NO DETALHE, O NOME QUEBRA — NÃO TRUNCA.
 *
 * É a diferença entre as duas telas. Na lista a pessoa varre dezenas de linhas
 * e truncar é certo; aqui ela parou nesta atividade e quer ler "SOCIEDADE
 * BRASILEIRA CAMINHO DE DAMASCO" inteiro. Duas linhas de texto custam menos que
 * uma viagem até a ficha do processo.
 */
describe('layout do bloco de polos', () => {
  const FONTE = readFileSync(path.join(__dirname, 'polos-do-processo.tsx'), 'utf8');

  it('os nomes quebram em vez de truncar', () => {
    expect(FONTE).toContain('break-words');
    /*
     * Olha as CLASSES, não o arquivo: a palavra "truncate" aparece no
     * comentário que explica justamente por que ela não é usada aqui. Um
     * `not.toContain` cru reprovava o código correto por causa da explicação
     * dele — teste que briga com a documentação é teste que alguém apaga.
     */
    const classes = [...FONTE.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    expect(classes.length).toBeGreaterThan(3);
    expect(classes.filter((c) => c.includes('truncate'))).toEqual([]);
  });

  it('a contagem só aparece com mais de uma parte no polo', () => {
    expect(FONTE).toContain('g.lista.length > 1');
  });
});
