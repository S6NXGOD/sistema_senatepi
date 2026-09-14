import {
  hojeComoTexto, periodoAnterior, periodoDoPreset, periodoPorExtenso, periodoValido, presetValido, rotuloCurtoDoPeriodo,
  rotuloDoPeriodo, rotulosDasColunas,
} from './periodo-do-pdf';

const tela = { de: '2026-08-13', ate: '2026-09-12' };

/**
 * O CABEÇALHO DA COLUNA DE NÚMEROS no PDF do uso (14/09/2026): a comparação
 * virou uma coluna ao lado da outra, e cada uma diz de que datas é.
 */
describe('o nome curto do período', () => {
  it('mesmo ano, mês inteiro, ano inteiro e virada de ano', () => {
    expect(rotuloCurtoDoPeriodo({ de: '2026-07-14', ate: '2026-08-13' })).toBe('14/07 a 13/08');
    expect(rotuloCurtoDoPeriodo({ de: '2026-07-01', ate: '2026-07-31' })).toBe('julho');
    expect(rotuloCurtoDoPeriodo({ de: '2025-01-01', ate: '2025-12-31' })).toBe('2025');
    expect(rotuloCurtoDoPeriodo({ de: '2025-12-15', ate: '2026-01-14' })).toBe('15/12/25 a 14/01/26');
  });

  it('as duas colunas lado a lado', () => {
    expect(rotulosDasColunas({ de: '2026-08-14', ate: '2026-09-13' }, { de: '2026-07-14', ate: '2026-08-13' })).toEqual([
      '14/08 a 13/09', '14/07 a 13/08',
    ]);
    expect(rotulosDasColunas({ de: '2026-08-01', ate: '2026-08-31' }, { de: '2026-07-01', ate: '2026-07-31' })).toEqual([
      'agosto', 'julho',
    ]);
  });

  /** "Este ano" contra o mesmo trecho do ano passado dava "01/01 a 14/09" nas duas colunas. */
  it('nome curto igual nas duas colunas ganha o ano', () => {
    expect(rotulosDasColunas({ de: '2026-01-01', ate: '2026-09-14' }, { de: '2025-01-01', ate: '2025-09-14' })).toEqual([
      '01/01/26 a 14/09/26', '01/01/25 a 14/09/25',
    ]);
    expect(rotulosDasColunas({ de: '2026-09-01', ate: '2026-09-30' }, { de: '2025-09-01', ate: '2025-09-30' })).toEqual([
      'setembro de 2026', 'setembro de 2025',
    ]);
  });
});

/** O destaque da primeira página do PDF (13/09/2026): texto puro, o dia não anda em fuso nenhum. */
describe('o período por extenso', () => {
  it('no mesmo mês, entre meses e entre anos', () => {
    expect(periodoPorExtenso({ de: '2026-08-01', ate: '2026-08-31' })).toBe('1º a 31 de agosto de 2026');
    expect(periodoPorExtenso({ de: '2026-09-12', ate: '2026-09-12' })).toBe('12 de setembro de 2026');
    expect(periodoPorExtenso({ de: '2026-01-01', ate: '2026-09-12' })).toBe('1º de janeiro a 12 de setembro de 2026');
    expect(periodoPorExtenso({ de: '2025-12-15', ate: '2026-01-14' })).toBe(
      '15 de dezembro de 2025 a 14 de janeiro de 2026',
    );
  });
});

/**
 * "NÃO É INTERESSANTE GERAR PDF DA PRODUTIVIDADE? MENSAL, ANUAL, PERSONALIZADO" —
 * 12/09/2026. O período é escolhido na hora de gerar, e o anterior sai sozinho
 * para a comparação.
 */
describe('o período do PDF', () => {
  it('este mês vai do dia 1 até hoje; o mês passado é o mês inteiro', () => {
    expect(periodoDoPreset('ESTE_MES', '2026-09-12', tela)).toEqual({ de: '2026-09-01', ate: '2026-09-12' });
    expect(periodoDoPreset('MES_PASSADO', '2026-09-12', tela)).toEqual({ de: '2026-08-01', ate: '2026-08-31' });
    expect(periodoDoPreset('MES_PASSADO', '2026-01-10', tela)).toEqual({ de: '2025-12-01', ate: '2025-12-31' });
  });

  it('este ano vai até hoje; o ano passado é o ano inteiro', () => {
    expect(periodoDoPreset('ESTE_ANO', '2026-09-12', tela)).toEqual({ de: '2026-01-01', ate: '2026-09-12' });
    expect(periodoDoPreset('ANO_PASSADO', '2026-09-12', tela)).toEqual({ de: '2025-01-01', ate: '2025-12-31' });
  });

  it('o da tela e as datas escolhidas, desinvertidas', () => {
    expect(periodoDoPreset('TELA', '2026-09-12', tela)).toEqual(tela);
    expect(
      periodoDoPreset('PERSONALIZADO', '2026-09-12', tela, { de: '2026-06-30', ate: '2026-06-01' }),
    ).toEqual({ de: '2026-06-01', ate: '2026-06-30' });
  });

  /** Mês em curso contra o mês anterior inteiro "cairia" pela metade no papel da assembleia. */
  it('este mês compara com os mesmos dias do mês anterior', () => {
    expect(periodoAnterior({ de: '2026-09-01', ate: '2026-09-12' }, 'ESTE_MES')).toEqual({
      de: '2026-08-01',
      ate: '2026-08-12',
    });
  });

  it('o mês passado inteiro compara com o mês anterior inteiro — fevereiro curto incluído', () => {
    expect(periodoAnterior({ de: '2026-03-01', ate: '2026-03-31' }, 'MES_PASSADO')).toEqual({
      de: '2026-02-01',
      ate: '2026-02-28',
    });
  });

  it('o ano compara com o mesmo trecho do ano anterior', () => {
    expect(periodoAnterior({ de: '2026-01-01', ate: '2026-09-12' }, 'ESTE_ANO')).toEqual({
      de: '2025-01-01',
      ate: '2025-09-12',
    });
  });

  it('fora disso, o mesmo número de dias, logo antes', () => {
    expect(periodoAnterior(tela, 'TELA')).toEqual({ de: '2026-07-13', ate: '2026-08-12' });
  });

  it('o nome do período em português de gente', () => {
    expect(rotuloDoPeriodo({ de: '2026-08-01', ate: '2026-08-31' })).toBe('agosto de 2026');
    expect(rotuloDoPeriodo({ de: '2025-01-01', ate: '2025-12-31' })).toBe('2025');
    expect(rotuloDoPeriodo(tela)).toBe('13/08/2026 a 12/09/2026');
  });

  it('hoje é o dia do calendário de quem gera, mesmo às 23h30', () => {
    expect(hojeComoTexto(new Date('2026-09-12T23:30:00-03:00'))).toBe('2026-09-12');
  });

  it('o que o navegador guardou só vale se ainda existir; data apagada não gera PDF', () => {
    expect(presetValido('MES_PASSADO')).toBe(true);
    expect(presetValido('TRIMESTRE')).toBe(false);
    expect(periodoValido({ de: '2026-09-01', ate: '' })).toBe(false);
    expect(periodoValido({ de: '2026-09-01', ate: '2026-09-12' })).toBe(true);
  });
});
