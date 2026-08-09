import { StorageService, dataCalendario, diasPossiveis } from '@core/infra';
import {
  BadRequestException, ConflictException, ForbiddenException, GoneException,
  Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { DesafioRecadastramento, Prisma, StatusRecadastramento, TipoHistoricoFiliado } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AcaoAuditoria } from '@prisma/client';
import { UpdateFiliadoDto } from '../filiados/dto/filiado.dto';

import { FiliadosService } from '../filiados/filiados.service';
import { protegerImutaveis } from '../filiados/campos-imutaveis';

import {
  montarSincronizacaoDependentes, resumirDependentes,
} from '../dependentes/dependentes.sync';
import { campoVisivel } from '../../tenant/tenant.config';

interface Ctx {
  userId?: string;
  nome?: string;
  ip?: string;
  userAgent?: string;
}

/** Validade padrão do link. */
const HORAS_VALIDADE = 24;
/** Tentativas erradas no desafio antes de queimar o link. */
const MAX_TENTATIVAS = 5;
/** A rota da foto é pública — o que entra precisa ser imagem e ter tamanho sensato. */
const MIMES_FOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TAMANHO_MAX_FOTO = 8 * 1024 * 1024;

@Injectable()
export class LinkRecadastramentoService {
  private readonly logger = new Logger(LinkRecadastramentoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly filiados: FiliadosService,
    private readonly storage: StorageService,
  ) {}

  /** Guardamos só o hash — o token em claro existe apenas na URL enviada. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Decide o desafio a partir do que o cadastro TEM hoje.
   *
   * Regra de negócio: quem não tem CPF, nascimento nem COREN não teria como
   * provar identidade — nesses casos o link abre direto (e é de uso único).
   */
  private definirDesafio(f: { cpf: string | null; dataNascimento: Date | null; numeroCoren: string | null }): DesafioRecadastramento {
    if (f.cpf && f.dataNascimento) return DesafioRecadastramento.CPF_NASCIMENTO;
    // Na prática o COREN já seria nulo numa instalação que esconde o campo; a
    // checagem existe para o caso de dado importado de fora, que passaria a
    // pedir na tela um número de conselho de enfermagem a um servidor público.
    if (f.numeroCoren && campoVisivel('numeroCoren')) return DesafioRecadastramento.COREN;
    return DesafioRecadastramento.NENHUM;
  }

  // =========================================================================
  // 1) GERAÇÃO (equipe autenticada)
  // =========================================================================

  async gerar(filiadoId: string, ctx: Ctx) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: { id: true, nomeCompleto: true, cpf: true, dataNascimento: true, numeroCoren: true },
    });
    if (!filiado) throw new NotFoundException('Filiado não encontrado.');

    const desafio = this.definirDesafio(filiado);
    const token = randomBytes(32).toString('base64url');
    const expiraEm = new Date(Date.now() + HORAS_VALIDADE * 3600_000);

    // Um link novo invalida os anteriores do mesmo filiado — evita vários
    // links vivos ao mesmo tempo para a mesma pessoa.
    await this.prisma.linkRecadastramento.updateMany({
      where: { filiadoId, usadoEm: null, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });

    const link = await this.prisma.linkRecadastramento.create({
      data: {
        filiadoId,
        tokenHash: this.hash(token),
        desafio,
        expiraEm,
        criadoPor: ctx.userId ?? null,
      },
      select: { id: true, desafio: true, expiraEm: true },
    });

    await this.audit.registrar({
      userId: ctx.userId ?? null,
      acao: AcaoAuditoria.CREATE,
      entidade: 'LinkRecadastramento',
      entidadeId: link.id,
      descricao: `Link de recadastramento gerado para ${filiado.nomeCompleto} (desafio: ${desafio})`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { filiadoId, desafio, expiraEm: expiraEm.toISOString() },
    });

    return {
      ...link,
      url: `${this.baseUrlPublica()}/recadastro/${token}`,
      // O token só é devolvido AGORA (nunca mais é recuperável).
      token,
      filiado: { id: filiado.id, nomeCompleto: filiado.nomeCompleto },
    };
  }

  /** Links do filiado (para a equipe ver o que está ativo). */
  listar(filiadoId: string) {
    return this.prisma.linkRecadastramento.findMany({
      where: { filiadoId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true, desafio: true, expiraEm: true, usadoEm: true,
        revogadoEm: true, tentativas: true, createdAt: true,
      },
    });
  }

  async revogar(id: string, ctx: Ctx) {
    const link = await this.prisma.linkRecadastramento.findUnique({ where: { id }, select: { id: true } });
    if (!link) throw new NotFoundException('Link não encontrado.');
    await this.prisma.linkRecadastramento.update({ where: { id }, data: { revogadoEm: new Date() } });
    await this.audit.registrar({
      userId: ctx.userId ?? null, acao: AcaoAuditoria.UPDATE, entidade: 'LinkRecadastramento',
      entidadeId: id, descricao: 'Link de recadastramento revogado', ip: ctx.ip, metadata: {},
    });
    return { ok: true };
  }

  // =========================================================================
  // 2) ACESSO PÚBLICO (sem login)
  // =========================================================================

  /** Carrega e valida o link. Devolve só o necessário para montar a tela. */
  async abrir(token: string, ip?: string) {
    const link = await this.carregarValido(token);
    await this.prisma.linkRecadastramento.update({
      where: { id: link.id },
      data: { ipUltimoAcesso: ip ?? null },
    });

    return {
      desafio: link.desafio,
      expiraEm: link.expiraEm,
      // Primeiro nome só para a pessoa reconhecer que é o cadastro dela.
      // LGPD: nada além disso antes de passar o desafio.
      primeiroNome: link.filiado.nomeCompleto.trim().split(/\s+/)[0],
    };
  }

  /**
   * Confere o desafio e libera os dados do cadastro para edição.
   * Retorna o filiado COMPLETO — é o que o formulário precisa preencher.
   */
  async validarDesafio(token: string, resposta: { cpf?: string; dataNascimento?: string; coren?: string }) {
    const link = await this.carregarValido(token);
    const f = link.filiado;

    if (link.desafio !== DesafioRecadastramento.NENHUM) {
      const ok = this.conferir(link.desafio, f, resposta);
      if (!ok) {
        const tentativas = link.tentativas + 1;
        await this.prisma.linkRecadastramento.update({
          where: { id: link.id },
          // Estourou o limite? Queima o link (revoga) — não adianta insistir.
          data: {
            tentativas,
            ...(tentativas >= MAX_TENTATIVAS ? { revogadoEm: new Date() } : {}),
          },
        });
        if (tentativas >= MAX_TENTATIVAS) {
          throw new ForbiddenException(
            'Muitas tentativas incorretas. Este link foi bloqueado — solicite um novo ao sindicato.',
          );
        }
        throw new ForbiddenException(
          `Dados não conferem. Restam ${MAX_TENTATIVAS - tentativas} tentativa(s).`,
        );
      }
      // Acertou: zera o contador.
      if (link.tentativas > 0) {
        await this.prisma.linkRecadastramento.update({ where: { id: link.id }, data: { tentativas: 0 } });
      }
    }

    const completo = await this.prisma.filiado.findUnique({
      where: { id: f.id },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        // O filiado precisa ver os dependentes atuais para poder corrigi-los.
        dependentes: { orderBy: { createdAt: 'asc' } },
      },
    });
    // A foto atual entra como URL assinada só para o filiado ver o que está no
    // cadastro hoje — as chaves de storage não saem daqui.
    const { fotoKey, fotoThumbKey, ...dados } = completo!;
    const fotoUrl = fotoKey ? await this.storage.getSignedUrl(fotoKey).catch(() => null) : null;
    return { filiado: { ...dados, fotoUrl }, desafio: link.desafio };
  }

  /**
   * Troca a foto pelo link público.
   *
   * Só vale enquanto o link está válido (antes do envio, que o queima). O
   * arquivo passa pelo MESMO processamento da equipe — recorte, WebP e
   * miniatura — então nada cru do filiado chega ao storage.
   */
  async atualizarFoto(token: string, arquivo: Buffer, mimetype: string) {
    if (!MIMES_FOTO.has(mimetype)) {
      throw new BadRequestException('Envie uma imagem JPG, PNG ou WebP.');
    }
    if (arquivo.length > TAMANHO_MAX_FOTO) {
      throw new BadRequestException('A imagem deve ter no máximo 8 MB.');
    }
    const link = await this.carregarValido(token);
    await this.filiados.atualizarFoto(link.filiado.id, arquivo, 'Filiado (link online)');
    return { ok: true };
  }

  /**
   * Grava o recadastramento feito pelo próprio filiado.
   *
   * O desafio é conferido DE NOVO aqui: a etapa anterior é só de tela, e um
   * cliente malicioso poderia pular direto para o envio.
   */
  async submeter(
    token: string,
    dto: UpdateFiliadoDto & { cpfConfirmacao?: string; dataNascimentoConfirmacao?: string; corenConfirmacao?: string },
    ip?: string,
  ) {
    const link = await this.carregarValido(token);
    const atual = link.filiado;

    if (link.desafio !== DesafioRecadastramento.NENHUM) {
      const ok = this.conferir(link.desafio, atual, {
        cpf: dto.cpfConfirmacao,
        dataNascimento: dto.dataNascimentoConfirmacao,
        coren: dto.corenConfirmacao,
      });
      if (!ok) throw new ForbiddenException('Confirmação de identidade inválida.');
    }

    const { vinculos, dependentes, ...entrada } = dto;
    delete (entrada as Record<string, unknown>).cpfConfirmacao;
    delete (entrada as Record<string, unknown>).dataNascimentoConfirmacao;
    delete (entrada as Record<string, unknown>).corenConfirmacao;

    // O filiado não altera CPF, RG, nascimento nem naturalidade pelo link —
    // esses dados não mudam. Se estiverem em branco, o envio PREENCHE.
    const cadastroAtual = await this.prisma.filiado.findUniqueOrThrow({
      where: { id: atual.id },
      select: { cpf: true, rg: true, ufRg: true, dataNascimento: true, naturalidade: true },
    });
    const { dados, ignorados } = protegerImutaveis(cadastroAtual, entrada);

    const cpfLimpo = dados.cpf ? String(dados.cpf).replace(/\D/g, '') : undefined;
    await this.garantirUnicidade(atual.id, cpfLimpo, dto.numeroCoren);

    const completoAntes = await this.prisma.filiado.findUnique({
      where: { id: atual.id },
      include: {
        vinculos: { orderBy: { ordem: 'asc' } },
        dependentes: { orderBy: { createdAt: 'asc' } },
      },
    });
    const dadosAnteriores: Prisma.InputJsonValue = JSON.parse(JSON.stringify(completoAntes));
    const syncDependentes = montarSincronizacaoDependentes(
      dependentes,
      completoAntes?.dependentes ?? [],
    );
    const resumo = resumirDependentes(dependentes, completoAntes?.dependentes ?? []);

    const [filiado] = await this.prisma.$transaction([
      this.prisma.filiado.update({
        where: { id: atual.id },
        data: {
          ...dados,
          // De `dados`, nunca de `dto`: o protegido já saiu de lá.
          cpf: cpfLimpo,
          dataNascimento: dataCalendario(dados.dataNascimento as string | undefined),
          dataAdmissao: dataCalendario(dto.dataAdmissao),
          vinculos: vinculos
            ? { deleteMany: {}, create: vinculos.map((v, i) => ({ ...v, ordem: v.ordem ?? i + 1 })) }
            : undefined,
          dependentes: syncDependentes,
        },
        include: { vinculos: true, dependentes: true },
      }),
      this.prisma.recadastramento.create({
        data: {
          filiadoId: atual.id,
          // Veio do próprio filiado, sem conferência da equipe: fica PENDENTE
          // de revisão. O dado já entra (o filiado é o titular), mas o
          // sindicato vê que precisa validar.
          status: StatusRecadastramento.PENDENTE,
          dadosAnteriores,
          dadosNovos: dados as unknown as Prisma.InputJsonValue,
          observacao: 'Recadastramento ONLINE feito pelo próprio filiado (link).',
        },
      }),
      this.prisma.filiadoHistorico.create({
        data: {
          filiadoId: atual.id,
          tipo: TipoHistoricoFiliado.RECADASTRAMENTO,
          descricao:
            'Recadastramento online realizado pelo filiado via link.' +
            (resumo ? ` ${resumo}` : '') +
            (ignorados.length ? ` Campos protegidos ignorados: ${ignorados.join(', ')}.` : ''),
          autor: 'Filiado (link online)',
        },
      }),
      // USO ÚNICO: o link morre aqui.
      this.prisma.linkRecadastramento.update({
        where: { id: link.id },
        data: { usadoEm: new Date(), ipUltimoAcesso: ip ?? null },
      }),
    ]);

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: atual.id,
      descricao: `Recadastramento online concluído por ${filiado.nomeCompleto}`,
      ip,
      metadata: { linkId: link.id, desafio: link.desafio },
    });

    return { ok: true, nome: filiado.nomeCompleto };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /** Busca o link pelo token e valida validade/uso/revogação. */
  private async carregarValido(token: string) {
    if (!token || token.length < 20) throw new NotFoundException('Link inválido.');
    const link = await this.prisma.linkRecadastramento.findUnique({
      where: { tokenHash: this.hash(token) },
      include: {
        filiado: {
          select: {
            id: true, nomeCompleto: true, cpf: true, dataNascimento: true, numeroCoren: true,
          },
        },
      },
    });
    if (!link) throw new NotFoundException('Link inválido ou inexistente.');
    if (link.revogadoEm) throw new GoneException('Este link foi cancelado. Solicite um novo ao sindicato.');
    if (link.usadoEm) throw new GoneException('Este link já foi utilizado. Solicite um novo ao sindicato.');
    if (link.expiraEm < new Date()) throw new GoneException('Este link expirou. Solicite um novo ao sindicato.');
    return link;
  }

  /** Compara a resposta do desafio com o cadastro (sem vazar qual campo errou). */
  private conferir(
    desafio: DesafioRecadastramento,
    f: { cpf: string | null; dataNascimento: Date | null; numeroCoren: string | null },
    r: { cpf?: string; dataNascimento?: string; coren?: string },
  ): boolean {
    if (desafio === DesafioRecadastramento.COREN) {
      const a = (f.numeroCoren ?? '').replace(/\W/g, '').toUpperCase();
      const b = (r.coren ?? '').replace(/\W/g, '').toUpperCase();
      return !!a && a === b;
    }
    const cpfOk = (f.cpf ?? '') === (r.cpf ?? '').replace(/\D/g, '') && !!f.cpf;
    // A data é comparada como DIA, aceitando as duas convenções que convivem na
    // base (meia-noite UTC e meia-noite de Brasília). Sem isso, um cadastro
    // gravado na convenção errada mostra 23/06 na ficha e exige 24/06 aqui —
    // o filiado digita o que vê e leva "dados não conferem".
    const nascOk =
      !!r.dataNascimento && diasPossiveis(f.dataNascimento).includes(r.dataNascimento.slice(0, 10));
    return cpfOk && nascOk;
  }

  /** CPF e COREN são únicos no sistema — o filiado não pode colidir com outro. */
  private async garantirUnicidade(filiadoId: string, cpf?: string, coren?: string) {
    if (cpf) {
      const outro = await this.prisma.filiado.findFirst({
        where: { cpf, id: { not: filiadoId } },
        select: { id: true },
      });
      if (outro) throw new ConflictException('Este CPF já está cadastrado para outro filiado.');
    }
    if (coren?.trim()) {
      const outro = await this.prisma.filiado.findFirst({
        where: { numeroCoren: coren.trim(), id: { not: filiadoId } },
        select: { id: true },
      });
      if (outro) throw new ConflictException('Este número do COREN já está cadastrado para outro filiado.');
    }
  }

  /** URL pública do sistema (para montar o link enviado ao filiado). */
  private baseUrlPublica(): string {
    const url =
      this.config.get<string>('APP_PUBLIC_URL') ??
      this.config.get<string>('CORS_ORIGINS')?.split(',')[0]?.trim() ??
      'http://localhost:3000';
    return url.replace(/\/+$/, '');
  }
}
