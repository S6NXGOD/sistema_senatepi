import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, Controller, Delete, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DecisaoDuplicata } from '@prisma/client';
import { PermissionsGuard } from '../../common/permissions/permissions.guard';
import { Modulo } from '../../common/permissions/modulo.decorator';
import { ExclusaoDelegada } from '../../common/permissions/exclusao-delegada.decorator';
import { DuplicidadeController } from './duplicidade.controller';
import { DuplicidadeService } from './duplicidade.service';

const CTRL = readFileSync(join(__dirname, 'duplicidade.controller.ts'), 'utf8');

/**
 * A FILA DE DUPLICADOS, EM DOIS PEDIDOS DO MESMO DIA (15/09/2026).
 *
 * 1. "Para a Triagem aparece só o outro botão" — o "não é duplicado", que tirava
 *    o par da fila de quem podia consolidar.
 * 2. "Quero a possibilidade do administrador permitir que alguém de qualquer
 *    role possa fazer esse trabalho."
 *
 * Resultado: módulo "Cadastros duplicados" na matriz, SEM_ACESSO em todo perfil,
 * liberado só pelo Administrador; com EDITAR, a pessoa faz o trabalho inteiro.
 * Testado com o PermissionsGuard e o controller de verdade.
 */
describe('quem entra na fila de duplicados', () => {
  const guard = new PermissionsGuard(new Reflector());
  type Classe = abstract new (...args: never[]) => unknown;
  const contexto = (
    metodo: string,
    handler: (...args: never[]) => unknown,
    role: string,
    permissoes: Record<string, string> = {},
    classe: Classe = DuplicidadeController,
  ) =>
    ({
      getHandler: () => handler,
      getClass: () => classe,
      switchToHttp: () => ({ getRequest: () => ({ method: metodo, user: { id: 'u1', role, permissoes } }) }),
    }) as never;
  const P = DuplicidadeController.prototype;

  it('sem liberação, ninguém abaixo do Administrador entra — e a recusa nomeia o módulo', () => {
    for (const role of ['TRIAGEM', 'COORDENACAO', 'ADVOGADO']) {
      expect(() => guard.canActivate(contexto('GET', P.status, role))).toThrow(/"Cadastros duplicados"/);
      expect(() => guard.canActivate(contexto('POST', P.distintos, role))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(contexto('DELETE', P.fundir, role))).toThrow(ForbiddenException);
    }
  });

  it('liberada com EDITAR, a Triagem faz o trabalho inteiro — inclusive consolidar', () => {
    const liberada = { duplicados: 'EDITAR' };
    expect(guard.canActivate(contexto('GET', P.listar, 'TRIAGEM', liberada))).toBe(true);
    expect(guard.canActivate(contexto('POST', P.distintos, 'TRIAGEM', liberada))).toBe(true);
    for (const h of [P.fundir, P.executarLote, P.voltarParaFila]) {
      expect(guard.canActivate(contexto('DELETE', h, 'TRIAGEM', liberada))).toBe(true);
    }
  });

  it('com VISUALIZAR, acompanha a fila e não decide nada', () => {
    const soVer = { duplicados: 'VISUALIZAR' };
    expect(guard.canActivate(contexto('GET', P.listar, 'ADVOGADO', soVer))).toBe(true);
    expect(guard.canActivate(contexto('GET', P.descartados, 'ADVOGADO', soVer))).toBe(true);
    expect(() => guard.canActivate(contexto('POST', P.distintos, 'ADVOGADO', soVer))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contexto('DELETE', P.fundir, 'ADVOGADO', soVer))).toThrow(ForbiddenException);
  });

  it('editar filiados não dá a fila: são permissões separadas', () => {
    expect(() => guard.canActivate(contexto('POST', P.distintos, 'TRIAGEM', { filiados: 'EDITAR' }))).toThrow(
      ForbiddenException,
    );
  });

  it('a marca de exclusão delegada não abre nada fora do módulo que só o Administrador concede', () => {
    @Modulo('filiados')
    @Controller('teste')
    class OutroController {
      @Delete(':id')
      @ExclusaoDelegada()
      apagar() {
        return null;
      }
    }
    expect(() =>
      guard.canActivate(
        contexto('DELETE', OutroController.prototype.apagar, 'COORDENACAO', { filiados: 'EDITAR' }, OutroController),
      ),
    ).toThrow('Apenas o Administrador pode excluir registros do sistema.');
  });

  it('o controller declara o módulo novo nos dois decoradores e marca as três exclusões', () => {
    const inicio = CTRL.indexOf('export class DuplicidadeController');
    const decoradores = CTRL.slice(CTRL.lastIndexOf('@ApiTags', inicio), inicio);
    expect(decoradores).toContain("@Modulo('duplicados')");
    expect(decoradores).toContain("@ModuloTenant('duplicados')");
    expect(CTRL.match(/@OperacaoDeSistema\(\)/g)).toBeNull();
    expect(CTRL.match(/@ExclusaoDelegada\(\)/g)).toHaveLength(4);
  });
});

describe('o descarte tem volta', () => {
  type Decisao = { id: string; filiadoIdA: string; filiadoIdB: string; decisao: DecisaoDuplicata; autor: string | null; createdAt: Date };
  type Filiado = { id: string; nomeCompleto: string; matricula: string; cidade: string | null; cpf: string | null; dataNascimento: Date | null };

  const maria3520: Filiado = { id: 'f-3520', nomeCompleto: 'MARIA DA CRUZ DE SOUSA', matricula: '3520', cidade: null, cpf: null, dataNascimento: null };
  const maria3746: Filiado = { id: 'f-3746', nomeCompleto: 'MARIA DA CRUZ DE SOUSA', matricula: '3746', cidade: 'Teresina', cpf: null, dataNascimento: null };
  const alessandra: Filiado = { id: 'f-5353', nomeCompleto: 'ALESSANDRA DE SOUSA', matricula: '5353', cidade: 'Teresina', cpf: '11122233344', dataNascimento: null };

  function montar(decisoes: Decisao[], filiados: Filiado[]) {
    const auditoria: { descricao: string; entidade: string; metadata: Record<string, unknown> }[] = [];
    const prisma = {
      duplicataDecisao: {
        findMany: jest.fn(async ({ where }: { where: { decisao: DecisaoDuplicata } }) =>
          decisoes.filter((d) => d.decisao === where.decisao)),
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => decisoes.find((d) => d.id === where.id) ?? null),
        deleteMany: jest.fn(async ({ where }: { where: { id: string; decisao: DecisaoDuplicata } }) => {
          const i = decisoes.findIndex((d) => d.id === where.id && d.decisao === where.decisao);
          if (i < 0) return { count: 0 };
          decisoes.splice(i, 1);
          return { count: 1 };
        }),
        upsert: jest.fn(async () => ({ id: 'dec-nova' })),
      },
      filiado: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          filiados.filter((f) => where.id.in.includes(f.id))),
        count: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          filiados.filter((f) => where.id.in.includes(f.id)).length),
      },
    };
    const audit = { registrar: jest.fn(async (x: (typeof auditoria)[number]) => { auditoria.push(x); }) };
    return { svc: new DuplicidadeService(prisma as never, audit as never), decisoes, auditoria };
  }

  const marcadaPelaCoordenacao = (): Decisao => ({
    id: 'dec-maria', filiadoIdA: 'f-3520', filiadoIdB: 'f-3746', decisao: DecisaoDuplicata.DISTINTOS,
    autor: 'Julian Helton', createdAt: new Date('2026-09-02T12:06:00Z'),
  });

  it('lista o par da MARIA DA CRUZ com quem marcou; consolidação e par sem um dos cadastros ficam de fora', async () => {
    const { svc } = montar(
      [
        marcadaPelaCoordenacao(),
        { id: 'dec-fundido', filiadoIdA: 'f-5353', filiadoIdB: 'f-5176', decisao: DecisaoDuplicata.FUNDIDO, autor: 'Administração Geral', createdAt: new Date('2026-08-04T13:01:00Z') },
        { id: 'dec-orfa', filiadoIdA: 'f-5353', filiadoIdB: 'f-apagado', decisao: DecisaoDuplicata.DISTINTOS, autor: null, createdAt: new Date('2026-08-04T13:03:00Z') },
      ],
      [maria3520, maria3746, alessandra],
    );
    const lista = await svc.listarDescartados();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: 'dec-maria', autor: 'Julian Helton' });
    expect(lista[0].cadastros.map((c) => c.matricula)).toEqual(['3520', '3746']);
  });

  it('devolve à fila, e a auditoria diz o par e quem tinha marcado', async () => {
    const { svc, decisoes, auditoria } = montar([marcadaPelaCoordenacao()], [maria3520, maria3746]);
    await expect(svc.voltarParaFila('dec-maria', 'João Pedro')).resolves.toEqual({ ok: true });
    expect(decisoes).toHaveLength(0);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].entidade).toBe('DuplicataDecisao');
    expect(auditoria[0].descricao).toContain('MARIA DA CRUZ DE SOUSA (3520) × MARIA DA CRUZ DE SOUSA (3746)');
    expect(auditoria[0].descricao).toContain('por Julian Helton');
    expect(auditoria[0].metadata).toMatchObject({ marcadoPor: 'Julian Helton', devolvidoPor: 'João Pedro' });
  });

  it('consolidação não volta, e a decisão continua gravada', async () => {
    const fundido: Decisao = { ...marcadaPelaCoordenacao(), id: 'dec-f', decisao: DecisaoDuplicata.FUNDIDO };
    const { svc, decisoes, auditoria } = montar([fundido], [maria3520]);
    await expect(svc.voltarParaFila('dec-f')).rejects.toBeInstanceOf(BadRequestException);
    expect(decisoes).toHaveLength(1);
    expect(auditoria).toHaveLength(0);
  });

  it('o segundo clique não audita de novo', async () => {
    const { svc, auditoria } = montar([marcadaPelaCoordenacao()], [maria3520, maria3746]);
    await svc.voltarParaFila('dec-maria');
    await expect(svc.voltarParaFila('dec-maria')).rejects.toBeInstanceOf(NotFoundException);
    expect(auditoria).toHaveLength(1);
  });

  it('marcar devolve o id da decisão, para o "Desfazer" do aviso', async () => {
    const { svc } = montar([], [maria3520, maria3746]);
    await expect(svc.marcarDistintos('f-3746', 'f-3520', 'João Pedro')).resolves.toEqual({ ok: true, id: 'dec-nova' });
  });
});

/**
 * "E QUANDO É 3 OU 4 DUPLICADOS? COMO FAZ? NEM O BOTÃO É MOSTRADO." — 17/09/2026.
 *
 * Era beco sem saída: a tela escondia "Consolidar" em grupo de 3+ e ainda dizia
 * "consolide dois de cada vez", sem que houvesse como. Na produção: 228 grupos
 * (198 de três, 23 de quatro, um de sete) e 724 cadastros parados ali.
 */
describe('grupo de três ou mais', () => {
  type Registro = { id: string; cpf: string | null; nomeCompleto: string; matricula: string };

  function montarGrupo(registros: Registro[]) {
    /** Cada par gravado, na ordem — é o que prova que o grupo inteiro foi julgado. */
    const pares: string[] = [];
    const prisma = {
      filiado: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          registros.filter((r) => where.id.in.includes(r.id))),
        count: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
          registros.filter((r) => where.id.in.includes(r.id)).length),
      },
      duplicataDecisao: {
        upsert: jest.fn(async ({ where }: { where: { filiadoIdA_filiadoIdB: { filiadoIdA: string; filiadoIdB: string } } }) => {
          const { filiadoIdA, filiadoIdB } = where.filiadoIdA_filiadoIdB;
          pares.push(`${filiadoIdA}|${filiadoIdB}`);
          return { id: `dec-${pares.length}` };
        }),
      },
    };
    const svc = new DuplicidadeService(prisma as never, { registrar: jest.fn() } as never);
    const fundidos: string[] = [];
    // A fusão de dois já é testada à parte; aqui o que importa é a ORDEM e o que o grupo faz com a falha.
    (svc as unknown as { fundir: (m: string, d: string) => Promise<unknown> }).fundir = jest.fn(async (_m, d) => {
      if (d === 'f-erro') throw new Error('Filiado a descartar não encontrado.');
      fundidos.push(d);
      return { ok: true, camposAbsorvidos: d === 'f-4045' ? ['telefone'] : [], vinculosTransferidos: 1 };
    });
    return { svc, fundidos, pares };
  }

  const alvaro: Registro[] = [
    { id: 'f-008005', cpf: '02678885380', nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '008005' },
    { id: 'f-4045', cpf: null, nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '4045' },
    { id: 'f-4829', cpf: null, nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '4829' },
  ];

  it('consolida os dois vazios no que tem CPF, somando o que foi aproveitado', async () => {
    const { svc, fundidos } = montarGrupo(alvaro);
    await expect(svc.fundirGrupo('f-008005', ['f-4045', 'f-4829'], 'Ana Bianca')).resolves.toEqual({
      ok: true, fundidos: 2, camposAbsorvidos: ['telefone'], vinculosTransferidos: 2, falhas: [],
    });
    expect(fundidos).toEqual(['f-4045', 'f-4829']);
  });

  it('CPF diferente barra o grupo INTEIRO antes de apagar qualquer coisa', async () => {
    const outroCpf = [...alvaro, { id: 'f-9999', cpf: '11122233344', nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '9999' }];
    const { svc, fundidos } = montarGrupo(outroCpf);
    await expect(svc.fundirGrupo('f-008005', ['f-4045', 'f-9999'])).rejects.toThrow(/9999/);
    expect(fundidos).toEqual([]);
  });

  it('cadastro que sumiu entre a tela e o clique não funde nada pela metade', async () => {
    const { svc, fundidos } = montarGrupo(alvaro);
    await expect(svc.fundirGrupo('f-008005', ['f-4045', 'f-sumiu'])).rejects.toThrow(/não existe mais/);
    expect(fundidos).toEqual([]);
  });

  it('uma falha no meio não derruba as outras: volta na resposta', async () => {
    const comErro = [...alvaro, { id: 'f-erro', cpf: null, nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '7777' }];
    const { svc, fundidos } = montarGrupo(comErro);
    const r = await svc.fundirGrupo('f-008005', ['f-4045', 'f-erro', 'f-4829']);
    expect(r.fundidos).toBe(2);
    expect(r.ok).toBe(false);
    expect(r.falhas).toEqual([{ matricula: '7777', motivo: 'Filiado a descartar não encontrado.' }]);
    expect(fundidos).toEqual(['f-4045', 'f-4829']);
  });

  it('o mantido na lista de descartados é ignorado, e sem ninguém para remover recusa', async () => {
    const { svc, fundidos } = montarGrupo(alvaro);
    const r = await svc.fundirGrupo('f-008005', ['f-008005', 'f-4045', 'f-4045']);
    expect(r.fundidos).toBe(1);
    expect(fundidos).toEqual(['f-4045']);
    await expect(svc.fundirGrupo('f-008005', ['f-008005'])).rejects.toThrow(/ao menos um/);
  });

  it('"não é duplicado" num grupo de três marca os TRÊS pares — senão o grupo volta', async () => {
    const { svc, pares } = montarGrupo(alvaro);
    const r = await svc.marcarGrupoDistinto(['f-008005', 'f-4045', 'f-4829'], 'Ivo Ramos');
    expect(r.ids).toHaveLength(3);
    expect(new Set(pares).size).toBe(3);
    // Sempre A < B: o mesmo par nunca é gravado duas vezes em ordens diferentes.
    for (const p of pares) {
      const [a, b] = p.split('|');
      expect(a < b).toBe(true);
    }
  });

  it('quatro cadastros dão seis pares, e menos de dois é recusado', async () => {
    const quatro = [...alvaro, { id: 'f-1234', cpf: null, nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '1234' }];
    const { svc } = montarGrupo(quatro);
    expect((await svc.marcarGrupoDistinto(quatro.map((r) => r.id))).ids).toHaveLength(6);
    await expect(svc.marcarGrupoDistinto(['f-4045'])).rejects.toThrow(/dois cadastros/);
  });

  /**
   * "NUM GRUPO DE CINCO, E SE UM DELES EU NÃO CONCORDO QUE É DUPLICATA?" —
   * 17/09/2026. Tirar um não pode julgar os que ficam.
   */
  it('tirar um do grupo o marca contra CADA um dos outros, e só isso', async () => {
    const cinco = [
      ...alvaro,
      { id: 'f-1234', cpf: null, nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '1234' },
      { id: 'f-5678', cpf: '99988877766', nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO', matricula: '5678' },
    ];
    const { svc, pares } = montarGrupo(cinco);
    const r = await svc.marcarForaDoGrupo('f-5678', ['f-008005', 'f-4045', 'f-4829', 'f-1234'], 'Ana Bianca');
    expect(r.ids).toHaveLength(4);
    // Quatro pares, todos com quem saiu; os que ficaram não foram julgados entre si.
    expect(pares).toHaveLength(4);
    expect(pares.every((p) => p.split('|').includes('f-5678'))).toBe(true);
    expect(pares.some((p) => p === 'f-008005|f-4045' || p === 'f-4045|f-008005')).toBe(false);
  });

  it('tirar um sem dizer de quem, ou tirar a si mesmo, é recusado', async () => {
    const { svc } = montarGrupo(alvaro);
    await expect(svc.marcarForaDoGrupo('f-4045', [])).rejects.toThrow(/outros cadastros/);
    await expect(svc.marcarForaDoGrupo('f-4045', ['f-4045'])).rejects.toThrow(/outros cadastros/);
  });

  it('o lote também aproveita o grupo de três em que só um cadastro tem dado', async () => {
    const { svc } = montarGrupo(alvaro);
    /*
      O DADO É LIDO DOS CAMPOS, NÃO DA PONTUAÇÃO (18/09/2026). O fixture passava
      só `pontuacao`, e o critério do lote deixou de usá-la: `cidade` pontua e
      NÃO é dado a perder, então quem decide agora é o que está preenchido.
    */
    const cand = (id: string, matricula: string, dados: Record<string, unknown> = {}) => ({
      id, matricula, nomeCompleto: 'ÁLVARO ROGÉRIO VILARINHO',
      cpf: null, numeroCoren: null, dataNascimento: null, telefonePrincipal: null,
      email: null, endereco: null, temFoto: false, vinculos: 0, ...dados,
    });
    (svc as unknown as { varrer: () => Promise<unknown[]> }).varrer = async () => [
      // Um com CPF e dois com nada além da cidade — a fatia que o lote existe para resolver.
      { contradicoes: [], candidatos: [
        cand('f-008005', '008005', { cpf: '12345678900', endereco: 'Rua A, 100' }),
        cand('f-4045', '4045', { cidade: 'Teresina' }),
        cand('f-4829', '4829'),
      ] },
      // Dois com dado: o lote não escolhe por ninguém.
      { contradicoes: [], candidatos: [
        cand('f-a', 'a', { cpf: '98765432100' }), cand('f-b', 'b', { telefonePrincipal: '86999990000' }),
      ] },
      // Com contradição, nunca.
      { contradicoes: ['CPF'], candidatos: [cand('f-c', 'c', { cpf: '11122233344' }), cand('f-d', 'd')] },
    ];
    const itens = await svc.elegiveisParaLote();
    expect(itens.map((i) => i.descartarMatricula)).toEqual(['4045', '4829']);
    expect(itens.every((i) => i.manterMatricula === '008005')).toBe(true);
  });
});
