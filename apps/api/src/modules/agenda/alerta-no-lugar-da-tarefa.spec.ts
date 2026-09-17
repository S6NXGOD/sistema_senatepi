import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atoAcionavel, VALIDADE_DIAS } from '../processos/utils/tpu.util';

/**
 * O ALERTA QUE ENTROU NO LUGAR DA TAREFA — 17/09/2026.
 *
 * "As tarefas sem utilidade e esse bombardeio de tarefas vai se manter assim?
 * (...) Não quero tarefas já com prazo matando o advogado; se for algo urgente,
 * mande um alerta, mas não encha de tarefas desnecessárias."
 *
 * O criador cego do DataJud foi desligado: das 48 "Verificação de Intimação /
 * Prazo", 32 foram canceladas, 47 nasceram atrasadas e 9 das 11 concluídas
 * fecharam com "não havia peça a fazer". Mas desligar sem devolver alavanca é
 * subtração — e o selo âmbar, sozinho, só existe DENTRO da ficha de cada
 * processo, uma de cada vez. A lista de Processos não cobre o buraco: ela lê só
 * a ÚLTIMA movimentação, e o DataJud entrega em lote com mediana de 62 dias de
 * atraso, então o ato que pede providência quase nunca é o último.
 *
 * Daí o quarto tipo da faixa. É ESTADO: some quando alguém decide, sem marcar
 * como lido e sem histórico.
 */
const FONTE = readFileSync(join(__dirname, 'pendencias.service.ts'), 'utf8');

describe('a faixa ganhou o ato que ninguém decidiu', () => {
  it('o tipo existe no contrato da faixa', () => {
    expect(FONTE).toContain("'ATO_ESPERANDO_OLHO'");
  });

  /**
   * O JULGAMENTO É O MESMO DO SELO. Duas réguas para o mesmo aviso já fizeram a
   * lista mostrar onze avisos que a ficha do mesmo processo não mostrava.
   */
  it('quem decide é `atoAcionavel`, e não uma regra escrita de novo', () => {
    expect(FONTE).toContain('atoAcionavel(m, agora)');
    expect(FONTE).not.toMatch(/ATOS_CRITICOS|codigoMovimento === \d+/);
  });

  /**
   * O CORTE DA CONSULTA NÃO PODE SER MAIS APERTADO QUE A VALIDADE DO SELO.
   *
   * O selo de PRAZO vale 30 dias, mas o de DECISÃO vale 90 — e são as decisões
   * que dominam o que sobrou (Procedência em Parte, Não-Provimento, Embargos não
   * acolhidos). Cortar a consulta em 30 esconderia a maior parte do aviso.
   */
  it('a consulta corta pela validade MAIS LARGA do dicionário', () => {
    expect(FONTE).toContain('VALIDADE_MAIS_LARGA_DIAS');
    expect(Math.max(...Object.values(VALIDADE_DIAS))).toBe(VALIDADE_DIAS.DECISAO);
    expect(VALIDADE_DIAS.DECISAO).toBeGreaterThan(VALIDADE_DIAS.PRAZO);
  });

  /** Aviso com número e sem destino obriga a procurar: o link leva AO ATO. */
  it('o link leva ao andamento, e não só ao processo', () => {
    expect(FONTE).toContain('&andamento=${m.id}');
  });

  /**
   * O CARIMBO DO ROBÔ NÃO PODE ENTRAR NO FILTRO. É ele que faz este aviso
   * existir: "o robô olhou e não soube resolver" é a definição do item.
   */
  it('o ato carimbado pelo robô continua contando', () => {
    const emAberto = {
      codigoMovimento: 239, // Recurso negado — DECISAO
      dataMovimento: new Date(Date.now() - 10 * 86_400_000),
      compromissoId: null,
      dispensadoEm: null,
      avaliadoEm: new Date(),
      avaliadoMotivo: 'SEM_TEOR_NO_DATAJUD',
    };
    expect(atoAcionavel(emAberto)).not.toBeNull();
    // O POR QUÊ mora no andamento (`avaliadoMotivo` → `semTarefaMotivo` na
    // ficha), e não no cálculo do selo: uma verdade, um caminho.
    expect(atoAcionavel(emAberto)).toEqual({ nivel: 'DECISAO', rotulo: 'Recurso negado' });
  });

  /**
   * AS DUAS DECISÕES DE GENTE APAGAM O AVISO — é isso que o torna estado, e não
   * uma caixa de notificações que se aprende a ignorar.
   */
  it.each([
    ['virou atividade na agenda', { compromissoId: 'k1' }],
    ['alguém marcou "já cuidei"', { dispensadoEm: new Date() }],
  ])('some quando %s', (_caso, decisao) => {
    expect(
      atoAcionavel({
        codigoMovimento: 239,
        dataMovimento: new Date(Date.now() - 10 * 86_400_000),
        avaliadoEm: new Date(),
        avaliadoMotivo: 'SEM_TEOR_NO_DATAJUD',
        ...decisao,
      }),
    ).toBeNull();
  });

  /** E vence com o tempo, pela régua de cada nível — nunca acumula para sempre. */
  it('o ato velho sai do aviso sozinho', () => {
    const velho = {
      codigoMovimento: 239,
      dataMovimento: new Date(Date.now() - (VALIDADE_DIAS.DECISAO + 1) * 86_400_000),
      compromissoId: null,
      dispensadoEm: null,
    };
    expect(atoAcionavel(velho)).toBeNull();
  });
});

/**
 * A PROPOSTA ÓRFÃ VOLTOU PARA A FAIXA.
 *
 * A exclusão de "publicação com proposta aberta" tinha uma justificativa certa —
 * "quem tem proposta esperando já é avisado pela própria caixa" — e uma exceção
 * que eu não vi: a proposta SEM DONO (`tarefaPropostaPara: null`), que o robô
 * abre quando o ato do DJEN lista os advogados e não diz de quem cada um é.
 * Essa não chega a caixa nenhuma por padrão: `listar` filtra por dono, e a órfã
 * só aparece no escopo `?todas=1`, que exige perfil e que alguém lembre de
 * trocar o filtro. Tirá-la da faixa não a tornava mais silenciosa: tornava-a
 * invisível.
 */
describe('a proposta sem dono continua avisando', () => {
  it('a faixa aceita proposta órfã, e só exclui a que tem dono', () => {
    expect(FONTE).toContain('OR: [{ tarefaPropostaEm: null }, { tarefaPropostaPara: null }]');
  });

  /**
   * UM `OR` SÓ NO OBJETO. Dois `OR` no mesmo `where` se sobrescrevem no Prisma —
   * o segundo apaga o primeiro, em silêncio. Esta base já perdeu uma varredura
   * inteira (0 de 3.150) por esse detalhe.
   */
  it('não há um segundo `OR` no mesmo filtro de publicações', () => {
    const consulta = FONTE.slice(FONTE.indexOf('this.prisma.comunicacaoDjen.findMany'));
    const ate = consulta.slice(0, consulta.indexOf('orderBy'));
    expect((ate.match(/\bOR:/g) ?? []).length).toBe(1);
  });
});
