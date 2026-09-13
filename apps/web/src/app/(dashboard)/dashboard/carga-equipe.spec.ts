import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIAS_PARA_NOTAR_AUSENCIA, diasSemAcesso } from '@/lib/dashboard';

const PAINEL = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

/** Só o componente, do nome até o bloco seguinte. */
const CARGA = PAINEL.slice(
  PAINEL.indexOf('function CargaEquipe('),
  PAINEL.indexOf('ANIVERSARIANTES DO DIA'),
);

/**
 * "EXISTE ALGUMA MANEIRA DE ALERTAR OS ADVOGADOS? ... MAS NÃO PREJUDIQUE A UI/UX."
 * — pedido de 12/09/2026.
 *
 * A medição respondeu antes do código: o sino, a faixa e o painel já avisavam.
 * O furo era de ALCANCE — das três atrasadas da casa, duas eram de alguém que
 * não entrava havia 39 dias. Aviso novo dentro do sistema não chega a quem não
 * entra; quem chega é a coordenação. Então nada de bloco novo: uma linha a mais
 * no cartão que a coordenação já lê, e a linha vira porta para a agenda da
 * pessoa.
 */
describe('a carga da equipe mostra quem não tem entrado', () => {
  const agora = Date.parse('2026-09-12T15:00:00Z');

  /** Folga, feriado e audiência fora não viram acusação em toda linha. */
  it('abaixo de uma semana não diz nada', () => {
    expect(DIAS_PARA_NOTAR_AUSENCIA).toBe(7);
    expect(diasSemAcesso('2026-09-10T12:00:00Z', agora)).toBeNull();
    expect(diasSemAcesso('2026-09-05T15:00:01Z', agora)).toBeNull();
  });

  it('a partir de sete dias, diz quantos', () => {
    expect(diasSemAcesso('2026-09-05T15:00:00Z', agora)).toBe(7);
    expect(diasSemAcesso('2026-08-04T18:54:00Z', agora)).toBe(38);
  });

  /** Nulo é "nunca entrou"; ausente é a API de antes — e aí não se afirma nada. */
  it('distingue quem nunca entrou de quando o dado não veio', () => {
    expect(diasSemAcesso(null, agora)).toBe('NUNCA');
    expect(diasSemAcesso(undefined, agora)).toBeNull();
  });

  /**
   * A LINHA ABRE A AGENDA DA PESSOA NA MESMA RÉGUA DA CONTA (C11).
   *
   * Afirmava `/agenda?responsavel=<id>`: a carga contava só o principal e o
   * destino trazia equipe e reserva — o número mudava no clique. A conta passou
   * a ser `daPessoa`, e o link é `aba=aberto&pessoa=<id>`; que a agenda lê esse
   * endereço está provado em `lib/dashboard.spec.ts`, por `lerUrlDaAgenda`.
   */
  it('a linha abre a agenda da pessoa', () => {
    expect(CARGA).toContain("href={linkDaAgenda({ aba: 'aberto', pessoa: advogado.id })}");
  });

  /** Sem ranking: ordem alfabética, sem barra comparativa, atraso em âmbar. */
  it('não desenha pódio', () => {
    expect(CARGA).toContain(".localeCompare(nomeDe(b.advogado), 'pt-BR')");
    expect(CARGA).not.toContain('Math.round((abertas / maior) * 100)');
    expect(CARGA).not.toMatch(/(bg|text)-rose-\d/);
  });

  it('fala de acesso, e fica âmbar só quando há atraso junto', () => {
    expect(CARGA).toContain('const ausencia = diasSemAcesso(ultimoAcesso);');
    expect(CARGA).toContain('`Último acesso há ${ausencia} dias`');
    expect(CARGA).toContain("'Ainda não entrou no sistema'");
    expect(CARGA).toContain("? 'font-medium text-amber-700 dark:text-amber-400'");
  });

  /** Aviso é ESTADO, nunca evento: nenhum canal novo nasceu daqui. */
  it('não abre canal de notificação', () => {
    expect(CARGA).not.toMatch(/notifica|e-mail|whatsapp|push/i);
  });
});
