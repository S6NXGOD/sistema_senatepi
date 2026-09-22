import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DuplicidadeService, nomeQueNaoEhNome } from './duplicidade.service';

/**
 * REMOVER O GRUPO QUE NÃO TEM NINGUÉM — 22/09/2026.
 *
 * O CASO. O dono abriu a fila e encontrou QUATRO fichas chamadas **"0"**, todas
 * da carga de 03/07/2026, e a única saída oferecida era *"Consolidar 4 mantendo
 * 3067"* — que deixa de pé uma ficha chamada "0". A pergunta foi direta:
 * *"esse aí não serve para nada. Como posso remover todos?"*.
 *
 * ESTA AÇÃO NÃO É ATALHO PARA A FILA DOS 148. Fundir por nome, nesta base,
 * apagaria gente: nos 3 grupos em que existe veredito (as duas fichas têm CPF),
 * os CPFs eram DIFERENTES nos 3. Aqui não há pessoa nenhuma para apagar — há
 * linha de importação com o nome em branco.
 *
 * AS TRÊS TRAVAS, e é este spec que as segura:
 *   1. o NOME não é nome;
 *   2. NENHUM dado que identifique alguém;
 *   3. NENHUM histórico.
 *
 * Basta UMA ficha do grupo falhar em uma delas e NADA é apagado. O contraste
 * está na própria produção: a ficha "AIM" tem três letras — e tem CPF. É gente
 * de verdade com o nome perdido, e o que ela precisa é correção de nome.
 */

const VAZIO = {
  cpf: null, numeroCoren: null, dataNascimento: null,
  telefonePrincipal: null, telefoneSecundario: null, email: null,
  endereco: null, cidade: null,
  _count: { vinculos: 0, atendimentos: 0, dependentes: 0, partesProcesso: 0, compromissos: 0 },
};

const ficha = (id: string, nomeCompleto: string, extra: Record<string, unknown> = {}) => ({
  id, nomeCompleto, matricula: id, ...VAZIO, ...extra,
});

function montar(
  registros: Array<Record<string, unknown>>,
  opcoes: { auditoriaFalha?: boolean; deleteFalhaNo?: number } = {},
) {
  const apagados: string[] = [];
  let n = 0;
  const apagar = async ({ where }: { where: { id: string } }) => {
    n++;
    if (opcoes.deleteFalhaNo === n) throw new Error('banco recusou');
    apagados.push(where.id);
    return {};
  };
  const prisma = {
    filiado: { findMany: jest.fn().mockResolvedValue(registros), delete: jest.fn(apagar) },
    /*
      A TRANSAÇÃO DE VERDADE DESFAZ; este arnês só precisa provar que os DELETE
      acontecem DENTRO dela. Quando um deles quebra, o mock deixa o erro subir e
      a lista de apagados fica como estava — o teste então afirma que o serviço
      não seguiu apagando os outros.
    */
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({
      filiado: { delete: jest.fn(apagar) },
    })),
  };
  const audit = {
    registrar: opcoes.auditoriaFalha
      ? jest.fn().mockRejectedValue(new Error('auditoria fora do ar'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const service = new DuplicidadeService(prisma as never, audit as never);
  return { service, apagados, audit, prisma };
}

describe('o nome que não é nome', () => {
  it('só dígitos não é nome — é o caso real das quatro fichas "0"', () => {
    expect(nomeQueNaoEhNome('0')).toBe(true);
    expect(nomeQueNaoEhNome('0000')).toBe(true);
    expect(nomeQueNaoEhNome('  12 ')).toBe(true);
  });

  it('vazio não é nome', () => {
    expect(nomeQueNaoEhNome('')).toBe(true);
    expect(nomeQueNaoEhNome('   ')).toBe(true);
    expect(nomeQueNaoEhNome(null)).toBe(true);
  });

  /** Menos de quatro letras: "AIM" cai aqui, e é por isso que sozinha ela não decide. */
  it('menos de quatro letras não passa sozinho', () => {
    expect(nomeQueNaoEhNome('AIM')).toBe(true);
    expect(nomeQueNaoEhNome('ANA')).toBe(true);
  });

  it('nome de gente é nome', () => {
    expect(nomeQueNaoEhNome('MARIA DA SILVA')).toBe(false);
    expect(nomeQueNaoEhNome('JOSÉ')).toBe(false);
    expect(nomeQueNaoEhNome('ÉRICA CINARA FRAZÃO PESSOA')).toBe(false);
  });
});

describe('descartar o grupo vazio', () => {
  it('apaga as quatro fichas "0" — o caso do print', async () => {
    const { service, apagados, audit } = montar([
      ficha('3067', '0'), ficha('3124', '0'), ficha('3169', '0'), ficha('3451', '0'),
    ]);
    const r = await service.descartarGrupoVazio(['3067', '3124', '3169', '3451'], 'joão');
    expect(r).toEqual({
      ok: true, removidos: 4, matriculas: ['3067', '3124', '3169', '3451'], semAuditoria: 0,
    });
    expect(apagados).toHaveLength(4);
    expect(audit.registrar).toHaveBeenCalledTimes(4);
  });

  /**
   * A TRAVA QUE MAIS IMPORTA. "AIM" é o caso real: três letras, mas COM CPF.
   * Se esta passar, o sistema apaga gente de verdade cujo nome se perdeu na
   * importação — e o que ela precisa é que alguém corrija o nome.
   */
  it('ficha com CPF não é linha vazia, e NADA é apagado', async () => {
    const { service, apagados } = montar([
      ficha('3067', '0'),
      ficha('008034', 'AIM', { cpf: '04487129389' }),
    ]);
    await expect(service.descartarGrupoVazio(['3067', '008034'])).rejects.toThrow(
      BadRequestException,
    );
    expect(apagados).toHaveLength(0);
  });

  it('a recusa diz QUAL ficha e POR QUÊ', async () => {
    const { service } = montar([
      ficha('3067', '0'),
      ficha('008034', 'AIM', { cpf: '04487129389' }),
    ]);
    const erro = (await service
      .descartarGrupoVazio(['3067', '008034'])
      .catch((e: unknown) => e)) as Error;
    expect(erro.message).toContain('008034');
    expect(erro.message).toContain('CPF');
    expect(erro.message).toContain('Nada foi apagado');
  });

  it('nome de gente barra o grupo inteiro', async () => {
    const { service, apagados } = montar([
      ficha('1', 'MARIA DA SILVA'), ficha('2', 'MARIA DA SILVA'),
    ]);
    await expect(service.descartarGrupoVazio(['1', '2'])).rejects.toThrow(/nome é um nome de gente/);
    expect(apagados).toHaveLength(0);
  });

  /** Histórico é gente que passou pelo sindicato, mesmo sem dado na ficha. */
  it.each([
    ['vínculo profissional', { vinculos: 1 }],
    ['atendimento', { atendimentos: 2 }],
    ['dependente', { dependentes: 1 }],
    ['processo', { partesProcesso: 1 }],
    ['atividade na agenda', { compromissos: 3 }],
  ])('%s impede o descarte', async (_nome, contagem) => {
    const { service, apagados } = montar([
      ficha('1', '0'),
      ficha('2', '0', { _count: { ...VAZIO._count, ...contagem } }),
    ]);
    await expect(service.descartarGrupoVazio(['1', '2'])).rejects.toThrow(BadRequestException);
    expect(apagados).toHaveLength(0);
  });

  it.each([
    ['COREN', { numeroCoren: 'PI-123' }],
    ['data de nascimento', { dataNascimento: new Date('1985-03-12') }],
    ['telefone', { telefonePrincipal: '86 99999-0000' }],
    ['e-mail', { email: 'a@b.c' }],
    ['cidade', { cidade: 'Teresina' }],
  ])('%s impede o descarte', async (_nome, campos) => {
    const { service, apagados } = montar([ficha('1', '0'), ficha('2', '0', campos)]);
    await expect(service.descartarGrupoVazio(['1', '2'])).rejects.toThrow(BadRequestException);
    expect(apagados).toHaveLength(0);
  });

  it('uma ficha só não é grupo', async () => {
    const { service } = montar([ficha('1', '0')]);
    await expect(service.descartarGrupoVazio(['1'])).rejects.toThrow(/ao menos dois/);
  });

  it('ficha que sumiu da base recusa o lote inteiro', async () => {
    const { service, apagados } = montar([ficha('1', '0')]);
    await expect(service.descartarGrupoVazio(['1', '2'])).rejects.toThrow(NotFoundException);
    expect(apagados).toHaveLength(0);
  });

  /** A auditoria é o que resta depois: precisa dizer o nome e a matrícula. */
  it('a auditoria guarda a matrícula e o nome do que sumiu', async () => {
    const { service, audit } = montar([ficha('3067', '0'), ficha('3124', '0')]);
    await service.descartarGrupoVazio(['3067', '3124'], 'joão');
    const chamada = audit.registrar.mock.calls[0][0];
    expect(chamada.acao).toBe('DELETE');
    expect(chamada.entidade).toBe('Filiado');
    expect(chamada.descricao).toContain('3067');
    expect(chamada.metadata.matricula).toBe('3067');
  });

  /**
   * O AUTOR É UM NOME, NÃO UM ID — e este teste existe porque a primeira versão
   * mandava `userId: autor` e a rota devolvia **500**: a coluna é chave
   * estrangeira para `users`. Os 21 testes daqui passaram assim mesmo, porque o
   * `audit` deste arnês é um mock e engole qualquer campo. Quem reprovou foi
   * chamar a rota de verdade.
   */
  it('o autor vai no TEXTO e no metadata, nunca como userId', async () => {
    const { service, audit } = montar([ficha('3067', '0'), ficha('3124', '0')]);
    await service.descartarGrupoVazio(['3067', '3124'], 'João Pedro');
    const chamada = audit.registrar.mock.calls[0][0];
    expect(chamada.userId).toBeUndefined();
    expect(chamada.descricao).toContain('João Pedro');
    expect(chamada.metadata.autor).toBe('João Pedro');
  });
});

/**
 * TUDO OU NADA — a lição que custou duas fichas da produção (22/09/2026).
 *
 * A primeira versão apagava num laço solto: `delete`, auditoria, próxima. A
 * auditoria quebrou (mandei o NOME num campo que é id), a rota respondeu 500 —
 * e as fichas já apagadas NÃO voltaram. O dono clicou duas vezes vendo
 * "Internal server error" as duas, e sumiram DUAS fichas sem uma linha de
 * auditoria, com a tela dizendo que nada tinha acontecido.
 */
describe('a exclusão é tudo ou nada', () => {
  it('os DELETE acontecem dentro de uma transação', async () => {
    const { service, prisma } = montar([ficha('1', '0'), ficha('2', '0')]);
    await service.descartarGrupoVazio(['1', '2']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  /** Quebrou no meio: o que já saiu volta pela transação, e o resto nem tenta. */
  it('se um DELETE falha, o serviço não segue apagando os outros', async () => {
    const { service, apagados } = montar(
      [ficha('1', '0'), ficha('2', '0'), ficha('3', '0')],
      { deleteFalhaNo: 2 },
    );
    await expect(service.descartarGrupoVazio(['1', '2', '3'])).rejects.toThrow('banco recusou');
    expect(apagados).toEqual(['1']);
  });

  /**
   * AUDITORIA FORA DO AR NÃO DERRUBA A RESPOSTA. As fichas já não existem —
   * responder 500 faria a pessoa achar que nada aconteceu e clicar de novo, que
   * foi exatamente o que aconteceu. A resposta conta quantas ficaram sem linha.
   */
  it('auditoria que falha vira aviso, não erro', async () => {
    const { service, apagados } = montar([ficha('1', '0'), ficha('2', '0')], {
      auditoriaFalha: true,
    });
    const r = await service.descartarGrupoVazio(['1', '2']);
    expect(r.ok).toBe(true);
    expect(r.removidos).toBe(2);
    expect(r.semAuditoria).toBe(2);
    expect(apagados).toHaveLength(2);
  });

  it('no caminho normal, nenhuma exclusão fica sem auditoria', async () => {
    const { service } = montar([ficha('1', '0'), ficha('2', '0')]);
    expect((await service.descartarGrupoVazio(['1', '2'])).semAuditoria).toBe(0);
  });
});
