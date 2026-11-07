import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIAS_CANCELAMENTO } from './desfechos.catalogo';

const SERVICO = readFileSync(join(__dirname, 'agenda.service.ts'), 'utf8');
const FN = SERVICO.slice(
  SERVICO.indexOf('async encerrarSemInteracao('),
  SERVICO.indexOf('async cancelarPorSistema('),
);

/**
 * O CANCELAMENTO POR FALTA DE INTERAÇÃO — o pedido do dono, em duas voltas.
 *
 * 03/11/2026: cancelar quando o advogado perder o prazo. Saiu com 20 dias de
 * expediente parada, e a agenda seguiu mostrando por um mês o que não servia.
 *
 * 07/11/2026: *"essas atividades em que foi perdido prazo ou passou do time,
 * sejam canceladas automaticamente pelo sistema"*.
 *
 * QUANDO cada atividade perde o sentido está em `ponto-sem-volta.util.spec.ts`,
 * com datas de verdade. Aqui fica o que o serviço precisa respeitar ao aplicar.
 */
describe('o serviço aplica a régua, não uma conta própria', () => {
  it('decide por `pontoSemVolta`, que conta o prazo do ato a partir da publicação', () => {
    expect(FN).toContain('const ponto = pontoSemVolta({ tipo: c.tipo, inicio: c.inicio, publicacoes: c.origemComunicacoes });');
    expect(FN).toContain('if (!ponto || !perdeuOSentido(ponto, agora)) continue;');
    // Sem a publicação, a régua cairia no dia marcado — que NÃO é o prazo.
    expect(FN).toContain('origemComunicacoes: { select: { dataDisponibilizacao: true, prazoMencionadoDias: true } }');
  });

  it('a régua antiga, de 20 dias parada, saiu', () => {
    expect(SERVICO).not.toContain('TOLERANCIA_DIAS_UTEIS');
    expect(FN).not.toContain('diasUteisEntre');
  });

  /* O que é fato com hora no mundo nunca vence por tempo: o banco nem devolve. */
  it('nunca toca audiência, consulta, reunião ou perícia', () => {
    expect(FN).toContain('tipo: { notIn: [...NUNCA_VENCEM_POR_TEMPO] }');
  });

  it('nunca cancela o que alguém tocou — interação é o que a frase nega', () => {
    expect(FN).toContain('iniciadoEm: null');
    expect(FN).toContain('if (c.historico.length || c.anexos.length) continue;');
  });

  /** O pedido é sobre "essas atividades", sem distinguir quem criou. */
  it('a tarefa criada por gente também entra', () => {
    expect(FN).not.toContain('origemAutomatica: true');
  });

  it('só toca o que está pendente: em andamento é alguém cuidando', () => {
    expect(FN).toContain('status: StatusCompromisso.PENDENTE');
  });

  it('a frase sai de `fraseDaPerda`, com quem e se a pessoa nem entrou', () => {
    expect(FN).toContain('const motivo = fraseDaPerda(ponto, c.responsavel, nemEntrou);');
    expect(FN).toContain('c.responsavel.ultimoLoginEm < c.createdAt');
    // O papel decide entre "do advogado" e "de quem era responsável".
    expect(FN).toContain('responsavel: { select: { nome: true, role: true, ultimoLoginEm: true } }');
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

/**
 * A DOC DE `cancelarPorSistema` VOLTOU PARA O LUGAR DELA.
 *
 * Em 03/11/2026 o método novo entrou entre a documentação de `cancelarPorSistema`
 * e o próprio método, e ela passou a descrever o vizinho errado.
 */
it('cada método fica com a própria documentação', () => {
  const doc = SERVICO.indexOf('CANCELAMENTO PELO SISTEMA — o tribunal derrubou a pauta.');
  const metodo = SERVICO.indexOf('async cancelarPorSistema(');
  expect(doc).toBeGreaterThan(SERVICO.indexOf('async encerrarSemInteracao('));
  expect(metodo - doc).toBeLessThan(1200);
});

describe('a categoria no catálogo', () => {
  const cat = CATEGORIAS_CANCELAMENTO.find((c) => c.slug === 'SEM_INTERACAO');

  it('existe e tem o rótulo nas palavras do pedido', () => {
    expect(cat).toBeDefined();
    expect(cat!.label).toBe('Cancelada por falta de interação');
  });

  /* Ninguém cancela algo "porque não mexeu nela": é constatação, não escolha. */
  it('não é oferecida a uma pessoa no formulário', () => {
    expect(cat!.apenasSistema).toBe(true);
  });
});
