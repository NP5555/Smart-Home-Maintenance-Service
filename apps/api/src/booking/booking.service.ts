// apps/api/src/booking/booking.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { wallTimeIn } from '@smart-home/domain';
import { badRequest, conflict, notFound } from '../common/domain-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { BookingCreateInput } from './booking.schemas.js';

export type BookingRow = {
  id: string;
  code: string;
  customerId: string;
  providerId: string | null;
  serviceId: number;
  addressId: string;
  status: string;
  paymentMode: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  problemText: string | null;
  quotedAmountPaisa: number;
  approvedTotalPaisa: number;
  finalAmountPaisa: number | null;
  rescheduleCount: number;
  noShowParty: string | null;
  cancelReason: string | null;
  startOtpVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BookingRowRaw = Omit<BookingRow, 'quotedAmountPaisa' | 'approvedTotalPaisa' | 'finalAmountPaisa'> & {
  quotedAmountPaisa: bigint;
  approvedTotalPaisa: bigint;
  finalAmountPaisa: bigint | null;
};

export const BOOKING_COLUMNS = Prisma.sql`id, code, customer_id as "customerId", provider_id as "providerId", service_id as "serviceId", address_id as "addressId",
  status, payment_mode as "paymentMode", scheduled_start as "scheduledStart", scheduled_end as "scheduledEnd", problem_text as "problemText",
  quoted_amount_paisa as "quotedAmountPaisa", approved_total_paisa as "approvedTotalPaisa", final_amount_paisa as "finalAmountPaisa",
  reschedule_count as "rescheduleCount", no_show_party as "noShowParty", cancel_reason as "cancelReason", start_otp_verified_at as "startOtpVerifiedAt",
  created_at as "createdAt", updated_at as "updatedAt"`;

export const toBookingRow = (raw: BookingRowRaw): BookingRow => ({
  ...raw,
  quotedAmountPaisa: Number(raw.quotedAmountPaisa),
  approvedTotalPaisa: Number(raw.approvedTotalPaisa),
  finalAmountPaisa: raw.finalAmountPaisa === null ? null : Number(raw.finalAmountPaisa)
});

const EXCLUSION_VIOLATION = '23P01';

/** local calendar-day weekday (0=Sunday) in Asia/Karachi, matching provider_availability.weekday's convention */
const localWeekday = (instant: Date): number => {
  const wall = wallTimeIn(instant);
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
};

const localTimeOfDay = (instant: Date): string => {
  const wall = wallTimeIn(instant);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}:00`;
};

@Injectable()
export class BookingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(customerId: string, input: BookingCreateInput): Promise<BookingRow> {
    const start = new Date(input.scheduledStart);
    const end = new Date(input.scheduledEnd);

    const services = await this.prisma.$queryRaw<{ id: number; categoryId: number }[]>(
      Prisma.sql`SELECT id, category_id as "categoryId" FROM services WHERE id = ${input.serviceId} AND is_active = true`
    );
    const service = services[0];
    if (service === undefined) throw notFound('Service');

    const providers = await this.prisma.$queryRaw<{ userId: string }[]>(Prisma.sql`SELECT user_id as "userId" FROM providers WHERE user_id = ${input.providerId}::uuid AND status = 'APPROVED'`);
    if (providers.length === 0) throw notFound('Provider');

    const offers = await this.prisma.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT service_id as id FROM provider_services WHERE provider_id = ${input.providerId}::uuid AND service_id = ${input.serviceId} AND status = 'APPROVED'`
    );
    if (offers.length === 0) throw notFound('Service');

    const addresses = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM addresses WHERE id = ${input.addressId}::uuid AND customer_id = ${customerId}::uuid AND archived_at IS NULL`
    );
    if (addresses.length === 0) throw notFound('Address');

    const startWeekday = localWeekday(start);
    if (startWeekday !== localWeekday(end)) throw badRequest('A booking must start and end on the same calendar day');

    const availability = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM provider_availability WHERE provider_id = ${input.providerId}::uuid AND weekday = ${startWeekday}
        AND start_time <= ${localTimeOfDay(start)}::time AND end_time >= ${localTimeOfDay(end)}::time`
    );
    if (availability.length === 0) throw badRequest("The requested time falls outside the provider's declared availability");

    const timeOff = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM provider_time_off WHERE provider_id = ${input.providerId}::uuid AND period && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`
    );
    if (timeOff.length > 0) throw badRequest('The provider has recorded leave over part of this window');

    const priced = await this.prisma.$queryRaw<{ pricePaisa: bigint }[]>(
      Prisma.sql`SELECT price_paisa as "pricePaisa" FROM provider_services WHERE provider_id = ${input.providerId}::uuid AND service_id = ${input.serviceId}`
    );
    const pricePaisa = priced[0]?.pricePaisa;
    if (pricePaisa === undefined) throw notFound('Service');

    const commissionRateBp = await this.resolveCommissionRateBp(input.providerId, service.categoryId);

    try {
      return await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<BookingRowRaw[]>(
          Prisma.sql`INSERT INTO bookings(customer_id, provider_id, service_id, address_id, status, payment_mode, slot, scheduled_start, scheduled_end, problem_text, quoted_amount_paisa, approved_total_paisa, commission_rate_bp)
            VALUES (${customerId}::uuid, ${input.providerId}::uuid, ${input.serviceId}, ${input.addressId}::uuid, 'REQUESTED'::booking_status, 'CASH'::payment_mode,
              tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)'), ${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz,
              ${input.problemText ?? null}, ${pricePaisa}, ${pricePaisa}, ${commissionRateBp})
            RETURNING ${BOOKING_COLUMNS}`
        );
        const row = rows[0];
        if (row === undefined) throw new Error('Booking insert did not return a row');
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_items(booking_id, kind, description, quantity, unit_price_paisa, amount_paisa)
            VALUES (${row.id}::uuid, 'SERVICE'::item_kind, 'Service charge', 1, ${pricePaisa}, ${pricePaisa})`
        );
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO booking_status_history(booking_id, from_status, to_status, event, actor_user_id, actor_role, metadata)
            VALUES (${row.id}::uuid, NULL, 'REQUESTED'::booking_status, 'create', ${customerId}::uuid, 'CUSTOMER'::actor_role, '{}'::jsonb)`
        );
        return toBookingRow(row);
      });
    } catch (error) {
      const meta = error instanceof Prisma.PrismaClientKnownRequestError ? (error.meta as { code?: unknown } | undefined) : undefined;
      if (meta?.code === EXCLUSION_VIOLATION) throw conflict('That provider is no longer free at this time');
      throw error;
    }
  }

  async getOwned(bookingId: string, actorUserId: string): Promise<BookingRow> {
    const rows = await this.prisma.$queryRaw<BookingRowRaw[]>(
      Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = ${bookingId}::uuid AND (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)`
    );
    const row = rows[0];
    if (row === undefined) throw notFound('Booking');
    return toBookingRow(row);
  }

  async listMine(actorUserId: string, status?: string): Promise<BookingRow[]> {
    const rows = await this.prisma.$queryRaw<BookingRowRaw[]>(
      Prisma.sql`SELECT ${BOOKING_COLUMNS} FROM bookings
        WHERE (customer_id = ${actorUserId}::uuid OR provider_id = ${actorUserId}::uuid)
          AND (${status ?? null}::booking_status IS NULL OR status = ${status ?? null}::booking_status)
        ORDER BY created_at DESC`
    );
    return rows.map(toBookingRow);
  }

  /** Provider-scoped rate wins, then category-scoped, then the platform GLOBAL default (always seeded). */
  private async resolveCommissionRateBp(providerId: string, categoryId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ rateBp: number; scope: string }[]>(
      Prisma.sql`SELECT rate_bp as "rateBp", scope FROM commission_rules
        WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
          AND ((scope = 'PROVIDER' AND provider_id = ${providerId}::uuid) OR (scope = 'CATEGORY' AND category_id = ${categoryId}) OR scope = 'GLOBAL')
        ORDER BY CASE scope WHEN 'PROVIDER' THEN 0 WHEN 'CATEGORY' THEN 1 ELSE 2 END
        LIMIT 1`
    );
    const rate = rows[0];
    if (rate === undefined) throw new Error('No commission rule resolved — expected at least a GLOBAL default to be seeded');
    return rate.rateBp;
  }
}
