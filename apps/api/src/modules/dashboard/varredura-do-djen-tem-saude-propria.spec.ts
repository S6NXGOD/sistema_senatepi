import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { causaDeRede } from '../processos/djen.service';

const DASH = readFileSync(join(__dirname, 'dashboard.module.ts'), 'utf8').replace(/\r/g, '');

/**
 * O PAINEL FICOU VERDE COM O DJEN PARADO HÁ QUATRO NOITES (06/10/2026).
 *
 * O dono pediu "verifique se há algum problema com DJEN". Havia, e o sistema
 * não estava dizendo. Medido na produção:
 *
 *   última varredura por OAB que deu certo ...... 02/10 05:13
 *   03, 04, 05 e 06/10 .......................... 192 de 192 consultas falharam
 *   publicações que entraram desde 02/10 ........ ZERO (até alguém buscar à mão)
 *   situação no painel .......................... OK
 *
 * A CAUSA DO VERDE: `ultimo_sucesso` é o max de QUALQUER linha que deu certo, e
 * para o DJEN isso inclui a consulta por NÚMERO, que dispara quando alguém abre
 * a aba Publicações de um processo. Às 11h22 daquele dia três dessas deram
 * certo e zeraram o atraso de uma varredura que não funcionava havia quatro
 * noites.
 *
 * Uma ficha aberta por alguém não prova que a varredura funciona. O DataJud já
 * tinha `ultima_rodada_ok` para responder "rodou?"; o DJEN não tinha nada.
 */
describe('a saúde do DJEN sai da RODADA, não de qualquer consulta', () => {
  it('a consulta traz a última varredura do DJEN que terminou bem', () => {
    expect(DASH).toContain("CASE WHEN fonte = 'DJEN' THEN (");
    const i = DASH.indexOf("CASE WHEN fonte = 'DJEN' THEN (");
    const bloco = DASH.slice(i, i + 360);
    // A linha de RESUMO é a que não tem processo nem NPU.
    expect(bloco).toContain('r.processo_id IS NULL');
    expect(bloco).toContain('r.numero_cnj IS NULL');
    expect(bloco).toContain('r.sucesso');
    expect(bloco).toContain('AS ultima_varredura_ok');
  });

  /** E é ELA que decide o atraso — não `ultimo_sucesso`. */
  it('o atraso do DJEN se mede pela varredura', () => {
    expect(DASH).toContain(
      "l.fonte === 'DJEN' ? (l.ultima_varredura_ok ?? l.ultimo_sucesso) : l.ultimo_sucesso",
    );
    expect(DASH).toContain('const diasUteisSemSucesso = baseDoAtraso ? diasUteisEntre(baseDoAtraso, agora) : null;');
  });

  /**
   * RESERVA PARA O DADO ANTIGO. Antes de a rodada ser registrada havia noites
   * sem linha de resumo; sem o `??` essas fontes cairiam em "nunca rodou" e a
   * tela acusaria uma parada que não houve.
   */
  it('sem rodada registrada, volta a valer o último sucesso', () => {
    expect(DASH).toContain('?? l.ultimo_sucesso');
  });

  /** A tela recebe a data da varredura para não contradizer o "último sucesso". */
  it('a saída expõe a data que decidiu', () => {
    expect(DASH).toContain('ultimaVarreduraOk: l.ultima_varredura_ok,');
  });

  /** O DataJud não muda: a régua dele continua sendo a dele. */
  it('o DataJud segue com a própria rodada', () => {
    expect(DASH).toContain("CASE WHEN fonte = 'DATAJUD' THEN (");
    expect(DASH).toContain('AS ultima_rodada_ok');
  });
});

/**
 * "FALHA DE REDE" NÃO DIZ POR ONDE COMEÇAR.
 *
 * Nas quatro noites, tudo que ficou no banco foi "Não foi possível alcançar o
 * DJEN (falha de rede)". O nome do erro do Node — o que separa "o endereço não
 * resolve" de "a conexão caiu no meio" — ia só para o stdout do Railway.
 *
 * As causas levam a investigações OPOSTAS: ENOTFOUND é a variável
 * `DJEN_BASE_URL`; ECONNREFUSED é o Nginx da ponte; ECONNRESET é a resposta
 * grande morrendo no meio (a busca por OAB traz 200 a 550 KB e falhava; a por
 * número, 20 KB, funcionava na mesma noite); EPROTO é https apontado para um
 * servidor que só atende http.
 */
describe('causaDeRede — o código do erro vai junto', () => {
  it('usa o code do `cause`, que é onde o fetch do Node o põe', () => {
    expect(causaDeRede({ cause: { code: 'ECONNRESET' } })).toBe('falha de rede: ECONNRESET');
    expect(causaDeRede({ cause: { code: 'ENOTFOUND' } })).toBe('falha de rede: ENOTFOUND');
  });

  it('aceita o code na raiz, para erro que não vem do fetch', () => {
    expect(causaDeRede({ code: 'ECONNREFUSED' })).toBe('falha de rede: ECONNREFUSED');
  });

  /** Sem código, a mensagem — uma linha só, para caber na coluna do log. */
  it('sem código, leva a primeira linha da mensagem', () => {
    expect(causaDeRede({ cause: { message: 'self-signed certificate\nmais detalhe' } })).toBe(
      'falha de rede: self-signed certificate',
    );
  });

  it('truncada, para não estourar a coluna', () => {
    const longa = 'x'.repeat(200);
    const r = causaDeRede({ message: longa });
    expect(r.length).toBeLessThanOrEqual('falha de rede: '.length + 90);
  });

  /** Erro sem nada aproveitável não inventa diagnóstico. */
  it('sem nada, volta a frase genérica', () => {
    expect(causaDeRede({})).toBe('falha de rede');
    expect(causaDeRede(null)).toBe('falha de rede');
    expect(causaDeRede(undefined)).toBe('falha de rede');
  });
});
