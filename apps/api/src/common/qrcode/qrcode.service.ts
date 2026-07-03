import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import * as QRCode from 'qrcode';
import { TipoPessoa } from '@prisma/client';

export interface QrPayload {
  id: string;
  tipo: string; // filiado | dependente | funcionario | prestador
  validacao: string; // token único assinado (HMAC)
}

/**
 * Gera e valida QR Codes únicos para cada pessoa cadastrada.
 * O campo "validacao" é um HMAC do id+tipo+qrToken, impedindo falsificação.
 */
@Injectable()
export class QrCodeService {
  constructor(private readonly config: ConfigService) {}

  private get secret(): string {
    return this.config.get<string>('QR_SIGNING_SECRET', 'dev-qr-secret');
  }

  /** Cria o token único persistido no cadastro da pessoa. */
  gerarToken(): string {
    return randomUUID();
  }

  private assinar(id: string, tipo: string, qrToken: string): string {
    return createHmac('sha256', this.secret)
      .update(`${id}:${tipo}:${qrToken}`)
      .digest('hex');
  }

  /** Monta o payload JSON que será embutido na imagem do QR Code. */
  montarPayload(id: string, tipo: TipoPessoa | string, qrToken: string): QrPayload {
    const tipoStr = String(tipo).toLowerCase();
    return { id, tipo: tipoStr, validacao: this.assinar(id, tipoStr, qrToken) };
  }

  /** Verifica se a assinatura do QR Code corresponde aos dados informados. */
  validarAssinatura(payload: QrPayload, qrToken: string): boolean {
    const esperado = this.assinar(payload.id, payload.tipo, qrToken);
    const a = Buffer.from(esperado);
    const b = Buffer.from(payload.validacao ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Gera a imagem do QR Code (data URL PNG) a partir de um payload. */
  async gerarImagemDataUrl(payload: QrPayload): Promise<string> {
    return QRCode.toDataURL(JSON.stringify(payload), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    });
  }
}
