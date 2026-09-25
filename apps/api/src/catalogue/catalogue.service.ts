import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { CategoryCreateInput, CategoryUpdateInput, ChecklistReplaceInput, CommissionRuleCreateInput, CommissionRuleListQuery, ServiceCreateInput, ServiceUpdateInput } from './catalogue.schemas.js';

export type CategoryRow = { id: number; slug: string; nameEn: string; nameUr: string; sortOrder: number; defaultWarrantyDays: number; isActive: boolean };

const CATEGORY_COLUMNS = Prisma.sql`id, slug, name_en as "nameEn", name_ur as "nameUr", sort_order as "sortOrder", default_warranty_days as "defaultWarrantyDays", is_active as "isActive"`;

export type ServiceRow = {
  id: number;
  categoryId: number;
  slug: string;
  nameEn: string;
  nameUr: string;
  description: string;
  pricingModel: string;
  timeUnit: string | null;
  basePricePaisa: number;
  minPricePaisa: number;
  maxPricePaisa: number;
  visitFeePaisa: number;
  expectedDurationMin: number;
  isEmergencyEligible: boolean;
  isPlanEligible: boolean;
  warrantyDays: number;
  isHighRisk: boolean;
  isActive: boolean;
};

type ServiceRowRaw = Omit<ServiceRow, 'basePricePaisa' | 'minPricePaisa' | 'maxPricePaisa' | 'visitFeePaisa'> & {
  basePricePaisa: bigint;
  minPricePaisa: bigint;
  maxPricePaisa: bigint;
  visitFeePaisa: bigint;
};

export type ChecklistItemRow = { id: number; position: number; labelEn: string; labelUr: string; requiresPhoto: boolean };

export type ServiceDetailRow = ServiceRow & { checklist: ChecklistItemRow[] };

const SERVICE_COLUMNS = Prisma.sql`id, category_id as "categoryId", slug, name_en as "nameEn", name_ur as "nameUr", description,
  pricing_model as "pricingModel", time_unit as "timeUnit", base_price_paisa as "basePricePaisa", min_price_paisa as "minPricePaisa",
  max_price_paisa as "maxPricePaisa", visit_fee_paisa as "visitFeePaisa", expected_duration_min as "expectedDurationMin",
  is_emergency_eligible as "isEmergencyEligible", is_plan_eligible as "isPlanEligible", warranty_days as "warrantyDays",
  is_high_risk as "isHighRisk", is_active as "isActive"`;

const CHECKLIST_COLUMNS = Prisma.sql`id, position, label_en as "labelEn", label_ur as "labelUr", requires_photo as "requiresPhoto"`;

export type CommissionRuleRow = {
  id: string;
  scope: string;
  categoryId: number | null;
  providerId: string | null;
  rateBp: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdBy: string | null;
  createdAt: Date;
};

const COMMISSION_COLUMNS = Prisma.sql`id, scope, category_id as "categoryId", provider_id as "providerId", rate_bp as "rateBp",
  effective_from as "effectiveFrom", effective_to as "effectiveTo", created_by as "createdBy", created_at as "createdAt"`;

/** Paisa columns come back as JS bigint from Postgres int8; the API surface represents money as plain integers (see packages/contracts/src/money.ts). */
const toServiceRow = (raw: ServiceRowRaw): ServiceRow => ({
  ...raw,
  basePricePaisa: Number(raw.basePricePaisa),
  minPricePaisa: Number(raw.minPricePaisa),
  maxPricePaisa: Number(raw.maxPricePaisa),
  visitFeePaisa: Number(raw.visitFeePaisa)
});

@Injectable()
export class CatalogueService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listActiveCategories(): Promise<CategoryRow[]> {
    return this.prisma.$queryRaw<CategoryRow[]>(Prisma.sql`SELECT ${CATEGORY_COLUMNS} FROM categories WHERE is_active = true ORDER BY sort_order, slug`);
  }

  async createCategory(input: CategoryCreateInput): Promise<CategoryRow> {
    const existing = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM categories WHERE slug = ${input.slug}`);
    if (existing.length > 0) throw conflict(`A category with slug "${input.slug}" already exists`);
    const rows = await this.prisma.$queryRaw<CategoryRow[]>(
      Prisma.sql`INSERT INTO categories(slug, name_en, name_ur, sort_order, default_warranty_days)
        VALUES (${input.slug}, ${input.nameEn}, ${input.nameUr}, ${input.sortOrder}, ${input.defaultWarrantyDays})
        RETURNING ${CATEGORY_COLUMNS}`
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Category insert did not return a row');
    return row;
  }

  async updateCategory(id: number, input: CategoryUpdateInput): Promise<CategoryRow> {
    const rows = await this.prisma.$queryRaw<CategoryRow[]>(
      Prisma.sql`UPDATE categories SET
          name_en = COALESCE(${input.nameEn ?? null}, name_en),
          name_ur = COALESCE(${input.nameUr ?? null}, name_ur),
          sort_order = COALESCE(${input.sortOrder ?? null}, sort_order),
          default_warranty_days = COALESCE(${input.defaultWarrantyDays ?? null}, default_warranty_days),
          is_active = COALESCE(${input.isActive ?? null}, is_active)
        WHERE id = ${id}
        RETURNING ${CATEGORY_COLUMNS}`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Category');
    return row;
  }

  async listActiveServicesInCategory(categorySlug: string): Promise<ServiceRow[]> {
    const categories = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM categories WHERE slug = ${categorySlug} AND is_active = true`);
    const category = categories[0];
    if (category === undefined) throw notFound('Category');
    const raw = await this.prisma.$queryRaw<ServiceRowRaw[]>(Prisma.sql`SELECT ${SERVICE_COLUMNS} FROM services WHERE category_id = ${category.id} AND is_active = true ORDER BY name_en`);
    return raw.map(toServiceRow);
  }

  async getServiceDetailBySlug(slug: string): Promise<ServiceDetailRow> {
    const raw = await this.prisma.$queryRaw<ServiceRowRaw[]>(Prisma.sql`SELECT ${SERVICE_COLUMNS} FROM services WHERE slug = ${slug} AND is_active = true`);
    const row = raw[0];
    if (row === undefined) throw notFound('Service');
    const checklist = await this.prisma.$queryRaw<ChecklistItemRow[]>(Prisma.sql`SELECT ${CHECKLIST_COLUMNS} FROM service_checklist_items WHERE service_id = ${row.id} AND is_active = true ORDER BY position`);
    return { ...toServiceRow(row), checklist };
  }

  async createService(input: ServiceCreateInput): Promise<ServiceRow> {
    const categories = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM categories WHERE id = ${input.categoryId}`);
    if (categories.length === 0) throw notFound('Category');
    const existing = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM services WHERE slug = ${input.slug}`);
    if (existing.length > 0) throw conflict(`A service with slug "${input.slug}" already exists`);
    const raw = await this.prisma.$queryRaw<ServiceRowRaw[]>(
      Prisma.sql`INSERT INTO services(category_id, slug, name_en, name_ur, description, pricing_model, time_unit, base_price_paisa, min_price_paisa, max_price_paisa, visit_fee_paisa, expected_duration_min, is_emergency_eligible, is_plan_eligible, warranty_days, is_high_risk)
        VALUES (${input.categoryId}, ${input.slug}, ${input.nameEn}, ${input.nameUr}, ${input.description}, ${input.pricingModel}::pricing_model, ${input.timeUnit ?? null}::time_unit,
          ${BigInt(input.basePricePaisa)}, ${BigInt(input.minPricePaisa)}, ${BigInt(input.maxPricePaisa)}, ${BigInt(input.visitFeePaisa)}, ${input.expectedDurationMin},
          ${input.isEmergencyEligible}, ${input.isPlanEligible}, ${input.warrantyDays}, ${input.isHighRisk})
        RETURNING ${SERVICE_COLUMNS}`
    );
    const row = raw[0];
    if (row === undefined) throw new Error('Service insert did not return a row');
    return toServiceRow(row);
  }

  async updateService(id: number, input: ServiceUpdateInput): Promise<ServiceRow> {
    const raw = await this.prisma.$queryRaw<ServiceRowRaw[]>(
      Prisma.sql`UPDATE services SET
          name_en = COALESCE(${input.nameEn ?? null}, name_en),
          name_ur = COALESCE(${input.nameUr ?? null}, name_ur),
          description = COALESCE(${input.description ?? null}, description),
          base_price_paisa = COALESCE(${input.basePricePaisa === undefined ? null : BigInt(input.basePricePaisa)}, base_price_paisa),
          min_price_paisa = COALESCE(${input.minPricePaisa === undefined ? null : BigInt(input.minPricePaisa)}, min_price_paisa),
          max_price_paisa = COALESCE(${input.maxPricePaisa === undefined ? null : BigInt(input.maxPricePaisa)}, max_price_paisa),
          visit_fee_paisa = COALESCE(${input.visitFeePaisa === undefined ? null : BigInt(input.visitFeePaisa)}, visit_fee_paisa),
          expected_duration_min = COALESCE(${input.expectedDurationMin ?? null}, expected_duration_min),
          is_emergency_eligible = COALESCE(${input.isEmergencyEligible ?? null}, is_emergency_eligible),
          is_plan_eligible = COALESCE(${input.isPlanEligible ?? null}, is_plan_eligible),
          warranty_days = COALESCE(${input.warrantyDays ?? null}, warranty_days),
          is_high_risk = COALESCE(${input.isHighRisk ?? null}, is_high_risk),
          is_active = COALESCE(${input.isActive ?? null}, is_active),
          updated_at = now()
        WHERE id = ${id}
        RETURNING ${SERVICE_COLUMNS}`
    );
    const row = raw[0];
    if (row === undefined) throw notFound('Service');
    return toServiceRow(row);
  }

  async replaceChecklist(serviceId: number, items: ChecklistReplaceInput['items']): Promise<ChecklistItemRow[]> {
    return this.prisma.$transaction(async tx => {
      const services = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM services WHERE id = ${serviceId}`);
      if (services.length === 0) throw notFound('Service');
      await tx.$executeRaw(Prisma.sql`DELETE FROM service_checklist_items WHERE service_id = ${serviceId}`);
      const inserted: ChecklistItemRow[] = [];
      for (const [position, item] of items.entries()) {
        const rows = await tx.$queryRaw<ChecklistItemRow[]>(
          Prisma.sql`INSERT INTO service_checklist_items(service_id, position, label_en, label_ur, requires_photo)
            VALUES (${serviceId}, ${position}, ${item.labelEn}, ${item.labelUr}, ${item.requiresPhoto})
            RETURNING ${CHECKLIST_COLUMNS}`
        );
        const row = rows[0];
        if (row !== undefined) inserted.push(row);
      }
      return inserted;
    });
  }

  async listCommissionRules(filter: CommissionRuleListQuery): Promise<CommissionRuleRow[]> {
    return this.prisma.$queryRaw<CommissionRuleRow[]>(
      Prisma.sql`SELECT ${COMMISSION_COLUMNS} FROM commission_rules
        WHERE (${filter.scope ?? null}::commission_scope IS NULL OR scope = ${filter.scope ?? null}::commission_scope)
          AND (${filter.categoryId ?? null}::int IS NULL OR category_id = ${filter.categoryId ?? null})
          AND (${filter.providerId ?? null}::uuid IS NULL OR provider_id = ${filter.providerId ?? null}::uuid)
        ORDER BY effective_from DESC`
    );
  }

  async createCommissionRule(input: CommissionRuleCreateInput, actorUserId: string): Promise<CommissionRuleRow> {
    if (input.categoryId != null) {
      const categories = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT id FROM categories WHERE id = ${input.categoryId}`);
      if (categories.length === 0) throw notFound('Category');
    }
    if (input.providerId != null) {
      const providers = await this.prisma.$queryRaw<{ user_id: string }[]>(Prisma.sql`SELECT user_id FROM providers WHERE user_id = ${input.providerId}::uuid`);
      if (providers.length === 0) throw notFound('Provider');
    }
    const rows = await this.prisma.$queryRaw<CommissionRuleRow[]>(
      Prisma.sql`INSERT INTO commission_rules(scope, category_id, provider_id, rate_bp, effective_from, effective_to, created_by)
        VALUES (${input.scope}::commission_scope, ${input.categoryId ?? null}, ${input.providerId ?? null}::uuid, ${input.rateBp},
          ${input.effectiveFrom ?? new Date().toISOString()}::timestamptz, ${input.effectiveTo ?? null}::timestamptz, ${actorUserId}::uuid)
        RETURNING ${COMMISSION_COLUMNS}`
    );
    const row = rows[0];
    if (row === undefined) throw new Error('Commission rule insert did not return a row');
    return row;
  }

  async endCommissionRule(id: string): Promise<CommissionRuleRow> {
    const rows = await this.prisma.$queryRaw<CommissionRuleRow[]>(Prisma.sql`UPDATE commission_rules SET effective_to = now() WHERE id = ${id}::uuid RETURNING ${COMMISSION_COLUMNS}`);
    const row = rows[0];
    if (row === undefined) throw notFound('Commission rule');
    return row;
  }
}
