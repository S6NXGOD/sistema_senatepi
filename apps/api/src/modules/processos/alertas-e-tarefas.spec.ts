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
 * "CONFIRMAR DATA DA AUDIÊNCIA" NÃO PODE NASCER GRITANDO.
 *
 * Ela nascia com `urgente: true` fixo, e o raciocínio isolado estava certo:
 * audiência sem data é risco de perder sessão. O que ele ignorava é a
 * FREQUÊNCIA — audiência sem data publicada é o caso NORMAL na Justiça do
 * Trabalho (está escrito no próprio arquivo), e 22 dos 41 processos da produção
 * correm no TRT22 ou no TST. Quase toda pauta do acervo viraria uma urgência, e
 * vinte urgências simultâneas não são vinte prioridades: são zero.
 *
 * A saída não foi desligar o aviso — foi escalonar. A varredura reencontra a
 * movimentação toda noite (ela nunca é carimbada, de propósito), e é isso que
 * permite medir o TEMPO CEGO: recém-designada, a sessão está a semanas; quinze
 * dias depois sem ninguém abrir o PJe, pode ser semana que vem.
 */
describe('tarefa de confirmar data da audiência', () => {
  const metodo = AUTOMACAO.slice(
    AUTOMACAO.indexOf('private async criarConfirmacaoDeData'),
    AUTOMACAO.indexOf('Pauta com data conhecida'),
  );

  it('o trecho existe', () => {
    expect(metodo.length).toBeGreaterThan(500);
  });

  it('NÃO nasce urgente', () => {
    // `select: { ..., urgente: true }` PEDE o campo ao banco; não é atribuição.
    // Filtrar por linha é o que separa os dois casos.
    const atribuicoes = metodo
      .split('\n')
      .filter((l) => /urgente: true/.test(l) && !/select:/.test(l));
    expect(atribuicoes).toEqual([]);
    expect(metodo).toContain("montarUrgencia(false, null, { origem: 'AUTOMACAO' })");
  });

  it('escala quando o tempo cego passa do prazo recursal', () => {
    expect(metodo).toMatch(/diasCegos > DIAS_ATO_RECENTE/);
    // Escala UMA vez: sem o `!existente.urgente`, a varredura reescreveria a
    // marca e o carimbo de urgência toda noite, apagando quando ela começou.
    expect(metodo).toMatch(/!existente\.urgente && diasCegos > DIAS_ATO_RECENTE/);
  });

  it('a escalada também explica o porquê', () => {
    expect(metodo).toContain('montarUrgencia(');
    expect(metodo).toMatch(/a data continua desconhecida/);
  });
});

/**
 * TAREFA CUJO TRABALHO JÁ FOI FEITO TEM DE FECHAR SOZINHA.
 *
 * "Confirmar data da audiência designada" e o radar de audiências cobrem o
 * MESMO trabalho em duas telas — de propósito: o robô cria a tarefa para quem
 * vive na Agenda, o radar atende quem vive em Processos. Faltava o fecho:
 * agendar pelo radar criava o compromisso da audiência, carimbava a
 * movimentação e deixava a tarefa aberta cobrando para sempre.
 *
 * Com a escalada por tempo cego isso ficaria pior — a tarefa de um trabalho já
 * concluído passaria a URGENTE quinze dias depois. Um lembrete que cobra o que
 * já foi feito é a forma mais rápida de ensinar a equipe a ignorar lembretes.
 */
describe('o radar fecha o lembrete que ele resolve', () => {
  const AUDIENCIAS = ler('audiencias.service.ts');

  it('`agendar` encerra a tarefa de confirmar data', () => {
    const agendar = AUDIENCIAS.slice(
      AUDIENCIAS.indexOf('async agendar('),
      AUDIENCIAS.indexOf('return compromisso;'),
    );
    expect(agendar.length).toBeGreaterThan(300); // o teste não olha para o vazio
    expect(agendar).toContain('this.automacao.fecharConfirmacaoDeData(');
  });

  it('quem sabe a identidade da tarefa é quem a cria', () => {
    // O título e o tipo moram só em `automacao-prazos`. Se o serviço de
    // audiências passasse a conhecê-los, seriam dois lugares para manter em dia
    // — e nesta base o defeito sempre nasceu assim.
    //
    // O comentário que EXPLICA a divisão cita o título, e deve mesmo citar:
    // documentar não é acoplar. Só o código conta.
    const ehComentario = (l: string) => /^\s*(\*|\/\/|\/\*)/.test(l);
    const usos = AUDIENCIAS
      .split('\n')
      .filter((l) => /Confirmar data da audiência/.test(l) && !ehComentario(l));
    expect(usos).toEqual([]);
    expect(AUTOMACAO).toContain('async fecharConfirmacaoDeData(');
  });

  it('ao fechar, a urgência sai junto', () => {
    const metodo = AUTOMACAO.slice(
      AUTOMACAO.indexOf('async fecharConfirmacaoDeData('),
      AUTOMACAO.indexOf('Tarefa "descobrir quando é a audiência"'),
    );
    expect(metodo).toContain('StatusCompromisso.CONCLUIDO');
    // Urgência pendurada numa atividade concluída sujaria todo relatório de
    // urgências — `montarUrgencia(false, …)` limpa os quatro campos.
    expect(metodo).toContain("montarUrgencia(false, null, { origem: 'AUTOMACAO' })");
  });
});

/**
 * NENHUMA MARCA DE URGÊNCIA ESCRITA À MÃO, em lugar nenhum do robô.
 *
 * A Agenda exige motivo de quem marca ("sem motivo, a marca não pode ser
 * revista depois e a fila de urgências perde o sentido"). Escrever os campos
 * direto no banco burla a regra — e foi o que produziu, na produção, sete
 * tarefas urgentes com `urgenteMotivo` e `urgentePor` nulos.
 */
describe('o robô nunca escreve urgência à mão', () => {
  /**
   * VALE PARA TODO ARQUIVO QUE CRIA ATIVIDADE SOZINHO.
   *
   * A primeira versão deste teste lia só `automacao-prazos.service.ts`, e por
   * isso não viu o TERCEIRO caso do mesmo desvio: `correlacao.service.ts`
   * escrevia `urgente: atrasado || prazo <= 5` direto no banco. Um teste que
   * cobre um arquivo dá a sensação de que a regra está garantida em todos —
   * pior do que não existir, porque desliga a desconfiança.
   */
  /**
   * `audiencias.service.ts` fica de FORA desta lista, e por um bom motivo: ele
   * não escreve no banco — chama `AgendaService.criar`, que já passa por
   * `montarUrgencia`. O campo `urgente` que ele repassava foi REMOVIDO do DTO
   * (garantia de 400: exigia motivo que o formulário não tem), e a cobertura
   * dele está no teste de remoção, logo abaixo.
   */
  const ROBOS = [
    ['automacao-prazos.service.ts', AUTOMACAO],
    ['correlacao.service.ts', ler('correlacao.service.ts')],
  ] as const;

  const ehComentarioLinha = (l: string) => /^\s*(\*|\/\/|\/\*)/.test(l);

  /**
   * `urgente: true` dentro de um `select` é LEITURA, não escrita — e um select
   * pode ocupar várias linhas, o que fazia o filtro por linha acusar inocente.
   * Aqui o bloco inteiro sai do texto antes da varredura.
   */
  function semSelects(fonte: string): string {
    let saida = '';
    let i = 0;
    for (;;) {
      const inicio = fonte.indexOf('select: {', i);
      if (inicio === -1) return saida + fonte.slice(i);
      saida += fonte.slice(i, inicio);
      let nivel = 0;
      let j = inicio + 'select: '.length;
      for (; j < fonte.length; j++) {
        if (fonte[j] === '{') nivel++;
        else if (fonte[j] === '}' && --nivel === 0) break;
      }
      i = j + 1;
    }
  }

  it.each(ROBOS)('%s marca urgência só via `montarUrgencia`', (_arquivo, fonte) => {
    const atribuicoes = semSelects(fonte)
      .split('\n')
      .filter((l) => /urgente:\s*(true|[a-z])/.test(l) && !ehComentarioLinha(l));
    expect(atribuicoes).toEqual([]);
  });

  it.each(ROBOS)('%s não escreve os campos de urgência à mão', (_arquivo, fonte) => {
    expect(fonte).not.toMatch(/^\s+urgenteMotivo:/m);
    expect(fonte).not.toMatch(/^\s+urgentePor:/m);
    expect(fonte).not.toMatch(/^\s+urgenteEm:/m);
  });

  /**
   * AGENDAR AUDIÊNCIA MARCA URGÊNCIA **COM** MOTIVO — e este teste existe
   * porque eu errei duas vezes, sendo a segunda pior que a primeira.
   *
   * 1ª: o DTO tinha `urgente` e não tinha motivo. `AgendaService.criar` exige
   *     um de quem marca, então `urgente: true` dava 400 falando de um campo
   *     que o formulário não pedia.
   * 2ª: eu REMOVI o campo, afirmando que ninguém o enviava — tinha conferido
   *     `audiencias-agendar-panel.tsx` em vez de `agendar-audiencia-modal.tsx`,
   *     que envia SEMPRE, inclusive `false`. Com `forbidNonWhitelisted` ligado,
   *     isso derrubou o agendamento inteiro do radar, e não só o caso urgente.
   *
   * A regra travada aqui é a que estava certa desde o início: os dois campos
   * andam JUNTOS. Um sem o outro quebra de um jeito ou de outro.
   */
  it('agendar audiência marca urgência com motivo, nunca sem', () => {
    const dto = ler('dto/audiencias.dto.ts');
    expect(dto).toMatch(/^\s+urgente\?: boolean;/m);
    expect(dto).toMatch(/^\s+urgenteMotivo\?: string;/m);

    const service = ler('audiencias.service.ts');
    expect(service).toMatch(/urgente: dto\.urgente/);
    expect(service).toMatch(/urgenteMotivo: dto\.urgenteMotivo/);
  });

  /**
   * O QUE A TELA MANDA, O DTO TEM DE ACEITAR.
   *
   * `forbidNonWhitelisted: true` transforma qualquer campo a mais num 400 — e
   * foi exatamente assim que remover `urgente` do DTO quebrou um modal que
   * ninguém tinha tocado. Este teste lê a TELA e cobra o DTO.
   */
  it('todo campo que o modal envia existe no DTO', () => {
    const modal = readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'web', 'src', 'components', 'processos', 'agendar-audiencia-modal.tsx'),
      'utf8',
    );
    const chamada = modal.slice(modal.indexOf('agendarAudiencia(alerta!.id, {'));
    const enviados = [...chamada.slice(0, chamada.indexOf('});')).matchAll(/^\s+(\w+)[,:]/gm)].map((m) => m[1]);
    expect(enviados.length).toBeGreaterThan(3); // o teste não olha para o vazio

    const dto = ler('dto/audiencias.dto.ts');
    for (const campo of enviados) {
      expect(dto).toMatch(new RegExp(`\\b${campo}\\??:`));
    }
  });

  /**
   * A SENTINELA DO TÍTULO É UMA CONSTANTE, não dois literais.
   *
   * `correlacao.service.ts` compara o título com a string exata para saber que
   * ele ainda é genérico e pode virar algo específico quando a publicação
   * chega. Enquanto foram dois literais em arquivos diferentes, renomear um
   * deles desligaria a promoção EM SILÊNCIO: nada quebra, o título apenas para
   * de melhorar, e ninguém descobre.
   */
  it('o título genérico é uma constante compartilhada', () => {
    const literal = /'Verificação de Intimação \/ Prazo'/g;
    expect((AUTOMACAO.match(literal) ?? []).length).toBe(1); // só a definição
    expect(AUTOMACAO).toContain('export const TITULO_PRAZO_GENERICO');

    const correlacao = ler('correlacao.service.ts');
    expect(correlacao).toContain('TITULO_PRAZO_GENERICO');
    expect(correlacao).not.toMatch(literal);
  });

  it('não há `urgente: true` fora de um `select`', () => {
    // A única ocorrência aceitável é `select: { ..., urgente: true }`, que PEDE
    // o campo ao banco em vez de definir valor. Qualquer outra é uma marca
    // escrita à mão, contornando a regra da Agenda.
    // Comentários também citam `urgente: true` — os que EXPLICAM o defeito
    // antigo. Documentar o erro não pode fazer o teste do erro falhar.
    const ehComentario = (l: string) => /^\s*(\*|\/\/|\/\*)/.test(l);
    const atribuicoes = AUTOMACAO
      .split('\n')
      .filter((l) => /urgente: true/.test(l) && !/select:/.test(l) && !ehComentario(l));
    expect(atribuicoes).toEqual([]);
  });

  it('não escreve `urgenteMotivo`/`urgentePor` diretamente', () => {
    expect(AUTOMACAO).not.toMatch(/^\s+urgenteMotivo:/m);
    expect(AUTOMACAO).not.toMatch(/^\s+urgentePor:/m);
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
