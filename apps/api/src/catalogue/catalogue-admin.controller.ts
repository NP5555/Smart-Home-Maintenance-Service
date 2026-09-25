import { Body, Controller, Get, HttpCode, Inject, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { categoryCreateSchema, categoryUpdateSchema, checklistReplaceSchema, commissionRuleCreateSchema, commissionRuleListQuerySchema, serviceCreateSchema, serviceUpdateSchema } from './catalogue.schemas.js';
import { CatalogueService } from './catalogue.service.js';

@ApiTags('catalogue')
@ApiBearerAuth()
@Controller('admin/catalogue')
export class CatalogueAdminController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService) {}

  @Post('categories')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Create a service category', description: 'Admin only. Adds a new category to the catalogue, such as "Plumbing" or "Electrical".' })
  @ApiZodBody(categoryCreateSchema, { default: { summary: 'New category', value: { slug: 'roofing', nameEn: 'Roofing', nameUr: 'چھت سازی', sortOrder: 10, defaultWarrantyDays: 30 } } })
  async createCategory(@Body() body: unknown) {
    return this.catalogue.createCategory(parseWith(categoryCreateSchema, body));
  }

  @Patch('categories/:id')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Update a service category', description: 'Admin only. Renames, reorders, or activates/deactivates a category. Deactivating removes it (and its services) from the public catalogue without deleting any history.' })
  @ApiZodBody(categoryUpdateSchema, { rename: { summary: 'Rename', value: { nameEn: 'Roofing & Waterproofing' } }, deactivate: { summary: 'Deactivate', value: { isActive: false } } })
  async updateCategory(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.catalogue.updateCategory(id, parseWith(categoryUpdateSchema, body));
  }

  @Post('services')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Create a bookable service', description: 'Admin only. Adds a service to a category with its pricing model, price band and expected duration.' })
  @ApiZodBody(serviceCreateSchema, {
    flat: {
      summary: 'Flat-rate service',
      value: {
        categoryId: 1,
        slug: 'gutter-cleaning',
        nameEn: 'Gutter Cleaning',
        nameUr: 'گٹر کی صفائی',
        description: 'Clear debris and check for blockages along the roofline.',
        pricingModel: 'FLAT',
        basePricePaisa: 200_000,
        minPricePaisa: 150_000,
        maxPricePaisa: 300_000,
        expectedDurationMin: 60,
        isEmergencyEligible: false,
        isPlanEligible: true,
        warrantyDays: 0,
        isHighRisk: false
      }
    }
  })
  async createService(@Body() body: unknown) {
    return this.catalogue.createService(parseWith(serviceCreateSchema, body));
  }

  @Patch('services/:id')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Update a bookable service', description: 'Admin only. Adjusts pricing, duration, or eligibility flags, or activates/deactivates the service.' })
  @ApiZodBody(serviceUpdateSchema, { reprice: { summary: 'Adjust the price band', value: { minPricePaisa: 150_000, maxPricePaisa: 350_000 } } })
  async updateService(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.catalogue.updateService(id, parseWith(serviceUpdateSchema, body));
  }

  @Put('services/:id/checklist')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: "Replace a service's checklist", description: 'Admin only. Replaces the full ordered list of steps a provider must complete (and photograph, where required) for this service.' })
  @ApiZodBody(checklistReplaceSchema, {
    default: {
      summary: 'Two-step checklist',
      value: { items: [{ labelEn: 'Clear debris from gutters', labelUr: 'گٹر سے ملبہ صاف کریں', requiresPhoto: true }, { labelEn: 'Check downpipes flow freely', labelUr: 'پائپوں کا بہاؤ چیک کریں', requiresPhoto: false }] }
    }
  })
  async replaceChecklist(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const { items } = parseWith(checklistReplaceSchema, body);
    return { items: await this.catalogue.replaceChecklist(id, items) };
  }

  @Get('commission-rules')
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'List commission rules', description: 'Admin only. Returns commission rates, optionally filtered by scope, category, or provider. Global, category, and provider rules can overlap; the most specific one applies at booking time.' })
  @ApiQueryField('scope', { enum: ['GLOBAL', 'CATEGORY', 'PROVIDER'], description: 'Filter to rules of this scope.' })
  @ApiQueryField('categoryId', { type: 'number', description: 'Filter to rules for this category.' })
  @ApiQueryField('providerId', { type: 'string', description: 'Filter to rules for this provider (UUID).' })
  async listCommissionRules(@Query() query: unknown) {
    return { items: await this.catalogue.listCommissionRules(parseWith(commissionRuleListQuerySchema, query)) };
  }

  @Post('commission-rules')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({
    summary: 'Set a commission rate',
    description: 'Admin only. Creates a commission rule scoped to the whole platform (GLOBAL), one category, or one provider, expressed in basis points (100 = 1%). Does not replace an existing rule — use the end endpoint to close one first.'
  })
  @ApiZodBody(commissionRuleCreateSchema, {
    global: { summary: 'Platform-wide rate', value: { scope: 'GLOBAL', rateBp: 1_500 } },
    category: { summary: 'Category-specific rate', value: { scope: 'CATEGORY', categoryId: 1, rateBp: 2_000 } }
  })
  async createCommissionRule(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.catalogue.createCommissionRule(parseWith(commissionRuleCreateSchema, body), principal.userId);
  }

  @Post('commission-rules/:id/end')
  @HttpCode(200)
  @PolicyDecorator({ roles: ['ADMIN'], totpRequired: true })
  @ApiOperation({ summary: 'Close a commission rule', description: "Admin only. Stamps the rule's effectiveTo as now, ending it. Commission rules are never deleted so the financial history they drove stays explainable." })
  async endCommissionRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogue.endCommissionRule(id);
  }
}
