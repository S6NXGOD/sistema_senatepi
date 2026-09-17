import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atoAcionavel, VALIDADE_DIAS, type MovimentacaoAvaliavel } from './utils/tpu.util';
import {
  DIAS_ATO_RECENTE,
  DIAS_JANELA_DE_CAPTURA,
  DIAS_UTEIS_DE_CONFERENCIA,
  DIAS_CASAMENTO_PUBLICACAO_ANTES,
  DIAS_CASAMENTO_PUBLICACAO_DEPOIS,
  DIAS_ADOCAO_DO_ATO_POSTERIOR,
} from './utils/janela-do-robo.util';
import { MOTIVOS_DO_ROBO } from './automacao-prazos.service';

const AGORA = new Date('2026-09-17T12:00:00.000Z');

const mov = (
  diasAtras: number,
  extra: Partial<MovimentacaoAvaliavel> = {},
): MovimentacaoAvaliavel => ({
  // 1061 = "Disponibilização no Diário" — nível PRAZO no dicionário da TPU.
  codigoMovimento: 1061,
  dataMovimento: new Date(AGORA.getTime() - diasAtras * 86_400_000),
  detalhe: null,
  compromissoId: null,
  dispensadoEm: null,
  ...extra,
});

/**
 * TROQUEI TAREFA INÚTIL POR SILÊNCIO — e este arquivo existe para isso não
 * voltar (17/09/2026).
 *
 * Em 17/09 eu fiz o criador cego carimbar `dispensadoEm/Por/Motivo` na
 * movimentação para registrar "não abri tarefa porque o andamento é velho".
 * Essas colunas são a DISPENSA HUMANA do radar de audiências, e a primeira linha
 * de `atoAcionavel` apaga o selo âmbar quando `dispensadoEm` existe. Resultado:
 * o andamento sairia da agenda E da tela no mesmo movimento, sem ninguém
 * pedir.
 *
 * A regra que ficou: só GENTE cala aviso. A decisão do robô faz o contrário —
 * ela é o motivo pelo qual alguém precisa olhar.
 */
describe('só a dispensa de gente cala o selo âmbar', () => {
  it('o ato sem carimbo nenhum acende, como sempre', () => {
    expect(atoAcionavel(mov(3), AGORA)?.nivel).toBe('PRAZO');
  });

  it('o carimbo do ROBÔ não apaga o selo', () => {
    const avaliado = mov(3, {
      avaliadoEm: AGORA,
      avaliadoMotivo: MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD,
    });
    expect(atoAcionavel(avaliado, AGORA)?.nivel).toBe('PRAZO');
  });

  it('vale para os três motivos do vocabulário — nenhum deles é uma dispensa', () => {
    for (const motivo of Object.values(MOTIVOS_DO_ROBO)) {
      const avaliado = mov(3, { avaliadoEm: AGORA, avaliadoMotivo: motivo });
      expect(atoAcionavel(avaliado, AGORA)).not.toBeNull();
    }
  });

  it('a dispensa de uma PESSOA continua calando', () => {
    expect(atoAcionavel(mov(3, { dispensadoEm: AGORA }), AGORA)).toBeNull();
  });

  /**
   * O caso que junta os dois: a pessoa dispensou DEPOIS de o robô ter avaliado.
   * Quem manda é a pessoa.
   */
  it('avaliado pelo robô e dispensado por gente: cala', () => {
    const ambos = mov(3, {
      avaliadoEm: AGORA,
      avaliadoMotivo: MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO,
      dispensadoEm: AGORA,
    });
    expect(atoAcionavel(ambos, AGORA)).toBeNull();
  });

  /** Virar atividade continua calando: aí o ato tem dono e data. */
  it('ato que virou atividade não precisa de selo', () => {
    expect(atoAcionavel(mov(3, { compromissoId: 'c1', avaliadoEm: AGORA }), AGORA)).toBeNull();
  });
});

/**
 * A TELA PRECISA PODER EXPLICAR — senão o selo só troca uma dúvida por outra.
 *
 * "Andamento sem atividade" é indistinguível de falha da automação, e foi a
 * desconfiança que o dono relatou: "muitas vezes não confiamos se é nossa parte
 * que tem que atuar". A explicação existe — só que ela mora no ANDAMENTO, e não
 * no cálculo do selo.
 */
describe('o selo não repete a explicação que já está no andamento', () => {
  /**
   * O SELO DIZ **O QUE** É; O ANDAMENTO DIZ **POR QUE** NÃO VIROU TAREFA.
   *
   * Por algumas horas em 17/09/2026 `atoAcionavel` também devolvia
   * `motivoDoRobo`, para a tela explicar o selo a partir daqui. Nenhum caminho
   * de produção chegou a ler o campo: a ficha pega o motivo do PRÓPRIO
   * andamento (`semTarefaMotivo`, de `avaliadoMotivo`), que é onde ele está
   * gravado. Dois caminhos para a mesma frase é o desenho que já fez o `polo`
   * ter três leitores com três critérios nesta base.
   */
  it('devolve nível e rótulo, e nada além disso', () => {
    const avaliado = mov(3, {
      avaliadoEm: AGORA,
      avaliadoMotivo: MOTIVOS_DO_ROBO.SEM_TEOR_NO_DATAJUD,
    });
    expect(atoAcionavel(avaliado, AGORA)).toEqual({
      nivel: 'PRAZO',
      rotulo: 'Disponibilização no Diário',
    });
    expect(atoAcionavel(mov(3), AGORA)).toEqual({
      nivel: 'PRAZO',
      rotulo: 'Disponibilização no Diário',
    });
  });

  it('o ato que já venceu não acende selo, carimbado ou não', () => {
    const velho = mov(VALIDADE_DIAS.PRAZO + 1, {
      avaliadoEm: AGORA,
      avaliadoMotivo: MOTIVOS_DO_ROBO.ANDAMENTO_ANTIGO,
    });
    expect(atoAcionavel(velho, AGORA)).toBeNull();
  });
});

/**
 * RÉGUA ÚNICA — os números da automação moram num arquivo só.
 *
 * Números casados por comentário se descasam. Já aconteceu: o selo âmbar não
 * tinha janela e a automação tinha 30 dias, e a lista passou semanas mostrando
 * onze avisos que a ficha do mesmo processo não mostrava.
 *
 * Esta frente NÃO muda valor nenhum; só junta os quatro no mesmo lugar.
 */
describe('a régua do robô', () => {
  it('a validade do selo de PRAZO É a janela de captura', () => {
    // Enquanto forem o mesmo número, "ato dentro da janela sem providência"
    // significa uma coisa só. Se divergirem, o selo volta a mentir.
    expect(VALIDADE_DIAS.PRAZO).toBe(DIAS_JANELA_DE_CAPTURA);
  });

  it('os valores continuam os de sempre', () => {
    expect(DIAS_ATO_RECENTE).toBe(15);
    expect(DIAS_JANELA_DE_CAPTURA).toBe(30);
    expect(DIAS_UTEIS_DE_CONFERENCIA).toBe(3);
    expect(DIAS_CASAMENTO_PUBLICACAO_DEPOIS).toBe(3);
    expect(DIAS_CASAMENTO_PUBLICACAO_ANTES).toBe(5);
    expect(DIAS_ADOCAO_DO_ATO_POSTERIOR).toBe(3);
  });

  it('notícia é mais curto que a janela de captura, e a decisão dura mais', () => {
    // Se a régua da urgência passasse da janela de captura, haveria "urgente"
    // para ato que o robô nem chega a olhar.
    expect(DIAS_ATO_RECENTE).toBeLessThan(DIAS_JANELA_DE_CAPTURA);
    expect(VALIDADE_DIAS.DECISAO).toBeGreaterThan(VALIDADE_DIAS.PRAZO);
  });

  /**
   * QUEM SILENCIA ANDA MAIS CURTO. A janela cheia serve para ENRIQUECER um ato
   * com o teor; a passada que grava `compromissoId` apaga o selo e tira o
   * andamento da varredura, para sempre. Um par errado ali custa um ato de
   * verdade sumindo — medido: 12 pares candidatos na produção, nenhum deles o
   * mesmo ato chegando atrasado.
   */
  it('o teto de quem silencia não passa da janela cheia', () => {
    expect(DIAS_ADOCAO_DO_ATO_POSTERIOR).toBeLessThanOrEqual(DIAS_CASAMENTO_PUBLICACAO_ANTES);
  });

  /**
   * E OS NÚMEROS SÃO LIDOS DE VERDADE — não basta existirem aqui.
   *
   * Um teste que compara duas constantes que ninguém importa fica verde para
   * sempre enquanto o valor que manda continua escrito à mão do outro lado. Era
   * o caso: `correlacao.util.ts` tinha os dois literais locais e este arquivo
   * garantia um número que o casamento não lia.
   */
  it('quem manda no casamento importa a régua, e não escreve o número de novo', () => {
    const util = readFileSync(join(__dirname, 'utils', 'correlacao.util.ts'), 'utf8');
    expect(util).toContain("from './janela-do-robo.util'");
    expect(util).toContain('DIAS_CASAMENTO_PUBLICACAO_ANTES');
    expect(util).toContain('DIAS_CASAMENTO_PUBLICACAO_DEPOIS');

    // E a varredura lê a mesma janela de captura que dá validade ao selo.
    const servico = readFileSync(join(__dirname, 'processos.service.ts'), 'utf8');
    const disparar = servico.slice(servico.indexOf('await this.correlacao.vincularMovimentacoesNovas'));
    expect(disparar.slice(0, 1200)).toContain('DIAS_JANELA_DE_CAPTURA * 24 * 3600 * 1000');
  });
});
