import { adversarioDoProcesso } from './dashboard.module';

/**
 * CONTRA QUEM É O PROCESSO — a pergunta que o painel precisa responder em uma
 * linha, e que "de quem é" não responde nesta base.
 *
 * Medido na produção em 04/09/2026: dos 127 processos, apenas 4 têm filiado
 * vinculado, e o próprio sindicato é o polo ATIVO em 93. Escrever o nome dele
 * em toda linha do painel não distingue nada; o réu — FMS/THE, Unimed, Hapvida
 * — distingue.
 */

const SINDICATO = 'org-do-sindicato';
const parte = (
  nome: string,
  polo: string,
  extras: { principal?: boolean; parteExternaId?: string | null } = {},
) => ({
  nome,
  polo,
  principal: extras.principal ?? false,
  parteExternaId: extras.parteExternaId ?? null,
});

describe('adversário do processo', () => {
  it('com o sindicato no polo ativo, devolve o réu', () => {
    const partes = [
      parte('SINDICATO DOS ENFERMEIROS E TÉCNICOS DE ENFERMAGEM DO ESTADO DO PIAUÍ', 'ATIVO', {
        parteExternaId: SINDICATO,
      }),
      parte('HAPVIDA ASSISTENCIA MEDICA LTDA', 'PASSIVO'),
    ];
    expect(adversarioDoProcesso(partes, SINDICATO)).toBe('HAPVIDA ASSISTENCIA MEDICA LTDA');
  });

  /** Ele figura como réu em alguns — e aí o adversário está do outro lado. */
  it('com o sindicato no polo passivo, devolve o autor', () => {
    const partes = [
      parte('MINISTERIO PUBLICO DO TRABALHO', 'ATIVO'),
      parte('SINDICATO DOS ENFERMEIROS', 'PASSIVO', { parteExternaId: SINDICATO }),
    ];
    expect(adversarioDoProcesso(partes, SINDICATO)).toBe('MINISTERIO PUBLICO DO TRABALHO');
  });

  it('prefere a parte marcada como principal do polo', () => {
    const partes = [
      parte('SINDICATO', 'ATIVO', { parteExternaId: SINDICATO }),
      parte('HAPVIDA PARTICIPACOES E INVESTIMENTOS S/A', 'PASSIVO'),
      parte('HAPVIDA ASSISTENCIA MEDICA LTDA', 'PASSIVO', { principal: true }),
    ];
    expect(adversarioDoProcesso(partes, SINDICATO)).toBe('HAPVIDA ASSISTENCIA MEDICA LTDA');
  });

  /**
   * A ARMADILHA QUE A REGRA LARGA CRIARIA.
   *
   * A primeira versão reconhecia o sindicato por "o nome começa com SINDICATO".
   * Disputa de representatividade entre sindicatos existe, e ali a regra leria
   * o ADVERSÁRIO como sendo nós — o painel apontaria o réu errado, ou nenhum.
   * A chave é a organização canônica, resolvida pelo CNPJ do tenant.
   */
  it('não confunde OUTRO sindicato com o nosso', () => {
    const partes = [
      parte('SINDICATO DOS ENFERMEIROS', 'ATIVO', { parteExternaId: SINDICATO }),
      parte('SINDICATO DOS TRABALHADORES EM SAUDE DO PIAUI', 'PASSIVO', {
        parteExternaId: 'outra-org',
      }),
    ];
    expect(adversarioDoProcesso(partes, SINDICATO)).toBe(
      'SINDICATO DOS TRABALHADORES EM SAUDE DO PIAUI',
    );
  });

  /**
   * As partes importadas do tribunal nomeiam o sindicato SEM a sigla, e 33 das
   * 263 não têm organização vinculada. Sem a chave canônica sobra o nome — e
   * aí a sigla é o que existe de específico.
   */
  it('reconhece pela sigla quando não há organização vinculada', () => {
    const partes = [
      parte('SINDICATO DOS ENFERMEIROS DO ESTADO DO PIAUI - SENATEPI', 'ATIVO'),
      parte('MUNICIPIO DE PARNAIBA-PI', 'PASSIVO'),
    ];
    expect(adversarioDoProcesso(partes, null)).toBe('MUNICIPIO DE PARNAIBA-PI');
  });

  it('sem conseguir se achar, devolve a primeira parte em vez de mentir', () => {
    const partes = [parte('EMPRESA A', 'ATIVO'), parte('EMPRESA B', 'PASSIVO')];
    expect(adversarioDoProcesso(partes, SINDICATO)).toBe('EMPRESA A');
  });

  it('sem partes, devolve nulo — a linha simplesmente não mostra o réu', () => {
    expect(adversarioDoProcesso([], SINDICATO)).toBeNull();
    expect(
      adversarioDoProcesso([parte('SINDICATO', 'ATIVO', { parteExternaId: SINDICATO })], SINDICATO),
    ).toBeNull();
  });
});
