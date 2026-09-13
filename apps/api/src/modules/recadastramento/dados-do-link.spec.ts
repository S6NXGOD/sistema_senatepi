import { camposDoLink, VinculoGravado, vinculosPeloLink } from './dados-do-link';

describe('camposDoLink — só a lista explícita chega ao Prisma', () => {
  it('copia os campos permitidos e descarta todo o resto, inclusive escrita aninhada', () => {
    const corpo = {
      nomeCompleto: 'MARIA DA SILVA',
      telefonePrincipal: '(86) 99999-8888',
      cidade: 'Teresina',
      // Nada disto pode passar, mesmo que o DTO volte a ser mal tipado.
      situacao: 'ATIVO',
      matricula: '000123',
      qrToken: 'forjado',
      fotoKey: 'uploads/outro.webp',
      motivoDesfiliacao: null,
      cobrancas: { deleteMany: {} },
      historico: { deleteMany: {} },
      vinculos: [{ empresa: 'HOSPITAL' }],
      dependentes: [],
      cpfConfirmacao: '12345678900',
    };
    expect(camposDoLink(corpo)).toEqual({
      nomeCompleto: 'MARIA DA SILVA',
      telefonePrincipal: '(86) 99999-8888',
      cidade: 'Teresina',
    });
  });

  it('campo ausente continua ausente (não vira undefined explícito)', () => {
    expect(Object.keys(camposDoLink({ email: 'a@b.org', rg: undefined }))).toEqual(['email']);
  });
});

describe('vinculosPeloLink — a lista substitui sem apagar o que a equipe registrou', () => {
  const gravado = (p: Partial<VinculoGravado> & { empresa: string }): VinculoGravado => ({
    parteExternaId: null, cargo: null, lotacao: null, matricula: null, quadro: null,
    matriculaNormalizada: null, descontoEmFolha: false, ordem: 1, ...p,
  });

  it('mesmo empregador (sem acento e caixa): herda desconto em folha, organização, quadro e lotação', () => {
    const r = vinculosPeloLink(
      [{ empresa: 'hospital getulio vargas', cargo: 'Técnica', matricula: '123', ordem: 1 }],
      [gravado({
        empresa: 'HOSPITAL GETÚLIO  VARGAS', parteExternaId: 'org-hgv', descontoEmFolha: true,
        quadro: 'EFETIVO', lotacao: 'UTI', matricula: '123', matriculaNormalizada: '123',
      })],
    );
    expect(r).toEqual([{
      empresa: 'hospital getulio vargas', cargo: 'Técnica', matricula: '123', lotacao: 'UTI', ordem: 1,
      parteExternaId: 'org-hgv', descontoEmFolha: true, quadro: 'EFETIVO', matriculaNormalizada: '123',
    }]);
  });

  it('empregador novo nasce sem desconto e sem organização: o filiado não decide isso', () => {
    const [v] = vinculosPeloLink([{ empresa: 'CLÍNICA NOVA' }], [gravado({ empresa: 'HOSPITAL', descontoEmFolha: true })]);
    expect(v).toMatchObject({ empresa: 'CLÍNICA NOVA', descontoEmFolha: false, parteExternaId: null, ordem: 1 });
  });

  it('matrícula trocada não herda a normalizada (a folha recalcula)', () => {
    const [v] = vinculosPeloLink(
      [{ empresa: 'HOSPITAL', matricula: '999' }],
      [gravado({ empresa: 'HOSPITAL', matricula: '123', matriculaNormalizada: '123', descontoEmFolha: true })],
    );
    expect(v.matriculaNormalizada).toBeNull();
    expect(v.descontoEmFolha).toBe(true);
  });

  it('lotação enviada vazia é decisão do filiado; ausente é herdada', () => {
    const g = [gravado({ empresa: 'A', lotacao: 'UTI' }), gravado({ empresa: 'B', lotacao: 'CME' })];
    const r = vinculosPeloLink([{ empresa: 'A', lotacao: '' }, { empresa: 'B' }], g);
    expect(r.map((v) => v.lotacao)).toEqual([null, 'CME']);
  });

  it('dois vínculos no mesmo empregador casam um para um, na ordem', () => {
    const r = vinculosPeloLink(
      [{ empresa: 'FMS' }, { empresa: 'FMS' }],
      [gravado({ empresa: 'FMS', descontoEmFolha: true }), gravado({ empresa: 'FMS', descontoEmFolha: false })],
    );
    expect(r.map((v) => [v.descontoEmFolha, v.ordem])).toEqual([[true, 1], [false, 2]]);
  });
});
