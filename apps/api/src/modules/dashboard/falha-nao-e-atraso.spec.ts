import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const DASH = lerCodigo('dashboard.module.ts');

/**
 * "TENTATIVA QUE FALHOU" NÃO É "PROCESSO DESATUALIZADO".
 *
 * A faixa da home dizia "a varredura do DataJud não conseguiu atualizar 6
 * processos" e listava seis, em âmbar, com um clique cada. Medido na produção
 * em 05/09/2026: eram OITO timeouts de exatos 45s, todos da MESMA rodada, entre
 * a 82ª e a 106ª consulta — e nas nove noites anteriores houve ZERO timeouts
 * em 1 a 157 consultas por noite.
 *
 * E os seis listados tinham sido lidos com sucesso de 33 a 37 horas antes, sem
 * nada novo no CNJ. Nenhum estava desatualizado. Foi o usuário quem percebeu
 * olhando a tela — e alerta que o próprio leitor desmente ensina a ignorar
 * todos os outros.
 */
describe('a última leitura bem-sucedida, que faltava', () => {
  it('a consulta traz `ultimoSucesso` de cada processo', () => {
    expect(DASH).toContain('AS "ultimoSucesso"');
    expect(DASH).toContain('SELECT max(s.created_at)');
    expect(DASH).toContain("s.sucesso = true");
  });

  /**
   * Sem recorte de tempo na subconsulta: se a última leitura boa foi há uma
   * semana, é exatamente isso que precisa aparecer — limitar a 24h devolveria
   * nulo e faria todo mundo parecer "nunca lido".
   */
  it('e olha o log inteiro, não só as últimas 24h', () => {
    const i = DASH.indexOf('AS "ultimoSucesso"');
    const trecho = DASH.slice(Math.max(0, i - 600), i);
    expect(trecho).not.toContain('created_at >=');
  });

  /** O processo órfão (excluído) só tem o NPU como identidade. */
  it('casa por processo ou, na falta dele, pelo NPU', () => {
    expect(DASH).toContain('OR (u.processo_id IS NULL AND s.numero_cnj = u.numero_cnj)');
  });

  /**
   * A REGRA SAIU DAQUI — e este teste virou melhor por isso (24/09/2026).
   *
   * Ele afirmava duas LINHAS do arquivo: `const limite = agora.getTime() - …` e
   * `atrasados24h: atrasados.length`. Provava que o código tinha aquele texto,
   * não que ele acertava — e quando a régua mudou de 48h fixas para o ciclo de
   * cada processo, o que reprovou foi o teste, não um defeito.
   *
   * Hoje a régua é uma função pura com teste próprio
   * (`falha-do-cnj.spec.ts`), e o que sobra aqui é o que só o arquivo pode
   * garantir: que ele USA a função em vez de refazer a conta.
   */
  it('a régua do atraso vem de `falha-do-cnj.util`, não de uma conta local', () => {
    expect(DASH).toContain("from './falha-do-cnj.util'");
    expect(DASH).toContain('estaAtrasada(f, agora)');
    // A conta antiga, refeita à mão, não pode voltar.
    expect(DASH).not.toContain('HORAS_ATE_ATRASO * HORA');
  });

  it('separa quem falhou de quem ficou para trás, e pelo número REAL', () => {
    expect(DASH).toContain('falhas24h: resumo.total');
    expect(DASH).toContain('atrasados24h: resumo.atrasados');
  });

  /**
   * O CORTE NÃO PODE VIR DO BANCO POR RECÊNCIA. Era `ORDER BY created_at DESC
   * LIMIT 25`, e em 24/09/2026 ele comeu 2 dos 3 processos atrasados — que
   * haviam falhado no COMEÇO da rodada. Quem corta agora é `ordenarFalhas`,
   * depois de pôr na frente o que pede atenção.
   */
  it('a lista é ordenada pelo abandono antes de ser cortada', () => {
    expect(DASH).toContain('ordenarFalhas(lista, agora)');
    expect(DASH).toContain('DashboardService.FALHAS_NA_TELA');
    expect(DASH).not.toMatch(/ORDER BY u\.created_at DESC\s+LIMIT 25/);
  });

  /** E a tela precisa saber que o corte agiu, em vez de parecer completa. */
  it('diz quantas couberam', () => {
    expect(DASH).toContain('falhasMostradas: resumo.mostrando');
  });

  /** A duração distingue "demorou demais" de "não respondeu". */
  it('a duração da chamada viaja junto', () => {
    expect(DASH).toContain('u.duracao_ms    AS "duracaoMs"');
  });
});

/**
 * O CNJ NÃO CONHECE ESTE NÚMERO — e isso era invisível.
 *
 * O caso é gravado como `sucesso = true`, porque a consulta de fato funcionou:
 * o índice é que não tem o processo. Como não é falha, nunca entrou em lista
 * nenhuma — e o robô seguiu perguntando. Medido: um único NPU consultado
 * **243 vezes desde 24/08** na produção.
 */
describe('os NPUs que o CNJ não encontra', () => {
  it('saem do log de SUCESSO, pela mensagem', () => {
    expect(DASH).toContain('private processosDesconhecidosNoCnj(desde: Date)');
    expect(DASH).toContain("l.sucesso = true");
    expect(DASH).toContain("l.mensagem_erro ILIKE '%localizado no índice%'");
  });

  it('contam as tentativas, que é o que revela a insistência', () => {
    expect(DASH).toContain('count(*)::int AS tentativas');
    expect(DASH).toContain('min(l.created_at) AS desde');
  });

  /**
   * Processo distribuído ontem ainda não está no índice — cobrar isso seria
   * acusar o tribunal de um atraso que é normal. Depois de três dias
   * insistindo, a hipótese muda de lado.
   */
  it('só depois de três dias insistindo', () => {
    expect(DASH).toContain("WHERE n.desde <= now() - interval '3 days'");
  });

  /** Lista própria: não é falha do robô, é conferência de cadastro. */
  it('vão numa lista separada das falhas', () => {
    expect(DASH).toContain('desconhecidosNoCnj: situacao === \'SEM_OBJETO\' ? [] : desconhecidos');
  });
});
