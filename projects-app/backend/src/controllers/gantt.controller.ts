import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════
// Gantt Planning Controller
// تخطيط المشاريع — Planification des travaux BTP
// ═══════════════════════════════════════════════════════════════

// ─── Helper: verify project ownership ───
async function verifyProject(projectId: string, userId: string) {
  const result = await getPool().query(
    'SELECT id, objet, marche_no FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [projectId, userId]
  );
  return result.rows.length > 0 ? keysToCamel(result.rows[0]) : null;
}

// ═══════════════════════════════════════════════════════════════
// GET TASKS — List all planning tasks for a project
// ═══════════════════════════════════════════════════════════════
export const getTasks = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    // Get all tasks
    const tasksResult = await getPool().query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM planning_tasks c WHERE c.parent_id = t.id) as children_count
       FROM planning_tasks t
       WHERE t.project_id = $1
       ORDER BY t.sort_order, t.date_debut, t.name`,
      [projectId]
    );

    // Get all dependencies
    const depsResult = await getPool().query(
      `SELECT * FROM planning_dependencies WHERE project_id = $1`,
      [projectId]
    );

    // Get project date bounds for timeline
    const projectResult = await getPool().query(
      `SELECT osc, achevement_travaux, delais_execution FROM projects WHERE id = $1`,
      [projectId]
    );

    const tasks = tasksResult.rows.map(keysToCamel);
    const dependencies = depsResult.rows.map(keysToCamel);
    const projectDates = projectResult.rows[0] ? keysToCamel(projectResult.rows[0]) : {};

    res.json({
      success: true,
      data: {
        tasks,
        dependencies,
        projectDates
      }
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// CREATE TASK — Add a new planning task
// ═══════════════════════════════════════════════════════════════
export const createTask = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const {
      projectId, parentId, name, description, type,
      dateDebut, dateFin, progress, color, sortOrder,
      statut, responsable, coutPrevu, coutReel
    } = req.body;

    if (!projectId) throw new ApiError('projectId requis', 400);
    if (!name) throw new ApiError('name requis', 400);
    if (!dateDebut || !dateFin) throw new ApiError('dateDebut et dateFin requis', 400);

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    // If parentId, verify parent exists in same project
    if (parentId) {
      const parentCheck = await getPool().query(
        'SELECT id FROM planning_tasks WHERE id = $1 AND project_id = $2',
        [parentId, projectId]
      );
      if (parentCheck.rows.length === 0) throw new ApiError('Tâche parente non trouvée', 404);
    }

    // Get next sort order if not provided
    let finalSortOrder = sortOrder;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const orderResult = await getPool().query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM planning_tasks WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2',
        [projectId, parentId || null]
      );
      finalSortOrder = orderResult.rows[0].next_order;
    }

    const result = await getPool().query(
      `INSERT INTO planning_tasks 
       (project_id, parent_id, name, description, type, date_debut, date_fin,
        progress, color, sort_order, statut, responsable, cout_prevu, cout_reel, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        projectId, parentId || null, name, description || null,
        type || 'task', dateDebut, dateFin,
        progress || 0, color || null, finalSortOrder,
        statut || 'planifie', responsable || null,
        coutPrevu || 0, coutReel || 0, req.user.id
      ]
    );

    logger.info(`Planning task created: ${name} for project ${projectId}`);

    res.status(201).json({
      success: true,
      data: keysToCamel(result.rows[0])
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// UPDATE TASK — Modify an existing task
// ═══════════════════════════════════════════════════════════════
export const updateTask = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;
    const {
      parentId, name, description, type,
      dateDebut, dateFin, progress, color, sortOrder,
      statut, responsable, coutPrevu, coutReel
    } = req.body;

    // Verify task exists and user owns the project
    const taskCheck = await getPool().query(
      `SELECT t.*, p.user_id FROM planning_tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1`,
      [id]
    );
    if (taskCheck.rows.length === 0) throw new ApiError('Tâche non trouvée', 404);
    if (taskCheck.rows[0].user_id !== req.user.id) throw new ApiError('Accès refusé', 403);

    // Prevent circular parent reference
    if (parentId === id) throw new ApiError('Une tâche ne peut pas être son propre parent', 400);

    const result = await getPool().query(
      `UPDATE planning_tasks SET
        parent_id = COALESCE($2, parent_id),
        name = COALESCE($3, name),
        description = COALESCE($4, description),
        type = COALESCE($5, type),
        date_debut = COALESCE($6, date_debut),
        date_fin = COALESCE($7, date_fin),
        progress = COALESCE($8, progress),
        color = COALESCE($9, color),
        sort_order = COALESCE($10, sort_order),
        statut = COALESCE($11, statut),
        responsable = COALESCE($12, responsable),
        cout_prevu = COALESCE($13, cout_prevu),
        cout_reel = COALESCE($14, cout_reel)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        parentId !== undefined ? (parentId || null) : undefined,
        name || undefined,
        description !== undefined ? description : undefined,
        type || undefined,
        dateDebut || undefined,
        dateFin || undefined,
        progress !== undefined ? progress : undefined,
        color !== undefined ? color : undefined,
        sortOrder !== undefined ? sortOrder : undefined,
        statut || undefined,
        responsable !== undefined ? responsable : undefined,
        coutPrevu !== undefined ? coutPrevu : undefined,
        coutReel !== undefined ? coutReel : undefined
      ]
    );

    logger.info(`Planning task updated: ${id}`);

    res.json({
      success: true,
      data: keysToCamel(result.rows[0])
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// DELETE TASK — Remove a task and its children
// ═══════════════════════════════════════════════════════════════
export const deleteTask = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    // Verify ownership
    const taskCheck = await getPool().query(
      `SELECT t.id, p.user_id FROM planning_tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1`,
      [id]
    );
    if (taskCheck.rows.length === 0) throw new ApiError('Tâche non trouvée', 404);
    if (taskCheck.rows[0].user_id !== req.user.id) throw new ApiError('Accès refusé', 403);

    // Delete task (children cascaded, deps cascaded)
    await getPool().query('DELETE FROM planning_tasks WHERE id = $1', [id]);

    logger.info(`Planning task deleted: ${id}`);

    res.json({ success: true, message: 'Tâche supprimée' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// BATCH UPDATE — Update multiple tasks (drag & drop reorder, dates)
// ═══════════════════════════════════════════════════════════════
export const batchUpdateTasks = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;
    const { tasks } = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new ApiError('tasks array requis', 400);
    }

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      for (const task of tasks) {
        if (!task.id) continue;
        const updates: string[] = [];
        const values: unknown[] = [task.id];
        let paramIndex = 2;

        if (task.dateDebut !== undefined) {
          updates.push(`date_debut = $${paramIndex++}`);
          values.push(task.dateDebut);
        }
        if (task.dateFin !== undefined) {
          updates.push(`date_fin = $${paramIndex++}`);
          values.push(task.dateFin);
        }
        if (task.progress !== undefined) {
          updates.push(`progress = $${paramIndex++}`);
          values.push(task.progress);
        }
        if (task.sortOrder !== undefined) {
          updates.push(`sort_order = $${paramIndex++}`);
          values.push(task.sortOrder);
        }
        if (task.statut !== undefined) {
          updates.push(`statut = $${paramIndex++}`);
          values.push(task.statut);
        }

        if (updates.length > 0) {
          await client.query(
            `UPDATE planning_tasks SET ${updates.join(', ')} WHERE id = $1 AND project_id = $${paramIndex}`,
            [...values, projectId]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Return updated tasks
    const result = await getPool().query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM planning_tasks c WHERE c.parent_id = t.id) as children_count
       FROM planning_tasks t
       WHERE t.project_id = $1
       ORDER BY t.sort_order, t.date_debut`,
      [projectId]
    );

    res.json({
      success: true,
      data: result.rows.map(keysToCamel)
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// DEPENDENCIES — Create dependency
// ═══════════════════════════════════════════════════════════════
export const createDependency = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId, predecessorId, successorId, type, lagDays } = req.body;

    if (!projectId || !predecessorId || !successorId) {
      throw new ApiError('projectId, predecessorId et successorId requis', 400);
    }

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    // Verify both tasks belong to same project
    const taskCheck = await getPool().query(
      `SELECT id FROM planning_tasks WHERE id IN ($1, $2) AND project_id = $3`,
      [predecessorId, successorId, projectId]
    );
    if (taskCheck.rows.length < 2) throw new ApiError('Tâches non trouvées dans ce projet', 404);

    // Prevent self-dependency
    if (predecessorId === successorId) throw new ApiError('Une tâche ne peut pas dépendre d\'elle-même', 400);

    const result = await getPool().query(
      `INSERT INTO planning_dependencies (project_id, predecessor_id, successor_id, type, lag_days)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (predecessor_id, successor_id) DO UPDATE 
       SET type = EXCLUDED.type, lag_days = EXCLUDED.lag_days
       RETURNING *`,
      [projectId, predecessorId, successorId, type || 'FS', lagDays || 0]
    );

    res.status(201).json({
      success: true,
      data: keysToCamel(result.rows[0])
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// DEPENDENCIES — Delete dependency
// ═══════════════════════════════════════════════════════════════
export const deleteDependency = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    // Verify ownership through project
    const depCheck = await getPool().query(
      `SELECT d.id, p.user_id FROM planning_dependencies d
       JOIN projects p ON p.id = d.project_id
       WHERE d.id = $1`,
      [id]
    );
    if (depCheck.rows.length === 0) throw new ApiError('Dépendance non trouvée', 404);
    if (depCheck.rows[0].user_id !== req.user.id) throw new ApiError('Accès refusé', 403);

    await getPool().query('DELETE FROM planning_dependencies WHERE id = $1', [id]);

    res.json({ success: true, message: 'Dépendance supprimée' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// STATS — Get planning statistics for a project
// ═══════════════════════════════════════════════════════════════
export const getStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const stats = await getPool().query(
      `SELECT 
        COUNT(*) as total_tasks,
        COUNT(*) FILTER (WHERE type = 'phase') as total_phases,
        COUNT(*) FILTER (WHERE type = 'lot') as total_lots,
        COUNT(*) FILTER (WHERE type = 'milestone') as total_milestones,
        COUNT(*) FILTER (WHERE statut = 'planifie') as planifiees,
        COUNT(*) FILTER (WHERE statut = 'en_cours') as en_cours,
        COUNT(*) FILTER (WHERE statut = 'termine') as terminees,
        COUNT(*) FILTER (WHERE statut = 'en_retard') as en_retard,
        COUNT(*) FILTER (WHERE statut = 'suspendu') as suspendues,
        COALESCE(AVG(progress), 0) as avg_progress,
        MIN(date_debut) as date_debut_min,
        MAX(date_fin) as date_fin_max,
        COALESCE(SUM(cout_prevu), 0) as total_cout_prevu,
        COALESCE(SUM(cout_reel), 0) as total_cout_reel
       FROM planning_tasks WHERE project_id = $1`,
      [projectId]
    );

    res.json({
      success: true,
      data: keysToCamel(stats.rows[0])
    });
  } catch (error) {
    next(error);
  }
};
