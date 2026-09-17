import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ORIGEM_RESERVA, ausenciaDe, daPessoa, motivoParaAvisarAEquipe, ondeSouReserva, porQueAEquipePrecisa,
} from './equipe.util';
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

  it('onde sou reserva: outro responsável, marca do robô, sem corte de data', () => {
    expect(ondeSouReserva('u1')).toEqual({
      responsavelId: { not: 'u1' },
      equipe: { some: { usuarioId: 'u1', principal: false, origem: ORIGEM_RESERVA } },
    });
  });

  /**
   * O PAINEL E O RELATÓRIO ESCREVIAM A CONTA À MÃO — e os dois tinham esquecido
   * a reserva. Com as tarefas antigas recebendo a equipe, o painel de três
   * advogados passaria a mostrar "2 atrasadas" que não eram deles. A régua agora
   * é uma.
   */
  it('painel e relatório usam a mesma régua da faixa de avisos', () => {
    expect(PAINEL).toContain('const meu: Prisma.CompromissoWhereInput = souAdvogado ? daPessoa(user.id) : {};');
    expect(PAINEL).not.toContain('{ equipe: { some: { usuarioId: user.id } } }');
    expect(RELATORIOS).toContain('const soMeu: Prisma.CompromissoWhereInput = alvo ? daPessoa(alvo) : {};');
    expect(RELATORIOS).not.toContain('{ equipe: { some: { usuarioId: alvo } } }');
  });

  it('o painel do advogado recebe a equipe à parte, pela mesma regra da faixa', () => {
    expect(PAINEL).toContain('souAdvogado && veAgenda');
    expect(PAINEL).toContain('...ondeSouReserva(user.id)');
    expect(PAINEL).toContain('motivoParaAvisarAEquipe(t, usos.get(t.responsavel.id), agora)');
  });
});

const DIA = 86_400_000;
/** Meio-dia de 12/09/2026 em Teresina. */
const agora = new Date('2026-09-12T15:00:00Z');
const esteve = (dias: number) => ({ ativo: true, ultimoUso: new Date(agora.getTime() - dias * DIA) });

/**
 * "QUANDO O ADVOGADO ENTRA DE RESERVA, ELE É AVISADO QUE PRECISA RESOLVER ESSA
 * TAREFA? AFINAL, É UMA EQUIPE." — 12/09/2026.
 *
 * Não era, até a tarefa atrasar. E "atrasar" chegava tarde: das 8 tarefas
 * abertas do robô na produção, 5 tinham o responsável sem entrar havia 7 dias ou
 * mais, e só 2 já tinham ficado para trás.
 */
describe('quando ninguém está cuidando, a equipe fica sabendo', () => {
  const daquiADois = { inicio: new Date('2026-09-14T12:00:00Z') };
  const ontem = { inicio: new Date('2026-09-11T12:00:00Z') };

  it('responsável por perto e tarefa em dia: ninguém é incomodado', () => {
    expect(motivoParaAvisarAEquipe(daquiADois, esteve(1), agora)).toBeNull();
  });

  it('responsável sumido há 39 dias: a equipe sabe ANTES de a tarefa atrasar', () => {
    expect(motivoParaAvisarAEquipe(daquiADois, esteve(39), agora)).toEqual({
      motivo: 'RESPONSAVEL_AUSENTE',
      diasSemEntrar: 39,
      inativo: false,
    });
  });

  /** Seis dias é férias curtas ou um processo longo — cobrar os colegas por isso ensina a ignorar. */
  it('o corte é uma semana', () => {
    expect(ausenciaDe(esteve(6), agora)).toBeNull();
    expect(ausenciaDe(esteve(7), agora)).toEqual({ diasSemEntrar: 7, inativo: false });
  });

  it('nunca ter entrado, ou ter saído do sistema, conta como sumido', () => {
    expect(ausenciaDe({ ativo: true, ultimoUso: null }, agora)).toEqual({ diasSemEntrar: null, inativo: false });
    expect(ausenciaDe({ ativo: false, ultimoUso: agora }, agora)).toEqual({ diasSemEntrar: null, inativo: true });
    expect(ausenciaDe(undefined, agora)).toEqual({ diasSemEntrar: null, inativo: true });
  });

  it('com o responsável por perto, o dia virado ainda avisa', () => {
    expect(motivoParaAvisarAEquipe(ontem, esteve(1), agora)).toEqual({
      motivo: 'FICOU_PARA_TRAS',
      diasSemEntrar: null,
      inativo: false,
    });
  });

  it('a frase diz o porquê, com o nome de quem responde', () => {
    const ausente = (diasSemEntrar: number | null, inativo = false) =>
      ({ motivo: 'RESPONSAVEL_AUSENTE', diasSemEntrar, inativo }) as const;
    expect(porQueAEquipePrecisa('Dr. Carlos', ausente(39))).toBe('Dr. Carlos está sem entrar há 39 dias');
    expect(porQueAEquipePrecisa('Dr. Carlos', ausente(null))).toBe('Dr. Carlos nunca entrou no sistema');
    expect(porQueAEquipePrecisa('Dr. Carlos', ausente(null, true))).toBe('Dr. Carlos não está mais no sistema');
    expect(
      porQueAEquipePrecisa('Dr. Tiago', { motivo: 'FICOU_PARA_TRAS', diasSemEntrar: null, inativo: false }),
    ).toBe('de Dr. Tiago · ficou para trás');
  });
});

/** Uma tarefa do jeito que a consulta devolve. */
const tarefa = (
  id: string,
  titulo: string,
  inicio: string,
  responsavel?: { id: string; nome: string; nomeExibicao: string | null },
) => ({ id, titulo, inicio: new Date(inicio), ...(responsavel ? { responsavel } : {}) });

/** Um banco de mentira que responde conforme a PERGUNTA, e não conforme a ordem. */
function avisosCom(fontes: { minhasAtrasadas?: unknown[]; souReserva?: unknown[]; usuarios?: unknown[] }) {
  const findMany = jest.fn(async ({ where }: { where: Record<string, any> }) => {
    if (where?.equipe?.some?.origem === ORIGEM_RESERVA) return fontes.souReserva ?? [];
    if (where?.OR && where?.inicio?.lt) return fontes.minhasAtrasadas ?? [];
    return [];
  });
  const prisma = {
    compromisso: { findMany },
    comunicacaoDjen: { findMany: jest.fn(async () => []) },
    // A faixa também pergunta pelos ANDAMENTOS que ninguém decidiu; este caso
    // não é sobre eles, e a lista vazia mantém o teste no seu assunto.
    movimentacaoProcessual: { findMany: jest.fn(async () => []) },
    user: { findMany: jest.fn(async () => fontes.usuarios ?? []) },
    refreshToken: { groupBy: jest.fn(async () => []) },
    auditoria: { groupBy: jest.fn(async () => []) },
  };
  return { avisos: new PendenciasService(prisma as never), findMany };
}

const carlos = { id: 'u-carlos', nome: 'Carlos Henrique de Alencar Vieira', nomeExibicao: 'Dr. Carlos Henrique' };
const tiago = { id: 'u-tiago', nome: 'Tiago Veloso', nomeExibicao: 'Dr. Tiago' };
/** Um instante há N dias, contado do relógio de verdade — é contra ele que o serviço mede. */
const ha = (dias: number) => new Date(Date.now() - dias * DIA - 60_000);

describe('a faixa avisa a reserva quando ninguém está cuidando', () => {
  it('responsável sumido: avisa antes de atrasar, e diz por quê', async () => {
    const { avisos } = avisosCom({
      souReserva: [tarefa('c1', 'Elaborar manifestação', '2099-01-14T12:00:00Z', carlos)],
      usuarios: [{ id: 'u-carlos', ativo: true, ultimoLoginEm: ha(39) }],
    });
    const r = await avisos.minhas('u-morgana');
    expect(r.pendencias).toEqual([
      {
        tipo: 'PRECISA_DA_EQUIPE',
        total: 1,
        exemplos: [
          {
            id: 'c1',
            titulo: 'Elaborar manifestação',
            quando: '2099-01-14T12:00:00.000Z',
            href: '/agenda?compromisso=c1',
            detalhe: 'Dr. Carlos Henrique está sem entrar há 39 dias',
          },
        ],
      },
    ]);
    expect(r.total).toBe(1);
  });

  it('responsável por perto e tarefa em dia: a reserva não é incomodada', async () => {
    const { avisos } = avisosCom({
      souReserva: [tarefa('c1', 'Elaborar manifestação', '2099-01-14T12:00:00Z', carlos)],
      usuarios: [{ id: 'u-carlos', ativo: true, ultimoLoginEm: ha(1) }],
    });
    expect((await avisos.minhas('u-morgana')).pendencias).toEqual([]);
  });

  it('o dia virou: avisa mesmo com o responsável por perto', async () => {
    const { avisos } = avisosCom({
      souReserva: [tarefa('c2', 'Juntar documentos', '2026-09-08T12:00:00Z', tiago)],
      usuarios: [{ id: 'u-tiago', ativo: true, ultimoLoginEm: ha(0) }],
    });
    const r = await avisos.minhas('u-morgana');
    expect(r.pendencias[0].exemplos[0].detalhe).toBe('de Dr. Tiago · ficou para trás');
  });

  it('quem saiu do sistema também deixa a tarefa sem ninguém', async () => {
    const { avisos } = avisosCom({
      souReserva: [tarefa('c3', 'Analisar intimação', '2099-01-15T12:00:00Z', carlos)],
      usuarios: [],
    });
    const r = await avisos.minhas('u-morgana');
    expect(r.pendencias[0].exemplos[0].detalhe).toBe('Dr. Carlos Henrique não está mais no sistema');
  });

  it('vem logo depois das atrasadas da própria pessoa', async () => {
    const { avisos } = avisosCom({
      minhasAtrasadas: [tarefa('m1', 'Elaborar recurso', '2026-09-10T12:00:00Z')],
      souReserva: [tarefa('c1', 'Juntar documentos', '2026-09-08T12:00:00Z', tiago)],
      usuarios: [{ id: 'u-tiago', ativo: true, ultimoLoginEm: ha(0) }],
    });
    const r = await avisos.minhas('u-morgana');
    expect(r.pendencias.map((p) => p.tipo)).toEqual(['ATRASADA', 'PRECISA_DA_EQUIPE']);
  });

  it('a consulta das reservas: só tarefa aberta de outro responsável, sem corte de data', async () => {
    const { avisos, findMany } = avisosCom({});
    await avisos.minhas('u-morgana');
    const pergunta = findMany.mock.calls
      .map(([arg]) => arg.where)
      .find((w) => w?.equipe?.some?.origem === ORIGEM_RESERVA);
    expect(pergunta).toBeDefined();
    expect(pergunta!.responsavelId).toEqual({ not: 'u-morgana' });
    expect(pergunta!.status).toEqual({ in: ['PENDENTE', 'EM_ANDAMENTO'] });
    expect(pergunta!.inicio).toBeUndefined();
  });

  it('sem nada no caso, a faixa fica calada', async () => {
    const { avisos } = avisosCom({});
    expect(await avisos.minhas('u-morgana')).toEqual({ pendencias: [], total: 0 });
  });
});
