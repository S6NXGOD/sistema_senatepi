import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { StorageService } from './common/storage/storage.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Serve arquivos do driver de armazenamento local em /uploads
  const storage = app.get(StorageService);
  if (storage.isLocal) {
    app.useStaticAssets(storage.diretorioLocal, { prefix: '/uploads/' });
  }

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
      .setTitle('SENATEPI API')
      .setDescription('API de gestão sindical do SENATEPI')
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
  console.log(`🚀 SENATEPI API rodando na porta ${port} (prefixo /${prefix})`);
}
bootstrap();
