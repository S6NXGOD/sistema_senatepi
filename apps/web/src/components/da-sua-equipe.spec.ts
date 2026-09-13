import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAINEL = readFileSync(join(__dirname, '..', 'app/(dashboard)/dashboard/page.tsx'), 'utf8');
/** Só o bloco novo: do nome dele até o componente seguinte. */
const BLOCO = PAINEL.slice(PAINEL.indexOf('function DaSuaEquipe('), PAINEL.indexOf('function CargaEquipe('));

/**
 * "QUANDO O ADVOGADO ENTRA DE RESERVA, ELE É AVISADO QUE PRECISA RESOLVER ESSA
 * TAREFA? AFINAL, É UMA EQUIPE." — 12/09/2026.
 *
 * Só era avisado quando a tarefa ficava para trás. O painel do advogado passou a
 * ter a equipe à parte: em âmbar o que está sem ninguém cuidando, e recolhido o
 * que os colegas têm na mão nos próximos sete dias.
 */
describe('sua equipe, no painel do advogado', () => {
  it('vem logo depois da sua agenda', () => {
    const agenda = PAINEL.indexOf('<AtividadesDoDia');
    const equipe = PAINEL.indexOf('<DaSuaEquipe');
    expect(agenda).toBeGreaterThan(-1);
    expect(equipe).toBeGreaterThan(agenda);
    expect(PAINEL).toContain('{pode.agenda && alertas.daEquipe && <DaSuaEquipe daEquipe={alertas.daEquipe} />}');
  });

  /** A faixa da reserva atrasada virou a primeira metade do bloco — não um aviso a mais. */
  it('a faixa antiga da reserva atrasada saiu', () => {
    expect(PAINEL).not.toContain('<ReservasAtrasadas');
    expect(PAINEL).not.toContain('reservasAtrasadas');
  });

  it('primeiro o que precisa de alguém, com o porquê e o dia de cada uma', () => {
    expect(BLOCO.indexOf('totalPrecisam > 0')).toBeGreaterThan(-1);
    expect(BLOCO.indexOf('totalPrecisam > 0')).toBeLessThan(BLOCO.indexOf('totalAcompanhando > 0'));
    expect(BLOCO).toContain('{t.detalhe} · para {formatDataHora(t.inicio)}');
    expect(BLOCO).toContain('href={`/agenda?compromisso=${t.id}`}');
  });

  it('o que está em dia fica recolhido: é saber, não cobrança', () => {
    expect(BLOCO).toContain('const [verAcompanhando, setVerAcompanhando] = useState(false);');
    expect(BLOCO).toContain('aria-expanded={verAcompanhando}');
  });

  /** O atraso é do colega, não de quem está lendo. */
  it('fala baixo: âmbar, sem vermelho', () => {
    expect(BLOCO).toContain('bg-amber-50');
    expect(BLOCO).not.toMatch(/bg-(red|rose)-\d/);
  });
});
