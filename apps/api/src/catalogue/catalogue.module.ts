import { Module } from '@nestjs/common';
import { CatalogueAdminController } from './catalogue-admin.controller.js';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueService } from './catalogue.service.js';
import { ProviderServicesAdminController } from './provider-services-admin.controller.js';
import { ProviderServicesController } from './provider-services.controller.js';
import { ProviderServicesService } from './provider-services.service.js';

@Module({
  controllers: [CatalogueController, CatalogueAdminController, ProviderServicesController, ProviderServicesAdminController],
  providers: [CatalogueService, ProviderServicesService]
})
export class CatalogueModule {}
