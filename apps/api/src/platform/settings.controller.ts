import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PolicyDecorator } from '../common/policy.js';
import { parseWith } from '../common/validation.js';
import { SettingsService } from './settings.service.js';

const settingsListQuerySchema = z.object({ q: z.string().trim().min(1).max(100).optional() }).strict();

const settingUpdateSchema = z
  .object({
    value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))])
  })
  .strict();

const settingKeySchema = z.string().trim().min(1).max(200);

@ApiTags('settings')
@ApiBearerAuth()
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'List every configurable value with its description' })
  async list(@Query() query: unknown) {
    const { q } = parseWith(settingsListQuerySchema, query);
    const rows = await this.settings.list();
    return { items: q === undefined ? rows : rows.filter(row => row.key.includes(q) || row.description.toLowerCase().includes(q.toLowerCase())) };
  }

  @Get(':key')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Read one setting, served from the Redis cache when warm' })
  async read(@Param('key') key: string) {
    const parsedKey = parseWith(settingKeySchema, key);
    const value = await this.settings.get<Prisma.JsonValue>(parsedKey);
    if (value === null) return { key: parsedKey, value: null, configured: false };
    return { key: parsedKey, value, configured: true };
  }

  @Put(':key')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Update one setting; the change is audited and the cache is invalidated across instances' })
  async update(@Param('key') key: string, @Body() body: unknown, @Req() request: FastifyRequest, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const parsedKey = parseWith(settingKeySchema, key);
    const { value } = parseWith(settingUpdateSchema, body);
    return this.settings.set(parsedKey, value as Prisma.InputJsonValue, principal.userId);
  }
}
