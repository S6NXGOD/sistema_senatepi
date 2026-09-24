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
      texto: 'o CNJ demorou demais para responder (mais de 45s)',
      passageiro: true,
    });
  });

  /** Erro de rede de verdade é rápido — e aí o CNJ simplesmente não respondeu. */
  it('mas erro de rede rápido continua sendo sem resposta', () => {
    expect(motivoFalhaDatajud(falha({ duracaoMs: 120 })).texto).toBe('o CNJ não respondeu');
  });

  /** Sem a duração (API antiga na janela de troca) não inventa diagnóstico. */
  it('sem duração, não chuta', () => {
    expect(motivoFalhaDatajud(falha({})).texto).toBe('o CNJ não respondeu');
  });

  /** O status continua mandando: 429 é cota, não lentidão. */
  it('o status tem precedência sobre a duração', () => {
    expect(motivoFalhaDatajud(falha({ httpStatus: 429, duracaoMs: 45001 })).texto)
      .toContain('nossa varredura');
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

  /**
   * "HÁ MAIS DE 48H" SAIU DA FRASE (24/09/2026).
   *
   * Com duas faixas de varredura — vivo toda noite, dormente a cada sete dias —
   * não existe um número só que sirva para todas as linhas. "Perdeu as duas
   * últimas leituras" é o que as duas têm em comum, e é o que diz à pessoa o
   * que ela precisa saber: não foi soluço, é padrão.
   */
  it('o alarme fala de quem PERDEU AS LEITURAS, não de quem falhou', () => {
    expect(TELA).toContain('últimas leituras do CNJ');
    expect(TELA).toContain('tropeçaram nesta rodada mas');
    // A frase antiga cravava 48h para todo mundo, inclusive o dormente.
    expect(TELA).not.toMatch(/sem leitura do\s+CNJ há mais de/);
  });

  /**
   * A RÉGUA É DO SERVIDOR. Recalcular na tela era a terceira cópia da mesma
   * regra — e a que não sabia o ciclo de cada processo.
   */
  it('a tela usa o veredito do servidor quando ele vem', () => {
    expect(TELA).toContain('if (f.atrasada !== undefined) return f.atrasada;');
  });

  /**
   * OS NÚMEROS SÃO OS DO SERVIDOR, não os da lista. Contar em cima da lista
   * cortada foi o que produziu "1 processo" onde eram 3, e "outros 24" com 27
   * falhas no banco.
   */
  it('os números não saem da lista cortada', () => {
    expect(TELA).toContain('const n = total ?? falhas.length;');
    expect(TELA).toContain('const atrasados = atrasadosNoServidor ?? pedemAtencao.length;');
  });

  /**
   * SÓ TROPEÇO NÃO TEM LISTA. Abrir 25 linhas de processos que estão EM DIA foi
   * o que encheu a primeira tela do painel — e quem clicava em "Ver quais"
   * procurava justamente "qual é o que eu preciso olhar?".
   */
  it('sem atrasado, não há o que abrir', () => {
    expect(TELA).toContain('{aberto && !soTropeco && (');
    expect(TELA).toContain('{pedemAtencao.map((f) => {');
    expect(TELA).toContain('disabled={soTropeco}');
  });

  /** E quando o corte agir, a lista diz que cortou. */
  it('a lista truncada não se apresenta como inteira', () => {
    expect(TELA).toContain('{naoCouberam > 0 && (');
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
  /**
   * A CONTAGEM SAIU DO TÍTULO. "o robô já perguntou 252 vezes" era eu mostrando
   * serviço — ninguém decide nada com o número. Ele desceu para a linha do
   * detalhe, onde serve a quem for investigar.
   */
  it('existe e lidera pela consequência', () => {
    expect(TELA).toContain('function DesconhecidosNoCnj');
    expect(TELA).toContain('não recebe andamentos');
    expect(TELA).not.toContain('e o robô já perguntou');
  });

  /**
   * MANDAR CONFERIR SEMPRE ERA MANDAR PROCURAR DEFEITO QUE NÃO EXISTE.
   *
   * O texto único era "Confira o número — ou aguarde, se a distribuição for
   * recente", e as duas metades se anulavam. Medido em 07/09/2026: o único
   * caso é um processo distribuído há 13 dias, PENDENTE. Agora são duas vozes,
   * e o detalhe do corte está em `aviso-do-cnj.spec.ts`.
   */
  it('diz o que fazer — e quando não há o que fazer', () => {
    expect(TELA).toContain('não é preciso fazer nada');
    expect(TELA).toContain('vale conferir se o');
    expect(TELA).toContain('esperaAindaRazoavel');
  });

  /** Tom neutro — misturar com alerta ensina a ignorar o alerta. */
  it('não usa âmbar', () => {
    const i = TELA.indexOf('function DesconhecidosNoCnj');
    const bloco = TELA.slice(i, i + 1500);
    expect(bloco).not.toContain('amber');
    expect(bloco).toContain('border-input bg-muted/40');
  });
});

/**
 * DUAS FAIXAS PARA O MESMO FATO, COM CONCLUSÕES OPOSTAS (24/09/2026).
 *
 * Na mesma dobra do painel, uma embaixo da outra:
 *
 *   "Alguns andamentos podem não ter chegado. O DataJud recusou 27 das 170
 *    leituras registradas hoje."
 *   "O CNJ não respondeu a 27 consultas na última varredura. Nenhum processo
 *    ficou para trás."
 *
 * A segunda é a que serve — ela sabe QUAIS processos ficaram para trás. A
 * primeira mede a proporção de tentativas que não voltaram, que é telemetria da
 * rodada, e telemetria não vai para a tela.
 */
describe('o DataJud instável não é anunciado duas vezes', () => {
  it('a faixa da fonte se cala quando a dos processos vai falar', () => {
    expect(TELA).toContain('const aFaixaDosProcessosVaiFalar =');
    expect(TELA).toContain(
      "!(i.fonte === 'DATAJUD' && i.situacao === 'INSTAVEL' && aFaixaDosProcessosVaiFalar)",
    );
  });

  /**
   * MAS SÓ O DATAJUD INSTÁVEL. "Parada" e "não rodou" falam de outra coisa (o
   * robô não rodou), e o DJEN não tem faixa de processos que o substitua.
   */
  it('parada, não rodou e o DJEN continuam aparecendo', () => {
    expect(TELA).toContain("i.situacao === 'PARADA' || i.situacao === 'INSTAVEL' || i.situacao === 'NAO_RODOU'");
  });

  /** Quem não vê processos não recebe a outra faixa: para ele, esta é a voz. */
  it('sem acesso a processos, o aviso da fonte volta', () => {
    expect(TELA).toContain('data.robo?.falhasProcessos?.length ?? 0');
  });
});
