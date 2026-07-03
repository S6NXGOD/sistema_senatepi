import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { FiliadosModule } from './modules/filiados/filiados.module';
import { DependentesModule } from './modules/dependentes/dependentes.module';
import { RecadastramentoModule } from './modules/recadastramento/recadastramento.module';
import { ImportacaoModule } from './modules/importacao/importacao.module';
import { ColoniaModule } from './modules/colonia/colonia.module';
import { FuncionariosModule } from './modules/funcionarios/funcionarios.module';
import { PrestadoresModule } from './modules/prestadores/prestadores.module';
import { EventosModule } from './modules/eventos/eventos.module';
import { PresencasModule } from './modules/presencas/presencas.module';
import { CarteirinhasModule } from './modules/carteirinhas/carteirinhas.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { HealthModule } from './modules/health/health.module';
import { StorageModule } from './common/storage/storage.module';
import { QrCodeModule } from './common/qrcode/qrcode.module';
import { AuditModule } from './common/audit/audit.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AuditInterceptor } from './common/audit/audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    StorageModule,
    QrCodeModule,
    AuditModule,
    AuthModule,
    ProfileModule,
    FiliadosModule,
    DependentesModule,
    RecadastramentoModule,
    ImportacaoModule,
    ColoniaModule,
    FuncionariosModule,
    PrestadoresModule,
    EventosModule,
    PresencasModule,
    CarteirinhasModule,
    DashboardModule,
    AuditoriaModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Autenticação global (rotas públicas usam @Public())
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
