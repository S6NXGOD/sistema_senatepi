import { PartesService } from './partes.service';
import { ProcessosService } from './processos.service';

/**
 * A GRAVAÇÃO DAS PARTES, exercitada de verdade.
 *
 * Os testes irmãos leem o código-fonte e conferem que a regra está escrita;
 * este roda a função com um `tx` de mentira e olha o que ela MANDARIA gravar.
 * É a diferença entre "o `if` existe" e "a segunda PRONTOCARE não entra".
 *
 * Nada de Prisma real: `semearNaImportacao` só chama `create`/`createMany` no
 * `tx` que recebe, e o cadastro de organização é lido por `findUnique`.
 */
function txDeMentira(cadastros: Record<string, { nome: string; documento: string | null }> = {}) {
  const criadas: any[] = [];
  const tx = {
    parteProcesso: {
      create: async ({ data }: any) => { criadas.push(data); return data; },
      createMany: async ({ data }: any) => { criadas.push(...data); return { count: data.length }; },
    },
    parteExterna: {
      findUnique: async ({ where }: any) => cadastros[where.id] ?? null,
    },
    processoAdvogado: { createMany: async () => ({ count: 0 }) },
  };
  return { tx: tx as any, criadas };
}

const servico = () => new PartesService({} as any, {} as any);

describe('o polo ativo gravado na ordem da tela', () => {
  it('grava filiado, sindicato e parte sem cadastro na mesma ação', async () => {
    const { tx, criadas } = txDeMentira();
    await servico().semearNaImportacao(tx, 'p1', {
      poloAtivoPartes: [
        { nome: 'MARIA DA SILVA', documento: '11122233344', filiadoId: 'f1' },
        { nome: 'SENATEPI', documento: '12345678000199', parteExternaId: 'org-sind' },
        { nome: 'SINDICATO PARCEIRO', documento: null },
      ],
    });

    const ativos = criadas.filter((c) => c.polo === 'ATIVO');
    expect(ativos).toHaveLength(3);
    expect(ativos.map((c) => c.nome)).toEqual(['MARIA DA SILVA', 'SENATEPI', 'SINDICATO PARCEIRO']);
    expect(ativos[0].filiadoId).toBe('f1');
    expect(ativos[1].parteExternaId).toBe('org-sind');
    // A terceira é só o snapshot do nome: nunca vira cadastro de filiado.
    expect(ativos[2].filiadoId).toBeNull();
    expect(ativos[2].parteExternaId).toBeNull();
  });

  /** O primeiro é o principal — é ele no "Autor × Réu" da listagem. */
  it('só o primeiro é principal', async () => {
    const { tx, criadas } = txDeMentira();
    await servico().semearNaImportacao(tx, 'p1', {
      poloAtivoPartes: [
        { nome: 'A', documento: null, filiadoId: 'f1' },
        { nome: 'B', documento: null, filiadoId: 'f2' },
      ],
    });
    expect(criadas.map((c) => c.principal)).toEqual([true, false]);
  });

  it('não repete a mesma parte, venha ela por id ou por nome', async () => {
    const { tx, criadas } = txDeMentira();
    await servico().semearNaImportacao(tx, 'p1', {
      poloAtivoPartes: [
        { nome: 'PRONTOCARE CLINICA', documento: null, parteExternaId: 'org-1' },
        { nome: 'Prontocare Clínica', documento: null },
        { nome: 'PRONTOCARE CLINICA', documento: null, parteExternaId: 'org-1' },
      ],
    });
    expect(criadas.filter((c) => c.polo === 'ATIVO')).toHaveLength(1);
  });

  /**
   * O CAMINHO ANTIGO CONTINUA VIVO. É o que o payload sem `partes` manda — e na
   * janela de troca do deploy é exatamente ele que chega.
   */
  it('sem a relação, a cadeia antiga grava os filiados', async () => {
    const { tx, criadas } = txDeMentira();
    await servico().semearNaImportacao(tx, 'p1', {
      filiadosAtivos: [
        { id: 'f1', nomeCompleto: 'MARIA', cpf: '11122233344' },
        { id: 'f2', nomeCompleto: 'JOAO', cpf: null },
      ],
    });
    const ativos = criadas.filter((c) => c.polo === 'ATIVO');
    expect(ativos.map((c) => c.nome)).toEqual(['MARIA', 'JOAO']);
    expect(ativos[0].principal).toBe(true);
  });

  it('e a relação vence a cadeia antiga quando as duas vêm', async () => {
    const { tx, criadas } = txDeMentira();
    await servico().semearNaImportacao(tx, 'p1', {
      institucional: true,
      filiadosAtivos: [{ id: 'f1', nomeCompleto: 'MARIA', cpf: null }],
      poloAtivoPartes: [{ nome: 'QUEM MANDA', documento: null }],
    });
    const ativos = criadas.filter((c) => c.polo === 'ATIVO');
    expect(ativos).toHaveLength(1);
    expect(ativos[0].nome).toBe('QUEM MANDA');
  });
});

/**
 * A DUPLICATA DO POLO PASSIVO — a que a tela do usuário mostrou.
 *
 * "PRONTOCARE CLINICA E ATENDIMENTOS LTDA" escolhida no cadastro (chave de id)
 * e a MESMA digitada à mão (chave de nome). As chaves não se cruzavam, e as
 * duas entravam: a lista do processo passava a dizer "PRONTOCARE e mais 1"
 * apontando para ela mesma.
 */
describe('o mesmo réu por duas portas', () => {
  const CADASTRO = {
    'org-1': { nome: 'PRONTOCARE CLINICA E ATENDIMENTOS LTDA', documento: '11222333000144' },
  };

  it('entra uma vez só', async () => {
    const { tx, criadas } = txDeMentira(CADASTRO);
    await servico().semearNaImportacao(tx, 'p1', {
      partesContrarias: [
        { parteExternaId: 'org-1' },
        { nome: 'Prontocare Clínica e Atendimentos Ltda.' },
      ],
    });
    const passivos = criadas.filter((c) => c.polo === 'PASSIVO');
    expect(passivos).toHaveLength(1);
    // Fica a do CADASTRO — é ela que liga o processo aos outros da mesma empresa.
    expect(passivos[0].parteExternaId).toBe('org-1');
  });

  it('mas dois réus de verdade entram os dois', async () => {
    const { tx, criadas } = txDeMentira(CADASTRO);
    await servico().semearNaImportacao(tx, 'p1', {
      partesContrarias: [
        { parteExternaId: 'org-1' },
        { nome: 'MUNICIPIO DE TERESINA' },
        { nome: 'FUNDACAO MUNICIPAL DE SAUDE' },
      ],
    });
    const passivos = criadas.filter((c) => c.polo === 'PASSIVO');
    expect(passivos).toHaveLength(3);
    expect(passivos.map((c) => c.principal)).toEqual([true, false, false]);
  });

  /** `parteContraria` (singular) é o contrato antigo e entra na frente. */
  it('o réu único do contrato antigo continua sendo o principal', async () => {
    const { tx, criadas } = txDeMentira(CADASTRO);
    await servico().semearNaImportacao(tx, 'p1', {
      parteContraria: { nome: 'HOSPITAL X' },
      partesContrarias: [{ nome: 'EMPRESA Y' }],
    });
    const passivos = criadas.filter((c) => c.polo === 'PASSIVO');
    expect(passivos.map((c) => c.nome)).toEqual(['HOSPITAL X', 'EMPRESA Y']);
    expect(passivos[0].principal).toBe(true);
  });

  /** E o mesmo nome mandado duas vezes pelas duas chaves antigas também não repete. */
  it('nem o singular repetido na lista', async () => {
    const { tx, criadas } = txDeMentira(CADASTRO);
    await servico().semearNaImportacao(tx, 'p1', {
      parteContraria: { nome: 'HOSPITAL X' },
      partesContrarias: [{ nome: 'Hospital X' }],
    });
    expect(criadas.filter((c) => c.polo === 'PASSIVO')).toHaveLength(1);
  });
});


/**
 * A LEITURA DA RELAÇÃO — antes de gravar, resolver contra os cadastros.
 *
 * `resolverPartesDoPolo` é privado; chamá-lo por `as any` é deliberado. A
 * alternativa seria expor um método só para o teste, e um método público que
 * ninguém chama em produção mente sobre a superfície da classe.
 */
describe('resolver a relação contra os cadastros', () => {
  const prismaFalso = (opts: {
    filiados?: { id: string; nomeCompleto: string; cpf: string | null }[];
    orgs?: Record<string, { id: string; nome: string; documento: string | null }>;
  }) =>
    ({
      filiado: { findMany: async () => opts.filiados ?? [] },
      parteExterna: { findUnique: async ({ where }: any) => opts.orgs?.[where.id] ?? null },
    }) as any;

  const partesFalso = (sindicato: any) => ({ parteInstitucional: async () => sindicato }) as any;

  const criar = (prisma: any, partes: any) =>
    new ProcessosService(prisma, {} as any, {} as any, {} as any, {} as any, partes, {} as any, {} as any);

  const SIND = { id: 'org-sind', nome: 'SENATEPI', documento: '12345678000199' };

  it('mistura filiado, sindicato e nome solto, na ordem recebida', async () => {
    const svc = criar(
      prismaFalso({ filiados: [{ id: 'f1', nomeCompleto: 'MARIA DA SILVA', cpf: '111' }] }),
      partesFalso(SIND),
    );
    const r = await (svc as any).resolverPartesDoPolo([
      { tipo: 'FILIADO', filiadoId: 'f1' },
      { tipo: 'INSTITUCIONAL' },
      { tipo: 'AVULSA', nome: 'SINDICATO PARCEIRO' },
    ]);
    expect(r.partes.map((x: any) => x.nome)).toEqual(['MARIA DA SILVA', 'SENATEPI', 'SINDICATO PARCEIRO']);
    // Há filiado na ação → ela é individual, e é a ficha dele que a mostra.
    expect(r.institucional).toBe(false);
    expect(r.filiados.map((f: any) => f.id)).toEqual(['f1']);
  });

  it('sem filiado nenhum, a ação é institucional', async () => {
    const svc = criar(prismaFalso({}), partesFalso(SIND));
    const r = await (svc as any).resolverPartesDoPolo([
      { tipo: 'INSTITUCIONAL' },
      { tipo: 'AVULSA', nome: 'OUTRO SINDICATO' },
    ]);
    expect(r.institucional).toBe(true);
    expect(r.filiados).toHaveLength(0);
  });

  /** O nome vem do CADASTRO, não do payload — senão as grafias divergem. */
  it('ignora o nome que a tela mandou para quem tem cadastro', async () => {
    const svc = criar(
      prismaFalso({ filiados: [{ id: 'f1', nomeCompleto: 'MARIA DA SILVA SANTOS', cpf: '111' }] }),
      partesFalso(SIND),
    );
    const r = await (svc as any).resolverPartesDoPolo([
      { tipo: 'FILIADO', filiadoId: 'f1', nome: 'maria (como eu digitei)' },
    ]);
    expect(r.partes[0].nome).toBe('MARIA DA SILVA SANTOS');
  });

  it('recusa filiado que não existe, dizendo qual', async () => {
    const svc = criar(prismaFalso({ filiados: [] }), partesFalso(SIND));
    await expect(
      (svc as any).resolverPartesDoPolo([{ tipo: 'FILIADO', filiadoId: 'fantasma' }]),
    ).rejects.toThrow(/fantasma/);
  });

  /** Sem a parte institucional cadastrada, dizer "ação coletiva" é mentira. */
  it('recusa o institucional quando o sindicato não está no cadastro', async () => {
    const svc = criar(prismaFalso({}), partesFalso(null));
    await expect(
      (svc as any).resolverPartesDoPolo([{ tipo: 'INSTITUCIONAL' }]),
    ).rejects.toThrow(/institucional/i);
  });

  it('recusa relação que não produz nenhuma parte', async () => {
    const svc = criar(prismaFalso({}), partesFalso(SIND));
    await expect(
      (svc as any).resolverPartesDoPolo([{ tipo: 'AVULSA', nome: '   ' }]),
    ).rejects.toThrow(/ao menos uma parte/i);
  });
});
