/**
 * Avenant Controller — Contract Amendments Management
 * نظام تدبير ملاحق العقود
 * 
 * Full CRUD with financial impact calculations.
 * Follows existing controller patterns (pool.query, keysToCamel, ApiError).
 */

import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════
// CREATE AVENANT
// ═══════════════════════════════════════════════════════════════════════
export const createAvenant = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const client = await getPool().connect();
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const {
      projectId, objet, reference, dateAvenant, dateNotification,
      dateApprobation, montantAvenant, delaisSupplementaire,
      typeAvenant, motif, modifications, prixNouveaux, observations
    } = req.body;

    if (!projectId || !objet) {
      throw new ApiError('Project ID and objet are required', 400);
    }

    await client.query('BEGIN');

    // Check project exists and belongs to user
    const projectCheck = await client.query(
      'SELECT id, montant, delais_execution FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    const project = projectCheck.rows[0];
    const montantInitial = parseFloat(project.montant) || 0;
    const delaisActuel = project.delais_execution || 0;

    // Get next avenant number
    const numberResult = await client.query(
      `SELECT COALESCE(MAX(numero), 0) + 1 as next_numero 
       FROM avenants WHERE project_id = $1 AND deleted_at IS NULL`,
      [projectId]
    );
    const numero = numberResult.rows[0].next_numero;

    // Calculate current contract amount (initial + all previous avenants)
    const prevAvenants = await client.query(
      `SELECT COALESCE(SUM(montant_avenant), 0) as total_avenants,
              COALESCE(SUM(delais_supplementaire), 0) as total_delais_sup
       FROM avenants WHERE project_id = $1 AND deleted_at IS NULL AND statut = 'approuve'`,
      [projectId]
    );
    const totalPrevAvenants = parseFloat(prevAvenants.rows[0].total_avenants) || 0;
    const totalDelaisSup = parseInt(prevAvenants.rows[0].total_delais_sup) || 0;

    const montantAvantAvenant = montantInitial + totalPrevAvenants;
    const montantAvenantVal = parseFloat(montantAvenant) || 0;
    const montantNouveau = montantAvantAvenant + montantAvenantVal;
    const pourcentageVariation = montantAvantAvenant > 0 
      ? (montantAvenantVal / montantInitial) * 100 
      : 0;

    const delaisSupp = parseInt(delaisSupplementaire) || 0;
    const nouveauDelais = delaisActuel + totalDelaisSup + delaisSupp;

    const avenantId = uuidv4();

    const result = await client.query(
      `INSERT INTO avenants (
        id, project_id, user_id, numero, objet, reference,
        date_avenant, date_notification, date_approbation,
        montant_initial, montant_avenant, montant_nouveau, pourcentage_variation,
        delais_supplementaire, nouveau_delais,
        type_avenant, motif, statut,
        modifications, prix_nouveaux, observations,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15,
        $16, $17, 'brouillon',
        $18, $19, $20,
        NOW(), NOW()
      ) RETURNING *`,
      [
        avenantId, projectId, req.user.id, numero, objet, reference || null,
        dateAvenant || null, dateNotification || null, dateApprobation || null,
        montantAvantAvenant, montantAvenantVal, montantNouveau, 
        parseFloat(pourcentageVariation.toFixed(4)),
        delaisSupp, nouveauDelais,
        typeAvenant || 'modification', motif || null,
        JSON.stringify(modifications || []), JSON.stringify(prixNouveaux || []),
        observations || null
      ]
    );

    await client.query('COMMIT');

    logger.info(`Avenant created: ${avenantId} for project ${projectId}, numero: ${numero}`);

    res.status(201).json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating avenant:', error);
    next(error);
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════
// GET ALL AVENANTS FOR A PROJECT
// ═══════════════════════════════════════════════════════════════════════
export const getAvenantsByProject = async (
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
      `SELECT * FROM avenants 
       WHERE project_id = $1 AND deleted_at IS NULL 
       ORDER BY numero ASC`,
      [projectId]
    );

    // Calculate cumulative totals
    let cumulMontant = 0;
    const avenants = result.rows.map(row => {
      const avenant = keysToCamel(row);
      cumulMontant += parseFloat(row.montant_avenant) || 0;
      return {
        ...avenant,
        montantCumule: cumulMontant,
      };
    });

    res.json({
      success: true,
      data: avenants,
      count: avenants.length,
      summary: {
        totalAvenants: avenants.length,
        montantTotalAvenants: cumulMontant,
        approuves: avenants.filter((a: any) => a.statut === 'approuve').length,
        enAttente: avenants.filter((a: any) => a.statut === 'en_attente').length,
      }
    });
  } catch (error) {
    logger.error('Error fetching avenants:', error);
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// GET SINGLE AVENANT BY ID
// ═══════════════════════════════════════════════════════════════════════
export const getAvenantById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT a.*, p.montant as projet_montant_initial, p.objet as projet_objet,
              p.marche_no as projet_marche_no
       FROM avenants a
       JOIN projects p ON a.project_id = p.id
       WHERE a.id = $1 AND a.user_id = $2 AND a.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Avenant not found', 404);
    }

    res.json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    logger.error('Error fetching avenant:', error);
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// UPDATE AVENANT
// ═══════════════════════════════════════════════════════════════════════
export const updateAvenant = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const client = await getPool().connect();
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const {
      objet, reference, dateAvenant, dateNotification, dateApprobation,
      montantAvenant, delaisSupplementaire, typeAvenant, motif,
      modifications, prixNouveaux, observations, statut
    } = req.body;

    await client.query('BEGIN');

    // Check avenant exists and belongs to user
    const avenantCheck = await client.query(
      'SELECT * FROM avenants WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );

    if (avenantCheck.rows.length === 0) {
      throw new ApiError('Avenant not found or not authorized', 404);
    }

    const existing = avenantCheck.rows[0];

    // If changing status to approved, recalculate project totals
    const newStatut = statut || existing.statut;

    // Get project info for recalculation
    const project = await client.query(
      'SELECT montant, delais_execution FROM projects WHERE id = $1',
      [existing.project_id]
    );
    const montantInitial = parseFloat(project.rows[0].montant) || 0;
    const delaisActuel = project.rows[0].delais_execution || 0;

    // Recalculate with new values
    const prevAvenants = await client.query(
      `SELECT COALESCE(SUM(montant_avenant), 0) as total_avenants,
              COALESCE(SUM(delais_supplementaire), 0) as total_delais_sup
       FROM avenants 
       WHERE project_id = $1 AND deleted_at IS NULL AND statut = 'approuve' AND id != $2`,
      [existing.project_id, id]
    );
    const totalPrevAvenants = parseFloat(prevAvenants.rows[0].total_avenants) || 0;
    const totalDelaisSup = parseInt(prevAvenants.rows[0].total_delais_sup) || 0;

    const montantAvenantVal = montantAvenant !== undefined 
      ? parseFloat(montantAvenant) 
      : parseFloat(existing.montant_avenant);
    const montantAvantAvenant = montantInitial + totalPrevAvenants;
    const montantNouveau = montantAvantAvenant + montantAvenantVal;
    const pourcentageVariation = montantInitial > 0 
      ? (montantAvenantVal / montantInitial) * 100 
      : 0;

    const delaisSupp = delaisSupplementaire !== undefined 
      ? parseInt(delaisSupplementaire) 
      : parseInt(existing.delais_supplementaire);
    const nouveauDelais = delaisActuel + totalDelaisSup + delaisSupp;

    const result = await client.query(
      `UPDATE avenants SET
        objet = COALESCE($1, objet),
        reference = COALESCE($2, reference),
        date_avenant = COALESCE($3, date_avenant),
        date_notification = COALESCE($4, date_notification),
        date_approbation = COALESCE($5, date_approbation),
        montant_initial = $6,
        montant_avenant = $7,
        montant_nouveau = $8,
        pourcentage_variation = $9,
        delais_supplementaire = $10,
        nouveau_delais = $11,
        type_avenant = COALESCE($12, type_avenant),
        motif = COALESCE($13, motif),
        statut = COALESCE($14, statut),
        modifications = COALESCE($15, modifications),
        prix_nouveaux = COALESCE($16, prix_nouveaux),
        observations = COALESCE($17, observations),
        version = version + 1,
        updated_at = NOW()
       WHERE id = $18
       RETURNING *`,
      [
        objet, reference || null, dateAvenant || null,
        dateNotification || null, dateApprobation || null,
        montantAvantAvenant, montantAvenantVal, montantNouveau,
        parseFloat(pourcentageVariation.toFixed(4)),
        delaisSupp, nouveauDelais,
        typeAvenant, motif, newStatut,
        modifications ? JSON.stringify(modifications) : null,
        prixNouveaux ? JSON.stringify(prixNouveaux) : null,
        observations,
        id
      ]
    );

    await client.query('COMMIT');

    logger.info(`Avenant updated: ${id}, status: ${newStatut}`);

    res.json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error updating avenant:', error);
    next(error);
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════
// DELETE AVENANT (soft delete)
// ═══════════════════════════════════════════════════════════════════════
export const deleteAvenant = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    // Check avenant exists and belongs to user
    const check = await pool.query(
      'SELECT id, statut FROM avenants WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );

    if (check.rows.length === 0) {
      throw new ApiError('Avenant not found or not authorized', 404);
    }

    // Cannot delete approved avenants
    if (check.rows[0].statut === 'approuve') {
      throw new ApiError('Cannot delete an approved avenant. Cancel it first.', 400);
    }

    await pool.query(
      'UPDATE avenants SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
      [id]
    );

    logger.info(`Avenant soft-deleted: ${id}`);

    res.json({
      success: true,
      message: 'Avenant deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting avenant:', error);
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// GET PROJECT SUMMARY WITH AVENANTS
// ═══════════════════════════════════════════════════════════════════════
export const getProjectAvenantSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const pool = getPool();

    // Get project
    const project = await pool.query(
      'SELECT id, montant, delais_execution, objet, marche_no FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (project.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    const proj = project.rows[0];
    const montantInitial = parseFloat(proj.montant) || 0;

    // Get all approved avenants
    const avenants = await pool.query(
      `SELECT numero, objet, montant_avenant, montant_nouveau, 
              delais_supplementaire, date_approbation, statut, type_avenant
       FROM avenants 
       WHERE project_id = $1 AND deleted_at IS NULL 
       ORDER BY numero ASC`,
      [projectId]
    );

    // Calculate summary
    const approuves = avenants.rows.filter(a => a.statut === 'approuve');
    const totalMontantAvenants = approuves.reduce((sum: number, a: any) => 
      sum + (parseFloat(a.montant_avenant) || 0), 0);
    const totalDelaisSup = approuves.reduce((sum: number, a: any) => 
      sum + (parseInt(a.delais_supplementaire) || 0), 0);

    const montantActuel = montantInitial + totalMontantAvenants;
    const variationTotale = montantInitial > 0 
      ? (totalMontantAvenants / montantInitial) * 100 
      : 0;

    res.json({
      success: true,
      data: {
        project: keysToCamel(proj),
        montantInitial,
        montantActuel,
        totalMontantAvenants,
        variationTotale: parseFloat(variationTotale.toFixed(4)),
        delaisInitial: proj.delais_execution || 0,
        delaisActuel: (proj.delais_execution || 0) + totalDelaisSup,
        totalDelaisSup,
        nombreAvenants: avenants.rows.length,
        nombreApprouves: approuves.length,
        avenants: avenants.rows.map(keysToCamel),
      }
    });
  } catch (error) {
    logger.error('Error fetching avenant summary:', error);
    next(error);
  }
};
