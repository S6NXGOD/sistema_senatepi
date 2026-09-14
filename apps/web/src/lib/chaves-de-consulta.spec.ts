import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { CHAVES_DEPOIS_DE_CONCLUIR } from './dashboard';

/**
 * TODA CHAVE INVALIDADA TEM DE SER DE UMA CONSULTA QUE EXISTE.
 *
 * O react-query compara a chave elemento a elemento: `['dashboard']` NÃO casa
 * com `['dashboard-resumo']`. Invalidar uma chave que nenhuma consulta declara
 * não dá erro nenhum — simplesmente não faz nada. Foi assim que a linha
 * concluída no painel ficava com o botão por até 60 s e o segundo toque voltava
 * 400 "já está concluída": o bloco invalidava `['dashboard']` e `['agenda']`.
 *
 * O QUE ESTE TESTE FAZ: lê todo `.ts/.tsx` do web (menos specs), junta as chaves
 * DECLARADAS (`queryKey: [...]` em useQuery/useQueries/fetchQuery/queryOptions)
 * e as USADAS (`invalidateQueries/refetchQueries/removeQueries/resetQueries/
 * cancelQueries`, `setQueryData/getQueryData`, e o laço
 * `for (const k of [[...], ...]) qc.invalidateQueries({ queryKey: k })`), e cobra
 * que toda chave usada case, pelo prefixo, com alguma declarada.
 *
 * LIMITES, de propósito: só chave cujo PRIMEIRO elemento é literal. Elemento
 * que é variável (`['filiado', id]`) vale como coringa nas posições seguintes;
 * declaração cujo primeiro elemento é variável não serve de par para ninguém
 * (senão casaria com tudo e o teste nunca reprovaria). Chave inteira numa
 * variável (`queryKey: chave`) não dá para ler por texto e fica de fora.
 */

const RAIZ = path.resolve(__dirname, '..');

type Elemento = { lit: string } | { variavel: string } | { resto: true };
type Chave = Elemento[];
interface Ocorrencia {
  chave: Chave;
  arquivo: string;
  linha: number;
}

function arquivosDoWeb(raiz: string): string[] {
  return readdirSync(raiz).flatMap((nome) => {
    const p = path.join(raiz, nome);
    if (statSync(p).isDirectory()) return arquivosDoWeb(p);
    return /\.tsx?$/.test(p) && !/\.spec\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Troca comentário por espaço (mantém as quebras de linha, para o número da linha). */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Índice do colchete que fecha o que abre em `ini`, pulando strings. */
function fechamento(src: string, ini: number): number {
  let prof = 0;
  for (let i = ini; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const aspas = c;
      i++;
      while (i < src.length && src[i] !== aspas) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '[' || c === '(' || c === '{') prof++;
    else if (c === ']' || c === ')' || c === '}') {
      prof--;
      if (prof === 0) return i;
    }
  }
  return -1;
}

/** Elementos de primeiro nível do corpo de um array. */
function elementos(corpo: string): Chave {
  const partes: string[] = [];
  let prof = 0;
  let atual = '';
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < corpo.length && corpo[j] !== c) {
        if (corpo[j] === '\\') j++;
        j++;
      }
      atual += corpo.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('[({'.includes(c)) prof++;
    if ('])}'.includes(c)) prof--;
    if (c === ',' && prof === 0) {
      partes.push(atual.trim());
      atual = '';
    } else {
      atual += c;
    }
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes.map((e): Elemento => {
    const m = /^['"]([^'"`]*)['"]$/.exec(e);
    if (m) return { lit: m[1] };
    if (e.startsWith('...')) return { resto: true };
    return { variavel: e };
  });
}

const USO_ANTES = /(invalidateQueries|refetchQueries|removeQueries|resetQueries|cancelQueries)\(\s*\{\s*$/;

export function chavesDoFonte(cru: string, arquivo = '(fixture)') {
  const src = semComentarios(cru);
  const linha = (i: number) => src.slice(0, i).split('\n').length;
  const declaradas: Ocorrencia[] = [];
  const usadas: Ocorrencia[] = [];

  for (const m of src.matchAll(/queryKey:\s*\[/g)) {
    const ini = (m.index ?? 0) + m[0].length - 1;
    const fim = fechamento(src, ini);
    if (fim < 0) continue;
    const oc = { chave: elementos(src.slice(ini + 1, fim)), arquivo, linha: linha(m.index ?? 0) };
    const antes = src.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
    (USO_ANTES.test(antes) ? usadas : declaradas).push(oc);
  }

  for (const m of src.matchAll(/(?:setQueryData|getQueryData)(?:<[^>(]*>)?\(\s*\[/g)) {
    const ini = (m.index ?? 0) + m[0].length - 1;
    const fim = fechamento(src, ini);
    if (fim < 0) continue;
    usadas.push({ chave: elementos(src.slice(ini + 1, fim)), arquivo, linha: linha(m.index ?? 0) });
  }

  for (const m of src.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s+\[/g)) {
    const ini = (m.index ?? 0) + m[0].length - 1;
    const fim = fechamento(src, ini);
    if (fim < 0) continue;
    const corpoDoLaco = src.slice(fim, fim + 200);
    const invalida = new RegExp(
      `(?:invalidateQueries|refetchQueries|removeQueries|resetQueries)\\(\\s*\\{\\s*queryKey:\\s*${m[1]}\\b`,
    );
    if (!invalida.test(corpoDoLaco)) continue;
    for (const el of elementos(src.slice(ini + 1, fim))) {
      if (!('variavel' in el) || !el.variavel.startsWith('[')) continue;
      usadas.push({
        chave: elementos(el.variavel.slice(1, -1)),
        arquivo,
        linha: linha(m.index ?? 0),
      });
    }
  }

  return { declaradas, usadas };
}

const cabecaLiteral = (c: Chave) => c.length > 0 && 'lit' in c[0];

/** A chave usada casa com a declarada pelo prefixo, como o react-query compara. */
function casaPeloPrefixo(usada: Chave, declarada: Chave): boolean {
  if (!cabecaLiteral(declarada)) return false;
  for (let i = 0; i < usada.length; i++) {
    const u = usada[i];
    const d = declarada[i];
    if ('resto' in u) return true;
    if (!d) return false;
    if ('resto' in d) return true;
    if ('lit' in u && 'lit' in d && u.lit !== d.lit) return false;
  }
  return true;
}

export function orfas(declaradas: Ocorrencia[], usadas: Ocorrencia[]): Ocorrencia[] {
  return usadas.filter(
    (u) => cabecaLiteral(u.chave) && !declaradas.some((d) => casaPeloPrefixo(u.chave, d.chave)),
  );
}

const texto = (c: Chave) =>
  '[' + c.map((e) => ('lit' in e ? `'${e.lit}'` : 'resto' in e ? '...' : '*')).join(', ') + ']';
const rotulo = (o: Ocorrencia) => `${o.arquivo} ${texto(o.chave)}`;

/**
 * EXCEÇÕES — cada uma com o motivo. O último teste reprova exceção que deixou de
 * ser necessária: quando alguém tirar a chave morta, a lista tem de encolher junto.
 */
const EXCECOES: Record<string, string> = {
  // As duas da gaveta da agenda (['agenda-alertas'] e ['dashboard']) saíram em
  // 14/09/2026 junto com GET /compromissos/alertas — o último teste cobra isso.
  "components/filiados/financeiro-section.tsx ['cobrancas-parcelas']":
    "Anterior a esta rodada. A ficha atualiza pela ['cobrancas-filiado', id] da linha de cima; " +
    'nenhuma consulta declara esta chave.',
  "components/processos/importar-lote-dialog.tsx ['processos-contadores']":
    "Anterior a esta rodada. A consulta real é ['processos', 'contadores'], já coberta pelo " +
    "['processos'] invalidado na linha de cima.",
  "components/processos/resolver-vinculos-panel.tsx ['processos-contagem']":
    "Anterior a esta rodada. Os contadores são ['processos', 'contadores'], já cobertos pelo " +
    "['processos'] invalidado na linha de cima.",
};

/** Usos que não dá para ler por texto — e por que estão certos. */
const NAO_LEGIVEIS: Record<string, string> = {
  'components/colaboradores/listas-apoio-modal.tsx':
    'A chave é a prop `chave` do modal: a consulta é [chave, true] e a invalidação [chave], no mesmo arquivo.',
  'components/dashboard/concluir-no-painel.ts':
    'Percorre CHAVES_DEPOIS_DE_CONCLUIR, conferida valor a valor num teste abaixo.',
};

describe('o leitor de chaves (fixture)', () => {
  const FONTE = `
    const a = useQuery({ queryKey: ['filiado', id], queryFn });
    const b = useQuery({ queryKey: ['processos', 'lista', filtro], queryFn });
    const c = useQuery({ queryKey: [chave, true], queryFn });
    // qc.invalidateQueries({ queryKey: ['comentada'] });
    qc.invalidateQueries({ queryKey: ['filiado', outroId] });
    qc.invalidateQueries({ queryKey: ['processos'] });
    qc.invalidateQueries({ queryKey: ['processos', 'contadores'] });
    qc.setQueryData<Resumo>(['sumida'], x);
    for (const k of [['filiado'], ['fantasma', id]]) {
      qc.invalidateQueries({ queryKey: k });
    }
  `;
  const { declaradas, usadas } = chavesDoFonte(FONTE);

  it('separa declaração de uso e ignora comentário', () => {
    expect(declaradas.map((d) => texto(d.chave))).toEqual([
      "['filiado', *]",
      "['processos', 'lista', *]",
      // Só string entre aspas é literal; `true` e `chave` viram coringa.
      '[*, *]',
    ]);
    expect(usadas.map((u) => texto(u.chave))).toEqual([
      "['filiado', *]",
      "['processos']",
      "['processos', 'contadores']",
      "['sumida']",
      "['filiado']",
      "['fantasma', *]",
    ]);
  });

  it('acha a órfã pelo prefixo — e a declaração com variável na cabeça não vira coringa', () => {
    expect(orfas(declaradas, usadas).map((o) => texto(o.chave))).toEqual([
      "['processos', 'contadores']",
      "['sumida']",
      "['fantasma', *]",
    ]);
  });
});

describe('as chaves do web', () => {
  const declaradas: Ocorrencia[] = [];
  const usadas: Ocorrencia[] = [];
  for (const arq of arquivosDoWeb(RAIZ)) {
    const rel = path.relative(RAIZ, arq).replace(/\\/g, '/');
    const r = chavesDoFonte(readFileSync(arq, 'utf8'), rel);
    declaradas.push(...r.declaradas);
    usadas.push(...r.usadas);
  }

  it('lê as duas pontas (o teste não passa por não achar nada)', () => {
    expect(declaradas.length).toBeGreaterThan(100);
    expect(usadas.length).toBeGreaterThan(100);
    // O laço da agenda é lido: sem isto, uma mudança no leitor calaria os laços.
    expect(usadas.map(rotulo)).toContain("app/(dashboard)/agenda/page.tsx ['minhas-pendencias']");
  });

  /*
    14/09/2026: a gaveta do atendimento e o desfecho passaram a usar a lista do
    fechamento, e a troca de plantão invalida as pendências. Os laços têm de
    continuar legíveis por aqui, senão uma chave errada neles passaria calada.
  */
  it('os laços do atendimento e da troca de plantão são lidos', () => {
    const rotulos = usadas.map(rotulo);
    for (const k of ["['compromissos']", "['compromisso']", "['minhas-pendencias']"]) {
      expect(rotulos).toContain(`components/atendimentos/fechar-atendimento-modal.tsx ${k}`);
    }
    expect(rotulos).toContain("components/escalas/editar-escala-modal.tsx ['minhas-pendencias']");
  });

  it('toda chave invalidada tem uma consulta que a declara', () => {
    const achadas = [...new Set(orfas(declaradas, usadas).map(rotulo))].filter((r) => !(r in EXCECOES));
    expect(achadas).toEqual([]);
  });

  it('as chaves da conclusão no painel existem', () => {
    const usos = CHAVES_DEPOIS_DE_CONCLUIR.map((c) => ({
      chave: c.map((lit): Elemento => ({ lit })),
      arquivo: 'lib/dashboard.ts',
      linha: 0,
    }));
    expect(orfas(declaradas, usos).map(rotulo)).toEqual([]);
  });

  it('uso que não dá para ler só nos lugares conhecidos', () => {
    const ilegiveis = [...new Set(usadas.filter((u) => !cabecaLiteral(u.chave)).map((u) => u.arquivo))];
    expect(ilegiveis.filter((a) => !(a in NAO_LEGIVEIS))).toEqual([]);
  });

  it('nenhuma exceção sobra: cada uma ainda existe e ainda é órfã', () => {
    const orfasAgora = new Set(orfas(declaradas, usadas).map(rotulo));
    expect(Object.keys(EXCECOES).filter((e) => !orfasAgora.has(e))).toEqual([]);
  });
});
