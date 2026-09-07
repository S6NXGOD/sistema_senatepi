import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (p: string) => readFileSync(join(__dirname, p), 'utf8');

const PENDENCIAS = ler('../agenda/pendencias.service.ts');
const CORRELACAO = ler('./correlacao.service.ts');
const SYNC = ler('./djen-sync.service.ts');
const SUGESTOES = ler('./sugestoes.service.ts');
const FECHAR = ler('./utils/tarefa-de-cadastro.util.ts');

/**
 * O ALARME QUE GRITAVA 1.243 VEZES SEM MOTIVO.
 *
 * Medido na produção em 07/09/2026: 1.243 publicações classificadas sem tarefa,
 * e as 1.243 eram "notícia velha" — a decisão deliberada do robô de não criar
 * tarefa para um ato anterior ao momento em que passamos a olhar o processo.
 * Nenhuma dos últimos 7 dias; 1.063 com mais de 90.
 *
 * O sino lia só `compromissoId: null` e chamava todas de pendência. Na tela:
 * nove dos doze usuários com a barra VERMELHA em cima de toda página, todo dia,
 * dizendo coisas como "1003 publicações suas sem tarefa aberta". O
 * administrador via zero, e é por isso que o defeito viveu tanto — quem
 * reportaria não via, e quem via achava que era assim mesmo.
 */
describe('o alarme de publicação sem tarefa', () => {
  it('exige que o robô NÃO tenha dispensado a tarefa', () => {
    expect(PENDENCIAS).toContain('tarefaDispensadaEm: null');
  });

  /** Sem o carimbo do outro lado, o filtro acima nunca seria verdadeiro. */
  it('e o robô carimba a dispensa quando decide não criar', () => {
    const trecho = CORRELACAO.slice(
      CORRELACAO.indexOf('if (ehNoticiaVelha('),
      CORRELACAO.indexOf('resumo.antigas++'),
    );
    expect(trecho).toContain('tarefaDispensadaEm: new Date()');
  });

  /**
   * UM ATO, UMA LINHA. O tribunal manda a mesma publicação para cada intimado;
   * medido, 39 linhas recentes eram 23 atos — 41% de inflação num número cuja
   * única função é dimensionar trabalho.
   */
  it('conta atos distintos, não cópias da mesma publicação', () => {
    expect(PENDENCIAS).toContain('const atosSemTarefa = publicacoes.filter(');
    expect(PENDENCIAS).toContain('o.processoId === p.processoId && o.providencia === p.providencia');
    expect(PENDENCIAS).toContain('total: atosSemTarefa.length');
  });
});

/**
 * A AÇÃO NOVA VIRA TAREFA — antes ela morava só no sino e numa lista.
 */
describe('a tarefa de cadastrar a ação do Diário', () => {
  it('só as recentes, na mesma régua de 30 dias do resto do módulo', () => {
    expect(SYNC).toContain('const DIAS_PARA_AGENDAR_CADASTRO = 30;');
    expect(SYNC).toContain('primeiraEm: { gte: corte }');
  });

  /** Tarefa sem dono é tarefa de ninguém: sem advogado citado, fica só na fila. */
  it('exige advogado nosso citado no ato, casado pela OAB', () => {
    expect(SYNC).toContain('const responsavelId = this.primeiroAdvogadoNosso(s.advogados, porOab);');
    expect(SYNC).toContain('if (!responsavelId) {');
    // Pela OAB, nunca pelo nome: o DJEN manda "ICARO" e o cadastro tem "Ícaro".
    expect(SYNC).toContain('const chaveOab = (numero: unknown, uf: unknown)');
    expect(SYNC).toContain('porOab.get(chaveOab(a?.numeroOab, a?.ufOab))');
    // A chave normaliza o número (só dígitos) e a UF — nunca compara nome.
    const fnChave = SYNC.slice(SYNC.indexOf('const chaveOab'), SYNC.indexOf('/** Resumo de uma varredura'));
    expect(fnChave).toContain('toUpperCase()');
    expect(fnChave).not.toContain('nome');
  });

  /** `compromissoId` único no banco; a consulta também só pega os sem tarefa. */
  it('nunca cria a segunda tarefa para a mesma ação', () => {
    expect(SYNC).toContain('compromissoId: null');
    expect(SUGESTOES).not.toContain('compromissoId: { not: null }');
  });

  /**
   * DILIGÊNCIA, NÃO PRAZO. Prazo entraria na contagem de vencimentos
   * processuais e afirmaria que há um relógio do tribunal correndo — o processo
   * nem existe aqui ainda.
   */
  it('é diligência administrativa, e nunca nasce urgente', () => {
    const fn = SYNC.slice(
      SYNC.indexOf('private async agendarCadastroDasRecentes'),
      SYNC.indexOf('private async advogadosPorOab'),
    );
    expect(fn).toContain("tipo: 'DILIGENCIA'");
    expect(fn).not.toContain('urgente: true');
    expect(fn).not.toContain('montarUrgencia');
  });

  /** Nenhuma tarefa nasce vencida — a mesma função dos outros robôs. */
  it('agenda nas nove de Teresina, no próximo dia útil', () => {
    expect(SYNC).toContain('proximoHorarioUtilBR(noveDaManhaBR(new Date()))');
  });

  /** Roda DEPOIS da conferência: ação já baixada não vira tarefa de ninguém. */
  it('corre depois da conferência de processo encerrado', () => {
    expect(SYNC.indexOf('await this.conferirFilaSemVerificacao();'))
      .toBeLessThan(SYNC.indexOf('await this.agendarCadastroDasRecentes();'));
  });
});

/**
 * OS QUATRO CAMINHOS DE SAÍDA DA FILA.
 *
 * A sugestão deixa de ser PENDENTE em quatro lugares. Se um deles esquecer de
 * fechar a tarefa, ela vira cobrança sobre trabalho já feito — que é o jeito
 * mais rápido de a equipe parar de confiar na agenda. Este teste existe para o
 * quinto caminho, o que alguém escrever daqui a três meses.
 */
describe('o fechamento da tarefa quando a ação sai da fila', () => {
  it('os quatro caminhos chamam o mesmo fechamento', () => {
    // 1) reconciliação na leitura, 2) importação em lote, 3) ignorar manual
    const chamadas = (SUGESTOES.match(/fecharTarefaDeCadastro\(/g) ?? []).length;
    expect(chamadas).toBe(3);
    // 4) a conferência no CNJ que descobre o processo já baixado
    expect(SYNC).toContain("fecharTarefaDeCadastro(this.prisma, alvo.id, 'DESCARTADO')");
  });

  it('cadastrada conclui e passa a apontar para o processo; descartada cancela com motivo', () => {
    expect(FECHAR).toContain("status: 'CONCLUIDO'");
    expect(FECHAR).toContain('...(s.processoId ? { processoId: s.processoId } : {})');
    expect(FECHAR).toContain("status: 'CANCELADO'");
    expect(FECHAR).toContain('canceladoMotivo:');
  });

  /** Não reescreve o desfecho de quem concluiu na mão. */
  it('não mexe em tarefa que alguém já fechou', () => {
    expect(FECHAR).toContain("status: { in: ['PENDENTE', 'EM_ANDAMENTO'] }");
  });

  /**
   * REABRIR SOLTA O VÍNCULO. Sem isso a sugestão voltava para PENDENTE
   * apontando para uma tarefa CANCELADA, e como o agendador só olha
   * `compromissoId: null`, a substituta nunca nasceria — fila sem cobrança,
   * em silêncio.
   */
  it('reabrir a sugestão libera uma tarefa nova', () => {
    const fn = SUGESTOES.slice(SUGESTOES.indexOf('async reabrir('));
    expect(fn).toContain('compromissoId: null');
  });
});
