import { Global, Module } from '@nestjs/common';
import { QrCodeService } from './qrcode.service';

@Global()
@Module({
  providers: [QrCodeService],
  exports: [QrCodeService],
})
export class QrCodeModule {}
