import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PortalEmpresaAuthController } from './portal-empresa-auth.controller';
import { PortalEmpresaController } from './portal-empresa.controller';
import { PortalEmpresaAuthService } from './portal-empresa-auth.service';
import { ContribuicoesPatronaisService } from './contribuicoes.service';
import { EmpresaJwtStrategy } from './strategies/empresa-jwt.strategy';

/**
 * Portal da Empresa — área externa, autenticada por CNPJ + senha.
 * Não compartilha estratégia nem segredo com o login da equipe do sindicato.
 */
@Module({
  imports: [ConfigModule, PassportModule, JwtModule.register({})],
  controllers: [PortalEmpresaAuthController, PortalEmpresaController],
  providers: [PortalEmpresaAuthService, ContribuicoesPatronaisService, EmpresaJwtStrategy],
  exports: [PortalEmpresaAuthService, ContribuicoesPatronaisService],
})
export class PortalEmpresaModule {}
