import {
  classificarProvidencia,
  corpoDaPublicacao,
  diasParaLembrete,
  limparTextoPublicacao,
  PROVIDENCIAS,
} from './providencia.util';

const p = (texto: string, tipo?: string) => classificarProvidencia(texto, tipo).providencia;
const prazo = (texto: string) => classificarProvidencia(texto).prazoMencionadoDias;

describe('classificarProvidencia — o que a publicação está pedindo', () => {
  /**
   * TEXTOS REAIS, colhidos da API do DJEN (TJPI, 04/08/2026). São a razão de a
   * integração existir: o DataJud, para os mesmos atos, entregaria apenas
   * "Expedição de documento".
   */
  describe('publicações reais do DJEN', () => {
    it('"apresentar réplica no prazo de 15 dias" → elaborar manifestação, 15 dias', () => {
      const texto =
        'PODER JUDICIÁRIO DO ESTADO DO PIAUÍ ATO ORDINATÓRIO Intimo a parte autora a ' +
        'apresentar réplica no prazo de 15 dias. CONTESTAÇÃO TEMPESTIVA';
      const r = classificarProvidencia(texto, 'Intimação');
      expect(r.providencia).toBe('ELABORAR_MANIFESTACAO');
      expect(r.prazoMencionadoDias).toBe(15);
    });

    /**
     * Cita apelação, mas o trabalho é REDIGIR a peça — não decidir se recorre.
     * É o caso que fixa a ordem entre manifestação e recurso.
     */
    it('"apresentar contrarrazões no prazo legal" → manifestação, sem prazo numérico', () => {
      const texto = 'ATO ORDINATÓRIO Intimo a parte apelada a apresentar contrarrazões no prazo legal.';
      const r = classificarProvidencia(texto, 'Intimação');
      expect(r.providencia).toBe('ELABORAR_MANIFESTACAO');
      expect(r.prazoMencionadoDias).toBeNull();
    });
  });

  describe('cada providência', () => {
    it('audiência designada → preparar audiência', () => {
      expect(p('Audiência de conciliação designada para 15/08/2026 às 14:30')).toBe(
        'PREPARAR_AUDIENCIA',
      );
    });

    it('audiência só MENCIONADA não é preparação de pauta', () => {
      expect(p('Intimo a parte sobre o resultado da audiência realizada', 'Intimação')).toBe(
        'ANALISAR_INTIMACAO',
      );
    });

    it('sentença → analisar sentença', () => {
      expect(p('Fica a parte intimada da sentença proferida nos autos', 'Intimação')).toBe(
        'ANALISAR_SENTENCA',
      );
      expect(p('JULGO PROCEDENTE o pedido inicial', 'Intimação')).toBe('ANALISAR_SENTENCA');
    });

    it('acórdão e prazo recursal → avaliar recurso', () => {
      expect(p('Publicado o acórdão. Intime-se.', 'Intimação')).toBe('AVALIAR_RECURSO');
      expect(p('Intimação para ciência, com abertura de prazo recursal', 'Intimação')).toBe(
        'AVALIAR_RECURSO',
      );
    });

    it('juntada de documento → juntar documentos', () => {
      expect(p('Intimo a parte a juntar o comprovante de residência', 'Intimação')).toBe(
        'JUNTAR_DOCUMENTOS',
      );
    });

    it('emenda à inicial → solicitar documentos ao filiado', () => {
      expect(p('Intime-se o autor para emenda à inicial em 15 dias', 'Intimação')).toBe(
        'SOLICITAR_DOCUMENTOS_FILIADO',
      );
    });

    it('acordo homologado → comunicar filiado', () => {
      expect(p('Acordo homologado. Arquivem-se os autos.', 'Intimação')).toBe('COMUNICAR_FILIADO');
    });

    it('intimação sem padrão reconhecido cai no genérico', () => {
      expect(p('Intimo as partes do inteiro teor do ato praticado.', 'Intimação')).toBe(
        'ANALISAR_INTIMACAO',
      );
    });

    it('lista de distribuição não pede nada', () => {
      expect(p('Lista de distribuição por sorteio', 'Lista de distribuição')).toBe('NENHUMA');
    });

    it('texto vazio não vira atividade', () => {
      expect(p('')).toBe('NENHUMA');
      expect(classificarProvidencia(null).providencia).toBe('NENHUMA');
    });
  });

  /**
   * A rede de segurança: com `tipoComunicacao = Intimação`, alguma atividade
   * SEMPRE nasce. É o comportamento que já existe hoje, e ele não pode regredir
   * por causa de uma classificação mais fina.
   */
  it('toda intimação gera atividade, mesmo sem padrão no texto', () => {
    expect(p('Texto que não casa com regra nenhuma.', 'Intimação')).toBe('ANALISAR_INTIMACAO');
    expect(p('Texto que não casa com regra nenhuma.', 'Citação')).toBe('ANALISAR_INTIMACAO');
  });

  it('cada providência aponta para um tipo de evento que já existe', () => {
    const tiposSistema = [
      'AUDIENCIA', 'PRAZO', 'CONSULTA_JURIDICA', 'REUNIAO', 'DILIGENCIA',
      'DESPACHO', 'PERICIA', 'COMPROMISSO', 'CONTATO', 'ACOMPANHAMENTO',
    ];
    for (const spec of Object.values(PROVIDENCIAS)) {
      expect(tiposSistema).toContain(spec.tipo);
    }
  });
});

/**
 * REGRESSÕES DE DADOS REAIS.
 *
 * Estes casos não apareceram nos textos de exemplo — só na conferência contra
 * 200 publicações do TJPI. Sem eles, o classificador parecia correto e errava
 * a maioria.
 */
describe('ruído do mundo real', () => {
  describe('publicação em HTML', () => {
    /** Parte dos atos do PJe chega como marcação, não como texto. */
    it('remove tags e devolve o texto legível', () => {
      const html =
        '<div style="text-align: center;"><img src="brasao.gif" /></div>' +
        '<p>Intimo a parte a apresentar r&eacute;plica</p>';
      const limpo = limparTextoPublicacao(html);
      expect(limpo).not.toContain('<');
      expect(limpo).toContain('Intimo a parte a apresentar réplica');
    });

    /** Entidade nomeada é case-sensitive: `&Aacute;` é Á, `&aacute;` é á. */
    it('decodifica entidades acentuadas preservando a caixa', () => {
      expect(limparTextoPublicacao('PODER JUDICI&Aacute;RIO')).toBe('PODER JUDICIÁRIO');
      expect(limparTextoPublicacao('Justi&ccedil;a do Piau&iacute;')).toBe('Justiça do Piauí');
      expect(limparTextoPublicacao('1&ordf; C&acirc;mara')).toBe('1ª Câmara');
    });

    it('entidade desconhecida fica como está, sem apagar o trecho', () => {
      expect(limparTextoPublicacao('valor &naoexiste; final')).toContain('&naoexiste;');
    });

    it('classifica corretamente mesmo vindo em HTML', () => {
      const html = '<p><strong>Intimo</strong> a parte autora a apresentar r&eacute;plica</p>';
      expect(p(limparTextoPublicacao(html), 'Intimação')).toBe('ELABORAR_MANIFESTACAO');
    });
  });

  describe('cabeçalho da publicação', () => {
    /**
     * O erro mais comum medido nos dados reais: a CLASSE do processo fica no
     * cabeçalho, e classificar o texto inteiro fazia a classe decidir a
     * providência. Um pedido de juntada numa apelação virava "Avaliar recurso".
     */
    it('a classe processual do cabeçalho não decide a providência', () => {
      const texto =
        'PODER JUDICIÁRIO PROCESSO Nº: 0800114-89.2026.8.18.0074 ' +
        'CLASSE: APELAÇÃO CRIMINAL (417) ASSUNTO: [Furto] ' +
        'APELANTE: FULANO DE TAL APELADO: MINISTÉRIO PÚBLICO ' +
        'Intimo a parte a juntar o comprovante de residência atualizado nos autos.';
      expect(p(texto, 'Intimação')).toBe('JUNTAR_DOCUMENTOS');
    });

    it('corta o cabeçalho e devolve o corpo do ato', () => {
      const corpo = corpoDaPublicacao(
        'PROCESSO N: 0800114 CLASSE: APELACAO ASSUNTO: [FURTO] ' +
          'REU: FULANO INTIMO A PARTE A APRESENTAR AS CONTRARRAZOES NO PRAZO LEGAL',
      );
      expect(corpo).not.toContain('APELACAO');
      expect(corpo).toContain('CONTRARRAZOES');
    });

    it('sem cabeçalho reconhecível, usa o texto inteiro', () => {
      const texto = 'INTIMO A PARTE A APRESENTAR REPLICA NO PRAZO DE 15 DIAS';
      expect(corpoDaPublicacao(texto)).toBe(texto);
    });

    /** Corpo curto demais é resto de cabeçalho — melhor classificar tudo. */
    it('corpo curto demais não é usado sozinho', () => {
      const texto = 'PROCESSO N: 0800114 CLASSE: APELACAO CRIMINAL REU: FULANO DE TAL';
      expect(corpoDaPublicacao(texto)).toBe(texto);
    });
  });

  /**
   * Acórdão e ata de sessão falam da sentença o tempo todo — é o que estão
   * julgando. A palavra solta fazia 61% das publicações virarem "Analisar
   * sentença".
   */
  describe('julgamento em 2º grau não é sentença de 1º', () => {
    it('ata de sessão de julgamento → avaliar recurso', () => {
      const texto =
        'ATA DA SESSÃO DE JULGAMENTO. Sessão do Plenário Virtual da 1ª Câmara ' +
        'Especializada Criminal. Recurso de apelação contra a sentença de primeiro grau.';
      expect(p(texto, 'Intimação')).toBe('AVALIAR_RECURSO');
    });

    it('a palavra "sentença" solta não basta para "analisar sentença"', () => {
      expect(p('Trata-se de recurso contra a sentença de primeiro grau.', 'Intimação')).not.toBe(
        'ANALISAR_SENTENCA',
      );
    });

    it('mas a sentença COMUNICADA continua sendo analisar sentença', () => {
      expect(p('Fica a parte intimada da sentença proferida nos autos.', 'Intimação')).toBe(
        'ANALISAR_SENTENCA',
      );
      expect(p('JULGO PROCEDENTE o pedido inicial.', 'Intimação')).toBe('ANALISAR_SENTENCA');
    });
  });
});

describe('extração do prazo mencionado', () => {
  it('lê as formas que os tribunais escrevem', () => {
    expect(prazo('manifestar no prazo de 15 dias')).toBe(15);
    expect(prazo('no prazo de 05 (cinco) dias')).toBe(5);
    expect(prazo('prazo comum de 30 dias')).toBe(30);
  });

  it('"prazo legal" não inventa número', () => {
    expect(prazo('apresentar contrarrazões no prazo legal')).toBeNull();
  });

  it('descarta valores implausíveis', () => {
    expect(prazo('prazo de 999 dias')).toBeNull();
    expect(prazo('prazo de 0 dias')).toBeNull();
  });

  it('não confunde outros números com prazo', () => {
    expect(prazo('PROCESSO Nº 0800114-89.2026.8.18.0074, com 3 volumes')).toBeNull();
  });
});

/**
 * O sistema NÃO calcula vencimento processual — a contagem oficial depende de
 * dias úteis forenses, feriado da comarca e forma de intimação. O que ele faz é
 * antecipar o LEMBRETE, e antecipar é sempre seguro.
 */
describe('diasParaLembrete — antecipa, nunca calcula vencimento', () => {
  const spec = PROVIDENCIAS.ELABORAR_MANIFESTACAO; // padrão: 5 dias úteis

  it('sem prazo no texto, usa o padrão da providência', () => {
    expect(diasParaLembrete(spec, null)).toBe(5);
  });

  it('prazo longo não ATRASA o lembrete além do padrão', () => {
    expect(diasParaLembrete(spec, 30)).toBe(5);
    expect(diasParaLembrete(spec, 15)).toBe(5);
  });

  it('prazo curto ANTECIPA o lembrete', () => {
    expect(diasParaLembrete(spec, 5)).toBe(3);
    expect(diasParaLembrete(spec, 3)).toBe(1);
  });

  it('nunca cai abaixo de 1 dia útil', () => {
    expect(diasParaLembrete(spec, 2)).toBe(1);
    expect(diasParaLembrete(spec, 1)).toBe(1);
  });
});
