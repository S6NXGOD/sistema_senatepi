import { StatusCompromisso } from '@prisma/client';
import { AgendaService } from './agenda.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "RESPONSÁVEL ALTERADO." — DE QUEM PARA QUEM? (14/09/2026)
 *
 * A troca de plantão passa a escrever "Passou da Dra. Shérad para o Dr. Murilo"
 * na linha do tempo da consulta. A edição à mão da mesma atividade escrevia só
 * "Responsável alterado.", sem nome — o irmão que ficou para trás. Aqui o
 * serviço roda com banco falso e o teste lê a linha que chegou ao histórico.
 */

const PESSOAS = [
  { id: 'u-sherad', nome: 'Shérad Maria Alves', nomeExibicao: 'Dra. Shérad' },
  { id: 'u-murilo', nome: 'Murilo Sousa Lima', nomeExibicao: null },
];

function montar(pessoas = PESSOAS) {
  const historico: any[] = [];
  const linha = {
    id: 'c1',
    titulo: 'Consulta Jurídica — Maria da Silva',
    tipo: 'CONSULTA_JURIDICA',
    status: StatusCompromisso.PENDENTE,
    inicio: new Date('2026-09-15T12:00:00.000Z'),
    fim: new Date('2026-09-15T13:00:00.000Z'),
    responsavelId: 'u-sherad',
    processoId: null,
    filiadoId: null,
    atendimentoId: null,
    urgente: false,
    urgenteMotivo: null,
    urgenteEm: null,
    urgentePor: null,
    dataOriginal: null,
    remarcacoes: 0,
    iniciadoEm: null,
    local: 'SENATEPI',
    linkReuniao: null,
    descricao: null,
  };
  const respostas: Record<string, (args: any) => unknown> = {
    'compromisso.findUnique': () => linha,
    'compromisso.update': (args) => ({ ...linha, ...args.data }),
    'compromisso.findUniqueOrThrow': () => linha,
    'user.findUnique': (args) => pessoas.find((p) => p.id === args.where.id) ?? null,
    'user.findMany': (args) => pessoas.filter((p) => args.where.id.in.includes(p.id)),
    'compromissoResponsavel.findMany': () => [{ usuarioId: 'u-sherad' }],
    'compromissoResponsavel.findFirst': () => ({ usuarioId: 'u-murilo' }),
    'compromissoResponsavel.deleteMany': () => ({ count: 1 }),
    'compromissoResponsavel.updateMany': () => ({ count: 0 }),
    'compromissoResponsavel.upsert': () => ({}),
    'compromissoHistorico.create': (args) => {
      historico.push(args.data);
      return {};
    },
  };
  const prisma: any = new Proxy(
    {},
    {
      get(_a, modelo) {
        if (typeof modelo !== 'string' || modelo === 'then') return undefined;
        if (modelo === '$transaction') return async (cb: (tx: unknown) => unknown) => cb(prisma);
        return new Proxy(
          {},
          {
            get: (_m, metodo) => async (args: any) => {
              const chave = `${modelo}.${String(metodo)}`;
              const r = respostas[chave];
              if (!r) throw new Error(`O banco falso não responde ${chave}.`);
              return r(args);
            },
          },
        );
      },
    },
  );
  const servico = new AgendaService(
    prisma as never,
    { registrar: jest.fn(async () => ({})) } as never,
    { garantirSlugValido: jest.fn(async () => undefined) } as never,
  );
  return { servico, historico };
}

const ctx = { userId: 'u-coord', nome: 'Coordenação' };

describe('a troca de responsável pela edição nomeia quem saiu e quem entrou', () => {
  it('com os dois nomes (o de exibição, ou o do cadastro quando não há)', async () => {
    const m = montar();
    await m.servico.atualizar('c1', { responsavelId: 'u-murilo' } as never, ctx);
    const troca = m.historico.find((h) => h.metadata?.para === 'u-murilo');
    expect(troca).toEqual({
      compromissoId: 'c1',
      acao: 'EDITADO',
      descricao: 'Responsável alterado: passou de Dra. Shérad para Murilo Sousa Lima.',
      autorId: 'u-coord',
      autorNome: 'Coordenação',
      metadata: { de: 'u-sherad', para: 'u-murilo', deNome: 'Dra. Shérad', paraNome: 'Murilo Sousa Lima' },
    });
  });

  it('sem o nome de quem saiu (conta apagada): a frase de antes, sem inventar ninguém', async () => {
    const m = montar([PESSOAS[1]]);
    await m.servico.atualizar('c1', { responsavelId: 'u-murilo' } as never, ctx);
    const troca = m.historico.find((h) => h.metadata?.para === 'u-murilo');
    expect(troca.descricao).toBe('Responsável alterado.');
    expect(troca.metadata).toEqual({ de: 'u-sherad', para: 'u-murilo', deNome: null, paraNome: 'Murilo Sousa Lima' });
  });

  it('editar só o título não escreve linha de troca', async () => {
    const m = montar();
    await m.servico.atualizar('c1', { titulo: 'Consulta Jurídica — Maria da Silva Santos' } as never, ctx);
    expect(m.historico.some((h) => String(h.descricao).startsWith('Responsável alterado'))).toBe(false);
  });
});
