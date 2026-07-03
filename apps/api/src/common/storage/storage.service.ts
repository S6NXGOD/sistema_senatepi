import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

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

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    if (this.driver === 'local') {
      const destino = path.join(this.localDir, key);
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
      await fs.unlink(path.join(this.localDir, key)).catch(() => undefined);
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
        return await fs.readFile(path.join(this.localDir, key));
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

  /** URL para leitura. Local: URL estática pública; S3: URL assinada temporária. */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    if (this.driver === 'local') {
      return `${this.publicUrl}/uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
    }
    return getSignedUrl(
      this.client!,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }
}
