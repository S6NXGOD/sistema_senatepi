import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const TELA = lerCodigo('page.tsx');

/**
 * TRÊS FAIXAS SOBRE O DJEN NUMA TELA SÓ, E DUAS DELAS ERRADAS.
 *
 * O print de domingo à noite trazia: uma vermelha ("sem nenhuma consulta
 * bem-sucedida … dois dias em silêncio é defeito") e uma âmbar ("nenhuma
 * publicação nova há 54h"). Medido na produção: 100 chamadas ao DJEN desde que
 * a ponte subiu, ZERO falhas; e das 1.408 publicações, NENHUMA é de sábado ou
 * domingo. Não havia defeito nenhum — era fim de semana.
 */
describe('a faixa de integração parada', () => {
  /** Ninguém tentou ≠ tentamos e não voltou. Manda em quem se procura. */
  it('separa "não rodou" de "parada"', () => {
    expect(TELA).toContain("i.situacao === 'NAO_RODOU'");
    expect(TELA).toContain('const naoRodou =');
    expect(TELA).toContain('nenhuma consulta');
    expect(TELA).toContain('é a varredura que não executou');
  });

  it('e a de parada fala de tentativa sem resposta', () => {
    expect(TELA).toContain('tentou e não obteve resposta');
  });
});

/**
 * A FRASE CONTRADIZIA A PRÓPRIA FAIXA: dizia que "fim de semana explica
 * silêncio curto" — e aparecia justamente por causa do fim de semana.
 */
describe('o silêncio de publicações', () => {
  it('é contado em dias úteis', () => {
    expect(TELA).toContain('const uteis = djen.diasUteisSemNada;');
    expect(TELA).toContain('dia${uteis === 1');
    expect(TELA).toContain('O Diário não circula no fim de semana');
  });

  /**
   * A MESMA COISA DUAS VEZES NÃO É DOIS AVISOS. Se a barra de integrações já
   * diz que o DJEN parou, "nenhuma publicação nova" é a consequência disso —
   * apresentada como se fosse um achado independente.
   */
  it('cala quando a barra de integrações já explicou', () => {
    expect(TELA).toContain('function integracaoDjenComProblema');
    expect(TELA).toContain('if (calado) return null;');
    expect(TELA).toContain('calado={integracaoDjenComProblema(data)}');
  });

  /** Integração sem uso não é problema — não pode calar um aviso legítimo. */
  it('só cala por problema de verdade', () => {
    expect(TELA).toContain("i.situacao !== 'OK' && i.situacao !== 'SEM_USO'");
  });
});
