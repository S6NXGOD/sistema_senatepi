import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { motivoFalhaDatajud, type FalhaDatajud } from '@/lib/dashboard';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const TELA = lerCodigo('page.tsx');
const falha = (p: Partial<FalhaDatajud>): FalhaDatajud =>
  ({ processoId: 'x', numeroCNJ: '1', tribunal: null, httpStatus: null,
     mensagemErro: null, createdAt: '', filiado: null, ...p } as FalhaDatajud);

/**
 * "SEM RESPOSTA DO CNJ" DIZIA A COISA ERRADA.
 *
 * As oito falhas da produção em 05/09/2026 duraram exatos 45.000ms — o teto de
 * espera do NOSSO lado. O CNJ não estava fora do ar; estava lento demais para a
 * janela que damos a ele. Quem lê "sem resposta" vai procurar defeito no
 * processo; quem lê "demorou mais de 45s" sabe o que aconteceu.
 */
describe('o motivo da falha', () => {
  it('chama timeout de timeout', () => {
    expect(motivoFalhaDatajud(falha({ duracaoMs: 45001 }))).toEqual({
      texto: 'o CNJ demorou mais de 45s',
      passageiro: true,
    });
  });

  /** Erro de rede de verdade é rápido — e continua sendo "sem resposta". */
  it('mas erro de rede rápido continua sendo sem resposta', () => {
    expect(motivoFalhaDatajud(falha({ duracaoMs: 120 })).texto).toBe('sem resposta do CNJ');
  });

  /** Sem a duração (API antiga na janela de troca) não inventa diagnóstico. */
  it('sem duração, não chuta', () => {
    expect(motivoFalhaDatajud(falha({})).texto).toBe('sem resposta do CNJ');
  });

  /** O status continua mandando: 429 é cota, não lentidão. */
  it('o status tem precedência sobre a duração', () => {
    expect(motivoFalhaDatajud(falha({ httpStatus: 429, duracaoMs: 45001 })).texto)
      .toBe('limite de consultas atingido');
    expect(motivoFalhaDatajud(falha({ httpStatus: 404, duracaoMs: 45001 })).passageiro).toBe(false);
  });
});

/**
 * A FAIXA PRECISA DIZER SE ALGO FICOU PARA TRÁS — não se alguma tentativa
 * falhou. São perguntas diferentes, e só a primeira pede ação.
 */
describe('a faixa da varredura', () => {
  it('classifica por tempo desde a última leitura boa', () => {
    expect(TELA).toContain('const atrasado = (f: FalhaDatajud) =>');
    expect(TELA).toContain('horasAteAtraso * 3_600_000');
    expect(TELA).toContain('const soTropeco = atrasados === 0;');
  });

  /**
   * Sem `ultimoSucesso` (API velha atendendo tela nova na janela de troca), não
   * dá para afirmar que está em dia — e errar para o lado do alarme é o lado
   * seguro.
   */
  it('sem a informação, erra para o lado do alarme', () => {
    expect(TELA).toContain('if (f.ultimoSucesso === undefined) return true;');
  });

  /** Nada ficou para trás: informação em cinza, não alarme em âmbar. */
  it('tropeço do CNJ não usa cor de alerta', () => {
    expect(TELA).toContain("? 'border-input bg-muted/40 text-muted-foreground'");
    expect(TELA).toContain('Nenhum processo ficou para trás');
  });

  it('e o alarme fala de quem está sem leitura, não de quem falhou', () => {
    expect(TELA).toContain('sem leitura do');
    expect(TELA).toContain('tropecaram nesta rodada mas');
  });

  /**
   * Cada linha responde à própria acusação. Sem isso o item aparece como
   * problema e nada na tela diz que o processo foi lido com sucesso ontem —
   * foi essa dúvida que trouxe o usuário até aqui.
   */
  it('cada linha diz quando o processo foi lido com sucesso', () => {
    expect(TELA).toContain('lido ${tempoRelativo(f.ultimoSucesso)}');
    expect(TELA).toContain('nunca lido com sucesso');
  });
});

/**
 * O CNJ NÃO CONHECE ESTE NÚMERO — barra própria, tom neutro.
 *
 * Não é falha de integração: a consulta funciona, o índice é que não tem o
 * processo. É conferência de cadastro — ou o número está errado, ou o processo
 * não foi distribuído.
 */
describe('a barra dos NPUs desconhecidos', () => {
  it('existe e mostra a insistência', () => {
    expect(TELA).toContain('function DesconhecidosNoCnj');
    expect(TELA).toContain('O CNJ não encontra');
    expect(TELA).toContain('e o robô já perguntou');
  });

  /** Nome próprio no lugar de "erro": quem lê tem de saber o que fazer. */
  it('diz o que fazer', () => {
    expect(TELA).toContain('Confira o número, ou aguarde a');
  });

  /** Tom neutro — misturar com alerta ensina a ignorar o alerta. */
  it('não usa âmbar', () => {
    const i = TELA.indexOf('function DesconhecidosNoCnj');
    const bloco = TELA.slice(i, i + 1500);
    expect(bloco).not.toContain('amber');
    expect(bloco).toContain('border-input bg-muted/40');
  });
});
