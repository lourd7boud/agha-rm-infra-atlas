/**
 * Penalty Controller — Penalties & Bonds Management
 * نظام الغرامات والضمانات
 * 
 * Endpoints:
 *   Penalties:
 *     POST   /penalties                          → Create penalty
 *     GET    /penalties/project/:projectId        → Get penalties by project 
 *     PUT    /penalties/:id                       → Update penalty
 *     DELETE /penalties/:id                       → Delete penalty
 *   
 *   Bonds:
 *     POST   /bonds                               → Create bond
 *     GET    /bonds/project/:projectId            → Get bonds by project
 *     PUT    /bonds/:id                           → Update bond
 *     DELETE /bonds/:id                           → Delete bond
 *   
 *   Retentions:
 *     POST   /retentions                          → Create retention entry
 *     GET    /retentions/project/:projectId       → Get retentions by project
 *   
 *   Summary:
 *     GET    /summary/project/:projectId          → Get financial summary
 */

import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';

// Helper to get actor name
const actorName = (user: any) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;

// ═══════════════════════════════════════════════════════════════════════
// PENALTIES CRUD
// ═══════════════════════════════════════════════════════════════════════

export const createPenalty = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const {
      projectId, type, dateDebut, dateFin, nombreJours, taux,
      baseCalcul, plafondPourcentage, motif, observations,
      referenceNotification, dateNotification, statut
    } = req.body;

    if (!projectId) throw new ApiError('projectId is required', 400);

    // Verify project ownership
    const pCheck = await getPool().query(
      'SELECT id, montant FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );
    if (pCheck.rows.length === 0) throw new ApiError('Project not found', 404);

    const base = parseFloat(baseCalcul) || parseFloat(pCheck.rows[0].montant) || 0;
    const rate = parseFloat(taux) || 0.001;
    const days = parseInt(nombreJours) || 0;
    const capPct = parseFloat(plafondPourcentage) || 10;

    // Calculate penalty: montant = base × taux × jours
    const montantPenalite = base * rate * days;
    const montantPlafond = base * (capPct / 100);
    const montantApplique = Math.min(montantPenalite, montantPlafond);

    const result = await getPool().query(
      `INSERT INTO penalties 
        (project_id, user_id, type, date_debut, date_fin, nombre_jours, taux,
         base_calcul, montant_penalite, plafond_pourcentage, montant_plafond,
         montant_applique, statut, reference_notification, date_notification,
         motif, observations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        projectId, req.user.id, type || 'retard',
        dateDebut || null, dateFin || null, days, rate,
        base, montantPenalite, capPct, montantPlafond,
        montantApplique, statut || 'calculee',
        referenceNotification || null, dateNotification || null,
        motif || null, observations || null,
      ]
    );

    logger.info('Penalty created', { penaltyId: result.rows[0].id, projectId });

    res.status(201).json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

export const getPenaltiesByProject = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const result = await getPool().query(
      `SELECT * FROM penalties 
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [projectId, req.user.id]
    );

    res.json({ success: true, data: result.rows.map(keysToCamel) });
  } catch (error) {
    next(error);
  }
};

export const updatePenalty = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const existing = await getPool().query(
      'SELECT * FROM penalties WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) throw new ApiError('Penalty not found', 404);

    const {
      type, dateDebut, dateFin, nombreJours, taux, baseCalcul,
      plafondPourcentage, statut, motif, observations,
      referenceNotification, dateNotification
    } = req.body;

    const base = parseFloat(baseCalcul) || parseFloat(existing.rows[0].base_calcul) || 0;
    const rate = parseFloat(taux) || parseFloat(existing.rows[0].taux) || 0.001;
    const days = parseInt(nombreJours) ?? existing.rows[0].nombre_jours ?? 0;
    const capPct = parseFloat(plafondPourcentage) || parseFloat(existing.rows[0].plafond_pourcentage) || 10;

    const montantPenalite = base * rate * days;
    const montantPlafond = base * (capPct / 100);
    const montantApplique = Math.min(montantPenalite, montantPlafond);

    const result = await getPool().query(
      `UPDATE penalties SET
        type = COALESCE($1, type),
        date_debut = COALESCE($2, date_debut),
        date_fin = COALESCE($3, date_fin),
        nombre_jours = $4,
        taux = $5,
        base_calcul = $6,
        montant_penalite = $7,
        plafond_pourcentage = $8,
        montant_plafond = $9,
        montant_applique = $10,
        statut = COALESCE($11, statut),
        motif = COALESCE($12, motif),
        observations = COALESCE($13, observations),
        reference_notification = COALESCE($14, reference_notification),
        date_notification = COALESCE($15, date_notification),
        updated_at = NOW()
       WHERE id = $16 RETURNING *`,
      [
        type, dateDebut || null, dateFin || null, days, rate,
        base, montantPenalite, capPct, montantPlafond, montantApplique,
        statut, motif, observations, referenceNotification, dateNotification, id,
      ]
    );

    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

export const deletePenalty = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    await getPool().query(
      'UPDATE penalties SET deleted_at = NOW() WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    res.json({ success: true, message: 'Pénalité supprimée' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// BONDS CRUD
// ═══════════════════════════════════════════════════════════════════════

export const createBond = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const {
      projectId, type, montant, pourcentage, baseCalcul,
      organisme, referenceOrganisme,
      dateEmission, dateExpiration, dateMainlevee,
      statut, observations
    } = req.body;

    if (!projectId || !type) throw new ApiError('projectId and type are required', 400);

    // Verify project
    const pCheck = await getPool().query(
      'SELECT id, montant FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );
    if (pCheck.rows.length === 0) throw new ApiError('Project not found', 404);

    const base = parseFloat(baseCalcul) || parseFloat(pCheck.rows[0].montant) || 0;
    const pct = parseFloat(pourcentage) || 0;
    const amount = parseFloat(montant) || (base * pct / 100);

    const result = await getPool().query(
      `INSERT INTO bonds 
        (project_id, user_id, type, montant, pourcentage, base_calcul,
         organisme, reference_organisme,
         date_emission, date_expiration, date_mainlevee,
         statut, observations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        projectId, req.user.id, type, amount, pct || null, base,
        organisme || null, referenceOrganisme || null,
        dateEmission || null, dateExpiration || null, dateMainlevee || null,
        statut || 'active', observations || null,
      ]
    );

    logger.info('Bond created', { bondId: result.rows[0].id, type, projectId });

    res.status(201).json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

export const getBondsByProject = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const result = await getPool().query(
      `SELECT * FROM bonds 
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [projectId, req.user.id]
    );

    res.json({ success: true, data: result.rows.map(keysToCamel) });
  } catch (error) {
    next(error);
  }
};

export const updateBond = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const existing = await getPool().query(
      'SELECT * FROM bonds WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) throw new ApiError('Bond not found', 404);

    const {
      type, montant, pourcentage, baseCalcul,
      organisme, referenceOrganisme,
      dateEmission, dateExpiration, dateMainlevee,
      statut, observations
    } = req.body;

    const result = await getPool().query(
      `UPDATE bonds SET
        type = COALESCE($1, type),
        montant = COALESCE($2, montant),
        pourcentage = COALESCE($3, pourcentage),
        base_calcul = COALESCE($4, base_calcul),
        organisme = COALESCE($5, organisme),
        reference_organisme = COALESCE($6, reference_organisme),
        date_emission = COALESCE($7, date_emission),
        date_expiration = COALESCE($8, date_expiration),
        date_mainlevee = COALESCE($9, date_mainlevee),
        statut = COALESCE($10, statut),
        observations = COALESCE($11, observations),
        updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [
        type, montant ? parseFloat(montant as any) : null, pourcentage ? parseFloat(pourcentage as any) : null,
        baseCalcul ? parseFloat(baseCalcul as any) : null,
        organisme, referenceOrganisme,
        dateEmission || null, dateExpiration || null, dateMainlevee || null,
        statut, observations, id,
      ]
    );

    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

export const deleteBond = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    await getPool().query(
      'UPDATE bonds SET deleted_at = NOW() WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    res.json({ success: true, message: 'Caution supprimée' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// RETENTIONS
// ═══════════════════════════════════════════════════════════════════════

export const createRetention = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const {
      projectId, bondId, decomptId, decomptNumero,
      montantDecompt, tauxRetenue
    } = req.body;

    if (!projectId) throw new ApiError('projectId is required', 400);

    const rate = parseFloat(tauxRetenue) || 7;
    const amount = parseFloat(montantDecompt) || 0;
    const retention = amount * (rate / 100);

    // Calculate cumulative
    const cumulRes = await getPool().query(
      `SELECT COALESCE(SUM(montant_retenue), 0) as cumul
       FROM retentions WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );
    const cumulPrev = parseFloat(cumulRes.rows[0].cumul) || 0;

    const result = await getPool().query(
      `INSERT INTO retentions 
        (project_id, user_id, bond_id, decompt_id, decompt_numero,
         montant_decompt, taux_retenue, montant_retenue, montant_cumule)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        projectId, req.user.id, bondId || null,
        decomptId || null, decomptNumero || null,
        amount, rate, retention, cumulPrev + retention,
      ]
    );

    res.status(201).json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

export const getRetentionsByProject = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const result = await getPool().query(
      `SELECT * FROM retentions 
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY decompt_numero ASC, created_at ASC`,
      [projectId, req.user.id]
    );

    res.json({ success: true, data: result.rows.map(keysToCamel) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// FINANCIAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════

export const getProjectFinancialSummary = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    // Penalties summary
    const penaltiesRes = await getPool().query(
      `SELECT 
        COUNT(*) as total_penalties,
        COALESCE(SUM(montant_applique) FILTER (WHERE statut != 'annulee' AND statut != 'remise'), 0) as total_penalites,
        COALESCE(SUM(montant_applique) FILTER (WHERE statut = 'appliquee'), 0) as penalites_appliquees,
        COALESCE(SUM(nombre_jours) FILTER (WHERE type = 'retard' AND statut != 'annulee'), 0) as jours_retard
       FROM penalties 
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    // Bonds summary
    const bondsRes = await getPool().query(
      `SELECT 
        COUNT(*) as total_bonds,
        COALESCE(SUM(montant) FILTER (WHERE statut = 'active'), 0) as montant_cautions_actives,
        COALESCE(SUM(montant) FILTER (WHERE type = 'caution_definitive' AND statut = 'active'), 0) as caution_definitive,
        COALESCE(SUM(montant) FILTER (WHERE type = 'retenue_garantie' AND statut = 'active'), 0) as retenue_garantie_bond,
        COUNT(*) FILTER (WHERE date_expiration IS NOT NULL AND date_expiration < CURRENT_DATE AND statut = 'active') as cautions_expirees
       FROM bonds 
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    // Retentions summary
    const retentionsRes = await getPool().query(
      `SELECT 
        COUNT(*) as total_retentions,
        COALESCE(SUM(montant_retenue), 0) as total_retenue,
        COALESCE(SUM(montant_retenue) FILTER (WHERE liberee = true), 0) as retenue_liberee,
        COALESCE(SUM(montant_retenue) FILTER (WHERE liberee = false), 0) as retenue_en_cours
       FROM retentions 
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    res.json({
      success: true,
      data: {
        penalties: keysToCamel(penaltiesRes.rows[0]),
        bonds: keysToCamel(bondsRes.rows[0]),
        retentions: keysToCamel(retentionsRes.rows[0]),
      },
    });
  } catch (error) {
    next(error);
  }
};
