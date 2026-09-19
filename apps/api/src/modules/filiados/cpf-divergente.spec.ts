import { Prisma } from '@prisma/client';
import { DuplicidadeService, analisarCpfs } from './duplicidade.service';
import { cpfValido } from '../importacao/mapeamento.util';

/**
 * UM DÍGITO TROCADO — o caso da LUANA, 18/09/2026.
 *
 * O dono abriu a fila e encontrou:
 *
 *   4002 (que a tela mandava MANTER)   840.053.86**9**-34
 *   5811 (que a tela ia APAGAR)        840.053.86**3**-34
 *
 * e escreveu: *"sei que é um risco mas um tem o CPF errado e o outro certo.
 * Então se for aceitado consolidar, ele enriquece os dados com o que falta e
 * mantém o cadastro selecionado."*
 *
 * Ele estava certo sobre o risco e certo sobre o erro de digitação — e o
 * sistema podia ter respondido QUAL dos dois é o errado, em vez de só barrar.
 * O CPF tem dois dígitos verificadores: 840.053.869-34 não passa (o verificador
 * dele seria 20) e 840.053.863-34 passa.
 *
 * Ou seja: a tela ia guardar o CPF INVÁLIDO e destruir o válido. A trava estava
 * certa em barrar e errada em não explicar.
 */
const LUANA_4002 = '840.053.869-34'; // o que a tela mantinha — inválido
const LUANA_5811 = '840.053.863-34'; // o que a tela apagaria — válido

const cad = (id: string, matricula: string, cpf: string | null) => ({ id, matricula, cpf });

describe('o caso que abriu isto', () => {
  it('dos dois CPFs da LUANA, só um passa no dígito verificador', () => {
    expect(cpfValido(LUANA_4002)).toBe(false);
    expect(cpfValido(LUANA_5811)).toBe(true);
  });

  it('e o válido é justamente o do cadastro que seria apagado', () => {
    const a = analisarCpfs([cad('a', '4002', LUANA_4002), cad('b', '5811', LUANA_5811)])!;
    expect(a.umSoValido).toBe(true);
    expect(a.todosValidos).toBe(false);
    expect(a.cpfBom).toBe('84005386334');
    expect(a.porCadastro.find((c) => c.matricula === '5811')!.valido).toBe(true);
    expect(a.porCadastro.find((c) => c.matricula === '4002')!.valido).toBe(false);
  });
});

describe('quando a análise nem se aplica', () => {
  it('sem conflito não há o que analisar', () => {
    expect(analisarCpfs([cad('a', '1', LUANA_5811), cad('b', '2', LUANA_5811)])).toBeNull();
  });

  it('um lado sem CPF é buraco a preencher, não divergência', () => {
    expect(analisarCpfs([cad('a', '1', LUANA_5811), cad('b', '2', null)])).toBeNull();
    expect(analisarCpfs([cad('a', '1', LUANA_5811), cad('b', '2', '  ')])).toBeNull();
  });

  /** A base grava com e sem pontuação: a mesma pessoa não pode virar conflito. */
  it('pontuação diferente é o mesmo CPF', () => {
    expect(analisarCpfs([cad('a', '1', '840.053.863-34'), cad('b', '2', '84005386334')])).toBeNull();
  });
});

describe('as três situações, e elas não são iguais', () => {
  it('UM SÓ VÁLIDO: é erro de digitação, e o sistema sabe qual vale', () => {
    const a = analisarCpfs([cad('a', '1', LUANA_4002), cad('b', '2', LUANA_5811)])!;
    expect(a).toMatchObject({ umSoValido: true, todosValidos: false, cpfBom: '84005386334' });
  });

  /**
   * DOIS VÁLIDOS são duas pessoas. O sistema não tem como escolher, e a fusão
   * não é liberada nem com confirmação: quem tiver certeza corrige o CPF errado
   * na ficha e consolida depois, sem apagar nada por engano.
   */
  it('OS DOIS VÁLIDOS: ninguém sabe qual é, e não há cpfBom', () => {
    const a = analisarCpfs([cad('a', '1', '840.053.863-34'), cad('b', '2', '529.982.247-25')])!;
    expect(a.todosValidos).toBe(true);
    expect(a.umSoValido).toBe(false);
    expect(a.cpfBom).toBeNull();
  });

  it('NENHUM VÁLIDO: os dois são lixo e não identificam ninguém', () => {
    const a = analisarCpfs([cad('a', '1', '111.111.111-11'), cad('b', '2', '123.456.789-00')])!;
    expect(a.todosValidos).toBe(false);
    expect(a.umSoValido).toBe(false);
    expect(a.cpfBom).toBeNull();
  });
});

describe('grupo de três', () => {
  it('um válido entre três continua sendo "um só válido"', () => {
    const a = analisarCpfs([
      cad('a', '1', LUANA_4002),
      cad('b', '2', LUANA_5811),
      cad('c', '3', '840.053.860-34'),
    ])!;
    expect(a.porCadastro).toHaveLength(3);
    expect(a.umSoValido).toBe(true);
    expect(a.cpfBom).toBe('84005386334');
  });
});

/**
 * A TRAVA CONTINUA — e agora ela diz do que está falando.
 *
 * O `fundir` nunca funde CPFs divergentes por conta própria. O que mudou é que
 * a recusa NOMEIA o CPF válido, e existe um caminho explícito para quem decide:
 * mandar `cpfQueFica`. Nada disso chega ao lote, que chama `fundir` sem opções.
 */
describe('a fusão com CPFs divergentes', () => {
  const FILIADO = {
    id: 'manter', nomeCompleto: 'LUANA DE GÓIS SILVA FERNANDES', matricula: '4002',
    cpf: null as string | null, rg: null, ufRg: null, dataNascimento: null, sexo: null,
    estadoCivil: null, naturalidade: null, telefonePrincipal: null, telefoneSecundario: null,
    email: null, cep: null, endereco: null, numero: null, complemento: null, bairro: null,
    cidade: null, estado: null, numeroCoren: null, dataAdmissao: null, formacao: null,
    formacaoOutro: null, dataFiliacao: null, modalidadeContribuicao: null,
    fotoKey: null, fotoThumbKey: null, vinculos: [] as unknown[],
  };

  function montar(cpfManter: string | null, cpfDescartar: string | null) {
    const gravado: {
      update?: Record<string, unknown>;
      historico?: Record<string, unknown>;
      /*
        A SEQUÊNCIA DE ESCRITAS, e ela é o ponto deste arquivo desde 18/09/2026.
        `cpf` é ÚNICO no banco: gravar no mantido um número que o removido ainda
        tem derruba a transação inteira com 500. Um banco falso não tem
        restrição de unicidade — se o teste só olhasse o RESULTADO, continuaria
        verde com o defeito no ar, que foi exatamente o que aconteceu.
      */
      passos: string[];
    } = { passos: [] };
    const tx = {
      filiado: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'manter'
              ? { ...FILIADO, id: 'manter', matricula: '4002', cpf: cpfManter }
              : { ...FILIADO, id: 'descartar', matricula: '5811', cpf: cpfDescartar },
          ),
        update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          gravado.passos.push(
            `update ${where.id}${'cpf' in data ? ` cpf=${String(data.cpf)}` : ''}`,
          );
          if (where.id === 'manter') gravado.update = data;
          return Promise.resolve({});
        },
        delete: ({ where }: { where: { id: string } }) => {
          gravado.passos.push(`delete ${where.id}`);
          return Promise.resolve({});
        },
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
    const service = new DuplicidadeService(
      prisma as never,
      { registrar: () => Promise.resolve(undefined) } as never,
    );
    return { service, gravado };
  }

  it('sem escolha, recusa — e a recusa diz QUAL é o válido e de quem é', async () => {
    const { service } = montar(LUANA_4002, LUANA_5811);
    await expect(service.fundir('manter', 'descartar')).rejects.toThrow(/5811/);
    await expect(service.fundir('manter', 'descartar')).rejects.toThrow(/840\.053\.863-34/);
  });

  /**
   * O CASO DA LUANA, RESOLVIDO. O cadastro que FICA é o 4002 (é o escolhido por
   * quem decide, e é o mais completo), mas o CPF que prevalece é o do 5811 —
   * porque é o único que passa no dígito verificador.
   */
  it('com a escolha, funde e o CPF VÁLIDO prevalece, mesmo vindo do removido', async () => {
    const { service, gravado } = montar(LUANA_4002, LUANA_5811);
    await expect(
      service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '84005386334' }),
    ).resolves.toMatchObject({ ok: true });
    expect(gravado.update?.cpf).toBe(LUANA_5811);
  });

  it('e o histórico registra a troca, quem decidiu e por quê', async () => {
    const { service, gravado } = montar(LUANA_4002, LUANA_5811);
    await service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '84005386334' });
    const descricao = String(gravado.historico?.descricao);
    expect(descricao).toContain('CPFs divergentes');
    expect(descricao).toContain(LUANA_5811);
    expect(descricao).toContain(LUANA_4002);
    expect(descricao).toContain('João Pedro');
    expect(descricao).toContain('dígito verificador');
  });

  /**
   * O 500 QUE O DONO VIU NO PRIMEIRO USO REAL — JOANA DARC, 18/09/2026.
   *
   * O CPF escolhido vinha do cadastro que SAI, e o `update` do mantido tentava
   * gravar um número que o removido ainda tinha na mão. `cpf String? @unique`
   * recusa, a transação cai inteira e a tela recebe "Internal server error".
   *
   * O teste olha a ORDEM das escritas, não só o resultado: o banco falso não
   * tem unicidade, então o resultado ficava certo com o defeito no ar.
   */
  it('libera o CPF no removido ANTES de gravá-lo no mantido', async () => {
    const { service, gravado } = montar(LUANA_4002, LUANA_5811);
    await service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '84005386334' });

    const liberou = gravado.passos.indexOf('update descartar cpf=null');
    const gravou = gravado.passos.findIndex((x) => x.startsWith('update manter'));
    const apagou = gravado.passos.indexOf('delete descartar');
    expect(liberou).toBeGreaterThan(-1);
    expect(liberou).toBeLessThan(gravou);
    // E o removido só é apagado depois de tudo — a cópia vem antes da exclusão.
    expect(gravou).toBeLessThan(apagou);
  });

  /** Quando o CPF que fica já é o do mantido, não há nada a liberar. */
  it('não mexe no removido quando o CPF escolhido já é o do mantido', async () => {
    const { service, gravado } = montar(LUANA_5811, LUANA_4002);
    await service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '84005386334' });
    expect(gravado.passos).not.toContain('update descartar cpf=null');
  });

  it('escolher o INVÁLIDO é recusado — a decisão não passa por cima da conta', async () => {
    const { service } = montar(LUANA_4002, LUANA_5811);
    await expect(
      service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '84005386934' }),
    ).rejects.toThrow(/não passa no dígito verificador/);
  });

  it('escolher um CPF que não é de nenhum dos dois é recusado', async () => {
    const { service } = montar(LUANA_4002, LUANA_5811);
    await expect(
      service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '52998224725' }),
    ).rejects.toThrow(/nenhum dos dois/);
  });

  /**
   * DOIS CPFs VÁLIDOS SÃO DUAS PESSOAS. Nem com confirmação: quem tiver certeza
   * corrige o CPF errado na ficha e consolida depois, sem apagar por engano.
   */
  it('com os DOIS válidos, nem a confirmação libera', async () => {
    const { service } = montar('840.053.863-34', '529.982.247-25');
    await expect(
      service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '84005386334' }),
    ).rejects.toThrow(/passam no dígito verificador/);
  });

  it('nenhum válido: libera com a escolha, e o histórico diz que nenhum passa', async () => {
    const { service, gravado } = montar('111.111.111-11', '123.456.789-00');
    await service.fundir('manter', 'descartar', 'João Pedro', { cpfQueFica: '12345678900' });
    expect(gravado.update?.cpf).toBe('123.456.789-00');
    expect(String(gravado.historico?.descricao)).toContain('nenhum dos dois passa');
  });

  it('sem divergência, nada disso entra no caminho', async () => {
    const { service, gravado } = montar(null, LUANA_5811);
    await expect(service.fundir('manter', 'descartar')).resolves.toMatchObject({ ok: true });
    // Buraco preenchido pela cópia normal, sem conflito e sem nota no histórico.
    expect(gravado.update?.cpf).toBe(LUANA_5811);
    expect(String(gravado.historico?.descricao)).not.toContain('CPFs divergentes');
  });

  /**
   * O DEFEITO É MAIS VELHO QUE A ESCOLHA DE CPF — medido em 18/09/2026 contra
   * um banco de verdade, que tem o índice único.
   *
   * Basta o mantido estar SEM CPF e o removido ter um: `copiar('cpf')` preenche
   * o buraco, e o número ainda pertence a quem vai sair. O lote nunca esbarrou
   * porque a regra dele mantém justamente o cadastro que TEM dado; quem
   * esbarrava era quem consolidava à mão e escolhia ficar com o mais pobre.
   */
  it('a cópia COMUM de CPF também libera antes de gravar', async () => {
    const { service, gravado } = montar(null, LUANA_5811);
    await service.fundir('manter', 'descartar');
    const liberou = gravado.passos.indexOf('update descartar cpf=null');
    const gravou = gravado.passos.findIndex((x) => x.startsWith('update manter'));
    expect(liberou).toBeGreaterThan(-1);
    expect(liberou).toBeLessThan(gravou);
  });

  /** Sem CPF a copiar, ninguém mexe no removido antes da hora. */
  it('fusão sem CPF nenhum não faz escrita extra', async () => {
    const { service, gravado } = montar(null, null);
    await service.fundir('manter', 'descartar');
    expect(gravado.passos).not.toContain('update descartar cpf=null');
  });
});

/**
 * "INTERNAL SERVER ERROR" NÃO É RESPOSTA — 18/09/2026.
 *
 * Foi o que a tela mostrou quando o índice único do CPF recusou a fusão. A
 * causa daquele dia está consertada; o modo de FALHAR não estava, e a próxima
 * trava do banco daria o mesmo 500 seco.
 */
describe('quando o banco recusa, a tela recebe uma frase', () => {
  it('a violação de unicidade vira mensagem, com o campo e a garantia', async () => {
    const service = new DuplicidadeService(
      {
        $transaction: () =>
          Promise.reject(
            Object.assign(
              new Prisma.PrismaClientKnownRequestError('dup', {
                code: 'P2002',
                clientVersion: '5',
                meta: { target: ['cpf'] },
              }),
            ),
          ),
      } as never,
      { registrar: () => Promise.resolve(undefined) } as never,
    );
    await expect(service.fundir('a', 'b')).rejects.toThrow(/cpf/);
    await expect(service.fundir('a', 'b')).rejects.toThrow(/Nada foi apagado/);
  });

  /** O que não dá para nomear sobe como estava: explicação inventada é pior. */
  it('erro desconhecido não ganha explicação falsa', async () => {
    const service = new DuplicidadeService(
      { $transaction: () => Promise.reject(new Error('conexão caiu')) } as never,
      { registrar: () => Promise.resolve(undefined) } as never,
    );
    await expect(service.fundir('a', 'b')).rejects.toThrow('conexão caiu');
  });
});
