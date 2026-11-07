import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  startBidWorkspaceSchema,
  transitionBidWorkspaceSchema,
} from '@atlas/contracts';
import { Roles } from '../auth/auth.module';
import type { AuthenticatedUser } from '../auth/auth.domain';
import { BidTransitionError } from './bid.domain';
import {
  BidWorkspaceNotFoundError,
  BidWorkspaceService,
  BidWorkspaceVersionConflictError,
} from './bid.service';

export interface BidRequest {
  user?: AuthenticatedUser;
}

const COMPANY_ID = process.env.ATLAS_COMPANY_ID ?? 'agha-rm-infra';

@Controller('bid')
@Roles('marches', 'direction', 'admin-si')
export class BidController {
  constructor(
    @Inject(BidWorkspaceService) private readonly service: BidWorkspaceService,
  ) {}

  @Post('workspaces')
  async start(@Req() request: BidRequest, @Body() body: unknown) {
    const input = startBidWorkspaceSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.service.start(COMPANY_ID, input.data.tenderId, actorFrom(request));
  }

  @Get('workspaces/by-tender/:tenderId')
  getByTender(@Param('tenderId') tenderId: string) {
    const parsed = startBidWorkspaceSchema.shape.tenderId.safeParse(tenderId);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.service.getByTender(COMPANY_ID, parsed.data);
  }

  @Get('workspaces/:id')
  async get(@Param('id') id: string) {
    const workspaceId = parseUuid(id);
    try {
      return await this.service.get(COMPANY_ID, workspaceId);
    } catch (error) {
      throw mapBidError(error);
    }
  }

  @Post('workspaces/:id/transitions')
  async transition(
    @Req() request: BidRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const workspaceId = parseUuid(id);
    const input = transitionBidWorkspaceSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    try {
      return await this.service.transition(
        COMPANY_ID,
        workspaceId,
        input.data,
        actorFrom(request),
      );
    } catch (error) {
      throw mapBidError(error);
    }
  }
}

function parseUuid(value: string): string {
  const parsed = startBidWorkspaceSchema.shape.tenderId.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
  return parsed.data;
}

export function actorFrom(request: BidRequest) {
  return {
    sub: request.user?.sub ?? 'dev-mode',
    name: request.user?.username ?? 'dev-mode',
  };
}

export function mapBidError(error: unknown): Error {
  if (error instanceof BidWorkspaceNotFoundError) {
    return new NotFoundException(error.message);
  }
  if (error instanceof BidWorkspaceVersionConflictError) {
    return new ConflictException(error.message);
  }
  if (error instanceof BidTransitionError) {
    return new BadRequestException(error.message);
  }
  return error instanceof Error ? error : new Error('Unknown bid workspace failure');
}
