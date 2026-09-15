import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  STATUS_COR,
  celulaDoDiaBR,
  contagemDoGrupoParaTras,
  doDiaDeTeresina,
  quantasNoRecorte,
  rotuloDoMes,
  totalDoGrupoParaTras,
  visaoDaAgenda,
  ymdDoCalendario,
} from '@/lib/agenda';
import { CLASSE_ACAO_PRIMARIA } from './compromisso-card';

const ler = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

/** Só o código: comentário em português bate em qualquer negativa. */
const semComentarios = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\}/g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const PAGINA = semComentarios(ler('app/(dashboard)/agenda/page.tsx'));
const CARTAO = semComentarios(ler('components/agenda/compromisso-card.tsx'));
const CALENDARIO = semComentarios(ler('components/agenda/calendario-view.tsx'));

/**
 * TODAS NO COMPUTADOR VAI PARA A LISTA (decisão de 15/09/2026). "Carregar mais"
 * e Próximas/Anteriores só existem na lista; o computador abria Todas no quadro,
 * crescente e com teto de 500, e o pedido do dono não chegava a quem usa o
 * computador.
 */
describe('visaoDaAgenda', () => {
  const base = { escolhida: null, telaLarga: true, aba: 'hoje' as const, quadroNaSessao: false };

  it('sem escolha, a largura decide: quadro no computador, lista no celular', () => {
    expect(visaoDaAgenda(base)).toBe('quadro');
    expect(visaoDaAgenda({ ...base, telaLarga: false })).toBe('lista');
  });

  it('tocar em Todas no computador passa para a lista, mesmo com o Quadro guardado de outro dia', () => {
    expect(visaoDaAgenda({ ...base, aba: 'todos' })).toBe('lista');
    expect(visaoDaAgenda({ ...base, aba: 'todos', escolhida: 'quadro' })).toBe('lista');
  });

  it('quem tocou em Quadro nesta sessão fica com o quadro em Todas', () => {
    expect(visaoDaAgenda({ ...base, aba: 'todos', escolhida: 'quadro', quadroNaSessao: true })).toBe('quadro');
  });

  it('fora de Todas, a escolha guardada vale', () => {
    expect(visaoDaAgenda({ ...base, aba: '7dias', escolhida: 'lista' })).toBe('lista');
    expect(visaoDaAgenda({ ...base, aba: 'aberto', telaLarga: false, escolhida: 'quadro' })).toBe('quadro');
  });
});

/**
 * O DIA ESCOLHIDO É O DE TERESINA (15/09/2026). O filtro usava `getDate()` do
 * aparelho e os grupos usavam Teresina: a consulta das 23h30 de segunda (02h30
 * UTC de terça) caía na terça num notebook em UTC e na segunda no grupo.
 */
describe('o dia do calendário', () => {
  const consultaDaNoite = { id: 'n', inicio: '2026-09-15T02:30:00Z' };
  const audienciaDeTerca = { id: 't', inicio: '2026-09-15T09:00:00-03:00' };

  it('23h30 de Teresina, já terça em UTC, é da segunda', () => {
    expect(doDiaDeTeresina([consultaDaNoite, audienciaDeTerca], '2026-09-14').map((c) => c.id)).toEqual(['n']);
    expect(doDiaDeTeresina([consultaDaNoite, audienciaDeTerca], '2026-09-15').map((c) => c.id)).toEqual(['t']);
  });

  it('a célula do calendário é o texto do dia local que a pessoa tocou', () => {
    expect(ymdDoCalendario(new Date(2026, 8, 14))).toBe('2026-09-14');
    expect(ymdDoCalendario(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('o atalho de fora leva à célula do dia de Teresina, e a célula volta ao mesmo texto', () => {
    const celula = celulaDoDiaBR(consultaDaNoite.inicio);
    expect([celula.getFullYear(), celula.getMonth(), celula.getDate()]).toEqual([2026, 8, 14]);
    expect(ymdDoCalendario(celula)).toBe('2026-09-14');
  });
});

/** V4 da captura de 14/09/2026: o cabeçalho saía "Setembro De 2026". */
describe('rotuloDoMes', () => {
  it('só a primeira letra sobe', () => {
    expect(rotuloDoMes(new Date(2026, 8, 1))).toBe('Setembro de 2026');
    expect(rotuloDoMes(new Date(2027, 2, 15))).toBe('Março de 2027');
  });

  it('o calendário usa a função e não a classe que subia toda palavra', () => {
    expect(CALENDARIO).toContain('{rotuloDoMes(mes)}');
    expect(CALENDARIO).not.toContain('capitalize');
  });
});

/**
 * OS NÚMEROS DE TODAS CONTAM O RECORTE (15/09/2026). Com página de 50, o grupo
 * âmbar dizia 50 com 60 na aba, e a linha de filtros e o botão do celular
 * diziam 50 com 120 na janela.
 */
describe('as contagens de Todas', () => {
  it('Próximas com mais páginas: "50 de 60" no grupo âmbar', () => {
    const total = totalDoGrupoParaTras({ listaDeTodas: true, janelaDosDados: 'adiante', temProxima: true, atrasadas: 60 });
    expect(total).toBe(60);
    expect(contagemDoGrupoParaTras(50, total)).toBe('50 de 60');
  });

  it('tudo carregado, outra aba ou Anteriores: o número do grupo é o que está na tela', () => {
    expect(totalDoGrupoParaTras({ listaDeTodas: true, janelaDosDados: 'adiante', temProxima: false, atrasadas: 60 })).toBeUndefined();
    expect(totalDoGrupoParaTras({ listaDeTodas: false, janelaDosDados: 'adiante', temProxima: true, atrasadas: 60 })).toBeUndefined();
    expect(totalDoGrupoParaTras({ listaDeTodas: true, janelaDosDados: 'anteriores', temProxima: true, atrasadas: 60 })).toBeUndefined();
    expect(contagemDoGrupoParaTras(12)).toBe('12');
    // A contagem veio antes de uma atividade nova: nunca "13 de 12".
    expect(contagemDoGrupoParaTras(13, 12)).toBe('13');
  });

  it('a linha de filtros conta a janela inteira em Todas, e o que está na tela fora dela', () => {
    expect(quantasNoRecorte({ listaDeTodas: true, carregadas: 50, totalDaJanela: 120 })).toBe(120);
    expect(quantasNoRecorte({ listaDeTodas: true, carregadas: 50 })).toBe(50);
    expect(quantasNoRecorte({ listaDeTodas: false, carregadas: 7, totalDaJanela: 120 })).toBe(7);
    expect(quantasNoRecorte({ listaDeTodas: true, carregadas: 51, totalDaJanela: 50 })).toBe(51);
  });
});

/** Cancelada é um fim escolhido pela equipe, não um erro: nada de vermelho nem riscado. */
describe('atividade cancelada', () => {
  it('o selo de status é neutro e sem riscado', () => {
    expect(STATUS_COR.CANCELADO).not.toMatch(/line-through|red|rose/);
  });

  it('o motivo no cartão não tem fundo vermelho', () => {
    const bloco = CARTAO.slice(CARTAO.indexOf("c.status === 'CANCELADO' && (c.canceladoCategoria"));
    expect(bloco.slice(0, 200)).toContain('bg-muted');
    expect(bloco.slice(0, 200)).not.toMatch(/red-|rose-/);
  });
});

describe('o cartão na lista', () => {
  /** V2: no computador "Concluir" ocupava ~1.000 px da linha. */
  it('Concluir ocupa a linha só no celular', () => {
    const classes = CLASSE_ACAO_PRIMARIA.split(/\s+/);
    expect(classes).toContain('flex-1');
    expect(classes).toContain('sm:flex-none');
  });

  /** A coluna da hora recuava o cartão inteiro: ~64 px vazios na altura toda. */
  it('a hora é prefixo da linha do tipo, sem recuo no cartão', () => {
    expect(CARTAO).not.toContain('pl-[4.75rem]');
    expect(CARTAO).toContain('{horaBRDe(c.inicio)}');
  });
});

describe('a página da agenda', () => {
  /** Defeito 4 da auditoria do atendimento: a gaveta aberta pela agenda perdia "Registrar desfecho". */
  it('a gaveta do atendimento recebe o registro do desfecho, e o modal está montado', () => {
    const gaveta = PAGINA.slice(PAGINA.indexOf('<AtendimentoDrawer'));
    expect(gaveta.slice(0, gaveta.indexOf('/>'))).toContain('onRegistrarDesfecho={(a) =>');
    expect(PAGINA).toContain('<RegistrarDesfechoModal');
    expect(PAGINA).toContain('atendimento={desfechoAlvo}');
  });

  /** Concluir a consulta fecha o atendimento (E1): a lista e a gaveta dele têm de atualizar. */
  it('concluir, reabrir, cancelar e remarcar invalidam as chaves do atendimento', () => {
    const invalidar = PAGINA.slice(PAGINA.indexOf('const invalidar = () => {'));
    const corpo = invalidar.slice(0, invalidar.indexOf('};'));
    expect(corpo).toContain("['atendimentos']");
    expect(corpo).toContain("['atendimento']");

    const concluido = PAGINA.slice(PAGINA.indexOf('onConcluido={(caso) => {'));
    expect(concluido.slice(0, 300)).toContain("for (const k of [['atendimentos'], ['atendimento']])");
  });

  it('as preferências são lidas antes do primeiro desenho, e não num efeito', () => {
    expect(PAGINA).toContain('useSyncExternalStore(');
    expect(PAGINA).not.toContain('localStorage.getItem(CHAVE_VISAO)');
  });

  it('Quadro | Lista com 32 px no computador, e a faixa âmbar com o relógio', () => {
    expect(PAGINA).toContain('sm:min-h-8');
    expect(PAGINA).not.toContain('sm:min-h-7');
    expect(PAGINA).not.toContain('AlertTriangle');
  });

  it('a lista e o quadro surgem quando a primeira carga termina', () => {
    expect(PAGINA.match(/className="animate-surgir"/g)).toHaveLength(2);
  });
});
