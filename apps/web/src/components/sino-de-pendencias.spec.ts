import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { PENDENCIA, rotulo } from '@/lib/pendencias';

const RAIZ = path.resolve(__dirname, '..');
const SINO = readFileSync(path.join(RAIZ, 'components/sino-de-pendencias.tsx'), 'utf8');
const SERVICO = readFileSync(
  path.resolve(RAIZ, '../../api/src/modules/agenda/pendencias.service.ts'),
  'utf8',
);
const CONTROLLER = readFileSync(
  path.resolve(RAIZ, '../../api/src/modules/agenda/pendencias.controller.ts'),
  'utf8',
);

/**
 * O SINO MOSTRA ESTADO, NÃO EVENTO — e é essa diferença que impede o número de
 * inflar até virar decoração.
 *
 * Caixa de notificação guarda evento ("a tarefa foi criada"), acumula, precisa
 * de "marcar como lida" e repete o mesmo aviso em dias seguidos. Foi assim que
 * todo sistema que a equipe já usou ensinou a ignorar o sininho. Aqui, quando a
 * tarefa é concluída ela some sozinha, porque deixou de ser verdade.
 */
describe('o sino não pode virar caixa de notificações', () => {
  it('não existe tabela, marcação de leitura nem histórico', () => {
    for (const proibido of ['marcarComoLida', 'lidaEm', 'notificacao', 'Notificacao']) {
      expect(SERVICO).not.toContain(proibido);
      expect(SINO).not.toContain(proibido);
    }
  });

  /** O que sai da API é contagem do que está aberto AGORA. */
  it('a consulta só olha o que está em aberto', () => {
    expect(SERVICO).toContain(
      'status: { in: [StatusCompromisso.PENDENTE, StatusCompromisso.EM_ANDAMENTO] }',
    );
  });

  /**
   * ESCOPO SEMPRE PESSOAL. O sino responde uma pergunta só — "o que é MEU e
   * está me esperando?". Coordenador que queira a operação inteira tem o painel.
   */
  it('o escopo é o usuário do token, sem modo global', () => {
    expect(SERVICO).toContain('OR: [{ responsavelId: usuarioId }, { equipe: { some: { usuarioId } } }]');
    expect(CONTROLLER).toContain('minhas(@CurrentUser() user: AuthUser)');
    expect(CONTROLLER).toContain('this.pendencias.minhas(user.id)');
    // Nada de aceitar o id de outra pessoa pela query.
    expect(CONTROLLER).not.toContain('@Query');
  });

  /** Inclui o que a pessoa acompanha sem responder — mesma régua da agenda. */
  it('inclui o segundo advogado da atividade', () => {
    expect(SERVICO).toContain('{ equipe: { some: { usuarioId } } }');
  });
});

describe('ser incisivo sem ensinar a ignorar', () => {
  /**
   * SÓ O QUE JÁ VENCEU É VERMELHO. Pintar audiência da semana de vermelho
   * ensina a ignorar o vermelho — e aí o dia do prazo perdido de verdade passa
   * igual aos outros.
   */
  it('só prazo vencido e publicação sem dono são urgentes', () => {
    expect(PENDENCIA.ATRASADA.urgente).toBe(true);
    expect(PENDENCIA.PUBLICACAO_SEM_TAREFA.urgente).toBe(true);
    expect(PENDENCIA.HOJE.urgente).toBe(false);
    expect(PENDENCIA.AUDIENCIA.urgente).toBe(false);
  });

  it('a cor do contador segue a urgência, não o volume', () => {
    expect(SINO).toContain('const temUrgente = pendencias.some((p) => PENDENCIA[p.tipo].urgente);');
    expect(SINO).toContain("temUrgente ? 'bg-red-600' : 'bg-brand-700'");
  });

  it('sem nada aberto, o contador não aparece', () => {
    expect(SINO).toContain('{total > 0 && (');
  });
});

describe('o rótulo', () => {
  const p = (tipo: keyof typeof PENDENCIA, total: number) => ({ tipo, total, exemplos: [] });

  it('faz concordância', () => {
    expect(rotulo(p('ATRASADA', 1))).toBe('1 atividade com prazo vencido');
    expect(rotulo(p('ATRASADA', 3))).toBe('3 atividades com prazo vencido');
    expect(rotulo(p('AUDIENCIA', 1))).toBe('1 audiência nos próximos 7 dias');
  });

  it('fala de prazo e de audiência em português de escritório', () => {
    for (const chave of Object.keys(PENDENCIA) as (keyof typeof PENDENCIA)[]) {
      expect(PENDENCIA[chave].um).not.toMatch(/compromisso|entidade|registro/i);
    }
  });
});

describe('a gaveta', () => {
  /** Três exemplos bastam para reconhecer; o resto está na agenda. */
  it('mostra poucos exemplos e diz quantos faltam', () => {
    expect(SERVICO).toContain('const MAX_EXEMPLOS = 3;');
    expect(SINO).toContain('{p.total > p.exemplos.length && (');
  });

  it('fecha ao navegar, ao clicar fora e no Escape', () => {
    expect(SINO).toContain('useEffect(() => setAberto(false), [caminho]);');
    expect(SINO).toContain("document.addEventListener('mousedown', fora)");
    expect(SINO).toContain("e.key === 'Escape' && setAberto(false)");
  });

  /** Quem não tem agenda não tem o que ser lembrado — o sino nem consulta. */
  it('some para quem não tem o módulo de agenda', () => {
    expect(SINO).toContain("podeVer(user?.role, user?.permissoes, 'agenda')");
    expect(SINO).toContain('if (!permitido) return null;');
    expect(SINO).toContain('enabled: permitido,');
  });

  it('cabe na tela do celular', () => {
    expect(SINO).toContain('w-[min(22rem,calc(100vw-2rem))]');
  });
});

/**
 * A FAIXA — o sino não basta para prazo vencido.
 *
 * O sino convive com o dia normal e é fácil de não ver quando se entra no
 * sistema para fazer outra coisa. Prazo vencido não é dia normal.
 */
describe('a faixa de atraso', () => {
  const FAIXA = readFileSync(path.join(RAIZ, 'components/faixa-de-atraso.tsx'), 'utf8');

  /** Faixa que aparece todo dia é cabeçalho, e cabeçalho ninguém lê. */
  it('só aparece para o que já venceu', () => {
    expect(FAIXA).toContain('.filter((p) => PENDENCIA[p.tipo].urgente)');
    expect(FAIXA).toContain('if (!urgentes.length) return null;');
  });

  /**
   * SEM BOTÃO DE FECHAR. Ela não some por ser dispensada — some quando o
   * trabalho é feito. Fechar ensinaria que dá para calar o aviso sem resolver.
   */
  it('não pode ser dispensada', () => {
    for (const proibido of ['dispensar', 'setFechada', 'onClose', 'localStorage']) {
      expect(FAIXA).not.toContain(proibido);
    }
  });

  /** Mesma chave do sino: os dois se servem de uma requisição só. */
  it('reaproveita a consulta do sino', () => {
    expect(FAIXA).toContain("queryKey: ['minhas-pendencias']");
  });

  it('fica fora da área que rola', () => {
    const SHELL = readFileSync(path.join(RAIZ, 'components/dashboard-shell.tsx'), 'utf8');
    // `<main className=` e não `<main`: o próprio comentário do arquivo cita
    // "<main>" ao explicar a decisão, e a busca crua casaria com ele.
    expect(SHELL.indexOf('<FaixaDeAtraso />')).toBeLessThan(SHELL.indexOf('<main className='));
  });
});
