import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { frasesDaPresenca, presencaDe, SITUACAO_FISCAL, type Presenca } from '@/lib/municipios';
import { deveAbrirSozinho } from '@/lib/guias';

const RAIZ = join(__dirname, '../../..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const TELA = ler('app/(dashboard)/municipios/page.tsx');
const DRAWER = ler('components/municipios/municipio-drawer.tsx');
const PROCESSOS = ler('app/(dashboard)/processos/page.tsx');
const AUTH = ler('lib/auth.tsx');
const NAV = ler('components/nav-items.ts');

const p = (x: Partial<Presenca>): Presenca => ({
  moram: 0,
  trabalham: 0,
  organizacoes: 0,
  acoesContra: 0,
  naComarca: 0,
  ...x,
});

/**
 * "O QUE SIGNIFICA 'O SINDICATO ALI'?" — a pergunta que motivou reescrever a
 * coluna. Eram três ícones com números, e o martelo com "114" no cartão do
 * Estado foi lido como "114 processos contra o Estado". Eram os que tramitam em
 * qualquer fórum do Piauí; contra o Estado são 8.
 */
describe('a presença por extenso', () => {
  it('diz o que cada número conta, em português', () => {
    expect(frasesDaPresenca(p({ moram: 2632, acoesContra: 8 }))).toEqual(['2.632 moram', '8 ações contra']);
    expect(frasesDaPresenca(p({ trabalham: 1, acoesContra: 1 }))).toEqual(['1 trabalha', '1 ação contra']);
  });

  /** A comarca é o fórum, não a prefeitura — nunca vira presença. */
  it('a comarca nunca vira frase de presença', () => {
    expect(frasesDaPresenca(p({ naComarca: 68 }))).toEqual([]);
  });

  it('organização só aparece quando não há ninguém morando nem trabalhando', () => {
    expect(frasesDaPresenca(p({ organizacoes: 2 }))).toEqual(['2 organizações']);
    expect(frasesDaPresenca(p({ moram: 3, organizacoes: 2 }))).toEqual(['3 moram']);
  });

  /**
   * OS DOIS SERVIÇOS SOBEM SEPARADOS. Se a tela nova encontrar a API antiga,
   * `presenca` não vem — e a lista quebraria lendo `undefined`.
   */
  it('entende a resposta da API anterior durante a troca do deploy', () => {
    expect(presencaDe({ vinculos: { filiados: 12, organizacoes: 1, processos: 4 } })).toEqual(
      p({ moram: 12, organizacoes: 1, naComarca: 4 }),
    );
    expect(presencaDe({})).toEqual(p({}));
  });
});

describe('a tela fala a língua de quem negocia', () => {
  it('a coluna se chama "Nossa presença", não "O sindicato ali"', () => {
    expect(TELA).toContain('Nossa presença');
    expect(TELA).not.toMatch(/>\s*O sindicato ali\s*</);
  });

  /** O menu diz para que a tela serve; a rota continua a mesma para link salvo não quebrar. */
  it('no menu é "Contas Públicas", e a rota continua /municipios', () => {
    expect(NAV).toMatch(/href: '\/municipios', label: 'Contas Públicas'/);
  });

  /**
   * AS EXCEÇÕES DO ART. 22 ESTÃO NO TOOLTIP. A versão anterior omitia a
   * revisão geral anual — exatamente o que a prefeitura omite na mesa.
   */
  it('o prudencial diz o que continua permitido', () => {
    expect(SITUACAO_FISCAL.PRUDENCIAL.ajuda).toMatch(/revisão geral anual/);
    expect(SITUACAO_FISCAL.ACIMA_DO_TETO.ajuda).toMatch(/revisão geral anual/);
  });

  /** A busca anda sozinha: o botão "Buscar" era um terceiro controle com ritmo próprio. */
  it('a busca não depende de botão', () => {
    expect(TELA).not.toMatch(/onClick=\{aplicarBusca\}/);
    expect(TELA).toMatch(/setTimeout\(\(\) => \{\s*setBuscaAplicada/);
  });
});

/**
 * O GUIA APARECE UMA VEZ. Abrir sozinho só quando o SERVIDOR disse que a pessoa
 * não viu — o usuário guardado no navegador pode ser de ontem, de outro
 * aparelho.
 */
describe('o guia de primeiro acesso', () => {
  it('só abre sozinho para quem sabidamente não viu', () => {
    expect(deveAbrirSozinho(undefined, 'contas-publicas')).toBe(false);
    expect(deveAbrirSozinho(null, 'contas-publicas')).toBe(false);
    expect(deveAbrirSozinho([], 'contas-publicas')).toBe(true);
    expect(deveAbrirSozinho(['contas-publicas'], 'contas-publicas')).toBe(false);
  });

  it('a tela usa o guia com a chave que o servidor aceita', () => {
    expect(TELA).toContain("useGuiaDePrimeiroAcesso('contas-publicas')");
    expect('contas-publicas').toMatch(/^[a-z0-9-]{2,40}$/);
  });

  /**
   * NADA DE `guiasVistos` NO NAVEGADOR. Toda gravação do usuário no
   * `localStorage` passa por `paraGuardar`, que tira o campo. Uma gravação
   * crua, feita amanhã por alguém, faria o guia reaparecer para quem já viu.
   */
  it('o usuário guardado no navegador nunca leva a lista de guias vistos', () => {
    expect(AUTH).not.toMatch(/persistentStore\.set\(USER_KEY,\s*JSON\.stringify/);
    const gravacoes = AUTH.match(/persistentStore\.set\(USER_KEY,/g) ?? [];
    const peloFiltro = AUTH.match(/persistentStore\.set\(USER_KEY,\s*paraGuardar\(/g) ?? [];
    expect(gravacoes.length).toBeGreaterThan(0);
    expect(peloFiltro.length).toBe(gravacoes.length);
  });
});

/**
 * OS LINKS DA FICHA RESPEITAM A MATRIZ DE CADA MÓDULO. A Triagem vê Contas
 * Públicas e não vê Processos: "8 ações contra" clicável a levaria a um acesso
 * negado.
 */
describe('a ficha só vira porta para quem pode entrar', () => {
  it('o link de processos depende de ver Processos, o de filiados de ver Filiados', () => {
    expect(DRAWER).toMatch(/verProcessos\s*\?\s*`\/processos\?enteContra=/);
    expect(DRAWER).toMatch(/verFiliados\s*\?\s*`\/filiados\?municipio=/);
    expect(DRAWER).toMatch(/verFiliados\s*\?\s*`\/filiados\?ente=/);
  });

  /** O número que abre a lista conta ATIVOS — então o link pede ativos. */
  it('os links de filiados pedem só ativos, como o número que os abre', () => {
    const links = DRAWER.match(/`\/filiados\?[^`]+`/g) ?? [];
    expect(links.length).toBe(2);
    for (const l of links) expect(l).toContain('situacao=ATIVO');
  });
});

/**
 * O FILTRO DE PROCESSOS NÃO PODE ESQUECER UMA VARIÁVEL. O memo que monta o
 * filtro listava suas dependências à mão e esqueceu `assunto` e `comarca`: os
 * links de comarca e de assunto mostravam a ficha do filtro e a lista inteira.
 */
describe('o filtro da lista de Processos acompanha tudo o que lê', () => {
  /*
    O BLOCO VAI de `const filtro = useMemo(` até o `);` que o fecha. A primeira
    versão deste teste usava uma regex que parava no primeiro `}),` — e o corpo
    tem vários (`: {}),`) —, então lia meio memo e reprovava o código certo.
    Comentários saem antes: o texto que EXPLICA o defeito cita as variáveis.
  */
  const inicio = PROCESSOS.indexOf('const filtro = useMemo(');
  const fim = PROCESSOS.indexOf('\n  );', inicio);
  const bloco = (inicio >= 0 && fim > inicio ? PROCESSOS.slice(inicio, fim) : '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const deps = bloco.match(/\[([^\]]*)\],?\s*$/)?.[1] ?? '';
  const corpo = bloco.slice(0, bloco.lastIndexOf('['));

  it('encontra o memo e a lista de dependências (o teste não passa por não achar nada)', () => {
    expect(corpo).toContain('...(comarca ?');
    expect(deps.length).toBeGreaterThan(10);
  });

  it.each(['assunto', 'comarca', 'enteContra', 'parte', 'rapido', 'filtros', 'buscaDeb', 'page', 'ordem'])(
    '"%s" é lido e está nas dependências',
    (variavel) => {
      expect(corpo).toMatch(new RegExp(`\\b${variavel}\\b`));
      expect(deps.split(',').map((s) => s.trim())).toContain(variavel);
    },
  );

  it('a chave da consulta é o próprio filtro', () => {
    expect(PROCESSOS).toContain("queryKey: ['processos', 'lista', filtro]");
  });
});
