import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Seed de PRIMEIRA EXECUÇÃO do usuário administrador padrão.
 * Garante que o sistema (que sobe vazio) já tenha um login válido no primeiro
 * deploy, sem recriar/sobrescrever em deploys seguintes (idempotente por e-mail).
 * Senha vem de SEED_ADMIN_PASSWORD (defina uma forte antes do 1º deploy).
 */
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Seed de PRIMEIRA EXECUÇÃO: só cria o admin quando o banco NÃO tem nenhum
      // usuário. Uma vez que exista qualquer usuário, nunca mais recria — evita
      // criar um admin "backdoor" (com senha padrão) em ambientes já em uso, mesmo
      // que o e-mail do administrador real seja diferente.
      const totalUsuarios = await this.prisma.user.count();
      if (totalUsuarios > 0) return;

      const producao = this.config.get<string>('NODE_ENV') === 'production';
      const senhaEnv = this.config.get<string>('SEED_ADMIN_PASSWORD');

      // Em PRODUÇÃO nunca cria um admin com senha padrão: exige SEED_ADMIN_PASSWORD.
      if (producao && !senhaEnv) {
        this.logger.error(
          'Banco vazio em produção, mas SEED_ADMIN_PASSWORD não está definido — ' +
            'nenhum administrador foi criado. Defina SEED_ADMIN_PASSWORD (forte) e reinicie a API.',
        );
        return;
      }

      const email = this.config.get<string>('SEED_ADMIN_EMAIL', 'admin@senatepi.org.br');
      const senha = senhaEnv || 'senatepi@2026';
      const senhaHash = await bcrypt.hash(senha, 12);

      await this.prisma.user.create({
        data: { nome: 'Administrador', email, senhaHash, role: UserRole.ADMINISTRADOR },
      });
      this.logger.log(`Usuário administrador padrão criado (banco vazio) — ${email}.`);
      if (!senhaEnv) {
        this.logger.warn(
          'SEED_ADMIN_PASSWORD não definido — usando senha padrão INSEGURA (apenas dev). Troque imediatamente!',
        );
      }
    } catch (e) {
      this.logger.error('Falha ao criar o usuário administrador padrão.', e as Error);
    }
  }
}
