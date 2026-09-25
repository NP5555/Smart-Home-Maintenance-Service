import { Global, Module } from '@nestjs/common';
import { ACCESS_TOKEN_VERIFIER } from '../common/access-token.port.js';
import { authSecretsProvider } from './auth-secrets.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAccessTokenVerifier } from './jwt-access-token.verifier.js';
import { OtpService } from './otp.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    authSecretsProvider,
    { provide: ACCESS_TOKEN_VERIFIER, useClass: JwtAccessTokenVerifier },
    AuthService,
    OtpService,
    SessionService
  ],
  exports: [ACCESS_TOKEN_VERIFIER, AuthService, OtpService, SessionService]
})
export class IdentityModule {}
