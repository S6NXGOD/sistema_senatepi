import { StorageService } from '@core/infra';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

import { validarAmbiente } from './common/config/validar-ambiente';
import { tenant } from './tenant/tenant.config';

async function bootstrap() {
  // Fail-fast: barra o boot em produção com segredos ausentes/inseguros.
  validarAmbiente();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Serve arquivos do driver de armazenamento local em /uploads
  const storage = app.get(StorageService);
  if (storage.isLocal) {
    app.useStaticAssets(storage.diretorioLocal, { prefix: '/uploads/' });
  }

  /**
   * IP REAL de quem chama, e não o do proxy.
   *
   * No Railway a aplicação fica atrás de um proxy reverso: sem isto, `req.ip`
   * devolve o endereço do proxy para TODO mundo. A auditoria já gravava esse
   * IP — sempre o mesmo, sempre inútil — e o check-in do Plenário Virtual, que
   * usa o IP como evidência de participação, registraria um dossiê inteiro com
   * o mesmo endereço, sem valor nenhum.
   *
   * O valor é 1 (confia SÓ no primeiro salto), não `true`. Confiar na cadeia
   * inteira deixaria qualquer cliente forjar o próprio IP mandando um
   * `X-Forwarded-For` — o que transformaria a evidência em ficção.
   */
  app.set('trust proxy', 1);

  const prefix = config.get<string>('API_PREFIX', 'api');
  app.setGlobalPrefix(prefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const origins = (config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  // Swagger / OpenAPI — desabilitado por padrão em produção (menor superfície).
  const swaggerHabilitado =
    config.get<string>('SWAGGER_ENABLED') === 'true' ||
    config.get<string>('NODE_ENV') !== 'production';
  if (swaggerHabilitado) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(`${tenant.sigla} API`)
      .setDescription(`API de gestão sindical do ${tenant.sigla}`)
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${prefix}/docs`, app, document);
  }

  // Railway injeta PORT; API_PORT é o fallback local. Escuta em 0.0.0.0.
  const port = Number(config.get('PORT') ?? config.get('API_PORT', 3333));
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 ${tenant.sigla} API rodando na porta ${port} (prefixo /${prefix})`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha ao iniciar a API:', err instanceof Error ? err.message : err);
  process.exit(1);
});
