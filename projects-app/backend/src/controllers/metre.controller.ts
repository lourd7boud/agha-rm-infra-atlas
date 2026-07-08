import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { keysToCamel } from '../utils/transform';

/**
 * Create metre (PostgreSQL version)
 */
export const createMetre = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    logger.info('Creating metre...');
    
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { 
      projectId, 
      periodeId, 
      bordereauLigneId, 
      reference,
      designationBordereau,
      unite,
      quantiteBordereau,
      sections,
      subSections,
      lignes,
      totalPartiel,
      totalCumule,
      pourcentageRealisation,
      data 
    } = req.body;

    if (!projectId) {
      throw new ApiError('Project ID required', 400);
    }

    const pool = getPool();
    const metreId = uuidv4();

    // Check project exists and belongs to user
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    // Calculate total from lignes if not provided
    const calculatedTotal = lignes?.reduce((sum: number, l: any) => sum + (Number(l.partiel) || 0), 0) || 0;
    const finalTotalPartiel = totalPartiel ?? calculatedTotal;

    logger.debug('Saving metre', { metreId, projectId, periodeId, lignesCount: lignes?.length || 0 });

    const result = await pool.query(
      `INSERT INTO metres (
        id, project_id, periode_id, bordereau_ligne_id, user_id,
        reference, designation_bordereau, unite, quantite_bordereau,
        sections, sub_sections, lignes, 
        total_partiel, total_cumule, pourcentage_realisation,
        data, created_at, updated_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
       RETURNING *`,
      [
        metreId, 
        projectId, 
        periodeId || null, 
        bordereauLigneId || null,
        req.user.id,
        reference || null,
        designationBordereau || null,
        unite || null,
        quantiteBordereau || 0,
        JSON.stringify(sections || []),
        JSON.stringify(subSections || []),
        JSON.stringify(lignes || []),
        finalTotalPartiel,
        totalCumule || 0,
        pourcentageRealisation || 0,
        JSON.stringify(data || {})
      ]
    );

    logger.info(`Metre created: ${metreId}`);

    res.status(201).json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    logger.error('Error creating metre:', error);
    next(error);
  }
};

/**
 * Get all metres for a project (PostgreSQL version)
 */
export const getMetres = async (
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
      `SELECT * FROM metres WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [projectId]
    );

    res.json({
      success: true,
      data: keysToCamel(result.rows),
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching metres:', error);
    next(error);
  }
};

/**
 * Get metre by ID (PostgreSQL version)
 */
export const getMetreById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT m.* FROM metres m
       INNER JOIN projects p ON m.project_id = p.id
       WHERE m.id = $1 AND p.user_id = $2 AND m.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Metre not found', 404);
    }

    res.json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update metre (PostgreSQL version)
 */
export const updateMetre = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { 
      periodeId, 
      bordereauLigneId, 
      reference,
      designationBordereau,
      unite,
      quantiteBordereau,
      sections,
      subSections,
      lignes,
      totalPartiel,
      totalCumule,
      pourcentageRealisation,
      data 
    } = req.body;
    const pool = getPool();

    // Check ownership
    const existing = await pool.query(
      `SELECT m.* FROM metres m
       INNER JOIN projects p ON m.project_id = p.id
       WHERE m.id = $1 AND p.user_id = $2 AND m.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Metre not found', 404);
    }

    // Calculate total from lignes if not provided
    const calculatedTotal = lignes?.reduce((sum: number, l: any) => sum + (Number(l.partiel) || 0), 0) || 0;
    const finalTotalPartiel = totalPartiel ?? calculatedTotal;

    logger.debug('Updating metre', { id, lignesCount: lignes?.length || 0 });

    const result = await pool.query(
      `UPDATE metres SET 
        periode_id = COALESCE($1, periode_id),
        bordereau_ligne_id = COALESCE($2, bordereau_ligne_id),
        reference = COALESCE($3, reference),
        designation_bordereau = COALESCE($4, designation_bordereau),
        unite = COALESCE($5, unite),
        quantite_bordereau = COALESCE($6, quantite_bordereau),
        sections = COALESCE($7, sections),
        sub_sections = COALESCE($8, sub_sections),
        lignes = COALESCE($9, lignes),
        total_partiel = COALESCE($10, total_partiel),
        total_cumule = COALESCE($11, total_cumule),
        pourcentage_realisation = COALESCE($12, pourcentage_realisation),
        data = COALESCE($13, data),
        updated_at = NOW()
       WHERE id = $14 RETURNING *`,
      [
        periodeId, 
        bordereauLigneId, 
        reference,
        designationBordereau,
        unite,
        quantiteBordereau,
        sections ? JSON.stringify(sections) : null,
        subSections ? JSON.stringify(subSections) : null,
        lignes ? JSON.stringify(lignes) : null,
        finalTotalPartiel,
        totalCumule,
        pourcentageRealisation,
        data ? JSON.stringify(data) : null, 
        id
      ]
    );

    logger.info(`Metre updated: ${id}`);

    res.json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    logger.error('Error updating metre:', error);
    next(error);
  }
};

/**
 * Delete metre (PostgreSQL version)
 */
export const deleteMetre = async (
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
      `SELECT m.* FROM metres m
       INNER JOIN projects p ON m.project_id = p.id
       WHERE m.id = $1 AND p.user_id = $2 AND m.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Metre not found', 404);
    }

    await pool.query(
      `UPDATE metres SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    logger.info(`Metre deleted: ${id}`);

    res.json({
      success: true,
      message: 'Metre deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
