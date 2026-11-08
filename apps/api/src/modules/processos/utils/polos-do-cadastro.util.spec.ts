import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { ProcessosService } from '../processos.service';
import {
  FRASE_DO_POLO_QUE_FALTA, poloQueFalta, poloQueFaltaNasPartes, temPoloAtivo, temPoloPassivo,
} from './polos-do-cadastro.util';

/**
 * NENHUM PROCESSO ENTRA SEM OS DOIS POLOS — pedido do dono em 07/11/2026.
 *
 * Medido na produção no mesmo dia: 28 dos 212 processos sem polo passivo.
 */
describe('o polo ativo conta em qualquer forma que a rota aceita', () => {
  it.each([
    ['o sindicato', { poloAtivo: { tipo: 'INSTITUCIONAL' } }],
    ['filiados pela lista', { poloAtivo: { tipo: 'FILIADOS', filiadoIds: ['f1'] } }],
    ['uma parte avulsa com nome', { poloAtivo: { tipo: 'OUTRA', nome: 'FUNDAÇÃO X' } }],
    ['as partes do caminho novo', { poloAtivo: { tipo: 'OUTRA', partes: [{ parteExternaId: 'org1' }] } }],
    ['o filiadoId antigo', { filiadoId: 'f1' }],
  ])('%s', (_caso, dto) => {
    expect(temPoloAtivo(dto)).toBe(true);
  });

  /* O formulário montava `{ tipo: 'OUTRA', partes: [] }` com o polo vazio. */
  it('a forma vazia que a tela montava não conta', () => {
    expect(temPoloAtivo({ poloAtivo: { tipo: 'OUTRA', partes: [] } })).toBe(false);
    expect(temPoloAtivo({ poloAtivo: { tipo: 'OUTRA', nome: '   ' } })).toBe(false);
    expect(temPoloAtivo({ poloAtivo: { tipo: 'FILIADOS', filiadoIds: [] } })).toBe(false);
  });
});

describe('o polo passivo', () => {
  it('conta pela lista nova e pelo réu único antigo', () => {
    expect(temPoloPassivo({ partesContrarias: [{ nome: 'MUNICÍPIO DE PARNAÍBA' }] })).toBe(true);
    expect(temPoloPassivo({ partesContrarias: [{ parteExternaId: 'org1' }] })).toBe(true);
    expect(temPoloPassivo({ parteContraria: { nome: 'ESTADO DO PIAUÍ' } })).toBe(true);
  });

  it('linha em branco não é réu', () => {
    expect(temPoloPassivo({ partesContrarias: [{ nome: '  ' }] })).toBe(false);
    expect(temPoloPassivo({ partesContrarias: [] })).toBe(false);
    expect(temPoloPassivo({})).toBe(false);
  });
});

describe('o que falta', () => {
  const ativo = { poloAtivo: { tipo: 'INSTITUCIONAL' } };
  const passivo = { partesContrarias: [{ nome: 'MUNICÍPIO DE PARNAÍBA' }] };

  it('diz exatamente qual polo falta', () => {
    expect(poloQueFalta({ ...ativo, ...passivo })).toBeNull();
    expect(poloQueFalta(ativo)).toBe('PASSIVO');
    expect(poloQueFalta(passivo)).toBe('ATIVO');
    expect(poloQueFalta({})).toBe('OS_DOIS');
  });

  it('na formalização, conta as partes já gravadas', () => {
    expect(poloQueFaltaNasPartes(['ATIVO', 'PASSIVO'])).toBeNull();
    expect(poloQueFaltaNasPartes(['ATIVO', 'TERCEIRO'])).toBe('PASSIVO');
    expect(poloQueFaltaNasPartes([])).toBe('OS_DOIS');
  });
});

/**
 * A RECUSA VEM ANTES DE PERGUNTAR AO CNJ. A consulta tem cota e leva de 20 a 60
 * segundos: recusar depois dela seria fazer a pessoa esperar para ouvir o que já
 * se sabia. O teste monta o serviço de verdade e prova que o DataJud nem é chamado.
 */
describe('o cadastro recusa sem os dois polos', () => {
  const montar = () => {
    const datajud = { buscarInstanciasPorNPU: jest.fn() };
    const prisma = { processo: { findUnique: jest.fn(async () => null) } };
    const svc = new ProcessosService(
      prisma as any, {} as any, datajud as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, datajud, prisma };
  };
  const NPU = '00009216320158180031';

  it('sem polo passivo: recusa com a frase certa e nem consulta o CNJ', async () => {
    const { svc, datajud } = montar();
    const tentativa = svc.importar({ numeroCNJ: NPU, poloAtivo: { tipo: 'INSTITUCIONAL' } } as any, {} as any);
    await expect(tentativa).rejects.toBeInstanceOf(BadRequestException);
    await expect(tentativa).rejects.toThrow(FRASE_DO_POLO_QUE_FALTA.PASSIVO);
    expect(datajud.buscarInstanciasPorNPU).not.toHaveBeenCalled();
  });

  it('sem nenhum dos dois: pede os dois numa frase só', async () => {
    const { svc } = montar();
    await expect(svc.importar({ numeroCNJ: NPU } as any, {} as any)).rejects.toThrow(FRASE_DO_POLO_QUE_FALTA.OS_DOIS);
  });

  /* Antes até de ir ao banco: a recusa não depende de nada que esteja lá. */
  it('nem consulta o banco para recusar', async () => {
    const { svc, prisma } = montar();
    await expect(svc.importar({ numeroCNJ: NPU } as any, {} as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.processo.findUnique).not.toHaveBeenCalled();
  });
});

describe('a formalização do pré-processual também exige', () => {
  const SERVICO = readFileSync(join(__dirname, '../processos.service.ts'), 'utf8');
  const FN = SERVICO.slice(SERVICO.indexOf('async formalizar('), SERVICO.indexOf('async formalizar(') + 2400);

  it('conta as partes gravadas antes de aceitar o número', () => {
    expect(FN).toContain('const faltaNoCaso = poloQueFaltaNasPartes(polos.map((x) => x.polo));');
    expect(FN.indexOf('poloQueFaltaNasPartes')).toBeLessThan(FN.indexOf('Informe o número único (NPU)'));
  });
});
