import { StatusCompromisso, UserRole } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ORIGEM_RESERVA, daPessoa } from '../agenda/equipe.util';
import { recorteAberto } from '../agenda/recortes.util';
import { linhaDeResumoDatajud } from '../processos/processos-cron.service';
import { SELECAO_DAS_ABERTAS } from '../relatorios/abertas-da-pessoa.util';
import { DashboardService } from './dashboard.module';
import { PREFIXO_RODADA_SEM_ALVO, SO_CHAMADAS_AO_TRIBUNAL, wheresDoPainel } from './painel.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O `GET /dashboard/resumo` DE VERDADE, com um banco falso.
 *
 * `painel.regras.spec.ts` prova as regras com linhas; este prova que o serviço
 * as usa — que o corte por módulo acontece antes da consulta, que a carga soma
 * pela régua certa, que o cartão de atendimentos sai com o estado e que a linha
 * de resumo do DataJud fica fora das contas das fontes. Os testes do módulo que
 * leem o texto do arquivo continuaram verdes com o painel contando errado; estes
 * não teriam.
 */

const br = (local: string) => new Date(`${local}-03:00`);
/** Terça, 15/09/2026, 10h em Teresina. */
const AGORA = br('2026-09-15T10:00:00');

type Impl = Record<string, (args: any) => unknown>;

function montar(impl: Impl = {}, raw: (sql: string) => unknown = () => []) {
  const chamadas: { chave: string; args: any }[] = [];
  const consultas: { sql: string; valores: unknown[] }[] = [];
  const padrao = (metodo: string) =>
    metodo === 'count' ? 0 : metodo === 'findMany' || metodo === 'groupBy' ? [] : null;
  const prisma: any = new Proxy(
    {},
    {
      get(_a, modelo) {
        if (typeof modelo !== 'string' || modelo === 'then') return undefined;
        if (modelo === '$queryRaw') {
          return async (strings: TemplateStringsArray, ...valores: unknown[]) => {
            const sql = strings.join('?');
            consultas.push({ sql, valores });
            return raw(sql);
          };
        }
        return new Proxy(
          {},
          {
            get: (_m, metodo) =>
              typeof metodo !== 'string'
                ? undefined
                : async (args: any) => {
                    const chave = `${modelo}.${metodo}`;
                    chamadas.push({ chave, args });
                    return impl[chave] ? impl[chave](args) : padrao(metodo);
                  },
          },
        );
      },
    },
  );
  const audiencias = { listar: jest.fn(async () => ({ total: 0, items: [] })) };
  const servico = new DashboardService(prisma, audiencias as never);
  const de = (chave: string) => chamadas.filter((c) => c.chave === chave);
  return { servico, chamadas, consultas, de };
}

const usuario = (role: UserRole, permissoes: unknown = null, id = 'u1'): AuthUser => ({
  id,
  email: 'pessoa@sindicato.org',
  nome: 'Pessoa',
  role,
  permissoes,
});

beforeEach(() => jest.useFakeTimers({ now: AGORA }));
afterEach(() => jest.useRealTimers());

describe('o plantão se corta no servidor', () => {
  it('quem não vê a escala recebe nulo, e a consulta nem roda', async () => {
    const { servico, de } = montar();
    // Preset da Triagem: escalas SEM_ACESSO.
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM));
    expect(r.equipeHoje).toBeNull();
    expect(de('escalaAdvogado.findMany')).toHaveLength(0);
  });

  it('a matriz manda: Triagem com escala na matriz própria recebe', async () => {
    const { servico, de } = montar();
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM, { escalas: 'VISUALIZAR' }));
    expect(r.equipeHoje).toEqual({ plantaoHoje: [], proximoPlantao: null });
    expect(de('escalaAdvogado.findMany')).toHaveLength(2);
  });
});

describe('a carga da equipe', () => {
  const { PENDENTE } = StatusCompromisso;
  const ABERTAS = [
    // Bruno responde; Ana foi posta na equipe por gente — conta para os dois.
    { responsavelId: 'b', inicio: br('2026-09-14T09:00:00'), status: PENDENTE, equipe: [{ usuarioId: 'a', origem: null }] },
    // Ana é só reserva do robô: não conta para ela.
    { responsavelId: 'b', inicio: br('2026-09-16T09:00:00'), status: PENDENTE, equipe: [{ usuarioId: 'a', origem: ORIGEM_RESERVA }] },
    { responsavelId: 'b', inicio: br('2026-09-10T09:00:00'), status: PENDENTE, equipe: [] },
    { responsavelId: 'a', inicio: br('2026-09-17T09:00:00'), status: PENDENTE, equipe: [] },
    // Conta desativada: o banco não a devolve em `user.findMany`, e ela sai.
    { responsavelId: 'c', inicio: br('2026-09-17T09:00:00'), status: PENDENTE, equipe: [] },
  ];
  const PESSOAS = [
    { id: 'b', nome: 'Bruno Alves', nomeExibicao: null, avatarUrl: null, avatarKey: null, ultimoLoginEm: br('2026-09-15T08:00:00') },
    // Ana vem primeiro com MENOS atrasadas: a ordem é do nome, não do atraso.
    { id: 'a', nome: 'Ana Lima', nomeExibicao: null, avatarUrl: null, avatarKey: null, ultimoLoginEm: null },
  ];

  it('soma pela régua daPessoa, com a atrasada do dia que virou, em ordem alfabética', async () => {
    const { servico, de } = montar({
      'compromisso.findMany': (args) => (args.select === SELECAO_DAS_ABERTAS ? ABERTAS : []),
      'user.findMany': () => PESSOAS,
    });
    const r: any = await servico.resumo(usuario(UserRole.COORDENACAO));
    expect(r.cargaEquipe.map((c: any) => [c.advogado.id, c.abertas, c.atrasadas])).toEqual([
      ['a', 2, 1],
      ['b', 3, 2],
    ]);
    // O login não vaza dentro do objeto da pessoa.
    expect(r.cargaEquipe[0].advogado).not.toHaveProperty('ultimoLoginEm');
    const leitura = de('compromisso.findMany').find((c) => c.args.select === SELECAO_DAS_ABERTAS)!;
    expect(leitura.args.where).toEqual(recorteAberto());
    // Os dois agrupamentos por responsável saíram.
    expect(de('compromisso.groupBy')).toHaveLength(0);
  });

  it('não roda para quem não recebe a carga', async () => {
    // Só a leitura da carga devolveria linhas; as outras listas ficam vazias.
    const { servico, de } = montar({
      'compromisso.findMany': (args) => (args.select === SELECAO_DAS_ABERTAS ? ABERTAS : []),
    });
    const r: any = await servico.resumo(usuario(UserRole.ADVOGADO, null, 'a'));
    expect(r.cargaEquipe).toBeNull();
    expect(de('compromisso.findMany').filter((c) => c.args.select === SELECAO_DAS_ABERTAS)).toHaveLength(0);
  });
});

describe('o cartão de atendimentos pendentes', () => {
  const consulta = (p: Record<string, unknown>) => ({
    id: 'c1',
    tipo: 'CONSULTA_JURIDICA',
    status: 'PENDENTE',
    inicio: br('2026-09-17T10:00:00'),
    local: 'Por chamada de vídeo',
    linkReuniao: 'https://meet.google.com/abc-defg-hij',
    origemDesfechoId: null,
    createdAt: br('2026-09-14T10:00:00'),
    responsavel: { id: 'adv1', nome: 'Dra. Shérad', nomeExibicao: null },
    ...p,
  });
  const PENDENTES = [
    { id: 'marcada', numero: 3, canal: 'WHATSAPP', status: 'PENDENTE', desfecho: 'ENCAMINHADO', atendentePorId: 'u-balcao', createdAt: br('2026-09-15T09:00:00'), filiado: { id: 'f3', nomeCompleto: 'C' }, compromissos: [consulta({})] },
    { id: 'atendida', numero: 2, canal: 'PRESENCIAL', status: 'PENDENTE', desfecho: 'ENCAMINHADO', atendentePorId: 'u-outra', createdAt: br('2026-09-14T09:00:00'), filiado: { id: 'f2', nomeCompleto: 'B' }, compromissos: [consulta({ status: 'CONCLUIDO', inicio: br('2026-09-14T11:00:00') })] },
    { id: 'sem-desfecho', numero: 1, canal: 'TELEFONE', status: 'PENDENTE', desfecho: null, atendentePorId: 'u-balcao', createdAt: br('2026-09-12T09:00:00'), filiado: { id: 'f1', nomeCompleto: 'A' }, compromissos: [] },
  ];
  /** A leitura da lista do cartão é a que carrega o filiado; a da contagem das filas, não. */
  const daLista = (c: { args: any }) => c.args.where?.status === 'PENDENTE' && !!c.args.select?.filiado;
  const daContagem = (c: { args: any }) => c.args.where?.status === 'PENDENTE' && !c.args.select?.filiado;

  it('traz o estado da consulta, na ordem de quem pede alguém, sem as consultas cruas', async () => {
    const { servico, de } = montar({
      'atendimento.findMany': (args) => (args.where?.status === 'PENDENTE' ? PENDENTES : []),
    });
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM));
    expect(r.atendimentosPendentes.map((a: any) => a.id)).toEqual(['sem-desfecho', 'atendida', 'marcada']);
    expect(r.atendimentosPendentes[1].encaminhamento.estado).toBe('ATENDIDA');
    expect(r.atendimentosPendentes[2].encaminhamento).toMatchObject({
      estado: 'AGENDADA',
      compromissoId: 'c1',
      linkReuniao: 'https://meet.google.com/abc-defg-hij',
    });
    for (const a of r.atendimentosPendentes) expect(a).not.toHaveProperty('compromissos');
    // Âmbar só na fila da triagem: a marcada para quinta aguarda a consulta (E3).
    expect(r.atendimentosPendentes.map((a: any) => a.fila)).toEqual([
      { fila: 'TRIAGEM', motivo: 'SEM_DESFECHO' },
      { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' },
      { fila: 'CONSULTA', motivo: 'AGUARDANDO' },
    ]);

    const leitura = de('atendimento.findMany').find(daLista)!;
    // Só a consulta que nasceu do atendimento — o seguimento herda o id.
    expect(leitura.args.select.compromissos.where).toEqual({ origemDesfechoId: null });
    expect(leitura.args.take).toBe(50);
  });

  it('quem não tem o módulo de atendimentos não recebe a lista; os contadores continuam', async () => {
    // O tempo médio da triagem também lê atendimentos; só a lista do cartão teria linhas.
    const { servico, de } = montar({
      'atendimento.findMany': (args) => (args.where?.status === 'PENDENTE' ? PENDENTES : []),
    });
    const r: any = await servico.resumo(usuario(UserRole.COORDENACAO, { atendimentos: 'SEM_ACESSO' }));
    expect(r.atendimentosPendentes).toEqual([]);
    expect(de('atendimento.findMany').filter(daLista)).toHaveLength(0);
    expect(de('atendimento.count').some((c) => c.args.where?.status === 'PENDENTE')).toBe(true);
    expect(r.kpis).toMatchObject({ atendimentosComATriagem: 2, atendimentosAguardandoConsulta: 1 });
  });

  it('os KPIs contam as duas filas de todos os pendentes; o balcão conta só a fila da triagem que é sua', async () => {
    const { servico, de } = montar({
      'atendimento.findMany': (args) => (args.where?.status === 'PENDENTE' ? PENDENTES : []),
      'atendimento.count': (args) => (args.where?.status === 'PENDENTE' && !args.where?.atendentePorId ? 3 : 0),
    });
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM, null, 'u-balcao'));
    // O antigo continua por uma versão; a soma das filas é ele.
    expect(r.kpis).toMatchObject({ atendimentosPendentes: 3, atendimentosComATriagem: 2, atendimentosAguardandoConsulta: 1 });
    // Do balcão: a sem desfecho é dela; a marcada é dela, mas aguarda a consulta.
    expect(r.minhaTriagem).toMatchObject({ comATriagem: 1, semDesfecho: 1 });

    const contagem = de('atendimento.findMany').find(daContagem)!;
    expect(contagem.args.take).toBeUndefined();
    expect(contagem.args.select.compromissos.where).toEqual({ origemDesfechoId: null });
    // Nenhuma contagem pendente por atendente sobrou: o balcão sai da fila.
    expect(de('atendimento.count').filter((c) => c.args.where?.status === 'PENDENTE' && c.args.where?.atendentePorId)).toHaveLength(0);
  });
});

describe('cadastros a completar', () => {
  const LINHAS = [
    {
      id: 'f1',
      nome: 'MARIA',
      telefone: null,
      telefoneSecundario: '86999887766',
      cpf: null,
      nascimento: br('1980-01-01T00:00:00'),
      motivo: 'ATENDIMENTO',
      linkAtivoAte: br('2026-09-15T15:20:00'),
      respondeuPeloLinkEm: null,
      total: BigInt(16),
    },
  ];

  it('o total vem da mesma consulta, e a linha diz o estado do link', async () => {
    const { servico, consultas } = montar({}, (sql) => (sql.includes('links_recadastramento') ? LINHAS : []));
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM));
    expect(r.cadastrosACompletarTotal).toBe(16);
    expect(r.cadastrosACompletar).toEqual([
      {
        id: 'f1',
        nome: 'MARIA',
        motivo: 'ATENDIMENTO',
        falta: ['CPF'],
        temCelular: true,
        linkAtivoAte: br('2026-09-15T15:20:00'),
        respondeuPeloLinkEm: null,
      },
    ]);
    const sql = consultas.find((c) => c.sql.includes('links_recadastramento'))!;
    // "Ativo" é comparado com o mesmo instante do resto do painel.
    expect(sql.valores).toContainEqual(AGORA);
  });

  it('quem não edita filiado não recebe a fila, e a consulta não roda', async () => {
    const { servico, consultas } = montar({}, () => LINHAS);
    const r: any = await servico.resumo(usuario(UserRole.ADVOGADO));
    expect(r.cadastrosACompletar).toEqual([]);
    expect(r.cadastrosACompletarTotal).toBe(0);
    expect(consultas.some((c) => c.sql.includes('links_recadastramento'))).toBe(false);
  });
});

describe('a linha de resumo do DataJud fica fora das contas das fontes', () => {
  it('saúde das fontes e falhas das 24h cortam a linha de resumo', async () => {
    const { servico, consultas } = montar();
    await servico.resumo(usuario(UserRole.ADMINISTRADOR));
    const saude = consultas.find((c) => c.sql.includes('GROUP BY fonte'))!;
    const falhas = consultas.find((c) => c.sql.includes('DISTINCT ON'))!;
    expect(saude.valores).toContain(SO_CHAMADAS_AO_TRIBUNAL);
    expect(falhas.valores).toContain(SO_CHAMADAS_AO_TRIBUNAL);
  });
});

/*
  O ROBÔ E A LINHA DE RESUMO QUE FALHOU (revisão de 13/09/2026).

  `logSincronizacaoDatajud.findFirst` aplica o `where` que o serviço mandou a
  linhas de verdade, com a regra do banco para coluna nula, e devolve a mais
  recente. Campo que o avaliador não conhece quebra o teste.
*/
describe('a situação do robô do DataJud', () => {
  const HORA = 3_600_000;
  const log = (horasAtras: number, p: Record<string, unknown>) => ({
    fonte: 'DATAJUD',
    processoId: 'p1',
    numeroCNJ: '0801234-56.2024.8.18.0001',
    sucesso: true,
    createdAt: new Date(AGORA.getTime() - horasAtras * HORA),
    ...p,
  });
  const RESUMO = { processoId: null, numeroCNJ: null };

  const casaLog = (l: Record<string, any>, w: Record<string, any>): boolean =>
    Object.entries(w).every(([campo, cond]) => {
      if (campo === 'AND') return (cond as any[]).every((x) => casaLog(l, x));
      if (campo === 'OR') return (cond as any[]).some((x) => casaLog(l, x));
      if (!['fonte', 'processoId', 'numeroCNJ', 'sucesso'].includes(campo)) {
        throw new Error(`O avaliador do teste não conhece o campo "${campo}".`);
      }
      if (cond !== null && typeof cond === 'object') {
        if (Object.keys(cond).join() !== 'not') throw new Error(`Operador desconhecido em "${campo}".`);
        return l[campo] !== null && l[campo] !== cond.not;
      }
      return l[campo] === cond;
    });

  const roboCom = async (linhas: Record<string, any>[]) => {
    const { servico } = montar({
      'processo.count': () => 5,
      'logSincronizacaoDatajud.findFirst': (args) =>
        linhas
          .filter((l) => casaLog(l, args.where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
    });
    const r: any = await servico.resumo(usuario(UserRole.ADMINISTRADOR));
    return r.robo;
  };

  it('"Rodada interrompida" não conta como rodou: a última leitura é a de 40 h atrás, e o aviso é ATRASADO', async () => {
    const robo = await roboCom([
      log(8, { ...RESUMO, sucesso: false }),
      log(40, {}),
      // O DJEN roda na mesma tabela e não fala da varredura das 02h.
      log(1, { ...RESUMO, fonte: 'DJEN' }),
    ]);
    expect(robo.situacao).toBe('ATRASADO');
    expect(robo.ultimaSincronizacao).toEqual(new Date(AGORA.getTime() - 40 * HORA));
  });

  it('"Rodada sem alvo" (sucesso) conta como rodou', async () => {
    const robo = await roboCom([log(8, { ...RESUMO, sucesso: true }), log(40, {})]);
    expect(robo.situacao).toBe('EM_DIA');
  });

  it('a linha de um processo que o CNJ recusou continua dizendo que o robô rodou', async () => {
    const robo = await roboCom([log(8, { sucesso: false }), log(40, {})]);
    expect(robo.situacao).toBe('EM_DIA');
    expect(robo.ultimaComSucesso).toBe(false);
  });
});

describe('a saúde das fontes e a rodada sem nada a consultar', () => {
  const HORA = 3_600_000;
  const DATAJUD = (p: Record<string, unknown>) => ({
    fonte: 'DATAJUD',
    ok24: BigInt(0),
    falhas24: BigInt(0),
    // Sábado, 05/09: dias úteis de sobra até terça, 15/09.
    ultimo_sucesso: br('2026-09-05T02:00:00'),
    ultima_falha: null,
    ultimo_erro: null,
    ultima_rodada_ok: null,
    ...p,
  });
  const saude = async (linha: Record<string, unknown>) => {
    const { servico, consultas } = montar({}, (sql) => (sql.includes('GROUP BY fonte') ? [linha] : []));
    const r: any = await servico.resumo(usuario(UserRole.COORDENACAO));
    return { fonte: r.integracoes[0], consulta: consultas.find((c) => c.sql.includes('GROUP BY fonte'))! };
  };

  it('rodou há 8 h sem alvo e sem chamada: não é "não executou"', async () => {
    const { fonte } = await saude(DATAJUD({ ultima_rodada_ok: new Date(AGORA.getTime() - 8 * HORA) }));
    expect(fonte.situacao).toBe('SEM_USO');
  });

  it('sem rodada sem alvo, ou com ela antiga, continua NAO_RODOU', async () => {
    expect((await saude(DATAJUD({}))).fonte.situacao).toBe('NAO_RODOU');
    expect((await saude(DATAJUD({ ultima_rodada_ok: br('2026-09-05T02:00:00') }))).fonte.situacao).toBe('NAO_RODOU');
  });

  it('com chamadas que falharam, a rodada sem alvo não esconde a PARADA', async () => {
    const { fonte } = await saude(
      DATAJUD({ falhas24: BigInt(3), ultima_rodada_ok: new Date(AGORA.getTime() - 8 * HORA) }),
    );
    expect(fonte.situacao).toBe('PARADA');
  });

  it('só a "Rodada sem alvo" responde: a pulada pela trava também é sucesso, e não entra', async () => {
    const { consulta } = await saude(DATAJUD({}));
    expect(consulta.sql).toContain('r.processo_id IS NULL');
    expect(consulta.sql).toContain('r.numero_cnj IS NULL');
    expect(consulta.sql).toContain('r.mensagem_erro LIKE ?');
    expect(consulta.valores).toContain(`${PREFIXO_RODADA_SEM_ALVO}%`);
    // As contas continuam sem a linha de resumo.
    expect(consulta.valores).toContain(SO_CHAMADAS_AO_TRIBUNAL);

    // A frase nasce no robô: se ela mudar lá, este teste reprova aqui.
    const semAlvo = linhaDeResumoDatajud({ elegiveis: 0, ok: 0, comNovas: 0, novas: 0, falhas: 0, quebrou: null });
    expect(semAlvo.sucesso).toBe(true);
    expect(semAlvo.mensagemErro.startsWith(PREFIXO_RODADA_SEM_ALVO)).toBe(true);
    const pulada = linhaDeResumoDatajud({ pulada: true });
    expect(pulada.sucesso).toBe(true);
    expect(pulada.mensagemErro.startsWith(PREFIXO_RODADA_SEM_ALVO)).toBe(false);
  });
});

describe('as listas cortadas por módulo que faltavam', () => {
  const MOVIMENTACOES = [
    { id: 'm1', descricao: 'Conclusos para despacho', dataMovimento: br('2026-09-14T10:00:00'), processo: { id: 'p1', numeroCNJ: '0801234-56.2024.8.18.0001', filiado: { nomeCompleto: 'MARIA' } } },
  ];
  const CONTATO = [{ id: 'k1', titulo: 'Avisar filiada da audiência', tipo: 'CONTATO' }];
  const impl: Impl = {
    'movimentacaoProcessual.findMany': () => MOVIMENTACOES,
    'compromisso.findMany': (args) => (args.where?.tipo === 'CONTATO' ? CONTATO : []),
  };

  it('quem não vê Processos não recebe as movimentações, e a consulta não roda', async () => {
    const { servico, de } = montar(impl);
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM));
    expect(r.movimentacoesRecentes).toEqual([]);
    expect(de('movimentacaoProcessual.findMany')).toHaveLength(0);

    const adv = montar(impl);
    const rAdv: any = await adv.servico.resumo(usuario(UserRole.ADVOGADO));
    expect(rAdv.movimentacoesRecentes).toEqual(MOVIMENTACOES);
  });

  it('quem não vê a Agenda não recebe as tarefas de contato; com a agenda, recebe', async () => {
    const semAgenda = montar(impl);
    const r: any = await semAgenda.servico.resumo(usuario(UserRole.COORDENACAO, { agenda: 'SEM_ACESSO' }));
    expect(r.contatosHoje).toEqual([]);
    expect(semAgenda.de('compromisso.findMany').filter((c) => c.args.where?.tipo === 'CONTATO')).toHaveLength(0);

    const comAgenda = montar(impl);
    const rTri: any = await comAgenda.servico.resumo(usuario(UserRole.TRIAGEM));
    expect(rTri.contatosHoje).toEqual(CONTATO);
  });
});

describe('o selo de "Audiências da semana" conta o que o "Ver" abre', () => {
  const contando = (esperado: unknown, n: number): Impl => ({
    'compromisso.count': (args) => (JSON.stringify(args.where) === JSON.stringify(esperado) ? n : 0),
  });

  it('advogado: aba=7dias&tipo=AUDIENCIA&pessoa=eu, o mesmo número do cartão "Minhas audiências"', async () => {
    const onde = wheresDoPainel(daPessoa('adv1'), AGORA).audienciasSemanaTotal;
    const { servico } = montar(contando(onde, 4));
    const r: any = await servico.resumo(usuario(UserRole.ADVOGADO, null, 'adv1'));
    expect(r.audienciasSemanaTotal).toBe(4);
    expect(r.minhaCarteira.minhasAudiencias).toBe(4);
  });

  it('gestão: aba=7dias&tipo=AUDIENCIA, a casa inteira', async () => {
    const onde = wheresDoPainel({}, AGORA).audienciasSemanaTotal;
    const { servico } = montar(contando(onde, 9));
    const r: any = await servico.resumo(usuario(UserRole.COORDENACAO));
    expect(r.audienciasSemanaTotal).toBe(9);
  });
});

describe('as atividades do painel', () => {
  it('os contadores do advogado são os recortes que os links abrem', async () => {
    const { servico, de } = montar();
    await servico.resumo(usuario(UserRole.ADVOGADO, null, 'adv1'));
    const painel = wheresDoPainel(daPessoa('adv1'), AGORA);
    const contados = de('compromisso.count').map((c) => c.args.where);
    for (const chave of ['atrasadas', 'passaramDaHora', 'prazosSemana', 'urgentes', 'minhasAudiencias'] as const) {
      expect(contados).toContainEqual(painel[chave]);
    }
  });

  it('as atrasadas da fila vêm até 12, com a ação a cadastrar', async () => {
    const { servico, de } = montar();
    await servico.resumo(usuario(UserRole.ADVOGADO, null, 'adv1'));
    const painel = wheresDoPainel(daPessoa('adv1'), AGORA);
    const fila = de('compromisso.findMany').find(
      (c) => JSON.stringify(c.args.where) === JSON.stringify(painel.atrasadas),
    )!;
    expect(fila.args.take).toBe(12);
    expect(fila.args.select.sugestaoDeCadastro).toEqual({ select: { numeroCNJ: true } });
    expect(fila.args.select.processo.select.partes).toBeDefined();
    expect(fila.args.select.linkReuniao).toBe(true);
  });

  /* A Triagem tem agenda, mas não Processos: o cartão sai sem quem litiga. */
  it('quem não vê Processos recebe o cartão sem partes e sem a ação a cadastrar', async () => {
    const { servico, de } = montar();
    await servico.resumo(usuario(UserRole.TRIAGEM));
    const listas = de('compromisso.findMany').filter((c) => c.args.select?.titulo);
    expect(listas.length).toBeGreaterThanOrEqual(4);
    for (const l of listas) {
      if (l.args.select.processo) expect(l.args.select.processo.select).not.toHaveProperty('partes');
      expect(l.args.select.sugestaoDeCadastro).toBe(false);
    }
  });
});

/**
 * O ROBÔ É ASSUNTO DE QUEM VÊ PROCESSO (18/09/2026).
 *
 * `robo` ia para TODO MUNDO, sem condição, e leva duas listas com NPU, tribunal
 * e o NOME DO FILIADO: `falhasProcessos` e `desconhecidosNoCnj`. A Triagem tem
 * `processos: SEM_ACESSO`; a tela dela escondia o bloco e o payload chegava
 * inteiro no navegador. Esconder na tela é conforto, não controle de acesso.
 *
 * Este teste olha o PAYLOAD. O que existia era um `toContain` no próprio
 * arquivo-fonte, que continuou verde com o vazamento no ar.
 */
describe('o robô e as listas do CNJ se cortam no servidor', () => {
  it('a Triagem recebe nulo, e as duas consultas nem rodam', async () => {
    const { servico, de, consultas } = montar();
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM));
    expect(r.robo).toBeNull();
    // `falhasDatajud24h` e `processosDesconhecidosNoCnj` são SQL cru.
    const cnj = consultas.filter((c) => /sincronizacao_logs|sincronizacoes/i.test(c.sql));
    expect(cnj).toHaveLength(0);
    expect(de('processo.count')).toHaveLength(0);
  });

  it('nenhum NPU e nenhum nome de filiado atravessam o payload da Triagem', async () => {
    const { servico } = montar();
    const r = await servico.resumo(usuario(UserRole.TRIAGEM));
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('desconhecidosNoCnj');
    expect(texto).not.toContain('falhasProcessos');
  });

  it('o advogado recebe o bloco — ele vê processo e conserta sincronização', async () => {
    const { servico } = montar();
    const r: any = await servico.resumo(usuario(UserRole.ADVOGADO));
    expect(r.robo).not.toBeNull();
    expect(r.robo).toHaveProperty('situacao');
  });

  it('a matriz manda: Triagem com processos liberado passa a receber', async () => {
    const { servico } = montar();
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM, { processos: 'VISUALIZAR' }));
    expect(r.robo).not.toBeNull();
  });
});

/**
 * "MOVIMENTAÇÕES RECENTES" MOSTRAVA O ACERVO DOS COLEGAS.
 *
 * A consulta não tinha `meuAcervo` — que existe e é aplicado nos vizinhos
 * (adversários, DJEN, audiências a agendar). O advogado lia oito andamentos de
 * processos que não são dele, com o nome do filiado de cada um.
 */
describe('as movimentações recentes respeitam o escopo pessoal', () => {
  it('para o advogado, a consulta filtra pelo acervo dele', async () => {
    const { servico, de } = montar();
    await servico.resumo(usuario(UserRole.ADVOGADO, null, 'adv-1'));
    const [chamada] = de('movimentacaoProcessual.findMany');
    expect(chamada.args.where.processo).toEqual({ advogados: { some: { advogadoId: 'adv-1' } } });
  });

  it('para a coordenação, segue sendo a casa inteira', async () => {
    const { servico, de } = montar();
    await servico.resumo(usuario(UserRole.COORDENACAO));
    const [chamada] = de('movimentacaoProcessual.findMany');
    expect(chamada.args.where.processo).toEqual({});
  });
});

/**
 * O GRÁFICO DO DIÁRIO NO PAYLOAD — 18/09/2026.
 *
 * Provado aqui, e não no texto do arquivo: o furo do `robo` (NPU, tribunal e
 * nome de filiado indo para a Triagem, que tem `processos: SEM_ACESSO`) passou
 * meses com um teste verde que só conferia se a linha existia no fonte.
 */
describe('o movimento no Diário', () => {
  /*
    O DJEN LIGADO PELA VARIÁVEL, e não pelo tenant — senão este bloco inteiro
    só valeria no SENATEPI. O SINDSERM não declara a integração, e no job dele
    os quatro testes caíam com "Cannot read properties of null": é a CI
    vermelha crônica de sempre, teste que afirma um cliente. `integracaoAtiva`
    dá precedência à variável, então aqui ela decide para os dois.

    E ela fica ligada TAMBÉM no teste da Triagem, de propósito: nulo com o DJEN
    desligado não prova nada sobre permissão.
  */
  const antes = process.env.DJEN_INTEGRACAO;
  beforeAll(() => { process.env.DJEN_INTEGRACAO = '1'; });
  afterAll(() => {
    if (antes === undefined) delete process.env.DJEN_INTEGRACAO;
    else process.env.DJEN_INTEGRACAO = antes;
  });

  const PUBS = [
    // Duas cópias do mesmo ato — o DJEN manda uma por destinatário.
    { link: 'l1', providencia: 'AVALIAR_RECURSO', dataDisponibilizacao: new Date('2026-09-14T00:00:00.000Z') },
    { link: 'l1', providencia: 'AVALIAR_RECURSO', dataDisponibilizacao: new Date('2026-09-14T00:00:00.000Z') },
    { link: 'l2', providencia: 'NENHUMA', dataDisponibilizacao: new Date('2026-09-07T00:00:00.000Z') },
  ];
  const comPublicacoes = (role: UserRole, permissoes: unknown = null) =>
    montar({
      'comunicacaoDjen.findMany': (args: any) =>
        args?.select?.providencia && args?.select?.link && !args?.select?.texto ? PUBS : [],
    }).servico.resumo(usuario(role, permissoes));

  it('o advogado recebe as oito semanas, sem as cópias', async () => {
    const r: any = await comPublicacoes(UserRole.ADVOGADO);
    expect(r.movimentoNoDiario.total).toBe(2);
    expect(r.movimentoNoDiario.semanas).toHaveLength(8);
    expect(r.movimentoNoDiario.escopo).toBe('PESSOAL');
    /* A semana de uma coluna `date` não anda para trás: 14/09 é segunda. */
    expect(r.movimentoNoDiario.semanas.at(-1)).toEqual({ semana: '2026-09-14', total: 1 });
  });

  it('o edital conta como ato e não entra na lista do que pediram', async () => {
    const r: any = await comPublicacoes(UserRole.ADVOGADO);
    expect(r.movimentoNoDiario.providencias).toEqual([{ chave: 'AVALIAR_RECURSO', total: 1 }]);
  });

  /** Gestão vê a casa: mesmo bloco, outro rótulo — o título muda com o escopo. */
  it('quem não tem carteira recebe o escopo GLOBAL', async () => {
    const r: any = await comPublicacoes(UserRole.ADMINISTRADOR);
    expect(r.movimentoNoDiario.escopo).toBe('GLOBAL');
  });

  /**
   * O CORTE É NO SERVIDOR. A Triagem tem `processos: SEM_ACESSO`: recebe NULO,
   * e a consulta das oito semanas nem chega a rodar.
   */
  it('a Triagem recebe nulo, e a consulta não acontece', async () => {
    const { servico, de } = montar();
    const r: any = await servico.resumo(usuario(UserRole.TRIAGEM));
    expect(r.movimentoNoDiario).toBeNull();
    expect(
      de('comunicacaoDjen.findMany').filter((c) => c.args?.select?.providencia),
    ).toHaveLength(0);
  });

  it('a matriz manda: Triagem com processos liberado passa a receber', async () => {
    const r: any = await comPublicacoes(UserRole.TRIAGEM, { processos: 'VISUALIZAR' });
    expect(r.movimentoNoDiario).not.toBeNull();
    expect(r.movimentoNoDiario.escopo).toBe('GLOBAL');
  });
});
