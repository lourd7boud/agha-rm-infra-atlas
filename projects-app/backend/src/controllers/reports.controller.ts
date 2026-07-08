import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { AuthRequest } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// Cross-Project Reports Controller — التقارير الشاملة
// Aggregated analytics across all user projects
// ═══════════════════════════════════════════════════════════════

// GET /api/reports/global — Global KPIs across all projects
export const getGlobalReport = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const pool = getPool();
    const userId = req.user.id;

    // Projects summary with financials
    const projectsResult = await pool.query(`
      WITH proj_financials AS (
        SELECT 
          p.id,
          p.objet,
          p.marche_no,
          p.commune,
          p.societe,
          p.montant,
          p.status,
          p.progress,
          p.delais_execution,
          p.osc,
          p.achevement_travaux,
          p.created_at,
          COALESCE((
            SELECT SUM(b.montant_total) FROM bordereaux b 
            WHERE b.project_id = p.id AND b.deleted_at IS NULL
          ), 0) as bordereau_total,
          COALESCE((
            SELECT d.montant_cumule FROM decompts d 
            WHERE d.project_id = p.id AND d.deleted_at IS NULL 
            ORDER BY d.numero DESC LIMIT 1
          ), 0) as montant_realise,
          COALESCE((
            SELECT d.total_ttc FROM decompts d 
            WHERE d.project_id = p.id AND d.deleted_at IS NULL 
            ORDER BY d.numero DESC LIMIT 1
          ), 0) as dernier_ttc,
          COALESCE((
            SELECT COUNT(*) FROM decompts d 
            WHERE d.project_id = p.id AND d.deleted_at IS NULL
          ), 0) as nb_decompts,
          COALESCE((
            SELECT COUNT(*) FROM avenants a 
            WHERE a.project_id = p.id AND a.deleted_at IS NULL
          ), 0) as nb_avenants,
          COALESCE((
            SELECT SUM(a.montant_avenant) FROM avenants a 
            WHERE a.project_id = p.id AND a.deleted_at IS NULL AND a.statut != 'rejete'
          ), 0) as montant_avenants,
          COALESCE((
            SELECT COUNT(*) FROM penalties pen 
            WHERE pen.project_id = p.id AND pen.deleted_at IS NULL AND pen.statut != 'annulee'
          ), 0) as nb_penalites,
          COALESCE((
            SELECT SUM(pen.montant_applique) FROM penalties pen 
            WHERE pen.project_id = p.id AND pen.deleted_at IS NULL AND pen.statut != 'annulee'
          ), 0) as montant_penalites,
          COALESCE((
            SELECT COUNT(*) FROM ordres_service os 
            WHERE os.project_id = p.id AND os.deleted_at IS NULL
          ), 0) as nb_ods
        FROM projects p
        WHERE p.user_id = $1 AND p.deleted_at IS NULL
        ORDER BY p.updated_at DESC
      )
      SELECT * FROM proj_financials
    `, [userId]);

    const projects = projectsResult.rows.map(keysToCamel);

    // Global aggregates
    const totalBudget = projects.reduce((s: number, p: any) => s + (Number(p.montant) || 0), 0);
    const totalRealise = projects.reduce((s: number, p: any) => s + (Number(p.montantRealise) || 0), 0);
    const totalAvenants = projects.reduce((s: number, p: any) => s + (Number(p.montantAvenants) || 0), 0);
    const totalPenalites = projects.reduce((s: number, p: any) => s + (Number(p.montantPenalites) || 0), 0);
    const activeCount = projects.filter((p: any) => p.status === 'active' || p.status === 'en_cours').length;
    const completedCount = projects.filter((p: any) => p.status === 'completed' || p.status === 'termine').length;

    // Monthly spending trend (last 12 months)
    const trendResult = await pool.query(`
      SELECT 
        TO_CHAR(d.date_decompte, 'YYYY-MM') as mois,
        SUM(d.montant_actuel) as montant_mois,
        COUNT(d.id) as nb_decompts
      FROM decompts d
      INNER JOIN projects p ON d.project_id = p.id
      WHERE p.user_id = $1 AND p.deleted_at IS NULL AND d.deleted_at IS NULL
        AND d.date_decompte >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(d.date_decompte, 'YYYY-MM')
      ORDER BY mois
    `, [userId]);

    // Status distribution
    const statusDist = projects.reduce((acc: Record<string, number>, p: any) => {
      const s = p.status || 'draft';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    // Budget distribution (top projects by montant)
    const budgetDistribution = projects
      .filter((p: any) => Number(p.montant) > 0)
      .sort((a: any, b: any) => Number(b.montant) - Number(a.montant))
      .slice(0, 10)
      .map((p: any) => ({
        id: p.id,
        objet: p.objet,
        marcheNo: p.marcheNo,
        montant: Number(p.montant),
        realise: Number(p.montantRealise),
        avancement: Number(p.montant) > 0
          ? Math.round((Number(p.montantRealise) / Number(p.montant)) * 10000) / 100
          : 0,
      }));

    res.json({
      success: true,
      data: {
        globalStats: {
          totalProjects: projects.length,
          activeProjects: activeCount,
          completedProjects: completedCount,
          totalBudget,
          totalRealise,
          totalAvenants,
          totalPenalites,
          tauxRealisation: totalBudget > 0
            ? Math.round((totalRealise / totalBudget) * 10000) / 100
            : 0,
          totalDecomptes: projects.reduce((s: number, p: any) => s + (Number(p.nbDecomptes) || 0), 0),
          totalODS: projects.reduce((s: number, p: any) => s + (Number(p.nbOds) || 0), 0),
        },
        projects,
        monthlyTrend: trendResult.rows.map(keysToCamel),
        statusDistribution: statusDist,
        budgetDistribution,
      },
    });
  } catch (error) {
    logger.error('Error in global report:', error);
    next(error);
  }
};

// GET /api/reports/financial — Detailed financial comparison
export const getFinancialReport = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const pool = getPool();

    const result = await pool.query(`
      SELECT 
        p.id,
        p.objet,
        p.marche_no,
        p.montant as montant_marche,
        COALESCE(SUM(DISTINCT b.montant_total), 0) as total_bordereaux,
        COALESCE((
          SELECT d.montant_cumule FROM decompts d 
          WHERE d.project_id = p.id AND d.deleted_at IS NULL 
          ORDER BY d.numero DESC LIMIT 1
        ), 0) as montant_cumule,
        COALESCE((
          SELECT d.total_ttc FROM decompts d 
          WHERE d.project_id = p.id AND d.deleted_at IS NULL 
          ORDER BY d.numero DESC LIMIT 1
        ), 0) as total_ttc,
        COALESCE((
          SELECT SUM(a.montant_avenant) FROM avenants a 
          WHERE a.project_id = p.id AND a.deleted_at IS NULL AND a.statut != 'rejete'
        ), 0) as total_avenants,
        COALESCE((
          SELECT SUM(pen.montant_applique) FROM penalties pen 
          WHERE pen.project_id = p.id AND pen.deleted_at IS NULL AND pen.statut != 'annulee'
        ), 0) as total_penalites,
        p.montant + COALESCE((
          SELECT SUM(a.montant_avenant) FROM avenants a 
          WHERE a.project_id = p.id AND a.deleted_at IS NULL AND a.statut != 'rejete'
        ), 0) as montant_actualise
      FROM projects p
      LEFT JOIN bordereaux b ON b.project_id = p.id AND b.deleted_at IS NULL
      WHERE p.user_id = $1 AND p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY p.montant DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
    });
  } catch (error) {
    logger.error('Error in financial report:', error);
    next(error);
  }
};

// GET /api/reports/deadlines — Deadline tracking across projects
export const getDeadlinesReport = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const pool = getPool();

    const result = await pool.query(`
      SELECT 
        p.id,
        p.objet,
        p.marche_no,
        p.societe,
        p.osc as date_commencement,
        p.delais_execution,
        p.achevement_travaux,
        p.date_reception_provisoire,
        p.date_reception_definitive,
        p.status,
        p.arrets,
        CASE 
          WHEN p.osc IS NOT NULL AND p.delais_execution IS NOT NULL THEN
            p.osc + (p.delais_execution * 30 || ' days')::interval
          ELSE NULL
        END as date_fin_prevue,
        CASE 
          WHEN p.osc IS NOT NULL AND p.delais_execution IS NOT NULL THEN
            EXTRACT(DAY FROM 
              (p.osc + (p.delais_execution * 30 || ' days')::interval) - NOW()
            )
          ELSE NULL
        END as jours_restants,
        COALESCE((
          SELECT COUNT(*) FROM ordres_service os 
          WHERE os.project_id = p.id AND os.type = 'arret' AND os.deleted_at IS NULL
        ), 0) as nb_arrets,
        COALESCE((
          SELECT SUM(os.delai_jours) FROM ordres_service os 
          WHERE os.project_id = p.id AND os.type IN ('prolongation','arret') AND os.deleted_at IS NULL
        ), 0) as jours_supplementaires
      FROM projects p
      WHERE p.user_id = $1 AND p.deleted_at IS NULL
      ORDER BY 
        p.marche_no ASC NULLS LAST
    `, [req.user.id]);

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
    });
  } catch (error) {
    logger.error('Error in deadlines report:', error);
    next(error);
  }
};

// GET /api/reports/activity — Recent activity across all projects
export const getActivityReport = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const pool = getPool();

    // Last 50 activities across projects (decompts, avenants, ODS, penalties)
    const result = await pool.query(`
      (
        SELECT 
          'decompt' as type,
          d.id,
          p.objet as project_name,
          p.id as project_id,
          'Décompte N°' || d.numero as description,
          d.montant_actuel::text as montant,
          d.statut as statut,
          d.created_at
        FROM decompts d
        INNER JOIN projects p ON d.project_id = p.id
        WHERE p.user_id = $1 AND p.deleted_at IS NULL AND d.deleted_at IS NULL
        ORDER BY d.created_at DESC LIMIT 15
      )
      UNION ALL
      (
        SELECT 
          'avenant' as type,
          a.id,
          p.objet,
          p.id,
          'Avenant N°' || a.numero || ' — ' || a.objet,
          a.montant_avenant::text,
          a.statut,
          a.created_at
        FROM avenants a
        INNER JOIN projects p ON a.project_id = p.id
        WHERE p.user_id = $1 AND p.deleted_at IS NULL AND a.deleted_at IS NULL
        ORDER BY a.created_at DESC LIMIT 10
      )
      UNION ALL
      (
        SELECT 
          'ods' as type,
          os.id,
          p.objet,
          p.id,
          os.reference || ' — ' || os.objet,
          os.impact_financier::text,
          os.statut,
          os.created_at
        FROM ordres_service os
        INNER JOIN projects p ON os.project_id = p.id
        WHERE p.user_id = $1 AND p.deleted_at IS NULL AND os.deleted_at IS NULL
        ORDER BY os.created_at DESC LIMIT 10
      )
      UNION ALL
      (
        SELECT 
          'penalite' as type,
          pen.id,
          p.objet,
          p.id,
          pen.type || ' — ' || COALESCE(pen.motif, ''),
          pen.montant_applique::text,
          pen.statut,
          pen.created_at
        FROM penalties pen
        INNER JOIN projects p ON pen.project_id = p.id
        WHERE p.user_id = $1 AND p.deleted_at IS NULL AND pen.deleted_at IS NULL
        ORDER BY pen.created_at DESC LIMIT 10
      )
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.user.id]);

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
    });
  } catch (error) {
    logger.error('Error in activity report:', error);
    next(error);
  }
};
