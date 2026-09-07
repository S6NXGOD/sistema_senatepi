import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lerCodigo = (rel: string) =>
  readFileSync(resolve(__dirname, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SYNC = lerCodigo('djen-sync.service.ts');
const DASH = lerCodigo('../dashboard/dashboard.module.ts');

/**
 * A VARREDURA DO DJEN NÃO DEIXAVA RASTRO DE TER RODADO.
 *
 * `logSync.registrar` só era chamado quando havia publicação NOVA para gravar —
 * uma linha por processo contemplado. Numa varredura de fim de semana, quando o
 * Diário não circula, a rodada corria inteira, consultava as oito OABs, não
 * achava nada e não gravava linha nenhuma.
 *
 * A home então lia "nenhuma consulta bem-sucedida em 48h" e anunciava a
 * integração como PARADA, em vermelho, num domingo à noite. Medido na produção:
 * 100 chamadas ao DJEN desde que a ponte subiu, ZERO falhas. A integração
 * estava perfeita.
 */
describe('a rodada grava que aconteceu', () => {
  it('escreve uma linha de resumo ao fim da varredura', () => {
    expect(SYNC).toContain('await this.logSync.registrar({');
    expect(SYNC).toContain('novasMovimentacoes: resumo.ingeridas');
    expect(SYNC).toContain('duracaoMs: Date.now() - iniciadaEm');
  });

  /** A linha fala da RODADA, não de um processo — daí o NPU ausente. */
  it('a linha de resumo não carrega NPU', () => {
    const i = SYNC.indexOf('const tentativas =');
    const bloco = SYNC.slice(i, i + 900);
    expect(bloco).not.toContain('numeroCNJ');
    expect(bloco).toContain('fonte: FONTE_DJEN');
  });

  /**
   * E GRAVA ATÉ QUANDO A RODADA QUEBRA. Sem o `finally`, uma varredura que
   * estourasse no meio não deixaria linha — e a tela diria "não rodou" sobre
   * uma rodada que rodou e explodiu. Seria trocar um diagnóstico errado por
   * outro.
   */
  it('o resumo sai no finally, mesmo se a varredura estourar', () => {
    // A janela alargada entrou como TERCEIRO argumento (colheita de histórico).
    // O que o teste guarda é a chamada estar DENTRO do try, com o `finally` logo
    // abaixo — e não a assinatura, que cresce.
    expect(SYNC).toContain('await this.executarVarredura(resumo, aguardar, diasDeHistorico);');
    expect(SYNC).toContain('} finally {');
    expect(SYNC).toContain('await this.registrarResumo(resumo, origem, iniciadaEm, quebrou);');
    expect(SYNC).toContain('sucesso: !quebrou && tentativas > 0 && !tudoFalhou');
    expect(SYNC).toContain('`Varredura interrompida: ${quebrou}`');
  });

  /** E o erro continua subindo — engolir a exceção esconderia a quebra. */
  it('e o erro continua propagando', () => {
    expect(SYNC).toContain('quebrou = (err as Error).message;');
    expect(SYNC).toContain('throw err;');
  });

  /**
   * TENTATIVAS, e não consultas bem-sucedidas. `advogadosConsultados` e
   * `processosConsultados` só sobem quando a chamada VOLTA — somar só os dois
   * fazia uma rodada de 14 minutos em que tudo falhou ser registrada como
   * "varredura sem alvo". Só apareceu rodando de verdade.
   */
  it('conta tentativas, e não sucessos', () => {
    expect(SYNC).toContain(
      'resumo.advogadosConsultados + resumo.processosConsultados + resumo.falhas',
    );
    expect(SYNC).toContain('const tudoFalhou = tentativas > 0 && resumo.falhas === tentativas;');
  });

  /** Rodar e não achar nada é SUCESSO — é o caso normal de fim de semana. */
  it('não achar nada não é falha', () => {
    expect(SYNC).toContain('tentativas > 0 && !tudoFalhou');
    expect(SYNC).toContain('const tudoFalhou = tentativas > 0 && resumo.falhas === tentativas;');
  });

  /** O manual precisa aparecer como manual — senão o log mente sobre a origem. */
  it('a varredura pedida por alguém entra como MANUAL', () => {
    const CTRL = lerCodigo('djen.controller.ts');
    /*
      A ORIGEM é o que o teste guarda — a assinatura cresceu (a janela de
      histórico entrou como terceiro argumento) e crescerá de novo. Sem a origem
      explícita, a varredura clicada por alguém aparece no log como se fosse a
      das 5h, e a linha de resumo mente na hora em que se investiga.
    */
    expect(CTRL).toContain('this.sync.varrer(undefined, OrigemSincronizacao.MANUAL,');
  });
});

/**
 * "NÃO RODOU" NÃO É "FALHOU" — e a faixa dizia a segunda coisa.
 *
 * Quem lê "consulta mal-sucedida" vai atrás do CNJ, da ponte, do certificado.
 * Quem lê "o robô não rodou" vai atrás do agendador. São investigações
 * diferentes, e o dado para separá-las sempre esteve no log.
 */
describe('a saúde das fontes separa quem não tentou', () => {
  it('zero chamadas com sucesso antigo vira NAO_RODOU', () => {
    expect(DASH).toContain("? 'NAO_RODOU'");
    expect(DASH).toContain(': chamadas24 === 0');
  });

  /**
   * DOIS DIAS ÚTEIS, NÃO 24 HORAS.
   *
   * Com varredura DIÁRIA, "24h sem chamada" dispara em qualquer soluço. O
   * usuário viu a faixa numa SEGUNDA às 00h46 porque a última busca fora
   * sexta às 16h35 — UM dia útil, com o Diário fechado no fim de semana e a
   * edição de segunda ainda inexistente. Nada tinha se perdido.
   */
  it('o atraso da fonte se mede em dias úteis', () => {
    expect(DASH).toContain('const atrasado = diasUteisSemSucesso === null || diasUteisSemSucesso >= 2;');
    expect(DASH).toContain('diasUteisSemSucesso,');
  });

  /**
   * A ORDEM DAS PERGUNTAS importava: "em dia?" vinha DEPOIS de "parada?", e por
   * isso um fim de semana virava PARADA antes de qualquer outra checagem.
   */
  it('pergunta "está em dia?" antes de "parou?"', () => {
    const i = DASH.indexOf("const situacao = !l.ultimo_sucesso && chamadas24 === 0");
    const bloco = DASH.slice(i, i + 400);
    expect(bloco.indexOf('!atrasado')).toBeLessThan(bloco.indexOf("'NAO_RODOU'"));
    expect(bloco.indexOf('!atrasado')).toBeLessThan(bloco.indexOf("'PARADA'"));
  });

  /** Nunca ligada continua sendo SEM_USO — alarme sobre função desligada, não. */
  it('nunca usada continua SEM_USO', () => {
    expect(DASH).toContain("const situacao = !l.ultimo_sucesso && chamadas24 === 0\n        ? 'SEM_USO'");
  });
});

/**
 * O SILÊNCIO SE MEDE EM DIAS ÚTEIS.
 */
describe('o silêncio do DJEN', () => {
  it('conta dia útil, não hora', () => {
    expect(DASH).toContain('const diasUteisSemNada = ultimaEm ? diasUteisEntre(ultimaEm, agora) : null;');
    expect(DASH).toContain('diasUteisSemNada! < 2');
  });

  it('e devolve o número para a tela poder dizê-lo', () => {
    expect(DASH).toContain('diasUteisSemNada,');
  });
});

/**
 * 252 CONSULTAS PARA UM NÚMERO QUE O CNJ NUNCA TEVE.
 *
 * `instanciasLidasEm` só era carimbado quando vinha instância, e a fila "ainda
 * não lidos" é exatamente `instanciasLidasEm IS NULL`. Um NPU que o índice não
 * tem ficava nessa fila PARA SEMPRE e era relido a cada abertura da lista de
 * processos — 252 consultas em 12 dias na produção, sempre com a mesma
 * resposta, e o painel só mostrava o desperdício sem freá-lo.
 */
describe('o processo que o CNJ não conhece sai da fila de releitura', () => {
  const PROC = lerCodigo('processos.service.ts');

  /*
    `if (!instancias.length)` aparece DUAS vezes no arquivo: na importação (que
    recusa o processo) e na ressincronização (que apenas registra a tentativa).
    O primeiro `indexOf` pegava a errada — ancorar pelo `ultimaSincronizacao`
    identifica a que interessa.
  */
  const blocoSemInstancia = () => {
    const i = PROC.indexOf('if (!instancias.length) {', PROC.indexOf('ressincronizarSilencioso'));
    expect(i).toBeGreaterThan(-1);
    return PROC.slice(i, i + 400);
  };

  it('carimba a leitura mesmo sem instância nenhuma', () => {
    const bloco = blocoSemInstancia();
    expect(bloco).toContain('ultimaSincronizacao: new Date()');
    expect(bloco).toContain('instanciasLidasEm: new Date()');
  });

  /**
   * E CONTINUA RESPEITANDO A FLAG: com o parser multi-instância desligado, o
   * carimbo faria a reavaliação pular o processo justamente depois de a flag
   * ser ligada — que é quando ele mais precisa ser relido.
   */
  it('mas só quando o parser multi-instância está ligado', () => {
    expect(blocoSemInstancia()).toContain(
      '...(this.datajud.multiInstanciaAtiva ? { instanciasLidasEm: new Date() } : {})',
    );
  });

  /**
   * NADA SE PERDE: a varredura noturna ordena por `ultimaSincronizacao`, não
   * por este campo — um processo recém-distribuído continua sendo reconsultado
   * todo dia e entra assim que o tribunal o indexar.
   */
  it('a varredura noturna não depende deste carimbo', () => {
    const i = PROC.indexOf('idsParaSincronizar');
    expect(PROC.slice(i, i + 900)).not.toContain('instanciasLidasEm');
  });
});
