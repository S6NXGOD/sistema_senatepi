import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ImageService } from './image.service';
import { AvataresService } from './avatares.service';

@Global()
@Module({
  providers: [StorageService, ImageService, AvataresService],
  exports: [StorageService, ImageService, AvataresService],
})
export class StorageModule {}
