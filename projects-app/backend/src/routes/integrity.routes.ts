import { Router, Request, Response } from 'express';
import { getPool } from '../config/postgres';
import logger from '../utils/logger';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================================
// GET /api/integrity/check - Data consistency check
// ============================================================
// Returns a report of all data integrity issues across projects
// ============================================================
router.get('/check', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // 1. Orphan décomptes: have a periode_id that doesn't exist  
    const orphanDecomptes = await pool.query(`
      SELECT d.id, d.project_id, d.periode_id, d.numero, d.montant_total, d.created_at
      FROM decompts d
      LEFT JOIN periodes p ON d.periode_id = p.id AND p.deleted_at IS NULL
      WHERE d.deleted_at IS NULL
        AND d.user_id = $1
        AND (p.id IS NULL OR d.periode_id IS NULL)
    `, [userId]);

    // 2. Duplicate décomptes: multiple active décomptes per (project_id, periode_id)
    const duplicateDecomptes = await pool.query(`
      SELECT d.project_id, d.periode_id, d.numero,
             COUNT(*) as count,
             ARRAY_AGG(d.id ORDER BY d.updated_at DESC) as decompt_ids,
             ARRAY_AGG(d.montant_total ORDER BY d.updated_at DESC) as montants
      FROM decompts d
      WHERE d.deleted_at IS NULL
        AND d.user_id = $1
        AND d.periode_id IS NOT NULL
      GROUP BY d.project_id, d.periode_id, d.numero
      HAVING COUNT(*) > 1
    `, [userId]);

    // 3. Mismatched counts: projects where #périodes != #décomptes
    const mismatchedProjects = await pool.query(`
      SELECT 
        pr.id as project_id,
        pr.objet as project_name,
        COALESCE(pc.periode_count, 0) as periode_count,
        COALESCE(dc.decompt_count, 0) as decompt_count,
        COALESCE(pc.periode_count, 0) - COALESCE(dc.decompt_count, 0) as difference
      FROM projects pr
      LEFT JOIN (
        SELECT project_id, COUNT(*) as periode_count 
        FROM periodes WHERE deleted_at IS NULL 
        GROUP BY project_id
      ) pc ON pr.id = pc.project_id
      LEFT JOIN (
        SELECT project_id, COUNT(*) as decompt_count 
        FROM decompts WHERE deleted_at IS NULL 
        GROUP BY project_id
      ) dc ON pr.id = dc.project_id
      WHERE pr.deleted_at IS NULL
        AND pr.user_id = $1
        AND COALESCE(pc.periode_count, 0) != COALESCE(dc.decompt_count, 0)
      ORDER BY ABS(COALESCE(pc.periode_count, 0) - COALESCE(dc.decompt_count, 0)) DESC
    `, [userId]);

    // 4. Numero mismatches: décompte.numero != période.numero
    const numeroMismatches = await pool.query(`
      SELECT d.id as decompt_id, d.project_id, d.numero as decompt_numero, 
             p.numero as periode_numero, p.id as periode_id
      FROM decompts d
      JOIN periodes p ON d.periode_id = p.id
      WHERE d.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND d.user_id = $1
        AND d.numero != p.numero
    `, [userId]);

    // 5. Périodes without décomptes
    const periodesWithoutDecomptes = await pool.query(`
      SELECT p.id, p.project_id, p.numero, p.libelle
      FROM periodes p
      LEFT JOIN decompts d ON p.id = d.periode_id AND d.deleted_at IS NULL
      WHERE p.deleted_at IS NULL
        AND p.user_id = $1
        AND d.id IS NULL
    `, [userId]);

    const issues = {
      orphanDecomptes: orphanDecomptes.rows,
      duplicateDecomptes: duplicateDecomptes.rows,
      mismatchedProjects: mismatchedProjects.rows,
      numeroMismatches: numeroMismatches.rows,
      periodesWithoutDecomptes: periodesWithoutDecomptes.rows,
    };

    const totalIssues = 
      orphanDecomptes.rows.length +
      duplicateDecomptes.rows.length +
      mismatchedProjects.rows.length +
      numeroMismatches.rows.length +
      periodesWithoutDecomptes.rows.length;

    res.json({
      status: totalIssues === 0 ? 'healthy' : 'issues_found',
      totalIssues,
      issues,
      checkedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    logger.error('Integrity check failed:', error);
    res.status(500).json({ error: 'Integrity check failed', details: error.message });
  }
});

// ============================================================
// POST /api/integrity/fix - Auto-fix data integrity issues
// ============================================================
// Fixes:
// 1. Soft-deletes orphan décomptes
// 2. Soft-deletes duplicate décomptes (keeps most recently updated with data)
// 3. Fixes mismatched numeros
// 4. Creates missing décomptes for périodes without one
// ============================================================
router.post('/fix', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const client = await pool.connect();
    const fixes: string[] = [];

    try {
      await client.query('BEGIN');

      // Fix 1: Soft-delete orphan décomptes
      const orphanResult = await client.query(`
        UPDATE decompts d
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE d.deleted_at IS NULL
          AND d.user_id = $1
          AND d.periode_id IS NOT NULL
          AND d.periode_id NOT IN (
            SELECT id FROM periodes WHERE deleted_at IS NULL
          )
        RETURNING id
      `, [userId]);
      if ((orphanResult.rowCount ?? 0) > 0) {
        fixes.push(`Supprimé ${orphanResult.rowCount} décompte(s) orphelin(s)`);
      }

      // Fix 2: Soft-delete duplicate décomptes (keep the best one per période)
      const dupResult = await client.query(`
        WITH ranked AS (
          SELECT id,
                 project_id,
                 periode_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY project_id, periode_id
                   ORDER BY 
                     CASE WHEN lignes IS NOT NULL AND lignes::text != '[]' AND lignes::text != 'null' THEN 0 ELSE 1 END,
                     updated_at DESC
                 ) AS rn
          FROM decompts
          WHERE deleted_at IS NULL
            AND user_id = $1
            AND periode_id IS NOT NULL
        )
        UPDATE decompts 
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        RETURNING id
      `, [userId]);
      if ((dupResult.rowCount ?? 0) > 0) {
        fixes.push(`Supprimé ${dupResult.rowCount} décompte(s) dupliqué(s)`);
      }

      // Fix 3: Correct mismatched numeros
      const numFixResult = await client.query(`
        UPDATE decompts d
        SET numero = p.numero, updated_at = NOW()
        FROM periodes p
        WHERE d.periode_id = p.id
          AND d.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND d.user_id = $1
          AND d.numero != p.numero
        RETURNING d.id
      `, [userId]);
      if ((numFixResult.rowCount ?? 0) > 0) {
        fixes.push(`Corrigé ${numFixResult.rowCount} numéro(s) de décompte(s)`);
      }

      // Fix 4: Create missing décomptes for périodes that don't have one
      const missingPeriodesResult = await client.query(`
        SELECT p.id as periode_id, p.project_id, p.numero
        FROM periodes p
        LEFT JOIN decompts d ON p.id = d.periode_id AND d.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND p.user_id = $1
          AND d.id IS NULL
      `, [userId]);

      if (missingPeriodesResult.rows.length > 0) {
        for (const row of missingPeriodesResult.rows) {
          await client.query(`
            INSERT INTO decompts (id, project_id, periode_id, numero, user_id, statut, montant_total, created_at, updated_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, 'draft', 0, NOW(), NOW())
            ON CONFLICT DO NOTHING
          `, [row.project_id, row.periode_id, row.numero, userId]);
        }
        fixes.push(`Créé ${missingPeriodesResult.rows.length} décompte(s) manquant(s)`);
      }

      await client.query('COMMIT');

      logger.info(`🔧 Integrity fix applied for user ${userId}:`, fixes);

      res.json({
        status: 'fixed',
        fixes,
        fixedAt: new Date().toISOString(),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    logger.error('Integrity fix failed:', error);
    res.status(500).json({ error: 'Integrity fix failed', details: error.message });
  }
});

// ============================================================
// GET /api/integrity/project/:projectId - Check specific project
// ============================================================
router.get('/project/:projectId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const pool = getPool();
    const { projectId } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const periodes = await pool.query(
      `SELECT id, numero, libelle, statut, created_at FROM periodes 
       WHERE project_id = $1 AND deleted_at IS NULL AND user_id = $2
       ORDER BY numero`, [projectId, userId]
    );

    const decompts = await pool.query(
      `SELECT id, periode_id, numero, montant_total, total_ttc, statut, created_at 
       FROM decompts
       WHERE project_id = $1 AND deleted_at IS NULL AND user_id = $2
       ORDER BY numero`, [projectId, userId]
    );

    const metres = await pool.query(
      `SELECT id, periode_id, bordereau_ligne_id, total_partiel, created_at 
       FROM metres
       WHERE project_id = $1 AND deleted_at IS NULL AND user_id = $2
       ORDER BY periode_id`, [projectId, userId]
    );

    // Build mapping
    const periodeMap = new Map<string, any>();
    periodes.rows.forEach(p => {
      periodeMap.set(p.id, {
        ...p,
        decompts: [] as any[],
        metres: [] as any[],
      });
    });

    decompts.rows.forEach(d => {
      const entry = periodeMap.get(d.periode_id);
      if (entry) {
        entry.decompts.push(d);
      }
    });

    metres.rows.forEach(m => {
      const entry = periodeMap.get(m.periode_id);
      if (entry) {
        entry.metres.push(m);
      }
    });

    const issues: string[] = [];
    periodeMap.forEach((val, periodeId) => {
      if (val.decompts.length === 0) {
        issues.push(`Période #${val.numero} (${periodeId}) n'a pas de décompte`);
      }
      if (val.decompts.length > 1) {
        issues.push(`Période #${val.numero} (${periodeId}) a ${val.decompts.length} décomptes (attendu: 1)`);
      }
    });

    // Orphan decompts
    const orphans = decompts.rows.filter(d => !periodeMap.has(d.periode_id));
    orphans.forEach(d => {
      issues.push(`Décompte ${d.id} fait référence à une période inexistante ${d.periode_id}`);
    });

    res.json({
      projectId,
      summary: {
        periodes: periodes.rows.length,
        decompts: decompts.rows.length,
        metres: metres.rows.length,
        issues: issues.length,
      },
      issues,
      details: Array.from(periodeMap.values()),
      orphanDecompts: orphans,
    });
  } catch (error: any) {
    logger.error('Project integrity check failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
