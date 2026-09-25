import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AcaoAuditoria, SituacaoFiliado } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { FiliadoAutenticado, LoginFiliadoDto, TrocarSenhaDto } from './dto/portal-filiado.dto';
import { FiliadoJwtPayload } from './strategies/filiado-jwt.strategy';
import { segredoFiliado } from './portal-filiado.secret';
import { gerarSenhaProvisoria, motivoDeSenhaFraca } from './senha-provisoria.util';

const BCRYPT_ROUNDS = 12;

/**
 * Hash descartável usado quando a identificação não existe.
 *
 * Sem isso, um login com CPF inexistente responderia na hora e um com CPF
 * cadastrado demoraria o tempo do bcrypt — a diferença revelaria quem é filiado
 * do sindicato. Comparar contra um hash falso iguala os tempos.
 */
const HASH_FALSO = bcrypt.hashSync('senha-inexistente-para-igualar-o-tempo', BCRYPT_ROUNDS);

interface Ctx {
  ip?: string;
  userAgent?: string;
}

/**
 * O LOGIN É SÓ PELO CPF — decisão do dono, 25/09/2026.
 *
 * Eu havia aberto para CPF **ou** matrícula por causa da medição (5.810
 * ATIVOS): matrícula 5.810 (100%), CPF 2.293 (39%). Ele insistiu no CPF, com o
 * encaminhamento explícito: *"quem não tem CPF cadastrado vai ter que se
 * recadastrar na secretaria"*.
 *
 * É defensável, e o sistema sustenta: o CPF é o único identificador que a
 * pessoa sabe de cabeça, e o link de recadastramento já grava o CPF que ela
 * informa — quem entra sem CPF sai com CPF e com o acesso criado na mesma tela.
 * O que o código tem de garantir é que ninguém receba senha que não vai
 * funcionar: `emitirSenhaProvisoria` RECUSA cadastro sem CPF, e a ficha diz
 * isso à secretaria antes do clique.
 */
export function apenasDigitosDoCpf(bruto: string): string {
  // Chega mascarado do celular ("123.456.789-00") e cru do teclado.
  return (bruto ?? '').trim().replace(/[^0-9]/g, '');
}

@Injectable()
export class PortalFiliadoAuthService {
  private readonly logger = new Logger(PortalFiliadoAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Login
  // =========================================================================

  async login(dto: LoginFiliadoDto, ctx: Ctx) {
    const cpf = apenasDigitosDoCpf(dto.cpf);

    /*
      UMA ÚNICA MENSAGEM para todos os motivos de recusa (CPF vazio, inexistente,
      sem acesso liberado, desfiliado ou senha errada). Detalhar aqui entregaria
      a um atacante quais CPFs pertencem a filiados — e a base é de profissionais
      de saúde de um estado inteiro.
    */
    const recusar = () => new UnauthorizedException('CPF ou senha inválidos.');

    const filiado = cpf
      ? await this.prisma.filiado.findUnique({
          where: { cpf },
          select: {
            id: true,
            nomeCompleto: true,
            matricula: true,
            situacao: true,
            portalSenhaHash: true,
            portalPrimeiroAcesso: true,
          },
        })
      : null;

    const confere = await bcrypt.compare(dto.senha, filiado?.portalSenhaHash ?? HASH_FALSO);
    const semAcesso = !filiado?.portalSenhaHash;
    const encerrado = filiado?.situacao === SituacaoFiliado.DESFILIADO;

    if (semAcesso || encerrado || !confere) {
      this.logger.warn(`[PORTAL-FILIADO] Login recusado (CPF de ${cpf.length} dígitos)`);
      /*
        A TENTATIVA FALHA TAMBÉM VAI PARA A AUDITORIA quando sabemos de quem é.
        É o que permite ver "esta pessoa tentou seis vezes ontem" — quase sempre
        senha esquecida, e é a secretaria que resolve. Sem o filiado
        identificado não há o que registrar: gravar a string digitada encheria o
        log de lixo e guardaria CPF de quem nem é filiado.
      */
      if (filiado) {
        await this.audit.registrar({
          userId: null,
          acao: AcaoAuditoria.LOGIN,
          entidade: 'Filiado',
          entidadeId: filiado.id,
          descricao: `Tentativa de login no portal RECUSADA: ${filiado.nomeCompleto}`,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: {
            matricula: filiado.matricula,
            motivo: semAcesso ? 'sem acesso' : encerrado ? 'desfiliado' : 'senha',
          },
        });
      }
      throw recusar();
    }

    /*
      O CARIMBO DO ÚLTIMO ACESSO é o que responde "o portal está sendo usado?".
      Sem ele a resposta viria de contar linha de auditoria, que é o mesmo erro
      do "andamentos" dos Relatórios.
    */
    await this.prisma.filiado.update({
      where: { id: filiado.id },
      data: { portalUltimoAcessoEm: new Date() },
    });

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.LOGIN,
      entidade: 'Filiado',
      entidadeId: filiado.id,
      descricao: `Login no portal do filiado: ${filiado.nomeCompleto}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { matricula: filiado.matricula },
    });

    return {
      ...(await this.emitirToken(filiado)),
      filiado: this.apresentar(filiado),
    };
  }

  // =========================================================================
  // Primeiro acesso — troca obrigatória da senha provisória
  // =========================================================================

  async trocarSenha(filiadoId: string, dto: TrocarSenhaDto, ctx: Ctx) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: {
        id: true,
        nomeCompleto: true,
        matricula: true,
        portalSenhaHash: true,
        portalPrimeiroAcesso: true,
      },
    });
    if (!filiado?.portalSenhaHash) throw new UnauthorizedException('Sessão inválida.');

    const fraca = motivoDeSenhaFraca(dto.novaSenha);
    if (fraca) throw new BadRequestException(fraca);

    /*
      Trocar por uma senha IGUAL à provisória deixaria tudo no mesmo lugar — e a
      provisória circulou por WhatsApp, ou foi ditada em voz alta no balcão.
    */
    if (await bcrypt.compare(dto.novaSenha, filiado.portalSenhaHash)) {
      throw new BadRequestException('A nova senha precisa ser diferente da senha provisória.');
    }

    const atualizado = await this.prisma.filiado.update({
      where: { id: filiado.id },
      data: {
        portalSenhaHash: await bcrypt.hash(dto.novaSenha, BCRYPT_ROUNDS),
        portalPrimeiroAcesso: false,
        portalSenhaDefinidaEm: new Date(),
      },
      select: {
        id: true,
        nomeCompleto: true,
        matricula: true,
        portalPrimeiroAcesso: true,
      },
    });

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: filiado.id,
      descricao: filiado.portalPrimeiroAcesso
        ? `Senha provisória do portal trocada no primeiro acesso: ${filiado.nomeCompleto}`
        : `Senha do portal alterada pelo próprio filiado: ${filiado.nomeCompleto}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { matricula: filiado.matricula },
    });

    // Token NOVO: o anterior carrega primeiroAcesso=true e continuaria preso na
    // tela de troca.
    return {
      ...(await this.emitirToken({ ...atualizado, portalPrimeiroAcesso: false })),
      filiado: this.apresentar({ ...atualizado, portalPrimeiroAcesso: false }),
    };
  }

  /** Sessão corrente — a tela usa para saber se ainda precisa trocar a senha. */
  perfil(filiado: FiliadoAutenticado) {
    return filiado;
  }

  // =========================================================================
  // Emissão da senha provisória (chamada pela secretaria e pelo recadastramento)
  // =========================================================================

  /**
   * Gera uma senha provisória, grava o hash e DEVOLVE a senha em claro.
   *
   * É a única vez que ela existe fora do hash: quem chamar tem de entregá-la na
   * mesma resposta, porque o banco guarda só o hash e ninguém — nem o
   * Administrador — consegue lê-la de volta. Perdeu, gera outra.
   *
   * `porQuem` é o usuário da equipe, ou `null` quando quem disparou foi o
   * próprio recadastramento.
   */
  async emitirSenhaProvisoria(
    filiadoId: string,
    porQuem: { id: string | null; nome: string },
    ctx: Ctx = {},
  ): Promise<{ senhaProvisoria: string; matricula: string; nomeCompleto: string }> {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: { id: true, nomeCompleto: true, matricula: true, situacao: true, cpf: true },
    });
    if (!filiado) throw new BadRequestException('Filiado não encontrado.');
    if (filiado.situacao === SituacaoFiliado.DESFILIADO) {
      throw new BadRequestException(
        'Quem foi desfiliado não tem portal. Reative a filiação antes de liberar o acesso.',
      );
    }
    /*
      SEM CPF, SEM PORTAL — e a recusa é aqui, não na tela de login.

      O portal entra só pelo CPF (decisão do dono). Gerar uma senha para quem
      não tem CPF no cadastro produziria a pior combinação possível: a
      secretaria dita a senha, a pessoa tenta entrar, leva "CPF ou senha
      inválidos" e liga de volta — e ninguém dos dois lados descobre que o
      problema era um campo vazio no cadastro. Recusar aqui transforma isso numa
      frase que diz o que fazer.
    */
    if (!filiado.cpf?.trim()) {
      throw new BadRequestException(
        'Este cadastro não tem CPF, e o portal entra pelo CPF. ' +
          'Atualize o cadastro (ou peça o recadastramento) antes de liberar o acesso.',
      );
    }

    const senhaProvisoria = gerarSenhaProvisoria();
    await this.prisma.filiado.update({
      where: { id: filiado.id },
      data: {
        portalSenhaHash: await bcrypt.hash(senhaProvisoria, BCRYPT_ROUNDS),
        portalPrimeiroAcesso: true,
        portalSenhaDefinidaEm: new Date(),
      },
    });

    await this.audit.registrar({
      userId: porQuem.id,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: filiado.id,
      // A SENHA NUNCA VAI PARA O LOG. O registro diz que houve emissão e quem a
      // fez; o valor sai uma vez pela resposta HTTP e acabou.
      descricao: `Senha provisória do portal emitida por ${porQuem.nome}: ${filiado.nomeCompleto}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { matricula: filiado.matricula },
    });

    return {
      senhaProvisoria,
      matricula: filiado.matricula,
      nomeCompleto: filiado.nomeCompleto,
    };
  }

  /** Tira o acesso sem apagar nada mais — o token morre na próxima requisição. */
  async revogarAcesso(filiadoId: string, porQuem: { id: string | null; nome: string }, ctx: Ctx = {}) {
    const filiado = await this.prisma.filiado.findUnique({
      where: { id: filiadoId },
      select: { id: true, nomeCompleto: true, matricula: true, portalSenhaHash: true },
    });
    if (!filiado) throw new BadRequestException('Filiado não encontrado.');
    if (!filiado.portalSenhaHash) return { revogado: false };

    await this.prisma.filiado.update({
      where: { id: filiado.id },
      data: { portalSenhaHash: null, portalPrimeiroAcesso: true, portalSenhaDefinidaEm: null },
    });

    await this.audit.registrar({
      userId: porQuem.id,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Filiado',
      entidadeId: filiado.id,
      descricao: `Acesso ao portal REVOGADO por ${porQuem.nome}: ${filiado.nomeCompleto}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { matricula: filiado.matricula },
    });

    return { revogado: true };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private async emitirToken(f: {
    id: string;
    matricula: string;
    portalPrimeiroAcesso: boolean;
  }) {
    const payload: FiliadoJwtPayload = {
      sub: f.id,
      matricula: f.matricula,
      tipo: 'filiado',
      primeiroAcesso: f.portalPrimeiroAcesso,
    };
    /*
      Sessão bem mais curta que a da equipe (30d): o portal é aberto do celular
      da pessoa, de lan house e do computador do serviço — máquinas que o
      sindicato não administra.
    */
    const expiraEm = this.config.get<string>('JWT_FILIADO_EXPIRES_IN', '8h');
    const accessToken = await this.jwt.signAsync(payload, {
      secret: segredoFiliado(this.config),
      expiresIn: expiraEm,
    });
    return { accessToken, expiraEm };
  }

  private apresentar(f: {
    id: string;
    nomeCompleto: string;
    matricula: string;
    portalPrimeiroAcesso: boolean;
  }): FiliadoAutenticado {
    return {
      id: f.id,
      nomeCompleto: f.nomeCompleto,
      matricula: f.matricula,
      primeiroAcesso: f.portalPrimeiroAcesso,
    };
  }
}
