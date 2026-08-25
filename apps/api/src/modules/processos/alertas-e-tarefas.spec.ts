import { readFileSync } from 'node:fs';
import * as path from 'node:path';

const ler = (arquivo: string) =>
  readFileSync(path.join(__dirname, arquivo), 'utf8');

const AUTOMACAO = ler('automacao-prazos.service.ts');
const PROCESSOS = ler('processos.service.ts');
const MOVIMENTACOES = ler('movimentacoes.service.ts');

/**
 * UM AVISO, UMA REGRA, UM LUGAR.
 *
 * O defeito que originou tudo isto não foi um `if` errado — foi a MESMA
 * pergunta ("este ato ainda pede providência?") sendo respondida em dois
 * lugares com regras diferentes:
 *
 *   · `movimentacoes.service.ts` (a ficha) tinha janela de 30 dias;
 *   · `processos.service.ts` (a lista) não tinha janela nenhuma.
 *
 * Resultado medido na produção em 25/08/2026: a lista mostrava 11 selos "Prazo
 * sem tarefa" que a ficha do mesmo processo não mostrava. Nenhum dos 11 tinha
 * menos de 15 dias.
 *
 * Estes testes existem para impedir que a regra volte a se espalhar. Eles leem
 * o CÓDIGO de propósito: um teste de comportamento passaria feliz com a lógica
 * duplicada, desde que as duas cópias concordassem NAQUELE dia.
 */
describe('a decisão de alertar mora em tpu.util', () => {
  it('a lista pergunta a `atoAcionavel`, não decide sozinha', () => {
    const trecho = PROCESSOS.slice(
      PROCESSOS.indexOf('private alertaDaLinha'),
      PROCESSOS.indexOf('OS NÚMEROS DAS ABAS'),
    );
    expect(trecho.length).toBeGreaterThan(300); // o teste não olha para o vazio
    expect(trecho).toContain('atoAcionavel(ultimo, agora)');
    // Nenhuma comparação de nível na mão: era assim que a regra se duplicava.
    expect(trecho).not.toMatch(/nivel === 'ENCERRAMENTO'/);
    expect(trecho).not.toMatch(/atoCritico\(/);
  });

  it('a ficha pergunta a `atoAcionavel` e largou a janela própria', () => {
    const trecho = MOVIMENTACOES.slice(
      MOVIMENTACOES.indexOf('private atencaoRequerida'),
      MOVIMENTACOES.indexOf('private historicoOrgaos'),
    );
    expect(trecho.length).toBeGreaterThan(300);
    expect(trecho).toContain('atoAcionavel(m, agora)');
    // A janela de 30 dias escrita à mão AQUI é o que fazia as duas telas
    // discordarem — agora ela vive em VALIDADE_DIAS, por nível.
    expect(trecho).not.toMatch(/30 \* 24 \* 3_600_000/);
  });

  it('a lista carrega os campos que a regra precisa para não mentir', () => {
    const consulta = PROCESSOS.slice(
      PROCESSOS.indexOf('const [total, items] = await this.prisma.$transaction'),
      PROCESSOS.indexOf('alerta: this.alertaDaLinha'),
    );
    // Sem `dispensadoEm` o aviso volta depois de a pessoa dispensá-lo; sem
    // `detalhe` o código 60 não tem como ser filtrado pelo complemento.
    expect(consulta).toContain('dispensadoEm: true');
    expect(consulta).toContain('detalhe: true');
  });
});

/**
 * A TERCEIRA TABELA DE CÓDIGOS TPU, que já tinha divergido.
 *
 * `marcosDoEncerramento` mantinha o seu próprio mapa código→rótulo, e o 196 já
 * se chamava "Extinção da execução" ali contra "Execução extinta" no
 * dicionário. Dois nomes para o mesmo ato em duas telas é como o problema desta
 * área sempre começa.
 */
describe('marcos do encerramento leem o dicionário', () => {
  const marcos = MOVIMENTACOES.slice(
    MOVIMENTACOES.indexOf('private marcosDoEncerramento'),
    MOVIMENTACOES.indexOf('private atencaoRequerida'),
  );

  it('o trecho existe', () => {
    expect(marcos.length).toBeGreaterThan(300);
  });

  it('não redeclara os rótulos de encerramento', () => {
    expect(marcos).toContain('atoCritico(');
    for (const rotulo of ['Baixa definitiva', 'Trânsito em julgado', 'Desarquivamento']) {
      expect(marcos).not.toContain(rotulo);
    }
  });

  it('só os códigos FORA do dicionário ficam declarados aqui', () => {
    // 11384/11385 estão em CODIGOS_IGNORADOS_DE_PROPOSITO: não viram aviso
    // (a fase já os mostra), mas são marcos legítimos da linha do tempo.
    expect(marcos).toContain('11384:');
    expect(marcos).toContain('11385:');
  });
});

/**
 * URGENTE PRECISA SER RARO — E PRECISA DIZER POR QUÊ.
 *
 * Duas medições na produção em 25/08/2026, das SETE tarefas que o robô criou
 * desde que entrou no ar:
 *
 *   · SETE estavam marcadas como urgentes (100%);
 *   · SETE tinham `urgenteMotivo` e `urgentePor` NULOS.
 *
 * A primeira tornava a marca inútil; a segunda a tornava inauditável — e a
 * Agenda recusa exatamente isso quando é uma pessoa que marca ("sem motivo, a
 * marca não pode ser revista depois e a fila de urgências perde o sentido").
 * O robô passava por fora da regra escrevendo os campos direto no banco.
 */
describe('urgência do robô de prazos', () => {
  const criarPrazo = AUTOMACAO.slice(
    AUTOMACAO.indexOf('private async criarPrazo'),
    AUTOMACAO.indexOf('Marca a movimentação como já processada'),
  );

  it('o trecho existe', () => {
    expect(criarPrazo.length).toBeGreaterThan(500);
  });

  it('`urgente = atrasado` não volta — era o que marcava tudo', () => {
    // `atrasado` é verdade para qualquer ato com mais de ~7 dias, porque o
    // prazo de conferência é de 5 dias úteis. Sozinho, dispara em quase tudo.
    expect(criarPrazo).not.toMatch(/urgente:\s*atrasado/);
  });

  it('urgência exige que o ato ainda seja NOTÍCIA', () => {
    expect(criarPrazo).toMatch(/const urgente = atrasado && idadeDoAtoDias <= DIAS_ATO_RECENTE/);
  });

  it('a marca passa por `montarUrgencia`, como a da tela', () => {
    expect(criarPrazo).toContain('montarUrgencia(');
    expect(criarPrazo).toContain("origem: 'AUTOMACAO'");
    // Escrever os quatro campos na mão é justamente o desvio que criou
    // urgências sem motivo — se voltar, volta o problema inteiro.
    expect(criarPrazo).not.toMatch(/urgenteMotivo:\s*(null|`|')/);
    expect(criarPrazo).not.toMatch(/urgentePor:/);
  });

  it('a tarefa não urgente ainda diz que o andamento chegou atrasado', () => {
    // Tirar o alarme não pode virar tirar a informação.
    expect(criarPrazo).toContain('Andamento recebido com atraso');
    expect(criarPrazo).toMatch(/já correu/);
  });
});

/**
 * A JANELA DA AUTOMAÇÃO NÃO PODE ENCOLHER SEM QUE ALGUÉM PERCEBA.
 *
 * Ela é o que impede tarefa nascida de andamento de anos atrás. O acervo tem
 * movimentos de até 3.466 dias; sem a janela, importar um processo antigo
 * despejaria a história inteira na agenda de alguém.
 */
describe('janela de captura da automação', () => {
  const disparar = PROCESSOS.slice(
    PROCESSOS.indexOf('private async dispararAutomacao'),
    PROCESSOS.indexOf('await this.automacao.processar'),
  );

  it('só entra andamento dos últimos 30 dias', () => {
    expect(disparar).toMatch(/const desde = new Date\(Date\.now\(\) - 30 \* 24 \* 3600 \* 1000\)/);
    expect(disparar).toContain('dataMovimento: { gte: desde }');
  });

  it('andamento dispensado por uma pessoa não volta a gerar tarefa', () => {
    expect(disparar).toContain('dispensadoEm: null');
  });

  it('andamento que já virou atividade não gera outra', () => {
    expect(disparar).toContain('compromissoId: null');
  });
});
