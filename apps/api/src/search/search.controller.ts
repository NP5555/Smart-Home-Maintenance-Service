import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/policy.js';
import { ApiQueryField } from '../common/swagger.js';
import { parseWith } from '../common/validation.js';
import { providerSearchQuerySchema } from './search.schemas.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  @Get('providers')
  @Public()
  @ApiOperation({
    summary: 'Find providers who offer a service near a point',
    description:
      "Starts from a service (not a person): pass the service's slug and the customer's coordinates. Returns only approved providers with an approved offer for that service, whose configured radius covers the given point, ranked by distance. Rating/completion-rate weighting is not applied yet — there's no verified rating or booking history to weight by until later modules exist."
  })
  @ApiQueryField('serviceSlug', { required: true, description: 'Which service to find providers for, e.g. "leak-repair" (see GET /catalogue/services/{slug}).' })
  @ApiQueryField('lat', { required: true, type: 'number', description: "The customer's latitude, e.g. 31.5204 (Lahore)." })
  @ApiQueryField('lng', { required: true, type: 'number', description: "The customer's longitude, e.g. 74.3587 (Lahore)." })
  async searchProviders(@Query() query: unknown) {
    return { items: await this.search.searchProviders(parseWith(providerSearchQuerySchema, query)) };
  }

  @Get('providers/:providerId')
  @Public()
  @ApiOperation({ summary: 'Get a provider’s full public profile', description: 'Returns an approved provider’s profile along with every service they are approved to offer (with price) and the areas they serve. A provider who is not approved looks the same as one that does not exist.' })
  async providerDetail(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.search.getProviderDetail(providerId);
  }
}
