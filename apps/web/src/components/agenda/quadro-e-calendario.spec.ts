import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { visiveisDaColuna } from './kanban-view';

const ler = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

const KANBAN = ler('components/agenda/kanban-view.tsx');
const CALENDARIO = ler('components/agenda/calendario-view.tsx');
const AGENDA = ler('app/(dashboard)/agenda/page.tsx');
const ETIQUETAS = ler('components/processos/etiquetas-input.tsx');
const BUSCA = ler('components/ui/busca-select.tsx');
const IMPORTAR = ler('components/processos/importar-processo-dialog.tsx');
const EDITOR = ler('components/processos/editor-de-partes.tsx');

/**
 * O QUADRO — duas coisas diferentes, e eu tratei as duas como uma.
 *
 * O problema REAL, medido na produção em 04/09/2026 na aba "Todos": 37
 * concluídas e 18 canceladas contra 6 pendentes. Noventa por cento do quadro é
 * trabalho morto, e cresce todo mês. O conserto é o TETO nas colunas terminais.
 *
 * O problema que eu INVENTEI: achar que as quatro colunas vazias da aba "Hoje"
 * também eram excesso, e trocá-las por uma mensagem central. Coluna vazia não é
 * ruído — é o espaço de trabalho, e é o que faz o quadro parecer um lugar onde
 * cabe alguma coisa. Ver o primeiro caso abaixo.
 */
describe('o quadro', () => {
  /**
   * AS QUATRO COLUNAS FICAM À VISTA, SEMPRE — e este teste existe porque eu já
   * fiz o contrário.
   *
   * Troquei as colunas vazias por uma mensagem central ("nada marcado para
   * hoje") achando que eram ruído. Não eram: são o ESPAÇO DE TRABALHO. Sem os
   * contêineres, o quadro deixa de ser um lugar onde trabalho cabe e vira um
   * aviso de que não há trabalho — e num acervo em que quatro dos nove
   * advogados têm ZERO atividades e mais de oitenta processos, isso confirma
   * exatamente a crença errada. Quem usa resumiu melhor: "causa preguiça em
   * cadastrar uma atividade".
   */
  it('nunca troca as colunas por uma mensagem central', () => {
    expect(KANBAN).not.toContain('compromissos.length === 0 &&');
    expect(AGENDA).not.toContain('Nada marcado para hoje.');
  });

  /**
   * E A COLUNA VAZIA PEDE. "Pendente" é a única em que faz sentido começar
   * algo; as outras três seguem discretas, porque ninguém cria uma atividade
   * já concluída.
   */
  it('a coluna de pendente vazia oferece criar', () => {
    expect(KANBAN).toContain("s === 'PENDENTE' && onNovo");
    expect(KANBAN).toContain('Nova atividade');
    expect(AGENDA).toContain('onNovo={onNovo}');
  });

  /** As terminais continuam do tamanho normal, vazias ou não. */
  it('nenhuma coluna encolhe', () => {
    expect(KANBAN).toContain("const TERMINAIS: StatusCompromisso[] = ['CONCLUIDO', 'CANCELADO']");
    expect(KANBAN).not.toContain('const encolhida');
  });

  /** E cheias não viram depósito: teto com saída explícita. */
  it('a coluna terminal tem teto, e diz quantas escondeu', () => {
    expect(KANBAN).toContain('const TETO_TERMINAL = 10;');
    expect(KANBAN).toContain('Ver as outras {escondidas}');
  });

  /**
   * O TETO MOSTRA AS MAIS RECENTES — e mostrava as mais antigas.
   *
   * A lista chega em ordem crescente e a coluna cortava as 10 primeiras: em
   * Todas, "Concluído" mostrava as de meados de julho e escondia as de ontem
   * (achado em 14/09/2026). Com linhas, não com o texto do fonte.
   */
  describe('visiveisDaColuna', () => {
    // 12 concluídas, uma por dia, de 01/09 a 12/09/2026, na ordem da API.
    const concluidas = Array.from({ length: 12 }, (_, i) => ({
      id: `c${String(i + 1).padStart(2, '0')}`,
      inicio: `2026-09-${String(i + 1).padStart(2, '0')}T10:00:00-03:00`,
    }));

    it('cheia, mostra as dez mais recentes, a de ontem primeiro', () => {
      const vis = visiveisDaColuna(concluidas, 'CONCLUIDO', false);
      expect(vis.map((c) => c.id)).toEqual(['c12', 'c11', 'c10', 'c09', 'c08', 'c07', 'c06', 'c05', 'c04', 'c03']);
    });

    it('aberta por inteiro, as dez que a pessoa já viu não trocam de lugar', () => {
      const vis = visiveisDaColuna(concluidas, 'CANCELADO', true);
      expect(vis).toHaveLength(12);
      expect(vis.slice(0, 10).map((c) => c.id)).toEqual(visiveisDaColuna(concluidas, 'CANCELADO', false).map((c) => c.id));
      expect(vis.slice(10).map((c) => c.id)).toEqual(['c02', 'c01']);
    });

    it('coluna aberta (pendente, em andamento) não tem teto e mantém a ordem da página', () => {
      expect(visiveisDaColuna(concluidas, 'PENDENTE', false).map((c) => c.id)).toEqual(concluidas.map((c) => c.id));
    });

    it('mesmo início desempata pelo id, sem depender da ordem de chegada', () => {
      const empate = [
        { id: 'a', inicio: '2026-09-12T09:00:00-03:00' },
        { id: 'b', inicio: '2026-09-12T09:00:00-03:00' },
      ];
      expect(visiveisDaColuna(empate, 'CONCLUIDO', false).map((c) => c.id)).toEqual(['b', 'a']);
      expect(visiveisDaColuna([...empate].reverse(), 'CONCLUIDO', false).map((c) => c.id)).toEqual(['b', 'a']);
    });
  });
});

/**
 * O CALENDÁRIO — inutilizável no celular, que é onde o pedido diz para começar.
 */
describe('o calendário', () => {
  /**
   * Sete colunas em 360px dão 51px por célula: "09:00 Juntar documentos" cabia
   * em três letras. Os pontos preservam a leitura que importa nesse tamanho.
   */
  it('no celular mostra pontos, e o texto só a partir de sm', () => {
    expect(CALENDARIO).toContain('sm:hidden');
    expect(CALENDARIO).toContain('hidden space-y-1 sm:block');
    expect(CALENDARIO).toContain('min-h-[58px]');
    expect(CALENDARIO).toContain('sm:min-h-[92px]');
  });

  /** "+12 mais" era texto morto sobre o dia mais cheio do mês. */
  it('o "+N" anuncia que há uma saída', () => {
    expect(CALENDARIO).toContain('ver o dia');
  });

  /**
   * A legenda listava TODOS os tipos cadastrados, inclusive os ausentes do mês
   * — a pessoa procura o ponto roxo e não acha.
   */
  it('a legenda mostra só os tipos presentes', () => {
    expect(CALENDARIO).toContain('const tiposPresentes = [...new Set(compromissos.map((c) => c.tipo))]');
    expect(CALENDARIO).toContain('{tiposPresentes.length > 0 && (');
  });
});

/**
 * AS ETIQUETAS SUGERIDAS ERAM INVENTADAS.
 *
 * Seis fixas no código — "Urgente", "Acordo", "Aguardando Cliente"… — que
 * somam DUAS ocorrências entre os 83 processos etiquetados da produção. O
 * vocabulário real é outro: "CCT 2022/2024" (26), "INSALUBRIDADE" (14),
 * "RETALIAÇÃO" (12).
 */
describe('as etiquetas', () => {
  it('a lista fixa foi removida do código', () => {
    const LIB = ler('lib/processos.ts');
    expect(LIB).not.toContain("'Prioridade Idoso'");
    expect(LIB).toContain('A LISTA FIXA DE ETIQUETAS FOI REMOVIDA');
  });

  it('as sugestões vêm do acervo, por frequência', () => {
    expect(ETIQUETAS).toContain("queryKey: ['etiquetas-do-acervo'");
    expect(ETIQUETAS).toContain('etiquetasDoAcervo(parteExternaId)');
  });

  /**
   * DIGITAR FILTRA ANTES DE CRIAR — é aqui que a duplicata morre. Já convivem
   * "INSALUBRIDADE" e "READAPTAÇÃO + INSALUB.", e a segunda nunca vai ser
   * encontrada por quem filtra pela primeira.
   */
  it('filtra o que existe antes de oferecer criar', () => {
    expect(ETIQUETAS).toContain('normalizarTexto(e.etiqueta).includes(termo)');
    expect(ETIQUETAS).toContain('criar &quot;');
  });

  /** Texto livre continua: foi assim que "CCT 2024/2026" nasceu. */
  it('ainda deixa criar etiqueta nova', () => {
    expect(ETIQUETAS).toContain('onClick={() => adicionar(texto)}');
  });
});

/**
 * A BUSCA DO CADASTRO DE PROCESSO — teclado, e um campo em vez de dois.
 */
describe('a busca com autocomplete', () => {
  it('anda pelos resultados com o teclado', () => {
    expect(BUSCA).toContain("e.key === 'ArrowDown'");
    expect(BUSCA).toContain("e.key === 'ArrowUp'");
    expect(BUSCA).toContain("e.key === 'Enter'");
    expect(BUSCA).toContain("e.key === 'Escape'");
    expect(BUSCA).toContain("role=\"combobox\"");
  });

  /**
   * CANCELAMENTO POR GERAÇÃO: sem ele, a resposta de "sil" chega depois da de
   * "silva" e sobrescreve a lista com o resultado antigo.
   */
  it('descarta resposta de busca antiga', () => {
    expect(BUSCA).toContain('let atual = true;');
    expect(BUSCA).toContain('return () => { atual = false; clearTimeout(t); };');
  });

  /** "procurando", "nada encontrado" e "digite mais" eram a mesma lista vazia. */
  it('separa os três estados vazios', () => {
    expect(BUSCA).toContain('Digite pelo menos {minimo} letras.');
    expect(BUSCA).toContain('Procurando…');
    expect(BUSCA).toContain('Nada encontrado.');
  });

  /**
   * A parte contrária tinha DUAS caixas para uma decisão — e depois TRÊS
   * estados (lista, escolhido, digitado). Agora é um editor só, o mesmo dos
   * dois polos, e escolher já acrescenta.
   */
  it('o réu tem um campo só, e ele também cria texto livre', () => {
    expect(IMPORTAR).toContain('<EditorDePartes');
    expect(IMPORTAR).not.toContain('…ou digite o nome da parte contrária');
    expect(IMPORTAR).toContain('permitirTextoLivre');
    // O campo continua sendo o mesmo autocomplete — só mudou de dono.
    expect(EDITOR).toContain('<BuscaSelect');
    expect(EDITOR).toContain("acrescentar({ tipo: 'AVULSA', nome, detalhe: 'Sem cadastro' })");
  });
});
