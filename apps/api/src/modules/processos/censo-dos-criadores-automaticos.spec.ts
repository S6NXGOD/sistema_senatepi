import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * QUANTAS COISAS NESTE SISTEMA PODEM PÔR UMA TAREFA NA AGENDA DE ALGUÉM SEM
 * NINGUÉM PEDIR? (17/09/2026)
 *
 * POR QUE ESTE TESTE EXISTE
 * O pedido do dono foi "não encha de tarefas desnecessárias... garanta que isso
 * não vai mais acontecer". Consertar UM criador não garante nada: esta base já
 * pagou três vezes por conserto que não procurou os irmãos (o `polo` com três
 * leitores, o `tipoAcao` derivado num caminho e não no outro, a lista de status
 * do Diário ao lado da canônica). Quem chega depois e quer criar uma atividade
 * automática copia o vizinho — e o vizinho volta a ser o criador cego.
 *
 * Então o número vira teste. Não para congelar a automação: para que ACRESCENTAR
 * um criador seja uma decisão explícita, com a lista abaixo na frente de quem
 * estiver acrescentando.
 *
 * O CENSO DE HOJE — 6 criadores, e o de que cada um vive:
 *
 *   automacao-prazos.service.ts (4)
 *     · Confirmar data da audiência designada — o CNJ diz que designou e não diz
 *       quando; a tarefa é "abrir o PJe e descobrir";
 *     · Audiência/Perícia — a pauta com data, que é o compromisso de verdade;
 *     · Avisar filiado — a secretaria telefonando antes da sessão;
 *     · Preparar audiência/perícia — 2 dias úteis antes, para quem vai atuar.
 *
 *   correlacao.service.ts (1)
 *     · a tarefa nascida da PUBLICAÇÃO do Diário, cujo título e prazo saem do
 *       teor (`planejarAtividade`). Esta sabe o que está pedindo.
 *
 *   djen-sync.service.ts (1)
 *     · Cadastrar ação do Diário — 12 criadas, 12 concluídas em zero dia, zero
 *       canceladas. É o padrão que as outras deveriam copiar.
 *
 * ERAM SETE ATÉ 17/09/2026. O sétimo era "Verificação de Intimação / Prazo", em
 * `criarPrazo`: 48 criadas, 32 canceladas (67%), 11 concluídas — 9 delas com
 * desfecho PRAZO_SEM_PECA — e 47 nascidas atrasadas. Ele não tinha o teor do
 * ato, então só sabia mandar abrir o PJe. Hoje aquele caminho AVALIA e CARIMBA
 * (`avaliarPrazo`), e o aviso fica no selo âmbar, que é estado e não tarefa.
 */

const RAIZ = path.join(__dirname, '..', '..');

interface Criador {
  arquivo: string;
  linha: number;
  /** A expressão do título, exatamente como está no fonte. */
  titulo: string;
}

/** Todo `.ts` de produção sob `src/` — specs de fora, que só leem. */
function fontes(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) {
      fontes(p, saida);
    } else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) {
      saida.push(p);
    }
  }
  return saida;
}

/**
 * O BLOCO INTEIRO, e não a linha.
 *
 * `origemAutomatica: true` aparece também em `select`, em `where` e em
 * `updateMany` — filtrar por linha acusaria inocente e, pior, daria a sensação
 * de que o censo está fechado quando não está. Aqui só conta o argumento de um
 * `compromisso.create`, recortado por chaves balanceadas.
 */
function criadoresDe(arquivo: string): Criador[] {
  const fonte = readFileSync(arquivo, 'utf8');
  const achados: Criador[] = [];
  const abre = /compromisso\.create\(\s*\{/g;
  for (let m = abre.exec(fonte); m; m = abre.exec(fonte)) {
    const i = fonte.indexOf('{', m.index);
    let nivel = 0;
    let j = i;
    for (; j < fonte.length; j++) {
      if (fonte[j] === '{') nivel++;
      else if (fonte[j] === '}' && --nivel === 0) break;
    }
    const bloco = fonte.slice(i, j + 1);
    if (!bloco.includes('origemAutomatica: true')) continue;
    // `titulo: <expr>` ou o atalho `titulo,` — os dois existem no código.
    const t = /^\s*titulo(?::\s*(.+?))?,\s*$/m.exec(bloco);
    achados.push({
      arquivo: path.relative(RAIZ, arquivo).split(path.sep).join('/'),
      linha: fonte.slice(0, m.index).split('\n').length,
      titulo: t ? (t[1] ?? 'titulo').trim() : '(sem título)',
    });
  }
  return achados;
}

/**
 * A LISTA. Acrescentar uma linha aqui é o pedido de licença para pôr mais uma
 * coisa na agenda de alguém sem que ninguém tenha pedido.
 */
const CENSO: { arquivo: string; titulo: string }[] = [
  { arquivo: 'modules/processos/automacao-prazos.service.ts', titulo: 'TITULO_CONFIRMAR_AUDIENCIA' },
  { arquivo: 'modules/processos/automacao-prazos.service.ts', titulo: '`${rotulo} — ${nomeFiliado}`' },
  { arquivo: 'modules/processos/automacao-prazos.service.ts', titulo: 'tituloAviso' },
  { arquivo: 'modules/processos/automacao-prazos.service.ts', titulo: 'titulo' },
  { arquivo: 'modules/processos/correlacao.service.ts', titulo: 'plano.titulo' },
  { arquivo: 'modules/processos/djen-sync.service.ts', titulo: '`Cadastrar ação do Diário — ${npu}`' },
];

describe('censo dos criadores de atividade automática', () => {
  const encontrados = fontes(RAIZ).flatMap(criadoresDe);
  const chave = (c: { arquivo: string; titulo: string }) => `${c.arquivo} :: ${c.titulo}`;

  it('a varredura olha para o código de verdade', () => {
    // Sem isto, um erro no caminho faria a lista bater com zero achados e o
    // teste passaria feliz garantindo nada.
    expect(fontes(RAIZ).length).toBeGreaterThan(100);
    expect(encontrados.length).toBeGreaterThan(0);
  });

  it('são SEIS, e são exatamente estes', () => {
    expect(encontrados.map(chave).sort()).toEqual(CENSO.map(chave).sort());
  });

  /**
   * A mensagem importa mais que a asserção: quem quebrar este teste precisa
   * saber POR QUE ele existe, e não só que uma contagem mudou.
   */
  it('nenhum criador novo entrou sem passar pela lista', () => {
    const declarados = new Set(CENSO.map(chave));
    const novos = encontrados.filter((c) => !declarados.has(chave(c)));
    expect(
      novos.map((c) => `${c.arquivo}:${c.linha} — ${c.titulo}`),
    ).toEqual([]);
  });

  it('nenhum criador da lista sumiu sem a lista ser atualizada', () => {
    const vivos = new Set(encontrados.map(chave));
    expect(CENSO.map(chave).filter((k) => !vivos.has(k))).toEqual([]);
  });

  /**
   * O CRIADOR CEGO NÃO VOLTA — nem com outro nome.
   *
   * O título genérico continua sendo uma constante viva (as 5 tarefas que
   * sobraram pendentes ainda podem ser promovidas pelo DJEN), então a garantia
   * tem de ser sobre a CRIAÇÃO, não sobre a existência do texto.
   */
  it('ninguém cria mais tarefa com o título genérico', () => {
    expect(encontrados.map((c) => c.titulo)).not.toContain('TITULO_PRAZO_GENERICO');
    expect(encontrados.map((c) => c.titulo)).not.toContain("'Verificação de Intimação / Prazo'");
  });
});
