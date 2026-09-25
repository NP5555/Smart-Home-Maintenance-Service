import { Global, Module } from '@nestjs/common';
import { EnvironmentService } from './environment.js';

@Global()
@Module({ providers: [EnvironmentService], exports: [EnvironmentService] })
export class EnvironmentModule {}
