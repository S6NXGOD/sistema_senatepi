import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  baseDoAcervo,
  historicoDe,
  lerConcentracao,
  montarPadroes,
  type Historico,
  type LinhaDoAcervo,
  type TemaDoProcesso,
} from './padroes.service';

const RAIZ = path.resolve(__dirname, '../../..');
const SERVICO = readFileSync(path.join(RAIZ, 'src/modules/processos/padroes.service.ts'), 'utf8');
const CONTROLLER = readFileSync(
  path.join(RAIZ, 'src/modules/processos/padroes.controller.ts'),
  'utf8',
);

/**
 * O SQL QUE VAI AO BANCO, e não o fonte: o texto de `baseDoAcervo` já sem os
 * comentários do TypeScript. Uma afirmação sobre a CTE não pode passar (nem
 * reprovar) por causa de uma frase de comentário.
 */
const SQL = baseDoAcervo('11222333000144').sql.replace(/\s+/g, ' ');
const cte = (nome: string, proxima: string) =>
  SQL.slice(SQL.indexOf(`${nome} AS (`), SQL.indexOf(`${proxima} AS (`));

/**
 * PADRÕES NO ACERVO — os números destes testes saíram da produção de
 * 04/09/2026 e 12/09/2026, não de estimativa.
 */
const semHistorico: Historico = {
  julgados: 0,
  procedentes: 0,
  parciais: 0,
  improcedentes: 0,
  comRecursoDepois: 0,
};
const contra = (
  n: { processos?: number; individuais?: number } & Partial<Historico> = {},
) => {
  const { processos = 3, individuais = 0, ...h } = n;
  return { processos, individuais, historico: { ...semHistorico, ...h } };
};

describe('leitura de uma concentração', () => {
  /**
   * O CASO QUE QUEBROU A PRIMEIRA VERSÃO.
   *
   * Contra a Unimed há sete ações, TODAS individuais e TODAS com procedência
   * parcial. A primeira versão devolvia uma leitura só, escolhida por
   * prioridade, e jogava fora metade do achado: "vocês ganham isto sempre" e
   * "isto podia ser uma ação só" são as duas verdadeiras, e é juntas que
   * sustentam a conversa.
   */
  it('acumula as leituras que valem ao mesmo tempo', () => {
    expect(
      lerConcentracao(contra({ processos: 7, individuais: 7, julgados: 7, parciais: 7 })),
    ).toEqual(['DESFECHO_SEMPRE_A_FAVOR', 'COLETIVA_POSSIVEL']);
  });

  /** O mais caro de ignorar: isolado parece azar, junto é a tese que não passa. */
  it('aponta desfecho sempre contrário', () => {
    expect(
      lerConcentracao(contra({ processos: 3, julgados: 3, improcedentes: 3 })),
    ).toContain('DESFECHO_SEMPRE_CONTRA');
  });

  it('procedência e procedência em parte contam juntas como favorável', () => {
    expect(
      lerConcentracao(contra({ julgados: 3, procedentes: 1, parciais: 2 })),
    ).toContain('DESFECHO_SEMPRE_A_FAVOR');
  });

  /** Um resultado divergente já desfaz o "sempre" — nos dois sentidos. */
  it('um desfecho fora do padrão desfaz a leitura de uniformidade', () => {
    const misto = lerConcentracao(contra({ julgados: 3, parciais: 2, improcedentes: 1 }));
    expect(misto).not.toContain('DESFECHO_SEMPRE_A_FAVOR');
    expect(misto).not.toContain('DESFECHO_SEMPRE_CONTRA');
    expect(misto).toEqual(['REINCIDENCIA']);
  });

  /**
   * UM julgamento não é padrão de julgamento. Sem este piso, o primeiro processo
   * decidido contra viraria "a tese não passa" — com amostra de um.
   */
  it('um julgamento só não vira leitura de desfecho', () => {
    expect(lerConcentracao(contra({ julgados: 1, improcedentes: 1 }))).toEqual(['REINCIDENCIA']);
  });

  it('sem julgamento nenhum, sobra o que se sabe: a reincidência', () => {
    expect(lerConcentracao(contra())).toEqual(['REINCIDENCIA']);
  });

  it('a maioria individual é o que sugere a ação coletiva', () => {
    expect(lerConcentracao(contra({ processos: 5, individuais: 3 }))).toContain(
      'COLETIVA_POSSIVEL',
    );
    // Metade não é maioria: três de seis fica de fora.
    expect(lerConcentracao(contra({ processos: 6, individuais: 3 }))).not.toContain(
      'COLETIVA_POSSIVEL',
    );
  });

  /**
   * A SENTENÇA NÃO É O RESULTADO FINAL. Em 12/09/2026, 16 dos 30 improcedentes
   * ativos tinham recurso julgado depois. Um "sempre contrário" com acórdão
   * posterior pode estar reformado — e o sistema não sabe em favor de quem.
   */
  it('recurso julgado depois cala as duas leituras de "sempre"', () => {
    expect(
      lerConcentracao(contra({ julgados: 3, improcedentes: 3, comRecursoDepois: 1 })),
    ).toEqual(['REINCIDENCIA']);
    expect(
      lerConcentracao(
        contra({ processos: 4, individuais: 4, julgados: 4, parciais: 4, comRecursoDepois: 2 }),
      ),
    ).toEqual(['COLETIVA_POSSIVEL']);
  });
});

/* ------------------------------------------------------------------------ */

let seq = 0;
const processo = (n: Partial<LinhaDoAcervo> = {}): LinhaDoAcervo => ({
  processoId: `p${++seq}`,
  status: 'ATIVO',
  tipoAcao: 'INDIVIDUAL',
  ano: 2025,
  dataDistribuicao: new Date('2025-03-10T03:00:00Z'),
  parteExternaId: 'hapvida',
  adversario: 'HAPVIDA',
  tipoAdversario: 'JURIDICA',
  julgamento: null,
  recursoDepois: false,
  ...n,
});
const temas = (linhas: LinhaDoAcervo[], ...assuntos: string[]): TemaDoProcesso[] =>
  linhas.flatMap((l) => assuntos.map((assunto) => ({ processoId: l.processoId, assunto })));

describe('o histórico olha todas as ajuizadas', () => {
  /**
   * O CASO DA AUDITORIA: três improcedências ativas contra o réu e duas
   * procedências já em execução. Contando só as ativas, a tela dizia "sempre
   * contrário" — justamente a leitura mais cara, e falsa.
   */
  it('procedência já em execução desfaz o "sempre contrário" das ativas', () => {
    const ativas = [1, 2, 3].map(() => processo({ julgamento: 220 }));
    const execucao = [1, 2].map(() => processo({ status: 'GANHO_EXECUCAO', julgamento: 219 }));
    const { concentracoes } = montarPadroes(
      [...ativas, ...execucao],
      temas([...ativas, ...execucao], 'Indenização por Greve'),
    );

    expect(concentracoes).toHaveLength(1);
    const [c] = concentracoes;
    // As ativas continuam sendo o que o cartão chama de ativas.
    expect(c).toMatchObject({ processos: 3, julgados: 3, improcedentes: 3, procedentes: 0 });
    expect(c.historico).toEqual({
      julgados: 5,
      procedentes: 2,
      parciais: 0,
      improcedentes: 3,
      comRecursoDepois: 0,
    });
    expect(c.leituras).not.toContain('DESFECHO_SEMPRE_CONTRA');
    expect(c.leituras).toContain('COLETIVA_POSSIVEL');
  });

  it('encerrado e improcedente entram no histórico; pré-processual e rascunho, não', () => {
    const linhas = [
      processo({ julgamento: 221 }),
      processo({ status: 'ENCERRADO', julgamento: 221 }),
      processo({ status: 'IMPROCEDENTE', julgamento: 220 }),
      processo({ status: 'ARQUIVADO', julgamento: 219, recursoDepois: true }),
      processo({ status: 'PRE_PROCESSUAL', julgamento: 220 }),
      processo({ status: 'RASCUNHO', julgamento: 220 }),
    ];
    expect(historicoDe(linhas)).toEqual({
      julgados: 4,
      procedentes: 1,
      parciais: 2,
      improcedentes: 1,
      comRecursoDepois: 1,
    });
  });

  it('recurso depois sem sentença não conta — só existe depois de uma', () => {
    expect(historicoDe([processo({ julgamento: null, recursoDepois: true })]).comRecursoDepois).toBe(0);
  });

  it('acórdão posterior numa ação ENCERRADA também cala o "sempre"', () => {
    const ativas = [1, 2, 3].map(() => processo({ julgamento: 220 }));
    const encerrada = processo({ status: 'ENCERRADO', julgamento: 220, recursoDepois: true });
    const { concentracoes } = montarPadroes(
      [...ativas, encerrada],
      temas([...ativas, encerrada], 'Horas Extras'),
    );
    expect(concentracoes[0].historico).toMatchObject({ julgados: 4, improcedentes: 4, comRecursoDepois: 1 });
    expect(concentracoes[0].leituras).not.toContain('DESFECHO_SEMPRE_CONTRA');
  });

  it('sem recurso, o histórico uniforme sustenta a leitura', () => {
    const ativas = [1, 2, 3].map(() => processo({ tipoAcao: 'COLETIVA', julgamento: 220 }));
    const { concentracoes } = montarPadroes(ativas, temas(ativas, 'Horas Extras'));
    expect(concentracoes[0].leituras).toEqual(['DESFECHO_SEMPRE_CONTRA']);
  });
});

describe('quem entra continua decidido pelo acervo ativo', () => {
  /** Os cartões dizem "N ações ativas" e o link abre `status=ATIVO`. */
  it('réu com duas ativas e muitas encerradas não é concentração', () => {
    const linhas = [
      processo(),
      processo(),
      ...[1, 2, 3, 4].map(() => processo({ status: 'ENCERRADO' })),
    ];
    expect(montarPadroes(linhas, temas(linhas, 'Horas Extras')).concentracoes).toEqual([]);
  });

  /**
   * SÓ ENTRA RÉU COM PEDIDO REPETIDO. Sem isso a lista seria a mesma do bloco
   * "Contra quem litigamos" do painel, com mais colunas. O que faz disto um
   * padrão não é "temos cinco ações contra a Hapvida" — é "temos a MESMA ação
   * contra a Hapvida cinco vezes".
   */
  it('réu sem pedido repetido não é padrão', () => {
    const [a, b, c] = [processo(), processo(), processo()];
    const t = [
      { processoId: a.processoId, assunto: 'Horas Extras' },
      { processoId: b.processoId, assunto: 'Horas Extras' },
      { processoId: c.processoId, assunto: 'Insalubridade' },
    ];
    expect(montarPadroes([a, b, c], t).concentracoes).toEqual([]);
  });

  it('o pedido repetido conta nas ativas, não nas encerradas', () => {
    const ativas = [processo(), processo(), processo()];
    const encerrada = processo({ status: 'ENCERRADO' });
    const t = [
      ...temas(ativas.slice(0, 2), 'Horas Extras'),
      ...temas([encerrada], 'Horas Extras'),
      ...temas(ativas, 'Insalubridade'),
    ];
    const [c] = montarPadroes([...ativas, encerrada], t).concentracoes;
    expect(c.pedidos).toEqual([{ assunto: 'Insalubridade', processos: 3 }]);
  });

  it('leva o tipo da parte, e réu pessoa física sai marcado', () => {
    const linhas = [1, 2, 3].map(() =>
      processo({ parteExternaId: 'fulano', adversario: 'FULANO', tipoAdversario: 'FISICA' }),
    );
    const [c] = montarPadroes(linhas, temas(linhas, 'Cobrança')).concentracoes;
    expect(c.tipo).toBe('FISICA');
  });

  it('tipo desconhecido vira nulo, nunca texto solto no contrato', () => {
    const linhas = [1, 2, 3].map(() => processo({ tipoAdversario: null }));
    expect(montarPadroes(linhas, temas(linhas, 'Cobrança')).concentracoes[0].tipo).toBeNull();
  });

  /**
   * Dispersão com quatro réus deixava passar "Indenização por Dano Moral" — dez
   * processos contra quatro réus, oito deles do mesmo empregador. Concentração
   * com roupa de dispersão.
   */
  it('dispersão exige seis ativas e cinco réus distintos entre elas', () => {
    const cinco = ['a', 'b', 'c', 'd', 'e', 'a'].map((id) =>
      processo({ parteExternaId: id, adversario: id.toUpperCase() }),
    );
    expect(montarPadroes(cinco, temas(cinco, 'Piso Salarial')).dispersoes).toHaveLength(1);

    const quatro = ['a', 'b', 'c', 'd', 'a', 'a'].map((id) =>
      processo({ parteExternaId: id, adversario: id.toUpperCase() }),
    );
    expect(montarPadroes(quatro, temas(quatro, 'Piso Salarial')).dispersoes).toEqual([]);

    // O quinto réu numa ação ENCERRADA não torna o pedido "da categoria" hoje.
    const comEncerrada = [
      ...['a', 'b', 'c', 'd', 'a', 'b'].map((id) => processo({ parteExternaId: id })),
      processo({ parteExternaId: 'e', status: 'ENCERRADO' }),
    ];
    expect(montarPadroes(comEncerrada, temas(comEncerrada, 'Piso Salarial')).dispersoes).toEqual([]);
  });

  it('pré-processual não entra em conta nenhuma, nem com tema', () => {
    const linhas = [1, 2, 3].map(() => processo({ status: 'PRE_PROCESSUAL' }));
    expect(montarPadroes(linhas, temas(linhas, 'Horas Extras'))).toEqual({
      concentracoes: [],
      dispersoes: [],
    });
  });
});

describe('a série por ano conta todas as ajuizadas', () => {
  /**
   * VIÉS DE SOBREVIVÊNCIA. Em 12/09/2026, 2023 aparecia com 18 ações de 27
   * ajuizadas e 2024 com 12 de 20: o ano antigo já teve tempo de encerrar, e a
   * tendência pendia para "crescendo" por construção.
   */
  it('o ano antigo não encolhe porque as ações dele terminaram', () => {
    const reus = ['a', 'b', 'c', 'd', 'e', 'f'];
    const ativas = reus.map((id) => processo({ parteExternaId: id, ano: 2025 }));
    const antigas = reus.map((id) =>
      processo({ parteExternaId: id, ano: 2023, status: id < 'd' ? 'ENCERRADO' : 'ARQUIVADO' }),
    );
    const semData = processo({ parteExternaId: 'a', ano: null, dataDistribuicao: null });
    const pre = processo({ parteExternaId: 'b', ano: 2025, status: 'PRE_PROCESSUAL' });
    const linhas = [...ativas, ...antigas, semData, pre];

    const [d] = montarPadroes(linhas, temas(linhas, 'Acordo e Convenção Coletivos')).dispersoes;
    expect(d.processos).toBe(7); // as ativas, com a sem data
    expect(d.porAno).toEqual([
      { ano: 2023, processos: 6 },
      { ano: 2024, processos: 0 },
      { ano: 2025, processos: 6 },
    ]);
    expect(d.historico.julgados).toBe(0);
  });

  it('"desde" continua sendo a distribuição mais antiga entre as ativas', () => {
    const reus = ['a', 'b', 'c', 'd', 'e', 'f'];
    const ativas = reus.map((id, i) =>
      processo({ parteExternaId: id, dataDistribuicao: new Date(`202${i}-05-02T03:00:00Z`) }),
    );
    const antiga = processo({
      parteExternaId: 'a',
      status: 'ENCERRADO',
      dataDistribuicao: new Date('2015-01-01T03:00:00Z'),
    });
    const [d] = montarPadroes([...ativas, antiga], temas([...ativas, antiga], 'X')).dispersoes;
    expect(d.desde).toBe('2020-05-02');
  });
});

/**
 * A LISTA DE ASSUNTOS DE RITO SALVOU A FUNCIONALIDADE DE NASCER MENTINDO.
 *
 * O primeiro resultado que o serviço produziu foi "3 processos contra a FMS/THE
 * sobre Assistência Judiciária Gratuita, os três improcedentes". Os três
 * discutiam coisas diferentes — conversão em pecúnia, hora extra e
 * irredutibilidade de vencimentos. O que compartilhavam era só a etiqueta do
 * pedido de gratuidade, que o CNJ marcou como assunto principal nos três.
 */
describe('o que entra na detecção', () => {
  it('etiqueta processual fica de fora, pelo CÓDIGO do CNJ', () => {
    expect(SERVICO).toContain('const ASSUNTOS_DE_RITO = [');
    for (const codigo of ['8843', '8867', '10655', '13237', '14046']) {
      expect(SERVICO).toContain(`  ${codigo},`);
    }
    // Por código e não por nome: o tribunal manda "Ônus da Prova " com espaço
    // sobrando e dois códigos distintos para "Honorários Advocatícios".
    expect(SQL).toContain("coalesce((x->>'codigo')::int, 0) NOT IN");
  });

  /**
   * TODOS os assuntos, não só o principal. Das 24 vezes em que "Piso Salarial da
   * Categoria" aparece no acervo, só 11 são como principal — usar o principal
   * jogaria fora mais da metade do sinal.
   */
  it('usa todos os assuntos do processo, não só o principal', () => {
    const tema = cte('tema', 'julgamento');
    expect(tema).toContain("jsonb_array_elements(coalesce(p.assuntos, '[]'::jsonb))");
    expect(tema).not.toContain('assunto_principal');
  });

  /** Um adversário por processo: contar sob cada corréu inventaria padrão. */
  it('conta um adversário por processo', () => {
    const adversario = cte('adversario', 'tema');
    expect(adversario).toContain('SELECT DISTINCT ON (pp.processo_id)');
    expect(adversario).toContain('ORDER BY pp.processo_id, pp.principal DESC, pe.nome');
    expect(adversario).toContain('NOT IN (SELECT id FROM nosso)');
  });

  /**
   * O ADVERSÁRIO É DO OUTRO LADO. Sem olhar polo, numa ação CONTRA o sindicato
   * o "réu" era o autor, e o MPT cadastrado como terceiro podia ser o escolhido.
   * Mesma régua de `adversarioDoProcesso` do painel (ver adversario.spec.ts).
   *
   * Não há Postgres nos testes: isto trava a FORMA da regra no SQL gerado. A
   * contagem tem de ser conferida contra a produção.
   */
  it('escolhe o polo oposto ao nosso, senão o passivo, e nunca o terceiro', () => {
    const lado = cte('lado', 'adversario');
    expect(lado).toContain("WHERE pp.polo <> 'TERCEIRO'");
    expect(lado).toContain('pp.filiado_id IS NOT NULL');
    // O sindicato manda antes do filiado — booleano de EXISTS, nunca nulo no ORDER BY.
    expect(lado).toContain(
      'ORDER BY pp.processo_id, EXISTS (SELECT 1 FROM nosso n WHERE n.id = pp.parte_externa_id) DESC',
    );

    const adversario = cte('adversario', 'tema');
    expect(adversario).toContain('LEFT JOIN lado l ON l.processo_id = pp.processo_id');
    expect(adversario).toContain("AND pp.polo <> 'TERCEIRO'");
    expect(adversario).toContain(
      "CASE WHEN l.polo IS NULL THEN pp.polo = 'PASSIVO' ELSE pp.polo <> l.polo END",
    );
    expect(adversario).toContain('pe.tipo::text AS tipo');
  });

  /** A SENTENÇA mais recente, e se houve recurso julgado depois dela. */
  it('usa o julgamento mais recente de cada processo e marca o recurso posterior', () => {
    const julgamento = SQL.slice(SQL.indexOf('julgamento AS ('));
    expect(julgamento).toContain('SELECT DISTINCT ON (m.processo_id)');
    expect(julgamento).toContain('ORDER BY m.processo_id, m.data_movimento DESC');
    expect(julgamento).toContain('AND r.data_movimento > m.data_movimento');
    expect(julgamento).toContain(') AS recurso_depois');
    // Os códigos vão como parâmetro: 219–221 na sentença, 237–239 no recurso.
    const valores = baseDoAcervo('11222333000144').values;
    for (const codigo of [219, 220, 221, 237, 238, 239]) expect(valores).toContain(codigo);
  });
});

describe('a rota', () => {
  /** Prefixo próprio: em `ProcessosController` colidiria com `@Get(':id')`. */
  it('tem controller separado e gate do módulo de processos', () => {
    expect(CONTROLLER).toContain("@Controller('panorama')");
    expect(CONTROLLER).toContain("@Modulo('processos')");
    expect(CONTROLLER).not.toMatch(/@Roles\(/);
  });

  /**
   * A API DEVOLVE FATO E RÓTULO; A FRASE É DA TELA.
   *
   * Não é preciosismo de arquitetura: no dia em que alguém quiser suavizar ou
   * corrigir a redação de uma leitura jurídica, o lugar de mexer tem de ser um
   * arquivo de interface, não uma consulta SQL. E um campo de texto pronto no
   * payload é o caminho mais curto para o sistema começar a opinar.
   */
  it('o payload não carrega frase pronta', () => {
    const contrato = SERVICO.slice(
      SERVICO.indexOf('export interface Desfechos'),
      SERVICO.indexOf('export function lerConcentracao'),
    );
    for (const campo of ['mensagem', 'texto', 'recomendacao', 'sugestao', 'descricao']) {
      expect(contrato).not.toContain(`${campo}:`);
    }
    // O que sai é contagem, nome e slug — nada mais.
    expect(contrato).toContain('leituras: LeituraConcentracao[];');
    expect(contrato).toContain('historico: Historico;');
  });

  /** O payload real também: as chaves de um cartão são exatamente estas. */
  it('as chaves do cartão são as do contrato', () => {
    const linhas = [1, 2, 3].map(() => processo());
    const { concentracoes } = montarPadroes(linhas, temas(linhas, 'Horas Extras'));
    expect(Object.keys(concentracoes[0]).sort()).toEqual(
      [
        'adversario', 'desde', 'historico', 'improcedentes', 'individuais', 'julgados',
        'leituras', 'parciais', 'parteExternaId', 'pedidos', 'procedentes', 'processos', 'tipo',
      ].sort(),
    );
  });
});
