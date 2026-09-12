import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrigemDaLigacao, TipoParteExterna } from '@prisma/client';
import { PartesExternasService, recusaDaMesclagem, tipoPelaNatureza } from './partes-externas.service';

/**
 * MESCLAGEM DE ORGANIZAÇÕES — as recusas, que são a parte que importa.
 *
 * Mesclar é a operação mais destrutiva do módulo: apaga um cadastro e reponta
 * processos, vínculos de emprego e o dossiê patronal. Não tem desfazer na tela.
 * Por isso o que estes casos exercitam não é o caminho feliz — é cada porta que
 * precisa continuar FECHADA, porque abrir qualquer uma delas custa dado real.
 *
 * O caminho feliz depende de transação e de quatro índices únicos do Postgres;
 * ele é exercitado contra um banco descartável, não com dublê — um mock diria
 * "passou" justamente nos casos em que o banco recusaria.
 */
describe('mesclar organizações — as recusas', () => {
  const parte = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'a', nome: 'HOSPITAL X', nomeFantasia: null, documento: null,
    tipo: TipoParteExterna.JURIDICA, email: null, telefone: null,
    cidade: null, uf: null, observacoes: null, institucional: false, ativo: true,
    dossiePatronal: null, _count: { participacoes: 0, vinculos: 0 },
    ...over,
  });

  const servicoCom = (fica: unknown, dup: unknown) => {
    const prisma = {
      parteExterna: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.parteExterna.findUnique
      .mockResolvedValueOnce(fica)
      .mockResolvedValueOnce(dup);
    return new PartesExternasService(
      prisma as never,
      { registrar: jest.fn() } as never,
      { consultar: jest.fn() } as never,
    );
  };

  it('recusa mesclar uma organização nela mesma', async () => {
    const svc = servicoCom(parte(), parte());
    await expect(svc.mesclar('a', 'a', {})).rejects.toThrow(BadRequestException);
  });

  /**
   * A parte institucional é o próprio sindicato, polo ativo de toda ação
   * coletiva. Apagá-la numa mesclagem deixaria as ações sem autor — e ela é
   * localizada por uma FLAG, não por id fixo, então nada no código a protegeria.
   */
  it('recusa APAGAR a organização institucional', async () => {
    const svc = servicoCom(parte({ id: 'a' }), parte({ id: 'b', institucional: true }));
    await expect(svc.mesclar('a', 'b', {})).rejects.toThrow(
      /institucional .*não pode ser removida/,
    );
  });

  /**
   * `empresas.parte_externa_id` é único: com dossiê nos dois lados, repontar
   * estouraria no meio da transação. Mas o motivo de recusar não é o índice —
   * é que ali há contribuição lançada no caixa e credencial de portal.
   */
  it('recusa quando AS DUAS têm dossiê patronal', async () => {
    const svc = servicoCom(
      parte({ id: 'a', dossiePatronal: { id: 'e1' } }),
      parte({ id: 'b', dossiePatronal: { id: 'e2' } }),
    );
    await expect(svc.mesclar('a', 'b', {})).rejects.toThrow(ConflictException);
  });

  /** Documentos diferentes = provavelmente organizações diferentes. */
  it('recusa quando os documentos divergem', async () => {
    const svc = servicoCom(
      parte({ id: 'a', documento: '11111111000191' }),
      parte({ id: 'b', documento: '22222222000191' }),
    );
    await expect(svc.mesclar('a', 'b', {})).rejects.toThrow(/documentos são diferentes/i);
  });

  /** Um lado sem documento é o caso NORMAL: cadastro antigo feito só pelo nome. */
  it('NÃO recusa quando só um lado tem documento', async () => {
    const svc = servicoCom(
      parte({ id: 'a', documento: '11111111000191' }),
      parte({ id: 'b', documento: null }),
    );
    // Passa das validações e chega na transação (que aqui é dublê).
    await expect(svc.mesclar('a', 'b', {})).resolves.toBeDefined();
  });
});

/**
 * A CLASSIFICAÇÃO VINDA DA RECEITA.
 *
 * No cadastro de produção havia prefeitura como "Empresa" — não por descuido,
 * mas porque a distinção não é óbvia para quem digita e o campo vinha em
 * branco. A natureza jurídica é essa classificação feita por quem tem
 * autoridade para fazê-la.
 */
describe('tipo pela natureza jurídica', () => {
  it.each([
    ['Município', TipoParteExterna.ORGAO_PUBLICO],
    ['Autarquia Estadual', TipoParteExterna.ORGAO_PUBLICO],
    ['Fundação Pública de Direito Público Municipal', TipoParteExterna.ORGAO_PUBLICO],
    ['Órgão Público do Poder Executivo Federal', TipoParteExterna.ORGAO_PUBLICO],
    ['Secretaria de Estado', TipoParteExterna.ORGAO_PUBLICO],
    ['Sociedade Empresária Limitada', TipoParteExterna.JURIDICA],
    ['Empresário Individual', TipoParteExterna.JURIDICA],
    ['Associação Privada', TipoParteExterna.JURIDICA],
  ])('%s -> %s', (natureza, esperado) => {
    expect(tipoPelaNatureza(natureza)).toBe(esperado);
  });

  /** Sem informação, mantém o padrão de hoje em vez de inventar um. */
  it('sem natureza informada, assume pessoa jurídica', () => {
    expect(tipoPelaNatureza(null)).toBe(TipoParteExterna.JURIDICA);
    expect(tipoPelaNatureza('')).toBe(TipoParteExterna.JURIDICA);
  });

  /** Acento e caixa vêm da Receita sem padrão fixo. */
  it('não depende de acento nem de caixa', () => {
    expect(tipoPelaNatureza('MUNICIPIO')).toBe(TipoParteExterna.ORGAO_PUBLICO);
    expect(tipoPelaNatureza('município')).toBe(TipoParteExterna.ORGAO_PUBLICO);
  });
});

/** A tela pergunta antes do clique pela MESMA função que recusa no servidor. */
describe('a regra da recusa é uma só', () => {
  const lado = (over: Partial<{ documento: string | null; dossiePatronal: { id: string } | null; institucional: boolean }> = {}) => ({
    documento: null, dossiePatronal: null, institucional: false, ...over,
  });

  it('o sindicato nunca é o que some — mas pode ser o que continua', () => {
    expect(recusaDaMesclagem(lado(), lado({ institucional: true }))?.tipo).toBe('PEDIDO_INVALIDO');
    expect(recusaDaMesclagem(lado({ institucional: true }), lado())).toBeNull();
  });

  it('CNPJ num lado só não é conflito; dois CNPJs diferentes são', () => {
    expect(recusaDaMesclagem(lado({ documento: '05522917000170' }), lado())).toBeNull();
    expect(
      recusaDaMesclagem(lado({ documento: '05522917000170' }), lado({ documento: '11111111000191' }))?.tipo,
    ).toBe('CONFLITO');
  });
});

/**
 * O PAR DA PRODUÇÃO EM 12/09/2026: a FMS/THE tem o CNPJ, os processos e os
 * vínculos; a "Fundação Municipal de Saúde." tem o tipo certo, a sigla e a
 * ligação com Teresina. Juntar sem escolha perdia exatamente o que a segunda
 * tinha de melhor.
 */
describe('mesclar escolhendo o que fica — a FMS', () => {
  const fms = {
    id: 'fms', nome: 'FMS/THE', nomeFantasia: 'FMS Teresina', documento: '05522917000170',
    tipo: TipoParteExterna.JURIDICA, email: null, telefone: null, cidade: 'Teresina', uf: 'PI',
    observacoes: null, institucional: false, ativo: true, enteCodigo: null, enteOrigem: null,
    dossiePatronal: null, _count: { participacoes: 10, vinculos: 15 },
  };
  const fundacao = {
    ...fms, id: 'fundacao', nome: 'Fundação Municipal de Saúde.', nomeFantasia: 'FMS', documento: null,
    tipo: TipoParteExterna.ORGAO_PUBLICO, enteCodigo: 2211001, enteOrigem: OrigemDaLigacao.MANUAL,
    _count: { participacoes: 0, vinculos: 4 },
  };

  const montar = () => {
    const tx = {
      parteProcesso: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), delete: jest.fn() },
      vinculoProfissional: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) },
      empresa: { update: jest.fn() },
      parteExterna: { delete: jest.fn(), update: jest.fn() },
    };
    const prisma = {
      parteExterna: { findUnique: jest.fn().mockResolvedValueOnce(fms).mockResolvedValueOnce(fundacao) },
      ente: { findUnique: jest.fn().mockResolvedValue({ codigo: 2211001 }) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const audit = { registrar: jest.fn() };
    const svc = new PartesExternasService(prisma as never, audit as never, { consultar: jest.fn() } as never);
    return { svc, tx, prisma, audit };
  };

  it('sem escolha, completa o que está em branco — e agora herda o ente', async () => {
    const { svc, tx } = montar();
    const r = await svc.mesclar('fms', 'fundacao', {});
    expect(tx.parteExterna.update.mock.calls[0][0].data).toEqual({
      enteCodigo: 2211001,
      enteOrigem: OrigemDaLigacao.MANUAL,
    });
    expect(r.camposCompletados).toEqual(['enteCodigo']);
    expect(r.camposEscolhidos).toEqual([]);
  });

  it('com escolha, ficam o nome, a sigla e o tipo escolhidos — e o repontado leva o nome novo', async () => {
    const { svc, tx, audit } = montar();
    const r = await svc.mesclar('fms', 'fundacao', {}, {
      nome: ' Fundação Municipal de Saúde ', nomeFantasia: 'FMS', tipo: TipoParteExterna.ORGAO_PUBLICO,
    });
    expect(tx.parteExterna.update.mock.calls[0][0].data).toMatchObject({
      nome: 'Fundação Municipal de Saúde', nomeFantasia: 'FMS', tipo: TipoParteExterna.ORGAO_PUBLICO,
      enteCodigo: 2211001,
    });
    expect([...r.camposEscolhidos].sort()).toEqual(['nome', 'nomeFantasia', 'tipo']);
    expect(tx.vinculoProfissional.updateMany).toHaveBeenCalledWith({
      where: { parteExternaId: 'fundacao' },
      data: { parteExternaId: 'fms', empresa: 'Fundação Municipal de Saúde' },
    });
    expect(audit.registrar.mock.calls[0][0].descricao).toContain('passa a se chamar "Fundação Municipal de Saúde"');
    // Apagar antes de gravar: o documento é único e a duplicada ainda o teria.
    expect(tx.parteExterna.delete.mock.invocationCallOrder[0]).toBeLessThan(
      tx.parteExterna.update.mock.invocationCallOrder[0],
    );
  });

  it('mandar o valor que já é o da que fica não conta como escolha', async () => {
    const { svc } = montar();
    const r = await svc.mesclar('fms', 'fundacao', {}, { nome: 'FMS/THE', tipo: TipoParteExterna.JURIDICA });
    expect(r.camposEscolhidos).toEqual([]);
  });

  it('recusa tipo que não combina com o documento, antes de tocar em qualquer linha', async () => {
    const { svc, prisma } = montar();
    await expect(svc.mesclar('fms', 'fundacao', {}, { tipo: TipoParteExterna.FISICA })).rejects.toThrow(
      /CPF com 11 dígitos/,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('recusa nome em branco e ente que não existe', async () => {
    const primeiro = montar();
    await expect(primeiro.svc.mesclar('fms', 'fundacao', {}, { nome: '   ' })).rejects.toThrow(
      /não pode ficar em branco/,
    );
    const segundo = montar();
    segundo.prisma.ente.findUnique.mockResolvedValue(null);
    await expect(segundo.svc.mesclar('fms', 'fundacao', {}, { enteCodigo: 9999999 })).rejects.toThrow(/IBGE/);
    expect(segundo.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('comparar duas organizações', () => {
  const base = {
    nomeFantasia: null, email: null, telefone: null, uf: 'PI', observacoes: null, ativo: true,
    createdAt: new Date(), updatedAt: new Date(), enteOrigem: null, institucional: false, dossiePatronal: null,
  };
  const fms = {
    ...base, id: 'fms', nome: 'FMS/THE', documento: '05522917000170', tipo: TipoParteExterna.JURIDICA,
    cidade: 'Teresina', enteCodigo: null, ente: null, _count: { participacoes: 10, vinculos: 15 },
  };
  const fundacao = {
    ...base, id: 'fundacao', nome: 'Fundação Municipal de Saúde.', documento: null,
    tipo: TipoParteExterna.ORGAO_PUBLICO, cidade: 'Teresina', enteCodigo: 2211001,
    ente: { codigo: 2211001, nome: 'Teresina', uf: 'PI', esfera: 'M' }, _count: { participacoes: 0, vinculos: 4 },
  };

  const montar = (consultar: jest.Mock) => {
    const prisma = {
      parteExterna: { findUnique: jest.fn().mockResolvedValueOnce(fms).mockResolvedValueOnce(fundacao) },
      parteExternaNaoDuplicada: {
        findUnique: jest.fn().mockResolvedValue({ createdAt: new Date('2026-09-08T14:00:00Z'), descartadoPor: 'u1' }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ nome: 'Margareth Silva', nomeExibicao: 'Dra. Margareth' }) },
    };
    const svc = new PartesExternasService(prisma as never, { registrar: jest.fn() } as never, { consultar } as never);
    return { svc, prisma };
  };

  it('diz quem descartou e quando, o que a Receita diz, e sugere manter a de mais peso', async () => {
    const consultar = jest.fn().mockResolvedValue({
      cnpj: '05522917000170', razaoSocial: 'FUNDACAO MUNICIPAL DE SAUDE',
      naturezaJuridica: 'Fundação Pública de Direito Público Municipal',
    });
    const { svc, prisma } = montar(consultar);
    const c = await svc.comparar('fundacao', 'fms');
    // O par é procurado na ordem do banco, qualquer que seja a ordem da tela.
    expect(prisma.parteExternaNaoDuplicada.findUnique.mock.calls[0][0].where).toEqual({
      aId_bId: { aId: 'fms', bId: 'fundacao' },
    });
    expect(c.descartada).toEqual({ em: '2026-09-08T14:00:00.000Z', por: 'Dra. Margareth' });
    expect(consultar).toHaveBeenCalledWith('05522917000170');
    expect(c.receita?.tipoSugerido).toBe(TipoParteExterna.ORGAO_PUBLICO);
    expect(c.receitaFalhou).toBe(false);
    expect(c.recusaSeFicar).toEqual({ a: null, b: null });
  });

  it('com a Receita fora do ar, compara assim mesmo e avisa', async () => {
    const { svc } = montar(jest.fn().mockRejectedValue(new Error('timeout')));
    const c = await svc.comparar('fms', 'fundacao');
    expect(c.receita).toBeNull();
    expect(c.receitaFalhou).toBe(true);
    expect(c.sugestaoFica).toBe('fms');
  });
});
