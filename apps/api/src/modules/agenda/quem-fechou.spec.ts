import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AGENDA = readFileSync(join(__dirname, 'agenda.service.ts'), 'utf8');
const FECHAR = readFileSync(
  join(__dirname, '../processos/utils/tarefa-de-cadastro.util.ts'),
  'utf8',
);
const SUGESTOES = readFileSync(join(__dirname, '../processos/sugestoes.service.ts'), 'utf8');
const CONTROLLER = readFileSync(join(__dirname, '../processos/processos.controller.ts'), 'utf8');

/**
 * "PEÇA PROTOCOLADA ÀS 16:52" — POR QUEM?
 *
 * `concluido_por` e `cancelado_por` guardavam o id do usuário desde sempre, mas
 * sem chave estrangeira a API não trazia o nome, e a gaveta mostrava o desfecho
 * sem autor. Num histórico jurídico isso é registro pela metade: dá para saber
 * O QUE foi feito e não POR QUEM.
 *
 * Conferido antes de criar as FKs: ZERO ids órfãos nas 44 linhas com valor.
 */
describe('quem fechou a atividade', () => {
  it('a agenda traz o autor da conclusão e do cancelamento', () => {
    expect(AGENDA).toContain('concluidoPorUsuario: { select:');
    expect(AGENDA).toContain('canceladoPorUsuario: { select:');
  });

  /**
   * `avatarKey` junto: o interceptor global só resolve a foto de quem carrega a
   * chave. Selecionar só a URL devolve rosto vazio — erro que este módulo já
   * cometeu antes, com os advogados da fila do Diário.
   */
  it('e traz a chave do avatar, não só a URL', () => {
    const trecho = AGENDA.slice(AGENDA.indexOf('concluidoPorUsuario: { select:'));
    expect(trecho.slice(0, 200)).toContain('avatarKey: true');
  });
});

/**
 * A TAREFA "CADASTRAR AÇÃO" FECHAVA SEM AUTOR E SEM DESFECHO.
 *
 * O comentário dizia "o robô concluiu; não há autor humano a quem creditar" —
 * e estava errado. O robô só PERCEBEU; quem cadastrou o processo foi uma
 * pessoa autenticada, cujo id o sistema tinha na mão e jogava fora. Na tela a
 * atividade aparecia como "Desfecho não informado", com cara de trabalho
 * abandonado.
 */
describe('a tarefa de cadastro credita quem cadastrou', () => {
  it('aceita o autor e o grava', () => {
    expect(FECHAR).toContain('porUsuarioId?: string | null');
    expect(FECHAR).toContain('concluidoPor: porUsuarioId ?? null');
    expect(FECHAR).toContain('canceladoPor: porUsuarioId ?? null');
  });

  /** Sem desfecho a tela diz "não informado" numa tarefa que terminou certo. */
  it('registra o desfecho em vez de deixar vazio', () => {
    expect(FECHAR).toContain("desfecho: 'DILIGENCIA_CUMPRIDA'");
    expect(FECHAR).toContain('desfechoObs: MOTIVO.CADASTRADO');
  });

  it('o lote e o "ignorar" repassam quem clicou', () => {
    expect(SUGESTOES).toContain("fecharTarefaDeCadastro(this.prisma, s.id, 'CADASTRADO', usuarioId)");
    expect(SUGESTOES).toContain("fecharTarefaDeCadastro(this.prisma, id, 'DESCARTADO', usuarioId)");
    expect(CONTROLLER).toContain('this.sugestoes.importarEmLote(');
  });

  /**
   * MAS OS CAMINHOS AUTOMÁTICOS CONTINUAM SEM AUTOR — e é o certo. A
   * reconciliação na leitura e a conferência no CNJ não têm pessoa por trás;
   * inventar uma seria pior que não ter. A tela diz "concluída pelo sistema".
   */
  it('e o que é do robô continua sem autor', () => {
    expect(SUGESTOES).toContain("fecharTarefaDeCadastro(this.prisma, s.id, 'CADASTRADO');");
  });
});
