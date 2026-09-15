import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DecisaoDuplicata } from '@prisma/client';
import { PermissionsGuard } from '../../common/permissions/permissions.guard';
import { DuplicidadeController } from './duplicidade.controller';
import { DuplicidadeService } from './duplicidade.service';

const CTRL = readFileSync(join(__dirname, 'duplicidade.controller.ts'), 'utf8');

/**
 * "PARA ALGUMAS PESSOAS, COMO TRIAGEM, NÃO APARECE O BOTÃO DE CONSOLIDAR.
 * APARECE APENAS O OUTRO." — 15/09/2026.
 *
 * O outro era o "não é duplicado", que tira o par da fila para sempre. Quem não
 * podia consolidar podia esconder o par de quem podia: 2 dos 3 descartes da
 * produção vieram da Coordenação.
 */
describe('a fila de duplicados de filiados é do Administrador, inteira', () => {
  const guard = new PermissionsGuard(new Reflector());
  const contexto = (metodo: string, handler: (...args: never[]) => unknown, role: string) =>
    ({
      getHandler: () => handler,
      getClass: () => DuplicidadeController,
      switchToHttp: () => ({ getRequest: () => ({ method: metodo, user: { id: 'u1', role, permissoes: {} } }) }),
    }) as never;
  const P = DuplicidadeController.prototype;

  it('Triagem e Coordenação, que têm filiados EDITAR, não marcam "não é duplicado"', () => {
    for (const role of ['TRIAGEM', 'COORDENACAO']) {
      expect(() => guard.canActivate(contexto('POST', P.distintos, role))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(contexto('POST', P.distintos, role))).toThrow(/operação de sistema/);
    }
  });

  it('nem veem a fila ou o aviso: a status fecha junto', () => {
    expect(() => guard.canActivate(contexto('GET', P.status, 'TRIAGEM'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contexto('GET', P.listar, 'COORDENACAO'))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contexto('GET', P.descartados, 'COORDENACAO'))).toThrow(ForbiddenException);
  });

  it('o Administrador faz tudo, inclusive devolver o par à fila', () => {
    expect(guard.canActivate(contexto('POST', P.distintos, 'ADMINISTRADOR'))).toBe(true);
    expect(guard.canActivate(contexto('DELETE', P.voltarParaFila, 'ADMINISTRADOR'))).toBe(true);
  });

  it('o decorador está na classe, uma vez só', () => {
    const inicio = CTRL.indexOf('export class DuplicidadeController');
    const decoradores = CTRL.slice(CTRL.lastIndexOf('@ApiTags', inicio), inicio);
    expect(decoradores).toContain('@OperacaoDeSistema()');
    expect(decoradores).toContain("@Modulo('filiados')");
    expect(CTRL.match(/@OperacaoDeSistema\(\)/g)).toHaveLength(1);
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
