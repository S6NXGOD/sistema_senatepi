import { StorageService } from '@core/infra';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
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

  /**
   * CABEÇALHOS DE SEGURANÇA (Helmet).
   *
   * Vem ANTES de tudo para valer inclusive nas respostas de erro e nos
   * arquivos estáticos.
   *
   * DUAS OPÇÕES SÃO DESLIGADAS DE PROPÓSITO, e nenhuma das duas por descuido:
   *
   * · `contentSecurityPolicy: false` — esta é uma API JSON, e a CSP padrão do
   *   Helmet (`default-src 'self'`) quebraria o Swagger, que carrega o próprio
   *   bundle inline. A CSP que interessa aqui é a de `/uploads`, e ela é
   *   aplicada lá embaixo — apertada, no lugar exato onde há conteúdo enviado
   *   por usuário.
   *
   * · `crossOriginResourcePolicy: false` — o padrão do Helmet é `same-origin`,
   *   e o front roda em OUTRO domínio (`sistemasenatepi.up.railway.app` contra
   *   `sistemasenatepi-api...`). Deixar o padrão faria o navegador recusar toda
   *   foto de filiado e todo logo carregado da API — a tela inteira ficaria sem
   *   imagem. É exatamente o tipo de "endurecimento" que derruba produção.
   *
   * O resto entra: HSTS, `nosniff`, `frameguard`, `Referrer-Policy` e
   * `X-DNS-Prefetch-Control`.
   *
   * O `Referrer-Policy` não é detalhe: há credencial viajando em QUERY STRING
   * (o `presencaId` da sala virtual, em `/sala/:id/ao-vivo?presencaId=...`).
   * Sem a política, um clique num link externo mandaria a URL inteira — com a
   * credencial de voto — no cabeçalho `Referer` do site de destino.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
      // O front é servido de outro domínio e não embute a API; negar
      // enquadramento aqui não quebra nada e barra clickjacking no Swagger.
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 15_552_000, includeSubDomains: true, preload: false },
    }),
  );

  /**
   * Arquivos do driver LOCAL em /uploads.
   *
   * ESTA É A PASTA QUE GUARDA DOCUMENTO PESSOAL — laudo, RG, termo assinado.
   * Ela é servida sem autenticação (as chaves são UUID, então a URL é a
   * credencial), e enquanto for assim os cabeçalhos abaixo são a única proteção
   * que resta. Cada um responde a um risco concreto:
   *
   * · `Content-Security-Policy: default-src 'none'; sandbox` — NEUTRALIZA XSS
   *   ARMAZENADO. Um arquivo `.svg` ou `.html` aqui é servido pelo domínio da
   *   API e executaria script na origem dela. Com `sandbox` e `default-src
   *   'none'`, o navegador se recusa a rodar qualquer coisa — o arquivo vira
   *   dado inerte, que é tudo que um anexo deveria ser.
   *
   * · `X-Content-Type-Options: nosniff` — impede o navegador de "adivinhar"
   *   que um arquivo declarado como texto é na verdade HTML.
   *
   * · `X-Robots-Tag: noindex` — basta UMA dessas URLs vazar num e-mail
   *   encaminhado ou num print para o buscador indexar o documento e ele
   *   passar a ser encontrável por qualquer pessoa, para sempre.
   *
   * · `Cache-Control: private, no-store` — tira o documento do cache de proxy
   *   corporativo e do disco do navegador em máquina compartilhada.
   *
   * · `dotfiles: 'deny'` e `index: false` — nada de `.env` esquecido na pasta
   *   nem listagem de diretório.
   */
  const storage = app.get(StorageService);
  if (storage.isLocal) {
    /**
     * O PORTEIRO DO /uploads — conferido ANTES de o arquivo ser servido.
     *
     * A URL do driver local deixou de ser eterna: `getSignedUrl` passa a emitir
     * `?exp=&sig=`, com HMAC sobre (chave, expiração). Este middleware é a outra
     * metade — sem ele a assinatura seria enfeite, porque `express.static`
     * entregaria o arquivo do mesmo jeito.
     *
     * RESPONDE 404, E NÃO 403. Um 403 confirma que aquele arquivo EXISTE, e
     * transforma a rota num oráculo: dá para varrer chaves e descobrir quais
     * são válidas sem nunca conseguir baixar nada. 404 não responde nada.
     *
     * A CHAVE É RECONSTRUÍDA a partir do caminho, decodificada segmento a
     * segmento, para casar exatamente com o que foi assinado em `getSignedUrl`.
     */
    app.use('/uploads', (req: Request, res: Response, proximo: NextFunction) => {
      // `req.path` aqui já vem sem o prefixo /uploads e sem a query.
      const bruto = req.path.replace(/^\/+/, '');
      if (!bruto) return res.status(404).end();

      let chave: string;
      try {
        chave = bruto.split('/').map(decodeURIComponent).join('/');
      } catch {
        // Percent-encoding malformado: nem tenta, só recusa.
        return res.status(404).end();
      }

      const { exp, sig } = req.query as { exp?: string; sig?: string };
      if (!storage.urlAssinadaValida(chave, exp, sig)) return res.status(404).end();
      return proximo();
    });

    app.useStaticAssets(storage.diretorioLocal, {
      prefix: '/uploads/',
      dotfiles: 'deny',
      index: false,
      setHeaders: (res) => {
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        // Força download em vez de renderização para tudo que não for imagem
        // conhecida — ver `deveBaixar`. Um PDF continua abrindo na aba.
        res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
      },
    });
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
