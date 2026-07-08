import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// Journal de Chantier — Digital Site Diary Controller
// سجل الأشغال الرقمي
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
// CREATE — New diary entry
// ═══════════════════════════════════════════════════════════════
export const createDiaryEntry = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const {
      projectId, entryDate, weather,
      temperatureMin, temperatureMax,
      workforceOwn, workforceSubcontractor, workforceSupervisors,
      equipment, activities, materialsDelivered,
      incidents, observations, instructions,
      visitors, photos
    } = req.body;

    if (!projectId) throw new ApiError('projectId is required', 400);

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const result = await getPool().query(
      `INSERT INTO site_diary_entries (
        project_id, user_id, entry_date, weather,
        temperature_min, temperature_max,
        workforce_own, workforce_subcontractor, workforce_supervisors,
        equipment, activities, materials_delivered,
        incidents, observations, instructions,
        visitors, photos
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        projectId, req.user.id, entryDate || new Date().toISOString().slice(0, 10),
        weather || 'ensoleille',
        temperatureMin || null, temperatureMax || null,
        workforceOwn || 0, workforceSubcontractor || 0, workforceSupervisors || 0,
        JSON.stringify(equipment || []),
        JSON.stringify(activities || []),
        JSON.stringify(materialsDelivered || []),
        JSON.stringify(incidents || []),
        observations || null, instructions || null,
        JSON.stringify(visitors || []),
        JSON.stringify(photos || [])
      ]
    );

    logger.info('Site diary entry created', {
      entryId: result.rows[0].id,
      projectId,
      date: entryDate
    });

    res.status(201).json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// GET LIST — All diary entries for a project
// ═══════════════════════════════════════════════════════════════
export const getDiaryEntries = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const result = await getPool().query(
      `SELECT * FROM site_diary_entries
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY entry_date DESC`,
      [projectId, req.user.id]
    );

    // Also get summary stats
    const statsResult = await getPool().query(
      `SELECT
        COUNT(*) as total_entries,
        COUNT(CASE WHEN statut = 'valide' THEN 1 END) as validated,
        COUNT(CASE WHEN statut = 'signe' THEN 1 END) as signed,
        MIN(entry_date) as first_entry,
        MAX(entry_date) as last_entry,
        COALESCE(SUM(workforce_own + workforce_subcontractor + workforce_supervisors), 0) as total_workforce_days
       FROM site_diary_entries
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
      stats: keysToCamel(statsResult.rows[0])
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// GET ONE — Single diary entry
// ═══════════════════════════════════════════════════════════════
export const getDiaryEntry = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const result = await getPool().query(
      `SELECT sde.*, p.objet, p.marche_no, p.societe, p.commune
       FROM site_diary_entries sde
       INNER JOIN projects p ON sde.project_id = p.id
       WHERE sde.id = $1 AND sde.user_id = $2 AND sde.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) throw new ApiError('Entrée non trouvée', 404);

    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// UPDATE — Modify diary entry
// ═══════════════════════════════════════════════════════════════
export const updateDiaryEntry = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    // Verify ownership
    const existing = await getPool().query(
      'SELECT * FROM site_diary_entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) throw new ApiError('Entrée non trouvée', 404);

    const entry = existing.rows[0];
    // Cannot edit signed entries
    if (entry.statut === 'signe') throw new ApiError('Impossible de modifier une entrée signée', 400);

    const {
      entryDate, weather,
      temperatureMin, temperatureMax,
      workforceOwn, workforceSubcontractor, workforceSupervisors,
      equipment, activities, materialsDelivered,
      incidents, observations, instructions,
      visitors, photos, statut
    } = req.body;

    const result = await getPool().query(
      `UPDATE site_diary_entries SET
        entry_date = COALESCE($1, entry_date),
        weather = COALESCE($2, weather),
        temperature_min = COALESCE($3, temperature_min),
        temperature_max = COALESCE($4, temperature_max),
        workforce_own = COALESCE($5, workforce_own),
        workforce_subcontractor = COALESCE($6, workforce_subcontractor),
        workforce_supervisors = COALESCE($7, workforce_supervisors),
        equipment = COALESCE($8, equipment),
        activities = COALESCE($9, activities),
        materials_delivered = COALESCE($10, materials_delivered),
        incidents = COALESCE($11, incidents),
        observations = COALESCE($12, observations),
        instructions = COALESCE($13, instructions),
        visitors = COALESCE($14, visitors),
        photos = COALESCE($15, photos),
        statut = COALESCE($16, statut)
      WHERE id = $17 AND user_id = $18 AND deleted_at IS NULL
      RETURNING *`,
      [
        entryDate || null,
        weather || null,
        temperatureMin !== undefined ? temperatureMin : null,
        temperatureMax !== undefined ? temperatureMax : null,
        workforceOwn !== undefined ? workforceOwn : null,
        workforceSubcontractor !== undefined ? workforceSubcontractor : null,
        workforceSupervisors !== undefined ? workforceSupervisors : null,
        equipment ? JSON.stringify(equipment) : null,
        activities ? JSON.stringify(activities) : null,
        materialsDelivered ? JSON.stringify(materialsDelivered) : null,
        incidents ? JSON.stringify(incidents) : null,
        observations !== undefined ? observations : null,
        instructions !== undefined ? instructions : null,
        visitors ? JSON.stringify(visitors) : null,
        photos ? JSON.stringify(photos) : null,
        statut || null,
        id, req.user.id
      ]
    );

    if (result.rows.length === 0) throw new ApiError('Mise à jour échouée', 500);

    logger.info('Site diary entry updated', { entryId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// VALIDATE — Change status to validated
// ═══════════════════════════════════════════════════════════════
export const validateDiaryEntry = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const result = await getPool().query(
      `UPDATE site_diary_entries
       SET statut = 'valide'
       WHERE id = $1 AND user_id = $2 AND statut = 'brouillon' AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) throw new ApiError('Entrée non trouvée ou déjà validée', 404);

    logger.info('Site diary entry validated', { entryId: id });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// SIGN — Sign the diary entry
// ═══════════════════════════════════════════════════════════════
export const signDiaryEntry = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;
    const { signedByConductor, signedBySupervisor } = req.body;

    const signerName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email;

    const result = await getPool().query(
      `UPDATE site_diary_entries
       SET statut = 'signe',
           signed_by_conductor = COALESCE($3, signed_by_conductor),
           signed_by_supervisor = COALESCE($4, signed_by_supervisor),
           signed_at = NOW()
       WHERE id = $1 AND user_id = $2 AND statut IN ('brouillon', 'valide') AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id, signedByConductor || signerName, signedBySupervisor || null]
    );

    if (result.rows.length === 0) throw new ApiError('Entrée non trouvée ou déjà signée', 404);

    logger.info('Site diary entry signed', { entryId: id, signer: signerName });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// DELETE — Soft delete
// ═══════════════════════════════════════════════════════════════
export const deleteDiaryEntry = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    // Cannot delete signed entries
    const existing = await getPool().query(
      'SELECT statut FROM site_diary_entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (existing.rows.length === 0) throw new ApiError('Entrée non trouvée', 404);
    if (existing.rows[0].statut === 'signe') throw new ApiError('Impossible de supprimer une entrée signée', 400);

    await getPool().query(
      'UPDATE site_diary_entries SET deleted_at = NOW() WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    logger.info('Site diary entry deleted', { entryId: id });
    res.json({ success: true, message: 'Entrée supprimée' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// DUPLICATE — Copy previous day's entry for today
// ═══════════════════════════════════════════════════════════════
export const duplicateDiaryEntry = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;
    const { targetDate } = req.body;

    // Fetch source entry
    const source = await getPool().query(
      'SELECT * FROM site_diary_entries WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (source.rows.length === 0) throw new ApiError('Entrée source non trouvée', 404);

    const s = source.rows[0];
    const newDate = targetDate || new Date().toISOString().slice(0, 10);

    const result = await getPool().query(
      `INSERT INTO site_diary_entries (
        project_id, user_id, entry_date, weather,
        temperature_min, temperature_max,
        workforce_own, workforce_subcontractor, workforce_supervisors,
        equipment, activities, materials_delivered,
        incidents, observations, instructions, visitors
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        s.project_id, req.user.id, newDate, s.weather,
        s.temperature_min, s.temperature_max,
        s.workforce_own, s.workforce_subcontractor, s.workforce_supervisors,
        s.equipment, '[]', '[]',
        '[]', null, null, '[]'
      ]
    );

    logger.info('Site diary entry duplicated', {
      sourceId: id,
      newId: result.rows[0].id,
      date: newDate
    });

    res.status(201).json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// STATS — Workforce & activity statistics
// ═══════════════════════════════════════════════════════════════
export const getDiaryStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    // General stats
    const general = await getPool().query(
      `SELECT
        COUNT(*) as total_entries,
        COUNT(CASE WHEN statut = 'valide' THEN 1 END) as validated,
        COUNT(CASE WHEN statut = 'signe' THEN 1 END) as signed,
        COUNT(CASE WHEN statut = 'brouillon' THEN 1 END) as drafts,
        MIN(entry_date) as first_entry,
        MAX(entry_date) as last_entry
       FROM site_diary_entries
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    // Workforce stats
    const workforce = await getPool().query(
      `SELECT
        SUM(workforce_own) as total_own,
        SUM(workforce_subcontractor) as total_sub,
        SUM(workforce_supervisors) as total_supervisors,
        ROUND(AVG(workforce_own + workforce_subcontractor + workforce_supervisors), 1) as avg_daily_total,
        MAX(workforce_own + workforce_subcontractor + workforce_supervisors) as max_daily_total
       FROM site_diary_entries
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    // Weather distribution
    const weatherDist = await getPool().query(
      `SELECT weather, COUNT(*) as count
       FROM site_diary_entries
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL
       GROUP BY weather ORDER BY count DESC`,
      [projectId, req.user.id]
    );

    // Monthly workforce trend (last 12 months)
    const monthlyTrend = await getPool().query(
      `SELECT
        TO_CHAR(entry_date, 'YYYY-MM') as month,
        COUNT(*) as entries,
        SUM(workforce_own + workforce_subcontractor) as total_workers,
        ROUND(AVG(workforce_own + workforce_subcontractor), 1) as avg_workers
       FROM site_diary_entries
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL
         AND entry_date >= NOW() - INTERVAL '12 months'
       GROUP BY TO_CHAR(entry_date, 'YYYY-MM')
       ORDER BY month`,
      [projectId, req.user.id]
    );

    // Incident count by type
    const incidentStats = await getPool().query(
      `SELECT
        COUNT(*) FILTER (WHERE jsonb_array_length(incidents) > 0) as entries_with_incidents,
        SUM(jsonb_array_length(incidents)) as total_incidents
       FROM site_diary_entries
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, req.user.id]
    );

    res.json({
      success: true,
      data: {
        general: keysToCamel(general.rows[0]),
        workforce: keysToCamel(workforce.rows[0]),
        weatherDistribution: weatherDist.rows.map(keysToCamel),
        monthlyTrend: monthlyTrend.rows.map(keysToCamel),
        incidents: keysToCamel(incidentStats.rows[0])
      }
    });
  } catch (error) {
    next(error);
  }
};
