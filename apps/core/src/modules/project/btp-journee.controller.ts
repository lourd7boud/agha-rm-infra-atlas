import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import {
  terrainJourneeReturnSchema,
  terrainJourneeSaveSchema,
  terrainJourneeTransitionSchema,
  terrainJourneeSettlementSchema,
} from '@atlas/contracts';
import { Roles } from '../auth/auth.module';
import { actorFrom, WRITE_ROLES, type AuthedRequest } from './btp-http.helpers';
import { JourneeConflict, JourneeReferenceError } from './btp-journee.domain';
import {
  BTP_JOURNEE_REPOSITORY,
  type BtpJourneeRepository,
} from './btp-journee.repository';
const terrainRoles = [...WRITE_ROLES, 'chantier'];
const uuid = (id: string) => {
  if (!z.string().uuid().safeParse(id).success)
    throw new BadRequestException('UUID invalide');
  return id;
};
const parse = <T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.output<T> => {
  const p = schema.safeParse(body);
  if (!p.success) throw new BadRequestException(p.error.flatten());
  return p.data;
};
async function http<T>(call: () => Promise<T>) {
  try {
    return await call();
  } catch (e) {
    if (e instanceof JourneeConflict) throw new ConflictException(e.message);
    if (e instanceof JourneeReferenceError)
      throw new BadRequestException(e.message);
    throw e;
  }
}
@Controller('btp/projects/:projectId/terrain/journees')
export class BtpJourneeController {
  constructor(
    @Inject(BTP_JOURNEE_REPOSITORY)
    private readonly repository: BtpJourneeRepository,
  ) {}
  @Get() list(@Param('projectId') projectId: string) {
    return http(() => this.repository.list(uuid(projectId)));
  }
  @Put(':id')
  @Roles(...terrainRoles)
  save(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const p = parse(terrainJourneeSaveSchema, body);
    return http(() =>
      this.repository.save(
        uuid(projectId),
        uuid(id),
        p.expectedVersion,
        p.payload,
        actorFrom(req).name,
      ),
    );
  }
  @Post(':id/submit')
  @Roles(...terrainRoles)
  submit(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const p = parse(terrainJourneeTransitionSchema, body);
    return http(() =>
      this.repository.transition(
        uuid(projectId),
        uuid(id),
        p.expectedVersion,
        'submit',
        actorFrom(req).name,
      ),
    );
  }
  @Post(':id/return')
  @Roles(...WRITE_ROLES)
  returnJournee(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const p = parse(terrainJourneeReturnSchema, body);
    return http(() =>
      this.repository.transition(
        uuid(projectId),
        uuid(id),
        p.expectedVersion,
        'return',
        actorFrom(req).name,
        p.reason,
      ),
    );
  }
  @Post(':id/reopen')
  @Roles(...WRITE_ROLES)
  reopen(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const p = parse(terrainJourneeReturnSchema, body);
    return http(() =>
      this.repository.reopen(
        uuid(projectId),
        uuid(id),
        p.expectedVersion,
        actorFrom(req).name,
        p.reason,
      ),
    );
  }
  @Post(':id/settle')
  @Roles(...WRITE_ROLES)
  settle(@Param('projectId') projectId: string, @Param('id') id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const { expectedVersion, ...mapping } = parse(terrainJourneeSettlementSchema, body);
    return http(() => this.repository.settle(uuid(projectId), uuid(id), expectedVersion, actorFrom(req).name, mapping));
  }
  @Post(':id/blockers/:blockerId/resolve')
  @Roles(...terrainRoles)
  resolveBlocker(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('blockerId') blockerId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const p = parse(terrainJourneeTransitionSchema, body);
    return http(() =>
      this.repository.resolveBlocker(
        uuid(projectId),
        uuid(id),
        uuid(blockerId),
        p.expectedVersion,
        actorFrom(req).name,
      ),
    );
  }
  @Post(':id/review')
  @Roles(...WRITE_ROLES)
  review(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const p = parse(terrainJourneeTransitionSchema, body);
    return http(() =>
      this.repository.transition(
        uuid(projectId),
        uuid(id),
        p.expectedVersion,
        'review',
        actorFrom(req).name,
      ),
    );
  }
}
