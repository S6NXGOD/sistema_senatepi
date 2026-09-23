import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { instanteDoTextoBR, mesBR, semanaBR } from '../processos/utils/data-br.util';
import {
  DECISAO_GRAVADA_DESDE, DIAS_PARA_NOTAR_AUSENCIA, NOME_DO_TIPO_SEM_CADASTRO, PERFIS_EM_ORDEM,
  ProdutividadeService, REGISTROS, VEEM_A_CASA, concluidaNoDia, concluidasPorTipo, contarPor,
  csvDaProdutividade, diasDoPeriodo, mesesDoPeriodo, naChave, ordenarPessoas, quemEntraNoUso,
  resumirPerfis, semanasDoPeriodo, type LinhaDeUso, type Produtividade,
} from './produtividade.service';

const SERVICO = readFileSync(join(__dirname, 'produtividade.service.ts'), 'utf8');
const CONTROLLER = readFileSync(join(__dirname, 'relatorios.controller.ts'), 'utf8');
const MODULO = readFileSync(join(__dirname, 'relatorios.module.ts'), 'utf8');

/** O serviço sem comentários: a negativa mira código, não a explicação de por que algo saiu. */
const CODIGO_DO_SERVICO = SERVICO.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const semAgenda = { concluidas: 0, noDiaMarcado: 0, criadas: 0, abertas: 0, atrasadas: 0, porTipo: [] };

const linha = (over: Partial<LinhaDeUso>): LinhaDeUso => ({
  usuarioId: 'u', nome: 'Pessoa', perfil: 'ADVOGADO', avatarUrl: null, avatarKey: null,
  ultimoAcesso: null, contaCriadaEm: '2026-08-04T13:00:00.000Z', diasComUso: 0, diasAtivos: [],
  agenda: semAgenda,
  publicacoes: { decididas: 0, esperando: 0 },
  processos: { cadastrados: 0, andamentos: 0, documentos: 0 },
  filiados: { cadastrados: 0, fichasAtualizadas: 0, recadastramentos: 0 },
  atendimentos: 0,
  porMes: [],
  porSemana: [],
  ...over,
});

/**
 * "MONITORAR A PRODUTIVIDADE DE CADA USUÁRIO NO SISTEMA, POR PERFIL" — pedido
 * de 12/09/2026. As regras abaixo são o que impede o relatório de medir clique.
 */
describe('uso e produtividade — as regras', () => {
  it('os dias do período são os de Teresina, sem repetir', () => {
    expect(diasDoPeriodo(new Date('2026-09-01T03:00:00Z'), new Date('2026-09-04T03:00:00Z'))).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03',
    ]);
  });

  it('os meses que o período atravessa, na ordem', () => {
    expect(mesesDoPeriodo(['2026-08-30', '2026-08-31', '2026-09-01'])).toEqual(['2026-08', '2026-09']);
  });

  /** "No dia marcado" é a data de Teresina — e nunca "no prazo", que o sistema não conhece. */
  it('concluída às 23h30 do dia marcado conta; à 0h30 do dia seguinte, não', () => {
    const marcada = new Date('2026-09-10T12:00:00Z');
    expect(concluidaNoDia(new Date('2026-09-11T02:30:00Z'), marcada)).toBe(true);
    expect(concluidaNoDia(new Date('2026-09-11T03:30:00Z'), marcada)).toBe(false);
  });

  /** A ordem é o perfil e o nome. Quem concluiu mais não sobe. */
  it('ordena por perfil e depois por nome — nunca por volume', () => {
    const ordenadas = ordenarPessoas([
      linha({ nome: 'Zeca', perfil: 'TRIAGEM' }),
      linha({ nome: 'Bruna', perfil: 'ADVOGADO', agenda: { ...semAgenda, concluidas: 1, noDiaMarcado: 1 } }),
      linha({ nome: 'Ana', perfil: 'ADVOGADO', agenda: { ...semAgenda, concluidas: 40, noDiaMarcado: 40 } }),
      linha({ nome: 'Carla', perfil: 'ADMINISTRADOR' }),
    ]);
    expect(ordenadas.map((p) => p.nome)).toEqual(['Ana', 'Bruna', 'Zeca', 'Carla']);
    expect(PERFIS_EM_ORDEM).toEqual(['ADVOGADO', 'COORDENACAO', 'TRIAGEM', 'ADMINISTRADOR']);
    expect(SERVICO).not.toMatch(/sort\([^)]*concluidas/);
  });

  it('não existe posição, pontuação nem nota', () => {
    for (const proibido of ['ranking:', 'posicao:', 'score:', 'pontuacao:']) {
      expect(SERVICO.toLowerCase()).not.toContain(proibido);
    }
  });

  /**
   * Era um `toContain` da linha do `where` dentro de `montar`. Em 13/09/2026 a
   * regra virou `quemEntraNoUso`, porque a rota das fotos do PDF precisa do
   * MESMO alcance — e agora é provada com valores.
   */
  it('só a gestão vê a casa; o resto recebe a própria linha', () => {
    expect([...VEEM_A_CASA].sort()).toEqual(['ADMINISTRADOR', 'COORDENACAO']);
    expect(quemEntraNoUso({ id: 'x', role: 'ADMINISTRADOR' })).toEqual({ ativo: true });
    expect(quemEntraNoUso({ id: 'x', role: 'COORDENACAO' })).toEqual({ ativo: true });
    expect(quemEntraNoUso({ id: 'x', role: 'ADVOGADO' })).toEqual({ id: 'x' });
    expect(quemEntraNoUso({ id: 'x', role: 'TRIAGEM' })).toEqual({ id: 'x' });
    expect(SERVICO).toContain('where: quemEntraNoUso(usuario),');
  });

  /**
   * CLIQUE NÃO É TRABALHO. A auditoria registra também o que o sistema faz
   * sozinho ao abrir uma tela; só entram nomes de registro fixos, e a linha de
   * login — que grava também a tentativa que falhou — fica fora.
   */
  it('conta a auditoria por nome de registro fixo, nunca o total', () => {
    expect(REGISTROS.processoCadastrado).toEqual({ acao: 'CREATE', entidade: 'Processo' });
    expect(REGISTROS.documentoAnexado).toEqual({ acao: 'CREATE', entidade: 'AnexoDocumento' });
    expect(REGISTROS.filiadoCadastrado).toEqual({ acao: 'CREATE', entidade: '/api/filiados' });
    expect(REGISTROS.fichaAtualizada).toEqual({ acao: 'UPDATE', entidade: 'Filiado' });
    expect(REGISTROS.recadastramento).toEqual({
      acao: 'CREATE', entidade: '/api/filiados/:id/recadastramento',
    });
    expect(SERVICO).toContain('acao: { not: AcaoAuditoria.LOGIN }');
    expect(SERVICO).not.toContain("'/api/processos/instancias/reavaliar'");
  });

  /** A coluna da decisão nasceu vazia no deploy: antes disso, não há o que comparar. */
  it('decididas é fato gravado a partir de 13/09/2026', () => {
    expect(DECISAO_GRAVADA_DESDE).toBe('2026-09-13');
  });

  it('resume cada perfil: quem usou, quem sumiu e quem nunca entrou', () => {
    const agora = new Date('2026-09-12T15:00:00Z');
    const r = resumirPerfis(
      [
        linha({ nome: 'A', diasComUso: 3, ultimoAcesso: '2026-09-12T10:00:00Z' }),
        linha({ nome: 'B', ultimoAcesso: '2026-08-04T12:00:00Z' }),
        linha({ nome: 'C', perfil: 'TRIAGEM' }),
      ],
      agora,
    );
    expect(DIAS_PARA_NOTAR_AUSENCIA).toBe(7);
    expect(r).toEqual([
      { perfil: 'ADVOGADO', pessoas: 2, usaram: 1, semAcessoRecente: 1, nuncaEntraram: 0 },
      { perfil: 'TRIAGEM', pessoas: 1, usaram: 0, semAcessoRecente: 0, nuncaEntraram: 1 },
    ]);
  });

  /** Os campos novos do PDF (14/09/2026) não entram na planilha: o CSV não muda. */
  it('a planilha sai no formato do Excel brasileiro', () => {
    const p: Produtividade = {
      periodo: { de: '2026-09-01T03:00:00.000Z', ate: '2026-09-13T03:00:00.000Z' },
      escopo: 'GLOBAL', dias: [], meses: [], semanas: [], perfis: [], geradoEm: '',
      pessoas: [linha({ nome: 'Aspas "no" nome', ultimoAcesso: '2026-09-12T10:00:00Z', diasComUso: 4 })],
    };
    const csv = csvDaProdutividade(p);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('"Dias com uso"');
    // 18 colunas desde 23/09/2026: "Recadastramentos" entrou ao lado de
    // "Fichas atualizadas", porque conferir a ficha inteira com o filiado não é
    // a mesma coisa que corrigir um campo.
    expect(csv.split('\r\n')[0].split(';')).toHaveLength(18);
    expect(csv.split('\r\n')[0]).toContain('"Recadastramentos"');
    expect(csv).toContain('"Aspas ""no"" nome";"ADVOGADO";"2026-09-12";"4"');
  });

  it('as rotas existem e os serviços estão registrados', () => {
    expect(CONTROLLER).toContain("@Get('produtividade')");
    expect(CONTROLLER).toContain("@Get('produtividade.csv')");
    expect(CONTROLLER).toContain("@Get('produtividade/rostos')");
    expect(MODULO).toContain('providers: [RelatoriosService, ProdutividadeService, RostosService]');
  });
});

/**
 * SEMANA E MÊS, UMA SOMA SÓ (14/09/2026).
 *
 * O PDF de uma pessoa ganhou o semana a semana. A semana e o mês não podem ter
 * duas implementações: `contarPor` recebe a chave de tempo, e a semana é a
 * segunda-feira de `semanaBR`.
 */
describe('uso e produtividade — o tempo', () => {
  /** De 14/08 (sexta) a 13/09/2026 (domingo): cinco semanas, pela segunda-feira. */
  it('as semanas que o período toca, pela segunda-feira', () => {
    const dias = diasDoPeriodo(instanteDoTextoBR('2026-08-14'), instanteDoTextoBR('2026-09-14'));
    expect(dias).toHaveLength(31);
    expect(semanasDoPeriodo(dias)).toEqual(['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07']);
  });

  /** Um ano: 01/01/2026 é quinta, e 31/12/2026 também. */
  it('o ano de 2026 toca 53 semanas, da de 29/12/2025 à de 28/12/2026', () => {
    const dias = diasDoPeriodo(instanteDoTextoBR('2026-01-01'), instanteDoTextoBR('2027-01-01'));
    const semanas = semanasDoPeriodo(dias);
    expect(dias).toHaveLength(365);
    expect(semanas).toHaveLength(53);
    expect(semanas[0]).toBe('2025-12-29');
    expect(semanas[52]).toBe('2026-12-28');
  });

  /**
   * As mesmas linhas, com as duas chaves. O domingo 30/08 às 22h daqui já é
   * segunda 31/08 em UTC: pela semana do contêiner iria para a seguinte.
   */
  it('contarPor soma pela chave de tempo que receber, e pula linha sem pessoa ou sem data', () => {
    const linhas = [
      { quem: 'u1', em: new Date('2026-08-31T01:00:00Z') }, // domingo 30/08, 22h daqui
      { quem: 'u1', em: new Date('2026-08-31T12:00:00Z') }, // segunda 31/08
      { quem: 'u1', em: new Date('2026-09-01T02:00:00Z') }, // segunda 31/08, 23h daqui
      { quem: 'u2', em: new Date('2026-09-01T12:00:00Z') }, // terça 01/09
      { quem: null, em: new Date('2026-09-01T12:00:00Z') },
      { quem: 'u1', em: null },
    ];
    const porMes = contarPor(linhas, (l) => l.quem, (l) => l.em, mesBR);
    const porSemana = contarPor(linhas, (l) => l.quem, (l) => l.em, semanaBR);
    expect(Object.fromEntries(porMes)).toEqual({ 'u1|2026-08': 3, 'u2|2026-09': 1 });
    expect(Object.fromEntries(porSemana)).toEqual({ 'u1|2026-08-24': 1, 'u1|2026-08-31': 2, 'u2|2026-08-31': 1 });
    expect(naChave('u1', '2026-08-31')).toBe('u1|2026-08-31');
  });

  /** A soma é uma: o serviço não guarda uma segunda conta de mês nem faz aritmética de semana. */
  it('o serviço usa contarPor com mesBR e semanaBR, e não calcula dia da semana', () => {
    expect(CODIGO_DO_SERVICO).toContain('trabalhoPor(mesBR)');
    expect(CODIGO_DO_SERVICO).toContain('trabalhoPor(semanaBR)');
    expect(CODIGO_DO_SERVICO).not.toMatch(/contarNoMes|getUTCDay|getDay\(/);
  });

  /**
   * POR TIPO. A ordem é de TIPOS de uma mesma pessoa (volume, depois nome) —
   * nunca de pessoas. O tipo cuja linha sumiu de tipos_evento vira "Outro tipo".
   */
  it('concluídas por tipo: nome atual, "Outro tipo" sem cadastro, e a soma bate com o total', () => {
    const nomes = new Map([['PRAZO', 'Prazo'], ['AUDIENCIA', 'Audiência'], ['REUNIAO', 'Reunião']]);
    const c = (tipo: string, concluidoEm: string, inicio: string) => ({
      tipo, concluidoEm: new Date(concluidoEm), inicio: new Date(inicio),
    });
    const minhas = [
      c('AUDIENCIA', '2026-09-04T02:00:00Z', '2026-09-03T12:00:00Z'), // 23h do dia marcado: no dia
      c('PRAZO', '2026-09-06T13:00:00Z', '2026-09-05T12:00:00Z'), // um dia depois
      c('PRAZO', '2026-09-07T01:30:00Z', '2026-09-08T12:00:00Z'), // antes do dia
      c('tipo-apagado', '2026-09-08T15:00:00Z', '2026-09-04T12:00:00Z'),
      { tipo: 'REUNIAO', concluidoEm: null, inicio: new Date('2026-09-08T12:00:00Z') },
    ];
    const tipos = concluidasPorTipo(minhas, nomes);
    expect(NOME_DO_TIPO_SEM_CADASTRO).toBe('Outro tipo');
    expect(tipos).toEqual([
      { tipo: 'PRAZO', nome: 'Prazo', concluidas: 2, noDiaMarcado: 1 },
      { tipo: 'AUDIENCIA', nome: 'Audiência', concluidas: 1, noDiaMarcado: 1 },
      { tipo: 'tipo-apagado', nome: 'Outro tipo', concluidas: 1, noDiaMarcado: 0 },
      // Sem data de conclusão conta no total, como `agenda.concluidas`, e nunca "no dia".
      { tipo: 'REUNIAO', nome: 'Reunião', concluidas: 1, noDiaMarcado: 0 },
    ]);
    expect(tipos.reduce((s, t) => s + t.concluidas, 0)).toBe(minhas.length);
    expect(concluidasPorTipo([], nomes)).toEqual([]);
  });
});

/*
  UM BANCO DE MENTIRA QUE AVALIA O `where` CONTRA OS DADOS.

  O falso antigo devolvia contagens prontas, e passaria com qualquer `where` —
  inclusive o que contava só o responsável. Este aplica a pergunta às linhas,
  com a regra do SQL para nulo: `{ not: X }` não traz a linha NULA. Operador que
  ele não conhece faz o teste cair, em vez de fingir que casou.
*/
type Linha = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;

function casa(linhaDoBanco: Linha, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([campo, cond]) => {
    if (campo === 'OR') return (cond as Linha[]).some((w) => casa(linhaDoBanco, w));
    if (campo === 'AND') return (cond as Linha[]).every((w) => casa(linhaDoBanco, w));
    const valor = linhaDoBanco[campo] ?? null;
    if (cond === null) return valor === null;
    if (typeof cond !== 'object' || cond instanceof Date) return valor === cond;
    const c = cond as Linha;
    if ('some' in c) return ((valor as Linha[] | null) ?? []).some((item) => casa(item, c.some as Linha));
    return Object.entries(c).every(([op, alvo]) => {
      switch (op) {
        case 'in':
          return (alvo as unknown[]).includes(valor);
        case 'not':
          return valor !== null && valor !== alvo;
        case 'gte':
          return valor !== null && (valor as Date) >= (alvo as Date);
        case 'lt':
          return valor !== null && (valor as Date) < (alvo as Date);
        default:
          throw new Error(`operador não simulado: ${campo}.${op}`);
      }
    });
  });
}

function agrupar(linhas: Linha[], { by, where }: { by: string[]; where: Where }) {
  const mapa = new Map<unknown, number>();
  for (const l of linhas.filter((x) => casa(x, where))) {
    const chave = l[by[0]] ?? null;
    mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
  }
  return [...mapa.entries()].map(([chave, n]) => ({ [by[0]]: chave, _count: { _all: n } }));
}

/** O que a consulta pediu no `select` — o falso devolve só isso, como o Prisma. */
function selecionar(linhas: Linha[], select: Record<string, unknown> | undefined): Linha[] {
  if (!select) return linhas;
  return linhas.map((l) => Object.fromEntries(Object.keys(select).map((k) => [k, l[k]])));
}

const PASSADO = new Date('2020-01-06T12:00:00Z');
const FUTURO = new Date('2099-01-06T12:00:00Z');
const d = (iso: string) => new Date(iso);

function servicoCom() {
  const usuarios: Linha[] = [
    { id: 'u1', nome: 'Ana Souza', nomeExibicao: 'Dra. Ana', role: 'ADVOGADO', ativo: true, avatarUrl: null, avatarKey: null, ultimoLoginEm: d('2026-09-01T12:00:00Z'), createdAt: d('2026-08-04T13:00:00Z') },
    { id: 'u2', nome: 'Bruno Lima', nomeExibicao: null, role: 'TRIAGEM', ativo: true, avatarUrl: null, avatarKey: null, ultimoLoginEm: null, createdAt: d('2026-08-21T14:00:00Z') },
    { id: 'u3', nome: 'Caio Antigo', nomeExibicao: null, role: 'ADVOGADO', ativo: false, avatarUrl: null, avatarKey: null, ultimoLoginEm: null, createdAt: d('2026-08-04T13:00:00Z') },
  ];

  const compromissos: Linha[] = [
    // Concluídas no período (e criadas por Ana no período).
    { id: 'c1', tipo: 'AUDIENCIA', status: 'CONCLUIDO', responsavelId: 'u1', concluidoPor: 'u1', concluidoEm: d('2026-09-04T02:00:00Z'), inicio: d('2026-09-03T12:00:00Z'), criadoPor: 'u1', createdAt: d('2026-09-02T12:00:00Z'), equipe: [] },
    { id: 'c2', tipo: 'PRAZO', status: 'CONCLUIDO', responsavelId: 'u1', concluidoPor: 'u1', concluidoEm: d('2026-09-06T13:00:00Z'), inicio: d('2026-09-05T12:00:00Z'), criadoPor: 'u1', createdAt: d('2026-09-05T12:00:00Z'), equipe: [] },
    // Domingo 06/09 às 22h30 daqui (já segunda em UTC), marcada para terça: no dia, e na semana de 31/08.
    { id: 'c3', tipo: 'PRAZO', status: 'CONCLUIDO', responsavelId: 'u1', concluidoPor: 'u1', concluidoEm: d('2026-09-07T01:30:00Z'), inicio: d('2026-09-08T12:00:00Z'), criadoPor: null, createdAt: PASSADO, equipe: [] },
    // Terça 08/09, marcada para 04/09; o tipo não tem mais linha em tipos_evento.
    { id: 'c4', tipo: 'tipo-apagado', status: 'CONCLUIDO', responsavelId: 'u1', concluidoPor: 'u1', concluidoEm: d('2026-09-08T15:00:00Z'), inicio: d('2026-09-04T12:00:00Z'), criadoPor: null, createdAt: PASSADO, equipe: [] },
    // Abertas.
    { id: 'a1', tipo: 'PRAZO', status: 'PENDENTE', responsavelId: 'u1', inicio: PASSADO, equipe: [] },
    // Ana participante escolhida por gente: conta para ela.
    { id: 'a2', tipo: 'PRAZO', status: 'PENDENTE', responsavelId: 'u2', inicio: FUTURO, equipe: [{ usuarioId: 'u1', origem: 'MANUAL' }] },
    { id: 'a3', tipo: 'PRAZO', status: 'EM_ANDAMENTO', responsavelId: 'u2', inicio: PASSADO, equipe: [{ usuarioId: 'u1', origem: null }] },
    // Ana reserva do robô: não conta para ela.
    { id: 'a4', tipo: 'PRAZO', status: 'PENDENTE', responsavelId: 'u2', inicio: PASSADO, equipe: [{ usuarioId: 'u1', origem: 'AUTOMATICA' }] },
    // Responsável e na equipe: uma vez só.
    { id: 'a5', tipo: 'PRAZO', status: 'PENDENTE', responsavelId: 'u1', inicio: FUTURO, equipe: [{ usuarioId: 'u1', origem: null }] },
    // De conta desativada, com Ana só de reserva: não é de ninguém da lista.
    { id: 'a6', tipo: 'PRAZO', status: 'PENDENTE', responsavelId: 'u3', inicio: PASSADO, equipe: [{ usuarioId: 'u1', origem: 'AUTOMATICA' }] },
  ];

  const tiposEvento: Linha[] = [
    { slug: 'PRAZO', nome: 'Prazo' },
    // Renomeado na tela de tipos: vale o nome de agora.
    { slug: 'AUDIENCIA', nome: 'Audiência de instrução' },
    { slug: 'REUNIAO', nome: 'Reunião' },
  ];

  const comunicacoes: Linha[] = [
    // Proposta para Ana, aceita pelo colega Bruno: a decisão é dele.
    { id: 'd1', tarefaPropostaPara: 'u1', tarefaPropostaEm: d('2026-09-03T12:00:00Z'), compromissoId: 'k1', tarefaDispensadaEm: null, tarefaDecididaPor: 'u2', tarefaDecididaEm: d('2026-09-05T12:00:00Z') },
    // Ana recusou.
    { id: 'd2', tarefaPropostaPara: 'u1', tarefaPropostaEm: d('2026-09-03T12:00:00Z'), compromissoId: null, tarefaDispensadaEm: d('2026-09-06T12:00:00Z'), tarefaDecididaPor: 'u1', tarefaDecididaEm: d('2026-09-06T12:00:00Z') },
    // Virou tarefa sozinha depois de três dias sem resposta: ninguém decidiu.
    { id: 'd3', tarefaPropostaPara: 'u1', tarefaPropostaEm: d('2026-09-02T12:00:00Z'), compromissoId: 'k2', tarefaDispensadaEm: null, tarefaDecididaPor: null, tarefaDecididaEm: null },
    // Decidida por Ana antes do período.
    { id: 'd4', tarefaPropostaPara: 'u1', tarefaPropostaEm: d('2026-07-30T12:00:00Z'), compromissoId: 'k3', tarefaDispensadaEm: null, tarefaDecididaPor: 'u1', tarefaDecididaEm: d('2026-08-01T12:00:00Z') },
    // Esperando decisão de Ana.
    { id: 'e1', tarefaPropostaPara: 'u1', tarefaPropostaEm: d('2026-09-08T12:00:00Z'), compromissoId: null, tarefaDispensadaEm: null, tarefaDecididaPor: null, tarefaDecididaEm: null },
    { id: 'e2', tarefaPropostaPara: 'u1', tarefaPropostaEm: d('2026-09-09T12:00:00Z'), compromissoId: null, tarefaDispensadaEm: null, tarefaDecididaPor: null, tarefaDecididaEm: null },
  ];

  const nota = (over: Linha): Linha => ({
    autorId: 'u1', createdAt: d('2026-09-02T15:00:00Z'), origem: null, origemSistema: false, ...over,
  });
  const movimentacoes: Linha[] = [
    nota({}), nota({}), nota({}),
    // O eco de concluir, a conversa que abre o caso e a linha de planilha: não são lançamento.
    nota({ origem: 'CONCLUSAO' }),
    nota({ origem: 'CONVERSAO' }),
    nota({ origem: 'IMPORTACAO' }),
    // O robô.
    nota({ autorId: null, origemSistema: true }),
    // Fora do período.
    nota({ createdAt: d('2026-08-20T15:00:00Z') }),
  ];

  const prisma = {
    user: {
      findMany: jest.fn(async ({ where, select }: { where: Where; select?: Linha }) =>
        selecionar(usuarios.filter((u) => casa(u, where)), select)),
    },
    auditoria: {
      findMany: jest.fn(async () => [
        { userId: 'u1', acao: 'CREATE', entidade: 'Processo', createdAt: d('2026-09-02T14:00:00Z') },
        { userId: 'u1', acao: 'CREATE', entidade: 'AnexoDocumento', createdAt: d('2026-09-03T14:00:00Z') },
        // O que o sistema faz sozinho conta o DIA, mas não é trabalho registrado.
        { userId: 'u1', acao: 'CREATE', entidade: '/api/processos/instancias/reavaliar', createdAt: d('2026-09-03T15:00:00Z') },
        // Filiado cadastrado na terça 08/09: segunda semana.
        { userId: 'u1', acao: 'CREATE', entidade: '/api/filiados', createdAt: d('2026-09-08T14:00:00Z') },
      ]),
      groupBy: jest.fn(async () => [{ userId: 'u1', _max: { createdAt: d('2026-09-10T15:00:00Z') } }]),
    },
    refreshToken: {
      findMany: jest.fn(async () => [
        { userId: 'u1', createdAt: d('2026-09-03T20:00:00Z') },
        { userId: 'u1', createdAt: d('2026-09-06T01:00:00Z') }, // 22h do dia 05 em Teresina
      ]),
      groupBy: jest.fn(async () => []),
    },
    compromisso: {
      findMany: jest.fn(async ({ where }: { where: Where }) => compromissos.filter((c) => casa(c, where))),
      groupBy: jest.fn(async (args: { by: string[]; where: Where }) => agrupar(compromissos, args)),
    },
    tipoCompromisso: {
      // Sem filtro de `ativo`: tipo oculto continua com nome.
      findMany: jest.fn(async ({ where, select }: { where?: Where; select?: Linha }) =>
        selecionar(tiposEvento.filter((t) => casa(t, where)), select)),
    },
    comunicacaoDjen: {
      groupBy: jest.fn(async (args: { by: string[]; where: Where }) => agrupar(comunicacoes, args)),
    },
    movimentacaoInterna: {
      findMany: jest.fn(async ({ where }: { where: Where }) => movimentacoes.filter((m) => casa(m, where))),
    },
    atendimento: {
      // Bruno atende na quarta 09/09: segunda semana.
      findMany: jest.fn(async () => [{ atendentePorId: 'u2', createdAt: d('2026-09-09T13:00:00Z') }]),
    },
  };
  return new ProdutividadeService(prisma as never);
}

describe('uso e produtividade — montado', () => {
  const de = new Date('2026-09-01T12:00:00Z');
  const ate = new Date('2026-09-10T12:00:00Z');

  it('a gestão recebe as contas ativas, com o que cada um registrou', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'adm', role: 'ADMINISTRADOR' });
    expect(r.escopo).toBe('GLOBAL');
    expect(r.dias).toHaveLength(10);
    expect(r.pessoas.map((p) => p.usuarioId).sort()).toEqual(['u1', 'u2']);
    const ana = r.pessoas.find((p) => p.usuarioId === 'u1')!;
    // Dia com uso junta ação e sessão renovada: 02, 03, 05 e 08.
    expect(ana.diasAtivos).toEqual(['2026-09-02', '2026-09-03', '2026-09-05', '2026-09-08']);
    expect(ana.agenda).toEqual({
      concluidas: 4, noDiaMarcado: 2, criadas: 2, abertas: 4, atrasadas: 2,
      porTipo: [
        { tipo: 'PRAZO', nome: 'Prazo', concluidas: 2, noDiaMarcado: 1 },
        { tipo: 'AUDIENCIA', nome: 'Audiência de instrução', concluidas: 1, noDiaMarcado: 1 },
        { tipo: 'tipo-apagado', nome: 'Outro tipo', concluidas: 1, noDiaMarcado: 0 },
      ],
    });
    expect(ana.publicacoes).toEqual({ decididas: 1, esperando: 2 });
    expect(ana.processos).toEqual({ cadastrados: 1, andamentos: 3, documentos: 1 });
    expect(ana.filiados).toEqual({ cadastrados: 1, fichasAtualizadas: 0, recadastramentos: 0 });
    // Mês a mês, para o PDF de um ano: o mesmo trabalho, com o mês de Teresina.
    expect(r.meses).toEqual(['2026-09']);
    expect(ana.porMes).toEqual([
      {
        mes: '2026-09', diasComUso: 4, concluidas: 4, noDiaMarcado: 2, andamentos: 3, atendimentos: 0,
        processosCadastrados: 1, documentos: 1, filiadosCadastrados: 1,
      },
    ]);
    expect(ana.nome).toBe('Dra. Ana');
    const bruno = r.pessoas.find((p) => p.usuarioId === 'u2')!;
    expect(bruno.ultimoAcesso).toBeNull();
    expect(bruno.diasComUso).toBe(0);
    expect(bruno.agenda.porTipo).toEqual([]);
    expect(r.perfis.map((p) => p.perfil)).toEqual(['ADVOGADO', 'TRIAGEM']);
  });

  /**
   * SEMANA A SEMANA. De 01/09 (terça) a 10/09/2026 (quinta): a semana de 31/08
   * tem 6 dias no período e a de 07/09, 4. A concluída do domingo 06/09 às
   * 22h30 daqui já é segunda em UTC — e fica na semana de 31/08.
   */
  it('semana a semana: segundas-feiras daqui, dias no período e o trabalho de cada semana', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'adm', role: 'ADMINISTRADOR' });
    expect(r.semanas).toEqual(['2026-08-31', '2026-09-07']);
    const ana = r.pessoas.find((p) => p.usuarioId === 'u1')!;
    expect(ana.porSemana).toEqual([
      {
        semana: '2026-08-31', diasNoPeriodo: 6, diasComUso: 3, concluidas: 3, noDiaMarcado: 2,
        andamentos: 3, atendimentos: 0, processosCadastrados: 1, documentos: 1, filiadosCadastrados: 0,
      },
      {
        semana: '2026-09-07', diasNoPeriodo: 4, diasComUso: 1, concluidas: 1, noDiaMarcado: 0,
        andamentos: 0, atendimentos: 0, processosCadastrados: 0, documentos: 0, filiadosCadastrados: 1,
      },
    ]);
    // Semana parada vem com zeros, e não some.
    const bruno = r.pessoas.find((p) => p.usuarioId === 'u2')!;
    expect(bruno.porSemana.map((s) => [s.semana, s.diasComUso, s.atendimentos])).toEqual([
      ['2026-08-31', 0, 0],
      ['2026-09-07', 0, 1],
    ]);
    expect(bruno.porSemana.map((s) => s.diasNoPeriodo)).toEqual([6, 4]);
  });

  /** Somar as semanas (ou os meses) dá o total: é a mesma soma sobre as mesmas linhas. */
  it('as semanas e os meses somam exatamente os totais de cada pessoa', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'adm', role: 'ADMINISTRADOR' });
    const soma = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
    for (const p of r.pessoas) {
      for (const partes of [p.porSemana, p.porMes] as { diasComUso: number; concluidas: number; noDiaMarcado: number; andamentos: number; atendimentos: number; processosCadastrados: number; documentos: number; filiadosCadastrados: number }[][]) {
        expect(soma(partes, (s) => s.diasComUso)).toBe(p.diasComUso);
        expect(soma(partes, (s) => s.concluidas)).toBe(p.agenda.concluidas);
        expect(soma(partes, (s) => s.noDiaMarcado)).toBe(p.agenda.noDiaMarcado);
        expect(soma(partes, (s) => s.andamentos)).toBe(p.processos.andamentos);
        expect(soma(partes, (s) => s.atendimentos)).toBe(p.atendimentos);
        expect(soma(partes, (s) => s.processosCadastrados)).toBe(p.processos.cadastrados);
        expect(soma(partes, (s) => s.documentos)).toBe(p.processos.documentos);
        expect(soma(partes, (s) => s.filiadosCadastrados)).toBe(p.filiados.cadastrados);
      }
      expect(soma(p.agenda.porTipo, (t) => t.concluidas)).toBe(p.agenda.concluidas);
      expect(soma(p.agenda.porTipo, (t) => t.noDiaMarcado)).toBe(p.agenda.noDiaMarcado);
    }
    expect(soma(r.pessoas[0].porSemana, (s) => s.diasNoPeriodo)).toBe(r.dias.length);
  });

  /**
   * CONTA CRIADA. O "antes 0" do Dr. Murilo era conta que não existia (criada em
   * 21/08/2026). O PDF só sabe disso se a data vier.
   */
  it('cada linha traz quando a conta foi criada', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'adm', role: 'ADMINISTRADOR' });
    const criada = Object.fromEntries(r.pessoas.map((p) => [p.usuarioId, p.contaCriadaEm]));
    expect(criada).toEqual({ u1: '2026-08-04T13:00:00.000Z', u2: '2026-08-21T14:00:00.000Z' });
  });

  it('quem não é da gestão recebe só a própria linha, sem resumo da casa', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'u1', role: 'ADVOGADO' });
    expect(r.escopo).toBe('PESSOAL');
    expect(r.pessoas.map((p) => p.usuarioId)).toEqual(['u1']);
    expect(r.perfis).toEqual([]);
  });

  /**
   * A RÉGUA DO SINO. Ana responde por a1 (dia anterior) e a5, participa por
   * escolha de gente de a2 e a3 (dia anterior), e é reserva do robô em a4 e a6.
   * Contando só o responsável, seriam 2 em aberto e 1 atrasada — o número que
   * o painel desmentia.
   */
  it('em aberto e atrasadas pela régua daPessoa — participante sim, reserva do robô não', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'u1', role: 'ADVOGADO' });
    expect(r.pessoas[0].agenda).toMatchObject({ abertas: 4, atrasadas: 2 });
  });

  it('a mesma atividade conta para cada pessoa dela, uma vez', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'adm', role: 'ADMINISTRADOR' });
    const bruno = r.pessoas.find((p) => p.usuarioId === 'u2')!;
    // a2, a3 e a4 são dele; a4 atrasada conta para ele mesmo com Ana de reserva.
    expect(bruno.agenda).toMatchObject({ abertas: 3, atrasadas: 2 });
  });

  /**
   * DECIDIDA É QUEM DECIDIU. A aceita pelo colega conta para o colega; a que
   * virou tarefa sozinha não conta para ninguém; a de antes do período, não.
   * Pela conta antiga Ana teria 3 (a recusa e as duas que "viraram tarefa") e
   * Bruno, zero.
   */
  it('publicações decididas pelas colunas da decisão, e não pelo destinatário', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'adm', role: 'ADMINISTRADOR' });
    const de_ = (id: string) => r.pessoas.find((p) => p.usuarioId === id)!.publicacoes;
    expect(de_('u1')).toEqual({ decididas: 1, esperando: 2 });
    expect(de_('u2')).toEqual({ decididas: 1, esperando: 0 });
  });

  it('andamentos internos contam só o lançamento feito por gente', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'u1', role: 'ADVOGADO' });
    // 3 lançados à mão; o eco da conclusão, a conversão, a planilha e o robô ficam fora.
    expect(r.pessoas[0].processos.andamentos).toBe(3);
    expect(r.pessoas[0].porMes[0].andamentos).toBe(3);
  });
});

/**
 * O NOME DO REGISTRO É UM CAMINHO DE ROTA, e caminho muda. Se alguém mover o
 * `@Post('recadastramento')` ou o `@Controller('filiados/:id')`, a contagem
 * viraria ZERO sem ninguém perceber — o relatório diria "não estão
 * recadastrando" com a equipe recadastrando todo dia.
 *
 * Este teste amarra os dois: o caminho que o interceptor grava é montado do
 * prefixo do controller mais o do método, e é exatamente o que `REGISTROS`
 * espera. É o mesmo cuidado de [[senatepi-alarme-contradizia-o-robo]]: a
 * ausência de linha não pode ser lida como ausência de trabalho.
 */
describe('o caminho gravado na auditoria é o caminho da rota', () => {
  const fonte = readFileSync(
    join(__dirname, '../recadastramento/recadastramento.controller.ts'),
    'utf8',
  );

  it('o controller ainda atende em filiados/:id', () => {
    expect(fonte).toContain("@Controller('filiados/:id')");
  });

  it('o método ainda é POST recadastramento', () => {
    expect(fonte).toContain("@Post('recadastramento')");
  });

  it('e é isso que REGISTROS.recadastramento procura', () => {
    const prefixo = /@Controller\('([^']+)'\)/.exec(fonte)?.[1];
    const metodo = /@Post\('([^']+)'\)/.exec(fonte)?.[1];
    expect(REGISTROS.recadastramento.entidade).toBe(`/api/${prefixo}/${metodo}`);
  });
});
