import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICO = readFileSync(join(__dirname, 'agenda.service.ts'), 'utf8');
const GAVETA = readFileSync(
  join(__dirname, '../../../../web/src/components/agenda/compromisso-drawer.tsx'),
  'utf8',
);
const CARTAO = readFileSync(
  join(__dirname, '../../../../web/src/components/agenda/compromisso-card.tsx'),
  'utf8',
);

/**
 * O DETALHE NUNCA MOSTRA MENOS QUE A LISTA — e mostrava.
 *
 * O relato: "no card da atividade aparece o Dr. Murilo, mas ao clicar e
 * detalhar aparece só um advogado".
 *
 * A CAUSA não era a tela. `cardSelect` (a listagem) pede `equipe`; o
 * `include` de `detalhe()` não pedia. O cartão empilhava os avatares certos e a
 * gaveta, ao abrir o MESMO compromisso, recebia `equipe: undefined` — então o
 * bloco "Também atuam", que já existia e estava pronto, nunca renderizava.
 *
 * Medido na produção em 10/09/2026: das 89 atividades, **9 têm alguém na equipe
 * além do responsável**. Nove pessoas sumiam ao abrir o detalhe.
 *
 * O mais irônico é que o comentário do select da lista já dizia o que ia
 * acontecer: "sem isto, uma audiência com três advogados apareceria como se
 * fosse de um".
 *
 * A REGRA QUE FICA: toda RELAÇÃO que a listagem devolve, o detalhe devolve
 * também. O detalhe pode mostrar MAIS (o filiado vem com contato), nunca menos.
 */
describe('a gaveta recebe tudo que o cartão recebe', () => {
  /** A varredura precisa estar mesmo lendo os arquivos. */
  it('os três arquivos foram lidos', () => {
    expect(SERVICO.length).toBeGreaterThan(1000);
    expect(GAVETA).toContain('compromisso');
    expect(CARTAO).toContain('compromisso');
  });

  /**
   * Compara as relações do `select` da LISTA com as do `include` do DETALHE.
   * Falha nomeando o que ficou de fora — não com um "esperava true".
   */
  it('nenhuma relação da lista falta no detalhe', () => {
    const trecho = (de: string, ate: string) => {
      const i = SERVICO.indexOf(de);
      expect(i).toBeGreaterThan(-1);
      return SERVICO.slice(i, SERVICO.indexOf(ate, i));
    };
    const lista = trecho('const cardSelect = {', '} as const;');
    const detalhe = trecho('async detalhe(id: string)', 'return {');

    const RELACOES = ['equipe', 'filiado', 'responsavel', 'criador', 'processo'];
    const faltando = RELACOES.filter(
      (r) => new RegExp(`^\\s*${r}:`, 'm').test(lista) && !new RegExp(`^\\s*${r}:`, 'm').test(detalhe),
    );
    expect(faltando).toEqual([]);
  });

  /** O caso concreto do relato, escrito por extenso para não voltar. */
  it('o detalhe pede a equipe, com o mesmo formato da lista', () => {
    const i = SERVICO.indexOf('async detalhe(id: string)');
    const detalhe = SERVICO.slice(i, SERVICO.indexOf('return {', i));
    expect(detalhe).toContain('equipe: {');
    expect(detalhe).toContain('select: { principal: true, usuario: responsavelSel }');
    expect(detalhe).toContain('orderBy: EQUIPE_ORDER');
  });

  /** E as duas telas leem a equipe do mesmo jeito: o principal não se repete. */
  it('cartão e gaveta filtram o principal da mesma forma', () => {
    expect(CARTAO).toContain("(c.equipe ?? []).filter((e) => !e.principal)");
    expect(GAVETA).toContain("(c.equipe ?? []).filter((e) => !e.principal)");
  });
});

/**
 * O RÓTULO NÃO AFIRMA PROFISSÃO.
 *
 * "Advogado(a) responsável" dizia o que o sistema não garante: das 89
 * atividades da produção, 4 respondem a quem não é advogado (2 coordenação, 1
 * triagem, 1 administrador) — e uma delas é justamente a que foi aberta para
 * relatar o problema da equipe. O perfil real já aparece na linha de baixo.
 */
describe('a gaveta não inventa o cargo de ninguém', () => {
  it('o bloco se chama apenas "Responsável"', () => {
    expect(GAVETA).toContain('<Bloco titulo="Responsável">');
    // A negativa mira o JSX, não a prosa: o comentário acima cita o rótulo
    // antigo para explicar por que ele saiu.
    expect(GAVETA).not.toContain('<Bloco titulo="Advogado(a) responsável">');
  });

  /** O perfil verdadeiro continua visível, logo abaixo do nome. */
  it('mas continua mostrando o perfil real da pessoa', () => {
    expect(GAVETA).toContain('c.responsavel.role');
  });
});

/**
 * O HISTÓRICO NOMEIA QUEM ENTROU.
 *
 * "Atividade criada com equipe de 2 pessoas" não diz QUEM — e o histórico é o
 * único lugar onde isso fica, porque a equipe muda depois: há na produção um
 * registro de "3 pessoas" numa atividade que hoje tem 2.
 *
 * Registro antigo não se reescreve; isto vale de agora em diante.
 */
describe('a narrativa da criação diz quem', () => {
  it('a validação da equipe traz o nome junto do id', () => {
    expect(SERVICO).toContain('select: { id: true, nome: true, nomeExibicao: true }');
    expect(SERVICO).toContain('Promise<{ id: string; nome: string }[]>');
  });

  it('e a frase nomeia quem também atua', () => {
    expect(SERVICO).toContain('também atuam: ${nomes}');
  });

  /** A contagem inclui o responsável, que não vem na lista de extras. */
  it('conta o responsável junto, e ele não está na lista de extras', () => {
    expect(SERVICO).toContain('equipe.length + 1} pessoas');
    expect(SERVICO).toContain(".filter((id) => id !== responsavelId)");
  });
});
