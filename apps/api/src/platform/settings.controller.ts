import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { CurrentUser, PolicyDecorator } from '../common/policy.js';
import { SettingsService } from './settings.service.js';

const settingSchema = z.object({ key: z.string().min(1).max(200), value: z.unknown() }).strict();

@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'] })
  get() {
    return this.settings.list();
  }

  @Put()
  @PolicyDecorator({ roles: ['ADMIN'] })
  async update(@CurrentUser() user: { id: string }, @Body() body: unknown) {
    const input = settingSchema.parse(body);
    await this.settings.set(input.key, input.value as Prisma.InputJsonValue, user.id, 'ADMIN');
    return { key: input.key, value: input.value };
  }
}
