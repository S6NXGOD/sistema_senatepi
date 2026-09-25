import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DesafioRecadastramento } from '@prisma/client';

import { LinkRecadastramentoService } from './link-recadastramento.service';

import {
  conferirResposta,
  observacaoDoRecadastramentoOnline,
  fichaEmBranco,
  identificacaoValida,
  type CadastroDoDesafio,
} from './desafio-do-link';

/**
 * O LINK QUE PEDE OS DADOS EM VEZ DE EXIGIR QUE JÁ EXISTAM — 22/09/2026.
 *
 * O PEDIDO DO DONO: "Como faço para deixar de depender isso do atendimento.
 * Quero jogar essa responsabilidade ao filiado também. Com validador."
 *
 * O CICLO QUE ISTO QUEBRA. Desde 14/09 o desafio NENHUM não gera link: a
 * equipe tinha de perguntar CPF e nascimento na conversa, gravar na ficha e só
 * então mandar. Mas a ficha está vazia exatamente porque ninguém coletou — são
 * 5.007 ativos assim. O ciclo nunca fechava sozinho, e todo o trabalho recaía
 * sobre a Triagem, um filiado por vez.
 *
 * O QUE ISTE SPEC TRAVA, e é a parte que se perde primeiro quando alguém mexe:
 *
 *  1. ficha EM BRANCO ≠ ficha com dado que não presta — só a primeira entra;
 *  2. o validador é validador de verdade (dígito verificador, data plausível);
 *  3. e o que ele NÃO é: não autentica ninguém, e o código não pode fingir que
 *     autentica.
 */

const CPF_OK = '52998224725'; // dígito verificador fecha
const CPF_ERRADO = '52998224724'; // um dígito trocado
const vazia: CadastroDoDesafio = { cpf: null, dataNascimento: null, numeroCoren: null };

/** Uma data que passa no `nascimentoUtil`: maior de 14 e depois de 1920. */
const NASC_OK = '1985-03-12';

describe('ficha em branco', () => {
  it('nada gravado é branco', () => {
    expect(fichaEmBranco(vazia, { corenVisivel: true })).toBe(true);
  });

  it('espaço em branco não é dado', () => {
    expect(fichaEmBranco({ ...vazia, cpf: '   ' }, { corenVisivel: true })).toBe(true);
  });

  /**
   * O CASO QUE SEPARA IDENTIFICACAO DE NENHUM. Um CPF gravado errado É um dado
   * gravado — e `protegerImutaveis` descarta a troca de campo preenchido. Se
   * este teste virar `true`, o filiado passa a receber um link que pede o CPF
   * certo, digita, salva, e a ficha continua errada: um beco com passos.
   */
  it('CPF gravado errado NÃO é branco — preenchido é intocável no recadastramento', () => {
    expect(fichaEmBranco({ ...vazia, cpf: CPF_ERRADO }, { corenVisivel: true })).toBe(false);
    expect(fichaEmBranco({ ...vazia, cpf: '123' }, { corenVisivel: true })).toBe(false);
  });

  it('data gravada, mesmo implausível, NÃO é branco', () => {
    const d = new Date('1900-01-01T00:00:00.000Z');
    expect(fichaEmBranco({ ...vazia, dataNascimento: d }, { corenVisivel: true })).toBe(false);
  });

  /**
   * COREN OCULTO NÃO CONTA. No SINDSERM o campo não existe na tela; uma ficha
   * que só tem COREN está, para aquele cliente, vazia. Antes disso o filiado
   * do SINDSERM ficava sem caminho nenhum por causa de um campo que ele nem vê.
   */
  it('COREN só conta onde o campo aparece', () => {
    const comCoren = { ...vazia, numeroCoren: '123456' };
    expect(fichaEmBranco(comCoren, { corenVisivel: true })).toBe(false);
    expect(fichaEmBranco(comCoren, { corenVisivel: false })).toBe(true);
  });
});

describe('o validador da identificação', () => {
  it('CPF com dígito verificador certo e data plausível passa', () => {
    expect(identificacaoValida({ cpf: CPF_OK, dataNascimento: NASC_OK })).toBe(true);
  });

  it('a máscara não atrapalha', () => {
    expect(identificacaoValida({ cpf: '529.982.247-25', dataNascimento: NASC_OK })).toBe(true);
  });

  /** É ISTO que o dono chamou de validador: CPF inventado não entra no cadastro. */
  it('um dígito trocado não passa', () => {
    expect(identificacaoValida({ cpf: CPF_ERRADO, dataNascimento: NASC_OK })).toBe(false);
  });

  it('11 dígitos iguais não passam — fecham a conta e não existem', () => {
    expect(identificacaoValida({ cpf: '11111111111', dataNascimento: NASC_OK })).toBe(false);
  });

  it('CPF curto, vazio ou ausente não passa', () => {
    expect(identificacaoValida({ cpf: '5299822472', dataNascimento: NASC_OK })).toBe(false);
    expect(identificacaoValida({ cpf: '', dataNascimento: NASC_OK })).toBe(false);
    expect(identificacaoValida({ dataNascimento: NASC_OK })).toBe(false);
  });

  it('sem data, com data mal formada ou com data impossível não passa', () => {
    expect(identificacaoValida({ cpf: CPF_OK })).toBe(false);
    expect(identificacaoValida({ cpf: CPF_OK, dataNascimento: '12/03/1985' })).toBe(false);
    // Antes de 1920: é carimbo de carga, não gente viva se recadastrando.
    expect(identificacaoValida({ cpf: CPF_OK, dataNascimento: '1900-01-01' })).toBe(false);
  });

  /** Menos de 14 anos não trabalha e não é filiado: a data está errada. */
  it('criança não passa', () => {
    const agora = new Date('2026-09-22T12:00:00.000Z');
    expect(identificacaoValida({ cpf: CPF_OK, dataNascimento: '2020-01-01' }, agora)).toBe(false);
    expect(identificacaoValida({ cpf: CPF_OK, dataNascimento: '2012-09-21' }, agora)).toBe(true);
  });
});

describe('conferirResposta em IDENTIFICACAO', () => {
  /**
   * NÃO COMPARA COM NADA, PORQUE NÃO HÁ NADA. Este é o ponto em que é fácil
   * errar: alguém "consertando" isto para comparar com `cadastro.cpf` faria o
   * desafio nunca conferir, porque o cadastro é vazio por definição — e o
   * filiado gastaria as 5 tentativas sem entender por quê.
   */
  it('valida a resposta e ignora o cadastro, que está vazio', () => {
    expect(
      conferirResposta(DesafioRecadastramento.IDENTIFICACAO, vazia, {
        cpf: CPF_OK,
        dataNascimento: NASC_OK,
      }),
    ).toBe(true);
  });

  it('resposta inválida não confere', () => {
    expect(
      conferirResposta(DesafioRecadastramento.IDENTIFICACAO, vazia, {
        cpf: CPF_ERRADO,
        dataNascimento: NASC_OK,
      }),
    ).toBe(false);
    expect(conferirResposta(DesafioRecadastramento.IDENTIFICACAO, vazia, {})).toBe(false);
  });
});

/**
 * O CARIMBO QUE A CONFERÊNCIA LÊ.
 *
 * Para uma ficha vazia não existe conferência possível: não há segredo guardado
 * com o que comparar. Este link COLETA; ele não autentica — o que protege é o
 * token (uso único, 24h) e o canal, porque quem manda é a Triagem dentro da
 * conversa que já está tendo.
 *
 * Isso tem uma consequência prática, e é ela que se testa aqui: quem for
 * conferir o recadastramento precisa saber que o dado chegou pela PRIMEIRA vez
 * e não bateu com nada. A observação gravada é o único lugar onde essa
 * diferença aparece para a equipe — se ela disser "confirmado", como as
 * outras, o recadastramento de uma ficha vazia vira indistinguível de um que o
 * sistema realmente conferiu.
 */
describe('o que a equipe lê ao conferir', () => {
  it('a observação diz que o próprio filiado informou, e que está a conferir', () => {
    const frase = observacaoDoRecadastramentoOnline(DesafioRecadastramento.IDENTIFICACAO);
    expect(frase).toContain('informados pelo próprio filiado');
    expect(frase).toContain('a conferir');
  });

  /** As outras dizem "confirmado" porque houve conferência de verdade. */
  it('e não se confunde com os desafios que de fato conferiram', () => {
    const conferido = observacaoDoRecadastramentoOnline(DesafioRecadastramento.CPF_NASCIMENTO);
    expect(conferido).toContain('confirmado pelo CPF');
    expect(observacaoDoRecadastramentoOnline(DesafioRecadastramento.IDENTIFICACAO)).not.toBe(
      conferido,
    );
  });

  /** O prefixo é o que `origemDoRecadastramento` lê: não pode mudar. */
  it('continua começando como todo recadastramento pelo link', () => {
    expect(observacaoDoRecadastramentoOnline(DesafioRecadastramento.IDENTIFICACAO)).toMatch(
      /^Recadastramento ONLINE feito pelo próprio filiado \(/,
    );
  });
});

/**
 * A PORTA: o que o filiado encontra ao abrir o link de uma ficha vazia.
 *
 * As duas primeiras travas do validador são puras e estão testadas acima. A
 * terceira precisa de banco — o CPF informado não pode ser de OUTRA ficha — e é
 * a que importa mais, porque é a única que impede um cadastro de virar,
 * silenciosamente, o de outra pessoa.
 */
describe('a porta do link de identificação', () => {
  function montar(opts: { cpfDeOutro?: boolean } = {}) {
    const link = {
      id: 'l1',
      filiadoId: 'f1',
      desafio: DesafioRecadastramento.IDENTIFICACAO,
      tentativas: 0,
      revogadoEm: null,
      usadoEm: null,
      expiraEm: new Date(Date.now() + 20 * 3_600_000),
      filiado: { id: 'f1', nomeCompleto: 'MARIA DA SILVA', cpf: null, dataNascimento: null, numeroCoren: null },
    };
    const prisma = {
      linkRecadastramento: {
        findUnique: jest.fn().mockResolvedValue(link),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      filiado: {
        // A trava de banco: devolve outra ficha quando o CPF já é de alguém.
        findFirst: jest.fn().mockResolvedValue(opts.cpfDeOutro ? { id: 'f2' } : null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'f1', nomeCompleto: 'MARIA DA SILVA', vinculos: [], dependentes: [],
          fotoKey: null, fotoThumbKey: null,
        }),
      },
    };
    const service = new LinkRecadastramentoService(
      prisma as never,
      { registrar: jest.fn() } as never,
      { get: () => undefined } as never,
      {} as never,
      { getSignedUrl: jest.fn() } as never,
      // O portal: o link cria o PRIMEIRO acesso ao concluir o recadastramento.
      { emitirSenhaProvisoria: jest.fn() } as never,
    );
    return { service, prisma, token: service.tokenDoLink('l1') };
  }

  it('CPF válido e livre: entra, e o contador é zerado', async () => {
    const { service, prisma, token } = montar();
    const r = await service.validarDesafio(token, { cpf: CPF_OK, dataNascimento: NASC_OK });
    expect(r.desafio).toBe('IDENTIFICACAO');
    expect(prisma.linkRecadastramento.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tentativas: 0 } }),
    );
  });

  /**
   * O CPF DE OUTRA FICHA É RECUSADO NA PORTA, e não no fim.
   *
   * `garantirUnicidade` já barrava isto no envio — depois de a pessoa ter
   * preenchido o cadastro inteiro. No celular, descobrir no último toque que
   * nada será salvo é desistir.
   */
  it('CPF que já é de outra ficha: recusa', async () => {
    const { service, token } = montar({ cpfDeOutro: true });
    await expect(
      service.validarDesafio(token, { cpf: CPF_OK, dataNascimento: NASC_OK }),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * E A FRASE NÃO ENTREGA DE QUEM É. Sem isto o link vira um oráculo de
   * filiação: digitar CPFs até um responder "já cadastrado" diria quem é
   * filiado do sindicato.
   */
  it('a recusa não diz que o CPF pertence a outro filiado', async () => {
    const { service, token } = montar({ cpfDeOutro: true });
    const erro = (await service
      .validarDesafio(token, { cpf: CPF_OK, dataNascimento: NASC_OK })
      .catch((e: unknown) => e)) as Error;
    expect(erro.message).not.toMatch(/outro|já está cadastrad|pertence/i);
    expect(erro.message).toMatch(/fale com o sindicato/i);
  });

  /** E gasta tentativa: são 5 por link, e o link é de uso único e de 24h. */
  it('a recusa por CPF de outro CONSOME tentativa', async () => {
    const { service, prisma, token } = montar({ cpfDeOutro: true });
    await service.validarDesafio(token, { cpf: CPF_OK, dataNascimento: NASC_OK }).catch(() => {});
    expect(prisma.linkRecadastramento.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tentativas: { increment: 1 } } }),
    );
  });

  /**
   * ERRO DE DIGITAÇÃO NÃO GASTA TENTATIVA — e este é o teste que evita um
   * suporte inteiro. Sem ele, cinco tropeços no teclado do celular matam o
   * link de quem estava fazendo tudo certo. Não há segredo sendo adivinhado
   * aqui: qualquer CPF com dígito certo passa nesta etapa.
   */
  it('CPF mal digitado: 400, e o contador nem é tocado', async () => {
    const { service, prisma, token } = montar();
    await expect(
      service.validarDesafio(token, { cpf: CPF_ERRADO, dataNascimento: NASC_OK }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.linkRecadastramento.updateMany).not.toHaveBeenCalled();
  });

  it('data faltando: 400, e o contador nem é tocado', async () => {
    const { service, prisma, token } = montar();
    await expect(service.validarDesafio(token, { cpf: CPF_OK })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.linkRecadastramento.updateMany).not.toHaveBeenCalled();
  });
});
