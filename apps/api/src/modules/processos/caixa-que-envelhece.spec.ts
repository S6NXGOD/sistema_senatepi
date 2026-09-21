import {
  CaixaDePropostasService,
  DIAS_ATE_COBRAR,
  itemDaCaixa,
  ordemDaCaixa,
  situacaoDaProposta,
  type PropostaBruta,
} from './caixa-de-propostas.service';
import { JANELA_DE_TAREFA_DIAS } from './correlacao.service';
import { tenant } from '../../tenant/tenant.config';

/**
 * "ELAS SOMEM DEPOIS QUE PERDEM O PRAZO?" — a pergunta do dono, 18/09/2026.
 *
 * NÃO SOMEM, e este arquivo existe para que continuem não sumindo: nenhuma
 * consulta da caixa tem corte de data, nem a que lista nem a que conta. O que
 * mudou é que a proposta parada deixou de ser desenhada igual à do dia 1.
 *
 * Medido na produção no mesmo dia: 16 propostas na casa inteira, a mais velha
 * com 9 dias, NENHUMA acima de 30 — e só 1 das 16 menciona prazo no texto. Ou
 * seja, 15 sem a rede do `cobrarEsquecidas`, todas com a mesma cara, paradas
 * para sempre se ninguém olhasse.
 */

const HOJE = new Date('2026-09-18T12:00:00Z');
const DIA = 24 * 3_600_000;

/** Um dia de calendário como o Postgres entrega uma coluna `@db.Date`. */
const dataPura = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('a idade da proposta vira estado', () => {
  const situacao = (diasNaCaixa: number, diasDoAto = diasNaCaixa, agora = HOJE) =>
    situacaoDaProposta(
      {
        tarefaPropostaEm: new Date(agora.getTime() - diasNaCaixa * DIA),
        dataDisponibilizacao: dataPura(
          new Date(agora.getTime() - diasDoAto * DIA).toISOString().slice(0, 10),
        ),
      },
      agora,
    );

  it('chegou agora: nada pede ninguém', () => {
    expect(situacao(0)).toMatchObject({ estado: 'NOVA', diasNaCaixa: 0, diasDoAto: 0 });
    expect(situacao(2)).toMatchObject({ estado: 'NOVA', diasNaCaixa: 2 });
  });

  /**
   * A MESMA RÉGUA DO ROBÔ, e é isso que faz o estado significar algo.
   *
   * `cobrarEsquecidas` desiste de esperar em `DIAS_ATE_COBRAR`. Se a proposta
   * ainda está na caixa depois disso, ou a rede não a alcança (sem prazo
   * escrito, ou com o prazo da parte contrária) ou ela não existia para ela —
   * nos dois casos, quem resolve é uma pessoa. Daí o âmbar.
   */
  it(`no dia ${DIAS_ATE_COBRAR} ela passa a pedir uma pessoa`, () => {
    expect(situacao(DIAS_ATE_COBRAR - 1).estado).toBe('NOVA');
    expect(situacao(DIAS_ATE_COBRAR).estado).toBe('PARADA');
    expect(situacao(9)).toMatchObject({ estado: 'PARADA', diasNaCaixa: 9 });
  });

  /**
   * O ATO QUE SAIU DA JANELA — a desistência que era silenciosa.
   *
   * Passados `JANELA_DE_TAREFA_DIAS`, a rede não escala mais: tarefa nascida de
   * um ato velho nasce vencida, e foi isso que desligou as 48 tarefas cegas. A
   * proposta continuava ali, idêntica, sem nada dizendo que agora ninguém mais
   * a socorre.
   */
  it('ato fora da janela de trabalho ganha estado próprio', () => {
    expect(situacao(1, JANELA_DE_TAREFA_DIAS).estado).not.toBe('FORA_DA_JANELA');
    expect(situacao(1, JANELA_DE_TAREFA_DIAS + 1)).toMatchObject({
      estado: 'FORA_DA_JANELA',
      diasDoAto: JANELA_DE_TAREFA_DIAS + 1,
    });
  });

  /** O ato velho vale mesmo quando a proposta é de hoje — o risco é do ato. */
  it('proposta nova de ato velho já nasce fora da janela', () => {
    expect(situacao(0, 45).estado).toBe('FORA_DA_JANELA');
  });

  /**
   * O CONTÊINER RODA EM UTC, e `dataDisponibilizacao` é `@db.Date`.
   *
   * Às 22h de Teresina já é o dia seguinte em UTC. Contar por instante diria
   * "há 1 dia" para o ato de hoje — o número que faz alguém tratar como velho o
   * que acabou de chegar. Aqui os dois lados viram DIA DE CALENDÁRIO de
   * Teresina antes de subtrair.
   */
  it('às 22h de Teresina o ato de hoje ainda é de hoje', () => {
    const vinteEDuas = new Date('2026-09-19T01:00:00Z');
    expect(
      situacaoDaProposta(
        { tarefaPropostaEm: vinteEDuas, dataDisponibilizacao: dataPura('2026-09-18') },
        vinteEDuas,
      ).diasDoAto,
    ).toBe(0);
    const madrugadaSeguinte = new Date('2026-09-19T05:00:00Z');
    expect(
      situacaoDaProposta(
        { tarefaPropostaEm: madrugadaSeguinte, dataDisponibilizacao: dataPura('2026-09-18') },
        madrugadaSeguinte,
      ).diasDoAto,
    ).toBe(1);
  });

  /** Relógio adiantado não inventa idade negativa. */
  it('nunca conta dias negativos', () => {
    expect(situacao(-5, -5)).toMatchObject({ diasNaCaixa: 0, diasDoAto: 0 });
  });
});

describe('a ordem da caixa', () => {
  const item = (
    id: string,
    estado: 'NOVA' | 'PARADA' | 'FORA_DA_JANELA',
    dia: string,
    prazoMencionadoDias: number | null = null,
  ) => ({ id, estado, dataDisponibilizacao: dataPura(dia), prazoMencionadoDias });

  /**
   * TRABALHO ANTES DE NÚMERO. A ordem era `prazo asc nulls last` e depois a
   * data: a proposta COM prazo subia sempre — justo a que o robô resolve
   * sozinho em três dias — e as quatro vagas da tela entupiam com o item mais
   * velho e mais indecidível.
   */
  it('põe na frente o que pede uma pessoa, não o que tem prazo escrito', () => {
    const fila = [
      item('nova-com-prazo', 'NOVA', '2026-09-18', 15),
      item('parada', 'PARADA', '2026-09-12'),
      item('fora', 'FORA_DA_JANELA', '2026-07-30'),
    ].sort(ordemDaCaixa);
    expect(fila.map((i) => i.id)).toEqual(['fora', 'parada', 'nova-com-prazo']);
  });

  it('dentro do mesmo estado, o prazo escrito na frente e o ato mais antigo depois', () => {
    const fila = [
      item('sem-prazo-novo', 'PARADA', '2026-09-14'),
      item('sem-prazo-velho', 'PARADA', '2026-09-10'),
      item('com-prazo', 'PARADA', '2026-09-15', 5),
    ].sort(ordemDaCaixa);
    expect(fila.map((i) => i.id)).toEqual(['com-prazo', 'sem-prazo-velho', 'sem-prazo-novo']);
  });

  /** Ordem estável: a fila não pode dançar entre duas aberturas do painel. */
  it('empate total não muda de lugar', () => {
    const a = item('aaa', 'NOVA', '2026-09-18');
    const b = item('bbb', 'NOVA', '2026-09-18');
    expect([b, a].sort(ordemDaCaixa).map((i) => i.id)).toEqual(['aaa', 'bbb']);
  });
});

/**
 * CONTRA QUEM É O PROCESSO — uma regra, um dono.
 *
 * O cartão fazia `partes.find((p) => p.polo === 'PASSIVO')`. Quando a ação é
 * CONTRA o sindicato, o passivo somos nós: a caixa imprimia o nome do PRÓPRIO
 * sindicato como adversário. A regra com dono é `adversarioDoProcesso`, do
 * painel, que casa o nosso polo antes de escolher o outro lado.
 */
describe('o adversário sai da regra canônica', () => {
  const ORG_SINDICATO = 'org-do-sindicato';

  const parte = (nome: string, polo: string, over: Record<string, unknown> = {}) => ({
    nome, polo, principal: true, parteExternaId: null, filiadoId: null, parteExterna: null,
    ...over,
  });

  const bruta = (partes: unknown[]): PropostaBruta => ({
    id: 'pub-1',
    numeroProcesso: '00008146120265220002',
    siglaTribunal: 'TRT22',
    nomeOrgao: '2ª Vara do Trabalho de Teresina',
    nomeClasse: 'ATOrd',
    tipoComunicacao: 'Intimação',
    texto: 'DESPACHO. Sem ordem legível para ninguém aqui.',
    dataDisponibilizacao: dataPura('2026-09-17'),
    providencia: 'MANIFESTACAO',
    prazoMencionadoDias: null,
    tarefaPropostaEm: new Date('2026-09-17T09:00:00Z'),
    link: null,
    propostaPara: null,
    processo: { id: 'proc-1', numeroCNJ: '0000814-61.2026.5.22.0002', partes: partes as never },
  });

  it('com o sindicato no polo PASSIVO, o adversário é o outro lado', () => {
    const item = itemDaCaixa(
      bruta([
        parte('FEDERAÇÃO DE SINDICATOS - FASUBRA', 'ATIVO', { parteExternaId: 'org-fasubra' }),
        parte(`SINDICATO DOS ENFERMEIROS - ${tenant.sigla}`, 'PASSIVO', {
          parteExternaId: ORG_SINDICATO,
        }),
      ]),
      ORG_SINDICATO,
      HOJE,
    );
    expect(item.adversario).toBe('FEDERAÇÃO DE SINDICATOS - FASUBRA');
  });

  it('com o sindicato no polo ATIVO, o adversário é o réu', () => {
    const item = itemDaCaixa(
      bruta([
        parte(`SINDICATO DOS ENFERMEIROS - ${tenant.sigla}`, 'ATIVO', {
          parteExternaId: ORG_SINDICATO,
        }),
        parte('HAPVIDA ASSISTENCIA MEDICA LTDA', 'PASSIVO', { parteExternaId: 'org-hapvida' }),
      ]),
      ORG_SINDICATO,
      HOJE,
    );
    expect(item.adversario).toBe('HAPVIDA ASSISTENCIA MEDICA LTDA');
  });

  /** O nome de fantasia do cadastro é o que cabe na linha — regra do painel. */
  it('usa o nome curto quando o cadastro tem um', () => {
    const item = itemDaCaixa(
      bruta([
        parte(`SINDICATO - ${tenant.sigla}`, 'ATIVO', { parteExternaId: ORG_SINDICATO }),
        parte('FUNDACAO MUNICIPAL DE SAUDE DE TERESINA', 'PASSIVO', {
          parteExternaId: 'org-fms',
          parteExterna: { nomeFantasia: 'FMS/THE' },
        }),
      ]),
      ORG_SINDICATO,
      HOJE,
    );
    expect(item.adversario).toBe('FMS/THE');
  });

  it('sem processo, fica em branco em vez de chutar', () => {
    const semProcesso = { ...bruta([]), processo: null };
    expect(itemDaCaixa(semProcesso, ORG_SINDICATO, HOJE).adversario).toBeNull();
  });

  /**
   * AS PARTES NÃO VIAJAM MAIS. Elas iam ao navegador só para o cartão
   * descobrir o adversário — e era ali que a segunda regra vivia.
   */
  it('o payload leva o nome pronto, não a lista de partes', () => {
    const item = itemDaCaixa(
      bruta([parte('HAPVIDA', 'PASSIVO', { parteExternaId: 'org-hapvida' })]),
      ORG_SINDICATO,
      HOJE,
    );
    expect(item.processo).toEqual({ id: 'proc-1', numeroCNJ: '0000814-61.2026.5.22.0002' });
    expect(JSON.stringify(item)).not.toContain('polo');
  });
});

/**
 * O TEOR NÃO TRAFEGA MAIS POR NADA.
 *
 * Ia inteiro (2.476 caracteres em média) para até 100 publicações a cada
 * abertura do painel, só para alimentar uma prévia de 180 caracteres.
 */
describe('o que sai no lugar do teor', () => {
  const comTexto = (texto: string): PropostaBruta => ({
    id: 'pub-1', numeroProcesso: '0', siglaTribunal: null, nomeOrgao: null, nomeClasse: null,
    tipoComunicacao: null, texto, dataDisponibilizacao: dataPura('2026-09-17'),
    providencia: null, prazoMencionadoDias: null,
    tarefaPropostaEm: new Date('2026-09-17T09:00:00Z'), link: null,
    propostaPara: null, processo: null,
  });

  it('com ordem recortada, o teor nem é mandado', () => {
    const item = itemDaCaixa(
      comTexto(
        'PODER JUDICIARIO TRIBUNAL REGIONAL DO TRABALHO DA 22a REGIAO. ' +
          'INTIME-SE A RECLAMADA PARA RECOLHIMENTO NO PRAZO DE 15 DIAS. NADA MAIS.',
      ),
      null,
      HOJE,
    );
    expect(item.ordem).toContain('INTIME-SE A RECLAMADA');
    expect(item.texto).toBeNull();
  });

  /** 29,9% dos atos não têm ordem escrita: aí a tela cai para o corpo do teor. */
  it('sem ordem, vai só o começo do teor — o bastante para a prévia', () => {
    const gigante = `SENTENCA PUBLICADA EM AUDIENCIA. ${'x'.repeat(5_000)}`;
    const item = itemDaCaixa(comTexto(gigante), null, HOJE);
    expect(item.ordem).toBeNull();
    expect(item.texto).not.toBeNull();
    expect(item.texto!.length).toBeLessThan(2_000);
    expect(item.texto!.startsWith('SENTENCA PUBLICADA EM AUDIENCIA.')).toBe(true);
  });
});

/**
 * A CAIXA INTEIRA, com um Prisma de mentira — a ordem e o que a consulta pede.
 */
describe('listar', () => {
  const linha = (over: Partial<PropostaBruta> & { id: string }): PropostaBruta => ({
    numeroProcesso: '00008146120265220002', siglaTribunal: 'TRT22', nomeOrgao: null,
    nomeClasse: 'ATOrd', tipoComunicacao: 'Intimação',
    texto: 'SENTENCA PUBLICADA EM AUDIENCIA. NADA MAIS.',
    dataDisponibilizacao: dataPura('2026-09-17'), providencia: 'MANIFESTACAO',
    prazoMencionadoDias: null, tarefaPropostaEm: new Date('2026-09-17T09:00:00Z'),
    link: null, propostaPara: null, processo: null,
    ...over,
  });

  const montar = (linhas: PropostaBruta[]) => {
    const prisma = {
      comunicacaoDjen: {
        findMany: jest.fn(async (..._a: unknown[]) => linhas),
        count: jest.fn(async (..._a: unknown[]) => linhas.length),
      },
      parteExterna: { findFirst: jest.fn(async () => ({ id: 'org-do-sindicato' })) },
    };
    const caixa = new CaixaDePropostasService(prisma as never, {} as never);
    const where = (chamada: jest.Mock) =>
      (chamada.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    return { caixa, prisma, where };
  };

  it('a fila chega com o parado na frente e o recente no fim', async () => {
    const { caixa } = montar([
      linha({ id: 'recente', tarefaPropostaEm: new Date(HOJE.getTime() - 1 * DIA), dataDisponibilizacao: dataPura('2026-09-17') }),
      linha({ id: 'velho', tarefaPropostaEm: new Date(HOJE.getTime() - 1 * DIA), dataDisponibilizacao: dataPura('2026-07-20') }),
      linha({ id: 'parado', tarefaPropostaEm: new Date(HOJE.getTime() - 6 * DIA), dataDisponibilizacao: dataPura('2026-09-12') }),
    ]);
    const fila = await caixa.listar('u-morgana', false, HOJE);
    expect(fila.map((i) => i.id)).toEqual(['velho', 'parado', 'recente']);
    expect(fila.map((i) => i.estado)).toEqual(['FORA_DA_JANELA', 'PARADA', 'NOVA']);
  });

  /**
   * NADA SOME POR TEMPO — e é esta a resposta à pergunta do dono.
   *
   * A consulta não tem corte de data nenhum: o que tira uma publicação da caixa
   * é virar atividade (`compromissoId`) ou ser dispensada, nunca o relógio.
   */
  it('a consulta não tem corte de data — a proposta não expira', async () => {
    const { caixa, prisma, where } = montar([]);
    await caixa.listar('u-morgana', false, HOJE);
    const w = where(prisma.comunicacaoDjen.findMany as jest.Mock);
    expect(Object.keys(w).sort()).toEqual(
      ['compromissoId', 'tarefaDispensadaEm', 'tarefaPropostaEm', 'tarefaPropostaPara'].sort(),
    );
  });

  it('e a contagem conta o mesmo, sem corte de data também', async () => {
    const { caixa, prisma, where } = montar([]);
    await caixa.contar('u-morgana', false);
    const w = where(prisma.comunicacaoDjen.count as jest.Mock);
    expect(w).not.toHaveProperty('dataDisponibilizacao');
    expect(w).toMatchObject({ compromissoId: null, tarefaDispensadaEm: null });
  });

  /** O teto de linhas corta o mais NOVO, que é quem ainda tem tempo. */
  it('o banco entrega do ato mais antigo para o mais novo', async () => {
    const { caixa, prisma } = montar([]);
    await caixa.listar('u-morgana', false, HOJE);
    const args = (prisma.comunicacaoDjen.findMany as jest.Mock).mock.calls[0][0] as {
      orderBy: unknown; take: number;
    };
    expect(args.orderBy).toEqual([{ dataDisponibilizacao: 'asc' }]);
    expect(args.take).toBe(100);
  });
});

/**
 * O PAINEL CONTINUA MONTANDO — e este teste custou um bootstrap quebrado.
 *
 * `adversarioDoProcesso` mora em `dashboard.module.ts`, e reusar a regra é o
 * certo. Só que `app.module` carrega `ProcessosModule` ANTES de
 * `DashboardModule`: um import estático daqui fecha o ciclo
 * processos → dashboard → processos, e o `@Module({ imports: [ProcessosModule] })`
 * do painel passa a receber `undefined` — a API não sobe. Medido, não deduzido.
 *
 * Por isso a regra é resolvida na CHAMADA. Se alguém trocar por um import de
 * topo, este teste fica vermelho antes do deploy.
 */
describe('a reutilização da regra não derruba a API', () => {
  it('carregar processos primeiro não deixa o painel sem ProcessosModule', () => {
    jest.isolateModules(() => {
      // A ordem do app.module: ProcessosModule (linha 23), DashboardModule (33).
      require('./processos.module');
      const { DashboardModule } = require('../dashboard/dashboard.module');
      const imports = Reflect.getMetadata('imports', DashboardModule) as unknown[];
      expect(imports.length).toBeGreaterThan(0);
      expect(imports).not.toContain(undefined);
    });
  });
});
