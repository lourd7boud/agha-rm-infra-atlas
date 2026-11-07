import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  attachBidPackageFileSchema,
  defineBidPackageRequirementsSchema,
  freezeBidPackageSchema,
  startBidWorkspaceSchema,
} from '@atlas/contracts';
import { Roles } from '../auth/auth.module';
import {
  BidPackageIncompleteError,
} from './bid-package.domain';
import {
  BidPackageIntegrityError,
  BidPackageService,
  BidPackageStateError,
} from './bid-package.service';
import { actorFrom, mapBidError, type BidRequest } from './bid.controller';

const COMPANY_ID = process.env.ATLAS_COMPANY_ID ?? 'agha-rm-infra';

@Controller('bid')
@Roles('marches', 'direction', 'admin-si')
export class BidPackageController {
  constructor(
    @Inject(BidPackageService) private readonly service: BidPackageService,
  ) {}

  @Get('workspaces/:id/package')
  async get(@Param('id') id: string) {
    try {
      return await this.service.get(COMPANY_ID, parseUuid(id));
    } catch (error) {
      throw mapPackageError(error);
    }
  }

  @Post('workspaces/:id/package/requirements')
  async defineRequirements(
    @Req() request: BidRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = defineBidPackageRequirementsSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    try {
      return await this.service.defineRequirements(
        COMPANY_ID,
        parseUuid(id),
        input.data.requirements,
        input.data.expectedVersion,
        actorFrom(request),
      );
    } catch (error) {
      throw mapPackageError(error);
    }
  }

  @Post('workspaces/:id/package/files')
  async attachFile(
    @Req() request: BidRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = attachBidPackageFileSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    try {
      return await this.service.attachFromVault(
        COMPANY_ID,
        parseUuid(id),
        input.data,
        actorFrom(request),
      );
    } catch (error) {
      throw mapPackageError(error);
    }
  }

  @Post('workspaces/:id/package/freeze')
  async freeze(
    @Req() request: BidRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = freezeBidPackageSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    try {
      return await this.service.freeze(
        COMPANY_ID,
        parseUuid(id),
        input.data,
        actorFrom(request),
      );
    } catch (error) {
      throw mapPackageError(error);
    }
  }
}

function parseUuid(value: string): string {
  const parsed = startBidWorkspaceSchema.shape.tenderId.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}

function mapPackageError(error: unknown): Error {
  if (
    error instanceof BidPackageStateError ||
    error instanceof BidPackageIntegrityError ||
    error instanceof BidPackageIncompleteError
  ) {
    return new BadRequestException(error.message);
  }
  return mapBidError(error);
}
