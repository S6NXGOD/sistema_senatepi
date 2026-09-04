import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * DUAS ROTAS IGUAIS NÃO DÃO ERRO — UMA SOME.
 *
 * O BUG QUE ISTO IMPEDE, e ele derrubou a tela principal do sistema em
 * produção. `MovimentacoesController` servia `GET /processos/:id/dossie` — o
 * JSON com tudo que a ficha do processo precisa numa chamada só. Um dossiê em
 * PDF foi criado depois, em `ProcessosController`, no MESMO caminho.
 *
 * Os dois declaram `@Controller('processos')`. O Nest resolve pela ordem de
 * registro no módulo, o novo vinha primeiro, e engoliu o antigo — sem aviso no
 * build, sem aviso no start, sem uma linha de log. O front pedia JSON, recebia
 * um PDF, e a ficha quebrava com "Cannot read properties of undefined (reading
 * 'confronto')". Só apareceu quando alguém clicou num processo.
 *
 * TypeScript não pega: são arquivos diferentes. Teste de unidade não pega: cada
 * controller funciona sozinho. Só comparar os caminhos DECLARADOS pega — e é o
 * que este arquivo faz.
 *
 * A COMPARAÇÃO É POR FORMA, e não por texto: `:id` e `:processoId` casam a
 * mesma URL, então `GET processos/:id/partes` e `GET processos/:processoId/partes`
 * colidem mesmo escritos diferente. Todo parâmetro vira `:_`.
 *
 * E TEM A SEGUNDA VARIANTE, que custou um segundo incidente no dia seguinte:
 * **rota com parâmetro engole rota com literal**. `GET /processos/:id` e
 * `GET /processos/vinculos-pendentes` não são iguais — mas casam a MESMA URL, e
 * quem estiver registrado antes atende. Foi o que aconteceu:
 * `ProcessosController` (primeiro na lista `controllers`) tem `:id`, e a rota
 * nova, declarada em `PartesController` (sétimo), NUNCA foi atendida. A tela
 * mostrava "nenhum processo pendente" ao lado de um contador dizendo 29.
 *
 * Por isso o teste também ordena por REGISTRO — controller na ordem do módulo,
 * método na ordem do arquivo — e acusa quem está na sombra de quem.
 */
const RAIZ = path.resolve(__dirname, '../modules');

const VERBOS = ['Get', 'Post', 'Patch', 'Put', 'Delete', 'Head', 'Options'] as const;

interface Rota {
  verbo: string;
  caminho: string;
  arquivo: string;
  classe: string;
  /** Posição na ordem em que o Nest registra — é ela que decide quem atende. */
  ordem: number;
}

/**
 * A ORDEM DOS CONTROLLERS, lida dos `@Module({ controllers: [...] })`.
 *
 * É o dado que falta para prever a sombra: dentro de um arquivo dá para ver a
 * ordem lendo de cima para baixo, mas entre arquivos só o módulo sabe. Um
 * controller que não apareça em módulo nenhum vai para o fim — ele não está
 * ativo, e não pode sombrear ninguém.
 */
function ordemDosControllers(): Map<string, number> {
  const ordem = new Map<string, number>();
  let n = 0;
  for (const arq of arquivosTs(RAIZ)) {
    const src = semComentarios(readFileSync(arq, 'utf8'));
    for (const m of src.matchAll(/controllers:\s*\[([^\]]*)\]/g)) {
      for (const nome of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!ordem.has(nome)) ordem.set(nome, n++);
      }
    }
  }
  return ordem;
}

function arquivosTs(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) return arquivosTs(p);
    return p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

/** `processos/:id/dossie` → `processos/:_/dossie` */
const normalizar = (c: string) =>
  c
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? ':_' : seg))
    .join('/');

/**
 * COMENTÁRIO NÃO É ROTA.
 *
 * Metade deste módulo explica ordem de rota citando o decorador no texto
 * ("declarada ANTES de qualquer `@Get(':id')`") — e é uma prática boa, que não
 * vou pedir para mudar por causa de um teste. A primeira versão deste arquivo
 * contou essas citações como declarações e acusou oito colisões que não
 * existiam. Tirar os comentários antes de varrer é o conserto certo.
 */
const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * Lê os `@Controller` e os verbos de cada arquivo, mantendo a associação: um
 * arquivo pode ter vários controllers (é o caso de `movimentacoes` e
 * `auditoria`), e atribuir a rota ao prefixo errado esconderia a colisão.
 */
function rotasDoArquivo(caminhoArquivo: string): Rota[] {
  const src = semComentarios(readFileSync(caminhoArquivo, 'utf8'));
  const arquivo = path.relative(RAIZ, caminhoArquivo).replace(/\\/g, '/');
  const rotas: Rota[] = [];

  // Cada @Controller abre um bloco que vai até o próximo @Controller.
  const marcas = [...src.matchAll(/@Controller\(\s*'([^']*)'\s*\)/g)];
  for (let i = 0; i < marcas.length; i++) {
    const prefixo = marcas[i][1];
    const inicio = marcas[i].index ?? 0;
    const fim = i + 1 < marcas.length ? (marcas[i + 1].index ?? src.length) : src.length;
    const bloco = src.slice(inicio, fim);
    const classe = /class\s+(\w+)/.exec(bloco)?.[1] ?? '(anônima)';

    for (const verbo of VERBOS) {
      const re = new RegExp(`@${verbo}\\((?:\\s*'([^']*)'\\s*)?\\)`, 'g');
      for (const m of bloco.matchAll(re)) {
        const sufixo = m[1] ?? '';
        rotas.push({
          verbo: verbo.toUpperCase(),
          caminho: normalizar([prefixo, sufixo].filter(Boolean).join('/')),
          arquivo,
          classe,
          // Dentro do controller a ordem é a do arquivo; entre controllers, a
          // do módulo. O índice do match resolve a primeira metade.
          ordem: (m.index ?? 0) + inicio,
        });
      }
    }
  }
  return rotas;
}

describe('nenhuma rota é declarada duas vezes', () => {
  const ordemControllers = ordemDosControllers();
  /**
   * Ordena como o Nest registra: primeiro pela posição do controller na lista
   * do módulo, depois pela posição do método dentro do arquivo. O controller
   * ausente de qualquer módulo vai para o fim (não está no ar).
   */
  const rotas = arquivosTs(RAIZ)
    .flatMap(rotasDoArquivo)
    .map((r) => ({ ...r, controllerEm: ordemControllers.get(r.classe) ?? 9_999 }))
    .sort((a, b) => a.controllerEm - b.controllerEm || a.ordem - b.ordem);

  it('encontra as rotas (o teste não passa por varrer nada)', () => {
    expect(rotas.length).toBeGreaterThan(200);
  });

  /**
   * A colisão real: mesmo verbo, mesma forma de caminho, controllers
   * diferentes. Duas declarações no MESMO controller também contam — Nest
   * atende a primeira e a segunda vira código morto.
   */
  it('não há duas declarações para a mesma URL', () => {
    const porChave = new Map<string, Rota[]>();
    for (const r of rotas) {
      const chave = `${r.verbo} /${r.caminho}`;
      porChave.set(chave, [...(porChave.get(chave) ?? []), r]);
    }

    const colisoes = [...porChave.entries()]
      .filter(([, lista]) => lista.length > 1)
      .map(
        ([chave, lista]) =>
          `${chave}  <-  ${lista.map((r) => `${r.classe} (${r.arquivo})`).join('  |  ')}`,
      );

    expect(colisoes).toEqual([]);
  });

  /**
   * ROTA COM PARÂMETRO ENGOLE ROTA COM LITERAL — a variante que custou o
   * segundo incidente.
   *
   * `GET /processos/:id` e `GET /processos/vinculos-pendentes` não são a mesma
   * declaração, mas casam a MESMA URL. Quem estiver registrado primeiro
   * atende, e o outro nunca roda. Dentro de um controller isso é conhecido e o
   * módulo já comenta ("vem ANTES de `@Get(':id')`"); entre controllers
   * diferentes ninguém enxerga, porque a ordem mora no `@Module`.
   */
  it('nenhuma rota com literal fica na sombra de uma com parâmetro', () => {
    const sombras: string[] = [];
    for (let i = 0; i < rotas.length; i++) {
      for (let j = i + 1; j < rotas.length; j++) {
        const antes = rotas[i];
        const depois = rotas[j];
        if (antes.verbo !== depois.verbo) continue;

        const a = antes.caminho.split('/');
        const d = depois.caminho.split('/');
        if (a.length !== d.length) continue;

        // `antes` engole `depois` se casa segmento a segmento — com o
        // parâmetro aceitando qualquer coisa — e for de fato mais genérica.
        const casa = a.every((seg, k) => seg === ':_' || seg === d[k]);
        const maisGenerica = a.some((seg, k) => seg === ':_' && d[k] !== ':_');
        if (casa && maisGenerica) {
          sombras.push(
            `${antes.verbo} /${antes.caminho} (${antes.classe}) engole ` +
              `/${depois.caminho} (${depois.classe})`,
          );
        }
      }
    }
    expect(sombras).toEqual([]);
  });

  /**
   * O CASO QUE JÁ QUEBROU, travado pelo nome. Se alguém devolver o PDF para
   * `:id/dossie`, este teste cai antes do deploy — e diz por quê.
   */
  it('o dossiê em PDF e o dossiê em JSON são caminhos diferentes', () => {
    const dossies = rotas.filter((r) => r.caminho.startsWith('processos/:_/dossie'));
    expect(dossies.map((d) => `${d.verbo} /${d.caminho}`).sort()).toEqual([
      'GET /processos/:_/dossie',
      'GET /processos/:_/dossie.pdf',
    ]);
  });
});
