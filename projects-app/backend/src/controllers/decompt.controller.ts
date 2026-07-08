import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { keysToCamel } from '../utils/transform';

/**
 * Create decompt (PostgreSQL version)
 */
export const createDecompt = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    logger.info('Creating decompt...');
    
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { 
      projectId, 
      periodeId, 
      numero, 
      dateDecompte, 
      montantCumule, 
      montantPrecedent, 
      montantActuel, 
      montantTotal,
      totalTTC,
      totalGeneralTTC,
      isDernier 
    } = req.body;

    if (!projectId || numero === undefined) {
      throw new ApiError('Project ID and numero required', 400);
    }

    if (!periodeId) {
      throw new ApiError('Période ID is required — un décompte doit être lié à une période', 400);
    }

    const pool = getPool();
    const decomptId = uuidv4();

    // Check project exists and belongs to user
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    // 🔒 Validate période exists and belongs to the SAME project
    const periodeCheck = await pool.query(
      'SELECT id FROM periodes WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL',
      [periodeId, projectId]
    );

    if (periodeCheck.rows.length === 0) {
      throw new ApiError('Période non trouvée ou n\'appartient pas à ce projet', 404);
    }

    // 🔒 Check for duplicate: prevent duplicate decompt with same numero for same project
    const duplicateCheck = await pool.query(
      'SELECT id FROM decompts WHERE project_id = $1 AND numero = $2 AND deleted_at IS NULL',
      [projectId, numero]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new ApiError(`Un décompte N°${numero} existe déjà pour ce projet. Veuillez utiliser un numéro différent.`, 409);
    }

    // 🔒 Check for duplicate: prevent multiple decompts for the same période
    const periodeDecomptCheck = await pool.query(
      'SELECT id, numero FROM decompts WHERE project_id = $1 AND periode_id = $2 AND deleted_at IS NULL',
      [projectId, periodeId]
    );

    if (periodeDecomptCheck.rows.length > 0) {
      throw new ApiError(`Un décompte existe déjà pour cette période (N°${periodeDecomptCheck.rows[0].numero}). Chaque période ne peut avoir qu'un seul décompte.`, 409);
    }

    const result = await pool.query(
      `INSERT INTO decompts (
        id, project_id, periode_id, numero, date_decompte, 
        montant_cumule, montant_precedent, montant_actuel, montant_total,
        total_ttc, total_general_ttc,
        is_dernier, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
       RETURNING *`,
      [
        decomptId, 
        projectId, 
        periodeId || null, 
        numero,
        dateDecompte ? new Date(dateDecompte) : null,
        montantCumule || 0,
        montantPrecedent || 0,
        montantActuel || 0,
        montantTotal || 0,
        totalTTC || 0,
        totalGeneralTTC ?? totalTTC ?? 0,
        isDernier || false
      ]
    );

    logger.info(`Decompt created: ${decomptId}`);

    res.status(201).json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    logger.error('Error creating decompt:', error);
    next(error);
  }
};

/**
 * Get all decompts for a project (PostgreSQL version)
 */
export const getDecompts = async (
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
      `SELECT * FROM decompts WHERE project_id = $1 AND deleted_at IS NULL ORDER BY numero ASC`,
      [projectId]
    );

    res.json({
      success: true,
      data: keysToCamel(result.rows),
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching decompts:', error);
    next(error);
  }
};

/**
 * Get decompt by ID (PostgreSQL version)
 */
export const getDecomptById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT d.* FROM decompts d
       INNER JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1 AND p.user_id = $2 AND d.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Decompt not found', 404);
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
 * Update decompt (PostgreSQL version)
 */
export const updateDecompt = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { 
      periodeId, 
      numero, 
      dateDecompte, 
      montantCumule, 
      montantPrecedent, 
      montantActuel, 
      montantTotal,
      totalTTC,
      totalGeneralTTC,
      lignes,
      isDernier,
      statut
    } = req.body;
    const pool = getPool();

    // Check ownership
    const existing = await pool.query(
      `SELECT d.* FROM decompts d
       INNER JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1 AND p.user_id = $2 AND d.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Decompt not found', 404);
    }

    const result = await pool.query(
      `UPDATE decompts SET 
        periode_id = COALESCE($1, periode_id),
        numero = COALESCE($2, numero),
        date_decompte = COALESCE($3, date_decompte),
        montant_cumule = COALESCE($4, montant_cumule),
        montant_precedent = COALESCE($5, montant_precedent),
        montant_actuel = COALESCE($6, montant_actuel),
        montant_total = COALESCE($7, montant_total),
        total_ttc = COALESCE($8, total_ttc),
        total_general_ttc = COALESCE($9, total_general_ttc),
        lignes = COALESCE($10, lignes),
        is_dernier = COALESCE($11, is_dernier),
        statut = COALESCE($12, statut),
        updated_at = NOW()
       WHERE id = $13 RETURNING *`,
      [
        periodeId, 
        numero, 
        dateDecompte ? new Date(dateDecompte) : null, 
        montantCumule, 
        montantPrecedent, 
        montantActuel, 
        montantTotal,
        totalTTC,
        totalGeneralTTC ?? totalTTC,
        lignes ? JSON.stringify(lignes) : null,
        isDernier,
        statut,
        id
      ]
    );

    logger.info(`Decompt updated: ${id}`);

    res.json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    logger.error('Error updating decompt:', error);
    next(error);
  }
};

/**
 * Delete decompt (PostgreSQL version)
 */
export const deleteDecompt = async (
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
      `SELECT d.* FROM decompts d
       INNER JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1 AND p.user_id = $2 AND d.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Decompt not found', 404);
    }

    await pool.query(
      `UPDATE decompts SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    logger.info(`Decompt deleted: ${id}`);

    res.json({
      success: true,
      message: 'Decompt deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Generate decompt PDF (PostgreSQL version)
 */
export const generateDecomptPDF = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    // Get decompt with project info
    const result = await pool.query(
      `SELECT d.*, p.objet, p.marche_no, p.societe
       FROM decompts d
       INNER JOIN projects p ON d.project_id = p.id
       WHERE d.id = $1 AND p.user_id = $2 AND d.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Decompt not found', 404);
    }

    // For now, return the data that would be used for PDF generation
    res.json({
      success: true,
      message: 'PDF generation endpoint - data ready',
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};
