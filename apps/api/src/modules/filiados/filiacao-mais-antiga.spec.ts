import { DuplicidadeService } from './duplicidade.service';

/**
 * A CONSOLIDAÇÃO NÃO PODE ENVELHECER O FILIADO AO CONTRÁRIO.
 *
 * `dataFiliacao` estava na lista dos campos que só se copiam quando o mantido
 * está vazio. Os dois quase sempre têm — 868 dos 925 pares elegíveis ao lote —
 * então o cadastro NOVO vencia o ANTIGO e o tempo de sindicato ia junto com o
 * registro apagado: 91 pares no lote de um clique, média de 2.685 dias, o pior
 * recuando de 2010 para 2023.
 *
 * A regra virou outra: a filiação mais antiga prevalece, sempre, e nunca se
 * adianta. E tudo que a fusão apaga por divergência fica escrito no histórico —
 * o registro some, o valor não.
 */
describe('Consolidação de duplicados — a filiação mais antiga prevalece', () => {
  const FILIADO = {
    id: 'manter', nomeCompleto: 'MARIA DA SILVA', matricula: '5285', cpf: null,
    rg: null, ufRg: null, dataNascimento: null, sexo: null, estadoCivil: null,
    naturalidade: null, telefonePrincipal: null, telefoneSecundario: null, email: null,
    cep: null, endereco: null, numero: null, complemento: null, bairro: null,
    cidade: null, estado: null, numeroCoren: null, dataAdmissao: null, formacao: null,
    formacaoOutro: null, dataFiliacao: null as Date | null, modalidadeContribuicao: null,
    fotoKey: null, fotoThumbKey: null, vinculos: [] as unknown[],
  };

  /** Prisma de mentira: guarda o que a fusão mandaria gravar. */
  function montar(manter: Record<string, unknown>, descartar: Record<string, unknown>) {
    const gravado: { update?: Record<string, unknown>; historico?: Record<string, unknown> } = {};
    const tx = {
      filiado: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'manter'
              ? { ...FILIADO, ...manter, id: 'manter' }
              : { ...FILIADO, id: 'descartar', matricula: '1269', ...descartar },
          ),
        update: ({ data }: { data: Record<string, unknown> }) => {
          gravado.update = data;
          return Promise.resolve({});
        },
        delete: () => Promise.resolve({}),
      },
      vinculoProfissional: { update: () => Promise.resolve({}) },
      filiadoHistorico: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          gravado.historico = data;
          return Promise.resolve({});
        },
      },
      duplicataDecisao: { upsert: () => Promise.resolve({}) },
    };
    const prisma = { $transaction: (cb: (t: unknown) => unknown) => cb(tx) };
    const audit = { registrar: () => Promise.resolve(undefined) };
    const service = new DuplicidadeService(prisma as never, audit as never);
    return { service, gravado };
  }

  const dia = (iso: string) => new Date(`${iso}T03:00:00.000Z`); // meia-noite de Teresina

  it('recua a filiação quando o cadastro REMOVIDO é o mais antigo', async () => {
    const { service, gravado } = montar(
      { dataFiliacao: dia('2023-06-14') },
      { dataFiliacao: dia('2011-04-15') },
    );
    await service.fundir('manter', 'descartar');
    expect(gravado.update?.dataFiliacao).toEqual(dia('2011-04-15'));
  });

  it('NÃO adianta a filiação quando o removido é mais novo', async () => {
    const { service, gravado } = montar(
      { dataFiliacao: dia('2011-04-15') },
      { dataFiliacao: dia('2023-06-14') },
    );
    await service.fundir('manter', 'descartar');
    expect(gravado.update?.dataFiliacao).toBeUndefined();
  });

  it('adota a do removido quando o mantido não tem nenhuma', async () => {
    const { service, gravado } = montar({ dataFiliacao: null }, { dataFiliacao: dia('2013-04-16') });
    await service.fundir('manter', 'descartar');
    expect(gravado.update?.dataFiliacao).toEqual(dia('2013-04-16'));
  });

  it('não mexe em nada quando as duas datas são iguais', async () => {
    const { service, gravado } = montar(
      { dataFiliacao: dia('2020-01-10') },
      { dataFiliacao: dia('2020-01-10') },
    );
    await service.fundir('manter', 'descartar');
    expect(gravado.update?.dataFiliacao).toBeUndefined();
  });

  it('o histórico diz para onde a filiação recuou e de onde veio', async () => {
    const { service, gravado } = montar(
      { dataFiliacao: dia('2023-06-14') },
      { dataFiliacao: dia('2011-04-15') },
    );
    await service.fundir('manter', 'descartar');
    const descricao = String(gravado.historico?.descricao);
    expect(descricao).toContain('15/04/2011');
    expect(descricao).toContain('14/06/2023');
    expect((gravado.historico?.metadata as Record<string, unknown>).filiacaoRecuada).toBe(true);
  });

  it('não fala em recuo quando não houve', async () => {
    const { service, gravado } = montar(
      { dataFiliacao: dia('2011-04-15') },
      { dataFiliacao: dia('2023-06-14') },
    );
    await service.fundir('manter', 'descartar');
    expect(String(gravado.historico?.descricao)).not.toContain('recuada');
    expect((gravado.historico?.metadata as Record<string, unknown>).filiacaoRecuada).toBe(false);
  });

  /**
   * O VALOR APAGADO FICA ESCRITO.
   *
   * O registro é apagado; o histórico do mantido é o único lugar onde o que ele
   * continha ainda pode existir. Antes só se registrava o que foi aproveitado.
   */
  describe('o que a fusão apaga por divergência', () => {
    it('grava no histórico o valor que o removido tinha e o mantido não recebeu', async () => {
      const { service, gravado } = montar(
        { cidade: 'Teresina', telefonePrincipal: '86999990000' },
        { cidade: 'Timon', telefonePrincipal: '86988887777' },
      );
      await service.fundir('manter', 'descartar');
      const meta = gravado.historico?.metadata as Record<string, unknown>;
      expect(meta.valoresDescartados).toEqual({ telefonePrincipal: '86988887777', cidade: 'Timon' });
      expect(String(gravado.historico?.descricao)).toContain('NÃO foram aproveitados');
    });

    it('valor igual dos dois lados não é perda e não entra na lista', async () => {
      const { service, gravado } = montar({ cidade: 'Teresina' }, { cidade: 'Teresina' });
      await service.fundir('manter', 'descartar');
      expect((gravado.historico?.metadata as Record<string, unknown>).valoresDescartados).toEqual({});
    });

    it('campo que só o removido tem continua sendo cópia, não perda', async () => {
      const { service, gravado } = montar({ email: null }, { email: 'a@b.c' });
      await service.fundir('manter', 'descartar');
      expect(gravado.update?.email).toBe('a@b.c');
      expect((gravado.historico?.metadata as Record<string, unknown>).valoresDescartados).toEqual({});
    });
  });
});
