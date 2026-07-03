import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { ProfileService } from './profile.service';
import { ChangePasswordDto, UpdateProfileDto } from './dto/profile.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Configurações do próprio usuário/administrador logado.
 * Prefixo global `api` → /api/profile/*. Exige autenticação (qualquer papel).
 */
@ApiTags('profile')
@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  private ctx(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.service.me(userId);
  }

  @Patch('update')
  update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
    @Req() req: Request,
  ) {
    return this.service.update(userId, dto, this.ctx(req));
  }

  @Patch('change-password')
  changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.service.changePassword(userId, dto, this.ctx(req));
  }

  @Post('avatar')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('avatar'))
  avatar(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Arquivo "avatar" é obrigatório.');
    if (!file.mimetype.startsWith('image/'))
      throw new BadRequestException('Envie um arquivo de imagem.');
    return this.service.atualizarAvatar(userId, file.buffer, this.ctx(req));
  }
}
