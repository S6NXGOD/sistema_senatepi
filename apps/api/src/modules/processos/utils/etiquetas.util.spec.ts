import { etiquetasAutomaticas, etiquetasDerivadas } from './etiquetas.util';

/**
 * As etiquetas que o sistema mantém sozinho — derivadas na leitura, nunca
 * gravadas, e por isso impossíveis de ficarem desatualizadas.
 */
describe('etiquetasDerivadas — o que o sistema etiqueta sem pedir nada', () => {
  it('ação institucional é coletiva por definição', () => {
    expect(etiquetasDerivadas({ tipoAcao: 'INSTITUCIONAL' })).toContain('Coletiva');
  });

  /** Os 5 processos da produção são institucionais e só 3 tinham a etiqueta. */
  it('não depende de alguém lembrar de marcar', () => {
    for (const classe of ['Ação Trabalhista - Rito Ordinário', 'Ação Trabalhista - Rito Sumaríssimo']) {
      expect(etiquetasDerivadas({ tipoAcao: 'INSTITUCIONAL', classeProcessual: classe })).toContain('Coletiva');
    }
  });

  it('coletiva pela CLASSE mesmo sem ser institucional', () => {
    expect(etiquetasDerivadas({ tipoAcao: 'INDIVIDUAL', classeProcessual: 'Ação Civil Pública' }))
      .toContain('Coletiva');
  });

  it('ação individual comum não recebe nada', () => {
    expect(etiquetasDerivadas({
      tipoAcao: 'INDIVIDUAL',
      classeProcessual: 'Ação Trabalhista - Rito Ordinário',
      assuntoPrincipal: 'Horas Extras',
    })).toEqual([]);
  });

  /** O caso real: 0001218-17.2023.5.22.0003, assunto "Adicional de Insalubridade". */
  it('assunto que exige laudo pericial etiqueta Perícia', () => {
    expect(etiquetasDerivadas({ assuntoPrincipal: 'Adicional de Insalubridade' })).toContain('Perícia');
  });

  /**
   * Fase de Execução e Recurso NÃO saem daqui: a coluna de fase processual já
   * diz isso. Repetir a mesma informação em dois lugares foi o que produziu a
   * contradição na tela ("Arquivado" ao lado de "Fase de Execução").
   */
  it('não devolve Fase de Execução nem Recurso — a fase processual já responde', () => {
    const r = etiquetasDerivadas({
      tipoAcao: 'INSTITUCIONAL',
      classeProcessual: 'Recurso Ordinário Trabalhista',
      assuntoPrincipal: 'Multa de 40% do FGTS',
    });
    expect(r).not.toContain('Fase de Execução');
    expect(r).not.toContain('Recurso');
  });
});

describe('etiquetasAutomaticas — o que dá para deduzir sem perguntar', () => {
  const mov = (descricao: string, codigoMovimento: number | null = null) => ({ descricao, codigoMovimento });

  it('não inventa etiqueta para processo comum', () => {
    expect(
      etiquetasAutomaticas({
        classeProcessual: 'Ação Trabalhista - Rito Ordinário',
        movimentacoes: [mov('Conclusão para despacho', 51), mov('Juntada de petição')],
      }),
    ).toEqual([]);
  });

  it('entrada vazia não quebra', () => {
    expect(etiquetasAutomaticas({})).toEqual([]);
    expect(etiquetasAutomaticas({ classeProcessual: null, movimentacoes: [] })).toEqual([]);
  });

  describe('Coletiva — vem da CLASSE', () => {
    it.each([
      'Ação Civil Pública',
      'AÇÃO COLETIVA',
      'Dissídio Coletivo de Greve',
      'Ação Trabalhista - Substituição Processual',
      'Mandado de Segurança Coletivo',
    ])('%s', (classe) => {
      expect(etiquetasAutomaticas({ classeProcessual: classe })).toContain('Coletiva');
    });

    /** Andamento mencionando "coletivo" não muda a natureza da ação. */
    it('não deduz Coletiva a partir do andamento', () => {
      expect(
        etiquetasAutomaticas({
          classeProcessual: 'Ação Trabalhista - Rito Ordinário',
          movimentacoes: [mov('Juntada de acordo coletivo de trabalho')],
        }),
      ).not.toContain('Coletiva');
    });
  });

  describe('Fase de Execução — da classe OU do andamento', () => {
    it('classe que já nasce em execução', () => {
      expect(etiquetasAutomaticas({ classeProcessual: 'Cumprimento Provisório de Sentença' }))
        .toContain('Fase de Execução');
    });

    /** O caso real do TRT22: conhecimento que virou execução no meio do caminho. */
    it('andamento de início de execução', () => {
      expect(
        etiquetasAutomaticas({
          classeProcessual: 'Ação Trabalhista - Rito Ordinário',
          movimentacoes: [mov('Execução/Cumprimento de Sentença Iniciada (o)', 11385)],
        }),
      ).toContain('Fase de Execução');
    });

    /**
     * O CASO MEDIDO no 0000600-48.2023.5.22.0108: o processo está em execução
     * desde agosto/2025, mas o andamento MAIS RECENTE é rotina de cartório. Ler
     * só o topo da pilha faria a etiqueta nunca aparecer.
     */
    it('acha a execução no meio do histórico, não só no topo', () => {
      expect(
        etiquetasAutomaticas({
          classeProcessual: 'Ação Trabalhista - Rito Ordinário',
          movimentacoes: [
            mov('Disponibilização no Diário da Justiça Eletrônico', 1061),
            mov('Expedição de documento', 60),
            mov('Liquidação iniciada', 11384),
            mov('Trânsito em julgado', 848),
          ],
        }),
      ).toContain('Fase de Execução');
    });

    /** O código vale mesmo quando o tribunal escreve o nome de outro jeito. */
    it('reconhece pelo CÓDIGO da TPU, sem depender do texto', () => {
      expect(
        etiquetasAutomaticas({
          classeProcessual: 'Ação Trabalhista',
          movimentacoes: [mov('Ato ordinatório praticado', 11385)],
        }),
      ).toContain('Fase de Execução');
    });

    it('liquidação conta — é o que abre a execução na Justiça do Trabalho', () => {
      expect(
        etiquetasAutomaticas({ classeProcessual: 'Ação Trabalhista', movimentacoes: [mov('Liquidação iniciada', 11384)] }),
      ).toContain('Fase de Execução');
    });
  });

  it('as duas juntas quando é o caso, sem repetir', () => {
    const r = etiquetasAutomaticas({
      classeProcessual: 'Ação Civil Pública em Execução',
      movimentacoes: [mov('Execução iniciada', 11385)],
    });
    expect(r).toEqual(['Coletiva', 'Fase de Execução']);
  });

  describe('Recurso — só da CLASSE', () => {
    it.each(['Recurso Ordinário Trabalhista', 'Agravo de Petição', 'Apelação Cível', 'Embargos de Declaração'])(
      '%s',
      (classe) => {
        expect(etiquetasAutomaticas({ classeProcessual: classe })).toContain('Recurso');
      },
    );

    /**
     * "prazo recursal" e "decurso do prazo recursal" são rotina de cartório em
     * processo que nunca teve recurso — por isso a dedução ignora o andamento.
     */
    it('andamento com "recursal" não etiqueta', () => {
      expect(
        etiquetasAutomaticas({
          classeProcessual: 'Ação Trabalhista - Rito Ordinário',
          movimentacoes: [mov('Decurso de prazo recursal', 1051)],
        }),
      ).not.toContain('Recurso');
    });
  });

  describe('Perícia — do ASSUNTO', () => {
    it.each([
      'Adicional de Insalubridade',
      'Adicional de Periculosidade',
      'INSALUBRIDADE',
    ])('%s', (assunto) => {
      expect(etiquetasAutomaticas({ classeProcessual: 'Ação Trabalhista', assuntoPrincipal: assunto }))
        .toContain('Perícia');
    });

    it('assunto sem laudo obrigatório não etiqueta', () => {
      expect(
        etiquetasAutomaticas({ classeProcessual: 'Ação Trabalhista', assuntoPrincipal: 'Horas Extras' }),
      ).not.toContain('Perícia');
    });
  });

  it('acento e caixa não interferem', () => {
    expect(etiquetasAutomaticas({ classeProcessual: 'EXECUCAO DE TITULO EXTRAJUDICIAL' }))
      .toContain('Fase de Execução');
  });
});
