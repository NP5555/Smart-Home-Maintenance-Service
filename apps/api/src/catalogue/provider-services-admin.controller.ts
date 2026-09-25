import { Controller, Get, HttpCode, Inject, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PolicyDecorator } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { providerServiceListQuerySchema } from './catalogue.schemas.js';
import { ProviderServicesService } from './provider-services.service.js';

@ApiTags('catalogue')
@ApiBearerAuth()
@Controller('admin/provider-services')
export class ProviderServicesAdminController {
  constructor(@Inject(ProviderServicesService) private readonly providerServices: ProviderServicesService) {}

  @Get()
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Review provider service offers', description: 'Admin only. Lists providers who have offered to provide a service, filterable by status=PENDING to see what needs review.' })
  @ApiQueryField('status', { enum: ['PENDING', 'APPROVED', 'REJECTED'], description: 'Filter to offers in this state. Start with PENDING to see what needs review.' })
  async list(@Query() query: unknown) {
    return { items: await this.providerServices.listForAdmin(parseWith(providerServiceListQuerySchema, query)) };
  }

  @Post(':providerId/:serviceId/approve')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: "Approve a provider's offer to provide a service", description: 'Admin only. The provider can now be matched to bookings for this service, at the price they set.' })
  async approve(@Param('providerId', ParseUUIDPipe) providerId: string, @Param('serviceId', ParseIntPipe) serviceId: number) {
    return this.providerServices.setStatus(providerId, serviceId, 'APPROVED');
  }

  @Post(':providerId/:serviceId/reject')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: "Reject a provider's offer to provide a service", description: 'Admin only. The provider will not be matched to bookings for this service.' })
  async reject(@Param('providerId', ParseUUIDPipe) providerId: string, @Param('serviceId', ParseIntPipe) serviceId: number) {
    return this.providerServices.setStatus(providerId, serviceId, 'REJECTED');
  }
}
