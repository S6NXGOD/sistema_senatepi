import { AvataresInterceptor, QrCodeModule, StorageModule } from '@core/infra';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { ModuloAtivoGuard } from './common/tenant/modulo-ativo.guard';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ColaboradoresModule } from './modules/colaboradores/colaboradores.module';
import { FiliadosModule } from './modules/filiados/filiados.module';
import { DependentesModule } from './modules/dependentes/dependentes.module';
import { RecadastramentoModule } from './modules/recadastramento/recadastramento.module';
import { ImportacaoModule } from './modules/importacao/importacao.module';
import { ColoniaModule } from './modules/colonia/colonia.module';
import { CobrancasModule } from './modules/cobrancas/cobrancas.module';
import { FinanceiroModule } from './modules/financeiro/financeiro.module';
import { AtendimentosModule } from './modules/atendimentos/atendimentos.module';
import { AgendaModule } from './modules/agenda/agenda.module';
import { ProcessosModule } from './modules/processos/processos.module';
import { AnexosModule } from './modules/anexos/anexos.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { EscalasModule } from './modules/escalas/escalas.module';
import { EmpresasModule } from './modules/empresas/empresas.module';
import { PortalEmpresaModule } from './modules/portal-empresa/portal-empresa.module';
import { EventosModule } from './modules/eventos/eventos.module';
import { PresencasModule } from './modules/presencas/presencas.module';
import { AcessosModule } from './modules/acessos/acessos.module';
import { CarteirinhasModule } from './modules/carteirinhas/carteirinhas.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RelatoriosModule } from './modules/relatorios/relatorios.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { HealthModule } from './modules/health/health.module';

import { AuditModule } from './common/audit/audit.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { PermissionsGuard } from './common/permissions/permissions.guard';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditContextoMiddleware } from './common/audit/audit.contexto.middleware';
import { IdentidadeVisualModule } from './modules/identidade-visual/identidade-visual.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    IdentidadeVisualModule,
    StorageModule,
    QrCodeModule,
    AuditModule,
    AuthModule,
    ProfileModule,
    ColaboradoresModule,
    FiliadosModule,
    DependentesModule,
    RecadastramentoModule,
    ImportacaoModule,
    ColoniaModule,
    CobrancasModule,
    FinanceiroModule,
    AtendimentosModule,
    AgendaModule,
    ProcessosModule,
    AnexosModule,
    UsuariosModule,
    EscalasModule,
    EmpresasModule,
    PortalEmpresaModule,
    EventosModule,
    PresencasModule,
    AcessosModule,
    CarteirinhasModule,
    DashboardModule,
    RelatoriosModule,
    AuditoriaModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Autenticação global (rotas públicas usam @Public())
    /**
     * Primeiro de todos: módulo desligado nesta instalação responde 404, sem
     * sequer checar autenticação. É o que faz a página pública da Colônia
     * sumir num sindicato que não tem colônia.
     */
    { provide: APP_GUARD, useClass: ModuloAtivoGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Autorização por módulo + regra global "só o Administrador apaga".
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Resolve a foto de perfil (avatarKey → URL do storage) em toda resposta.
    // Ver avatares.interceptor.ts: a foto enviada nunca esteve em `avatarUrl`.
    { provide: APP_INTERCEPTOR, useClass: AvataresInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * O ESCOPO DA AUDITORIA COBRE TODA A REQUISIÇÃO.
   *
   * Middleware, e não interceptor — ver `audit.contexto.middleware.ts`. É o que
   * faz a marca do serviço chegar ao `AuditInterceptor`; enquanto o escopo era
   * aberto no próprio interceptor, ela se perdia e todo ato instrumentado
   * gravava DUAS linhas.
   *
   * `forRoutes('*')`: o interceptor de auditoria também é global, e um escopo
   * que cobrisse menos rotas que ele reintroduziria a duplicação justamente nas
   * que ficassem de fora.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditContextoMiddleware).forRoutes('*');
  }
}
