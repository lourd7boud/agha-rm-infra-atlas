import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

/**
 * Create PV (PostgreSQL version)
 */
export const createPV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    logger.info('Creating PV...');
    
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId, type, numero, date, objet, contenu, participants, attachments } = req.body;

    if (!projectId || !type || !numero || !date || !objet) {
      throw new ApiError('Required fields missing', 400);
    }

    const pool = getPool();
    const pvId = uuidv4();

    // Check project exists and belongs to user
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    const result = await pool.query(
      `INSERT INTO pvs (
        id, project_id, type, numero, date, objet, contenu, 
        participants, attachments, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [
        pvId,
        projectId,
        type,
        numero,
        new Date(date),
        objet,
        contenu || '',
        JSON.stringify(participants || []),
        JSON.stringify(attachments || [])
      ]
    );

    logger.info(`PV created: ${pvId}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Error creating PV:', error);
    next(error);
  }
};

/**
 * Get all PVs for a project (PostgreSQL version)
 */
export const getPVs = async (
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
      `SELECT * FROM pvs WHERE project_id = $1 AND deleted_at IS NULL ORDER BY date DESC`,
      [projectId]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching PVs:', error);
    next(error);
  }
};

/**
 * Get PV by ID (PostgreSQL version)
 */
export const getPVById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT pv.* FROM pvs pv
       INNER JOIN projects p ON pv.project_id = p.id
       WHERE pv.id = $1 AND p.user_id = $2 AND pv.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('PV not found', 404);
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
 * Update PV (PostgreSQL version)
 */
export const updatePV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { type, numero, date, objet, contenu, participants, attachments } = req.body;
    const pool = getPool();

    // Check ownership
    const existing = await pool.query(
      `SELECT pv.* FROM pvs pv
       INNER JOIN projects p ON pv.project_id = p.id
       WHERE pv.id = $1 AND p.user_id = $2 AND pv.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('PV not found', 404);
    }

    const result = await pool.query(
      `UPDATE pvs SET 
        type = COALESCE($1, type),
        numero = COALESCE($2, numero),
        date = COALESCE($3, date),
        objet = COALESCE($4, objet),
        contenu = COALESCE($5, contenu),
        participants = COALESCE($6, participants),
        attachments = COALESCE($7, attachments),
        updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [
        type,
        numero,
        date ? new Date(date) : null,
        objet,
        contenu,
        participants ? JSON.stringify(participants) : null,
        attachments ? JSON.stringify(attachments) : null,
        id
      ]
    );

    logger.info(`PV updated: ${id}`);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete PV (PostgreSQL version)
 */
export const deletePV = async (
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
      `SELECT pv.* FROM pvs pv
       INNER JOIN projects p ON pv.project_id = p.id
       WHERE pv.id = $1 AND p.user_id = $2 AND pv.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('PV not found', 404);
    }

    await pool.query(
      `UPDATE pvs SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    logger.info(`PV deleted: ${id}`);

    res.json({
      success: true,
      message: 'PV deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
