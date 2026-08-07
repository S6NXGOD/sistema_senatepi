import { classificarAudiencia, instanciaBaixada } from './audiencia.util';

/** Instante UTC equivalente a uma data/hora local de Teresina (UTC-3). */
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe('Radar de audiências — classificação das movimentações do DataJud', () => {
  const dataMov = new Date('2026-07-20T10:00:00Z');

  describe('o que DEVE virar alerta', () => {
    it('designação com data e hora no texto', () => {
      const r = classificarAudiencia(
        'Audiência de Conciliação designada para o dia 15/08/2026 às 14:30, Sala 3',
        null,
        dataMov,
      );
      expect(r.ehAudiencia).toBe(true);
      expect(r.audienciaData).toEqual(brt('2026-08-15T14:30:00'));
    });

    it('redesignação — é data nova, exige novo agendamento', () => {
      const r = classificarAudiencia('Audiência redesignada para 03/09/2026 09:00', null, dataMov);
      expect(r.ehAudiencia).toBe(true);
      expect(r.audienciaData).toEqual(brt('2026-09-03T09:00:00'));
    });

    it('código TPU de designação vale mesmo com texto genérico', () => {
      expect(classificarAudiencia('Ato ordinatório praticado', 11025, dataMov).ehAudiencia).toBe(true);
      expect(classificarAudiencia('Movimento processual', 12173, dataMov).ehAudiencia).toBe(true);
    });

    it('data por extenso', () => {
      const r = classificarAudiencia(
        'Designada audiência de instrução para 5 de outubro de 2026 às 8h30',
        null,
        dataMov,
      );
      expect(r.ehAudiencia).toBe(true);
      expect(r.audienciaData).toEqual(brt('2026-10-05T08:30:00'));
    });

    it('sem hora no texto → meia-noite (a tela mostra só a data)', () => {
      const r = classificarAudiencia('Audiência designada para 10/12/2026', null, dataMov);
      expect(r.audienciaData).toEqual(brt('2026-12-10T00:00:00'));
    });

    it('sessão de julgamento incluída em pauta', () => {
      expect(
        classificarAudiencia('Processo incluído em pauta de julgamento - sessão de julgamento de 22/09/2026', null, dataMov)
          .ehAudiencia,
      ).toBe(true);
    });

    it('acento e caixa não interferem', () => {
      expect(classificarAudiencia('AUDIÊNCIA DESIGNADA PARA 01/09/2026', null, dataMov).ehAudiencia).toBe(true);
    });
  });

  describe('o que NÃO pode virar alerta (item 2 da regra)', () => {
    it('disponibilização no diário — é comunicação, não designação', () => {
      expect(
        classificarAudiencia('Disponibilização no Diário da Justiça Eletrônico', 12265, dataMov).ehAudiencia,
      ).toBe(false);
    });

    it('publicação que apenas MENCIONA audiência', () => {
      expect(
        classificarAudiencia('Publicação de intimação referente à audiência', 85, dataMov).ehAudiencia,
      ).toBe(false);
    });

    it('audiência cancelada / sem efeito — mesmo com código TPU de designação', () => {
      expect(classificarAudiencia('Cancelada a audiência designada para 15/08/2026', 11025, dataMov).ehAudiencia).toBe(false);
      expect(classificarAudiencia('Audiência designada tornada sem efeito', null, dataMov).ehAudiencia).toBe(false);
      expect(classificarAudiencia('Audiência não realizada', null, dataMov).ehAudiencia).toBe(false);
    });

    it('movimentações comuns do dia a dia', () => {
      for (const texto of ['Decurso de Prazo', 'Conclusos para despacho', 'Juntada de petição', 'Distribuição por sorteio']) {
        expect(classificarAudiencia(texto, null, dataMov).ehAudiencia).toBe(false);
      }
    });

    it('texto vazio', () => {
      expect(classificarAudiencia('', null, dataMov).ehAudiencia).toBe(false);
      expect(classificarAudiencia(null, null, dataMov).ehAudiencia).toBe(false);
    });
  });

  describe('extração de data — casos capciosos', () => {
    it('ignora a data da publicação e pega a data DEPOIS do verbo de designação', () => {
      const r = classificarAudiencia(
        'Nos autos publicados em 20/07/2026, fica designada audiência para 15/08/2026 às 14:00',
        null,
        dataMov,
      );
      expect(r.audienciaData).toEqual(brt('2026-08-15T14:00:00'));
    });

    it('não confunde número de sala/protocolo distante com horário', () => {
      const r = classificarAudiencia(
        'Audiência designada para 15/08/2026. Local: Fórum Cível, anexo II, guichê 09:15 do bloco B — observação com mais de sessenta caracteres de distância',
        null,
        dataMov,
      );
      expect(r.audienciaData).toEqual(brt('2026-08-15T00:00:00'));
    });

    it('data inexistente é descartada', () => {
      expect(classificarAudiencia('Audiência designada para 31/02/2026', null, dataMov).audienciaData).toBeNull();
    });

    it('data absurda (erro de digitação) é descartada', () => {
      expect(classificarAudiencia('Audiência designada para 15/08/2099', null, dataMov).audienciaData).toBeNull();
    });

    it('designação sem data alguma continua sendo alerta, só que sem data', () => {
      const r = classificarAudiencia('Audiência de conciliação designada', null, dataMov);
      expect(r.ehAudiencia).toBe(true);
      expect(r.audienciaData).toBeNull();
    });
  });
});

/**
 * Códigos conferidos contra o índice real do TJPI (`movimentos.codigo` →
 * `movimentos.nome`), e não deduzidos da tabela da TPU: 22 = Baixa Definitiva,
 * 848 = Trânsito em julgado, 893 = Desarquivamento.
 *
 * É o que decide se um GRAU ainda está vivo — e, por consequência, se o
 * processo continua na varredura noturna.
 */
describe('instanciaBaixada — o grau ainda está vivo?', () => {
  const mov = (codigo: number | null, data: string) => ({
    codigoMovimento: codigo,
    dataMovimento: new Date(data),
  });

  it('instância sem movimento algum não está baixada', () => {
    expect(instanciaBaixada([])).toBe(false);
  });

  it('andamento comum não baixa', () => {
    expect(instanciaBaixada([mov(51, '2026-05-13'), mov(85, '2026-05-04')])).toBe(false);
  });

  /**
   * O CASO QUE MOTIVOU A REGRA — dado real do processo
   * 0000600-48.2023.5.22.0108 (TRT22): trânsito em julgado em 28/08/2025 e, no
   * mesmo dia, "Liquidação iniciada", seguida de mais 125 movimentos até julho
   * de 2026. É execução correndo, não processo encerrado.
   */
  it('baixa seguida de EXECUÇÃO não deixa a instância baixada', () => {
    expect(
      instanciaBaixada([
        mov(848, '2025-08-28'), // Trânsito em julgado
        mov(11384, '2025-08-28'), // Liquidação iniciada — mesmo dia, é eco
        mov(51, '2025-09-10'), // dia POSTERIOR: a instância voltou a andar
        mov(60, '2026-07-26'),
      ]),
    ).toBe(false);
  });

  /**
   * O eco do próprio arquivamento (publicação e expedição no mesmo dia) não pode
   * ressuscitar uma instância — é o que obriga a comparação por DIA, e não por
   * instante.
   */
  it('publicação da própria baixa, no mesmo dia, NÃO reabre', () => {
    expect(
      instanciaBaixada([
        mov(22, '2025-08-27'),
        mov(92, '2025-08-27'), // Publicação do arquivamento
        mov(60, '2025-08-27'), // Expedição de documento
      ]),
    ).toBe(true);
  });

  it('Baixa Definitiva (22) baixa', () => {
    expect(instanciaBaixada([mov(51, '2026-01-10'), mov(22, '2026-02-01')])).toBe(true);
  });

  /**
   * O CASO DE PRODUÇÃO — 0001000-26.2022.5.22.0002 (TRT22), conferido no CNJ em
   * 07/08/2026: trânsito em julgado e liquidação em 22/08/2025, execução extinta
   * em 24/11/2025 e arquivamento definitivo (246) em 02/02/2026, sem nada
   * depois. Como 246 não contava como baixa, a instância seguia "viva" e a lista
   * mostrava o processo em Execução — meses depois de ele ter acabado.
   */
  it('Arquivamento definitivo (246) baixa — a forma mais comum de encerrar', () => {
    expect(
      instanciaBaixada([
        mov(848, '2025-08-22'),
        mov(11384, '2025-08-22'),
        mov(196, '2025-11-24'),
        mov(246, '2026-02-02'),
      ]),
    ).toBe(true);
  });

  it('arquivamento definitivo seguido de desarquivamento NÃO baixa', () => {
    expect(instanciaBaixada([mov(246, '2026-02-02'), mov(893, '2026-03-10')])).toBe(false);
  });

  it('Trânsito em julgado (848) baixa', () => {
    expect(instanciaBaixada([mov(848, '2026-02-01')])).toBe(true);
  });

  /** Sem isto, o processo desarquivado sairia da varredura justamente ao voltar a andar. */
  it('Desarquivamento (893) POSTERIOR desfaz a baixa', () => {
    expect(instanciaBaixada([mov(22, '2026-02-01'), mov(893, '2026-06-15')])).toBe(false);
  });

  it('Desarquivamento ANTERIOR não desfaz a baixa que veio depois', () => {
    expect(instanciaBaixada([mov(893, '2025-03-01'), mov(22, '2026-02-01')])).toBe(true);
  });

  /**
   * O CNJ não garante ordenação e alguns tribunais devolvem a lista decrescente.
   * A comparação é por DATA, nunca pela posição no array.
   */
  it('não depende da ordem do array', () => {
    expect(instanciaBaixada([mov(893, '2026-06-15'), mov(22, '2026-02-01')])).toBe(false);
    expect(instanciaBaixada([mov(22, '2026-02-01'), mov(893, '2026-06-15')])).toBe(false);
  });

  it('movimento sem código ou com data inválida é ignorado sem quebrar', () => {
    expect(instanciaBaixada([mov(null, '2026-01-01'), mov(22, 'data-ruim')])).toBe(false);
    expect(instanciaBaixada([mov(22, '2026-02-01'), mov(893, 'data-ruim')])).toBe(true);
  });
});
