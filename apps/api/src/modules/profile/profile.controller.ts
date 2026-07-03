import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
}
