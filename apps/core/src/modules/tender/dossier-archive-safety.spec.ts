import { describe, expect, test } from 'vitest';
import {
  assertDossierArchiveSize,
  assertDossierEntrySize,
  assertSelectedDossierEntry,
  createDossierMetadataBudget,
  DossierArchiveAccessGate,
  MAX_DOSSIER_ARCHIVE_BYTES,
  MAX_DOSSIER_ENTRY_BYTES,
  readBoundedResponse,
  trackDossierEntryMetadata,
} from './dossier-archive-safety';

describe('dossier archive safety limits', () => {
  test('accepts bounded archives and entries', () => {
    expect(() => assertDossierArchiveSize(MAX_DOSSIER_ARCHIVE_BYTES)).not.toThrow();
    expect(() => assertDossierEntrySize(MAX_DOSSIER_ENTRY_BYTES)).not.toThrow();
  });

  test('rejects a compressed archive before buffering it', () => {
    expect(() => assertDossierArchiveSize(MAX_DOSSIER_ARCHIVE_BYTES + 1)).toThrow(
      /trop volumineuse/i,
    );
  });

  test('rejects an oversized central-directory entry before inflation', () => {
    expect(() => assertDossierEntrySize(MAX_DOSSIER_ENTRY_BYTES + 1)).toThrow(
      /trop volumineux/i,
    );
  });

  test('rejects a stored entry whose compressed and original sizes disagree', () => {
    expect(() =>
      assertSelectedDossierEntry({
        name: 'BPDE.xlsx',
        size: MAX_DOSSIER_ENTRY_BYTES,
        originalSize: 1,
        compression: 0,
      }),
    ).toThrow(/stock/i);
  });

  test('caps central-directory cardinality and cumulative names', () => {
    const countBudget = createDossierMetadataBudget();
    expect(() => {
      for (let index = 0; index < 4_001; index += 1) {
        trackDossierEntryMetadata(
          { name: `f-${index}.txt`, size: 1, originalSize: 1, compression: 0 },
          countBudget,
        );
      }
    }).toThrow(/entrées/i);

    const nameBudget = createDossierMetadataBudget();
    expect(() =>
      trackDossierEntryMetadata(
        { name: `${'a'.repeat(1_025)}.txt`, size: 1, originalSize: 1, compression: 0 },
        nameBudget,
      ),
    ).toThrow(/nom/i);
  });

  test('reads a declared response into one exact bounded buffer', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await readBoundedResponse(
      new Response(bytes, { headers: { 'content-length': String(bytes.length) } }),
      8,
    );
    expect([...result]).toEqual([1, 2, 3, 4]);
  });

  test('rejects truncated and overflowing declared responses', async () => {
    await expect(
      readBoundedResponse(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-length': '4' },
        }),
        8,
      ),
    ).rejects.toThrow(/tronqué/i);
    await expect(
      readBoundedResponse(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-length': '2' },
        }),
        8,
      ),
    ).rejects.toThrow(/incohérente/i);
  });
});

describe('DossierArchiveAccessGate', () => {
  test('serializes memory-heavy archive work', async () => {
    const gate = new DossierArchiveAccessGate(1, 2);
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const order: string[] = [];

    const first = gate.run(async () => {
      order.push('first:start');
      markFirstStarted();
      await firstHeld;
      order.push('first:end');
    });
    const second = gate.run(async () => {
      order.push('second:start');
    });

    await firstStarted;
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });

  test('rejects overflow and removes an aborted waiter', async () => {
    const gate = new DossierArchiveAccessGate(1, 1);
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = gate.run(() => firstHeld);
    const abort = new AbortController();
    const waiting = gate.run(async () => undefined, abort.signal);

    await expect(gate.run(async () => undefined)).rejects.toThrow(/occupé/i);
    abort.abort();
    await expect(waiting).rejects.toThrow(/annulée/i);

    // The cancelled waiter frees its queue position immediately.
    const replacement = gate.run(async () => 'ok');
    releaseFirst();
    await expect(first).resolves.toBeUndefined();
    await expect(replacement).resolves.toBe('ok');
  });

  test('keeps a lease until its idempotent release callback is invoked', async () => {
    const gate = new DossierArchiveAccessGate(1, 1);
    const release = await gate.lease();
    let entered = false;
    const waiting = gate.run(async () => {
      entered = true;
    });

    await Promise.resolve();
    expect(entered).toBe(false);
    release();
    release();
    await waiting;
    expect(entered).toBe(true);
  });
});
