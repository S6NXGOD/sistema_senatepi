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
      const email = this.config.get<string>('SEED_ADMIN_EMAIL', 'admin@senatepi.org.br');
      const existe = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existe) return; // já existe — nada a fazer

      const senhaPadrao = 'senatepi@2026';
      const senha = this.config.get<string>('SEED_ADMIN_PASSWORD') || senhaPadrao;
      const senhaHash = await bcrypt.hash(senha, 12);

      await this.prisma.user.create({
        data: { nome: 'Administrador', email, senhaHash, role: UserRole.ADMIN },
      });
      this.logger.log(`Usuário administrador padrão criado no primeiro deploy (${email}).`);
      if (senha === senhaPadrao) {
        this.logger.warn(
          'SEED_ADMIN_PASSWORD não definido — usando senha padrão INSEGURA. Troque imediatamente em produção!',
        );
      }
    } catch (e) {
      this.logger.error('Falha ao criar o usuário administrador padrão.', e as Error);
    }
  }
}
