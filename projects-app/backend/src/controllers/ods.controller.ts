import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// Ordres de Service (ODS) Controller
// أوامر الخدمة — CCAG-T articles 9 et 10
// ═══════════════════════════════════════════════════════════════

// ─── Helper: verify project ownership ───
async function verifyProject(projectId: string, userId: string) {
  const result = await getPool().query(
    'SELECT id, objet, marche_no, societe, commune FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [projectId, userId]
  );
  return result.rows.length > 0 ? keysToCamel(result.rows[0]) : null;
}

// ═══════════════════════════════════════════════════════════════
// CREATE — New ODS
// ═══════════════════════════════════════════════════════════════
export const createODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const {
      projectId, type, objet, description, motif,
      dateEmission, dateEffet, dateFin, delaiJours,
      impactFinancier, impactDelai,
      emetteur, destinataire, emetteurFonction,
      avenantId, odsParentId, piecesJointes
    } = req.body;

    if (!projectId) throw new ApiError('projectId is required', 400);
    if (!objet) throw new ApiError('objet is required', 400);

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const result = await getPool().query(
      `INSERT INTO ordres_service (
        project_id, user_id, type, objet, description, motif,
        date_emission, date_effet, date_fin, delai_jours,
        impact_financier, impact_delai,
        emetteur, destinataire, emetteur_fonction,
        avenant_id, ods_parent_id, pieces_jointes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING *`,
      [
        projectId, req.user.id,
        type || 'commencement',
        objet,
        description || null,
        motif || null,
        dateEmission || new Date().toISOString().slice(0, 10),
        dateEffet || null,
        dateFin || null,
        delaiJours || null,
        impactFinancier || 0,
        impactDelai || 0,
        emetteur || null,
        destinataire || null,
        emetteurFonction || null,
        avenantId || null,
        odsParentId || null,
        JSON.stringify(piecesJointes || [])
      ]
    );

    logger.info('ODS created', {
      odsId: result.rows[0].id,
      projectId,
      type: type || 'commencement',
      numero: result.rows[0].numero
    });

    res.status(201).json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// GET LIST — All ODS for a project
// ═══════════════════════════════════════════════════════════════
export const getODSByProject = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const result = await getPool().query(
      `SELECT os.*, a.numero as avenant_numero, a.objet as avenant_objet
       FROM ordres_service os
       LEFT JOIN avenants a ON os.avenant_id = a.id
       WHERE os.project_id = $1 AND os.user_id = $2 AND os.deleted_at IS NULL
       ORDER BY os.numero DESC`,
      [projectId, req.user.id]
    );

    // Summary stats
    const stats = await getPool().query(
      `SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN statut = 'brouillon' THEN 1 END) as brouillons,
        COUNT(CASE WHEN statut = 'emis' THEN 1 END) as emis,
        COUNT(CASE WHEN statut IN ('notifie','accuse','execute') THEN 1 END) as en_cours,
        COUNT(CASE WHEN statut = 'cloture' THEN 1 END) as clotures,
        COUNT(CASE WHEN statut = 'annule' THEN 1 END) as annules,
        COALESCE(SUM(impact_financier), 0) as total_impact_financier,
        COALESCE(SUM(impact_delai), 0) as total_impact_delai,
        COUNT(CASE WHEN type = 'arret' AND statut NOT IN ('cloture','annule') THEN 1 END) as arrets_actifs,
        COUNT(CASE WHEN type = 'commencement' THEN 1 END) as commencements,
        COUNT(CASE WHEN type = 'travaux_supplementaires' THEN 1 END) as travaux_sup
       FROM ordres_service
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
      stats: keysToCamel(stats.rows[0])
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// GET ONE — Single ODS with details
// ═══════════════════════════════════════════════════════════════
export const getODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const result = await getPool().query(
      `SELECT os.*, a.numero as avenant_numero, a.objet as avenant_objet,
              p.objet as project_objet, p.marche_no, p.societe, p.commune
       FROM ordres_service os
       LEFT JOIN avenants a ON os.avenant_id = a.id
       INNER JOIN projects p ON os.project_id = p.id
       WHERE os.id = $1 AND os.user_id = $2 AND os.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) throw new ApiError('ODS non trouvé', 404);

    // Get child ODS (linked)
    const children = await getPool().query(
      `SELECT id, numero, reference, type, objet, statut, date_emission
       FROM ordres_service
       WHERE ods_parent_id = $1 AND deleted_at IS NULL
       ORDER BY numero`,
      [id]
    );

    const data = keysToCamel(result.rows[0]);
    (data as any).childOds = children.rows.map(keysToCamel);

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// UPDATE — Modify ODS
// ═══════════════════════════════════════════════════════════════
export const updateODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const existing = await getPool().query(
      'SELECT * FROM ordres_service WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) throw new ApiError('ODS non trouvé', 404);
    if (existing.rows[0].statut === 'cloture') throw new ApiError('Impossible de modifier un ODS clôturé', 400);

    const {
      type, objet, description, motif,
      dateEmission, dateEffet, dateFin, delaiJours,
      impactFinancier, impactDelai,
      emetteur, destinataire, emetteurFonction,
      avenantId, odsParentId, piecesJointes, statut
    } = req.body;

    const result = await getPool().query(
      `UPDATE ordres_service SET
        type = COALESCE($1, type),
        objet = COALESCE($2, objet),
        description = COALESCE($3, description),
        motif = COALESCE($4, motif),
        date_emission = COALESCE($5, date_emission),
        date_effet = COALESCE($6, date_effet),
        date_fin = COALESCE($7, date_fin),
        delai_jours = COALESCE($8, delai_jours),
        impact_financier = COALESCE($9, impact_financier),
        impact_delai = COALESCE($10, impact_delai),
        emetteur = COALESCE($11, emetteur),
        destinataire = COALESCE($12, destinataire),
        emetteur_fonction = COALESCE($13, emetteur_fonction),
        avenant_id = $14,
        ods_parent_id = $15,
        pieces_jointes = COALESCE($16, pieces_jointes),
        statut = COALESCE($17, statut)
      WHERE id = $18 AND user_id = $19 AND deleted_at IS NULL
      RETURNING *`,
      [
        type || null, objet || null, description !== undefined ? description : null,
        motif !== undefined ? motif : null,
        dateEmission || null, dateEffet || null, dateFin || null,
        delaiJours !== undefined ? delaiJours : null,
        impactFinancier !== undefined ? impactFinancier : null,
        impactDelai !== undefined ? impactDelai : null,
        emetteur || null, destinataire || null, emetteurFonction || null,
        avenantId || null, odsParentId || null,
        piecesJointes ? JSON.stringify(piecesJointes) : null,
        statut || null,
        id, req.user.id
      ]
    );

    if (result.rows.length === 0) throw new ApiError('Mise à jour échouée', 500);

    logger.info('ODS updated', { odsId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// EMIT — Change status to emis (issued)
// ═══════════════════════════════════════════════════════════════
export const emitODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const result = await getPool().query(
      `UPDATE ordres_service
       SET statut = 'emis', date_emission = COALESCE(date_emission, CURRENT_DATE)
       WHERE id = $1 AND user_id = $2 AND statut = 'brouillon' AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) throw new ApiError('ODS non trouvé ou déjà émis', 404);

    logger.info('ODS emitted', { odsId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// NOTIFY — Change status to notifie
// ═══════════════════════════════════════════════════════════════
export const notifyODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;
    const { dateNotification } = req.body;

    const result = await getPool().query(
      `UPDATE ordres_service
       SET statut = 'notifie', date_notification = COALESCE($3, CURRENT_DATE)
       WHERE id = $1 AND user_id = $2 AND statut = 'emis' AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id, dateNotification || null]
    );

    if (result.rows.length === 0) throw new ApiError('ODS non trouvé ou pas encore émis', 404);

    logger.info('ODS notified', { odsId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// ACKNOWLEDGE — Accusé de réception
// ═══════════════════════════════════════════════════════════════
export const acknowledgeODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;
    const { accusePar, dateAccuse, observationsDestinataire } = req.body;

    const signerName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

    const result = await getPool().query(
      `UPDATE ordres_service
       SET statut = 'accuse',
           date_accuse_reception = COALESCE($3, CURRENT_DATE),
           accuse_par = COALESCE($4, $5),
           observations_destinataire = $6
       WHERE id = $1 AND user_id = $2 AND statut = 'notifie' AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id, dateAccuse || null, accusePar || null, signerName, observationsDestinataire || null]
    );

    if (result.rows.length === 0) throw new ApiError('ODS non trouvé ou pas encore notifié', 404);

    logger.info('ODS acknowledged', { odsId: id, by: accusePar || signerName });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// EXECUTE — Mark as executed
// ═══════════════════════════════════════════════════════════════
export const executeODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const result = await getPool().query(
      `UPDATE ordres_service
       SET statut = 'execute'
       WHERE id = $1 AND user_id = $2 AND statut IN ('accuse','notifie','emis') AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) throw new ApiError('ODS non trouvé ou statut invalide', 404);

    logger.info('ODS executed', { odsId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// CLOSE — Clôturer l'ODS
// ═══════════════════════════════════════════════════════════════
export const closeODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const result = await getPool().query(
      `UPDATE ordres_service
       SET statut = 'cloture'
       WHERE id = $1 AND user_id = $2 AND statut IN ('execute','accuse','notifie','emis') AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) throw new ApiError('ODS non trouvé ou déjà clôturé', 404);

    logger.info('ODS closed', { odsId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// CANCEL — Annuler l'ODS
// ═══════════════════════════════════════════════════════════════
export const cancelODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;
    const { motif } = req.body;

    const existing = await getPool().query(
      'SELECT statut FROM ordres_service WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) throw new ApiError('ODS non trouvé', 404);
    if (existing.rows[0].statut === 'cloture') throw new ApiError('Impossible d\'annuler un ODS clôturé', 400);

    const result = await getPool().query(
      `UPDATE ordres_service
       SET statut = 'annule', motif = COALESCE($3, motif)
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id, motif || null]
    );

    logger.info('ODS cancelled', { odsId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// DELETE — Soft delete (only brouillon)
// ═══════════════════════════════════════════════════════════════
export const deleteODS = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const existing = await getPool().query(
      'SELECT statut FROM ordres_service WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) throw new ApiError('ODS non trouvé', 404);
    if (existing.rows[0].statut !== 'brouillon') throw new ApiError('Seuls les brouillons peuvent être supprimés', 400);

    await getPool().query(
      'UPDATE ordres_service SET deleted_at = NOW() WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    logger.info('ODS deleted', { odsId: id });
    res.json({ success: true, message: 'ODS supprimé' });
  } catch (error) {
    next(error);
  }
};
