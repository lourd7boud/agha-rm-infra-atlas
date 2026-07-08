import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

/**
 * Create bordereau (PostgreSQL version)
 */
export const createBordereau = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    logger.info('Creating bordereau...');
    
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId, lignes } = req.body;

    if (!projectId) {
      throw new ApiError('Project ID required', 400);
    }

    const pool = getPool();
    const bordereauId = uuidv4();

    // Check project exists and belongs to user
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    const result = await pool.query(
      `INSERT INTO bordereaux (id, project_id, lignes, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING *`,
      [bordereauId, projectId, JSON.stringify(lignes || [])]
    );

    logger.info(`Bordereau created: ${bordereauId}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Error creating bordereau:', error);
    next(error);
  }
};

/**
 * Get all bordereaux for a project (PostgreSQL version)
 */
export const getBordereaux = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const pool = getPool();

    // Verify project ownership
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    const result = await pool.query(
      `SELECT * FROM bordereaux WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [projectId]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching bordereaux:', error);
    next(error);
  }
};

/**
 * Get bordereau by ID (PostgreSQL version)
 */
export const getBordereauById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT b.* FROM bordereaux b
       INNER JOIN projects p ON b.project_id = p.id
       WHERE b.id = $1 AND p.user_id = $2 AND b.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Bordereau not found', 404);
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update bordereau (PostgreSQL version)
 */
export const updateBordereau = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { lignes, montantTotal } = req.body;
    const pool = getPool();

    // Check ownership
    const existing = await pool.query(
      `SELECT b.* FROM bordereaux b
       INNER JOIN projects p ON b.project_id = p.id
       WHERE b.id = $1 AND p.user_id = $2 AND b.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Bordereau not found', 404);
    }

    const bordereau = existing.rows[0];

    // Calculate montant TTC from lignes (HT + 20% TVA)
    const calculatedMontantHT = (lignes || []).reduce((sum: number, ligne: any) => {
      return sum + (Number(ligne.montant) || 0);
    }, 0);
    const calculatedMontantTTC = calculatedMontantHT * 1.2;

    // PHASE 2: Use transaction for atomic bordereau + project update
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');

      result = await client.query(
        `UPDATE bordereaux SET lignes = $1, montant_total = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
        [JSON.stringify(lignes || []), montantTotal || calculatedMontantHT, id]
      );

      await client.query(
        `UPDATE projects SET montant = $1, updated_at = NOW() WHERE id = $2`,
        [calculatedMontantTTC, bordereau.project_id]
      );

      await client.query('COMMIT');
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }

    logger.info(`Bordereau updated: ${id}, Project montant updated to: ${calculatedMontantTTC}`);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete bordereau (PostgreSQL version)
 */
export const deleteBordereau = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    // Check ownership
    const existing = await pool.query(
      `SELECT b.* FROM bordereaux b
       INNER JOIN projects p ON b.project_id = p.id
       WHERE b.id = $1 AND p.user_id = $2 AND b.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Bordereau not found', 404);
    }

    await pool.query(
      `UPDATE bordereaux SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    logger.info(`Bordereau deleted: ${id}`);

    res.json({
      success: true,
      message: 'Bordereau deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
