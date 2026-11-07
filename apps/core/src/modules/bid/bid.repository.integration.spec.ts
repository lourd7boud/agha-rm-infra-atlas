import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../db/schema';
import type { Db } from '../../db/client';
import { tenders } from '../../db/schema/tender';
import { DrizzleBidWorkspaceRepository } from './bid.repository';
import {
  BidWorkspaceService,
  BidWorkspaceVersionConflictError,
} from './bid.service';

const databaseUrl = process.env.BID_INTEGRATION_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const companyId = 'agha-rm-infra-integration';
const actor = { sub: 'integration-user', name: 'Integration User' };

describeWithDatabase('DrizzleBidWorkspaceRepository integration', () => {
  let pool: Pool;
  let db: Db;
  let repository: DrizzleBidWorkspaceRepository;
  const workspaceIds: string[] = [];
  const tenderIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl });
    db = drizzle(pool, { schema }) as Db;
    repository = new DrizzleBidWorkspaceRepository(db);
  });

  afterAll(async () => {
    for (const workspaceId of workspaceIds) {
      await pool.query(
        `UPDATE bid.workspace
         SET state = 'cancelled', official_receipt_evidence_id = NULL, submitted_at = NULL
         WHERE id = $1`,
        [workspaceId],
      );
      await pool.query('DELETE FROM bid.event WHERE workspace_id = $1', [workspaceId]);
      await pool.query('DELETE FROM bid.evidence WHERE workspace_id = $1', [workspaceId]);
      await pool.query('DELETE FROM bid.workspace WHERE id = $1', [workspaceId]);
    }
    for (const tenderId of tenderIds) {
      await pool.query('DELETE FROM tender.tender WHERE id = $1', [tenderId]);
    }
    await pool.end();
  });

  async function startWorkspace() {
    const tenderId = randomUUID();
    tenderIds.push(tenderId);
    await db.insert(tenders).values({
      id: tenderId,
      companyId,
      reference: `INTEGRATION-${tenderId}`,
      buyerName: 'Integration Buyer',
      procedure: 'Appel d\'offres ouvert',
      objet: 'Bid workspace transactional integration test',
      deadlineAt: new Date('2030-01-01T12:00:00Z'),
    });
    const workspace = await repository.start({ companyId, tenderId, actor });
    workspaceIds.push(workspace.id);
    return workspace;
  }

  it('allows exactly one winner for concurrent transitions with the same version', async () => {
    const workspace = await startWorkspace();
    const service = new BidWorkspaceService(repository);

    const results = await Promise.allSettled([
      service.transition(
        companyId,
        workspace.id,
        { to: 'go', expectedVersion: 0 },
        actor,
      ),
      service.transition(
        companyId,
        workspace.id,
        { to: 'no_go', expectedVersion: 0 },
        actor,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(BidWorkspaceVersionConflictError) });
    const eventCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM bid.event WHERE workspace_id = $1',
      [workspace.id],
    );
    expect(eventCount.rows[0]?.count).toBe('2');
  });

  it('rolls back the workspace update when appending its audit event fails', async () => {
    const workspace = await startWorkspace();

    await expect(
      repository.transition({
        companyId,
        workspaceId: workspace.id,
        fromState: 'evaluating',
        toState: 'go',
        expectedVersion: 0,
        actor: { sub: null as unknown as string, name: actor.name },
      }),
    ).rejects.toThrow();

    const persisted = await repository.findById(companyId, workspace.id);
    expect(persisted).toMatchObject({ state: 'evaluating', version: 0 });
    const eventCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM bid.event WHERE workspace_id = $1',
      [workspace.id],
    );
    expect(eventCount.rows[0]?.count).toBe('1');
  });

  it('accepts only verified official-receipt evidence from the same workspace', async () => {
    const workspace = await startWorkspace();
    const badEvidenceId = randomUUID();
    await pool.query(
      `INSERT INTO bid.evidence (
        id, workspace_id, kind, bucket, storage_key, filename, mime, size_bytes,
        sha256, captured_by_sub, verified_by_sub, verified_at
      ) VALUES ($1, $2, 'portal_confirmation', 'atlas-vault', $3, 'page.html',
        'text/html', 10, $4, $5, $5, now())`,
      [badEvidenceId, workspace.id, `bid-test/${badEvidenceId}`, 'a'.repeat(64), actor.sub],
    );

    await expect(
      pool.query(
        `UPDATE bid.workspace
         SET state = 'submitted', official_receipt_evidence_id = $2, submitted_at = now()
         WHERE id = $1`,
        [workspace.id, badEvidenceId],
      ),
    ).rejects.toThrow('workspace receipt must reference verified official_receipt evidence');

    const receiptId = randomUUID();
    await pool.query(
      `INSERT INTO bid.evidence (
        id, workspace_id, kind, bucket, storage_key, filename, mime, size_bytes,
        sha256, captured_by_sub, verified_by_sub, verified_at
      ) VALUES ($1, $2, 'official_receipt', 'atlas-vault', $3, 'receipt.pdf',
        'application/pdf', 20, $4, $5, $5, now())`,
      [receiptId, workspace.id, `bid-test/${receiptId}`, 'b'.repeat(64), actor.sub],
    );
    await pool.query(
      `UPDATE bid.workspace
       SET state = 'submitted', official_receipt_evidence_id = $2, submitted_at = now()
       WHERE id = $1`,
      [workspace.id, receiptId],
    );

    const persisted = await repository.findById(companyId, workspace.id);
    expect(persisted).toMatchObject({
      state: 'submitted',
      officialReceiptEvidenceId: receiptId,
      submittedAt: expect.any(Date),
    });
    await expect(
      pool.query('UPDATE bid.evidence SET verified_at = NULL WHERE id = $1', [receiptId]),
    ).rejects.toThrow('linked official receipt evidence is immutable');
  });
});
