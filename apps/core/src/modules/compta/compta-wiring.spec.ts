import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { expect, test, vi } from 'vitest';
import { ComptaCoreController } from './compta.module';
import { ComptaAutoPostingService } from './compta-auto-posting.service';
import { COMPTA_REPOSITORY } from './compta.repository';
import { COMPTA_REGISTRES_REPOSITORY } from './compta-registres.repository';

test('injects reconciliation service through the production tsx-compatible Nest wiring', async () => {
  const projector = { listSalesReconciliation: vi.fn(async () => []) };
  @Module({
    controllers: [ComptaCoreController],
    providers: [
      { provide: COMPTA_REPOSITORY, useValue: {} },
      { provide: COMPTA_REGISTRES_REPOSITORY, useValue: {} },
      { provide: ComptaAutoPostingService, useValue: projector },
    ],
  })
  class VerificationModule {}
  const context = await NestFactory.createApplicationContext(VerificationModule, { logger: false });
  try {
    await expect(context.get(ComptaCoreController).salesReconciliation('2026')).resolves.toEqual([]);
    expect(projector.listSalesReconciliation).toHaveBeenCalledWith({ year: 2026 });
  } finally {
    await context.close();
  }
});
