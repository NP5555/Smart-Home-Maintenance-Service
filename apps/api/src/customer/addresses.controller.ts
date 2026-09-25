import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AddressesService } from './addresses.service.js';
import { addressCreateSchema, addressUpdateSchema } from './customer.schemas.js';

@ApiTags('customer')
@ApiBearerAuth()
@Controller('customer/addresses')
export class AddressesController {
  constructor(@Inject(AddressesService) private readonly addresses: AddressesService) {}

  @Get()
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'List my saved addresses', description: 'Returns every address you have saved, most recently created first, with your default address (if any) listed first.' })
  async listMine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.addresses.listMine(principal.userId) };
  }

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Save a new address', description: 'Adds an address for booking against, pinned at the given map coordinates within a known area. Marking it as your default automatically un-defaults any other address.' })
  @ApiZodBody(addressCreateSchema, { default: { summary: 'Home address', value: { label: 'Home', line1: 'House 12, Street 4', areaId: 1, lat: 31.5204, lng: 74.3587, isDefault: true } } })
  async create(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.addresses.create(principal.userId, parseWith(addressCreateSchema, body));
  }

  @Patch(':id')
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Update a saved address', description: 'Changes any of the address fields. Only your own addresses are visible to update.' })
  @ApiZodBody(addressUpdateSchema, { default: { summary: 'Relabel it', value: { label: 'Office' } } })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.addresses.update(principal.userId, id, parseWith(addressUpdateSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({ summary: 'Remove a saved address', description: 'Archives the address rather than deleting it outright, so any booking history that references it stays intact.' })
  async archive(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    await this.addresses.archive(principal.userId, id);
  }
}
