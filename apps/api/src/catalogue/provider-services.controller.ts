import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { providerServiceUpsertSchema } from './catalogue.schemas.js';
import { ProviderServicesService } from './provider-services.service.js';

@ApiTags('catalogue')
@ApiBearerAuth()
@Controller('provider/services')
export class ProviderServicesController {
  constructor(@Inject(ProviderServicesService) private readonly providerServices: ProviderServicesService) {}

  @Get()
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'List the services I offer', description: 'Returns every service you have offered to provide, with your price and whether an admin has approved it yet.' })
  async listMine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.providerServices.listMine(principal.userId) };
  }

  @Put(':serviceId')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({
    summary: 'Offer a service at your price',
    description: "Adds this service to the list you offer, at the price you set (must fall within the service's configured band). Offering a new service starts out pending admin approval; changing the price on one you already offer does not reset an existing approval."
  })
  @ApiZodBody(providerServiceUpsertSchema, { default: { summary: 'Set a price', value: { pricePaisa: 250_000 } } })
  async upsertMine(@Param('serviceId', ParseIntPipe) serviceId: number, @Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { pricePaisa } = parseWith(providerServiceUpsertSchema, body);
    return this.providerServices.upsertMine(principal.userId, serviceId, pricePaisa);
  }

  @Delete(':serviceId')
  @HttpCode(204)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Stop offering a service', description: 'Removes this service from the list you offer.' })
  async removeMine(@Param('serviceId', ParseIntPipe) serviceId: number, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    await this.providerServices.removeMine(principal.userId, serviceId);
  }
}
