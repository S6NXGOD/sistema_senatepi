import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resumoDeAnexos } from '@/lib/agenda';

const semComentarios = (rel: string) =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const CARD = semComentarios('compromisso-card.tsx');
const GAVETA = semComentarios('compromisso-drawer.tsx');
const SERVICO = readFileSync(
  join(__dirname, '../../../../api/src/modules/agenda/agenda.service.ts'),
  'utf8',
).replace(/\r/g, '');

/**
 * "COMO O ADVOGADO VAI SABER SEM PRECISAR CLICAR NO CARD?" — 02/10/2026.
 *
 * TERCEIRA vez que o dono pergunta a mesma coisa, e as duas correções
 * anteriores pararam no meio do caminho:
 *
 *   21/09 — "existe alguma maneira de sinalizar que a atividade tem anexo?"
 *           → nasceu o clipe do cartão, contando `_count.anexos` da PRÓPRIA
 *             atividade.
 *   24/09 — "a atividade tinha 17 anexos, mas não tá avisando no card."
 *           → a contagem da triagem entrou no payload… do DETALHE, e só o
 *             bloco herdado do rodapé passou a usá-la. O cartão ficou o de
 *             21/09, e a faixa "tem anexo?" do topo da gaveta também.
 *   02/10 — a mesma pergunta, de novo.
 *
 * MEDIDO NA PRODUÇÃO EM 02/10/2026:
 *
 *   atividades nascidas de triagem .............. 30
 *   com documento no atendimento de origem ....... 3
 *   mostrando NADA no cartão ..................... 2
 *   abertas entre essas .......................... 1
 *
 * A aberta é a Consulta Jurídica da VIVIAN NUNES COSTA, marcada para 08/10:
 * **zero anexos próprios e cinco no atendimento**. Zero não desenha clipe.
 */
describe('resumoDeAnexos — o clipe conta os dois lugares', () => {
  /** O caso da VIVIAN: nada na atividade, cinco na triagem. */
  it('só na triagem: diz quantos E que estão na triagem', () => {
    const r = resumoDeAnexos({ _count: { anexos: 0 }, atendimento: { _count: { anexos: 5 } } });
    expect(r).toMatchObject({ total: 5, daAtividade: 0, daTriagem: 5 });
    expect(r?.texto).toBe('5 anexos na triagem');
    expect(r?.frase).toBe('5 documentos na triagem');
  });

  /**
   * ONDE ESTÁ IMPORTA. "5 anexos" num cartão cujo bloco de documentos da
   * atividade abre VAZIO é pior que silêncio: manda procurar o que não está
   * ali. Por isso a palavra "triagem" entra no rótulo, e não só na dica.
   */
  it('não promete anexo na atividade quando ele é da triagem', () => {
    const r = resumoDeAnexos({ _count: { anexos: 0 }, atendimento: { _count: { anexos: 5 } } });
    expect(r?.texto).toContain('triagem');
    expect(r?.titulo).toContain('a triagem juntou');
  });

  it('só na atividade: continua como era antes', () => {
    const r = resumoDeAnexos({ _count: { anexos: 3 }, atendimento: null });
    expect(r?.texto).toBe('3 anexos');
    expect(r?.frase).toBe('3 documentos anexados');
  });

  it('nos dois lugares: soma e separa', () => {
    const r = resumoDeAnexos({ _count: { anexos: 2 }, atendimento: { _count: { anexos: 5 } } });
    expect(r).toMatchObject({ total: 7, daAtividade: 2, daTriagem: 5 });
    expect(r?.texto).toBe('2 anexos · 5 na triagem');
    expect(r?.titulo).toBe('2 arquivos nesta atividade e 5 arquivos na triagem de origem.');
  });

  it('singular em cada lado', () => {
    expect(resumoDeAnexos({ _count: { anexos: 1 } })?.texto).toBe('1 anexo');
    expect(resumoDeAnexos({ _count: { anexos: 1 } })?.frase).toBe('1 documento anexado');
    expect(resumoDeAnexos({ atendimento: { _count: { anexos: 1 } } })?.texto).toBe(
      '1 anexo na triagem',
    );
  });

  /** Sem nada em lugar nenhum, o clipe não existe — nunca "0 anexos". */
  it('zero não vira clipe', () => {
    expect(resumoDeAnexos({ _count: { anexos: 0 }, atendimento: { _count: { anexos: 0 } } })).toBeNull();
    expect(resumoDeAnexos({})).toBeNull();
    expect(resumoDeAnexos({ _count: null, atendimento: null })).toBeNull();
  });

  /**
   * JANELA DE TROCA: a API antiga não manda `_count` dentro de `atendimento`.
   * Ausente é zero, e o clipe volta a ser o de antes — nunca `NaN anexos`.
   */
  it('payload antigo não quebra nem inventa número', () => {
    const r = resumoDeAnexos({ _count: { anexos: 2 }, atendimento: { } as { _count?: { anexos: number } } });
    expect(r?.texto).toBe('2 anexos');
  });
});

describe('as três superfícies usam a mesma contagem', () => {
  it('o cartão mostra o resumo, e não mais só o próprio `_count`', () => {
    expect(CARD).toContain('const anexos = resumoDeAnexos(c);');
    expect(CARD).toContain('{anexos.texto}');
    expect(CARD).not.toContain('c._count.anexos}');
  });

  /** A faixa "tem anexo?" do topo da gaveta tinha o mesmo defeito. */
  it('a faixa do topo da gaveta também', () => {
    expect(GAVETA).toContain('const anexos = c ? resumoDeAnexos(c) : null;');
    expect(GAVETA).toContain('{anexos.frase}');
    expect(GAVETA).not.toContain("'1 documento anexado'");
  });

  /**
   * E O CARTÃO PRECISA DO DADO. Corrigir a tela não adianta se a listagem não
   * manda a contagem: `cardSelect.atendimento` trazia só id, número, descrição
   * e assunto.
   */
  it('a listagem manda a contagem da triagem no cartão', () => {
    const i = SERVICO.indexOf('const cardSelect = {');
    const bloco = SERVICO.slice(i, SERVICO.indexOf('} as const;', i));
    expect(bloco).toContain('_count: { select: { anexos: true } },');
    // Dentro de `atendimento`, e não só no nível de cima.
    const dentro = bloco.slice(bloco.indexOf('atendimento: {'));
    expect(dentro).toContain('_count: { select: { anexos: true } },');
  });
});

/**
 * O MESMO NÚMERO NÃO APARECE DUAS VEZES NA MESMA DOBRA.
 *
 * Com a faixa do topo passando a contar os arquivos da triagem, a gaveta
 * ficava com duas linhas vizinhas dizendo o mesmo: "6 documentos na triagem" e
 * "6 arquivos vieram com a triagem". É o defeito de "ficaram para trás", que
 * aparecia três vezes na mesma dobra da Agenda — repetir o fato é o que faz a
 * pessoa parar de ler.
 *
 * O que fica no bloco da triagem é o DESTINO, que é outro: a faixa rola até os
 * documentos da atividade; o botão abre a triagem inteira.
 */
describe('a gaveta não repete a contagem', () => {
  it('o bloco da triagem não conta de novo', () => {
    expect(GAVETA).not.toContain('vieram com a triagem');
    expect(GAVETA).not.toContain('veio com a triagem');
  });

  it('mas continua levando até lá, e o rótulo muda quando há arquivo', () => {
    expect(GAVETA).toContain("'Abrir a triagem e os arquivos' : 'Abrir triagem completa'");
  });

  /** E a faixa do topo é a única que conta — com destino próprio. */
  it('a faixa do topo rola até os documentos da atividade', () => {
    expect(GAVETA).toContain('getElementById(`anexos-${c.id}`)');
  });
});
