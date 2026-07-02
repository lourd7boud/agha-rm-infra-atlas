import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { TenderListsService } from './tender-lists.service';
import type { RequestWithUser } from './tender-http';

const listBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  visibility: z.enum(['private', 'shared']).default('private'),
});
const addTenderBodySchema = z.object({
  tenderId: z.string().uuid(),
});
const savedSearchBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  filters: z.unknown(),
  visibility: z.enum(['private', 'shared']).default('private'),
});

/**
 * Listes (tender folders) + Recherches sauvegardées. Split out of the main
 * tender controller: these routes live under the `lists`/`saved-searches`
 * prefixes and depend only on TenderListsService, so they never collide with
 * the pipeline routes' `tenders/search` vs `tenders/:id` ordering.
 */
@Controller('tender')
export class TenderListsController {
  constructor(
    @Inject(TenderListsService) private readonly lists: TenderListsService,
  ) {}

  // ────────────────── Listes (tender folders) ──────────────────

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('lists')
  async listLists(@Req() req: RequestWithUser) {
    return this.lists.listVisibleLists(req.user!.sub);
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Post('lists')
  async createList(@Req() req: RequestWithUser, @Body() body: unknown) {
    const parsed = listBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.lists.createList(req.user!.sub, parsed.data.name, parsed.data.visibility);
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Delete('lists/:id')
  async deleteList(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.lists.deleteList(req.user!.sub, id);
    return { deleted: true };
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('lists/:id/tenders')
  async listMembers(@Req() req: RequestWithUser, @Param('id') id: string) {
    return { tenderIds: await this.lists.listTenderIds(req.user!.sub, id) };
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Post('lists/:id/tenders')
  async addToList(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const parsed = addTenderBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.lists.addTenderToList(req.user!.sub, id, parsed.data.tenderId);
    return { added: true };
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Delete('lists/:id/tenders/:tenderId')
  async removeFromList(
    @Req() req: RequestWithUser,
    @Param('id') id: string,
    @Param('tenderId') tenderId: string,
  ) {
    await this.lists.removeTenderFromList(req.user!.sub, id, tenderId);
    return { removed: true };
  }

  // ────────────── Recherches sauvegardées ──────────────

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Get('saved-searches')
  async listSearches(@Req() req: RequestWithUser) {
    return this.lists.listSavedSearches(req.user!.sub);
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Post('saved-searches')
  async createSearch(@Req() req: RequestWithUser, @Body() body: unknown) {
    const parsed = savedSearchBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.lists.createSavedSearch(
      req.user!.sub,
      parsed.data.name,
      parsed.data.filters,
      parsed.data.visibility,
    );
  }

  @Roles('marches', 'direction', 'admin-si', 'finance', 'travaux')
  @Delete('saved-searches/:id')
  async deleteSearch(@Req() req: RequestWithUser, @Param('id') id: string) {
    await this.lists.deleteSavedSearch(req.user!.sub, id);
    return { deleted: true };
  }
}
