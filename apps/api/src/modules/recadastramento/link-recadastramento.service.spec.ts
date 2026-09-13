import { createHash } from 'node:crypto';
import { BadRequestException, GoneException } from '@nestjs/common';
import { LinkRecadastramentoService } from './link-recadastramento.service';
import { FiliadosService } from '../filiados/filiados.service';
import { comContextoDeAuditoria, jaFoiAuditadoPeloServico } from '../../common/audit/audit.contexto';

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
  cpf: '12345678900',
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
    const vivo = linkVivo(base, { desafio: 'NENHUM' });
    // Cadastro sem CPF nem nascimento: o desafio de hoje continua NENHUM, igual ao do link.
    const { service, prisma, audit } = montar({
      vivos: [vivo],
      filiado: { ...FILIADO, cpf: null, dataNascimento: null },
    });

    const r = await service.prepararEnvio('f1', 'COPIAR', { userId: 'u1' });

    expect(r.reaproveitado).toBe(true);
    expect(tokenDaUrl(r.url)).toBe(base.tokenDoLink('link-1'));
    expect(r.desafio).toBe('NENHUM');
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
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const audit = { registrar: jest.fn() };
    const config = { get: () => undefined };
    const service = new LinkRecadastramentoService(
      prisma as never, audit as never, config as never, {} as never, {} as never,
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
});

/**
 * A ÁREA PÚBLICA COM UM LINK DE DESAFIO — achados de 13/09/2026.
 *
 * O prisma de mentira guarda `tentativas` e `revogadoEm` de verdade, para que o
 * contador seja o mesmo entre validar, foto e envio.
 */
function montarPublico(p: { desafio?: string; situacao?: string } = {}) {
  const TOKEN = 'T'.repeat(43);
  const estado = { tentativas: 0, revogadoEm: null as Date | null };
  const prisma = {
    linkRecadastramento: {
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash !== sha(TOKEN)
          ? null
          : {
              id: 'l1', tokenHash: sha(TOKEN), desafio: p.desafio ?? 'CPF_NASCIMENTO',
              tentativas: estado.tentativas, revogadoEm: estado.revogadoEm, usadoEm: null,
              expiraEm: new Date(Date.now() + H),
              filiado: { ...FILIADO, situacao: p.situacao ?? 'ATIVO' },
            },
      ),
      update: jest.fn(async ({ data }: { data: Record<string, any> }) => {
        if (data.tentativas?.increment) estado.tentativas += data.tentativas.increment;
        else if (typeof data.tentativas === 'number') estado.tentativas = data.tentativas;
        if (data.revogadoEm) estado.revogadoEm = data.revogadoEm;
        return { tentativas: estado.tentativas };
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
  );
  return { service, prisma, audit, filiados, estado, TOKEN };
}

const CERTO = { cpf: '123.456.789-00', dataNascimento: '1980-05-10' };
const ERRADO = { cpf: '123.456.789-00', dataNascimento: '1991-01-01' };
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

  it('o incremento é atômico no banco, não `lido + 1`', async () => {
    const { service, prisma, TOKEN } = montarPublico();
    await expect(service.validarDesafio(TOKEN, ERRADO)).rejects.toThrow();
    expect(prisma.linkRecadastramento.update.mock.calls[0][0].data).toEqual({ tentativas: { increment: 1 } });
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
