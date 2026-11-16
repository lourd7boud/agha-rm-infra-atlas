import { BadRequestException, Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Req, StreamableFile } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/auth.module';
import { actorFrom, type AuthedRequest } from './btp-http.helpers';
import { applyIndexImportSchema, BtpIndexImportService } from './btp-index-import.service';

@Controller('btp/revision/index-imports')
@Roles('direction', 'admin-si', 'marches')
export class BtpIndexImportController {
  constructor(@Inject(BtpIndexImportService) private readonly imports: BtpIndexImportService) {}

  @Get('sources')
  sources() { return this.imports.sources(); }

  @Get()
  list() { return this.imports.list(); }

  @Post()
  start(@Body() body: unknown, @Req() req: AuthedRequest) {
    const input = z.object({ sourceUrl: z.string().url().max(2_000) }).safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.imports.start(input.data.sourceUrl, actorFrom(req));
  }

  @Get(':id/file')
  @Roles()
  async file(@Param('id', new ParseUUIDPipe()) id: string) {
    const file = await this.imports.file(id);
    return new StreamableFile(file.bytes, { type: 'application/pdf', disposition: `inline; filename="index-${id}.pdf"` });
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) { return this.imports.get(id); }

  @Post(':id/retry')
  retry(@Param('id', new ParseUUIDPipe()) id: string) { return this.imports.retry(id); }

  @Post(':id/review')
  review(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthedRequest) {
    return this.imports.review(id, actorFrom(req));
  }

  @Post(':id/apply')
  apply(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const input = applyIndexImportSchema.safeParse(body);
    if (!input.success) throw new BadRequestException(input.error.flatten());
    return this.imports.apply(id, input.data, actorFrom(req));
  }
}
