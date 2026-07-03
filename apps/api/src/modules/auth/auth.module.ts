import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AdminSeedService } from './admin-seed.service';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({}), // segredos passados por chamada
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AdminSeedService],
  exports: [AuthService],
})
export class AuthModule {}
