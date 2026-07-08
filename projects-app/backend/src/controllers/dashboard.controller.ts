/**
 * Dashboard Controller — Phase 2
 * 
 * Aggregated endpoint to replace N+1 API calls from DashboardPage & ProjectsPage.
 * Single query returns all project summaries with budget/progress pre-computed.
 */

import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { AuthRequest } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import logger from '../utils/logger';

/**
 * GET /api/dashboard/summary
 * Returns aggregated dashboard data in a single query:
 *  - Project list with budget/realized/progress
 *  - Global stats (total projects, total budget, average progress)
 *
 * Replaces: N * getBordereaux() + N * getDecompts() calls
 */
export const getDashboardSummary = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const pool = getPool();

    // Single query: projects + latest bordereau montant + latest decompt
    const result = await pool.query(`
      WITH project_bordereaux AS (
        SELECT 
          b.project_id,
          COALESCE(SUM(b.montant_total), 0) as bordereau_total,
          COUNT(b.id) as bordereau_count
        FROM bordereaux b
        WHERE b.deleted_at IS NULL
        GROUP BY b.project_id
      ),
      project_decompts AS (
        SELECT 
          d.project_id,
          COUNT(d.id) as decompt_count,
          MAX(d.numero) as last_decompt_numero,
          -- Get the latest decompt's total  
          (SELECT COALESCE(
            d2.total_general_ttc, 
            d2.total_ttc, 
            d2.montant_cumule, 
            0
          ) FROM decompts d2 
           WHERE d2.project_id = d.project_id 
           AND d2.deleted_at IS NULL
           ORDER BY d2.numero DESC LIMIT 1
          ) as derniere_situation
        FROM decompts d
        WHERE d.deleted_at IS NULL
        GROUP BY d.project_id
      ),
      project_periodes AS (
        SELECT 
          p.project_id,
          COUNT(p.id) as periode_count
        FROM periodes p
        WHERE p.deleted_at IS NULL
        GROUP BY p.project_id
      )
      SELECT 
        p.id,
        p.objet,
        p.marche_no as "marcheNo",
        p.annee,
        p.montant,
        p.maitre_d_ouvrage as "maitreDOuvrage",
        p.entreprise,
        p.delai,
        p.date_ordre_service as "dateOrdreService",
        p.statut,
        p.taux_tva as "tauxTVA",
        p.taux_retenue as "tauxRetenue",
        p.created_at as "createdAt",
        p.updated_at as "updatedAt",
        COALESCE(pb.bordereau_total, 0) as "bordereauTotal",
        COALESCE(pb.bordereau_count, 0) as "bordereauCount",
        COALESCE(pd.decompt_count, 0) as "decomptCount",
        pd.last_decompt_numero as "lastDecomptNumero",
        COALESCE(pd.derniere_situation, 0) as "derniereSituation",
        COALESCE(pp.periode_count, 0) as "periodeCount",
        CASE 
          WHEN p.montant > 0 THEN 
            ROUND((COALESCE(pd.derniere_situation, 0) / p.montant * 100)::numeric, 2)
          ELSE 0
        END as "progressPercent"
      FROM projects p
      LEFT JOIN project_bordereaux pb ON pb.project_id = p.id
      LEFT JOIN project_decompts pd ON pd.project_id = p.id
      LEFT JOIN project_periodes pp ON pp.project_id = p.id
      WHERE p.user_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
    `, [req.user.id]);

    const projects = result.rows;

    // Compute global stats
    const totalBudget = projects.reduce((s, p) => s + (Number(p.montant) || 0), 0);
    const totalRealized = projects.reduce((s, p) => s + (Number(p.derniereSituation) || 0), 0);
    const activeProjects = projects.filter(p => p.statut !== 'terminé' && p.statut !== 'completed').length;
    const completedProjects = projects.filter(p => p.statut === 'terminé' || p.statut === 'completed').length;
    const avgProgress = projects.length > 0
      ? projects.reduce((s, p) => s + (Number(p.progressPercent) || 0), 0) / projects.length
      : 0;

    res.json({
      success: true,
      data: {
        stats: {
          totalProjects: projects.length,
          activeProjects,
          completedProjects,
          totalBudget,
          totalRealized,
          averageProgress: Math.round(avgProgress * 100) / 100,
        },
        projects,
      },
    });
  } catch (error) {
    logger.error('Error in dashboard summary:', error);
    next(error);
  }
};
