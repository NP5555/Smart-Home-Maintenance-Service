import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service.js';
import { ProfileService } from './profile.service.js';
import { ProviderApprovalAdminController } from './provider-approval-admin.controller.js';
import { ProviderApprovalService } from './provider-approval.service.js';
import { ProviderController } from './provider.controller.js';
import { ServiceAreasService } from './service-areas.service.js';
import { TimeOffService } from './time-off.service.js';

@Module({
  controllers: [ProviderController, ProviderApprovalAdminController],
  providers: [ProfileService, AvailabilityService, TimeOffService, ServiceAreasService, ProviderApprovalService]
})
export class ProviderModule {}
