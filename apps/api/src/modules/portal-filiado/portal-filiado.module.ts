import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CarteirinhasModule } from '../carteirinhas/carteirinhas.module';
import { PortalFiliadoAuthController } from './portal-filiado-auth.controller';
import { PortalFiliadoAdminController } from './portal-filiado-admin.controller';
import { PortalFiliadoController } from './portal-filiado.controller';
import { PortalFiliadoAuthService } from './portal-filiado-auth.service';
import { PortalFiliadoService } from './portal-filiado.service';
import { FiliadoJwtStrategy } from './strategies/filiado-jwt.strategy';

/**
 * Portal do Filiado — área externa, autenticada por CPF **ou** matrícula + senha.
 *
 * Não compartilha estratégia nem segredo com o login da equipe, nem com o
 * portal patronal. Importa `CarteirinhasModule` para servir o MESMO PDF que a
 * secretaria emite — uma segunda implementação do cartão divergiria da primeira
 * na primeira mudança de desenho.
 */
@Module({
  imports: [ConfigModule, PassportModule, JwtModule.register({}), CarteirinhasModule],
  controllers: [PortalFiliadoAuthController, PortalFiliadoController, PortalFiliadoAdminController],
  providers: [PortalFiliadoAuthService, PortalFiliadoService, FiliadoJwtStrategy],
  exports: [PortalFiliadoAuthService],
})
export class PortalFiliadoModule {}
