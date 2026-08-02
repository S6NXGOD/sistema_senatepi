import {
  BadRequestException, Injectable, Logger, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AcaoAuditoria } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { apenasDigitosCnpj, cnpjValido, formatarCnpj } from '../../common/utils/cnpj.util';
import { EmpresaAutenticada, LoginEmpresaDto, PrimeiroAcessoDto } from './dto/portal-empresa.dto';
import { EmpresaJwtPayload } from './strategies/empresa-jwt.strategy';
import { segredoEmpresa } from './portal-empresa.secret';

const BCRYPT_ROUNDS = 12;

/**
 * Hash descartável usado quando o CNPJ não existe.
 *
 * Sem isso, um login com CNPJ inexistente responderia na hora e um com CNPJ
 * válido demoraria o tempo do bcrypt — a diferença revelaria quais empresas
 * estão cadastradas. Comparar contra um hash falso iguala os tempos.
 */
const HASH_FALSO = bcrypt.hashSync('senha-inexistente-para-igualar-o-tempo', BCRYPT_ROUNDS);

interface Ctx {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class PortalEmpresaAuthService {
  private readonly logger = new Logger(PortalEmpresaAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // =========================================================================
  // Login
  // =========================================================================

  async login(dto: LoginEmpresaDto, ctx: Ctx) {
    const cnpj = apenasDigitosCnpj(dto.cnpj);

    // Uma única mensagem para TODOS os motivos de recusa (CNPJ mal formado,
    // inexistente, sem acesso liberado ou senha errada). Detalhar aqui
    // entregaria a um atacante quais CNPJs valem a pena atacar.
    const recusar = () => new UnauthorizedException('CNPJ ou senha inválidos.');

    const empresa = cnpjValido(cnpj)
      ? await this.prisma.empresa.findUnique({
          where: { cnpj },
          select: {
            id: true, cnpj: true, razaoSocial: true, nomeFantasia: true,
            senhaHash: true, primeiroAcesso: true,
          },
        })
      : null;

    const confere = await bcrypt.compare(dto.senha, empresa?.senhaHash ?? HASH_FALSO);
    if (!empresa?.senhaHash || !confere) {
      this.logger.warn(`[PORTAL] Login recusado para CNPJ ${formatarCnpj(cnpj) || '(inválido)'}`);
      throw recusar();
    }

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.LOGIN,
      entidade: 'Empresa',
      entidadeId: empresa.id,
      descricao: `Login no portal patronal: ${empresa.razaoSocial}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cnpj: empresa.cnpj },
    });

    return {
      ...(await this.emitirToken(empresa)),
      empresa: this.apresentar(empresa),
    };
  }

  // =========================================================================
  // Primeiro acesso — troca obrigatória da senha provisória
  // =========================================================================

  async primeiroAcesso(empresaId: string, dto: PrimeiroAcessoDto, ctx: Ctx) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true, cnpj: true, razaoSocial: true, nomeFantasia: true,
        senhaHash: true, primeiroAcesso: true,
      },
    });
    if (!empresa?.senhaHash) throw new UnauthorizedException('Sessão inválida.');

    // Trocar por uma senha igual à provisória deixaria o cadastro no mesmo
    // lugar — e a provisória circulou por e-mail/WhatsApp até chegar aqui.
    if (await bcrypt.compare(dto.novaSenha, empresa.senhaHash)) {
      throw new BadRequestException('A nova senha precisa ser diferente da senha provisória.');
    }
    if (dto.novaSenha.replace(/\s/g, '') === '') {
      throw new BadRequestException('A nova senha não pode ser só espaços.');
    }

    const atualizada = await this.prisma.empresa.update({
      where: { id: empresa.id },
      data: {
        senhaHash: await bcrypt.hash(dto.novaSenha, BCRYPT_ROUNDS),
        primeiroAcesso: false,
      },
      select: {
        id: true, cnpj: true, razaoSocial: true, nomeFantasia: true, primeiroAcesso: true,
      },
    });

    await this.audit.registrar({
      userId: null,
      acao: AcaoAuditoria.UPDATE,
      entidade: 'Empresa',
      entidadeId: empresa.id,
      descricao: `Senha provisória trocada no primeiro acesso: ${empresa.razaoSocial}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { cnpj: empresa.cnpj },
    });

    // Token NOVO: o anterior carrega primeiroAcesso=true e continuaria preso
    // na tela de troca.
    return {
      ...(await this.emitirToken(atualizada)),
      empresa: this.apresentar(atualizada),
    };
  }

  /** Sessão corrente — a tela usa para saber se ainda precisa trocar a senha. */
  perfil(empresa: EmpresaAutenticada) {
    return empresa;
  }

  /**
   * Cadastro da própria empresa, lido do banco.
   *
   * A home do portal exibe a partir daqui, e não do que está guardado no
   * navegador: o que a empresa vê tem de vir do servidor. É também uma rota
   * PROTEGIDA de verdade — sem `@PermiteSenhaProvisoria`, ela só responde
   * depois que a senha provisória for trocada.
   */
  async dadosCadastrais(empresaId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true, cnpj: true, razaoSocial: true, nomeFantasia: true,
        cep: true, logradouro: true, bairro: true, cidade: true, uf: true,
        primeiroAcesso: true, createdAt: true,
      },
    });
    if (!empresa) throw new UnauthorizedException('Sessão inválida.');
    return empresa;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private async emitirToken(empresa: {
    id: string; cnpj: string; razaoSocial: string; primeiroAcesso: boolean;
  }) {
    const payload: EmpresaJwtPayload = {
      sub: empresa.id,
      cnpj: empresa.cnpj,
      razaoSocial: empresa.razaoSocial,
      tipo: 'empresa',
      primeiroAcesso: empresa.primeiroAcesso,
    };
    // Portal externo: sessão bem mais curta que a da equipe (30d), porque é
    // acessado de máquinas que o sindicato não administra.
    const expiraEm = this.config.get<string>('JWT_EMPRESA_EXPIRES_IN', '8h');
    const accessToken = await this.jwt.signAsync(payload, {
      secret: segredoEmpresa(this.config),
      expiresIn: expiraEm,
    });
    return { accessToken, expiraEm };
  }

  private apresentar(e: {
    id: string; cnpj: string; razaoSocial: string;
    nomeFantasia: string | null; primeiroAcesso: boolean;
  }): EmpresaAutenticada {
    return {
      id: e.id,
      cnpj: e.cnpj,
      razaoSocial: e.razaoSocial,
      nomeFantasia: e.nomeFantasia,
      primeiroAcesso: e.primeiroAcesso,
    };
  }
}
