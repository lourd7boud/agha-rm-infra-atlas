import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { BdcCrawler } from './bdc.crawler';
import { BDC_REPOSITORY, type BdcRepository } from './bdc.repository';
import { BdcSyncService } from './bdc.sync';

describe('BdcSyncService dependency injection', () => {
  let closeContext: (() => Promise<void>) | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await closeContext?.();
    closeContext = undefined;
  });

  test('receives the crawler when Nest creates the service', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T08:00:00Z'));
    const repository = {
      avisSansDetail: async () => [],
    } as unknown as BdcRepository;
    const crawler = {
      async *crawlListe() {
        yield { liste: { items: [] } };
      },
    } as unknown as BdcCrawler;

    @Module({
      providers: [
        BdcSyncService,
        { provide: BDC_REPOSITORY, useValue: repository },
        { provide: BdcCrawler, useValue: crawler },
      ],
    })
    class TestModule {}

    const context = await NestFactory.createApplicationContext(TestModule, {
      logger: false,
    });
    closeContext = () => context.close();

    await expect(
      context.get(BdcSyncService).run({ pages: 1, details: 0, resultats: 0 }),
    ).resolves.toEqual({
      pages: 1,
      inserted: 0,
      updated: 0,
      details: 0,
      resultatsInseres: 0,
      resultatsPages: 0,
    });
  });
});

test('BDC sweep reports the official reopening without contacting the portal at night', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-11-12T04:00:00Z'));
    const crawlListe = vi.fn(async function* () { yield { liste: { items: [] } }; });
    const service = new BdcSyncService({ avisSansDetail: async () => [] } as never, { crawlListe } as never);
    expect(await service.run({ resultats: 0, details: 0 })).toMatchObject({
      pages: 0, inserted: 0, portalReopensAt: new Date('2026-11-12T07:30:00Z'),
    });
    expect(crawlListe).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
