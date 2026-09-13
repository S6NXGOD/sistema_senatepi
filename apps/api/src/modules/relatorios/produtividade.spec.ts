import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DECISAO_GRAVADA_DESDE, DIAS_PARA_NOTAR_AUSENCIA, PERFIS_EM_ORDEM, ProdutividadeService, REGISTROS,
  VEEM_A_CASA, concluidaNoDia, csvDaProdutividade, diasDoPeriodo, mesesDoPeriodo, ordenarPessoas,
  quemEntraNoUso, resumirPerfis, type LinhaDeUso, type Produtividade,
} from './produtividade.service';

const SERVICO = readFileSync(join(__dirname, 'produtividade.service.ts'), 'utf8');
const CONTROLLER = readFileSync(join(__dirname, 'relatorios.controller.ts'), 'utf8');
const MODULO = readFileSync(join(__dirname, 'relatorios.module.ts'), 'utf8');

const linha = (over: Partial<LinhaDeUso>): LinhaDeUso => ({
  usuarioId: 'u', nome: 'Pessoa', perfil: 'ADVOGADO', avatarUrl: null, avatarKey: null,
  ultimoAcesso: null, diasComUso: 0, diasAtivos: [],
  agenda: { concluidas: 0, noDiaMarcado: 0, criadas: 0, abertas: 0, atrasadas: 0 },
  publicacoes: { decididas: 0, esperando: 0 },
  processos: { cadastrados: 0, andamentos: 0, documentos: 0 },
  filiados: { cadastrados: 0, fichasAtualizadas: 0 },
  atendimentos: 0,
  porMes: [],
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
      linha({ nome: 'Bruna', perfil: 'ADVOGADO', agenda: { concluidas: 1, noDiaMarcado: 1, criadas: 0, abertas: 0, atrasadas: 0 } }),
      linha({ nome: 'Ana', perfil: 'ADVOGADO', agenda: { concluidas: 40, noDiaMarcado: 40, criadas: 0, abertas: 0, atrasadas: 0 } }),
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

  it('a planilha sai no formato do Excel brasileiro', () => {
    const p: Produtividade = {
      periodo: { de: '2026-09-01T03:00:00.000Z', ate: '2026-09-13T03:00:00.000Z' },
      escopo: 'GLOBAL', dias: [], meses: [], perfis: [], geradoEm: '',
      pessoas: [linha({ nome: 'Aspas "no" nome', ultimoAcesso: '2026-09-12T10:00:00Z', diasComUso: 4 })],
    };
    const csv = csvDaProdutividade(p);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toContain('"Dias com uso"');
    expect(csv).toContain('"Aspas ""no"" nome";"ADVOGADO";"2026-09-12";"4"');
  });

  it('as rotas existem e os serviços estão registrados', () => {
    expect(CONTROLLER).toContain("@Get('produtividade')");
    expect(CONTROLLER).toContain("@Get('produtividade.csv')");
    expect(CONTROLLER).toContain("@Get('produtividade/rostos')");
    expect(MODULO).toContain('providers: [RelatoriosService, ProdutividadeService, RostosService]');
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

const PASSADO = new Date('2020-01-06T12:00:00Z');
const FUTURO = new Date('2099-01-06T12:00:00Z');
const d = (iso: string) => new Date(iso);

function servicoCom() {
  const usuarios: Linha[] = [
    { id: 'u1', nome: 'Ana Souza', nomeExibicao: 'Dra. Ana', role: 'ADVOGADO', ativo: true, avatarUrl: null, avatarKey: null, ultimoLoginEm: d('2026-09-01T12:00:00Z') },
    { id: 'u2', nome: 'Bruno Lima', nomeExibicao: null, role: 'TRIAGEM', ativo: true, avatarUrl: null, avatarKey: null, ultimoLoginEm: null },
    { id: 'u3', nome: 'Caio Antigo', nomeExibicao: null, role: 'ADVOGADO', ativo: false, avatarUrl: null, avatarKey: null, ultimoLoginEm: null },
  ];

  const compromissos: Linha[] = [
    // Concluídas no período (e criadas por Ana no período).
    { id: 'c1', status: 'CONCLUIDO', responsavelId: 'u1', concluidoPor: 'u1', concluidoEm: d('2026-09-04T02:00:00Z'), inicio: d('2026-09-03T12:00:00Z'), criadoPor: 'u1', createdAt: d('2026-09-02T12:00:00Z'), equipe: [] },
    { id: 'c2', status: 'CONCLUIDO', responsavelId: 'u1', concluidoPor: 'u1', concluidoEm: d('2026-09-06T13:00:00Z'), inicio: d('2026-09-05T12:00:00Z'), criadoPor: 'u1', createdAt: d('2026-09-05T12:00:00Z'), equipe: [] },
    // Abertas.
    { id: 'a1', status: 'PENDENTE', responsavelId: 'u1', inicio: PASSADO, equipe: [] },
    // Ana participante escolhida por gente: conta para ela.
    { id: 'a2', status: 'PENDENTE', responsavelId: 'u2', inicio: FUTURO, equipe: [{ usuarioId: 'u1', origem: 'MANUAL' }] },
    { id: 'a3', status: 'EM_ANDAMENTO', responsavelId: 'u2', inicio: PASSADO, equipe: [{ usuarioId: 'u1', origem: null }] },
    // Ana reserva do robô: não conta para ela.
    { id: 'a4', status: 'PENDENTE', responsavelId: 'u2', inicio: PASSADO, equipe: [{ usuarioId: 'u1', origem: 'AUTOMATICA' }] },
    // Responsável e na equipe: uma vez só.
    { id: 'a5', status: 'PENDENTE', responsavelId: 'u1', inicio: FUTURO, equipe: [{ usuarioId: 'u1', origem: null }] },
    // De conta desativada, com Ana só de reserva: não é de ninguém da lista.
    { id: 'a6', status: 'PENDENTE', responsavelId: 'u3', inicio: PASSADO, equipe: [{ usuarioId: 'u1', origem: 'AUTOMATICA' }] },
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
    user: { findMany: jest.fn(async ({ where }: { where: Where }) => usuarios.filter((u) => casa(u, where))) },
    auditoria: {
      findMany: jest.fn(async () => [
        { userId: 'u1', acao: 'CREATE', entidade: 'Processo', createdAt: d('2026-09-02T14:00:00Z') },
        { userId: 'u1', acao: 'CREATE', entidade: 'AnexoDocumento', createdAt: d('2026-09-03T14:00:00Z') },
        // O que o sistema faz sozinho conta o DIA, mas não é trabalho registrado.
        { userId: 'u1', acao: 'CREATE', entidade: '/api/processos/instancias/reavaliar', createdAt: d('2026-09-03T15:00:00Z') },
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
    comunicacaoDjen: {
      groupBy: jest.fn(async (args: { by: string[]; where: Where }) => agrupar(comunicacoes, args)),
    },
    movimentacaoInterna: {
      findMany: jest.fn(async ({ where }: { where: Where }) => movimentacoes.filter((m) => casa(m, where))),
    },
    atendimento: { findMany: jest.fn(async () => []) },
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
    // Dia com uso junta ação e sessão renovada: 02, 03 e 05.
    expect(ana.diasAtivos).toEqual(['2026-09-02', '2026-09-03', '2026-09-05']);
    expect(ana.agenda).toEqual({ concluidas: 2, noDiaMarcado: 1, criadas: 2, abertas: 4, atrasadas: 2 });
    expect(ana.publicacoes).toEqual({ decididas: 1, esperando: 2 });
    expect(ana.processos).toEqual({ cadastrados: 1, andamentos: 3, documentos: 1 });
    // Mês a mês, para o PDF de um ano: o mesmo trabalho, com o mês de Teresina.
    expect(r.meses).toEqual(['2026-09']);
    expect(ana.porMes).toEqual([{ mes: '2026-09', diasComUso: 3, concluidas: 2, andamentos: 3, atendimentos: 0 }]);
    expect(ana.nome).toBe('Dra. Ana');
    const bruno = r.pessoas.find((p) => p.usuarioId === 'u2')!;
    expect(bruno.ultimoAcesso).toBeNull();
    expect(bruno.diasComUso).toBe(0);
    expect(r.perfis.map((p) => p.perfil)).toEqual(['ADVOGADO', 'TRIAGEM']);
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
