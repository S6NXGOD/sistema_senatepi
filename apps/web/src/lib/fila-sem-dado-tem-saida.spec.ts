import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { CAMPOS_COMPARADOS, CAMPOS_DE_ULTIMO_RECURSO, estadoDaFila } from './duplicidade';

const PAGINA = readFileSync(
  path.resolve(__dirname, '../app/(dashboard)/filiados/duplicados/page.tsx'),
  'utf8',
);

/**
 * A FILA DE DUPLICADOS VIROU UM BECO — 22/09/2026.
 *
 * O print do dono: "Confiança Alta 0 · Média 0 · Baixa 0", um ✓ verde dizendo
 * "Nada pendente nesta confiança", e — em cinza de 11px, no rodapé — "Outros
 * 148 grupos esperam um dado (...) Ver assim mesmo". A conclusão dele foi
 * exata: **"aqui não aparece nada pra fazer"**.
 *
 * DUAS COISAS ESTAVAM ERRADAS, e nenhuma era a regra de agrupar:
 *
 *  1. o ✓ verde MENTIA. Ele quer dizer "acabou", e havia 148 grupos do outro
 *     lado de um link que ninguém vê;
 *  2. a única porta era rodapé. A decisão de 18/09 (esconder o balde para a
 *     fileira não mostrar "397 pendências") não estava errada — ficou velha
 *     quando as três confianças zeraram e o balde escondido virou a tela toda.
 *
 * O QUE ESTE SPEC NÃO FAZ: não afrouxa a fusão. Ela apaga de verdade
 * (`filiado.delete`), e a medição desta base diz que nome igual é homônimo —
 * nos 3 grupos com veredito, 3 eram pessoas diferentes.
 */

describe('o que a tela diz quando a aba está vazia', () => {
  it('nada em lugar nenhum: aí sim acabou', () => {
    expect(estadoDaFila({ nestaAba: 0, decidiveis: 0, esperando: 0 })).toBe('TUDO_RESOLVIDO');
  });

  /** O caso do print: três confianças em zero e 148 esperando dado. */
  it('148 esperando e nada decidível: a tela oferece a porta, não um ✓', () => {
    expect(estadoDaFila({ nestaAba: 0, decidiveis: 0, esperando: 148 })).toBe('SO_ESPERANDO');
  });

  it('esta confiança vazia, outra com fila: manda para lá', () => {
    expect(estadoDaFila({ nestaAba: 0, decidiveis: 5, esperando: 148 })).toBe('TEM_EM_OUTRA');
  });

  it('com grupo na aba, não há estado vazio nenhum', () => {
    expect(estadoDaFila({ nestaAba: 3, decidiveis: 3, esperando: 148 })).toBeNull();
  });
});

describe('a saída deixou de ser rodapé', () => {
  /**
   * O BALDE É UMA ABA. Se alguém voltar a escondê-lo atrás de `aba ===
   * 'ESPERANDO'`, a tela zerada volta a parecer resolvida — que é o defeito
   * inteiro deste dia.
   */
  it('o botão do balde aparece quando há grupos, não quando já se está dentro', () => {
    expect(PAGINA).toContain('{esperando.length > 0 && (');
    expect(PAGINA).toContain('Sem dado para decidir');
  });

  it('o ✓ verde só sai no TUDO_RESOLVIDO', () => {
    const bloco = PAGINA.slice(
      PAGINA.indexOf("{!isLoading && !isError && grupos.length === 0 && ("),
      PAGINA.indexOf('</CardContent></Card>', PAGINA.indexOf("{!isLoading && !isError && grupos.length === 0 && (")),
    );
    expect(bloco).toContain("estadoVazio === 'TUDO_RESOLVIDO'");
    // A frase que enganou: não pode mais ser a única coisa na tela vazia.
    expect(bloco).toContain('Nada a decidir com o que o cadastro tem hoje');
  });

  /** A porta antiga (rodapé cinza com "Ver assim mesmo") saiu de cena. */
  it('o rodapé "Ver assim mesmo" não é mais a única saída', () => {
    expect(PAGINA).not.toContain('<EsperandoDado');
  });
});

describe('decidir com o que sobra', () => {
  /**
   * TRÊS FATOS, e a data da ficha era o que faltava: ela separa "duas fichas
   * do mesmo dia, matrículas consecutivas" — que na produção deu DUAS PESSOAS,
   * com CPFs distintos — de "uma de 2014 e outra da carga de 2026".
   */
  it('a data da ficha entra na comparação de último recurso', () => {
    expect(CAMPOS_DE_ULTIMO_RECURSO.map((c) => c.chave)).toContain('createdAt');
  });

  it('e não repete o que a comparação normal já mostra', () => {
    const normais = new Set(CAMPOS_COMPARADOS.map((c) => c.chave as string));
    for (const c of CAMPOS_DE_ULTIMO_RECURSO) expect(normais.has(c.chave)).toBe(false);
  });

  it('a data de filiação continua na comparação normal', () => {
    expect(CAMPOS_COMPARADOS.map((c) => c.chave)).toContain('dataFiliacao');
  });

  /** O último recurso só entra no balde: em grupo com CPF, a data da ficha é ruído. */
  it('só o balde ganha os campos extras', () => {
    // Sem espaço em branco: o arquivo é CRLF e uma quebra literal nunca casaria.
    const semEspaco = PAGINA.replace(/\s+/g, ' ');
    expect(semEspaco).toContain(
      'grupo.esperandoDado === true ? [...CAMPOS_COMPARADOS, ...CAMPOS_DE_ULTIMO_RECURSO]',
    );
  });
});

describe('pedir o dado que resolve', () => {
  /**
   * É A ÚNICA SAÍDA QUE DECIDE DE VERDADE. Se as duas fichas receberem o MESMO
   * CPF, a API recusa a segunda por unicidade — e isso PROVA que são a mesma
   * pessoa. Vindo diferentes, o grupo se resolve como pessoas diferentes.
   *
   * Antes de 22/09 este botão não podia existir: ficha em branco não gerava
   * link (o desafio caía em NENHUM). Hoje gera — ver `IDENTIFICACAO`.
   */
  it('cada ficha do balde tem como pedir o CPF', () => {
    expect(PAGINA).toContain('Pedir o CPF a esta pessoa');
    expect(PAGINA).toContain('<EnviarLinkModal');
  });

  it('e só no balde — pedir de novo a quem já tem é ruído', () => {
    expect(PAGINA).toContain('const semDadoNenhum = grupo.esperandoDado === true;');
    expect(PAGINA).toContain('{semDadoNenhum && (');
  });
});
