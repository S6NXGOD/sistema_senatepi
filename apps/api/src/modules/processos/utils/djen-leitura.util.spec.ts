import { StatusProcesso } from '@prisma/client';
import {
  coberturaDoDiario,
  colunaDateDoDia,
  diaDaColunaDate,
  diasEntre,
  DJEN_HISTORICO_MAX_PAGINAS_PADRAO,
  DJEN_HISTORICO_POR_RODADA_PADRAO,
  inteiroDoAmbiente,
  janelaDaOab,
  janelaDoNumero,
  oabConsultavel,
  podeCarimbar,
  somarDiasAoDia,
  type MembroDaEquipe,
} from './djen-leitura.util';

/**
 * AS REGRAS DA LEITURA DO DIÁRIO, COM VALORES (14/09/2026).
 *
 * Cada uma decide se um ato chega ou some. Três noites sem a ponte perdiam os
 * atos desses dias para sempre; a OAB vazia virava falha em vez de "sem OAB"; e
 * o carimbo afirmaria "lido" sobre uma leitura que parou no teto.
 */
describe('conta de dias em texto', () => {
  it('atravessa o mês e o ano', () => {
    expect(somarDiasAoDia('2026-09-02', -3)).toBe('2026-08-30');
    expect(somarDiasAoDia('2026-12-30', 3)).toBe('2027-01-02');
    expect(diasEntre('2026-07-16', '2026-09-14')).toBe(60);
  });

  /**
   * COLUNA `@db.Date` NÃO PASSA POR FUSO. Ela chega como meia-noite UTC; por
   * `diaBR` viraria 13/09 e a rodada releria um dia a mais para sempre.
   */
  it('a coluna date ida e volta devolve o mesmo dia', () => {
    const gravado = colunaDateDoDia('2026-09-14');
    expect(gravado.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(diaDaColunaDate(gravado)).toBe('2026-09-14');
    expect(diaDaColunaDate(null)).toBeNull();
  });

  it('recusa dia fora do formato', () => {
    expect(() => somarDiasAoDia('14/09/2026', 1)).toThrow('AAAA-MM-DD');
  });
});

describe('janelaDaOab — a janela que se recupera sozinha', () => {
  const HOJE = '2026-09-14';

  it('sem carimbo, só os 3 dias de sempre (nada de colheita de 60 dias no primeiro deploy)', () => {
    expect(janelaDaOab(HOJE, null)).toEqual({
      de: '2026-09-11', ate: HOJE, dias: 3, recuperando: false, cortadaNoTeto: false,
    });
  });

  it('lida ontem: a sobreposição de 3 dias continua mandando', () => {
    expect(janelaDaOab(HOJE, '2026-09-13')).toMatchObject({ de: '2026-09-11', dias: 3, recuperando: false });
  });

  it('lida até 04/09 (a ponte caiu dez noites): relê desde 03/09', () => {
    expect(janelaDaOab(HOJE, '2026-09-04')).toEqual({
      de: '2026-09-03', ate: HOJE, dias: 11, recuperando: true, cortadaNoTeto: false,
    });
  });

  it('atraso de 90 dias é cortado em 60, e diz que cortou', () => {
    expect(janelaDaOab(HOJE, '2026-06-16')).toEqual({
      de: '2026-07-16', ate: HOJE, dias: 60, recuperando: true, cortadaNoTeto: true,
    });
  });

  it('colheita pedida à mão de 90 dias não é cortada pelo teto de 60', () => {
    expect(janelaDaOab(HOJE, '2026-09-13', { sobreposicao: 90 })).toMatchObject({
      de: '2026-06-16', dias: 90, cortadaNoTeto: false,
    });
  });

  it('colheita de 90 dias com carimbo ainda mais velho fica nos 90', () => {
    expect(janelaDaOab(HOJE, '2026-01-10', { sobreposicao: 90 })).toMatchObject({
      de: '2026-06-16', dias: 90, cortadaNoTeto: true,
    });
  });
});

describe('janelaDoNumero — o processo vivo toda noite', () => {
  const HOJE = '2026-09-14';

  it('consultado ontem às 05:10 de Teresina: lê de 10/09 a hoje', () => {
    expect(janelaDoNumero(HOJE, new Date('2026-09-13T08:10:00Z'))).toMatchObject({
      de: '2026-09-10', dias: 4, recuperando: false,
    });
    expect(janelaDoNumero(HOJE, new Date('2026-09-10T08:10:00Z'))).toMatchObject({
      de: '2026-09-07', dias: 7, recuperando: true,
    });
  });

  /** 23:30 de Teresina já é o dia seguinte em UTC — o dia que vale é o daqui. */
  it('a consulta das 23:30 de 09/09 conta como dia 09, não 10', () => {
    expect(janelaDoNumero(HOJE, new Date('2026-09-10T02:30:00Z')).de).toBe('2026-09-06');
  });

  it('dormente consultado há 7 dias: lê 10 dias', () => {
    expect(janelaDoNumero(HOJE, new Date('2026-09-07T08:00:00Z'))).toMatchObject({ de: '2026-09-04', dias: 10 });
  });

  it('sem consulta nenhuma: os 3 dias; e nunca mais de 60', () => {
    expect(janelaDoNumero(HOJE, null)).toMatchObject({ de: '2026-09-11', dias: 3 });
    expect(janelaDoNumero(HOJE, new Date('2026-03-01T08:00:00Z'))).toMatchObject({
      de: '2026-07-16', dias: 60, cortadaNoTeto: true,
    });
  });
});

describe('podeCarimbar — lido só quando foi lido inteiro', () => {
  it('leitura inteira carimba', () => {
    expect(podeCarimbar({ bateuNoTeto: false, interrompidaPor: null })).toBe(true);
  });
  it('teto de páginas não carimba', () => {
    expect(podeCarimbar({ bateuNoTeto: true, interrompidaPor: null })).toBe(false);
  });
  it('falha no meio não carimba', () => {
    expect(podeCarimbar({ bateuNoTeto: false, interrompidaPor: 'O DJEN retornou HTTP 500.' })).toBe(false);
  });
});

describe('oabConsultavel — vazio é o mesmo que não ter', () => {
  it.each([
    ['9226', 'PI', true],
    ['13.217', ' pi ', true],
    ['', 'PI', false],
    ['   ', 'PI', false],
    ['9226', '', false],
    ['9226', 'P', false],
    [null, 'PI', false],
    ['9226', null, false],
  ])('OAB %p / UF %p → %p', (oab, uf, esperado) => {
    expect(oabConsultavel(oab, uf)).toBe(esperado);
  });
});

describe('inteiroDoAmbiente — os tetos da colheita de histórico', () => {
  const H = { min: 0, max: 1000 };
  /** 200 desde 14/09/2026: os 153 vivos da produção cabem numa noite. */
  it('sem variável, o padrão: 200 processos e 10 páginas', () => {
    expect(inteiroDoAmbiente(undefined, DJEN_HISTORICO_POR_RODADA_PADRAO, H)).toBe(200);
    expect(inteiroDoAmbiente('', DJEN_HISTORICO_MAX_PAGINAS_PADRAO, { min: 1, max: 50 })).toBe(10);
  });
  it('zero desliga a colheita sem novo deploy', () => {
    expect(inteiroDoAmbiente('0', 40, H)).toBe(0);
  });
  it('valor da simulação vale; lixo volta ao padrão; acima do máximo fica no máximo', () => {
    expect(inteiroDoAmbiente('25', 40, H)).toBe(25);
    expect(inteiroDoAmbiente('vinte', 40, H)).toBe(40);
    expect(inteiroDoAmbiente('2.5', 40, H)).toBe(40);
    expect(inteiroDoAmbiente('0', 10, { min: 1, max: 50 })).toBe(10);
    expect(inteiroDoAmbiente('999', 10, { min: 1, max: 50 })).toBe(50);
  });
});

describe('coberturaDoDiario — a linha de estado da aba Publicações', () => {
  const AGORA = new Date('2026-09-14T13:00:00Z');
  const membro = (m: Partial<MembroDaEquipe>): MembroDaEquipe => ({
    id: 'u', nome: 'Fulano', nomeExibicao: null, ativo: true, oab: '9226', oabUf: 'PI', principal: false, ...m,
  });
  const base = {
    numeroCNJ: '00008146120265220002',
    statusInterno: StatusProcesso.ATIVO,
    temInstanciaViva: true,
    equipe: [] as MembroDaEquipe[],
    ultimaConsultaDjen: new Date('2026-09-12T08:07:00Z'),
    djenHistoricoLidoEm: new Date('2026-09-10T08:30:00Z'),
    agora: AGORA,
  };

  it('com OAB na equipe: principal primeiro, pelo nome curto; inativo e sem OAB não contam', () => {
    const c = coberturaDoDiario({
      ...base,
      equipe: [
        membro({ id: 'carlos', nome: 'Carlos Henrique Silva', nomeExibicao: 'Carlos Henrique' }),
        membro({ id: 'morgana', nome: 'Morgana Sousa', nomeExibicao: 'Morgana', principal: true }),
        membro({ id: 'lara', nome: 'Lara Cortez', oab: '' }),
        membro({ id: 'ex', nome: 'Ex-integrante', ativo: false }),
      ],
    });
    expect(c.porOab).toEqual([
      { id: 'morgana', nome: 'Morgana' },
      { id: 'carlos', nome: 'Carlos Henrique' },
    ]);
    expect(c.linhas).toEqual([
      'Acompanhado no Diário pela OAB de Morgana e Carlos Henrique e pelo número do processo.',
      'Consultado no Diário pelo número em 12/09.',
    ]);
    expect(c.frequenciaDoNumero).toBe('TODA_NOITE');
    expect(c.ultimaConsultaNumero).toBe('2026-09-12T08:07:00.000Z');
  });

  it('sem OAB nenhuma na equipe: só pelo número, toda noite', () => {
    const c = coberturaDoDiario({ ...base, equipe: [membro({ oab: null })] });
    expect(c.porOab).toEqual([]);
    expect(c.linhas[0]).toBe(
      'Nenhum advogado da equipe com OAB neste processo. O Diário é consultado só pelo número, toda noite.',
    );
  });

  it('arquivado é consultado a cada 7 dias, e a frase diz isso', () => {
    const c = coberturaDoDiario({ ...base, statusInterno: StatusProcesso.ARQUIVADO, temInstanciaViva: false });
    expect(c.frequenciaDoNumero).toBe('SEMANAL');
    expect(c.linhas[0]).toContain('só pelo número, a cada 7 dias.');
  });

  it('encerrado com instância viva ainda é toda noite', () => {
    const c = coberturaDoDiario({ ...base, statusInterno: StatusProcesso.ENCERRADO, temInstanciaViva: true });
    expect(c.frequenciaDoNumero).toBe('TODA_NOITE');
  });

  it('nunca consultado e sem histórico: diz as duas coisas', () => {
    const c = coberturaDoDiario({ ...base, ultimaConsultaDjen: null, djenHistoricoLidoEm: null });
    expect(c.linhas.slice(1)).toEqual([
      'Ainda não consultado pelo número.',
      'O histórico deste processo no Diário ainda não foi lido. Ele entra numa das próximas noites, ou agora pelo botão Sincronizar.',
    ]);
  });

  /** 22:30 de Teresina em 31/12/2025 já é 2026 em UTC: vale o ano daqui. */
  it('consulta de outro ano leva o ano; o dia é o de Teresina', () => {
    const c = coberturaDoDiario({ ...base, ultimaConsultaDjen: new Date('2026-01-01T01:30:00Z') });
    expect(c.linhas[1]).toBe('Consultado no Diário pelo número em 31/12/2025.');
  });

  it('pré-processual sem número: uma linha só, sem prometer consulta', () => {
    const c = coberturaDoDiario({ ...base, numeroCNJ: null, statusInterno: StatusProcesso.PRE_PROCESSUAL });
    expect(c.frequenciaDoNumero).toBeNull();
    expect(c.linhas).toEqual(['Sem número do processo: o Diário só pode ser consultado depois da distribuição.']);
  });
});
