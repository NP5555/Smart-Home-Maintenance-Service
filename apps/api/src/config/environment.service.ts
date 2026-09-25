import { Injectable } from '@nestjs/common';
import { parseEnvironment, type Environment } from './environment.schema.js';

@Injectable()
export class EnvironmentService {
  readonly values: Environment;

  constructor() {
    this.values = parseEnvironment(process.env);
  }

  static from(source: NodeJS.ProcessEnv): EnvironmentService {
    const service = Object.create(EnvironmentService.prototype) as EnvironmentService;
    Object.defineProperty(service, 'values', { value: parseEnvironment(source), enumerable: true });
    return service;
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
