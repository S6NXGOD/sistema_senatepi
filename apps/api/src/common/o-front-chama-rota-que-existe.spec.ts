import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import * as path from 'node:path';

/**
 * O FRONT CHAMA ROTA QUE EXISTE?
 *
 * A pergunta que faltava, e que teria pego os DOIS incidentes desta semana pelo
 * lado de quem consome:
 *
 *  1. O dossiê em PDF ocupou `GET /processos/:id/dossie`, que era do JSON. O
 *     front continuou pedindo o mesmo caminho e recebendo outra coisa.
 *  2. `GET /processos/vinculos-pendentes` nunca foi atendido, porque
 *     `@Get(':id')` de um controller registrado antes casava a mesma URL.
 *
 * Verificar com `curl` não pega nenhum dos dois: o guard responde 401 ANTES de
 * o handler existir ou não, então "401" só prova que alguma rota casou — não
 * qual. Foi assim que eu dei os dois por verificados.
 *
 * O QUE ESTE TESTE FAZ: monta a tabela de rotas do Nest na ordem REAL de
 * registro (controllers na ordem do módulo, métodos na ordem do arquivo), lê
 * toda chamada `api.get/post/...` do front, e cobra duas coisas — que exista
 * rota, e que a rota que ATENDE seja a mais específica que existe. A segunda é
 * a que pega sombra.
 *
 * O QUE ELE IGNORA, e por quê: URL que começa com interpolação
 * (`api.get(`${base}/x`)`) não dá para resolver por texto. Fingir que dá
 * produziria falso positivo, e teste com falso positivo é desligado em um mês.
 */
const RAIZ_API = path.resolve(__dirname, '../modules');
const RAIZ_WEB = path.resolve(__dirname, '../../../web/src');

const VERBOS = ['Get', 'Post', 'Patch', 'Put', 'Delete'] as const;

const semComentarios = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

function arquivos(raiz: string, ext: string[]): string[] {
  if (!existsSync(raiz)) return [];
  return readdirSync(raiz).flatMap((nome) => {
    const p = path.join(raiz, nome);
    if (statSync(p).isDirectory()) return arquivos(p, ext);
    return ext.some((e) => p.endsWith(e)) && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

interface Rota {
  verbo: string;
  caminho: string;
  classe: string;
  ordemControlador: number;
  ordemNoArquivo: number;
}

/** A ordem dos controllers vem dos `@Module({ controllers: [...] })`. */
function ordemDosControllers(): Map<string, number> {
  const ordem = new Map<string, number>();
  let n = 0;
  for (const arq of arquivos(RAIZ_API, ['.ts'])) {
    for (const m of semComentarios(readFileSync(arq, 'utf8')).matchAll(
      /controllers:\s*\[([^\]]*)\]/g,
    )) {
      for (const nome of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!ordem.has(nome)) ordem.set(nome, n++);
      }
    }
  }
  return ordem;
}

function tabelaDeRotas(): Rota[] {
  const ordem = ordemDosControllers();
  const rotas: Rota[] = [];
  for (const arq of arquivos(RAIZ_API, ['.ts'])) {
    const src = semComentarios(readFileSync(arq, 'utf8'));
    // `@Controller('x')` e `@Controller()` — o segundo tem prefixo vazio, e
    // ignorá-lo esconderia rotas de raiz inteiras (é o caso de /validacao/qr).
    const marcas = [...src.matchAll(/@Controller\(\s*(?:'([^']*)')?\s*\)/g)];
    for (let i = 0; i < marcas.length; i++) {
      const prefixo = marcas[i][1] ?? '';
      const ini = marcas[i].index ?? 0;
      const fim = i + 1 < marcas.length ? (marcas[i + 1].index ?? src.length) : src.length;
      const bloco = src.slice(ini, fim);
      const classe = /class\s+(\w+)/.exec(bloco)?.[1] ?? '(anônima)';
      for (const verbo of VERBOS) {
        const re = new RegExp(`@${verbo}\\((?:\\s*'([^']*)'\\s*)?\\)`, 'g');
        for (const m of bloco.matchAll(re)) {
          rotas.push({
            verbo: verbo.toUpperCase(),
            caminho: [prefixo, m[1] ?? ''].filter(Boolean).join('/'),
            classe,
            ordemControlador: ordem.get(classe) ?? 9_999,
            ordemNoArquivo: ini + (m.index ?? 0),
          });
        }
      }
    }
  }
  return rotas.sort(
    (a, b) => a.ordemControlador - b.ordemControlador || a.ordemNoArquivo - b.ordemNoArquivo,
  );
}

interface Chamada {
  verbo: string;
  url: string;
  arquivo: string;
}

/**
 * As chamadas do front. `${...}` vira um segmento coringa; URL que COMEÇA com
 * interpolação é descartada, porque o caminho depende de uma variável.
 */
function chamadasDoFront(): Chamada[] {
  const achadas: Chamada[] = [];
  for (const arq of arquivos(RAIZ_WEB, ['.ts', '.tsx'])) {
    const src = readFileSync(arq, 'utf8');
    const arquivo = path.relative(RAIZ_WEB, arq).replace(/\\/g, '/');
    const registrar = (verbo: string, cru: string) => {
      const semQuery = cru.split('?')[0];
      // Caminho que COMEÇA com variável não dá para resolver por texto.
      if (semQuery.startsWith('${') || semQuery.startsWith('/${')) return;

      const url = semQuery.replace(/\$\{[^}]*\}/g, 'X').replace(/^\//, '');
      /*
        SOBROU `${` = NÃO DEU PARA LER, e o certo é calar.

        Acontece com interpolação que tem aspas ou crase dentro
        (`${cnpj.replace(/\D/g, '')}`): a captura por texto termina cedo e o
        resultado é um caminho picado. Reportar isso como "rota inexistente"
        seria acusar código correto — e teste que acusa código correto é
        desligado em um mês, levando junto os achados verdadeiros.
      */
      if (url.includes('${')) return;

      achadas.push({ verbo, url, arquivo });
    };
    for (const m of src.matchAll(/api\.(get|post|patch|put|delete)[^(]*\(\s*[`']([^`']+)[`']/g)) {
      registrar(m[1].toUpperCase(), m[2]);
    }
    for (const m of src.matchAll(/baixar(?:Arquivo|Pdf)\(\s*[`']([^`']+)[`']/g)) {
      registrar('GET', m[1]);
    }
  }
  return achadas;
}

/** O padrão do Nest casa a URL? Parâmetro aceita qualquer segmento. */
function casa(padrao: string, url: string): boolean {
  const a = padrao.split('/').filter(Boolean);
  const b = url.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
}

const literais = (caminho: string) =>
  caminho.split('/').filter((s) => s && !s.startsWith(':')).length;

describe('toda chamada do front encontra a rota certa', () => {
  const rotas = tabelaDeRotas();
  const chamadas = chamadasDoFront();

  it('acha as duas pontas (o teste não passa por varrer nada)', () => {
    expect(rotas.length).toBeGreaterThan(200);
    expect(chamadas.length).toBeGreaterThan(150);
  });

  /**
   * A rota que ATENDE é a primeira registrada que casa. Se existe outra mais
   * específica para a mesma URL, quem escreveu a chamada queria a específica —
   * e ela está na sombra. Foi exatamente o caso de `vinculos-pendentes`.
   */
  it('nenhuma chamada cai numa rota mais genérica do que a que existe', () => {
    const erradas: string[] = [];
    for (const c of chamadas) {
      const candidatas = rotas.filter((r) => r.verbo === c.verbo && casa(r.caminho, c.url));
      if (candidatas.length === 0) continue; // coberto pelo caso abaixo
      const atende = candidatas[0];
      const maisEspecifica = [...candidatas].sort(
        (x, y) => literais(y.caminho) - literais(x.caminho),
      )[0];
      if (atende.caminho !== maisEspecifica.caminho) {
        erradas.push(
          `${c.verbo} /${c.url} (${c.arquivo}) cai em ${atende.caminho} ` +
            `(${atende.classe}) em vez de ${maisEspecifica.caminho} (${maisEspecifica.classe})`,
        );
      }
    }
    expect([...new Set(erradas)]).toEqual([]);
  });

  /** E o básico: o caminho tem de existir em algum lugar. */
  it('nenhuma chamada aponta para rota inexistente', () => {
    const orfas = chamadas
      .filter((c) => !rotas.some((r) => r.verbo === c.verbo && casa(r.caminho, c.url)))
      .map((c) => `${c.verbo} /${c.url} (${c.arquivo})`);
    expect([...new Set(orfas)].sort()).toEqual([]);
  });
});
