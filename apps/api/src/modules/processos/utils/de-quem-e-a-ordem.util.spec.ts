import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deQuemEAOrdem, deQuemEOPrazo } from './de-quem-e-a-ordem.util';

/**
 * O PRAZO ERA DA RECLAMADA E VIROU TAREFA DO NOSSO ADVOGADO.
 *
 * Os teores abaixo são trechos reais das publicações da produção. O tribunal
 * manda o MESMO ato para todos os intimados, e a ordem costuma ser de um lado
 * só — o robô lia "no prazo de 15 dias" e criava tarefa sem perguntar de quem
 * era a obrigação.
 *
 * Medido em 07/09/2026: das 14 atividades que o robô criou, CINCO já tinham
 * sido canceladas à mão. A equipe limpava isso toda semana, sem reportar.
 */
const SIGLA = 'SENATEPI';

describe('de quem é a ordem do ato', () => {
  /** 0000978-59.2022.5.22.0004 — o caso que o usuário trouxe. */
  it('reconhece a ordem que é só da reclamada quando somos autor', () => {
    const teor = 'INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('DA_OUTRA_PARTE');
  });

  /**
   * A MESMA FRASE É NOSSA QUANDO SOMOS A RECLAMADA. É por isso que a regra
   * compara papel com polo, em vez de ter uma lista de palavras proibidas: em
   * 167 das 1.408 publicações do acervo o sindicato está no polo passivo.
   */
  it('e a mesma ordem é nossa quando somos nós a reclamada', () => {
    const teor = 'INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS.';
    expect(deQuemEAOrdem(teor, 'PASSIVO', SIGLA)).toBe('NOSSA');
  });

  /** 0002664-81.2025.5.22.0101 — duas ordens, uma delas nossa. Tarefa vale. */
  it('basta UMA ordem nossa para o ato ser nosso', () => {
    const teor =
      'INTIME-SE A EXECUTADA (INSTITUTO SAUDE E CIDADANIA - ISAC) PARA QUE COMPROVE O CUMPRIMENTO. ' +
      'APOS, INTIME-SE O SINDICATO EXEQUENTE PARA QUE SE MANIFESTE EM 5 DIAS.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('NOSSA');
  });

  /** O ato que nos nomeia é nosso, qualquer que seja o papel escrito. */
  it('a sigla no destinatário decide sozinha', () => {
    expect(deQuemEAOrdem('FICA INTIMADO O SENATEPI PARA MANIFESTAR-SE.', null, SIGLA)).toBe('NOSSA');
  });

  it('"intimem-se as partes" é nosso também', () => {
    expect(deQuemEAOrdem('INTIMEM-SE AS PARTES DO INTEIRO TEOR.', 'ATIVO', SIGLA)).toBe('NOSSA');
  });

  /**
   * NA DÚVIDA, CRIA. Sem ordem legível o resultado é INDEFINIDO, e indefinido
   * mantém o comportamento de sempre. 90,4% das 1.433 publicações caem aqui —
   * a trava é estreita de propósito.
   */
  it('sem ordem legível não decide nada', () => {
    expect(deQuemEAOrdem('SENTENCA PUBLICADA EM AUDIENCIA. NADA MAIS.', 'ATIVO', SIGLA)).toBe(
      'INDEFINIDO',
    );
  });

  it('uma ordem indefinida no meio já derruba o bloqueio', () => {
    const teor = 'INTIME-SE A RECLAMADA PARA PAGAR. INTIME-SE O PERITO PARA APRESENTAR O LAUDO.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('INDEFINIDO');
  });

  /**
   * SEM SABER NOSSO POLO, NÃO BLOQUEIA. Acontece quando o sindicato não é parte
   * (a ação é do filiado e nós só patrocinamos) ou quando está nos dois polos,
   * que é o caso do recurso — 11% dos atos medidos.
   */
  it('não bloqueia quando não se sabe de que lado estamos', () => {
    expect(deQuemEAOrdem('INTIME-SE A RECLAMADA PARA PAGAR.', null, SIGLA)).toBe('INDEFINIDO');
  });

  /**
   * "SINDICATO" SOZINHO NÃO BASTA QUANDO NÃO SOMOS PARTE. No acervo há ação
   * movida por outro sindicato contra nós (SINSEP, SINDHOSPI): tratar a palavra
   * como nossa devolveria o bug com outra roupa.
   */
  it('mas "sindicato" genérico, sabendo o polo, obedece ao papel', () => {
    const teor = 'INTIME-SE O SINDICATO RECLAMADO PARA CONTESTAR.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('DA_OUTRA_PARTE');
    expect(deQuemEAOrdem(teor, 'PASSIVO', SIGLA)).toBe('NOSSA');
  });

  /** Trechos reais das 59 barradas na conferência contra a produção. */
  it.each([
    ['INTIME-SE A PARTE RECLAMADA PARA IMPUGNACAO FUNDAMENTADA DOS CALCULOS.', 'ATIVO'],
    ['INTIME-SE A PARTE EXECUTADA PARA, QUERENDO, APRESENTAR IMPUGNACAO.', 'ATIVO'],
    ['INTIME-SE A PARTE EMBARGADA PARA, QUERENDO, APRESENTAR MANIFESTACAO.', 'ATIVO'],
    ['CITE-SE A RECLAMADA PARA, NO PRAZO LEGAL, APRESENTAR CONTESTACAO.', 'ATIVO'],
  ] as const)('bloqueia: %s', (teor, polo) => {
    expect(deQuemEAOrdem(teor, polo, SIGLA)).toBe('DA_OUTRA_PARTE');
  });

  /** Teores nossos que NÃO podem ser bloqueados — o erro caro. */
  it.each([
    ['INTIME-SE A PARTE AUTORA PARA APRESENTAR REPLICA NO PRAZO DE 15 DIAS.', 'ATIVO'],
    ['INTIMO A PARTE EXEQUENTE A SE MANIFESTAR SOBRE OS CALCULOS.', 'ATIVO'],
    ['FICA INTIMADA A RECLAMANTE PARA CIENCIA DA SENTENCA.', 'ATIVO'],
    ['INTIME-SE A EXECUTADA PARA PAGAR EM 48 HORAS.', 'PASSIVO'],
  ] as const)('não bloqueia: %s', (teor, polo) => {
    expect(deQuemEAOrdem(teor, polo, SIGLA)).toBe('NOSSA');
  });

  /**
   * "A PARTE CONTRÁRIA" É RELATIVA A QUEM AGIU.
   *
   * Dois despachos abertos na produção: "RECEBO OS EMBARGOS OPOSTOS PELA
   * RECLAMADA, FICANDO A PARTE CONTRÁRIA DEVIDAMENTE INTIMADA PARA SE
   * MANIFESTAR NO PRAZO DE CINCO DIAS". Quem embargou foi a reclamada, então a
   * parte contrária é o SINDICATO — e as duas tarefas estão certas.
   *
   * A expressão é ambígua por natureza: nunca pode bloquear.
   */
  it('"parte contrária" nunca bloqueia — ela pode ser nós', () => {
    expect(deQuemEAOrdem('INTIME-SE A PARTE CONTRARIA PARA SE MANIFESTAR EM 5 DIAS.', 'ATIVO', SIGLA)).toBe(
      'INDEFINIDO',
    );
    expect(deQuemEAOrdem('INTIME-SE A PARTE CONTRARIA PARA SE MANIFESTAR EM 5 DIAS.', 'PASSIVO', SIGLA)).toBe(
      'INDEFINIDO',
    );
  });

  /** Mas uma ordem nossa ao lado ainda decide. */
  it('e não impede o reconhecimento de uma ordem nossa no mesmo ato', () => {
    const teor =
      'INTIME-SE A PARTE CONTRARIA PARA SE MANIFESTAR. INTIME-SE O SINDICATO AUTOR PARA CIENCIA.';
    expect(deQuemEAOrdem(teor, 'ATIVO', SIGLA)).toBe('NOSSA');
  });

  it('texto vazio não quebra', () => {
    expect(deQuemEAOrdem('', 'ATIVO', SIGLA)).toBe('INDEFINIDO');
  });

  /** Acento e caixa não podem mudar a resposta — o teor vem como o tribunal escreve. */
  it('atravessa acento e caixa', () => {
    expect(deQuemEAOrdem('Intime-se a parte reclamada para pagar.', 'ATIVO', SIGLA)).toBe(
      'DA_OUTRA_PARTE',
    );
  });
});

/**
 * A REGRA TEM UM ARQUIVO E DOIS CONSUMIDORES — o robô e a leitura.
 *
 * O robô grava o que decidiu NO DIA (`tarefaDispensadaMotivo`); a busca calcula
 * `ordemEhNossa` na leitura. São perguntas diferentes e podem discordar sem
 * contradição: um ato pode ter sido dispensado por ser ANTIGO e, ao mesmo
 * tempo, trazer ordem da parte contrária.
 *
 * Carimbar o acervo inteiro com a regra nova seria reescrever a decisão que o
 * robô tomou — 59 publicações da produção já têm motivo gravado, e este projeto
 * não reescreve registro histórico.
 */
describe('quem usa a regra', () => {
  const BUSCA = readFileSync(join(__dirname, '../djen-busca.service.ts'), 'utf8');
  const CORRELACAO = readFileSync(join(__dirname, '../correlacao.service.ts'), 'utf8');

  it('a busca calcula na leitura, sem tocar no carimbo do robô', () => {
    expect(BUSCA).toContain("import { deQuemEAOrdem } from './utils/de-quem-e-a-ordem.util'");
    expect(BUSCA).toContain('private async comTitularidade<');
    expect(BUSCA).toContain('ordemEhNossa');
    // Não escreve nada: leitura é leitura.
    const fn = BUSCA.slice(BUSCA.indexOf('private async comTitularidade<'));
    expect(fn.slice(0, 2500)).not.toContain('.update(');
  });

  it('o robô usa o mesmo util', () => {
    expect(CORRELACAO).toContain("from './utils/de-quem-e-a-ordem.util'");
    expect(CORRELACAO).toContain('deQuemEAOrdem(');
    // 17/09/2026: a ordem não basta; o prazo também tem dono.
    expect(CORRELACAO).toContain('deQuemEOPrazo(');
  });

  /** O polo sai do VÍNCULO institucional, nunca do nome — nos dois lados. */
  it('os dois leem o polo do cadastro institucional', () => {
    expect(BUSCA).toContain('parteExterna: { institucional: true }');
    expect(CORRELACAO).toContain('parteExterna: { institucional: true }');
  });
});

/**
 * E DE QUEM É O PRAZO? (17/09/2026)
 *
 * Os dois teores abaixo são reais. Neles a ordem para nós é "tomar ciência" e o
 * prazo é da outra parte — a prova "ordem nossa + prazo escrito" não provava
 * nada, e nasceu "Juntar documentos" na agenda de quem só tinha de ler.
 */
describe('deQuemEOPrazo', () => {
  const SIGLA = 'SENATEPI';

  /** 0001381-91.2023.5.22.0101 — o sindicato é AUTOR; quem tem prazo é a executada. */
  const CIENCIA_COM_PRAZO_DA_EXECUTADA =
    'Fica V. Sa. intimado para tomar ciência da Decisão ID f94d451 proferida nos autos. ' +
    'Este Juízo determinou que a executada complementasse a documentação apresentada, ' +
    'colacionando aos autos as fichas financeiras e/ou contracheques mensais de todos os ' +
    'substituídos no prazo improrrogável de 15 (quinze) dias.';

  it('prazo da executada, sindicato no polo ativo: é da outra parte', () => {
    expect(deQuemEOPrazo(CIENCIA_COM_PRAZO_DA_EXECUTADA, 'ATIVO', SIGLA)).toBe('DA_OUTRA_PARTE');
  });

  it('o MESMO ato, com o sindicato no polo passivo, é prazo NOSSO', () => {
    expect(deQuemEOPrazo(CIENCIA_COM_PRAZO_DA_EXECUTADA, 'PASSIVO', SIGLA)).toBe('NOSSO');
  });

  it('o ato que nos nomeia no prazo é nosso, qualquer que seja o papel escrito', () => {
    const t = 'Intime-se o SENATEPI para manifestar-se sobre os cálculos no prazo de 5 dias.';
    expect(deQuemEOPrazo(t, 'ATIVO', SIGLA)).toBe('NOSSO');
    expect(deQuemEOPrazo(t, 'PASSIVO', SIGLA)).toBe('NOSSO');
  });

  it('um prazo nosso no meio dos da outra parte devolve NOSSO', () => {
    const t =
      CIENCIA_COM_PRAZO_DA_EXECUTADA +
      ' Após, intime-se a parte autora para manifestar-se no prazo de 5 dias.';
    expect(deQuemEOPrazo(t, 'ATIVO', SIGLA)).toBe('NOSSO');
  });

  it('"as partes" no prazo inclui a gente', () => {
    expect(deQuemEOPrazo('Intimem-se as partes para se manifestarem no prazo de 5 dias.', 'ATIVO', SIGLA)).toBe('NOSSO');
  });

  /** Sem polo conhecido, ou sem papel na frase, o robô não opina — e a tarefa segue o caminho normal. */
  it('sem prazo, sem polo ou sem papel: INDEFINIDO', () => {
    expect(deQuemEOPrazo('Publique-se. Baixem os autos.', 'ATIVO', SIGLA)).toBe('INDEFINIDO');
    expect(deQuemEOPrazo(CIENCIA_COM_PRAZO_DA_EXECUTADA, null, SIGLA)).toBe('INDEFINIDO');
    expect(deQuemEOPrazo('Cumpra-se a determinação no prazo de 10 dias.', 'ATIVO', SIGLA)).toBe('INDEFINIDO');
  });

  it('"parte contrária" é relativa a quem agiu: nunca bloqueia', () => {
    const t = 'Recebo os embargos opostos pela reclamada, ficando a parte contrária intimada para se manifestar no prazo de 5 dias.';
    expect(deQuemEOPrazo(t, 'ATIVO', SIGLA)).toBe('NOSSO');
  });
});
