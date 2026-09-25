import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { segundosParaTentarDeNovo } from '@/lib/processos';

const FICHA = readFileSync(join(__dirname, 'processo-detalhe-sheet.tsx'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * O BOTÃO CONTINUAVA CLICÁVEL DEPOIS DE O CNJ DIZER NÃO (25/09/2026).
 *
 * "O DATAJUD retornou HTTP 429. Tente novamente em instantes." — e nada mais.
 * Não diz o porquê, não diz o quando, e o botão segue lá. Quem clica de novo
 * toma a mesma recusa: um único NPU juntou **35 sincronizações manuais** antes
 * de a pessoa desistir, sem abrir chamado.
 *
 * Medido na produção: naquele horário a nossa ÚNICA chamada ao DataJud foi a
 * dela (a varredura terminou às 06h35). A cota é por IP e o endereço de saída
 * do Railway é compartilhado — o vizinho gastou o minuto. Não havia consumo
 * nosso para cortar; havia uma resposta para consertar.
 */
describe('segundosParaTentarDeNovo — o relógio vem do servidor', () => {
  const erro = (data: unknown) => ({ response: { data } });

  it('lê os segundos que a API mandou', () => {
    expect(segundosParaTentarDeNovo(erro({ segundosParaTentar: 58 }))).toBe(58);
  });

  /** Erro que não é de cota não trava botão — isso esconderia defeito de verdade. */
  it('sem o campo, não impõe espera nenhuma', () => {
    expect(segundosParaTentarDeNovo(erro({ message: 'O CNJ não respondeu.' }))).toBe(0);
    expect(segundosParaTentarDeNovo(erro(undefined))).toBe(0);
    expect(segundosParaTentarDeNovo(new Error('rede caiu'))).toBe(0);
    expect(segundosParaTentarDeNovo(null)).toBe(0);
    expect(segundosParaTentarDeNovo(undefined)).toBe(0);
  });

  it('lixo no campo é o mesmo que campo ausente', () => {
    expect(segundosParaTentarDeNovo(erro({ segundosParaTentar: 'já já' }))).toBe(0);
    expect(segundosParaTentarDeNovo(erro({ segundosParaTentar: 0 }))).toBe(0);
    expect(segundosParaTentarDeNovo(erro({ segundosParaTentar: -3 }))).toBe(0);
    expect(segundosParaTentarDeNovo(erro({ segundosParaTentar: null }))).toBe(0);
  });

  /** Nenhum botão desta casa fica trancado mais que cinco minutos. */
  it('tem teto', () => {
    expect(segundosParaTentarDeNovo(erro({ segundosParaTentar: 99999 }))).toBe(300);
  });

  it('arredonda para cima: 0,4s de espera ainda é espera', () => {
    expect(segundosParaTentarDeNovo(erro({ segundosParaTentar: 0.4 }))).toBe(1);
  });
});

describe('a ficha espera a cota em vez de deixar clicar', () => {
  it('o botão fica desabilitado enquanto a contagem corre', () => {
    expect(FICHA).toContain('disabled={sincronizar.isPending || esperaEmSegundos > 0}');
  });

  /**
   * OS DOIS RELÓGIOS ANDAM JUNTOS. `agora` só é atualizado pelo intervalo, que
   * ainda não existe no instante do erro — sem carimbar os dois, a conta soma o
   * tempo que a gaveta ficou aberta: ficha aberta há três minutos mostraria
   * "238s" para uma espera de 58.
   */
  it('carimba `agora` junto com o fim da espera', () => {
    const i = FICHA.indexOf('const s = segundosParaTentarDeNovo(e);');
    expect(i).toBeGreaterThan(0);
    const trecho = FICHA.slice(i, i + 260);
    expect(trecho).toContain('setAgora(Date.now());');
    expect(trecho).toContain('setEsperarAte(Date.now() + s * 1000);');
  });

  /**
   * E O SEGUNDO APARECE NO CELULAR. Ali o rótulo "Sincronizar" fica escondido;
   * um botão cinza sem nada escrito é o que faz a pessoa achar que travou.
   */
  it('mostra os segundos mesmo com o rótulo escondido', () => {
    expect(FICHA).toContain('{esperaEmSegundos}s');
  });

  /** O intervalo para sozinho quando a espera acaba — nada de tique eterno. */
  it('o tique só existe enquanto há espera', () => {
    expect(FICHA).toContain('if (esperarAte <= agora) return;');
    expect(FICHA).toContain('return () => clearInterval(t);');
  });

  /** A mensagem de fallback não cita mais a integração em caixa alta. */
  it('o erro genérico fala do CNJ, e não de "DATAJUD"', () => {
    expect(FICHA).toContain("'Não foi possível sincronizar com o CNJ.'");
  });
});

/**
 * COTA CHEIA NÃO É VERMELHO.
 *
 * Vermelho, nesta casa, é do Excluir. A recusa por cota não quebrou nada: nada
 * se perdeu, o processo não tem defeito, e a varredura da madrugada lê de
 * qualquer forma. O que ela faz é PEDIR VOCÊ daqui a alguns segundos — e pedir
 * é âmbar. Gritar por algo que não quebrou é como se gasta o alarme.
 */
describe('a cor do aviso combina com o que aconteceu', () => {
  it('cota fechada é âmbar; o erro de verdade continua vermelho', () => {
    expect(FICHA).toContain('if (s) toast.warning(aviso);');
    expect(FICHA).toContain('else toast.error(aviso);');
  });
});
