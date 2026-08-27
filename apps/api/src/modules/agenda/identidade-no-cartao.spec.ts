import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { PARTE_ORDER } from '../processos/partes.service';

const AGENDA = readFileSync(path.join(__dirname, 'agenda.service.ts'), 'utf8');
const DASHBOARD = readFileSync(
  path.join(__dirname, '..', 'dashboard', 'dashboard.module.ts'),
  'utf8',
);

/**
 * DE QUAL PROCESSO É ESTA ATIVIDADE.
 *
 * O defeito, visto numa tela real: dois cartões lado a lado, ambos
 * "Verificação de Intimação / Prazo", mesma data, mesmo advogado, e nada que
 * dissesse de qual processo cada um era. Eram processos DIFERENTES — o robô
 * agrupa por processo e por dia, então dois cartões iguais são dois casos. Para
 * quem olhava, era um só duplicado.
 *
 * O conserto é na TELA, derivando das partes, e não no título gravado (que é
 * sentinela da promoção pelo DJEN e envelheceria quando uma parte mudasse). Mas
 * a tela só consegue derivar se o payload trouxer as partes — e como o campo é
 * opcional no tipo do front, esquecê-lo aqui faria a linha simplesmente sumir,
 * sem erro nenhum. É esse silêncio que estes testes cobrem.
 */
describe('as partes chegam aos cartões', () => {
  it('o cartão da agenda carrega as partes do processo', () => {
    const sel = AGENDA.slice(
      AGENDA.indexOf('const processoSel'),
      AGENDA.indexOf('const EQUIPE_ORDER'),
    );
    expect(sel.length).toBeGreaterThan(200); // o teste não olha para o vazio
    expect(sel).toContain('partes:');
    expect(sel).toContain('orderBy: PARTE_ORDER');
    expect(sel).toContain('tipoAcao: true');
  });

  it('a linha do painel também — sofria do mesmo problema', () => {
    const sel = DASHBOARD.slice(
      DASHBOARD.indexOf('const compSelect'),
      DASHBOARD.indexOf('export class DashboardService'),
    );
    expect(sel.length).toBeGreaterThan(200);
    expect(sel).toContain('partes:');
    expect(sel).toContain('orderBy: PARTE_ORDER');
  });

  /**
   * O CONTRATO DA ORDENAÇÃO.
   *
   * A tela pega `partes.find(p => p.polo === 'PASSIVO')` e trata o resultado
   * como a parte PRINCIPAL. Isso só é verdade porque `PARTE_ORDER` põe
   * `principal: 'desc'` antes de qualquer outro critério dentro do polo. Se
   * alguém reordenar, o cartão passa a exibir uma parte secundária — e não há
   * erro, só um nome errado na tela, que é o pior tipo de falha.
   */
  it('PARTE_ORDER garante a principal primeiro dentro do polo', () => {
    const porPolo = PARTE_ORDER.findIndex((o) => 'polo' in o);
    const porPrincipal = PARTE_ORDER.findIndex((o) => 'principal' in o);

    expect(porPrincipal).toBeGreaterThanOrEqual(0);
    expect(PARTE_ORDER[porPrincipal]).toEqual({ principal: 'desc' });
    // O agrupamento por polo vem antes; dentro dele, a principal encabeça.
    expect(porPolo).toBeLessThan(porPrincipal);
  });

  /**
   * LGPD: o cartão precisa do NOME de quem litiga contra, não do documento
   * nem do endereço. Puxar a parte inteira encheria a resposta de dado pessoal
   * que a tela não usa — e uma agenda cheia carrega dezenas delas.
   */
  it('só nome e polo viajam — nada de documento no cartão', () => {
    for (const fonte of [AGENDA, DASHBOARD]) {
      const sel = fonte.slice(fonte.indexOf('partes: { select:'));
      const bloco = sel.slice(0, sel.indexOf('}'));
      expect(bloco).toContain('nome: true');
      expect(bloco).toContain('polo: true');
      expect(bloco).not.toContain('documento');
    }
  });
});
