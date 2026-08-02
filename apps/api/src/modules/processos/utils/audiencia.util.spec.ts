import { classificarAudiencia } from './audiencia.util';

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
