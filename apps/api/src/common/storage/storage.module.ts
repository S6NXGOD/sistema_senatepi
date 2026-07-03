import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ImageService } from './image.service';

@Global()
@Module({
  providers: [StorageService, ImageService],
  exports: [StorageService, ImageService],
})
export class StorageModule {}
