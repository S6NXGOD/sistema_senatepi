import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PENDENCIA, rotulo, soConhecidas, type Pendencia } from '@/lib/pendencias';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const SINO = ler('components/sino-de-pendencias.tsx');
const GAVETA = ler('components/agenda/compromisso-drawer.tsx');
const PAINEL = ler('app/(dashboard)/dashboard/page.tsx');
/** Só a faixa nova: do nome dela até o componente seguinte. */
const FAIXA = PAINEL.slice(
  PAINEL.indexOf('function ReservasAtrasadas('),
  PAINEL.indexOf('function CargaEquipe('),
);

/**
 * "NÃO SERIA INTERESSANTE COLOCAR O PRINCIPAL COMO RESPONSÁVEL E O OUTRO QUE É
 * CITADO COMO QUEM TAMBÉM PARTICIPA? PARA QUE AMBOS POSSAM RESOLVER." — 12/09/2026.
 *
 * A equipe do caso já entrava como reserva desde 11/09, mas a reserva nunca era
 * avisada — nem quando a tarefa ficava para trás. No caso que motivou o pedido,
 * o responsável não acessava o sistema havia 39 dias; os três colegas do caso
 * não tinham como saber das duas tarefas atrasadas dele.
 */
describe('a tarefa do caso que ficou para trás chega à reserva', () => {
  /** Vermelho porque venceu; fora da faixa de toda tela, porque não é da pessoa. */
  it('vermelha no sino, mas fora da faixa', () => {
    expect(PENDENCIA.ATRASADA_NA_EQUIPE.urgente).toBe(true);
    expect(PENDENCIA.ATRASADA_NA_EQUIPE.naFaixa).toBe(false);
    expect(PENDENCIA.ATRASADA.naFaixa).toBe(true);
  });

  it('o rótulo diz o papel da pessoa, e não a acusa', () => {
    const p = (total: number): Pendencia => ({ tipo: 'ATRASADA_NA_EQUIPE', total, exemplos: [] });
    expect(rotulo(p(1))).toBe('1 atividade atrasada num caso em que você é reserva');
    expect(rotulo(p(2))).toBe('2 atividades atrasadas em casos em que você é reserva');
  });

  it('o sino explica que ninguém resolveu e que dá para assumir', () => {
    expect(SINO).toContain("p.tipo === 'ATRASADA_NA_EQUIPE' &&");
    expect(SINO).toContain('Ninguém resolveu ainda — quem assumir vira o responsável');
  });

  /** A gaveta prometia silêncio para sempre; agora diz as duas metades. */
  it('a gaveta conta quando a reserva passa a ser avisada', () => {
    expect(GAVETA).toContain('Enquanto está em dia, não entra nas pendências deles');
    expect(GAVETA).toContain('o sino deles avisa');
  });
});

/**
 * TIPO QUE A TELA NÃO CONHECE NÃO DERRUBA O CABEÇALHO.
 *
 * O sino e a faixa leem `PENDENCIA[p.tipo]` direto. Uma API mais nova que a tela
 * — a janela de troca do deploy — quebraria o topo de todas as páginas.
 */
describe('a lista de pendências só leva tipos conhecidos', () => {
  it('descarta o tipo novo e o nome que só existe no protótipo', () => {
    const lista = [
      { tipo: 'ATRASADA', total: 1, exemplos: [] },
      { tipo: 'TIPO_QUE_AINDA_NAO_EXISTE', total: 3, exemplos: [] },
      { tipo: 'toString', total: 1, exemplos: [] },
    ] as unknown as Pendencia[];
    expect(soConhecidas(lista).map((p) => p.tipo)).toEqual(['ATRASADA']);
  });
});

describe('no painel do advogado', () => {
  it('aparece à parte, antes da faixa de paradas', () => {
    const reserva = PAINEL.indexOf('<ReservasAtrasadas');
    expect(reserva).toBeGreaterThan(-1);
    expect(reserva).toBeLessThan(PAINEL.indexOf('<AtividadesParadas total='));
    expect(PAINEL).toContain('{pode.agenda && (alertas.reservasAtrasadas?.total ?? 0) > 0 && (');
  });

  it('uma abre direto; várias abrem no lugar, com o nome de quem responde', () => {
    expect(FAIXA).toContain('if (total === 1) {');
    expect(FAIXA).toContain('href={`/agenda?compromisso=${a.id}`}');
    expect(FAIXA).toContain("{aberto ? 'Ocultar' : 'Ver quais'}");
    expect(FAIXA).toContain('de {nomeDe(a.responsavel)} · era para {formatDataHora(a.inicio)}');
    expect(FAIXA).toContain('total > itens.length');
  });

  /** Âmbar, e não vermelho: o atraso é do colega, não de quem está lendo. */
  it('fala baixo: âmbar e sem vermelho', () => {
    expect(FAIXA).toContain('bg-amber-50');
    expect(FAIXA).not.toMatch(/bg-(red|rose)-\d/);
  });
});
