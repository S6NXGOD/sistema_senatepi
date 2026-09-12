import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGEM_RESERVA, daPessoa, reservaAtrasada } from './equipe.util';
import { PendenciasService } from './pendencias.service';

const MIGRACAO = readFileSync(
  join(
    __dirname,
    '../../../prisma/migrations/20260912230000_reserva_acompanha_a_equipe/migration.sql',
  ),
  'utf8',
);
const PAINEL = readFileSync(join(__dirname, '../dashboard/dashboard.module.ts'), 'utf8');
const RELATORIOS = readFileSync(join(__dirname, '../relatorios/relatorios.service.ts'), 'utf8');

/**
 * "ESSA ATIVIDADE CITA O CARLOS E O TIAGO. NÃO SERIA INTERESSANTE O PRINCIPAL
 * COMO RESPONSÁVEL E O OUTRO COMO QUEM TAMBÉM PARTICIPA?" — pedido de 12/09/2026.
 *
 * A regra já existia desde 11/09 (a equipe do caso entra como reserva da tarefa
 * do robô), e a tarefa do print tinha só o responsável. Três furos, medidos:
 *
 *  · a varredura do Diário cria a tarefa ANTES de ligar ao processo os advogados
 *    citados — a advogada entrou na equipe 1,8 segundo depois da tarefa;
 *  · as tarefas abertas de antes de 11/09 nunca receberam ninguém;
 *  · e a reserva nunca era avisada, nem quando a tarefa ficava para trás — com o
 *    responsável sem acessar o sistema havia 39 dias.
 */
describe('a reserva acompanha a equipe do caso', () => {
  it('o gatilho mora na equipe do processo, na entrada e na saída', () => {
    expect(MIGRACAO).toContain('CREATE OR REPLACE FUNCTION senatepi_reserva_acompanha_a_equipe()');
    expect(MIGRACAO).toContain('DROP TRIGGER IF EXISTS trg_reserva_acompanha_a_equipe ON "processos_advogados";');
    expect(MIGRACAO).toContain('AFTER INSERT OR DELETE ON "processos_advogados"');
  });

  it('entrar: só tarefa aberta do robô, só advogado ativo, nunca o responsável', () => {
    const entrada = MIGRACAO.slice(
      MIGRACAO.indexOf("IF TG_OP = 'INSERT' THEN"),
      MIGRACAO.indexOf('RETURN NEW;'),
    );
    for (const regra of [
      'AND c."origem_automatica"',
      `AND c."status" IN ('PENDENTE', 'EM_ANDAMENTO')`,
      'AND c."responsavel_id" <> NEW."advogado_id"',
      'AND u."ativo"',
      "'AUTOMATICA'",
      'ON CONFLICT DO NOTHING',
    ]) {
      expect(entrada).toContain(regra);
    }
  });

  /** Participante escolhido por gente e quem assumiu a tarefa não saem junto. */
  it('sair: apaga só a linha que o robô pôs', () => {
    const saida = MIGRACAO.slice(
      MIGRACAO.indexOf('DELETE FROM "compromisso_responsaveis" r'),
      MIGRACAO.indexOf('RETURN OLD;'),
    );
    expect(saida).toContain(`AND r."origem" = 'AUTOMATICA'`);
    expect(saida).toContain('AND NOT r."principal"');
    expect(saida).toContain(`AND c."status" IN ('PENDENTE', 'EM_ANDAMENTO')`);
  });

  /**
   * A DÍVIDA DE ANTES É PAGA UMA VEZ, sem reescrever ninguém. Ensaiada duas
   * vezes na produção em transação desfeita: 13 linhas na primeira aplicação,
   * zero na segunda.
   */
  it('a carga das tarefas antigas só acrescenta', () => {
    const carga = MIGRACAO.slice(MIGRACAO.lastIndexOf('INSERT INTO "compromisso_responsaveis"'));
    expect(carga).toContain('JOIN "processos_advogados" pa ON pa."processo_id" = c."processo_id"');
    expect(carga).toContain('AND pa."advogado_id" <> c."responsavel_id"');
    expect(carga).toContain('ON CONFLICT DO NOTHING;');
    expect(MIGRACAO).not.toMatch(/UPDATE\s+"compromisso_responsaveis"/);
  });
});

describe('uma régua só para o que é da pessoa', () => {
  it('o que é da pessoa deixa a reserva do robô de fora', () => {
    expect(daPessoa('u1')).toEqual({
      OR: [
        { responsavelId: 'u1' },
        { equipe: { some: { usuarioId: 'u1', OR: [{ origem: null }, { origem: { not: 'AUTOMATICA' } }] } } },
      ],
    });
  });

  it('a reserva atrasada: dia virado, outro responsável, marca do robô', () => {
    const hoje = new Date('2026-09-12T03:00:00Z');
    expect(reservaAtrasada('u1', hoje)).toEqual({
      inicio: { lt: hoje },
      responsavelId: { not: 'u1' },
      equipe: { some: { usuarioId: 'u1', principal: false, origem: ORIGEM_RESERVA } },
    });
  });

  /**
   * O PAINEL E O RELATÓRIO ESCREVIAM A CONTA À MÃO — e os dois tinham esquecido
   * a reserva. Com as tarefas antigas recebendo a equipe, o painel de três
   * advogados passaria a mostrar "2 atrasadas" que não eram deles, com o sino
   * calado. A régua agora é uma.
   */
  it('painel e relatório usam a mesma régua do sino', () => {
    expect(PAINEL).toContain('const meu: Prisma.CompromissoWhereInput = souAdvogado ? daPessoa(user.id) : {};');
    expect(PAINEL).not.toContain('{ equipe: { some: { usuarioId: user.id } } }');
    expect(RELATORIOS).toContain('const soMeu: Prisma.CompromissoWhereInput = alvo ? daPessoa(alvo) : {};');
    expect(RELATORIOS).not.toContain('{ equipe: { some: { usuarioId: alvo } } }');
  });

  it('o painel do advogado recebe a reserva atrasada à parte', () => {
    expect(PAINEL).toContain('souAdvogado && veAgenda');
    expect(PAINEL).toContain('...reservaAtrasada(user.id, hojeIni),');
  });
});

/** Uma tarefa do jeito que a consulta devolve. */
const tarefa = (
  id: string,
  titulo: string,
  inicio: string,
  responsavel?: { nome: string; nomeExibicao: string | null },
) => ({ id, titulo, inicio: new Date(inicio), processo: { numeroCNJ: null }, ...(responsavel ? { responsavel } : {}) });

/** Um banco de mentira que responde conforme a PERGUNTA, e não conforme a ordem. */
function sinoCom(fontes: { minhasAtrasadas?: unknown[]; daEquipe?: unknown[] }) {
  const findMany = jest.fn(async ({ where }: { where: Record<string, any> }) => {
    if (where?.equipe?.some?.origem === ORIGEM_RESERVA) return fontes.daEquipe ?? [];
    if (where?.OR && where?.inicio?.lt && !where?.inicio?.gte) return fontes.minhasAtrasadas ?? [];
    return [];
  });
  const prisma = {
    compromisso: { findMany },
    comunicacaoDjen: { findMany: jest.fn(async () => []) },
    sugestaoProcesso: { findMany: jest.fn(async () => []) },
  };
  return { sino: new PendenciasService(prisma as never), findMany };
}

describe('o sino avisa a reserva quando a tarefa fica para trás', () => {
  it('com o nome de quem responde, e contando no crachá', async () => {
    const { sino } = sinoCom({
      daEquipe: [
        tarefa('c1', 'Juntar documentos', '2026-09-08T12:00:00Z', {
          nome: 'Carlos Henrique de Alencar Vieira',
          nomeExibicao: 'Dr. Carlos Henrique',
        }),
      ],
    });
    const r = await sino.minhas('u-tiago');
    const grupo = r.pendencias.find((p) => p.tipo === 'ATRASADA_NA_EQUIPE');
    expect(grupo?.total).toBe(1);
    expect(grupo?.exemplos[0]).toEqual({
      id: 'c1',
      titulo: 'Juntar documentos · Dr. Carlos Henrique',
      quando: '2026-09-08T12:00:00.000Z',
      href: '/agenda?compromisso=c1',
    });
    expect(r.total).toBe(1);
  });

  it('logo depois das atrasadas da própria pessoa', async () => {
    const { sino } = sinoCom({
      minhasAtrasadas: [tarefa('m1', 'Elaborar recurso', '2026-09-10T12:00:00Z')],
      daEquipe: [tarefa('c1', 'Juntar documentos', '2026-09-08T12:00:00Z', { nome: 'Fulana', nomeExibicao: null })],
    });
    const r = await sino.minhas('u-tiago');
    expect(r.pendencias.map((p) => p.tipo)).toEqual(['ATRASADA', 'ATRASADA_NA_EQUIPE']);
    expect(r.pendencias[1].exemplos[0].titulo).toBe('Juntar documentos · Fulana');
  });

  /** O corte é o dia de Teresina — a mesma régua de "atrasada" —, nunca o relógio. */
  it('a consulta usa o início do dia e só tarefa aberta de outro responsável', async () => {
    const { sino, findMany } = sinoCom({});
    await sino.minhas('u-tiago');
    const pergunta = findMany.mock.calls
      .map(([arg]) => arg.where)
      .find((w) => w?.equipe?.some?.origem === ORIGEM_RESERVA);
    expect(pergunta).toBeDefined();
    expect(pergunta!.inicio.lt.getUTCHours()).toBe(3);
    expect(pergunta!.responsavelId).toEqual({ not: 'u-tiago' });
    expect(pergunta!.status).toEqual({ in: ['PENDENTE', 'EM_ANDAMENTO'] });
  });

  it('sem nada atrasado no caso, a reserva não é incomodada', async () => {
    const { sino } = sinoCom({});
    const r = await sino.minhas('u-tiago');
    expect(r.pendencias).toEqual([]);
    expect(r.total).toBe(0);
  });
});
