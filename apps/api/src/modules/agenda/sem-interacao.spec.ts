import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIAS_CANCELAMENTO } from './desfechos.catalogo';
import { diasUteisEntre } from '../dashboard/dias-uteis';

const SERVICO = readFileSync(join(__dirname, 'agenda.service.ts'), 'utf8');
const FN = SERVICO.slice(
  SERVICO.indexOf('async encerrarSemInteracao('),
  SERVICO.indexOf('async cancelarPorSistema('),
);

/**
 * A MARGEM DE TOLERÂNCIA — o pedido do dono em 03/11/2026.
 *
 * *"Uma atividade que possui prazo, se o advogado perder esse prazo máximo, a
 * atividade ser cancelada automaticamente e dizer que não interagiu."*
 *
 * O corte saiu da própria base: das 51 tarefas do robô já concluídas, 28
 * fecharam no dia marcado ou antes, 19 em até 5 dias úteis, 1 em 10 e 3 em 15.
 * NENHUMA passou de 15. Vinte é a folga sobre o pior caso que já existiu.
 */
describe('encerrar por falta de interação', () => {
  it('o corte é de 20 dias de EXPEDIENTE, não de calendário', () => {
    expect(SERVICO).toContain('const TOLERANCIA_DIAS_UTEIS = 20;');
    expect(FN).toContain('diasUteisEntre(c.inicio, agora)');
    expect(FN).toContain('if (diasParado < TOLERANCIA_DIAS_UTEIS) continue;');
  });

  /*
    AS TRÊS RECUSAS. Cada uma custou um raciocínio e nenhuma é decoração:
    audiência tem hora no mundo real, interação é justamente o que o
    encerramento nega, e tarefa de gente não é revogada por robô.
  */
  it('nunca encerra audiência', () => {
    expect(FN).toContain("tipo: { not: 'AUDIENCIA' }");
  });

  it('nunca encerra o que alguém tocou', () => {
    expect(FN).toContain('iniciadoEm: null');
    expect(FN).toContain('if (c.historico.length || c.anexos.length) continue;');
  });

  it('nunca encerra atividade criada por uma pessoa', () => {
    expect(FN).toContain('origemAutomatica: true');
  });

  /** E só o que está PENDENTE: em andamento é alguém cuidando. */
  it('só toca o que está pendente', () => {
    expect(FN).toContain('status: StatusCompromisso.PENDENTE');
  });

  /**
   * O SISTEMA NÃO AFIRMA QUE O PRAZO FOI PERDIDO.
   *
   * Ele nunca calculou vencimento processual e não começa aqui. O que sabe
   * dizer é que ninguém mexeu — e que a providência pode ter sido cumprida
   * fora dele.
   */
  it('a frase diz o que o sistema NÃO sabe', () => {
    expect(FN).toContain('ninguém abriu');
    expect(FN).toContain('NÃO sabemos se a providência foi cumprida fora dele');
    expect(FN).toContain('não ');
    expect(FN).toContain('calcula prazo processual');
    expect(FN).toContain('reabra');
  });

  /*
    "NEM ENTROU" MUDA DE QUEM É A FALHA. Medido em 03/11/2026: as 18 atividades
    abertas tinham responsável sem login desde antes de a tarefa nascer — de 17
    a 48 dias. Calar isso jogaria no advogado um problema de alcance.
  */
  it('diz quando o responsável sequer entrou no sistema', () => {
    expect(FN).toContain('c.responsavel.ultimoLoginEm < c.createdAt');
    expect(FN).toContain('não entrou no sistema desde que ela foi criada');
  });

  it('grava a categoria própria, sem autor humano', () => {
    expect(FN).toContain("canceladoCategoria: 'SEM_INTERACAO'");
    expect(FN).toContain('canceladoPor: null');
  });

  /** Mesma razão de `cancelarPorSistema`: movimentação presa é ato sumido. */
  it('dispensa a movimentação ligada, como o cancelamento do tribunal', () => {
    expect(FN).toContain('dispensarMovimentacaoLigada(tx, c.id, motivo)');
  });

  it('deixa rastro na auditoria e no histórico', () => {
    expect(FN).toContain('this.audit.registrar');
    expect(FN).toContain("'Sistema (sem interação)'");
  });
});

describe('a categoria no catálogo', () => {
  const cat = CATEGORIAS_CANCELAMENTO.find((c) => c.slug === 'SEM_INTERACAO');

  it('existe e tem rótulo de gente', () => {
    expect(cat).toBeDefined();
    expect(cat!.label).toBe('Encerrada por falta de interação');
  });

  /* Ninguém cancela algo "porque não mexeu nela": é constatação, não escolha. */
  it('não é oferecida a uma pessoa no formulário', () => {
    expect(cat!.apenasSistema).toBe(true);
  });
});

/**
 * O CORTE EM DIAS ÚTEIS É O QUE IMPEDE O RECESSO DE DERRUBAR A AGENDA.
 *
 * Vinte dias corridos cairiam dentro de um Natal; vinte de expediente, não.
 */
describe('o corte respeita expediente', () => {
  it('vinte dias úteis atravessam mais de um mês de calendário', () => {
    const inicio = new Date('2026-12-01T12:00:00Z');
    const vinteUteisDepois = new Date('2027-01-05T12:00:00Z');
    // Dezembro tem Natal e janeiro tem o dia 1º; a conta pula os dois.
    expect(diasUteisEntre(inicio, vinteUteisDepois)).toBeLessThan(25);
    expect(diasUteisEntre(inicio, vinteUteisDepois)).toBeGreaterThanOrEqual(20);
  });
});
