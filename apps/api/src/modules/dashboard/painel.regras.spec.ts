import { StatusCompromisso, UserRole } from '@prisma/client';
import { AgendaService, type Leitor } from '../agenda/agenda.service';
import { ORIGEM_RESERVA, daPessoa } from '../agenda/equipe.util';
import { limitesDoDia } from '../agenda/recortes.util';
import { situacaoDoEncaminhamento, type ConsultaDoEncaminhamento } from '../atendimentos/encaminhamento.util';
import { contarAbertasPorPessoa } from '../relatorios/abertas-da-pessoa.util';
import {
  SO_CHAMADAS_AO_TRIBUNAL,
  cartaoDeAtendimentosPendentes,
  contarFilas,
  emOrdemAlfabetica,
  grupoDoAtendimento,
  itemDoCadastroACompletar,
  wheresDoPainel,
} from './painel.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * AS REGRAS DO PAINEL, PROVADAS COM LINHAS.
 *
 * O avaliador aplica o `where` do Prisma a uma lista em memória, com a regra do
 * banco para coluna nula (`{ not: X }` não traz a linha nula). Campo que ele não
 * conhece QUEBRA o teste, em vez de passar calado.
 */
const br = (local: string) => new Date(`${local}-03:00`);

interface Membro {
  usuarioId: string;
  origem: string | null;
  principal: boolean;
}

interface Linha {
  id: string;
  tipo: string;
  status: StatusCompromisso;
  inicio: Date;
  urgente: boolean;
  responsavelId: string;
  equipe: Membro[];
}

function casaValor(valor: any, cond: any): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
    return valor instanceof Date && cond instanceof Date ? valor.getTime() === cond.getTime() : valor === cond;
  }
  return Object.entries(cond).every(([op, v]: [string, any]) => {
    switch (op) {
      case 'in':
        return valor !== null && v.includes(valor);
      case 'notIn':
        return valor !== null && !v.includes(valor);
      // No SQL, `coluna <> X` é NULO quando a coluna é nula, e a linha some.
      case 'not':
        return valor !== null && valor !== v;
      case 'lt':
        return valor < v;
      case 'lte':
        return valor <= v;
      case 'gt':
        return valor > v;
      case 'gte':
        return valor >= v;
      default:
        throw new Error(`O avaliador do teste não conhece o operador "${op}".`);
    }
  });
}

function casa(l: Record<string, any>, w: Record<string, any>): boolean {
  return Object.entries(w).every(([campo, cond]) => {
    if (campo === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((x) => casa(l, x));
    if (campo === 'OR') return (cond as any[]).some((x) => casa(l, x));
    if (campo === 'equipe') {
      if (!cond.some) throw new Error('O avaliador só conhece `equipe: { some }`.');
      return (l.equipe as Membro[]).some((m) => casa(m, cond.some));
    }
    if (!(campo in l)) throw new Error(`O avaliador do teste não conhece o campo "${campo}".`);
    return casaValor(l[campo], cond);
  });
}

const { PENDENTE, EM_ANDAMENTO, CONCLUIDO, CANCELADO } = StatusCompromisso;
const EU = 'adv1';
const COLEGA = 'adv2';

const linha = (id: string, p: Partial<Linha>): Linha => ({
  id,
  tipo: 'PRAZO',
  status: PENDENTE,
  inicio: br('2026-09-13T09:00:00'),
  urgente: false,
  responsavelId: EU,
  equipe: [],
  ...p,
});

const ACERVO: Linha[] = [
  linha('a-prazo-ontem', { inicio: br('2026-09-12T10:00:00') }),
  linha('b-prazo-hoje-22h', { inicio: br('2026-09-13T22:00:00') }),
  linha('c-audiencia-dia-16-na-equipe', {
    tipo: 'AUDIENCIA',
    inicio: br('2026-09-16T10:00:00'),
    responsavelId: COLEGA,
    equipe: [{ usuarioId: EU, origem: null, principal: false }],
  }),
  linha('d-prazo-ontem-sou-reserva', {
    inicio: br('2026-09-12T15:00:00'),
    responsavelId: COLEGA,
    equipe: [{ usuarioId: EU, origem: ORIGEM_RESERVA, principal: false }],
  }),
  linha('e-prazo-concluido-hoje', { status: CONCLUIDO, inicio: br('2026-09-13T09:00:00') }),
  linha('f-audiencia-dia-21', { tipo: 'AUDIENCIA', inicio: br('2026-09-21T09:00:00') }),
  linha('g-audiencia-dia-20-23h', { tipo: 'AUDIENCIA', inicio: br('2026-09-20T23:00:00') }),
  linha('h-consulta-urgente-de-junho', {
    tipo: 'CONSULTA_JURIDICA',
    inicio: br('2026-06-01T09:00:00'),
    urgente: true,
  }),
  linha('i-reuniao-urgente-cancelada', { tipo: 'REUNIAO', status: CANCELADO, urgente: true }),
  linha('j-prazo-hoje-23h45', { inicio: br('2026-09-13T23:45:00') }),
  linha('k-diligencia-amanha-do-colega', {
    tipo: 'DILIGENCIA',
    status: EM_ANDAMENTO,
    inicio: br('2026-09-14T09:00:00'),
    responsavelId: COLEGA,
  }),
  linha('l-prazo-amanha-00h10', { inicio: br('2026-09-14T00:10:00') }),
];

/** 23h30 de 13/09 em Teresina — no UTC, já é dia 14. */
const NOITE = br('2026-09-13T23:30:00');
/** 00h30 de 14/09 em Teresina. */
const MADRUGADA = br('2026-09-14T00:30:00');

const ids = (w: Record<string, any>) => ACERVO.filter((l) => casa(l, w)).map((l) => l.id).sort();

/** O que a AGENDA de verdade filtra para uma URL — o `where` do `listar`, capturado. */
async function oQueOLinkAbre(q: Record<string, string>, leitor: Leitor): Promise<string[]> {
  const findMany = jest.fn(async () => []);
  const prisma: any = new Proxy(
    {},
    { get: (_a, modelo) => (modelo === 'compromisso' ? { findMany } : undefined) },
  );
  const agenda = new AgendaService(prisma, { registrar: jest.fn() } as never, {} as never);
  await agenda.listar(q as never, leitor);
  const where = (findMany.mock.calls[0] as any[])[0].where;
  return ids(where);
}

const ADVOGADO: Leitor = { id: EU, role: UserRole.ADVOGADO, permissoes: null };
const GESTAO: Leitor = { id: 'admin', role: UserRole.ADMINISTRADOR, permissoes: null };
/** A régua de verdade — é ela que o serviço passa como `meu` para o advogado. */
const meuDoAdvogado = daPessoa(EU);

describe('cada número do painel conta o que o link dele abre na agenda (C11)', () => {
  afterEach(() => jest.useRealTimers());

  /*
    Os dois lados são calculados de verdade: o painel pela função que o serviço
    usa, a agenda pelo `listar` dela. As listas esperadas vão escritas por
    extenso — igualdade entre dois conjuntos vazios passaria sem provar nada.
  */
  it('"Atrasadas" = aba=atrasadas&pessoa=eu, sem a tarefa em que sou reserva', async () => {
    jest.useFakeTimers({ now: NOITE });
    const painel = wheresDoPainel(meuDoAdvogado, NOITE);
    expect(ids(painel.atrasadas)).toEqual(['a-prazo-ontem', 'h-consulta-urgente-de-junho']);
    expect(await oQueOLinkAbre({ recorte: 'atrasadas', pessoa: 'eu' }, ADVOGADO)).toEqual(ids(painel.atrasadas));
  });

  it('atrasadas + passaram da hora = aba=atencao', async () => {
    jest.useFakeTimers({ now: NOITE });
    const painel = wheresDoPainel(meuDoAdvogado, NOITE);
    expect(ids(painel.passaramDaHora)).toEqual(['b-prazo-hoje-22h']);
    const soma = [...ids(painel.atrasadas), ...ids(painel.passaramDaHora)].sort();
    expect(await oQueOLinkAbre({ recorte: 'atencao', pessoa: 'eu' }, ADVOGADO)).toEqual(soma);
  });

  it('"Minhas audiências" = aba=7dias&tipo=AUDIENCIA&pessoa=eu, com o sétimo dia inteiro', async () => {
    jest.useFakeTimers({ now: NOITE });
    const painel = wheresDoPainel(meuDoAdvogado, NOITE);
    expect(ids(painel.minhasAudiencias)).toEqual(['c-audiencia-dia-16-na-equipe', 'g-audiencia-dia-20-23h']);
    expect(await oQueOLinkAbre({ recorte: '7dias', tipo: 'AUDIENCIA', pessoa: 'eu' }, ADVOGADO)).toEqual(
      ids(painel.minhasAudiencias),
    );
  });

  /*
    O SELO DE "AUDIÊNCIAS DA SEMANA" (revisão de 13/09/2026). Contava a lista
    (abertas de hoje em diante, até 8); o "Ver" abre a aba 7 dias, que traz a
    audiência que ficou para trás e a concluída de hoje.
  */
  it('"Audiências da semana" = aba=7dias&tipo=AUDIENCIA, com e sem pessoa', async () => {
    jest.useFakeTimers({ now: NOITE });
    const doAdvogado = wheresDoPainel(meuDoAdvogado, NOITE).audienciasSemanaTotal;
    expect(ids(doAdvogado)).toEqual(['c-audiencia-dia-16-na-equipe', 'g-audiencia-dia-20-23h']);
    expect(await oQueOLinkAbre({ recorte: '7dias', tipo: 'AUDIENCIA', pessoa: 'eu' }, ADVOGADO)).toEqual(ids(doAdvogado));

    // A casa, com uma audiência de ontem ainda aberta e outra concluída hoje: as duas entram.
    const acervo = [
      ...ACERVO,
      linha('m-audiencia-ontem-aberta', { tipo: 'AUDIENCIA', inicio: br('2026-09-12T09:00:00'), responsavelId: COLEGA }),
      linha('n-audiencia-hoje-concluida', { tipo: 'AUDIENCIA', status: CONCLUIDO, responsavelId: COLEGA }),
    ];
    const daCasa = wheresDoPainel({}, NOITE);
    const naCasa = (w: Record<string, any>) => acervo.filter((l) => casa(l, w)).map((l) => l.id).sort();
    expect(naCasa(daCasa.audienciasSemanaTotal)).toEqual([
      'c-audiencia-dia-16-na-equipe',
      'g-audiencia-dia-20-23h',
      'm-audiencia-ontem-aberta',
      'n-audiencia-hoje-concluida',
    ]);
    // A lista do bloco continua a de antes — o selo é que deixa de contá-la.
    expect(naCasa(daCasa.audienciasSemana)).toEqual(['c-audiencia-dia-16-na-equipe', 'g-audiencia-dia-20-23h']);
  });

  /*
    A URGENTE DE JUNHO. A regra antiga contava só início entre hoje e sete dias:
    a urgente que ficou para trás saía do número e continuava na aba.
  */
  it('"Urgentes" = aba=aberto&urgentes=1&pessoa=eu, inclusive a que ficou para trás', async () => {
    jest.useFakeTimers({ now: NOITE });
    const painel = wheresDoPainel(meuDoAdvogado, NOITE);
    expect(ids(painel.urgentes)).toEqual(['h-consulta-urgente-de-junho']);
    expect(await oQueOLinkAbre({ recorte: 'aberto', urgente: 'true', pessoa: 'eu' }, ADVOGADO)).toEqual(
      ids(painel.urgentes),
    );
  });

  /* A gestão vê a casa: sem pessoa, e a reserva do colega entra (é uma atividade da casa). */
  it('"Prazos esta semana" = aba=7dias&tipo=PRAZO, só prazo', async () => {
    jest.useFakeTimers({ now: NOITE });
    const painel = wheresDoPainel({}, NOITE);
    expect(ids(painel.prazosSemana)).toEqual([
      'a-prazo-ontem',
      'b-prazo-hoje-22h',
      'd-prazo-ontem-sou-reserva',
      'e-prazo-concluido-hoje',
      'j-prazo-hoje-23h45',
      'l-prazo-amanha-00h10',
    ]);
    expect(await oQueOLinkAbre({ recorte: '7dias', tipo: 'PRAZO' }, GESTAO)).toEqual(ids(painel.prazosSemana));
  });

  /*
    A CARGA DA EQUIPE conta pela régua `daPessoa`, somando em memória
    (`contarAbertasPorPessoa`), e o clique abre aba=aberto&pessoa=<id>. Antes era
    `groupBy responsavelId`: a audiência em que estou na equipe não contava para
    mim, e o clique a mostrava.
  */
  it('a carga de cada pessoa bate com aba=aberto e aba=atrasadas da pessoa', async () => {
    jest.useFakeTimers({ now: NOITE });
    const { hojeIni } = limitesDoDia(NOITE);
    const abertas = ACERVO.filter((l) => l.status === PENDENTE || l.status === EM_ANDAMENTO);
    const carga = contarAbertasPorPessoa(abertas, hojeIni);
    for (const pessoa of [EU, COLEGA]) {
      const abertasNoLink = await oQueOLinkAbre({ recorte: 'aberto', pessoa }, GESTAO);
      const atrasadasNoLink = await oQueOLinkAbre({ recorte: 'atrasadas', pessoa }, GESTAO);
      expect(carga.get(pessoa)).toEqual({ abertas: abertasNoLink.length, atrasadas: atrasadasNoLink.length });
    }
    // E os números em si, para a igualdade não ser de dois zeros.
    expect(carga.get(EU)).toEqual({ abertas: 8, atrasadas: 2 });
    expect(carga.get(COLEGA)).toEqual({ abertas: 3, atrasadas: 1 });
  });

  it('o dia é o de Teresina: à meia-noite e meia, as de ontem viraram atrasadas', () => {
    const painel = wheresDoPainel(meuDoAdvogado, MADRUGADA);
    expect(ids(painel.atrasadas)).toEqual([
      'a-prazo-ontem',
      'b-prazo-hoje-22h',
      'h-consulta-urgente-de-junho',
      'j-prazo-hoje-23h45',
    ]);
    expect(ids(painel.passaramDaHora)).toEqual(['l-prazo-amanha-00h10']);
  });

  it('as listas do dia e dos próximos dias não se sobrepõem', () => {
    const casa_ = wheresDoPainel({}, NOITE);
    const hoje = ids(casa_.atividadesHoje);
    const proximas = ids(casa_.proximasAtividades);
    expect(hoje).toEqual([
      'b-prazo-hoje-22h',
      'e-prazo-concluido-hoje',
      'i-reuniao-urgente-cancelada',
      'j-prazo-hoje-23h45',
    ]);
    // Audiência tem bloco próprio; a do dia 21 está fora dos sete dias.
    expect(proximas).toEqual(['k-diligencia-amanha-do-colega', 'l-prazo-amanha-00h10']);
    expect(ids(casa_.audienciasSemana)).toEqual(['c-audiencia-dia-16-na-equipe', 'g-audiencia-dia-20-23h']);
    expect(hoje.filter((id) => proximas.includes(id))).toEqual([]);
  });
});

describe('cadastros a completar', () => {
  const AGORA = br('2026-09-15T10:00:00');
  const base = {
    id: 'f1',
    nome: 'MARIA DA SILVA',
    telefone: null,
    telefoneSecundario: null,
    cpf: '12345678901',
    nascimento: new Date('1980-01-01T00:00:00Z'),
    motivo: 'ATENDIMENTO',
    linkAtivoAte: null,
    respondeuPeloLinkEm: null,
  };

  /* A importação grava o "celular" da planilha no secundário: 383 fichas assim. */
  it('com celular só no secundário, não falta telefone e o WhatsApp vale', () => {
    const item = itemDoCadastroACompletar({ ...base, telefoneSecundario: '(86) 99988-7766' }, AGORA);
    expect(item.falta).toEqual([]);
    expect(item.temCelular).toBe(true);
  });

  it('fixo não é celular, mas também não é "falta telefone"', () => {
    const item = itemDoCadastroACompletar({ ...base, telefone: '(86) 3222-1100' }, AGORA);
    expect(item.falta).toEqual([]);
    expect(item.temCelular).toBe(false);
  });

  it('só espaço é vazio, e a falta sai na ordem em que atrapalha', () => {
    const item = itemDoCadastroACompletar(
      { ...base, telefone: '  ', telefoneSecundario: '', cpf: ' ', nascimento: null },
      AGORA,
    );
    expect(item.falta).toEqual(['telefone', 'CPF', 'nascimento']);
    expect(item.temCelular).toBe(false);
  });

  it('link vivo diz até quando; link que venceu no caminho não aparece como ativo', () => {
    const vivo = itemDoCadastroACompletar({ ...base, linkAtivoAte: br('2026-09-15T15:20:00') }, AGORA);
    expect(vivo.linkAtivoAte).toEqual(br('2026-09-15T15:20:00'));
    const vencido = itemDoCadastroACompletar({ ...base, linkAtivoAte: br('2026-09-15T09:59:00') }, AGORA);
    expect(vencido.linkAtivoAte).toBeNull();
  });

  it('a resposta pelo link passa como veio', () => {
    const item = itemDoCadastroACompletar({ ...base, respondeuPeloLinkEm: br('2026-09-12T18:00:00') }, AGORA);
    expect(item.respondeuPeloLinkEm).toEqual(br('2026-09-12T18:00:00'));
  });

  /* O cartão precisa saber se o botão faz sentido, não qual é o número. */
  it('o número de telefone não viaja na resposta', () => {
    const item = itemDoCadastroACompletar({ ...base, telefone: '86999887766' }, AGORA);
    expect(Object.keys(item).sort()).toEqual(
      ['falta', 'id', 'linkAtivoAte', 'motivo', 'nome', 'respondeuPeloLinkEm', 'temCelular'].sort(),
    );
    expect(JSON.stringify(item)).not.toContain('99887766');
  });
});

describe('o cartão de atendimentos pendentes', () => {
  /** Terça, 15/09, 10h em Teresina. */
  const AGORA = br('2026-09-15T10:00:00');
  const pessoa = { id: 'adv1', nome: 'Dra. Shérad', nomeExibicao: null };
  const consulta = (id: string, p: Partial<ConsultaDoEncaminhamento>): ConsultaDoEncaminhamento => ({
    id,
    status: 'PENDENTE',
    inicio: br('2026-09-17T10:00:00'),
    local: null,
    linkReuniao: null,
    origemDesfechoId: null,
    createdAt: br('2026-09-14T10:00:00'),
    responsavel: pessoa,
    ...p,
  });
  const at = (id: string, criado: string, desfecho: string | null, compromissos: ConsultaDoEncaminhamento[] = []) => ({
    id,
    numero: Number(id.slice(1)),
    desfecho,
    createdAt: br(criado),
    compromissos,
  });

  const ITENS = [
    at('A3', '2026-09-15T09:30:00', 'ENCAMINHADO', [consulta('c3', {})]),
    at('A6', '2026-09-11T09:00:00', 'ENCAMINHADO', [
      consulta('c6', { status: 'CONCLUIDO', inicio: br('2026-09-12T10:00:00') }),
      // O "Retorno ao filiado" herdou o atendimentoId: não é a consulta.
      consulta('s6', { inicio: br('2026-09-20T09:00:00'), origemDesfechoId: 'c6' }),
    ]),
    at('A1', '2026-09-15T09:00:00', null),
    at('A4', '2026-09-13T09:00:00', 'ENCAMINHADO', [consulta('c4', { inicio: br('2026-09-14T10:00:00') })]),
    at('A5', '2026-09-12T09:00:00', 'RESOLVIDO_ATO'),
    at('A2', '2026-09-14T09:00:00', 'ENCAMINHADO', [
      consulta('c2', { status: 'CONCLUIDO', inicio: br('2026-09-14T11:00:00') }),
    ]),
    at('A7', '2026-09-10T09:00:00', null),
  ];

  /*
    Desde 15/09/2026 (E3) a ordem sai da fila. O A4 (consulta de ontem, 14/09,
    sem registro) passou do grupo 1 para o 2: com um dia útil, a consulta ainda
    está com o advogado, e o atraso já aparece na agenda dele.
  */
  it('sem desfecho primeiro; depois a fila da triagem; o que aguarda a consulta por último', () => {
    const cartao = cartaoDeAtendimentosPendentes(ITENS, AGORA, 10);
    expect(cartao.map((a) => a.id)).toEqual(['A1', 'A7', 'A2', 'A5', 'A6', 'A3', 'A4']);
    expect(Object.fromEntries(cartao.map((a) => [a.id, a.fila]))).toEqual({
      A1: { fila: 'TRIAGEM', motivo: 'SEM_DESFECHO' },
      A7: { fila: 'TRIAGEM', motivo: 'SEM_DESFECHO' },
      A2: { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' },
      A5: { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' },
      A6: { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' },
      A3: { fila: 'CONSULTA', motivo: 'AGUARDANDO' },
      A4: { fila: 'CONSULTA', motivo: 'AGUARDANDO' },
    });
  });

  it('dois dias úteis depois, a consulta sem registro volta para a triagem e sobe no cartão', () => {
    const quarta = br('2026-09-16T10:00:00');
    const cartao = cartaoDeAtendimentosPendentes(ITENS, quarta, 10);
    expect(cartao.find((a) => a.id === 'A4')!.fila).toEqual({ fila: 'TRIAGEM', motivo: 'CONSULTA_SEM_REGISTRO' });
    expect(cartao.map((a) => a.id)).toEqual(['A1', 'A7', 'A2', 'A4', 'A5', 'A6', 'A3']);
  });

  it('o corte de seis deixa de fora o que aguarda a consulta, não o que pede a triagem', () => {
    expect(cartaoDeAtendimentosPendentes(ITENS, AGORA).map((a) => a.id)).toEqual([
      'A1',
      'A7',
      'A2',
      'A5',
      'A6',
      'A3',
    ]);
  });

  it('as filas contadas: todos os pendentes, e por atendente só os dele', () => {
    expect(contarFilas(ITENS, AGORA)).toEqual({ comATriagem: 5, aguardandoConsulta: 2 });
    const doBalcao = [
      { ...ITENS[0], atendentePorId: 'u-ivo' }, // A3, aguardando a consulta
      { ...ITENS[2], atendentePorId: 'u-ivo' }, // A1, sem desfecho
      { ...ITENS[5], atendentePorId: 'u-bia' }, // A2, falta concluir
    ];
    expect(contarFilas(doBalcao, AGORA, 'u-ivo')).toEqual({ comATriagem: 1, aguardandoConsulta: 1 });
    expect(contarFilas(doBalcao, AGORA, 'u-bia')).toEqual({ comATriagem: 1, aguardandoConsulta: 0 });
    // Leitura que não filtrou status: o concluído não entra em fila nenhuma.
    expect(contarFilas([{ ...ITENS[2], status: 'CONCLUIDO' }], AGORA)).toEqual({ comATriagem: 0, aguardandoConsulta: 0 });
  });

  it('o estado é o da função da tela de atendimentos, e as consultas cruas não saem', () => {
    const cartao = cartaoDeAtendimentosPendentes(ITENS, AGORA, 10);
    const porId = new Map(cartao.map((a) => [a.id, a]));
    expect(porId.get('A2')!.encaminhamento?.estado).toBe('ATENDIDA');
    expect(porId.get('A4')!.encaminhamento?.estado).toBe('FICOU_PARA_TRAS');
    expect(porId.get('A3')!.encaminhamento?.estado).toBe('AGENDADA');
    // O seguimento aberto não esconde que a consulta foi atendida.
    expect(porId.get('A6')!.encaminhamento?.estado).toBe('ATENDIDA');
    const original = ITENS.find((a) => a.id === 'A6')!;
    expect(porId.get('A6')!.encaminhamento).toEqual(situacaoDoEncaminhamento(original.compromissos, AGORA));
    for (const a of cartao) expect(a).not.toHaveProperty('compromissos');
    // Sem consulta, o campo não vem (é a mesma forma da listagem de atendimentos).
    expect(porId.get('A1')).not.toHaveProperty('encaminhamento');
    expect(porId.get('A5')).not.toHaveProperty('encaminhamento');
  });

  it('os grupos, um a um: sem desfecho, com a triagem, aguardando a consulta', () => {
    expect(grupoDoAtendimento(null, { fila: 'TRIAGEM', motivo: 'SEM_DESFECHO' })).toBe(0);
    expect(grupoDoAtendimento('RESOLVIDO_ATO', { fila: 'TRIAGEM', motivo: 'FALTA_CONCLUIR' })).toBe(1);
    for (const motivo of ['FALTA_CONCLUIR', 'SEM_CONSULTA', 'CONSULTA_CANCELADA', 'CONSULTA_SEM_REGISTRO'] as const) {
      expect(`${motivo}: ${grupoDoAtendimento('ENCAMINHADO', { fila: 'TRIAGEM', motivo })}`).toBe(`${motivo}: 1`);
    }
    expect(grupoDoAtendimento('ENCAMINHADO', { fila: 'CONSULTA', motivo: 'AGUARDANDO' })).toBe(2);
  });
});

describe('a carga da equipe em ordem alfabética (D8)', () => {
  it('pelo nome de exibição, sem ranking, sem mexer na lista recebida', () => {
    const itens = [
      { advogado: { id: '1', nome: 'Zulmira Costa', nomeExibicao: 'Dra. Shérad' }, atrasadas: 5 },
      { advogado: { id: '2', nome: 'Ícaro Sol', nomeExibicao: null }, atrasadas: 0 },
      { advogado: { id: '3', nome: 'Ana Lima', nomeExibicao: null }, atrasadas: 2 },
    ];
    expect(emOrdemAlfabetica(itens).map((i) => i.advogado.id)).toEqual(['3', '1', '2']);
    expect(itens.map((i) => i.advogado.id)).toEqual(['1', '2', '3']);
  });
});

describe('a linha de resumo do DataJud não é chamada ao tribunal', () => {
  it('o corte é só do DataJud, e só da linha sem processo e sem NPU', () => {
    expect(SO_CHAMADAS_AO_TRIBUNAL.sql).toBe(
      "NOT (fonte = 'DATAJUD' AND processo_id IS NULL AND numero_cnj IS NULL)",
    );
    expect(SO_CHAMADAS_AO_TRIBUNAL.values).toEqual([]);
  });
});
