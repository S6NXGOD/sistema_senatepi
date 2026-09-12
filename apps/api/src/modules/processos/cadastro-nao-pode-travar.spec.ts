import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SERVICO = readFileSync(join(__dirname, 'processos.service.ts'), 'utf8');
const DATAJUD = readFileSync(join(__dirname, 'datajud.service.ts'), 'utf8');
const PREVIA = readFileSync(join(__dirname, 'consulta-previa.service.ts'), 'utf8');
const AUTOMACAO = readFileSync(join(__dirname, 'automacao-prazos.service.ts'), 'utf8');

/**
 * "FICOU EM UM LOOP INFINITO" — o relato, e o que estava por trás dele.
 *
 * Nada travava de verdade: a fila de cota do CNJ atendia o robô primeiro. O
 * backfill de instâncias dispara a cada abertura da lista de Processos, e a
 * consulta do formulário de cadastro entrava atrás dele. Medido na produção em
 * 11/09/2026: 36s, 38s, 45s por consulta, 14 respostas 429 em 24h e uma média
 * de 35s nas chamadas da madrugada.
 *
 * E a fila do backfill não esvaziava porque a IMPORTAÇÃO não carimbava
 * `instanciasLidasEm` — cada processo cadastrado nascia devendo ao CNJ a
 * releitura do que tinha acabado de ser lido.
 */
describe('o cadastro de processo não pode esperar atrás do robô', () => {
  it('a importação carimba o que acabou de ler', () => {
    const fn = SERVICO.slice(SERVICO.indexOf('async importar('), SERVICO.indexOf('async listar('));
    expect(fn).toContain('instanciasLidasEm: new Date()');
    // Sob a mesma flag do resto: sem o parser multi-instância, ninguém "leu" nada.
    expect(fn).toContain('this.datajud.multiInstanciaAtiva ? { instanciasLidasEm');
  });

  it('a consulta do formulário e o botão da ficha vão na faixa de gente', () => {
    expect(PREVIA).toContain("buscarProcessoPorNPU(numero, sigla, 'PESSOA')");
    expect(SERVICO).toContain("buscarInstanciasPorNPU(numero, sigla, 'PESSOA')");
    // O mesmo método serve ao robô e ao clique; quem decide é a origem.
    expect(SERVICO).toContain("origem === OrigemSincronizacao.CRON ? 'ROBO' : 'PESSOA'");
  });

  it('e o 429 para a fila inteira em vez de queimá-la em erros', () => {
    expect(DATAJUD).toContain('if (res.status === 429) this.cota.penalizar();');
  });
});

/**
 * O ÍNDICE DO CNJ ATRASA — E O SISTEMA SE CONTRADIZIA POR CAUSA DISSO.
 *
 * A tela avisava "4 ações do sindicato apareceram no Diário e ainda não estão
 * cadastradas aqui" e o cadastro recusava com "não localizado no DATAJUD". O
 * 0000895-95.2026.5.22.0103 (TRT22, distribuído em 2026) acumulou SEIS recusas
 * em quatro dias enquanto o Diário já tinha 12 publicações dele.
 */
describe('processo que o Diário conhece e o CNJ ainda não', () => {
  it('a recusa explica a saída em vez de ser um beco', () => {
    expect(SERVICO).toContain('dá para cadastrar assim mesmo');
    expect(SERVICO).toContain('if (!dto.mesmoSemDatajud)');
  });

  it('o cadastro sem DataJud não inventa dado nenhum', () => {
    const fn = SERVICO.slice(
      SERVICO.indexOf('private async importarSemDatajud('),
      SERVICO.indexOf('async ressincronizarSilencioso('),
    );
    expect(fn).toContain('classeProcessual: dto.classeProcessual?.trim() || null');
    expect(fn).toContain('orgaoJulgador: dto.orgaoJulgador?.trim() || null');
    // Sem instância eleita e sem movimentação forjada.
    expect(fn).not.toContain('instancias.sincronizar');
    expect(fn).not.toContain('dataDistribuicao');
    // `ultimaSincronizacao` fica nula: é a chave de ordenação da varredura, e
    // é o que põe este processo na frente da fila todo dia até o CNJ publicar.
    expect(fn).not.toContain('ultimaSincronizacao');
  });

  it('a auditoria registra que entrou sem o CNJ', () => {
    expect(SERVICO).toContain('semIndiceNoCnj: true');
  });

  /*
    A metade da TELA é conferida no pacote do web (`nada-gira-para-sempre`).
    Ela não pode ser afirmada daqui: a API sobe numa fase ANTES do web, e um
    teste que exige o arquivo do outro lado reprovaria o commit intermediário —
    justamente o que a ordem de deploy existe para proteger.
  */
});

/**
 * A AUDIÊNCIA CHEGAVA NO DIA DELA.
 *
 * O robô marcava a pauta na data do juiz — correto — e o único aviso prévio era
 * "Avisar filiado", que só nasce com secretaria E filiado vinculados. Filiado
 * vinculado é raro (4 processos em 127) e ação institucional não tem nenhum: na
 * prática, quase nenhuma pauta gerava aviso.
 */
describe('preparo antes da pauta', () => {
  /** Só o corpo do método — sem isto o `slice` varre o resto do arquivo. */
  const preparo = () => {
    const i = AUTOMACAO.indexOf('private async criarPreparoDaPauta(');
    expect(i).toBeGreaterThan(-1);
    return AUTOMACAO.slice(i, AUTOMACAO.indexOf('private async pautaDoDia(', i));
  };

  it('nasce dois dias úteis antes, para quem vai atuar', () => {
    expect(AUTOMACAO).toContain('const DIAS_UTEIS_DE_PREPARO = 2;');
    expect(AUTOMACAO).toContain('-DIAS_UTEIS_DE_PREPARO');
    expect(AUTOMACAO).toContain('responsavelId,');
  });

  it('não depende de haver filiado — é tarefa de quem atua, não telefonema', () => {
    expect(preparo()).not.toContain('secretariaId');
  });

  it('nunca nasce vencida nem depois da própria pauta', () => {
    expect(AUTOMACAO).toContain('if (quando <= new Date() || quando >= inicioDaPauta) return false;');
  });

  it('e não mexe na data da audiência — o juiz é que marca', () => {
    expect(preparo()).toContain('inicio: quando');
    // Cria; nunca reescreve a pauta.
    expect(preparo()).not.toContain('compromisso.update');
  });
});

/**
 * "O ROBÔ NÃO ESTÁ CRIANDO ATIVIDADE SÓ NO DIA LIMITE?" — a pergunta era certa.
 *
 * Medido nas 39 atividades automáticas da produção: das 29 do tipo PRAZO, 16
 * nasceram para o MESMO dia em que foram criadas. Parte disso é inevitável (o
 * andamento chega atrasado e não há como conferir no passado), mas a outra
 * parte era desenho: a tarefa de conferir vinha no ÚLTIMO dia da janela.
 */
describe('a conferência de prazo chega com margem', () => {
  it('a janela é menor que o prazo processual mais curto', () => {
    expect(AUTOMACAO).toContain('const PRAZO_PADRAO_DIAS_UTEIS = 3;');
  });

  it('e continua sem nascer vencida quando o andamento chega tarde', () => {
    expect(AUTOMACAO).toContain('const atrasado = calculado < hoje;');
    expect(AUTOMACAO).toContain('proximoHorarioUtilBR(atrasado ? hoje : calculado)');
  });
});
