import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { IdentityService } from './identity.service.js';
import { TokenService } from './token.service.js';

@Module({ controllers: [AuthController], providers: [IdentityService, TokenService], exports: [IdentityService, TokenService] })
export class IdentityModule {}
