import { BadRequestException, ConflictException } from '@nestjs/common';
import { TipoParteExterna } from '@prisma/client';
import { PartesExternasService, tipoPelaNatureza } from './partes-externas.service';

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
