// apps/api/src/booking/booking.controller.ts
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiQueryField, ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { bookingCreateSchema, bookingListQuerySchema } from './booking.schemas.js';
import { BookingService } from './booking.service.js';

@ApiTags('booking')
@ApiBearerAuth()
@Controller('bookings')
export class BookingController {
  constructor(@Inject(BookingService) private readonly bookings: BookingService) {}

  @Post()
  @HttpCode(201)
  @PolicyDecorator({ roles: ['CUSTOMER'] })
  @ApiOperation({
    summary: 'Request a provider for a service',
    description:
      "Books a specific provider (found through search) for a service at a chosen time. The time must fall inside the provider's declared weekly availability and not collide with their recorded leave or an existing booking — the database itself refuses two overlapping bookings for the same provider, so a race between two customers requesting the same slot is resolved automatically."
  })
  @ApiZodBody(bookingCreateSchema, {
    default: {
      summary: 'Book a plumber for a leak repair',
      value: { providerId: '00000000-0000-4000-8000-000000000000', serviceId: 1, addressId: '00000000-0000-4000-8000-000000000001', scheduledStart: '2026-10-01T10:00:00.000Z', scheduledEnd: '2026-10-01T11:00:00.000Z', problemText: 'Kitchen tap is leaking' }
    }
  })
  async create(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.create(principal.userId, parseWith(bookingCreateSchema, body));
  }

  @Get(':id')
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'Read one booking', description: 'Returns full booking detail. Visible only to the booking\'s own customer or its assigned provider — anyone else gets a 404, same as everywhere else in this API that hides existence from non-owners.' })
  async getOne(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.bookings.getOwned(id, principal.userId);
  }

  @Get()
  @PolicyDecorator({ roles: ['CUSTOMER', 'PROVIDER'] })
  @ApiOperation({ summary: 'List my bookings', description: 'Returns every booking you are the customer or the provider on, most recent first. Optionally filter by status.' })
  @ApiQueryField('status', { enum: ['REQUESTED', 'SCHEDULED', 'EN_ROUTE', 'IN_PROGRESS', 'QUOTE_REVISION', 'WORK_COMPLETED', 'UNFULFILLED', 'CANCELLED_CUSTOMER', 'CANCELLED_PROVIDER', 'NO_SHOW'] })
  async listMine(@Query() query: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { status } = parseWith(bookingListQuerySchema, query);
    return { items: await this.bookings.listMine(principal.userId, status) };
  }
}
