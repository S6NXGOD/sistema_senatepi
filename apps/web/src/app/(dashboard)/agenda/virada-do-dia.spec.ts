import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { refazerSeODiaVirou } from './virada-do-dia';

/*
  15/09/2026, revisão da rodada 4: à meia-noite o rótulo "Hoje" virava e os
  dados continuavam os de ontem ("Nenhuma atividade hoje." com consultas no dia).
*/
describe('a agenda refaz as consultas quando o dia de Teresina vira', () => {
  const qcFalso = () => {
    const chaves: string[][] = [];
    return { chaves, invalidateQueries: (f: { queryKey: string[] }) => { chaves.push(f.queryKey); } };
  };

  it('no primeiro desenho, e enquanto o dia é o mesmo, não refaz nada', () => {
    const qc = qcFalso();
    const visto = { current: '2026-09-14' };
    expect(refazerSeODiaVirou(visto, '2026-09-14', qc)).toBe(false);
    expect(refazerSeODiaVirou(visto, '2026-09-14', qc)).toBe(false);
    expect(qc.chaves).toEqual([]);
  });

  it('de 14/09 para 15/09: a agenda, as pendências e o resumo do painel, uma vez só', () => {
    const qc = qcFalso();
    const visto = { current: '2026-09-14' };
    expect(refazerSeODiaVirou(visto, '2026-09-15', qc)).toBe(true);
    expect(qc.chaves).toEqual([['compromissos'], ['minhas-pendencias'], ['dashboard-resumo']]);
    // O minuto seguinte, ainda 15/09, não refaz de novo.
    expect(refazerSeODiaVirou(visto, '2026-09-15', qc)).toBe(false);
    expect(qc.chaves).toHaveLength(3);
  });

  it('a página da agenda liga o dia de Teresina a esta regra', () => {
    const pagina = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');
    expect(pagina).toMatch(/useRefazerNaViradaDoDia\(hoje, qc\);/);
  });
});
