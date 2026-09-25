import { createHash } from 'node:crypto';
import { BadRequestException, GoneException } from '@nestjs/common';
import { LinkRecadastramentoService } from './link-recadastramento.service';
import { FiliadosService } from '../filiados/filiados.service';
import { comContextoDeAuditoria, jaFoiAuditadoPeloServico } from '../../common/audit/audit.contexto';
import { campoVisivel } from '../../tenant/tenant.config';
import * as desafioDoLink from './desafio-do-link';

/**
 * O ENVIO DO LINK E O RECADASTRO PELO LINK, com prisma de mentira.
 *
 * Testa DECISÃO (reaproveitar × gerar, registrar × calar, recusar) e o que chega
 * ao `prisma.filiado.update` — não a presença de linhas no fonte.
 */

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const H = 3_600_000;
const tokenDaUrl = (url: string) => url.split('/recadastro/')[1];

const FILIADO = {
  id: 'f1',
  nomeCompleto: 'MARIA DA SILVA',
  // Com dígito verificador certo: desde 14/09/2026 CPF inválido não vira desafio.
  cpf: '12345678909',
  dataNascimento: new Date('1980-05-10T03:00:00.000Z'),
  numeroCoren: null,
  situacao: 'ATIVO',
  telefonePrincipal: '(86) 3222-1111',
  telefoneSecundario: '(86) 99999-8888',
  email: ' maria@exemplo.org ',
};

function montar(opts: {
  filiado?: Record<string, unknown> | null;
  vivos?: Array<Record<string, unknown>>;
  ultimoRegistro?: Date | null;
  segredo?: string;
} = {}) {
  const criados: Array<Record<string, any>> = [];
  const prisma = {
    filiado: {
      findUnique: jest.fn().mockResolvedValue(opts.filiado === undefined ? FILIADO : opts.filiado),
    },
    linkRecadastramento: {
      findMany: jest.fn().mockResolvedValue(opts.vivos ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        criados.push(data);
        return { id: data.id, desafio: data.desafio, expiraEm: data.expiraEm };
      }),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const c = criados.find((x) => x.tokenHash === where.tokenHash);
        return c
          ? { ...c, tentativas: 0, usadoEm: null, revogadoEm: null, filiado: FILIADO }
          : null;
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    auditoria: {
      findFirst: jest.fn().mockResolvedValue(opts.ultimoRegistro ? { createdAt: opts.ultimoRegistro } : null),
    },
  };
  const audit = { registrar: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: (k: string) =>
      ({ JWT_ACCESS_SECRET: opts.segredo ?? 'segredo-de-teste', APP_PUBLIC_URL: 'https://app.exemplo.org/' })[k],
  };
  const service = new LinkRecadastramentoService(
    prisma as never, audit as never, config as never, {} as never, {} as never,
    // O portal: o link cria o PRIMEIRO acesso ao concluir o recadastramento.
    { emitirSenhaProvisoria: jest.fn() } as never,
  );
  return { service, prisma, audit, criados };
}

function linkVivo(service: LinkRecadastramentoService, p: Record<string, unknown> = {}) {
  const id = (p.id as string) ?? 'link-1';
  return {
    id,
    tokenHash: sha(service.tokenDoLink(id)),
    desafio: 'CPF_NASCIMENTO',
    expiraEm: new Date(Date.now() + 20 * H),
    usadoEm: null,
    revogadoEm: null,
    createdAt: new Date(Date.now() - 4 * H),
    ...p,
  };
}

describe('token derivado do id do link', () => {
  it('é determinístico por segredo, tem 256 bits em base64url e muda com o segredo', () => {
    const a = montar({ segredo: 'um' }).service;
    const b = montar({ segredo: 'outro' }).service;
    expect(a.tokenDoLink('x')).toBe(montar({ segredo: 'um' }).service.tokenDoLink('x'));
    expect(a.tokenDoLink('x')).not.toBe(b.tokenDoLink('x'));
    expect(a.tokenDoLink('x')).not.toBe(a.tokenDoLink('y'));
    expect(a.tokenDoLink('x')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('o link gerado abre pelo caminho de sempre (busca por sha256 do token)', async () => {
    const { service } = montar();
    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });
    const aberto = await service.abrir(tokenDaUrl(r.url));
    expect(aberto.primeiroNome).toBe('MARIA');
  });
});

describe('prepararEnvio — reaproveitar ou gerar', () => {
  it('sem link vivo: gera, grava o hash do token da URL e registra CREATE "preparado"', async () => {
    const { service, prisma, audit, criados } = montar();
    const r = await service.prepararEnvio('f1', 'WHATSAPP', { userId: 'u1', ip: '1.2.3.4' });

    expect(r.reaproveitado).toBe(false);
    expect(r.url.startsWith('https://app.exemplo.org/recadastro/')).toBe(true);
    expect(criados).toHaveLength(1);
    expect(criados[0].tokenHash).toBe(sha(tokenDaUrl(r.url)));
    expect(tokenDaUrl(r.url)).toBe(service.tokenDoLink(criados[0].id));
    expect(prisma.linkRecadastramento.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { filiadoId: 'f1', usadoEm: null, revogadoEm: null } }),
    );
    // Link novo não tem registro anterior para comparar.
    expect(prisma.auditoria.findFirst).not.toHaveBeenCalled();

    const registro = audit.registrar.mock.calls[0][0];
    expect(registro).toMatchObject({
      acao: 'CREATE', entidade: 'LinkRecadastramento', entidadeId: criados[0].id, userId: 'u1',
      metadata: { filiadoId: 'f1', meio: 'WHATSAPP', reaproveitado: false, decisao: 'SEM_LINK_ATIVO' },
    });
    expect(registro.descricao).toMatch(/preparado para envio por WhatsApp \(link novo; vale até/);
    expect(registro.descricao).not.toMatch(/enviado/i);

    expect(r).toMatchObject({
      desafio: 'CPF_NASCIMENTO',
      primeiroNome: 'MARIA',
      // O principal é fixo: vale o celular do secundário.
      celularWhatsApp: '5586999998888',
      email: 'maria@exemplo.org',
    });
  });

  it('link vivo derivado: devolve o MESMO link, sem gerar nem revogar, e registra UPDATE', async () => {
    const base = montar().service;
    const vivo = linkVivo(base, { desafio: 'CPF' });
    // Cadastro só com CPF: o desafio de hoje continua CPF, igual ao do link.
    const { service, prisma, audit } = montar({
      vivos: [vivo],
      filiado: { ...FILIADO, dataNascimento: null },
    });

    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });

    expect(r.reaproveitado).toBe(true);
    expect(tokenDaUrl(r.url)).toBe(base.tokenDoLink('link-1'));
    expect(r.desafio).toBe('CPF');
    expect(prisma.linkRecadastramento.create).not.toHaveBeenCalled();
    expect(prisma.linkRecadastramento.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditoria.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entidadeId: 'link-1', userId: 'u1', metadata: { path: ['meio'], equals: 'COPIAR' },
        }),
      }),
    );
    expect(audit.registrar.mock.calls[0][0]).toMatchObject({
      acao: 'UPDATE', entidadeId: 'link-1',
      metadata: { meio: 'COPIAR', reaproveitado: true, decisao: 'REAPROVEITADO' },
    });
  });

  it('o mesmo toque dentro de 10 minutos não vira segunda linha na auditoria', async () => {
    const base = montar().service;
    const { service, audit } = montar({
      vivos: [linkVivo(base)],
      ultimoRegistro: new Date(Date.now() - 3 * 60_000),
    });
    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });
    expect(r.reaproveitado).toBe(true);
    expect(audit.registrar).not.toHaveBeenCalled();
  });

  it('link de antes da derivação: gera outro e carimba o motivo', async () => {
    const base = montar().service;
    const { service, prisma, audit } = montar({ vivos: [linkVivo(base, { tokenHash: 'sha-de-token-aleatorio' })] });
    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });
    expect(r.reaproveitado).toBe(false);
    expect(prisma.linkRecadastramento.create).toHaveBeenCalledTimes(1);
    expect(audit.registrar.mock.calls[0][0].metadata).toMatchObject({ decisao: 'LINK_ANTIGO' });
  });

  /**
   * Achado de 13/09/2026: o link NENHUM era reaproveitado depois que a equipe
   * completou CPF e nascimento, e seguia abrindo sem confirmação.
   */
  it('o cadastro passou a ter CPF e nascimento: gera link novo com o desafio de hoje', async () => {
    const base = montar().service;
    const { service, prisma, audit } = montar({ vivos: [linkVivo(base, { desafio: 'NENHUM' })] });
    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });
    expect(r.reaproveitado).toBe(false);
    expect(r.desafio).toBe('CPF_NASCIMENTO');
    expect(prisma.linkRecadastramento.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.linkRecadastramento.create).toHaveBeenCalledTimes(1);
    expect(audit.registrar.mock.calls[0][0].metadata).toMatchObject({ decisao: 'DESAFIO_MUDOU' });
  });
});

describe('prepararEnvio — recusas', () => {
  it('desfiliado: recusa com a frase, sem gerar nada (e gerar também recusa)', async () => {
    const { service, prisma } = montar({ filiado: { ...FILIADO, situacao: 'DESFILIADO' } });
    await expect(service.prepararEnvio('f1', 'COPIAR', {})).rejects.toThrow(
      'Reative o cadastro antes de pedir o recadastramento.',
    );
    await expect(service.gerar('f1', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.linkRecadastramento.create).not.toHaveBeenCalled();
    expect(prisma.linkRecadastramento.updateMany).not.toHaveBeenCalled();
  });

  it('WhatsApp sem celular em nenhum dos dois telefones: 400 antes de mexer no link', async () => {
    const { service, prisma, audit } = montar({
      filiado: { ...FILIADO, telefonePrincipal: '(86) 3222-1111', telefoneSecundario: null },
    });
    await expect(service.prepararEnvio('f1', 'WHATSAPP', {})).rejects.toThrow(/não tem celular com WhatsApp/);
    expect(prisma.linkRecadastramento.findMany).not.toHaveBeenCalled();
    expect(audit.registrar).not.toHaveBeenCalled();
  });

  it('e-mail sem e-mail válido: 400', async () => {
    const { service } = montar({ filiado: { ...FILIADO, email: 'maria@' } });
    await expect(service.prepararEnvio('f1', 'EMAIL', {})).rejects.toThrow('Este cadastro não tem e-mail válido.');
  });

  it('copiar funciona mesmo sem telefone nem e-mail', async () => {
    const { service } = montar({
      filiado: { ...FILIADO, telefonePrincipal: null, telefoneSecundario: null, email: null },
    });
    const r = await service.prepararEnvio('f1', 'COPIAR', {});
    expect(r).toMatchObject({ celularWhatsApp: null, email: null });
  });

  it('filiado inexistente: 404', async () => {
    const { service } = montar({ filiado: null });
    await expect(service.prepararEnvio('nao-existe', 'COPIAR', {})).rejects.toThrow('Filiado não encontrado.');
  });
});

/**
 * NENHUM NÃO GERA MAIS — decisão D23 de 14/09/2026. Medido: 5.007 ativos cairiam
 * nele (9 com atendimento ou processo). A recusa vem ANTES de revogar.
 */
describe('ficha em branco × ficha com dado que não presta', () => {
  /**
   * A DISTINÇÃO QUE MUDOU EM 22/09/2026, e o porquê dela.
   *
   * Até aqui os dois casos caíam no mesmo lugar: sem CPF útil e sem nascimento
   * útil, o link não era gerado. Mas eles pedem coisas opostas.
   *
   *  · FICHA EM BRANCO (5.007 ativos): não há nada gravado. O link PEDE ao
   *    filiado, porque campo vazio é o único que `protegerImutaveis` deixa
   *    preencher — e porque esperar a Triagem coletar um a um nunca fechava.
   *  · DADO GRAVADO QUE NÃO PRESTA (CPF com dígito errado, 01/01/1900): o
   *    campo está preenchido, e preenchido o recadastramento DESCARTA. Mandar
   *    o link pedir o CPF certo seria pedir o que o sistema joga fora. Esse é
   *    da equipe, na edição da ficha.
   */
  const SEM_NADA = { ...FILIADO, cpf: null, dataNascimento: null, numeroCoren: null };

  it('ficha em branco: GERA, com desafio IDENTIFICACAO', async () => {
    const { service, criados } = montar({ filiado: SEM_NADA });
    const r = await service.gerar('f1', { userId: 'u1' });
    expect(r.desafio).toBe('IDENTIFICACAO');
    expect(criados[0].desafio).toBe('IDENTIFICACAO');
  });

  it('ficha em branco: o envio também passa', async () => {
    const { service } = montar({ filiado: SEM_NADA });
    const r = await service.prepararEnvio('f1', 'WHATSAPP', { userId: 'u1' });
    expect(r.desafio).toBe('IDENTIFICACAO');
  });

  it('CPF gravado com dígito errado e sem nascimento: continua recusando', async () => {
    const { service, prisma } = montar({ filiado: { ...SEM_NADA, cpf: '12345678900' } });
    await expect(service.gerar('f1', {})).rejects.toThrow(BadRequestException);
    expect(prisma.linkRecadastramento.create).not.toHaveBeenCalled();
  });

  it('data implausível gravada e sem CPF: continua recusando', async () => {
    const { service, prisma } = montar({
      filiado: { ...SEM_NADA, dataNascimento: new Date('1900-01-01T00:00:00.000Z') },
    });
    await expect(service.gerar('f1', {})).rejects.toThrow(BadRequestException);
    expect(prisma.linkRecadastramento.create).not.toHaveBeenCalled();
  });

  /**
   * A CI roda os dois sindicatos. No SINDSERM o COREN é oculto, então para
   * aquele cliente esta MESMA ficha está em branco — e é IDENTIFICACAO, não
   * recusa. Foi o que mudou aqui: antes o filiado do SINDSERM ficava sem
   * caminho nenhum por causa de um campo que a tela dele nem mostra.
   */
  it('só com COREN: COREN onde o campo aparece, IDENTIFICACAO onde é oculto', async () => {
    const { service, criados } = montar({ filiado: { ...SEM_NADA, numeroCoren: '123456' } });
    const r = await service.gerar('f1', {});
    expect(r.desafio).toBe(campoVisivel('numeroCoren') ? 'COREN' : 'IDENTIFICACAO');
    expect(criados[0].desafio).toBe(r.desafio);
  });
});

describe('gerar — os desafios de um fator só', () => {
  it('só CPF: grava CPF no link e a auditoria diz em português', async () => {
    const { service, audit, criados } = montar({ filiado: { ...FILIADO, dataNascimento: null } });
    const r = await service.gerar('f1', { userId: 'u1' });
    expect(r.desafio).toBe('CPF');
    expect(criados[0].desafio).toBe('CPF');
    const registro = audit.registrar.mock.calls[0][0];
    expect(registro.descricao).toBe('Link de recadastramento gerado para MARIA DA SILVA (confirma só o CPF)');
    expect(registro.metadata).toMatchObject({ filiadoId: 'f1', desafio: 'CPF' });
  });

  it('só nascimento: NASCIMENTO, pelo envio também', async () => {
    const { service, criados } = montar({ filiado: { ...FILIADO, cpf: null } });
    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });
    expect(r.desafio).toBe('NASCIMENTO');
    expect(criados[0].desafio).toBe('NASCIMENTO');
  });

  /** O link CPF de ontem e o cadastro que ganhou o nascimento hoje: link novo. */
  it('link CPF vivo e o cadastro completo agora: gera CPF_NASCIMENTO por DESAFIO_MUDOU', async () => {
    const base = montar().service;
    const { service, audit } = montar({ vivos: [linkVivo(base, { desafio: 'CPF' })] });
    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });
    expect(r).toMatchObject({ reaproveitado: false, desafio: 'CPF_NASCIMENTO' });
    expect(audit.registrar.mock.calls[0][0].metadata).toMatchObject({ decisao: 'DESAFIO_MUDOU' });
  });
});

describe('previa — o que a tela de envio pergunta', () => {
  /**
   * O MOTIVO (14/09/2026): o desfiliado com a ficha completa ouvia "não tem CPF
   * nem data de nascimento". E o CPF gravado com dígito errado aparece na ficha,
   * então a tela precisa saber que ele existe e não serve.
   */
  /*
    `nascimentoGravadoInvalido` (15/09/2026): 01/01/1900 na ficha fazia a tela
    mandar "Completar a ficha" para o recadastro presencial, onde a data já
    preenchida é somente leitura. A tela precisa saber que a data existe e não
    serve, para levar à edição direta.
  */
  it.each([
    ['completo', {}, 'CPF_NASCIMENTO', true, null, false, false],
    ['só CPF', { dataNascimento: null }, 'CPF', true, null, false, false],
    ['só nascimento', { cpf: null }, 'NASCIMENTO', true, null, false, false],
    // 22/09/2026: ficha em branco gera link — ele PEDE os dados ao filiado.
    ['nada', { cpf: null, dataNascimento: null }, 'IDENTIFICACAO', true, null, false, false],
    ['desfiliado completo', { situacao: 'DESFILIADO' }, 'CPF_NASCIMENTO', false, 'DESFILIADO', false, false],
    // DESFILIADO MANDA SOBRE O DESAFIO, e continua mandando: mesmo com a ficha
    // em branco, o caminho é reativar, não recadastrar. O desafio mudou de
    // nome; a recusa e o motivo não mudaram.
    ['desfiliado sem nada', { situacao: 'DESFILIADO', cpf: null, dataNascimento: null }, 'IDENTIFICACAO', false, 'DESFILIADO', false, false],
    ['CPF com dígito errado e sem nascimento', { cpf: '12345678900', dataNascimento: null }, 'NENHUM', false, 'SEM_CONFIRMACAO', true, false],
    ['CPF com 10 dígitos e nascimento', { cpf: '2345678909' }, 'NASCIMENTO', true, null, true, false],
    // Espaço em branco não é dado gravado: a ficha está vazia.
    ['CPF só com espaços', { cpf: '   ', dataNascimento: null }, 'IDENTIFICACAO', true, null, false, false],
    ['CPF certo e nascimento 01/01/1900', { dataNascimento: new Date('1900-01-01T03:00:00.000Z') }, 'CPF', true, null, false, true],
    ['CPF errado e nascimento de 2020', { cpf: '12345678900', dataNascimento: new Date('2020-03-01T03:00:00.000Z') }, 'NENHUM', false, 'SEM_CONFIRMACAO', true, true],
  ])('%s → %s, podeGerar %p, motivo %p, cpfGravadoInvalido %p, nascimentoGravadoInvalido %p', async (
    _nome, extra, desafio, podeGerar, motivo, cpfGravadoInvalido, nascimentoGravadoInvalido,
  ) => {
    const { service } = montar({ filiado: { ...FILIADO, ...extra } });
    expect(await service.previa('f1')).toEqual({ desafio, podeGerar, motivo, cpfGravadoInvalido, nascimentoGravadoInvalido });
  });

  it('não devolve dado nenhum do cadastro, não grava e não deixa o interceptor gravar', async () => {
    const { service, prisma, audit } = montar();
    const { r, calou } = await comContextoDeAuditoria(async () => {
      const r = await service.previa('f1');
      return { r, calou: jaFoiAuditadoPeloServico() };
    });
    expect(Object.keys(r).sort()).toEqual(['cpfGravadoInvalido', 'desafio', 'motivo', 'nascimentoGravadoInvalido', 'podeGerar']);
    expect(JSON.stringify(r)).not.toContain(FILIADO.cpf);
    expect(JSON.stringify(r)).not.toContain('1980');
    expect(calou).toBe(true);
    expect(audit.registrar).not.toHaveBeenCalled();
    expect(prisma.linkRecadastramento.create).not.toHaveBeenCalled();
    expect(prisma.linkRecadastramento.updateMany).not.toHaveBeenCalled();
    // Pede ao banco só o que decide.
    expect(prisma.filiado.findUnique.mock.calls[0][0].select).toEqual({
      cpf: true, dataNascimento: true, numeroCoren: true, situacao: true,
    });
  });

  it('filiado inexistente: 404', async () => {
    await expect(montar({ filiado: null }).service.previa('x')).rejects.toThrow('Filiado não encontrado.');
  });
});

describe('submeter — o que o link grava', () => {
  function montarEnvio() {
    const link = {
      id: 'l1', desafio: 'NENHUM', tentativas: 0, revogadoEm: null, usadoEm: null,
      expiraEm: new Date(Date.now() + H),
      filiado: { id: 'f1', nomeCompleto: 'MARIA', cpf: null, dataNascimento: null, numeroCoren: null },
    };
    const prisma = {
      linkRecadastramento: {
        findUnique: jest.fn().mockResolvedValue(link),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      filiado: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          cpf: null, rg: null, ufRg: null, dataNascimento: null, naturalidade: null,
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'f1', nomeCompleto: 'MARIA', situacao: 'DESFILIADO',
          vinculos: [{
            empresa: 'HOSPITAL', parteExternaId: 'org-1', descontoEmFolha: true, cargo: null,
            lotacao: 'UTI', matricula: null, quadro: 'EFETIVO', matriculaNormalizada: null, ordem: 1,
          }],
          dependentes: [],
        }),
        update: jest.fn().mockResolvedValue({ nomeCompleto: 'MARIA' }),
      },
      recadastramento: { create: jest.fn().mockResolvedValue({}) },
      filiadoHistorico: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const audit = { registrar: jest.fn() };
    const config = { get: () => undefined };
    const service = new LinkRecadastramentoService(
      prisma as never, audit as never, config as never, {} as never, {} as never,
      { emitirSenhaProvisoria: jest.fn() } as never,
    );
    return { service, prisma };
  }

  /**
   * DEFESA EM PROFUNDIDADE: mesmo que o corpo chegue sem passar pelo pipe (foi
   * o que a interseção no tipo fazia), `situacao`, `matricula` e escrita
   * aninhada não chegam ao update.
   */
  it('só os campos da lista chegam ao update, mesmo que o corpo traga mais', async () => {
    const { service, prisma } = montarEnvio();
    const corpo = {
      nomeCompleto: 'MARIA DA SILVA',
      telefonePrincipal: '(86) 99999-8888',
      situacao: 'ATIVO',
      matricula: '000001',
      qrToken: 'forjado',
      cobrancas: { deleteMany: {} },
      historico: { deleteMany: {} },
      vinculos: [{ empresa: 'hospital', cargo: 'Técnica' }],
    };
    await service.submeter('t'.repeat(43), corpo as never, '1.2.3.4');

    const data = prisma.filiado.update.mock.calls[0][0].data;
    expect(data.nomeCompleto).toBe('MARIA DA SILVA');
    expect(data.telefonePrincipal).toBe('(86) 99999-8888');
    for (const proibido of ['situacao', 'matricula', 'qrToken', 'cobrancas', 'historico']) {
      expect(`${proibido}: ${proibido in data}`).toBe(`${proibido}: false`);
    }
    // O vínculo do mesmo empregador herdou o que a equipe tinha registrado.
    expect(data.vinculos.deleteMany).toEqual({});
    expect(data.vinculos.create).toEqual([
      expect.objectContaining({
        empresa: 'hospital', cargo: 'Técnica', descontoEmFolha: true, parteExternaId: 'org-1',
        lotacao: 'UTI', quadro: 'EFETIVO',
      }),
    ]);

    const novos = prisma.recadastramento.create.mock.calls[0][0].data.dadosNovos;
    expect('situacao' in novos).toBe(false);
    expect(novos.vinculos).toEqual([{ empresa: 'hospital', cargo: 'Técnica' }]);
  });

  /** Link NENHUM vivo de antes de 14/09: a observação carimba que não houve confirmação. */
  it('a observação diz como o link confirmou a identidade', async () => {
    const { service, prisma } = montarEnvio();
    await service.submeter('t'.repeat(43), { nomeCompleto: 'MARIA' } as never);
    expect(prisma.recadastramento.create.mock.calls[0][0].data.observacao).toBe(
      'Recadastramento ONLINE feito pelo próprio filiado (link; sem confirmação de identidade).',
    );
    // O link morre só se ainda estava vivo.
    expect(prisma.linkRecadastramento.updateMany.mock.calls[0][0].where).toEqual({
      id: 'l1', usadoEm: null, revogadoEm: null,
    });
  });

  /**
   * Dois envios certos disparados juntos (14/09/2026): os dois passavam por
   * `carregarValido` com o link vivo e os dois gravavam. Quem chega segundo
   * não acha link vivo para queimar e não grava nada.
   */
  it('o outro envio já queimou o link: 410, sem gravar cadastro, recadastramento nem histórico', async () => {
    const { service, prisma } = montarEnvio();
    prisma.linkRecadastramento.updateMany.mockResolvedValue({ count: 0 });
    const erro = await service.submeter('t'.repeat(43), { nomeCompleto: 'MARIA' } as never).catch((e) => e);
    expect(erro).toBeInstanceOf(GoneException);
    expect(erro.message).toBe('Este link já foi utilizado. Solicite um novo ao sindicato.');
    expect(prisma.filiado.update).not.toHaveBeenCalled();
    expect(prisma.recadastramento.create).not.toHaveBeenCalled();
    expect(prisma.filiadoHistorico.create).not.toHaveBeenCalled();
  });
});

/**
 * A ÁREA PÚBLICA COM UM LINK DE DESAFIO — achados de 13/09/2026.
 *
 * O prisma de mentira guarda `tentativas` e `revogadoEm` de verdade, para que o
 * contador seja o mesmo entre validar, foto e envio.
 */
function montarPublico(p: { desafio?: string; situacao?: string; ficha?: Record<string, unknown> } = {}) {
  const TOKEN = 'T'.repeat(43);
  const estado = { tentativas: 0, revogadoEm: null as Date | null };
  /*
    A FICHA DE AGORA PEDE O MESMO DESAFIO QUE O LINK, a não ser que o teste diga
    o contrário em `ficha` (15/09/2026): o link cujo desafio mudou depois de
    mandado responde "cancelado". Link CPF saiu de ficha sem nascimento; link
    NASCIMENTO, de ficha sem CPF.
  */
  const DA_FICHA_DO_DESAFIO: Record<string, Record<string, unknown>> = {
    CPF: { dataNascimento: null },
    NASCIMENTO: { cpf: null },
  };
  const ficha = {
    ...FILIADO,
    ...(DA_FICHA_DO_DESAFIO[p.desafio ?? ''] ?? {}),
    situacao: p.situacao ?? 'ATIVO',
    ...p.ficha,
  };
  const prisma = {
    linkRecadastramento: {
      findUnique: jest.fn(async ({ where }: { where: { tokenHash?: string; id?: string } }) =>
        where.id !== undefined
          ? (where.id === 'l1' ? { tentativas: estado.tentativas } : null)
          : where.tokenHash !== sha(TOKEN)
          ? null
          : {
              id: 'l1', tokenHash: sha(TOKEN), desafio: p.desafio ?? 'CPF_NASCIMENTO',
              tentativas: estado.tentativas, revogadoEm: estado.revogadoEm, usadoEm: null,
              expiraEm: new Date(Date.now() + H),
              filiado: ficha,
            },
      ),
      update: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        if (data.tentativas?.increment) estado.tentativas += data.tentativas.increment;
        else if (typeof data.tentativas === 'number') estado.tentativas = data.tentativas;
        if (data.revogadoEm) estado.revogadoEm = data.revogadoEm;
        return { tentativas: estado.tentativas };
      }),
      /*
        A escrita condicional como o Postgres a faz: cada condição PRESENTE no
        `where` é conferida contra o estado de agora, no instante da chamada. Uma
        condição que o serviço esquecesse não seria conferida, e o teste de
        corrida cairia.
      */
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        if (where.id !== 'l1') return { count: 0 };
        if ('revogadoEm' in where && where.revogadoEm === null && estado.revogadoEm) return { count: 0 };
        if (where.tentativas?.lt !== undefined && !(estado.tentativas < where.tentativas.lt)) return { count: 0 };
        if (where.expiraEm?.gt && !(Date.now() + H > where.expiraEm.gt.getTime())) return { count: 0 };
        if (data.tentativas?.increment) estado.tentativas += data.tentativas.increment;
        return { count: 1 };
      }),
    },
    filiado: {
      findUnique: jest.fn().mockResolvedValue({
        ...FILIADO, vinculos: [], dependentes: [], fotoKey: null, fotoThumbKey: null,
      }),
    },
  };
  const audit = { registrar: jest.fn().mockResolvedValue(undefined) };
  const filiados = { atualizarFoto: jest.fn().mockResolvedValue({}) };
  const service = new LinkRecadastramentoService(
    prisma as never, audit as never, { get: () => undefined } as never, filiados as never, {} as never,
    { emitirSenhaProvisoria: jest.fn() } as never,
  );
  return { service, prisma, audit, filiados, estado, TOKEN };
}

const CERTO = { cpf: '123.456.789-09', dataNascimento: '1980-05-10' };
const ERRADO = { cpf: '123.456.789-09', dataNascimento: '1991-01-01' };
const IMAGEM = Buffer.from('imagem');

describe('desafio — um contador só para validar, foto e envio', () => {
  it('/enviar com a data errada conta e, na quinta, queima o link com o texto de sempre', async () => {
    const { service, estado, TOKEN } = montarPublico();
    const errado = { cpfConfirmacao: ERRADO.cpf, dataNascimentoConfirmacao: ERRADO.dataNascimento };
    for (let i = 1; i <= 4; i++) {
      await expect(service.submeter(TOKEN, errado as never)).rejects.toThrow(
        `Dados não conferem. Restam ${5 - i} tentativa(s).`,
      );
    }
    await expect(service.submeter(TOKEN, errado as never)).rejects.toThrow(/Muitas tentativas incorretas/);
    expect(estado.tentativas).toBe(5);
    expect(estado.revogadoEm).toBeInstanceOf(Date);
    // Queimado: nem a resposta certa entra mais.
    await expect(service.validarDesafio(TOKEN, CERTO)).rejects.toThrow('Este link foi cancelado.');
  });

  it('erros espalhados pelas três portas somam no mesmo contador', async () => {
    const { service, estado, TOKEN } = montarPublico();
    await expect(service.validarDesafio(TOKEN, ERRADO)).rejects.toThrow(/Restam 4/);
    await expect(service.atualizarFoto(TOKEN, IMAGEM, 'image/jpeg', ERRADO)).rejects.toThrow(/Restam 3/);
    await expect(
      service.submeter(TOKEN, { dataNascimentoConfirmacao: ERRADO.dataNascimento } as never),
    ).rejects.toThrow(/Restam 2/);
    expect(estado.tentativas).toBe(3);
  });

  it('o incremento é atômico no banco, não `lido + 1`, e só pega o link vivo abaixo do limite', async () => {
    const { service, prisma, TOKEN } = montarPublico();
    await expect(service.validarDesafio(TOKEN, ERRADO)).rejects.toThrow();
    const reserva = prisma.linkRecadastramento.updateMany.mock.calls[0][0];
    expect(reserva.data).toEqual({ tentativas: { increment: 1 } });
    expect(reserva.where).toEqual({
      id: 'l1', revogadoEm: null, usadoEm: null, expiraEm: { gt: expect.any(Date) }, tentativas: { lt: 5 },
    });
  });

  /**
   * PEDIDOS SIMULTÂNEOS (14/09/2026). Doze pedidos no link NASCIMENTO, onze com
   * datas erradas e o último com a certa, disparados juntos: todos leem o link
   * vivo antes de qualquer um contar. Antes, os doze conferiam e o último
   * levava o cadastro. Agora só quem reservou uma tentativa confere.
   */
  it('doze pedidos juntos: no máximo cinco conferências, e a data certa no fim não entra', async () => {
    const { service, prisma, estado, TOKEN } = montarPublico({ desafio: 'NASCIMENTO' });
    const conferir = jest.spyOn(desafioDoLink, 'conferirResposta');
    try {
      const erradas = Array.from({ length: 11 }, (_, i) => ({ dataNascimento: `1990-01-${String(i + 1).padStart(2, '0')}` }));
      const pedidos = [...erradas, { dataNascimento: '1980-05-10' }].map((r) =>
        service.validarDesafio(TOKEN, r).then(() => 'ENTROU', (e: Error) => e));
      const resultados = await Promise.all(pedidos);

      expect(conferir.mock.calls.length).toBeLessThanOrEqual(5);
      expect(resultados).not.toContain('ENTROU');
      expect(resultados[11]).toBeInstanceOf(GoneException);
      // O cadastro completo nunca foi lido.
      expect(prisma.filiado.findUnique).not.toHaveBeenCalled();
      expect(estado.tentativas).toBe(5);
      expect(estado.revogadoEm).toBeInstanceOf(Date);
    } finally {
      conferir.mockRestore();
    }
  });

  it('acertar o desafio não deixa o interceptor gravar a URL (que tem o token)', async () => {
    const { service, TOKEN } = montarPublico();
    const calou = await comContextoDeAuditoria(async () => {
      await service.validarDesafio(TOKEN, CERTO);
      return jaFoiAuditadoPeloServico();
    });
    expect(calou).toBe(true);
  });
});

/**
 * A PÁGINA PÚBLICA ANTIGA CONTRA A API NOVA — a janela de troca (14/09/2026).
 *
 * A página em cache só conhece dois formulários: COREN, ou CPF + data. Num link
 * CPF ou NASCIMENTO ela mostra os dois campos e manda os dois. A conferência lê
 * só o campo do desafio, e é isso que deixa esses links funcionarem nela.
 */
describe('desafios de um fator só com o corpo da página antiga', () => {
  it('link CPF: o CPF certo com qualquer data entra, em validar, foto e envio', async () => {
    const { service, filiados, estado, TOKEN } = montarPublico({ desafio: 'CPF' });
    const DA_PAGINA_ANTIGA = { cpf: '12345678909', dataNascimento: '1991-01-01', coren: undefined };
    const r = await service.validarDesafio(TOKEN, DA_PAGINA_ANTIGA);
    expect(r.desafio).toBe('CPF');
    await service.atualizarFoto(TOKEN, IMAGEM, 'image/jpeg', DA_PAGINA_ANTIGA);
    expect(filiados.atualizarFoto).toHaveBeenCalledTimes(1);
    // Cada acerto reservou uma tentativa e a devolveu.
    expect(estado.tentativas).toBe(0);
  });

  it('link CPF: CPF errado conta a tentativa mesmo com a data certa', async () => {
    const { service, estado, TOKEN } = montarPublico({ desafio: 'CPF' });
    await expect(
      service.validarDesafio(TOKEN, { cpf: '52998224725', dataNascimento: '1980-05-10' }),
    ).rejects.toThrow('Dados não conferem. Restam 4 tentativa(s).');
    expect(estado.tentativas).toBe(1);
  });

  it('link NASCIMENTO: a data certa entra com o CPF em branco; a errada conta', async () => {
    const { service, estado, TOKEN } = montarPublico({ desafio: 'NASCIMENTO' });
    await expect(service.validarDesafio(TOKEN, { dataNascimento: '1991-01-01' })).rejects.toThrow(/Restam 4/);
    expect(estado.tentativas).toBe(1);
    const r = await service.validarDesafio(TOKEN, { dataNascimento: '1980-05-10' });
    expect(r.desafio).toBe('NASCIMENTO');
    // Acertou: zera.
    expect(estado.tentativas).toBe(0);
  });
});

describe('foto pelo link', () => {
  it('sem as respostas do desafio: 403, conta a tentativa e a foto antiga fica', async () => {
    const { service, filiados, estado, TOKEN } = montarPublico();
    await expect(service.atualizarFoto(TOKEN, IMAGEM, 'image/jpeg')).rejects.toThrow(/Dados não conferem/);
    expect(filiados.atualizarFoto).not.toHaveBeenCalled();
    expect(estado.tentativas).toBe(1);
  });

  it('com as respostas: troca e grava registro próprio, sem o token', async () => {
    const { service, filiados, audit, TOKEN } = montarPublico();
    await service.atualizarFoto(TOKEN, IMAGEM, 'image/jpeg', CERTO, '1.2.3.4');
    expect(filiados.atualizarFoto).toHaveBeenCalledWith('f1', IMAGEM, 'Filiado (link online)');
    const registro = audit.registrar.mock.calls[0][0];
    expect(registro).toMatchObject({
      acao: 'UPDATE', entidade: 'Filiado', entidadeId: 'f1', userId: null, ip: '1.2.3.4',
      metadata: { linkId: 'l1', desafio: 'CPF_NASCIMENTO' },
    });
    expect(JSON.stringify(registro)).not.toContain(TOKEN);
  });

  it('link sem desafio: o token basta, como antes', async () => {
    const { service, filiados, TOKEN } = montarPublico({ desafio: 'NENHUM' });
    await service.atualizarFoto(TOKEN, IMAGEM, 'image/png');
    expect(filiados.atualizarFoto).toHaveBeenCalledTimes(1);
  });
});

/**
 * O LINK CUJO DESAFIO MUDOU DEPOIS DE MANDADO (15/09/2026).
 *
 * O desafio é gravado na geração e conferido contra a ficha de agora. A equipe
 * apagou a data de uma ficha depois de mandar o link CPF_NASCIMENTO: o filiado
 * queimava as 5 tentativas sem pista. Agora o link responde "cancelado" antes
 * de gastar tentativa nenhuma.
 */
describe('link cujo desafio mudou depois de mandado', () => {
  const CANCELADO = 'Este link foi cancelado. Solicite um novo ao sindicato.';

  it('CPF_NASCIMENTO e a data foi apagada da ficha: nenhuma das quatro portas abre, e nada é contado', async () => {
    const { service, filiados, prisma, estado, TOKEN } = montarPublico({ ficha: { dataNascimento: null } });
    for (const tentativa of [
      () => service.abrir(TOKEN),
      () => service.validarDesafio(TOKEN, CERTO),
      () => service.atualizarFoto(TOKEN, IMAGEM, 'image/jpeg', CERTO),
      () => service.submeter(TOKEN, { cpfConfirmacao: CERTO.cpf, dataNascimentoConfirmacao: CERTO.dataNascimento } as never),
    ]) {
      const erro = await tentativa().catch((e) => e);
      expect(erro).toBeInstanceOf(GoneException);
      expect(erro.message).toBe(CANCELADO);
    }
    expect(estado.tentativas).toBe(0);
    expect(prisma.linkRecadastramento.updateMany).not.toHaveBeenCalled();
    expect(filiados.atualizarFoto).not.toHaveBeenCalled();
  });

  it('link CPF e o CPF foi apagado (a ficha já não pede nada): cancelado', async () => {
    const { service, TOKEN } = montarPublico({ desafio: 'CPF', ficha: { cpf: null } });
    await expect(service.validarDesafio(TOKEN, { cpf: CERTO.cpf })).rejects.toThrow(CANCELADO);
  });

  it('link NASCIMENTO e a equipe gravou o CPF depois: a ficha pediria os dois, cancelado', async () => {
    const { service, TOKEN } = montarPublico({ desafio: 'NASCIMENTO', ficha: { cpf: '12345678909' } });
    await expect(service.abrir(TOKEN)).rejects.toThrow(CANCELADO);
  });

  it('o mesmo desafio com outro valor continua abrindo: é a ficha de agora que confere', async () => {
    const { service, TOKEN } = montarPublico({ desafio: 'CPF', ficha: { cpf: '52998224725' } });
    await expect(service.abrir(TOKEN)).resolves.toMatchObject({ desafio: 'CPF', primeiroNome: 'MARIA' });
    await expect(service.validarDesafio(TOKEN, { cpf: '529.982.247-25' })).resolves.toMatchObject({ desafio: 'CPF' });
  });

  it('o link NENHUM antigo não pede nada, então nada nele deixou de conferir: abre até vencer', async () => {
    const { service, TOKEN } = montarPublico({ desafio: 'NENHUM' });
    await expect(service.abrir(TOKEN)).resolves.toMatchObject({ desafio: 'NENHUM' });
  });
});

describe('link de quem foi desfiliado', () => {
  it('não abre, não valida e não grava: Gone com a frase do cancelado', async () => {
    const { service, filiados, TOKEN } = montarPublico({ situacao: 'DESFILIADO' });
    for (const tentativa of [
      () => service.abrir(TOKEN),
      () => service.validarDesafio(TOKEN, CERTO),
      () => service.atualizarFoto(TOKEN, IMAGEM, 'image/jpeg', CERTO),
      () => service.submeter(TOKEN, {} as never),
    ]) {
      const erro = await tentativa().catch((e) => e);
      expect(erro).toBeInstanceOf(GoneException);
      expect(erro.message).toBe('Este link foi cancelado. Solicite um novo ao sindicato.');
    }
    expect(filiados.atualizarFoto).not.toHaveBeenCalled();
  });

  it('desfiliar revoga os links vivos do filiado e conta quantos na auditoria', async () => {
    const prisma = {
      filiado: {
        findUnique: jest.fn().mockResolvedValue({ id: 'f1', nomeCompleto: 'MARIA', situacao: 'ATIVO' }),
        update: jest.fn().mockResolvedValue({ id: 'f1', situacao: 'DESFILIADO' }),
      },
      linkRecadastramento: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      filiadoHistorico: { create: jest.fn().mockResolvedValue({}) },
    };
    const audit = { registrar: jest.fn().mockResolvedValue(undefined) };
    const filiadosService = new FiliadosService(
      prisma as never, {} as never, {} as never, {} as never, audit as never,
    );
    await filiadosService.desfiliar('f1', { motivo: 'SOLICITACAO_PESSOAL' } as never, 'Balcão');

    expect(prisma.linkRecadastramento.updateMany).toHaveBeenCalledWith({
      where: { filiadoId: 'f1', usadoEm: null, revogadoEm: null },
      data: { revogadoEm: expect.any(Date) },
    });
    expect(audit.registrar.mock.calls[0][0].metadata).toMatchObject({ linksDeRecadastroCancelados: 1 });
  });
});
