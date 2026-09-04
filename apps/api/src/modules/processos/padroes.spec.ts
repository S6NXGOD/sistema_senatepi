import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { lerConcentracao } from './padroes.service';

const RAIZ = path.resolve(__dirname, '../../..');
const SERVICO = readFileSync(path.join(RAIZ, 'src/modules/processos/padroes.service.ts'), 'utf8');
const CONTROLLER = readFileSync(
  path.join(RAIZ, 'src/modules/processos/padroes.controller.ts'),
  'utf8',
);

/**
 * PADRÕES NO ACERVO — os números destes testes saíram da produção de
 * 04/09/2026, não de estimativa.
 */
const contra = (n: Partial<Parameters<typeof lerConcentracao>[0]> = {}) => ({
  processos: 3,
  individuais: 0,
  julgados: 0,
  procedentes: 0,
  parciais: 0,
  improcedentes: 0,
  ...n,
});

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
    expect(SERVICO).toContain("coalesce((x->>'codigo')::int, 0) NOT IN");
  });

  /**
   * TODOS os assuntos, não só o principal. Das 24 vezes em que "Piso Salarial da
   * Categoria" aparece no acervo, só 11 são como principal — usar o principal
   * jogaria fora mais da metade do sinal.
   */
  it('usa todos os assuntos do processo, não só o principal', () => {
    const cte = SERVICO.slice(SERVICO.indexOf('tema AS ('), SERVICO.indexOf('julgamento AS ('));
    expect(cte).toContain("jsonb_array_elements(coalesce(p.assuntos, '[]'::jsonb))");
    expect(cte).not.toContain('assunto_principal');
  });

  /** Um adversário por processo: contar sob cada corréu inventaria padrão. */
  it('conta um adversário por processo', () => {
    const cte = SERVICO.slice(SERVICO.indexOf('adversario AS ('), SERVICO.indexOf('tema AS ('));
    expect(cte).toContain('SELECT DISTINCT ON (pp.processo_id)');
    expect(cte).toContain('ORDER BY pp.processo_id, pp.principal DESC, pe.nome');
    expect(cte).toContain('NOT IN (SELECT id FROM nosso)');
  });

  /** O desfecho ATUAL: somar instâncias contaria improcedência já reformada. */
  it('usa o julgamento mais recente de cada processo', () => {
    const cte = SERVICO.slice(SERVICO.indexOf('julgamento AS ('));
    expect(cte.slice(0, 500)).toContain('SELECT DISTINCT ON (m.processo_id)');
    expect(cte.slice(0, 500)).toContain('ORDER BY m.processo_id, m.data_movimento DESC');
  });

  /**
   * SÓ ENTRA RÉU COM PEDIDO REPETIDO. Sem isso a lista seria a mesma do bloco
   * "Contra quem litigamos" do painel, com mais colunas. O que faz disto um
   * padrão não é "temos cinco ações contra a Hapvida" — é "temos a MESMA ação
   * contra a Hapvida cinco vezes".
   */
  it('réu sem pedido repetido não é padrão', () => {
    expect(SERVICO).toContain('.filter((c) => (pedidosPorReu.get(c.parteExternaId) ?? []).length > 0)');
    expect(SERVICO).toContain('const MINIMO_PEDIDO_RECORRENTE = 3;');
  });

  /**
   * Dispersão com quatro réus deixava passar "Indenização por Dano Moral" — dez
   * processos contra quatro réus, oito deles do mesmo empregador. Concentração
   * com roupa de dispersão.
   */
  it('dispersão exige réus suficientes para ser da categoria', () => {
    expect(SERVICO).toContain('const MINIMO_DISPERSAO_PROCESSOS = 6;');
    expect(SERVICO).toContain('const MINIMO_DISPERSAO_ADVERSARIOS = 5;');
  });
});

describe('a rota', () => {
  /** Prefixo próprio: em `ProcessosController` colidiria com `@Get(':id')`. */
  it('tem controller separado e gate do módulo de processos', () => {
    expect(CONTROLLER).toContain("@Controller('panorama')");
    expect(CONTROLLER).toContain("@Modulo('processos')");
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
      SERVICO.indexOf('export interface Concentracao'),
      SERVICO.indexOf('export function lerConcentracao'),
    );
    for (const campo of ['mensagem', 'texto', 'recomendacao', 'sugestao', 'descricao']) {
      expect(contrato).not.toContain(`${campo}:`);
    }
    // O que sai é contagem, nome e slug — nada mais.
    expect(contrato).toContain('leituras: LeituraConcentracao[];');
  });
});
