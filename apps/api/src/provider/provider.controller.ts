import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, PolicyDecorator, type AuthenticatedPrincipal } from '../common/policy.js';
import { ApiZodBody } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { AvailabilityService } from './availability.service.js';
import { ProfileService } from './profile.service.js';
import { availabilityReplaceSchema, profileUpdateSchema, serviceAreasReplaceSchema, timeOffCreateSchema } from './provider.schemas.js';
import { ServiceAreasService } from './service-areas.service.js';
import { TimeOffService } from './time-off.service.js';

@ApiTags('provider')
@ApiBearerAuth()
@Controller('provider')
export class ProviderController {
  constructor(
    @Inject(ProfileService) private readonly profile: ProfileService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(TimeOffService) private readonly timeOff: TimeOffService,
    @Inject(ServiceAreasService) private readonly serviceAreas: ServiceAreasService
  ) {}

  @Get('profile')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Read my provider profile', description: 'Returns your bio, experience, qualification, base location and service radius, plus your current approval status.' })
  async getProfile(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.profile.getMine(principal.userId);
  }

  @Patch('profile')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Update my provider profile', description: 'Updates any of your profile fields. Your base location (lat/lng) is where distance to a customer is measured from, out to your configured radius.' })
  @ApiZodBody(profileUpdateSchema, {
    default: { summary: 'Full profile fill-in', value: { bio: 'Licensed plumber with 5 years experience.', experienceYears: 5, qualification: 'Trade certified', cityId: 1, baseAddressText: 'Gulberg III, Lahore', lat: 31.5204, lng: 74.3587, radiusM: 10_000 } }
  })
  async updateProfile(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.profile.updateMine(principal.userId, parseWith(profileUpdateSchema, body));
  }

  @Get('availability')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Read my weekly availability calendar', description: 'Returns the recurring weekly time blocks you are available for work.' })
  async getAvailability(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.availability.listMine(principal.userId) };
  }

  @Put('availability')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Replace my weekly availability calendar', description: 'Replaces your entire recurring weekly schedule with the given list of {weekday, startTime, endTime} blocks.' })
  @ApiZodBody(availabilityReplaceSchema, {
    default: { summary: 'Weekdays, 9 to 5 (0 = Sunday)', value: { items: [{ weekday: 1, startTime: '09:00', endTime: '17:00' }, { weekday: 2, startTime: '09:00', endTime: '17:00' }, { weekday: 3, startTime: '09:00', endTime: '17:00' }] } }
  })
  async replaceAvailability(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { items } = parseWith(availabilityReplaceSchema, body);
    return { items: await this.availability.replaceMine(principal.userId, items) };
  }

  @Get('time-off')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'List my recorded leave periods', description: 'Returns every leave period you have on file, earliest first.' })
  async listTimeOff(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.timeOff.listMine(principal.userId) };
  }

  @Post('time-off')
  @HttpCode(201)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Record a leave period', description: 'Blocks off a date range so no job can be scheduled against it. Overlapping an existing leave period is rejected.' })
  @ApiZodBody(timeOffCreateSchema, { default: { summary: 'A few days off', value: { start: '2027-01-10T00:00:00.000Z', end: '2027-01-12T00:00:00.000Z', reason: 'Eid holidays' } } })
  async createTimeOff(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.timeOff.createMine(principal.userId, parseWith(timeOffCreateSchema, body));
  }

  @Delete('time-off/:id')
  @HttpCode(204)
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Cancel a leave period', description: 'Removes a leave period you previously recorded.' })
  async cancelTimeOff(@Param('id', ParseUUIDPipe) id: string, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    await this.timeOff.cancelMine(principal.userId, id);
  }

  @Get('service-areas')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'List the areas I serve', description: 'Returns every area you currently offer to work in.' })
  async getServiceAreas(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return { items: await this.serviceAreas.listMine(principal.userId) };
  }

  @Put('service-areas')
  @PolicyDecorator({ roles: ['PROVIDER'] })
  @ApiOperation({ summary: 'Replace the areas I serve', description: 'Replaces your entire set of served areas with the given list of area ids.' })
  @ApiZodBody(serviceAreasReplaceSchema, { default: { summary: 'Two areas', value: { areaIds: [1, 2] } } })
  async replaceServiceAreas(@Body() body: unknown, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const { areaIds } = parseWith(serviceAreasReplaceSchema, body);
    return { items: await this.serviceAreas.replaceMine(principal.userId, areaIds) };
  }
}
