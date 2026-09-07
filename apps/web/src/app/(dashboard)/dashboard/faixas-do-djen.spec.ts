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
  /**
   * Ninguém tentou ≠ tentamos e não voltou. A distinção continua existindo —
   * ela só mudou de lugar: da primeira linha para o detalhe técnico, porque é
   * quem investiga que precisa dela.
   */
  it('separa "não rodou" de "parada"', () => {
    expect(TELA).toContain("i.situacao === 'NAO_RODOU'");
    expect(TELA).toContain('const naoRodou =');
    expect(TELA).toContain('Nenhuma chamada foi registrada nas últimas 24h');
  });

  it('e a de parada fala de chamada com erro', () => {
    expect(TELA).toContain('chamada(s) com erro nas últimas 24h e nenhuma bem-sucedida');
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

/**
 * A FAIXA PRECISA DE UMA ALAVANCA, NÃO SÓ DE UM DIAGNÓSTICO.
 *
 * A versão anterior dizia "não fez nenhuma consulta nas últimas 24h — nem
 * bem-sucedida, nem com erro. Não é o CNJ recusando: é a varredura que não
 * executou." Está tecnicamente certo e é escrito para quem vai CONSERTAR —
 * quem abre a home de manhã precisa saber se pode confiar no que está vendo, e
 * não podia fazer nada com aquilo. Alarme sem saída ensina a ignorar alarme.
 */
describe('a faixa fala de consequência e oferece saída', () => {
  it('lidera pela consequência, não pelo diagnóstico', () => {
    expect(TELA).toContain('podem estar');
    expect(TELA).toContain('desatualizadas.');
    expect(TELA).toContain('const O_QUE_A_FONTE_TRAZ');
    expect(TELA).toContain("oQue: 'as publicações'");
  });

  /** O jargão desceu para trás de um clique, para quem for investigar. */
  it('o diagnóstico técnico vira detalhe', () => {
    expect(TELA).toContain('Detalhe técnico');
    expect(TELA).toContain('Isso aponta para a varredura agendada, e não para o CNJ');
  });

  it('e há um botão que resolve', () => {
    expect(TELA).toContain('rotuloAcao="Buscar agora"');
    expect(TELA).toContain('varrerDjenAgora');
    expect(TELA).toContain("aoAgir={i.fonte === 'DJEN' && podeVarrerDjen");
  });

  /**
   * `POST /djen/sincronizar` é `@Roles(ADMINISTRADOR)`. Botão que devolve 403 é
   * pior que botão ausente — já entreguei um assim neste projeto.
   */
  it('o botão só aparece para quem a API deixa usar', () => {
    expect(TELA).toContain("varrerDjen: role === 'ADMINISTRADOR'");
    expect(TELA).toContain('podeVarrerDjen={pode.varrerDjen}');
  });

  /** "Não rodou" deixou de ser vermelho: o dado fica velho, nada quebrou. */
  it('não rodar não é crítico', () => {
    expect(TELA).toContain("tom={parada ? 'critico' : 'atencao'}");
  });
});

/**
 * A CONTAGEM NÃO É A NOTÍCIA.
 *
 * "o robô já perguntou 252 vezes" era eu mostrando serviço. Ninguém decide nada
 * com esse número; quem lê precisa saber o que está deixando de acontecer.
 */
describe('a faixa do NPU desconhecido', () => {
  it('lidera pela consequência', () => {
    expect(TELA).toContain('não recebe andamentos');
    expect(TELA).toContain('o CNJ não reconhece o número');
  });

  /** Sendo um só, o número cabe na frase — vale mais que a contagem. */
  it('nomeia o processo quando é um só', () => {
    expect(TELA).toContain('formatNPU(itens[0].numeroCNJ)');
  });

  it('e a contagem desce para a linha do detalhe', () => {
    expect(TELA).toContain('consultado {i.tentativas}');
  });
});
