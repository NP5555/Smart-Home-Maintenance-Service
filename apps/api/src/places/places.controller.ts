import { Controller, Get, Inject, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { PlacesService } from './places.service.js';

@ApiTags('places')
@Controller('places')
export class PlacesController {
  constructor(@Inject(PlacesService) private readonly places: PlacesService) {}

  @Get('cities')
  @Public()
  @ApiOperation({ summary: 'List the cities the platform operates in', description: 'The platform currently launches in a single city, but the catalogue is city-aware from the outset.' })
  async listCities() {
    return { items: await this.places.listActiveCities() };
  }

  @Get('cities/:cityId/areas')
  @Public()
  @ApiOperation({ summary: 'List the areas within a city', description: 'Use one of these area ids when creating a customer address.' })
  async listAreas(@Param('cityId', ParseIntPipe) cityId: number) {
    return { items: await this.places.listActiveAreas(cityId) };
  }
}
