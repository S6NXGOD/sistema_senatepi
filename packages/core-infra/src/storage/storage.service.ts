import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs, constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import { conteudoDisposto, modoPorExtensao } from '../utils/nome-de-arquivo.util';

/**
 * Abstração de armazenamento de objetos com dois drivers:
 *  - `local`  → grava no disco e serve pela própria API (dev sem infra extra)
 *  - `s3`     → MinIO (dev) ou AWS S3 (produção)
 *
 * Selecione via STORAGE_DRIVER. Padrão: `local`.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: 'local' | 's3';

  // Local
  private readonly localDir: string;
  private readonly publicUrl: string;

  // S3 / MinIO
  private client?: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.driver = (this.config.get<string>('STORAGE_DRIVER', 'local') as 'local' | 's3');
    this.bucket = this.config.get<string>('STORAGE_BUCKET', 'senatepi');
    this.localDir = path.resolve(
      this.config.get<string>('STORAGE_LOCAL_DIR', './uploads'),
    );
    this.publicUrl = this.config
      .get<string>('STORAGE_PUBLIC_URL', 'http://localhost:3333')
      .replace(/\/$/, '');

    if (this.driver === 's3') {
      this.client = new S3Client({
        region: this.config.get<string>('STORAGE_REGION', 'us-east-1'),
        endpoint: this.config.get<string>('STORAGE_ENDPOINT'),
        forcePathStyle:
          this.config.get<string>('STORAGE_FORCE_PATH_STYLE', 'true') === 'true',
        credentials: {
          accessKeyId: this.config.get<string>('STORAGE_ACCESS_KEY', 'minioadmin'),
          secretAccessKey: this.config.get<string>('STORAGE_SECRET_KEY', 'minioadmin'),
        },
      });
    }
    this.logger.log(`Storage driver: ${this.driver}`);
  }

  /** Diretório local onde os arquivos são gravados (usado pelo static server). */
  get diretorioLocal(): string {
    return this.localDir;
  }

  get isLocal(): boolean {
    return this.driver === 'local';
  }

  /**
   * A CHAVE NÃO PODE ESCAPAR DA PASTA — defesa em profundidade.
   *
   * Hoje toda chave é montada pelo servidor (`filiados/<uuid>/...`), então não
   * há caminho de ataque conhecido. Mas `path.join` resolve `..` alegremente, e
   * a distância entre "seguro" e "gravação arbitrária em disco" é UMA linha —
   * basta alguém, um dia, montar a chave a partir do nome do arquivo enviado.
   * (Foi quase isso que aconteceu com a EXTENSÃO dos documentos, que vinha do
   * `originalname` e permitia gravar `.svg`.)
   *
   * Conferir o caminho RESOLVIDO custa microssegundos e fecha a classe inteira.
   */
  private caminhoLocalSeguro(key: string): string {
    const destino = path.resolve(this.localDir, key);
    const raiz = this.localDir.endsWith(path.sep) ? this.localDir : this.localDir + path.sep;
    if (destino !== this.localDir && !destino.startsWith(raiz)) {
      throw new Error(`Chave de armazenamento inválida: "${key}" escapa do diretório.`);
    }
    return destino;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    if (this.driver === 'local') {
      const destino = this.caminhoLocalSeguro(key);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(destino, body);
    } else {
      await this.client!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    }
    this.logger.debug(`Upload concluído: ${key}`);
    return key;
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 'local') {
      await fs.unlink(this.caminhoLocalSeguro(key)).catch(() => undefined);
    } else {
      await this.client!.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    }
  }

  /** Lê os bytes do objeto (para embutir em PDFs, etc). Null se não existir. */
  async getBuffer(key: string): Promise<Buffer | null> {
    try {
      if (this.driver === 'local') {
        return await fs.readFile(this.caminhoLocalSeguro(key));
      }
      const res = await this.client!.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const chunks: Uint8Array[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }

  /**
   * O armazenamento sobrevive a um deploy?
   *
   * Existe por causa dos documentos com valor de registro — dossiê de
   * assembleia, termo de desfiliação, carteirinha. No Railway o disco do
   * container é APAGADO a cada deploy: a chave do arquivo sobrevive no banco,
   * o arquivo não, e a falha só aparece no dia em que alguém vai conferir o
   * documento.
   *
   * `persistente` é HEURÍSTICA, não certificado: um diretório dentro da pasta
   * da aplicação é quase sempre efêmero; um caminho absoluto fora dela é quase
   * sempre ponto de montagem de volume. Serve para flagrar o esquecimento de
   * apontar STORAGE_LOCAL_DIR para dentro do volume — não para atestar
   * infraestrutura.
   */
  async diagnostico(): Promise<{
    driver: string;
    persistente: boolean;
    gravavel: boolean;
    aviso: string | null;
  }> {
    if (this.driver !== 'local') {
      return { driver: this.driver, persistente: true, gravavel: true, aviso: null };
    }

    const dentroDaApp = this.localDir.startsWith(path.resolve(process.cwd()));
    let gravavel = true;
    try {
      await fs.mkdir(this.localDir, { recursive: true });
      await fs.access(this.localDir, fsConstants.W_OK);
    } catch {
      gravavel = false;
    }

    return {
      driver: 'local',
      persistente: !dentroDaApp,
      gravavel,
      aviso: !gravavel
        ? 'O diretório de arquivos não é gravável — uploads e PDFs vão falhar.'
        : dentroDaApp
          ? 'STORAGE_LOCAL_DIR aponta para dentro da aplicação. Em contêiner, ' +
            'este disco é apagado a cada deploy: aponte para dentro do volume montado.'
          : null,
    };
  }

  /**
   * O SEGREDO QUE ASSINA AS URLS DO DRIVER LOCAL.
   *
   * Preferência por uma variável própria; sem ela, deriva do segredo do JWT —
   * que a validação de ambiente JÁ exige forte em produção. Derivar, e não
   * reutilizar cru: o prefixo de domínio abaixo garante que uma assinatura de
   * URL nunca possa ser confundida com (ou reaproveitada como) qualquer outra
   * coisa assinada com a mesma chave.
   *
   * POR QUE NÃO EXPLODIR quando a variável falta, como o QR faz: esta correção
   * sobe numa produção que NÃO tem a variável definida. Derrubar o boot por
   * causa disso trocaria um risco de vazamento por uma indisponibilidade certa.
   */
  private get segredoUrl(): string {
    const proprio = this.config.get<string>('STORAGE_URL_SECRET')?.trim();
    if (proprio) return proprio;
    const jwt = this.config.get<string>('JWT_ACCESS_SECRET')?.trim();
    if (jwt) return `uploads:v1:${jwt}`;
    return `uploads:v1:dev-${this.config.get<string>('TENANT') ?? 'sem-tenant'}`;
  }

  /** HMAC do par (caminho, expiração) — o que torna a URL infalsível. */
  private assinar(key: string, expiraEm: number): string {
    return createHmac('sha256', this.segredoUrl)
      .update(`${key}|${expiraEm}`)
      .digest('base64url');
  }

  /**
   * Confere a assinatura de uma URL do driver local.
   *
   * Comparação em TEMPO CONSTANTE: `===` em string vaza, pelo tempo de resposta,
   * quantos bytes iniciais bateram — e com isso uma assinatura pode ser
   * descoberta byte a byte. É barato fechar e caro ignorar.
   */
  urlAssinadaValida(key: string, expiraEm: string | undefined, assinatura: string | undefined): boolean {
    if (!expiraEm || !assinatura) return false;
    const exp = Number(expiraEm);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
    const esperada = Buffer.from(this.assinar(key, exp));
    const recebida = Buffer.from(assinatura);
    if (esperada.length !== recebida.length) return false;
    return timingSafeEqual(esperada, recebida);
  }

  /**
   * URL para leitura — ASSINADA E TEMPORÁRIA nos DOIS drivers.
   *
   * O QUE MUDOU E POR QUÊ. No driver local a URL era estática e eterna:
   * `/uploads/<chave>`, servida sem autenticação nenhuma. Como a chave é um
   * UUID, a própria URL era a credencial — e uma credencial que NÃO EXPIRA e
   * NÃO PODE SER REVOGADA. Basta ela vazar uma vez (e-mail encaminhado, print
   * num grupo, histórico de navegador de máquina compartilhada, log de proxy
   * corporativo) para o documento ficar acessível para sempre, a quem quer que
   * seja. Em `documentos` há laudo médico — dado sensível do art. 11 da LGPD.
   *
   * Agora expira, como já expirava no S3. E é essa simetria que torna a mudança
   * segura: a aplicação inteira JÁ convivia com URL temporária (o driver S3 usa
   * 3600s desde sempre), e por isso TODA leitura já regenera a URL em vez de
   * confiar na coluna `url` gravada — que existe como snapshot e volta vazia
   * nas listagens.
   */
  async getSignedUrl(key: string, expiresIn = 3600, nomeArquivo?: string): Promise<string> {
    /**
     * `nomeArquivo` É O NOME COM QUE O ARQUIVO CHEGA NA PASTA DE DOWNLOADS.
     *
     * A chave no bucket é opaca de propósito — `<prefixo>/anexos/<uuid>.pdf` —,
     * e sem este parâmetro era ELA que virava o nome do arquivo baixado. Quem
     * anexa o termo assinado a uma atividade e o baixa de volta recebia
     * `3f9a1c02-....pdf`, embora o nome original esteja gravado no banco desde
     * o upload.
     *
     * Opcional porque a maioria das chamadas é de FOTO exibida em `<img>`:
     * lá não há download nenhum a nomear, e o cabeçalho só atrapalharia.
     */
    if (this.driver === 'local') {
      const expiraEm = Math.floor(Date.now() / 1000) + expiresIn;
      const caminho = key.split('/').map(encodeURIComponent).join('/');
      const sig = encodeURIComponent(this.assinar(key, expiraEm));
      /**
       * O nome vai FORA da assinatura, e isso é deliberado.
       *
       * A assinatura protege QUAL arquivo pode ser lido; o nome sugerido não
       * dá acesso a nada — quem já tem a URL assinada já pode baixar o
       * conteúdo. Incluí-lo no HMAC obrigaria a reassinar toda vez que alguém
       * renomeasse o anexo, sem ganho de segurança nenhum. A sanitização, essa
       * sim obrigatória, acontece na ponta que escreve o cabeçalho.
       */
      const nome = nomeArquivo ? `&nome=${encodeURIComponent(nomeArquivo)}` : '';
      return `${this.publicUrl}/uploads/${caminho}?exp=${expiraEm}&sig=${sig}${nome}`;
    }
    return getSignedUrl(
      this.client!,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // No S3 o nome viaja na própria URL assinada — e aí ele ENTRA na
        // assinatura, porque é a AWS que assina a requisição inteira.
        ...(nomeArquivo
          ? { ResponseContentDisposition: conteudoDisposto(nomeArquivo, modoPorExtensao(nomeArquivo)) }
          : {}),
      }),
      { expiresIn },
    );
  }
}
