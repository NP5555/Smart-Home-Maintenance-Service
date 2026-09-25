import { Injectable } from '@nestjs/common';
import { parseEnvironment, type Environment } from './environment.schema.js';

@Injectable()
export class EnvironmentService {
  readonly values: Environment;

  constructor(source: NodeJS.ProcessEnv = process.env) {
    this.values = parseEnvironment(source);
  }

  get isProduction(): boolean {
    return this.values.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.values.NODE_ENV === 'development';
  }

  get storageBuckets(): string[] {
    return this.values.STORAGE_BUCKETS;
  }
}
