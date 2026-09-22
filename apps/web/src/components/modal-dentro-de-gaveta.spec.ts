import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

/** `src/components` — a varredura fica nos componentes, que é onde moram as gavetas. */
const RAIZ = __dirname;

/**
 * MODAL ABERTO DE DENTRO DE UMA GAVETA PRECISA SAIR DELA — 22/09/2026.
 *
 * O DEFEITO, medido na tela: o modal "Recadastrar filiado" tem `max-w-3xl`
 * (768px) e aparecia com **512px, em x=928, numa janela de 1440** — encostado
 * na direita, três colunas de campos espremidas em ~150px cada, rótulos
 * quebrando em duas linhas e o valor do select cortado. Parecia design ruim e
 * não era.
 *
 * A REGRA DE CSS: um elemento com `transform`, `filter`, `perspective`,
 * `backdrop-filter` ou `will-change` vira o **bloco de contenção** dos
 * descendentes `position: fixed` — que deixam de medir a janela e passam a
 * medir ele. O `Sheet` deste projeto anima com `transition-transform` e
 * `translate-x-0`, o que rende `transform: matrix(1, 0, 0, 1, 0, 0)`:
 * identidade, não move nada, e mesmo assim cria o bloco de contenção.
 *
 * Nenhuma classe de largura conserta: `max-w-3xl` é teto, e o piso já era 512.
 * O que conserta é o diálogo não ser filho da gaveta no DOM — `<Portal>`.
 *
 * ESTE TESTE EXISTE PORQUE O CONHECIMENTO JÁ ESTAVA NO CÓDIGO E NÃO SE ESPALHOU:
 * `visor-de-imagens.tsx` já usava `createPortal` e já explicava exatamente este
 * motivo no comentário, desde antes. Seis outros diálogos abriam dentro de
 * gaveta sem portal, e um deles era o `ConfirmDialog`, que meia aplicação usa.
 * Comentário não impede repetição; teste impede.
 *
 * A LISTA É DERIVADA, NÃO ESCRITA À MÃO. Ele varre os componentes que uma
 * gaveta renderiza e cobra o portal de cada um que tenha raiz `fixed`. Um
 * modal novo pendurado numa gaveta entra na conta sozinho — que é a única
 * forma de isto não envelhecer.
 */

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const cheio = path.join(dir, nome);
    if (statSync(cheio).isDirectory()) return arquivosTsx(cheio);
    return nome.endsWith('.tsx') ? [cheio] : [];
  });
}

const TODOS = arquivosTsx(RAIZ);
const ler = (f: string) => readFileSync(f, 'utf8');

/** Resolve `@/components/x/y` para o arquivo, quando ele existe. */
function resolver(spec: string): string | null {
  if (!spec.startsWith('@/components/')) return null;
  const alvo = path.join(RAIZ, `${spec.replace('@/components/', '')}.tsx`);
  return TODOS.includes(alvo) ? alvo : null;
}

function importados(arquivo: string): string[] {
  const achados = ler(arquivo).match(/from '(@\/components\/[^']+)'/g) ?? [];
  return achados
    .map((m) => resolver(m.slice(6, -1)))
    .filter((x): x is string => !!x);
}

/**
 * Quem renderiza um `<Sheet` — a gaveta, que é o elemento com transform.
 *
 * SÓ COMPONENTES, não páginas. Numa página, o modal costuma ser IRMÃO do Sheet
 * (o `Sheet` é o filtro do celular, e os diálogos ficam depois dele no JSX):
 * ali não há aninhamento e não há armadilha. Numa gaveta, o conteúdo está
 * dentro — é o caso que este teste vigia.
 */
const GAVETAS = TODOS.filter((f) => /<Sheet[\s>]/.test(ler(f)));

/** O que cada gaveta pode abrir, direta ou indiretamente (profundidade 3). */
function alcancaveis(): Set<string> {
  const vistos = new Set<string>();
  let fronteira = GAVETAS.flatMap(importados);
  for (let nivel = 0; nivel < 3; nivel++) {
    const proxima: string[] = [];
    for (const f of fronteira) {
      if (vistos.has(f)) continue;
      vistos.add(f);
      proxima.push(...importados(f));
    }
    fronteira = proxima;
  }
  return vistos;
}

/** Tem raiz de sobreposição própria — `fixed inset-0` no JSX. */
const ehSobreposicao = (f: string) => /className="fixed inset-0/.test(ler(f));
/** Sai da gaveta: `<Portal>` ou `createPortal` direto. */
const saiDaGaveta = (f: string) => /<Portal>|createPortal\(/.test(ler(f));

const curto = (f: string) => path.relative(RAIZ, f).replace(/\\/g, '/');

describe('diálogo aberto de dentro de uma gaveta', () => {
  /** Se a premissa mudar, este teste inteiro perde o sentido — e avisa. */
  it('a gaveta continua animando com transform (é isto que prende o `fixed`)', () => {
    const sheet = ler(path.join(RAIZ, 'ui/sheet.tsx'));
    expect(sheet).toContain('transition-transform');
    expect(sheet).toMatch(/translate-x-0|translate-y-0/);
  });

  it('há gavetas para vigiar, e elas abrem diálogos', () => {
    expect(GAVETAS.length).toBeGreaterThan(2);
    expect([...alcancaveis()].filter(ehSobreposicao).length).toBeGreaterThan(3);
  });

  /**
   * O CASO CONCRETO, com nome. Se alguém tirar o portal de um destes, a falha
   * aponta o arquivo — e o print de 22/09 volta a acontecer.
   */
  it('todo diálogo alcançável por uma gaveta usa Portal', () => {
    const faltando = [...alcancaveis()]
      .filter(ehSobreposicao)
      .filter((f) => !saiDaGaveta(f))
      .map(curto)
      .sort();

    expect(faltando).toEqual([]);
  });

  /**
   * O ConfirmDialog não é alcançável por UMA gaveta — é alcançável por quase
   * tudo. Ele merece linha própria porque é o diálogo que mais aparece no
   * sistema, e portanto o que mais custaria caro sair espremido.
   */
  it('o ConfirmDialog sai da gaveta', () => {
    expect(saiDaGaveta(path.join(RAIZ, 'ui/confirm-dialog.tsx'))).toBe(true);
  });
});
