import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalendarClock, Gavel, Newspaper, Users } from 'lucide-react';
import {
  PENDENCIA,
  avisoDaFaixa,
  avisosDaFaixa,
  destinoCerto,
  frasePlena,
  ondeAconteceu,
  rotulo,
  type MinhasPendencias,
  type Pendencia,
} from '@/lib/pendencias';

/**
 * A FAIXA DE AVISOS, REDESENHADA — 18/09/2026.
 *
 * "E essa barra amarela que aparece em cima, na tela? Me pareceu grosseira e
 * amadora." Estava, e a impressão tinha causa: entre 1024px e ~1500px a tira
 * CORTAVA avisos inteiros em silêncio, a pastilha que salvaria o celular só
 * existia no celular (onde o corte não acontecia), ela levava a um painel que
 * não tem o aviso prometido, e o ícone era o do primeiro grupo para a faixa
 * toda — ou seja, sempre o mesmo.
 *
 * ESTE ARQUIVO RENDERIZA O COMPONENTE DE VERDADE. `toContain` no fonte prova que
 * a linha existe, não que ela acerta: a faixa antiga passava em todos os testes
 * que tinha enquanto apagava texto na tela de quem usa um notebook de 1366px.
 */

// ── a resposta da API, trocada por teste ───────────────────────────────────────
const mockResposta: { atual: MinhasPendencias | undefined } = { atual: undefined };

jest.mock('next/link', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const { children, ...resto } = props as { children?: unknown };
    return require('react').createElement('a', resto, children);
  },
}));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mockResposta.atual }) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { role: 'ADVOGADO', permissoes: null } }) }));
jest.mock('@/lib/permissoes', () => ({ podeVer: () => true }));

// eslint-disable-next-line import/first
import { FaixaDeAtraso, ListaDeAvisos } from './faixa-de-atraso';

/**
 * DESENHA A FAIXA COMO ELA CHEGA NA TELA: um aviso e a pastilha do resto.
 *
 * Desde 18/09/2026 ela mostra só o primeiro — três grupos viravam uma parede de
 * 108px FIXA no alto de toda tela. O resto abre no lugar, e o estado aberto não
 * existe num render de servidor: quem prova o conteúdo dos quatro é
 * `desenharTodos`, que chama a lista direto.
 */
function desenhar(pendencias: Pendencia[]): string {
  mockResposta.atual = { pendencias, total: pendencias.reduce((s, p) => s + p.total, 0) };
  return renderToStaticMarkup(createElement(FaixaDeAtraso));
}

/** A lista com TODOS os avisos — é o que a pastilha revela. */
function desenharTodos(pendencias: Pendencia[]): string {
  return renderToStaticMarkup(
    createElement(ListaDeAvisos, { avisos: avisosDaFaixa(pendencias) }),
  );
}

// ── leitura do que foi desenhado ──────────────────────────────────────────────
interface LinkDesenhado {
  href: string;
  title: string;
  texto: string;
  /** O nome do ícone da linha, como o lucide o carimba: "calendar-clock". */
  icone: string | null;
  /** Classes do próprio <a>. */
  classe: string;
  /** Os `class` de tudo que está dentro dele. */
  classesDentro: string[];
}

const atributo = (tag: string, nome: string) =>
  (new RegExp(`${nome}="([^"]*)"`).exec(tag)?.[1] ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');

/** Toda tag aberta no desenho, com os seus atributos crus. */
const tags = (html: string) =>
  [...html.matchAll(/<([a-z]+)\b([^>]*)>/g)].map(([, nome, attrs]) => ({ nome, attrs }));

/** A tag desaparece em alguma largura? (`hidden`, `sm:hidden`, `lg:hidden`…) */
const someEmAlgumaLargura = (attrs: string) =>
  atributo(attrs, 'class')
    .split(/\s+/)
    .some((c) => c === 'hidden' || /:hidden$/.test(c));

const semTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function linksDesenhados(html: string): LinkDesenhado[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, dentro]) => ({
    href: atributo(attrs, 'href'),
    /*
      O `title` mora num <span> DENTRO do link, e não no próprio link: no link
      ele viraria a descrição acessível e o leitor de tela diria a mesma frase
      duas vezes. Aqui procuramos onde ele estiver.
    */
    title: atributo(attrs, 'title') || atributo(dentro, 'title'),
    texto: semTags(dentro),
    icone: /lucide-([a-z0-9-]+)/.exec(dentro)?.[1] ?? null,
    classe: atributo(attrs, 'class'),
    classesDentro: [...dentro.matchAll(/class="([^"]*)"/g)].map((m) => m[1]),
  }));
}

/** O nome com que o lucide carimba um ícone — lido dele, não escrito à mão. */
const nomeDoIcone = (I: ComponentType<{ className?: string }>) =>
  /lucide-([a-z0-9-]+)/.exec(renderToStaticMarkup(createElement(I)))?.[1] ?? '';

// ── fixtures com a cara do que a API manda ────────────────────────────────────
const atrasada = (total: number): Pendencia => ({
  tipo: 'ATRASADA',
  total,
  exemplos: [
    { id: 'c1', titulo: 'Elaborar manifestação', quando: '2026-09-14T12:00:00.000Z', href: '/agenda?compromisso=c1' },
  ],
});

const daEquipe = (total: number, detalhe = 'de Dr. Tiago · ficou para trás'): Pendencia => ({
  tipo: 'PRECISA_DA_EQUIPE',
  total,
  exemplos: [
    { id: 'c2', titulo: 'Juntar documentos', quando: '2026-09-15T12:00:00.000Z', href: '/agenda?compromisso=c2', detalhe },
  ],
});

const semTarefa = (total: number, titulo = '00013819120235220101', href = '/processos?processo=p9'): Pendencia => ({
  tipo: 'PUBLICACAO_SEM_TAREFA',
  total,
  exemplos: [{ id: 'd1', titulo, quando: '2026-09-16T12:00:00.000Z', href }],
});

const ato = (total: number, detalhe?: string, titulo = '00013819120235220101'): Pendencia => ({
  tipo: 'ATO_ESPERANDO_OLHO',
  total,
  exemplos: [
    { id: 'm1', titulo, quando: '2026-09-10T12:00:00.000Z', href: '/processos?processo=p1&andamento=m1', detalhe },
  ],
});

const OS_QUATRO = [atrasada(1), daEquipe(1), semTarefa(1), ato(1, 'Recurso negado')];

/* ═══════════════════════════════════════════════════════════════════════════ */

describe('nada some por largura', () => {
  /**
   * O DEFEITO: os avisos 2..N eram `shrink-0` sem `truncate` e sem `min-w-0`,
   * numa linha `flex` sem `flex-wrap`, dentro de um contêiner que corta o que
   * transborda. Entre 1024px e ~1500px o texto do segundo aviso em diante sumia
   * INTEIRO — sem reticências, sem rolagem e sem nada que dissesse que havia mais.
   */
  it('os quatro avisos são desenhados, cada um com a sua frase inteira', () => {
    const links = linksDesenhados(desenharTodos(OS_QUATRO));
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.texto)).toEqual([
      '“Elaborar manifestação” ficou para trás',
      '“Juntar documentos” está sem ninguém cuidando · de Dr. Tiago · ficou para trás',
      'Publicação sua sem tarefa aberta · processo 0001381-91.2023.5.22.0101',
      'Recurso negado · processo 0001381-91.2023.5.22.0101',
    ]);
  });

  /**
   * A REGRA, e não o caso: o que desaparece numa largura não pode carregar
   * informação. Sobra o separador "·", que é enfeite e se declara `aria-hidden`.
   */
  it('o que some numa largura é sempre decorativo', () => {
    // A trava morde (um detector errado passaria verde para sempre)…
    expect(someEmAlgumaLargura(' class="hidden sm:inline"')).toBe(true);
    expect(someEmAlgumaLargura(' class="shrink-0 lg:hidden"')).toBe(true);
    expect(someEmAlgumaLargura(' class="truncate overflow-hidden"')).toBe(false);

    const escondidos = tags(desenharTodos(OS_QUATRO)).filter((t) => someEmAlgumaLargura(t.attrs));
    expect(escondidos.length).toBeGreaterThan(0); // o separador existe…
    for (const t of escondidos) expect(t.attrs).toContain('aria-hidden'); // …e é só ele.
  });

  /** A pastilha "+N" era `lg:hidden` — existia exatamente onde o corte NÃO acontecia. */
  it('não há atalho que esconda avisos atrás de um número', () => {
    const html = desenharTodos(OS_QUATRO);
    expect(html).not.toMatch(/>\s*\+\d+\s*</);
    expect(html).not.toContain('lg:hidden');
  });

  /**
   * O QUE AINDA PODE NÃO CABER TEM SAÍDA: duas linhas no telefone, uma linha com
   * reticências no computador (`line-clamp`), e a frase inteira no `title`.
   * Cortar é aceitável; cortar sem deixar rastro não é.
   *
   * Medido no Chrome com o desenho real a 400/768/1280/1366/1440px: nenhuma
   * linha transborda e, a 400px, nenhuma das frases desta suíte chega a ser
   * cortada. Aqui fica a trava do que o jest alcança.
   */
  it('todo aviso leva a frase inteira no title, e o texto que corta tem reticências', () => {
    const html = desenharTodos(OS_QUATRO);
    /*
      E o `title` NÃO está no <a>: ali ele vira a descrição acessível e o leitor
      de tela diria a mesma frase duas vezes, na barra de toda tela.
    */
    for (const t of tags(html).filter((t) => t.nome === 'a')) {
      expect(t.attrs).not.toContain('title=');
    }
    for (const l of linksDesenhados(html)) {
      expect(l.title).toBe(l.texto.replace(' · ', ' — '));
      const comTexto = l.classesDentro.filter((c) => c.includes('line-clamp-'));
      expect(comTexto.length).toBeGreaterThan(0);
      for (const c of comTexto) {
        // Duas linhas no telefone, uma no computador — e encolhe dentro do flex.
        expect(c).toContain('line-clamp-2');
        expect(c).toContain('sm:line-clamp-1');
        expect(c).toContain('min-w-0');
      }
    }
  });
});

describe('cada aviso leva ao seu lugar', () => {
  /**
   * O DEFEITO: a pastilha "+N" mandava tudo para `/dashboard`, prometendo no
   * painel avisos que o painel não tem — o ato do tribunal só existe na ficha do
   * processo. Hoje não há link que não seja o de um aviso.
   */
  it('não existe link além dos próprios avisos', () => {
    const avisos = avisosDaFaixa(OS_QUATRO);
    const links = linksDesenhados(desenharTodos(OS_QUATRO));
    expect(links.map((l) => l.href)).toEqual(avisos.map((a) => a.href));
    expect(links.map((l) => l.href)).toEqual([
      '/agenda?compromisso=c1',
      '/agenda?compromisso=c2',
      '/processos?processo=p9',
      '/processos?processo=p1&andamento=m1',
    ]);
  });

  it('vários do mesmo grupo levam à lista daquele grupo, nunca a um painel só', () => {
    const links = linksDesenhados(desenharTodos([atrasada(5), daEquipe(2), semTarefa(3), ato(7, 'Recurso negado')]));
    expect(links.map((l) => l.href)).toEqual(['/agenda', '/dashboard', '/publicacoes', '/processos']);
  });
});

describe('o ícone é o da linha, não o do primeiro grupo', () => {
  /**
   * O DEFEITO: `ICONE[pendencias[0].tipo]` desenhava um ícone só, no primeiro
   * link; os demais iam sem nenhum. Como o serviço começa sempre por ATRASADA,
   * na prática era sempre o mesmo, e as quatro naturezas viravam uma só.
   */
  it('cada natureza tem o seu, na sua própria linha', () => {
    const links = linksDesenhados(desenharTodos(OS_QUATRO));
    expect(links.map((l) => l.icone)).toEqual([
      nomeDoIcone(CalendarClock),
      nomeDoIcone(Users),
      nomeDoIcone(Newspaper),
      nomeDoIcone(Gavel),
    ]);
    expect(new Set(links.map((l) => l.icone)).size).toBe(4);
  });

  it('e não depende da ordem em que os grupos chegam', () => {
    const links = linksDesenhados(desenharTodos([ato(1, 'Recurso negado'), atrasada(1)]));
    expect(links.map((l) => l.icone)).toEqual([nomeDoIcone(Gavel), nomeDoIcone(CalendarClock)]);
  });
});

describe('a faixa fala sozinha', () => {
  /**
   * A consulta se repete a cada 60s. Um aviso que nascia com a pessoa na tela
   * aparecia mudo: não havia `role="status"`. E a região precisa JÁ ESTAR no DOM
   * quando o aviso entra — leitor de tela não anuncia região recém-nascida.
   */
  it('a região existe mesmo sem aviso nenhum, e sem desenhar nada', () => {
    const html = desenhar([]);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="sr-only"');
    expect(semTags(html)).toBe('');
    expect(html).not.toContain('<a');
  });

  it('e continua sendo a mesma região quando o aviso chega', () => {
    const html = desenhar([atrasada(1)]);
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('<a'));
    expect(html).toContain('aria-live="polite"');
  });
});

describe('a cor não acusa ninguém', () => {
  /** Âmbar pede você. Vermelho é só do Excluir — e o atraso do colega não é crime. */
  it('é âmbar, nunca vermelho', () => {
    // O fundo mora na faixa; as linhas moram na lista. Os dois entram na conta.
    expect(desenhar(OS_QUATRO)).toContain('bg-amber-50');
    const html = desenharTodos(OS_QUATRO);
    expect(html).not.toMatch(/\b(?:bg|text|border)-(?:red|rose)-\d/);
  });

  /** Ela some quando o trabalho é feito — calar sem resolver não é opção. */
  it('não tem botão de fechar', () => {
    const html = desenharTodos(OS_QUATRO);
    expect(html).not.toContain('<button');
    expect(html).not.toMatch(/dispensar|fechar aviso/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */

describe('a frase de cada aviso', () => {
  it('uma atividade sua diz qual é, e leva a ela', () => {
    expect(avisoDaFaixa(atrasada(1))).toEqual({
      chave: 'ATRASADA',
      tipo: 'ATRASADA',
      texto: '“Elaborar manifestação” ficou para trás',
      href: '/agenda?compromisso=c1',
    });
  });

  /**
   * A FRASE TORTA: o detalhe da API já é uma legenda ("de Dr. Tiago · ficou para
   * trás"), e emendá-lo com um travessão dava «"Elaborar manifestação" precisa
   * de alguém da equipe — de Dr. Tiago · ficou para trás». Agora são duas
   * partes, e cada uma é lida como foi escrita.
   */
  it('a da equipe separa a coisa do porquê', () => {
    expect(avisoDaFaixa(daEquipe(1))).toEqual({
      chave: 'PRECISA_DA_EQUIPE',
      tipo: 'PRECISA_DA_EQUIPE',
      texto: '“Juntar documentos” está sem ninguém cuidando',
      complemento: 'de Dr. Tiago · ficou para trás',
      href: '/agenda?compromisso=c2',
    });
    expect(frasePlena(avisoDaFaixa(daEquipe(1)))).toBe(
      '“Juntar documentos” está sem ninguém cuidando — de Dr. Tiago · ficou para trás',
    );
  });

  it('a ausência do colega também cabe no complemento', () => {
    expect(avisoDaFaixa(daEquipe(1, 'Dr. Carlos Henrique está sem entrar há 39 dias')).complemento).toBe(
      'Dr. Carlos Henrique está sem entrar há 39 dias',
    );
  });

  /**
   * UMA PUBLICAÇÃO SÓ DIZIA "1 publicação sua sem tarefa aberta" — número sem
   * destino, que é exatamente o que a regra da casa proíbe: obriga a procurar.
   */
  it('uma publicação só diz em que processo caiu', () => {
    expect(avisoDaFaixa(semTarefa(1))).toEqual({
      chave: 'PUBLICACAO_SEM_TAREFA',
      tipo: 'PUBLICACAO_SEM_TAREFA',
      texto: 'Publicação sua sem tarefa aberta',
      complemento: 'processo 0001381-91.2023.5.22.0101',
      href: '/processos?processo=p9',
    });
  });

  it('um ato só diz qual ato, com o número legível', () => {
    expect(avisoDaFaixa(ato(1, 'Recurso negado'))).toEqual({
      chave: 'ATO_ESPERANDO_OLHO',
      tipo: 'ATO_ESPERANDO_OLHO',
      texto: 'Recurso negado',
      complemento: 'processo 0001381-91.2023.5.22.0101',
      href: '/processos?processo=p1&andamento=m1',
    });
  });

  /** Sem o rótulo do ato, cai na contagem — nunca numa frase pela metade. */
  it('sem o nome do ato, não inventa frase', () => {
    expect(avisoDaFaixa(ato(1)).texto).toBe('1 ato do tribunal está sem ninguém decidir');
  });

  it('vários viram contagem, em português de gente', () => {
    expect(rotulo(atrasada(3))).toBe('3 atividades suas ficaram para trás');
    expect(rotulo(ato(1))).toBe('1 ato do tribunal está sem ninguém decidir');
    expect(rotulo(semTarefa(12))).toBe('12 publicações suas sem tarefa aberta');
  });

  /**
   * O SINGULAR DE CADA GRUPO É A QUEDA DA JANELA DE TROCA: uma API de antes — ou
   * um grupo que voltou com `total` e sem `exemplos` — ainda tem de virar uma
   * frase certa. Era código morto enquanto só dois tipos tinham nome próprio.
   */
  it('grupo de um sem exemplo nenhum ainda diz uma frase certa, e leva à lista', () => {
    const esperado: Record<string, [string, string]> = {
      ATRASADA: ['1 atividade sua ficou para trás', '/agenda'],
      PRECISA_DA_EQUIPE: ['1 atividade da sua equipe está sem ninguém cuidando', '/dashboard'],
      PUBLICACAO_SEM_TAREFA: ['1 publicação sua sem tarefa aberta', '/publicacoes'],
      ATO_ESPERANDO_OLHO: ['1 ato do tribunal está sem ninguém decidir', '/processos'],
    };
    for (const tipo of Object.keys(PENDENCIA) as (keyof typeof PENDENCIA)[]) {
      const a = avisoDaFaixa({ tipo, total: 1, exemplos: [] });
      expect([a.texto, a.href]).toEqual(esperado[tipo]);
    }
  });
});

describe('a frase nunca termina no nada', () => {
  /**
   * O DEFEITO: o ato de um processo sem `numeroCNJ` (pré-processual ou rascunho)
   * chega com o título 'Processo'; `mascararNPU` de um texto sem dígitos devolve
   * vazio, e a faixa escrevia "Recurso negado no processo " — assim, terminando
   * no nada, no cabeçalho de todas as telas.
   */
  it('o processo sem número é dito, não engolido', () => {
    const a = avisoDaFaixa(ato(1, 'Recurso negado', 'Processo'));
    expect(a.texto).toBe('Recurso negado');
    expect(a.complemento).toBe('processo ainda sem número');
    expect(frasePlena(a)).toBe('Recurso negado — processo ainda sem número');
  });

  it('a publicação sem processo casado também', () => {
    expect(avisoDaFaixa(semTarefa(1, 'Publicação')).complemento).toBe('processo ainda sem número');
  });

  it('e na tela a frase não fica pendurada numa preposição', () => {
    const texto = linksDesenhados(desenhar([ato(1, 'Recurso negado', 'Processo')]))[0].texto;
    expect(texto).toBe('Recurso negado · processo ainda sem número');
  });

  it('ondeAconteceu formata o número cru e nomeia a falta dele', () => {
    expect(ondeAconteceu('00013819120235220101')).toBe('processo 0001381-91.2023.5.22.0101');
    expect(ondeAconteceu('')).toBe('processo ainda sem número');
    expect(ondeAconteceu('Processo')).toBe('processo ainda sem número');
  });
});

describe('link com parâmetro vazio não é destino', () => {
  /**
   * `/processos?processo=` abre a tela e não abre nada — pior que não ser
   * clicável, porque a pessoa acha que já olhou. Cai na lista do grupo.
   */
  it('cai na lista do grupo', () => {
    expect(destinoCerto('/processos?processo=', '/publicacoes')).toBe('/publicacoes');
    expect(destinoCerto('/processos?processo=p1&andamento=', '/processos')).toBe('/processos');
    expect(destinoCerto(undefined, '/agenda')).toBe('/agenda');
  });

  it('e não atrapalha o link bom', () => {
    expect(destinoCerto('/agenda?compromisso=c1', '/agenda')).toBe('/agenda?compromisso=c1');
    expect(destinoCerto('/processos?processo=p1&andamento=m1', '/processos')).toBe(
      '/processos?processo=p1&andamento=m1',
    );
    expect(destinoCerto('/publicacoes', '/publicacoes')).toBe('/publicacoes');
  });

  it('a faixa usa a regra: a publicação órfã leva à fila, não a lugar nenhum', () => {
    const links = linksDesenhados(desenhar([semTarefa(1, 'Publicação', '/processos?processo=')]));
    expect(links[0].href).toBe('/publicacoes');
  });
});

describe('grupo vazio não vira linha', () => {
  it('total zero não desenha nada', () => {
    expect(avisosDaFaixa([{ tipo: 'ATRASADA', total: 0, exemplos: [] }])).toEqual([]);
    expect(linksDesenhados(desenhar([{ tipo: 'ATRASADA', total: 0, exemplos: [] }]))).toHaveLength(0);
  });

  it('tipo que a tela não conhece não derruba o cabeçalho de todas as páginas', () => {
    const lista = [
      atrasada(1),
      { tipo: 'AINDA_NAO_EXISTE', total: 9, exemplos: [] },
    ] as unknown as Pendencia[];
    expect(avisosDaFaixa(lista).map((a) => a.tipo)).toEqual(['ATRASADA']);
    expect(linksDesenhados(desenhar(lista))).toHaveLength(1);
  });
});

/**
 * A FAIXA MOSTRA UM AVISO, E O RESTO ABRE NO LUGAR — 18/09/2026.
 *
 * "Essas barras amarelas são muito feias. (Além de serem fixas e ocuparem muito
 * espaço)" — o dono. Com três grupos ela virava uma parede de 108px FIXA no
 * alto de TODA tela, antes de qualquer conteúdo. Empilhar tinha resolvido o
 * corte silencioso e criado isto.
 *
 * A pastilha NÃO é um link: a "+N" que existiu antes mandava para /dashboard
 * prometendo avisos que o painel não tem. Esta abre a lista que já está aqui.
 */
describe('a faixa não vira parede', () => {
  it('com quatro avisos, desenha UM e diz quantos faltam', () => {
    const html = desenhar(OS_QUATRO);
    expect(linksDesenhados(html)).toHaveLength(1);
    expect(html).toContain('e mais 3 avisos');
  });

  it('com um aviso só, não há pastilha nenhuma', () => {
    const html = desenhar([atrasada(1)]);
    expect(linksDesenhados(html)).toHaveLength(1);
    expect(html).not.toContain('e mais');
    expect(html).not.toContain('mostrar menos');
  });

  it('o singular existe', () => {
    expect(desenhar([atrasada(1), daEquipe(2)])).toContain('e mais 1 aviso');
  });

  /** Abrir é um botão, não um link — e nenhum link novo aparece por causa dele. */
  it('a pastilha não leva a lugar nenhum', () => {
    const html = desenhar(OS_QUATRO);
    expect(html).toContain('<button');
    expect(linksDesenhados(html).map((l) => l.href)).toEqual(['/agenda?compromisso=c1']);
  });

  /** O primeiro é o que o serviço pôs em primeiro: a ordem é dele, não da tela. */
  it('o que aparece é o primeiro da lista, sem reordenar', () => {
    const html = desenhar([ato(1, 'Recurso negado'), atrasada(1)]);
    expect(linksDesenhados(html)[0].texto).toContain('Recurso negado');
  });
});
