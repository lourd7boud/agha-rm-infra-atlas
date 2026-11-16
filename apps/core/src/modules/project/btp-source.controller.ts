import { BadRequestException, ConflictException, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { TENDER_REPOSITORY, type TenderRepository } from '../tender/tender.repository';
import { buildBtpProjectSource } from './btp-source.domain';

@Controller('btp/project-source')
export class BtpSourceController {
  constructor(@Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository) {}

  @Get(':tenderId')
  async getSource(@Param('tenderId', new ParseUUIDPipe()) tenderId: string) {
    const tender = await this.tenders.findById(tenderId);
    if (!tender) throw new NotFoundException('Consultation source introuvable.');
    if (!Number.isFinite(tender.deadlineAt.getTime())) throw new BadRequestException('Date de la source invalide.');
    try {
      return buildBtpProjectSource(tender);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Identité')) throw new ConflictException(error.message);
      throw error;
    }
  }
}
