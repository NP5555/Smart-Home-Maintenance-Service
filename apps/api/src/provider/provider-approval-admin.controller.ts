import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { providerRejectSchema } from './provider-approval.schemas.js';
import { ProviderApprovalService } from './provider-approval.service.js';

@ApiTags('provider')
@ApiBearerAuth()
@Controller('admin/providers')
export class ProviderApprovalAdminController {
  constructor(@Inject(ProviderApprovalService) private readonly approvals: ProviderApprovalService) {}

  @Post(':providerId/approve')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Approve a provider', description: 'Admin only. Moves the provider to APPROVED so they can appear in search and be matched to bookings.' })
  async approve(@Param('providerId', ParseUUIDPipe) providerId: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.approvals.approve(providerId, principal.userId);
  }

  @Post(':providerId/reject')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Reject a provider', description: 'Admin only. Moves the provider to REJECTED with a reason the provider can be shown.' })
  @ApiZodBody(providerRejectSchema, { default: { summary: 'Rejection reason', value: { reason: 'Documents unclear' } } })
  async reject(@Param('providerId', ParseUUIDPipe) providerId: string, @Body() body: unknown) {
    const { reason } = parseWith(providerRejectSchema, body);
    return this.approvals.reject(providerId, reason);
  }
}
