import { RelatoriosService } from './relatorios.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "CONCLUÍDOS" E "PELA CONSULTA" NOS RELATÓRIOS (15/09/2026, E7 da rodada 4).
 *
 * Desde 15/09 o atendimento também fecha sozinho quando a consulta é
 * registrada, e `concluidos` sobe a partir dessa data. O número novo separa
 * quantos vieram da consulta. Testado executando o serviço com um banco falso:
 * só a leitura de atendimentos tem linhas, e o usuário não vê processos nem a
 * agenda, para as outras seções nem rodarem.
 */
describe('concluidosPelaConsulta', () => {
  const atendente = { nome: 'Julian Helton', nomeExibicao: null };
  const LINHAS = [
    { status: 'CONCLUIDO', conclusaoOrigem: 'CONSULTA', canal: 'PRESENCIAL', assunto: null, assuntoOutro: null, setor: 'JURIDICO', filiadoId: 'f-13', atendente },
    { status: 'CONCLUIDO', conclusaoOrigem: 'TRIAGEM', canal: 'WHATSAPP', assunto: null, assuntoOutro: null, setor: null, filiadoId: 'f-9', atendente },
    // Concluído antes de 15/09/2026: a origem não existia.
    { status: 'CONCLUIDO', conclusaoOrigem: null, canal: 'TELEFONE', assunto: null, assuntoOutro: null, setor: null, filiadoId: 'f-4', atendente },
    { status: 'PENDENTE', conclusaoOrigem: null, canal: 'PRESENCIAL', assunto: null, assuntoOutro: null, setor: null, filiadoId: 'f-14', atendente },
    // Reaberto e cancelado depois: a origem foi limpa, mas mesmo com ela o status manda.
    { status: 'CANCELADO', conclusaoOrigem: 'CONSULTA', canal: 'PRESENCIAL', assunto: null, assuntoOutro: null, setor: null, filiadoId: 'f-7', atendente },
  ];

  it('conta só os concluídos que a consulta fechou; concluídos continua contando todos', async () => {
    let leitura: any = null;
    const prisma: any = new Proxy({}, {
      get(_a, modelo) {
        if (typeof modelo !== 'string' || modelo === 'then') return undefined;
        if (modelo === '$queryRaw') return async () => [];
        return new Proxy({}, {
          get: (_m, metodo) => async (args: any) => {
            if (modelo === 'atendimento' && metodo === 'findMany') { leitura = args; return LINHAS; }
            if (metodo === 'count') return 0;
            if (metodo === 'findMany' || metodo === 'groupBy') return [];
            return null;
          },
        });
      },
    });
    const servico = new RelatoriosService(prisma);
    const r = await servico.montar(
      new Date('2026-09-01T03:00:00.000Z'),
      new Date('2026-09-15T03:00:00.000Z'),
      { id: 'u-coord', role: 'COORDENACAO', permissoes: { processos: 'SEM_ACESSO', agenda: 'SEM_ACESSO' } },
    );
    expect(r.atendimentos).toMatchObject({ registrados: 5, concluidos: 3, concluidosPelaConsulta: 1 });
    expect(leitura.select.conclusaoOrigem).toBe(true);
  });
});
