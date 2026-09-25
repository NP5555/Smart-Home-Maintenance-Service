import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { PolicyDecorator, CurrentPrincipal, type AuthenticatedPrincipal } from '../common/policy.js';
import { DomainError } from '../common/domain-error.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
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
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'List all platform settings',
    description: 'Returns every configurable value the platform uses (e.g. fees, SLA minutes), each with a human-readable description. Pass ?q= to search by key or description. Admin only, and requires two-factor authentication.'
  })
  @ApiQueryField('q', { description: 'Filter by key or description substring, e.g. "sla".' })
  async list(@Query() query: unknown) {
    const { q } = parseWith(settingsListQuerySchema, query);
    const rows = await this.settings.list();
    return { items: q === undefined ? rows : rows.filter(row => row.key.includes(q) || row.description.toLowerCase().includes(q.toLowerCase())) };
  }

  @Get(':key')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: "Read one setting's current value", description: 'Returns the current value for a single setting key. Answers come from a fast in-memory cache when available, so this is safe to call often.' })
  async read(@Param('key') key: string) {
    const parsedKey = parseWith(settingKeySchema, key);
    const value = await this.settings.get<Prisma.JsonValue>(parsedKey);
    if (value === null) return { key: parsedKey, value: null, configured: false };
    return { key: parsedKey, value, configured: true };
  }

  @Put(':key')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: "Change a setting's value",
    description: 'Updates a single setting. Every change is recorded in the audit log with who made it, and the update is instantly visible to every running instance of the API.'
  })
  @ApiZodBody(settingUpdateSchema, { default: { summary: 'Example: SLA minutes', value: { value: 30 } } })
  async update(@Param('key') key: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const parsedKey = parseWith(settingKeySchema, key);
    const { value } = parseWith(settingUpdateSchema, body);
    if (principal === undefined) throw new DomainError('UNAUTHENTICATED', 'An authenticated administrator is required');
    return this.settings.set(parsedKey, value as Prisma.InputJsonValue, principal.userId);
  }
}
