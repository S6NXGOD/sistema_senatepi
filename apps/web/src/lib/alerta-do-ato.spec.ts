import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { PENDENCIA, avisoDaFaixa, frasePlena, rotulo, soConhecidas, type Pendencia } from './pendencias';

const RAIZ = path.resolve(__dirname, '..');
const FAIXA = readFileSync(path.join(RAIZ, 'components/faixa-de-atraso.tsx'), 'utf8');
const PAGINA = readFileSync(
  path.join(RAIZ, 'app/(dashboard)/processos/page.tsx'), 'utf8',
);
const FICHA = readFileSync(path.join(RAIZ, 'components/processos/processo-detalhe-sheet.tsx'), 'utf8');

const ato = (total: number, detalhe?: string): Pendencia => ({
  tipo: 'ATO_ESPERANDO_OLHO',
  total,
  exemplos: [
    {
      id: 'm1',
      // Cru, como a API manda — é o que torna a formatação provável.
      titulo: '00013819120235220101',
      quando: '2026-09-10T12:00:00.000Z',
      href: '/processos?processo=p1&andamento=m1',
      detalhe,
    },
  ],
});

/**
 * O ALERTA NO LUGAR DA TAREFA — 17/09/2026.
 *
 * "Se for algo urgente, mande um alerta, mas não encha de tarefas
 * desnecessárias." A faixa ganhou o quarto tipo; a agenda perdeu 48 tarefas que
 * ninguém queria (32 canceladas, 47 nascidas atrasadas).
 */
describe('a frase do ato que ninguém decidiu', () => {
  it('vários viram contagem, em português de gente', () => {
    expect(rotulo(ato(7))).toBe('7 atos do tribunal estão sem ninguém decidir');
    expect(rotulo(ato(1))).toBe('1 ato do tribunal está sem ninguém decidir');
  });

  /**
   * UM ATO SÓ DIZ QUAL É. "1 ato do tribunal está sem ninguém decidir" manda
   * procurar entre dezenas de linhas da ficha — é a mesma armadilha do aviso que
   * mostrava número sem destino.
   */
  it('um ato só é nomeado, e leva direto a ele', () => {
    const f = avisoDaFaixa(ato(1, 'Recurso negado'));
    // E o número sai formatado: ninguém lê processo com 20 dígitos seguidos.
    expect(f.texto).toBe('Recurso negado');
    expect(f.complemento).toBe('processo 0001381-91.2023.5.22.0101');
    expect(frasePlena(f)).toBe('Recurso negado — processo 0001381-91.2023.5.22.0101');
    expect(f.href).toBe('/processos?processo=p1&andamento=m1');
  });

  /**
   * O PROCESSO SEM NÚMERO NÃO ENGOLE A FRASE. Pré-processual e rascunho têm
   * `numeroCNJ` nulo, e a API manda 'Processo' no lugar; `mascararNPU` de um
   * texto sem dígitos devolve vazio, e a faixa escrevia "Recurso negado no
   * processo " — terminando no nada, no cabeçalho de todas as telas.
   */
  it('e um processo sem número é dito, não engolido', () => {
    const f = avisoDaFaixa({ ...ato(1, 'Recurso negado'), exemplos: [{ ...ato(1, 'Recurso negado').exemplos[0], titulo: 'Processo' }] });
    expect(frasePlena(f)).toBe('Recurso negado — processo ainda sem número');
  });

  /** Sem rótulo do ato, cai na contagem — nunca numa frase pela metade. */
  it('sem o nome do ato, não inventa frase', () => {
    expect(avisoDaFaixa(ato(1)).texto).toBe('1 ato do tribunal está sem ninguém decidir');
  });

  /**
   * O SISTEMA NUNCA AFIRMA PERDA DE PRAZO. Ele conhece a data que alguém marcou
   * na agenda, não o prazo processual — e acusar um advogado de perder prazo é a
   * afirmação mais grave que ele poderia fazer sem poder sustentá-la.
   */
  it('a frase não acusa ninguém de perder prazo', () => {
    for (const r of Object.values(PENDENCIA)) {
      expect(`${r.um} ${r.varios}`).not.toMatch(/vencid|perdeu|perdid|urgente/i);
    }
  });

  /** Tipo desconhecido continua sendo barrado na porta — defesa da janela de troca. */
  it('o tipo novo é conhecido, e um inventado não passa', () => {
    expect(soConhecidas([ato(1)])).toHaveLength(1);
    expect(soConhecidas([{ ...ato(1), tipo: 'AINDA_NAO_EXISTE' as never }])).toHaveLength(0);
  });
});

/**
 * O QUE ESTE BLOCO VIA — e por que quase não via nada.
 *
 * Ele lia o fonte e exigia a linha `ATO_ESPERANDO_OLHO: Gavel`. A linha existia
 * e a tela mostrava UM ícone só, o do PRIMEIRO grupo, para a faixa inteira:
 * quem escolhia era `ICONE[pendencias[0].tipo]`, e como o serviço começa sempre
 * por ATRASADA, era sempre o mesmo. Ficou verde com o defeito no ar — é a
 * armadilha do `toContain` no código-fonte.
 *
 * Ícone por linha agora é conferido no desenho de verdade, em
 * `components/avisos-da-faixa.spec.tsx`. Aqui fica só a rede da janela de
 * troca, que por definição não aparece em desenho nenhum: um tipo sem ícone não
 * pode derrubar o cabeçalho de todas as páginas.
 */
describe('o desenho da faixa separa as naturezas', () => {
  it('um tipo sem ícone cai num padrão, em vez de quebrar', () => {
    expect(FAIXA).toContain('?? AlertTriangle');
  });
});

/**
 * O LINK PRECISA CHEGAR AO ATO — e quase não chegava.
 *
 * `useAbrirPorUrl` limpa a URL assim que a ficha abre, então quem lesse o
 * segundo parâmetro depois não acharia nada. Ele é lido ANTES e guardado.
 */
describe('o aviso abre a ficha no ato certo', () => {
  it('a página lê `?andamento=` e entrega à ficha', () => {
    expect(PAGINA).toContain("searchParams.get('andamento')");
    expect(PAGINA).toContain('andamentoInicial={andamentoInicial}');
  });

  it('fechar a ficha esquece o destaque', () => {
    expect(PAGINA).toContain('setAndamentoInicial(null)');
  });

  it('a ficha abre na Linha do Tempo, no ato apontado', () => {
    const efeito = FICHA.slice(FICHA.indexOf('if (!open || !andamentoInicial) return;'));
    expect(efeito.slice(0, 200)).toContain('setAndamentoDestacado(andamentoInicial)');
    expect(efeito.slice(0, 200)).toContain("setAba('timeline')");
  });
});
