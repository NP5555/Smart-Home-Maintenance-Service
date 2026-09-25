import { z } from 'zod';

const slug = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase, hyphen-separated');
const name = z.string().trim().min(1).max(200);

export const categoryCreateSchema = z
  .object({
    slug,
    nameEn: name,
    nameUr: name,
    sortOrder: z.number().int().min(0).default(0),
    defaultWarrantyDays: z.number().int().min(0).default(0)
  })
  .strict();

export const categoryUpdateSchema = z
  .object({
    nameEn: name.optional(),
    nameUr: name.optional(),
    sortOrder: z.number().int().min(0).optional(),
    defaultWarrantyDays: z.number().int().min(0).optional(),
    isActive: z.boolean().optional()
  })
  .strict();

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

const paisa = z.number().int().min(0);
const pricingModel = z.enum(['FLAT', 'TIME_BASED', 'INSPECTION_FIRST']);
const timeUnit = z.enum(['HOUR', 'DAY']);

const priceBandIsConsistent = (input: { minPricePaisa: number; basePricePaisa: number; maxPricePaisa: number }): boolean => input.minPricePaisa <= input.basePricePaisa && input.basePricePaisa <= input.maxPricePaisa;

const timeUnitMatchesPricingModel = (input: { pricingModel: z.infer<typeof pricingModel>; timeUnit?: z.infer<typeof timeUnit> | null }): boolean =>
  input.pricingModel === 'TIME_BASED' ? input.timeUnit !== undefined && input.timeUnit !== null : input.timeUnit === undefined || input.timeUnit === null;

export const serviceCreateSchema = z
  .object({
    categoryId: z.number().int().positive(),
    slug,
    nameEn: name,
    nameUr: name,
    description: z.string().trim().min(1).max(2000),
    pricingModel,
    timeUnit: timeUnit.nullish(),
    basePricePaisa: paisa,
    minPricePaisa: paisa,
    maxPricePaisa: paisa,
    visitFeePaisa: paisa.default(0),
    expectedDurationMin: z.number().int().positive(),
    isEmergencyEligible: z.boolean().default(false),
    isPlanEligible: z.boolean().default(false),
    warrantyDays: z.number().int().min(0).default(0),
    isHighRisk: z.boolean().default(false)
  })
  .strict()
  .refine(priceBandIsConsistent, { message: 'minPricePaisa <= basePricePaisa <= maxPricePaisa must hold', path: ['basePricePaisa'] })
  .refine(timeUnitMatchesPricingModel, { message: 'timeUnit is required for TIME_BASED pricing and must be omitted otherwise', path: ['timeUnit'] });

export const serviceUpdateSchema = z
  .object({
    nameEn: name.optional(),
    nameUr: name.optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    basePricePaisa: paisa.optional(),
    minPricePaisa: paisa.optional(),
    maxPricePaisa: paisa.optional(),
    visitFeePaisa: paisa.optional(),
    expectedDurationMin: z.number().int().positive().optional(),
    isEmergencyEligible: z.boolean().optional(),
    isPlanEligible: z.boolean().optional(),
    warrantyDays: z.number().int().min(0).optional(),
    isHighRisk: z.boolean().optional(),
    isActive: z.boolean().optional()
  })
  .strict();

export const checklistReplaceSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            labelEn: name,
            labelUr: name,
            requiresPhoto: z.boolean().default(false)
          })
          .strict()
      )
      .max(50)
  })
  .strict();

export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>;
export type ChecklistReplaceInput = z.infer<typeof checklistReplaceSchema>;

const commissionScope = z.enum(['GLOBAL', 'CATEGORY', 'PROVIDER']);

const scopeMatchesTarget = (input: { scope: z.infer<typeof commissionScope>; categoryId?: number | null; providerId?: string | null }): boolean => {
  const hasCategory = input.categoryId !== undefined && input.categoryId !== null;
  const hasProvider = input.providerId !== undefined && input.providerId !== null;
  if (input.scope === 'GLOBAL') return !hasCategory && !hasProvider;
  if (input.scope === 'CATEGORY') return hasCategory && !hasProvider;
  return hasProvider && !hasCategory;
};

export const commissionRuleCreateSchema = z
  .object({
    scope: commissionScope,
    categoryId: z.number().int().positive().nullish(),
    providerId: z.string().uuid().nullish(),
    rateBp: z.number().int().min(0).max(10_000),
    effectiveFrom: z.string().datetime().optional(),
    effectiveTo: z.string().datetime().nullish()
  })
  .strict()
  .refine(scopeMatchesTarget, { message: 'categoryId is required for CATEGORY scope, providerId for PROVIDER scope, and neither for GLOBAL scope', path: ['scope'] });

export const commissionRuleListQuerySchema = z
  .object({
    scope: commissionScope.optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    providerId: z.string().uuid().optional()
  })
  .strict();

export type CommissionRuleCreateInput = z.infer<typeof commissionRuleCreateSchema>;
export type CommissionRuleListQuery = z.infer<typeof commissionRuleListQuerySchema>;

const approvalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const providerServiceUpsertSchema = z.object({ pricePaisa: paisa }).strict();

export const providerServiceListQuerySchema = z.object({ status: approvalStatus.optional() }).strict();

export type ProviderServiceUpsertInput = z.infer<typeof providerServiceUpsertSchema>;
export type ProviderServiceListQuery = z.infer<typeof providerServiceListQuerySchema>;
