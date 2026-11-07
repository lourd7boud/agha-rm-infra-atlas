import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client';
import * as schema from '../../db/schema';
import { bidPackageFiles } from '../../db/schema/bid';
import { tenders } from '../../db/schema/tender';
import { DrizzleBidPackageRepository } from './bid-package.repository';
import { DrizzleBidWorkspaceRepository } from './bid.repository';

const databaseUrl = process.env.BID_INTEGRATION_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const rollback = new Error('ROLLBACK_PACKAGE_INTEGRATION_TEST');
const actor = { sub: 'package-integration', name: 'Package Integration' };

describeWithDatabase('DrizzleBidPackageRepository integration', () => {
  let pool: Pool;
  let db: Db;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema }) as Db;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('freezes workspace and package atomically and PostgreSQL blocks later file edits', async () => {
    let verified = false;
    await expect(
      db.transaction(async (outer) => {
        const transactionalDb = outer as unknown as Db;
        const workspaceRepository = new DrizzleBidWorkspaceRepository(transactionalDb);
        const packageRepository = new DrizzleBidPackageRepository(transactionalDb);
        const tenderId = randomUUID();
        await outer.insert(tenders).values({
          id: tenderId,
          reference: `PACKAGE-${tenderId}`,
          buyerName: 'Package Test Buyer',
          procedure: 'Appel d\'offres ouvert',
          objet: 'Package repository transaction test',
          deadlineAt: new Date('2030-01-01T12:00:00Z'),
        });
        let workspace = await workspaceRepository.start({
          companyId: 'agha-rm-infra',
          tenderId,
          actor,
        });
        for (const toState of ['go', 'assembling', 'review'] as const) {
          const transition = await workspaceRepository.transition({
            companyId: workspace.companyId,
            workspaceId: workspace.id,
            fromState: workspace.state,
            toState,
            expectedVersion: workspace.version,
            actor,
          });
          if (transition.kind !== 'updated') throw new Error('transition setup failed');
          workspace = transition.workspace;
        }
        const defined = await packageRepository.defineRequirements({
          companyId: workspace.companyId,
          workspaceId: workspace.id,
          expectedVersion: workspace.version,
          actor,
          requirements: [
            {
              code: 'rc',
              label: 'Règlement de consultation',
              envelope: 'administrative',
              required: true,
            },
          ],
        });
        if (defined.kind !== 'updated') throw new Error('requirement setup failed');
        const requirement = defined.snapshot.requirements[0]!;
        const attached = await packageRepository.attachFile({
          companyId: workspace.companyId,
          workspaceId: workspace.id,
          expectedVersion: defined.snapshot.workspace.version,
          requirementId: requirement.id,
          actor,
          file: {
            vaultDocumentId: null,
            documentKind: 'autre',
            envelope: 'administrative',
            bucket: 'atlas-vault',
            objectKey: `bid-test/${randomUUID()}`,
            filename: 'RC.pdf',
            mime: 'application/pdf',
            sizeBytes: 10,
            sha256: 'a'.repeat(64),
          },
        });
        if (attached.kind !== 'updated' || !attached.snapshot.packageVersion) {
          throw new Error('attach setup failed');
        }
        const frozen = await packageRepository.freeze({
          companyId: workspace.companyId,
          workspaceId: workspace.id,
          packageVersionId: attached.snapshot.packageVersion.id,
          expectedVersion: attached.snapshot.workspace.version,
          manifest: { schema: 'atlas.bid-package-manifest.v1', files: [] },
          manifestSha256: 'b'.repeat(64),
          actor,
        });
        if (frozen.kind !== 'updated') throw new Error('freeze failed');
        expect(frozen.snapshot.workspace.state).toBe('frozen');
        expect(frozen.snapshot.packageVersion?.status).toBe('frozen');
        let mutationBlocked = false;
        try {
          await outer
            .update(bidPackageFiles)
            .set({ filename: 'mutated.pdf' })
            .where(eq(bidPackageFiles.id, frozen.snapshot.files[0]!.id));
        } catch (error) {
          const cause = (error as { cause?: { message?: string } }).cause;
          expect(cause?.message).toContain(
            'files of a frozen bid package are immutable',
          );
          mutationBlocked = true;
        }
        expect(mutationBlocked).toBe(true);
        verified = true;
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(verified).toBe(true);
  });
});
