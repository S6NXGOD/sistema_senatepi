import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIAS_PARA_NOTAR_AUSENCIA, PERFIS_EM_ORDEM, ProdutividadeService, REGISTROS, VEEM_A_CASA,
  concluidaNoDia, csvDaProdutividade, diasDoPeriodo, mesesDoPeriodo, ordenarPessoas, resumirPerfis,
  type LinhaDeUso, type Produtividade,
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

  it('só a gestão vê a casa; o resto recebe a própria linha', () => {
    expect([...VEEM_A_CASA].sort()).toEqual(['ADMINISTRADOR', 'COORDENACAO']);
    expect(SERVICO).toContain("where: escopo === 'GLOBAL' ? { ativo: true } : { id: usuario.id },");
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

  it('as rotas existem e o serviço está registrado', () => {
    expect(CONTROLLER).toContain("@Get('produtividade')");
    expect(CONTROLLER).toContain("@Get('produtividade.csv')");
    expect(MODULO).toContain('providers: [RelatoriosService, ProdutividadeService]');
  });
});

/** Um banco de mentira que responde conforme a pergunta. */
function servicoCom() {
  const usuarios = [
    { id: 'u1', nome: 'Ana Souza', nomeExibicao: 'Dra. Ana', role: 'ADVOGADO', avatarUrl: null, avatarKey: null, ultimoLoginEm: new Date('2026-09-01T12:00:00Z') },
    { id: 'u2', nome: 'Bruno Lima', nomeExibicao: null, role: 'TRIAGEM', avatarUrl: null, avatarKey: null, ultimoLoginEm: null },
  ];
  const prisma = {
    user: {
      findMany: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id ? usuarios.filter((u) => u.id === where.id) : usuarios,
      ),
    },
    auditoria: {
      findMany: jest.fn(async () => [
        { userId: 'u1', acao: 'CREATE', entidade: 'Processo', createdAt: new Date('2026-09-02T14:00:00Z') },
        { userId: 'u1', acao: 'CREATE', entidade: 'AnexoDocumento', createdAt: new Date('2026-09-03T14:00:00Z') },
        // O que o sistema faz sozinho conta o DIA, mas não é trabalho registrado.
        { userId: 'u1', acao: 'CREATE', entidade: '/api/processos/instancias/reavaliar', createdAt: new Date('2026-09-03T15:00:00Z') },
      ]),
      groupBy: jest.fn(async () => [{ userId: 'u1', _max: { createdAt: new Date('2026-09-10T15:00:00Z') } }]),
    },
    refreshToken: {
      findMany: jest.fn(async () => [
        { userId: 'u1', createdAt: new Date('2026-09-03T20:00:00Z') },
        { userId: 'u1', createdAt: new Date('2026-09-06T01:00:00Z') }, // 22h do dia 05 em Teresina
      ]),
      groupBy: jest.fn(async () => []),
    },
    compromisso: {
      findMany: jest.fn(async () => [
        { concluidoPor: 'u1', concluidoEm: new Date('2026-09-04T02:00:00Z'), inicio: new Date('2026-09-03T12:00:00Z') },
        { concluidoPor: 'u1', concluidoEm: new Date('2026-09-06T13:00:00Z'), inicio: new Date('2026-09-05T12:00:00Z') },
      ]),
      groupBy: jest.fn(async ({ by, where }: { by: string[]; where: { inicio?: unknown } }) => {
        if (by[0] === 'criadoPor') return [{ criadoPor: 'u1', _count: { _all: 2 } }];
        return where.inicio
          ? [{ responsavelId: 'u1', _count: { _all: 1 } }]
          : [{ responsavelId: 'u1', _count: { _all: 3 } }];
      }),
    },
    comunicacaoDjen: {
      groupBy: jest.fn(async ({ where }: { where: { tarefaDispensadaMotivo?: string } }) =>
        where.tarefaDispensadaMotivo
          ? [{ tarefaPropostaPara: 'u1', _count: { _all: 1 } }]
          : [{ tarefaPropostaPara: 'u1', _count: { _all: 4 } }],
      ),
      findMany: jest.fn(async () => [{ tarefaPropostaPara: 'u1' }, { tarefaPropostaPara: 'u1' }]),
    },
    movimentacaoInterna: {
      findMany: jest.fn(async () =>
        Array.from({ length: 5 }, () => ({ autorId: 'u1', createdAt: new Date('2026-09-02T15:00:00Z') })),
      ),
    },
    atendimento: { findMany: jest.fn(async () => []) },
  };
  return new ProdutividadeService(prisma as never);
}

describe('uso e produtividade — montado', () => {
  const de = new Date('2026-09-01T12:00:00Z');
  const ate = new Date('2026-09-10T12:00:00Z');

  it('a gestão recebe todos, com o que cada um registrou', async () => {
    const r = await servicoCom().montar(de, ate, { id: 'adm', role: 'ADMINISTRADOR' });
    expect(r.escopo).toBe('GLOBAL');
    expect(r.dias).toHaveLength(10);
    const ana = r.pessoas.find((p) => p.usuarioId === 'u1')!;
    // Dia com uso junta ação e sessão renovada: 02, 03 e 05.
    expect(ana.diasAtivos).toEqual(['2026-09-02', '2026-09-03', '2026-09-05']);
    expect(ana.agenda).toEqual({ concluidas: 2, noDiaMarcado: 1, criadas: 2, abertas: 3, atrasadas: 1 });
    expect(ana.publicacoes).toEqual({ decididas: 3, esperando: 4 });
    expect(ana.processos).toEqual({ cadastrados: 1, andamentos: 5, documentos: 1 });
    // Mês a mês, para o PDF de um ano: o mesmo trabalho, com o mês de Teresina.
    expect(r.meses).toEqual(['2026-09']);
    expect(ana.porMes).toEqual([{ mes: '2026-09', diasComUso: 3, concluidas: 2, andamentos: 5, atendimentos: 0 }]);
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
});
