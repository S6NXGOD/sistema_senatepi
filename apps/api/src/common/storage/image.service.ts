import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { StorageService } from './storage.service';

export interface FotoProcessada {
  fotoKey: string;
  fotoThumbKey: string;
}

/**
 * Processa fotos de pessoas: redimensiona, comprime, converte para WebP
 * e gera thumbnail — evitando sobrecarga de armazenamento.
 */
@Injectable()
export class ImageService {
  private readonly MAX_WIDTH = 800;
  private readonly THUMB_WIDTH = 200;
  private readonly QUALITY = 80;

  constructor(private readonly storage: StorageService) {}

  /**
   * @param buffer Imagem original (qualquer formato suportado pelo sharp)
   * @param prefix Pasta lógica no bucket. Ex: "filiados/<id>"
   */
  async processarFoto(buffer: Buffer, prefix: string): Promise<FotoProcessada> {
    const id = randomUUID();

    const principal = await sharp(buffer)
      .rotate() // respeita orientação EXIF
      .resize({ width: this.MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: this.QUALITY })
      .toBuffer();

    const thumb = await sharp(buffer)
      .rotate()
      .resize({ width: this.THUMB_WIDTH, height: this.THUMB_WIDTH, fit: 'cover' })
      .webp({ quality: this.QUALITY })
      .toBuffer();

    const fotoKey = `${prefix}/foto-${id}.webp`;
    const fotoThumbKey = `${prefix}/thumb-${id}.webp`;

    await Promise.all([
      this.storage.upload(fotoKey, principal, 'image/webp'),
      this.storage.upload(fotoThumbKey, thumb, 'image/webp'),
    ]);

    return { fotoKey, fotoThumbKey };
  }
}
