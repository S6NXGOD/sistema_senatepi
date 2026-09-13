import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { CaixaDePropostasService } from './caixa-de-propostas.service';
import { DjenController } from './djen.controller';

/**
 * "PUBLICAÇÕES DECIDIDAS" É DECISÃO DE GENTE — gravada, não deduzida.
 *
 * A conta dos Relatórios era "proposta endereçada à pessoa que virou tarefa".
 * Aceitar não troca o destinatário, então o aceite de um colega creditava quem
 * só recebeu; e a proposta com prazo ignorada por três dias vira tarefa sozinha
 * e também contava. Ignorar a caixa AUMENTAVA o número (auditoria do PDF de uso,
 * 13/09/2026; na produção: 2 aceitas, 1 escalada pelo robô, 0 recusadas).
 *
 * Desde a migração 20260913010200 a decisão é um fato: `tarefaDecididaEm/Por`.
 */
const aberta = () => ({
  id: 'pub-1',
  compromissoId: null,
  tarefaPropostaEm: new Date('2026-09-10T12:00:00Z'),
  tarefaDispensadaEm: null,
});

function caixaCom(proposta: Record<string, unknown> | null) {
  const prisma = {
    comunicacaoDjen: {
      findUnique: jest.fn(async () => proposta),
      update: jest.fn(async (..._args: unknown[]) => ({})),
      findMany: jest.fn(async () => [] as unknown[]),
    },
  };
  const correlacao = { criarAtividadeDaProposta: jest.fn(async (..._args: unknown[]) => 'comp-1') };
  const caixa = new CaixaDePropostasService(prisma as never, correlacao as never);
  const dados = (i = 0) => (prisma.comunicacaoDjen.update.mock.calls[i][0] as { data: Record<string, unknown> }).data;
  return { caixa, prisma, correlacao, dados };
}

describe('aceitar e recusar gravam quem decidiu', () => {
  it('aceitar: a tarefa vai para quem aceitou, e a decisão também', async () => {
    const { caixa, correlacao, dados } = caixaCom(aberta());
    await expect(caixa.aceitar('pub-1', 'u-murilo')).resolves.toEqual({ compromissoId: 'comp-1' });
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledWith('pub-1', 'u-murilo');
    expect(dados()).toEqual({
      compromissoId: 'comp-1',
      tarefaDecididaEm: expect.any(Date),
      tarefaDecididaPor: 'u-murilo',
    });
  });

  /**
   * O CASO DO BUG: a proposta era da Morgana e o Murilo aceitou. O crédito é do
   * Murilo — o destinatário (`tarefaPropostaPara`) nem é lido ou reescrito aqui.
   */
  it('o aceite de um colega credita o colega, e não o destinatário', async () => {
    const { caixa, dados } = caixaCom({ ...aberta(), tarefaPropostaPara: 'u-morgana' });
    await caixa.aceitar('pub-1', 'u-murilo');
    expect(dados().tarefaDecididaPor).toBe('u-murilo');
    expect(dados()).not.toHaveProperty('tarefaPropostaPara');
  });

  it('recusar: dispensa e decisão no mesmo instante, com quem recusou', async () => {
    const { caixa, dados } = caixaCom(aberta());
    await caixa.recusar('pub-1', 'u-ana', '  já cumprido  ');
    const d = dados();
    expect(d).toMatchObject({
      tarefaDispensadaMotivo: 'RECUSADA_PELO_ADVOGADO',
      tarefaPropostaPara: 'u-ana',
      motivoDaRecusa: 'já cumprido',
      tarefaDecididaPor: 'u-ana',
    });
    expect(d.tarefaDecididaEm).toBeInstanceOf(Date);
    expect(d.tarefaDecididaEm).toBe(d.tarefaDispensadaEm);
  });

  it('proposta já decidida não é decidida de novo', async () => {
    const { caixa, prisma, correlacao } = caixaCom({ ...aberta(), tarefaDispensadaEm: new Date() });
    await expect(caixa.aceitar('pub-1', 'u-murilo')).rejects.toBeInstanceOf(BadRequestException);
    expect(correlacao.criarAtividadeDaProposta).not.toHaveBeenCalled();
    expect(prisma.comunicacaoDjen.update).not.toHaveBeenCalled();
  });
});

describe('o que o robô faz sozinho NÃO é decisão', () => {
  /** A rede cria a tarefa, mas ninguém decidiu: nada de `tarefaDecidida*`. */
  it('escalarEsquecidas liga a tarefa e não carimba decisão', async () => {
    const { caixa, prisma, correlacao, dados } = caixaCom(null);
    prisma.comunicacaoDjen.findMany.mockResolvedValueOnce([
      { id: 'pub-2', tarefaPropostaPara: 'u-morgana', numeroProcesso: '0000814-61.2026.5.22.0002' },
    ]);
    await expect(caixa.escalarEsquecidas()).resolves.toBe(1);
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledWith('pub-2', 'u-morgana', true);
    expect(dados()).toEqual({ compromissoId: 'comp-1' });
  });

  /**
   * A varredura e a correlação não escrevem as colunas. Negativa sobre CÓDIGO,
   * sem comentários — um comentário que explique a regra não pode reprová-la.
   */
  it('a varredura, a correlação e os crons não escrevem tarefaDecidida', () => {
    const codigo = (arquivo: string) =>
      readFileSync(join(__dirname, arquivo), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const arquivo of [
      'djen-sync.service.ts',
      'correlacao.service.ts',
      'djen-cron.service.ts',
      'processos-cron.service.ts',
    ]) {
      expect(`${arquivo}: ${/tarefaDecidida/.test(codigo(arquivo))}`).toBe(`${arquivo}: false`);
    }
  });
});

/**
 * "CRIAR TAREFA" NA GAVETA DA PUBLICAÇÃO — o irmão que ninguém tinha olhado.
 *
 * A rota criava a atividade e NÃO a ligava à publicação: a checagem de
 * idempotência nunca via a tarefa (dois toques = duas tarefas) e a publicação
 * seguia "sem tarefa". E quando a publicação era proposta aberta, clicar aqui
 * a tirava da caixa sem registrar a decisão.
 */
describe('a tarefa criada pela gaveta da publicação', () => {
  const usuario = { id: 'u-ana', role: 'ADVOGADO' } as never;

  const montar = (publicacao: Record<string, unknown>) => {
    const estado = {
      processoId: 'proc-1',
      providencia: 'MANIFESTACAO',
      tarefaPropostaEm: null,
      tarefaDispensadaEm: null,
      compromisso: null as { id: string; status: string } | null,
      ...publicacao,
      id: 'pub-1',
    };
    const prisma = {
      comunicacaoDjen: {
        findUnique: jest.fn(async () => ({ ...estado })),
        update: jest.fn(async (args: { data: { compromissoId?: string } }) => {
          if (args.data.compromissoId) estado.compromisso = { id: args.data.compromissoId, status: 'PENDENTE' };
          return {};
        }),
      },
    };
    const correlacao = { criarAtividadeDaProposta: jest.fn(async (..._args: unknown[]) => 'comp-9') };
    const ctrl = new DjenController(prisma as never, {} as never, {} as never, {} as never, {} as never, correlacao as never);
    const dados = () => (prisma.comunicacaoDjen.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    return { ctrl, prisma, correlacao, dados };
  };

  it('liga a tarefa à publicação — o segundo toque devolve a mesma', async () => {
    const { ctrl, correlacao } = montar({});
    await expect(ctrl.tarefaDaPublicacao('pub-1', usuario)).resolves.toEqual({ compromissoId: 'comp-9', criada: true });
    await expect(ctrl.tarefaDaPublicacao('pub-1', usuario)).resolves.toEqual({ compromissoId: 'comp-9', criada: false });
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledTimes(1);
  });

  it('publicação que não era proposta: só a ligação, sem decisão', async () => {
    const { ctrl, dados } = montar({});
    await ctrl.tarefaDaPublicacao('pub-1', usuario);
    expect(dados()).toEqual({ compromissoId: 'comp-9' });
  });

  /** A tarefa continua indo para o dono do caso; a decisão é de quem clicou. */
  it('proposta aberta: a tarefa vai para o dono do caso e a decisão fica com quem clicou', async () => {
    const { ctrl, correlacao, dados } = montar({ tarefaPropostaEm: new Date('2026-09-11T08:00:00Z') });
    await ctrl.tarefaDaPublicacao('pub-1', usuario);
    expect(correlacao.criarAtividadeDaProposta).toHaveBeenCalledWith('pub-1', null);
    expect(dados()).toEqual({
      compromissoId: 'comp-9',
      tarefaDecididaEm: expect.any(Date),
      tarefaDecididaPor: 'u-ana',
    });
  });

  /** Recusada antes e reaberta pela gaveta: a decisão registrada é a da recusa. */
  it('proposta já recusada não ganha segunda decisão', async () => {
    const { ctrl, dados } = montar({ tarefaPropostaEm: new Date(), tarefaDispensadaEm: new Date() });
    await ctrl.tarefaDaPublicacao('pub-1', usuario);
    expect(dados()).toEqual({ compromissoId: 'comp-9' });
  });

  it('com tarefa aberta, devolve a que existe sem criar nem gravar nada', async () => {
    const { ctrl, prisma, correlacao } = montar({ compromisso: { id: 'comp-antiga', status: 'EM_ANDAMENTO' } });
    await expect(ctrl.tarefaDaPublicacao('pub-1', usuario)).resolves.toEqual({ compromissoId: 'comp-antiga', criada: false });
    expect(correlacao.criarAtividadeDaProposta).not.toHaveBeenCalled();
    expect(prisma.comunicacaoDjen.update).not.toHaveBeenCalled();
  });

  /** A anterior foi concluída: nova tarefa, ligada; não é decisão sobre proposta. */
  it('com a tarefa anterior concluída, cria outra e liga, sem carimbar decisão', async () => {
    const { ctrl, dados } = montar({
      tarefaPropostaEm: new Date(),
      compromisso: { id: 'comp-antiga', status: 'CONCLUIDO' },
    });
    await expect(ctrl.tarefaDaPublicacao('pub-1', usuario)).resolves.toEqual({ compromissoId: 'comp-9', criada: true });
    expect(dados()).toEqual({ compromissoId: 'comp-9' });
  });
});
