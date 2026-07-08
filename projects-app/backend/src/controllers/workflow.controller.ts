/**
 * Workflow Controller — Approval & Visa Circuit Management
 * نظام سير عمل الموافقات والتأشيرات
 * 
 * Endpoints:
 *   - POST   /                           → Create approval request
 *   - GET    /project/:projectId          → Get requests by project
 *   - GET    /pending                     → Get all pending approvals for user
 *   - GET    /:id                         → Get request detail with steps & history
 *   - POST   /:id/approve                 → Approve current step
 *   - POST   /:id/reject                  → Reject current step  
 *   - POST   /:id/cancel                  → Cancel request
 *   - GET    /stats/summary               → Get approval stats summary
 *
 * Workflow Templates:
 *   - POST   /workflows                   → Create workflow template
 *   - GET    /workflows/project/:projectId → Get workflow templates
 *   - DELETE /workflows/:id               → Delete workflow template
 */

import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════
// CREATE APPROVAL REQUEST
// ═══════════════════════════════════════════════════════════════════════
export const createApprovalRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const client = await getPool().connect();
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const {
      projectId, documentType, documentId, documentReference,
      priority, dueDate, note, montant, steps
    } = req.body;

    if (!projectId || !documentType || !documentId) {
      throw new ApiError('projectId, documentType, and documentId are required', 400);
    }

    // Validate project ownership
    const projectCheck = await client.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );
    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    await client.query('BEGIN');

    // Build steps array (use provided steps or default single-step)
    const approvalSteps = steps && steps.length > 0
      ? steps
      : [{ stepOrder: 1, stepLabel: 'Validation', role: 'responsable' }];

    // Create the request
    const result = await client.query(
      `INSERT INTO approval_requests 
        (user_id, project_id, document_type, document_id, document_reference,
         status, current_step, total_steps, priority, due_date, note, montant)
       VALUES ($1, $2, $3, $4, $5, 'en_attente', 1, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        req.user.id, projectId, documentType, documentId,
        documentReference || null,
        approvalSteps.length,
        priority || 'normal',
        dueDate || null,
        note || null,
        montant || null,
      ]
    );

    const request = result.rows[0];

    // Create approval steps
    for (const step of approvalSteps) {
      await client.query(
        `INSERT INTO approval_steps 
          (request_id, step_order, step_label, role, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          request.id,
          step.stepOrder || step.step_order || 1,
          step.stepLabel || step.step_label || 'Validation',
          step.role || 'responsable',
          step.stepOrder === 1 || step.step_order === 1 ? 'en_cours' : 'en_attente',
        ]
      );
    }

    // Create history entry
    await client.query(
      `INSERT INTO approval_history 
        (request_id, action, actor_id, actor_name, comment)
       VALUES ($1, 'submitted', $2, $3, $4)`,
      [request.id, req.user.id, `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email, note || null]
    );

    await client.query('COMMIT');

    // Fetch complete request with steps
    const fullRequest = await getFullRequest(request.id);

    logger.info('Approval request created', {
      requestId: request.id,
      documentType,
      documentId,
      userId: req.user.id,
    });

    res.status(201).json({
      success: true,
      data: fullRequest,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════
// GET APPROVAL REQUESTS BY PROJECT
// ═══════════════════════════════════════════════════════════════════════
export const getRequestsByProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const { status, documentType } = req.query;

    let query = `
      SELECT ar.*, 
        (SELECT COUNT(*) FROM approval_steps WHERE request_id = ar.id AND status = 'approuve') as approved_count,
        (SELECT json_agg(json_build_object(
          'id', s.id, 'stepOrder', s.step_order, 'stepLabel', s.step_label,
          'role', s.role, 'status', s.status, 'decidedByName', s.decided_by_name,
          'decisionDate', s.decision_date, 'comment', s.comment
        ) ORDER BY s.step_order) FROM approval_steps s WHERE s.request_id = ar.id) as steps
      FROM approval_requests ar
      WHERE ar.project_id = $1 AND ar.user_id = $2 AND ar.deleted_at IS NULL
    `;
    const params: any[] = [projectId, req.user.id];
    let paramIndex = 3;

    if (status) {
      query += ` AND ar.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (documentType) {
      query += ` AND ar.document_type = $${paramIndex}`;
      params.push(documentType);
      paramIndex++;
    }

    query += ' ORDER BY ar.created_at DESC';

    const result = await getPool().query(query, params);

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// GET PENDING APPROVALS (Cross-project dashboard)
// ═══════════════════════════════════════════════════════════════════════
export const getPendingApprovals = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const result = await getPool().query(
      `SELECT ar.*, 
        p.objet as project_name, p.marche_no,
        (SELECT json_agg(json_build_object(
          'id', s.id, 'stepOrder', s.step_order, 'stepLabel', s.step_label,
          'role', s.role, 'status', s.status
        ) ORDER BY s.step_order) FROM approval_steps s WHERE s.request_id = ar.id) as steps
       FROM approval_requests ar
       JOIN projects p ON p.id = ar.project_id
       WHERE ar.user_id = $1 
         AND ar.status IN ('en_attente', 'en_cours')
         AND ar.deleted_at IS NULL
       ORDER BY 
         CASE ar.priority 
           WHEN 'urgente' THEN 1 
           WHEN 'haute' THEN 2 
           WHEN 'normal' THEN 3 
           WHEN 'basse' THEN 4 
         END,
         ar.submitted_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// GET REQUEST DETAIL
// ═══════════════════════════════════════════════════════════════════════
export const getRequestById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const fullRequest = await getFullRequest(id);

    if (!fullRequest) {
      throw new ApiError('Approval request not found', 404);
    }

    // Check ownership
    if (fullRequest.userId !== req.user.id) {
      throw new ApiError('Not authorized to view this request', 403);
    }

    res.json({
      success: true,
      data: fullRequest,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// APPROVE CURRENT STEP
// ═══════════════════════════════════════════════════════════════════════
export const approveStep = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const client = await getPool().connect();
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { comment, conditions } = req.body;

    // Get the request
    const reqResult = await client.query(
      'SELECT * FROM approval_requests WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (reqResult.rows.length === 0) {
      throw new ApiError('Approval request not found', 404);
    }

    const request = reqResult.rows[0];

    if (request.user_id !== req.user.id) {
      throw new ApiError('Not authorized', 403);
    }

    if (request.status === 'approuve' || request.status === 'annule') {
      throw new ApiError('Request already finalized', 400);
    }

    await client.query('BEGIN');

    // Get current step
    const stepResult = await client.query(
      `SELECT * FROM approval_steps 
       WHERE request_id = $1 AND step_order = $2`,
      [id, request.current_step]
    );

    if (stepResult.rows.length === 0) {
      throw new ApiError('Current step not found', 400);
    }

    const step = stepResult.rows[0];

    // Update step
    await client.query(
      `UPDATE approval_steps 
       SET status = 'approuve', decided_by = $1, decided_by_name = $2,
           decision_date = NOW(), comment = $3, conditions = $4, updated_at = NOW()
       WHERE id = $5`,
      [req.user.id, `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email, comment || null, conditions || null, step.id]
    );

    // Check if all steps are done
    const isLastStep = request.current_step >= request.total_steps;

    if (isLastStep) {
      // All steps approved → mark request as approved
      await client.query(
        `UPDATE approval_requests 
         SET status = 'approuve', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
    } else {
      // Move to next step
      const nextStep = request.current_step + 1;
      await client.query(
        `UPDATE approval_requests 
         SET current_step = $1, status = 'en_cours', updated_at = NOW()
         WHERE id = $2`,
        [nextStep, id]
      );

      // Activate next step
      await client.query(
        `UPDATE approval_steps 
         SET status = 'en_cours', updated_at = NOW()
         WHERE request_id = $1 AND step_order = $2`,
        [id, nextStep]
      );
    }

    // History
    await client.query(
      `INSERT INTO approval_history 
        (request_id, step_id, action, actor_id, actor_name, comment, metadata)
       VALUES ($1, $2, 'approved', $3, $4, $5, $6)`,
      [
        id, step.id, req.user.id, `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
        comment || null,
        JSON.stringify({ stepOrder: request.current_step, stepLabel: step.step_label }),
      ]
    );

    await client.query('COMMIT');

    const fullRequest = await getFullRequest(id);

    logger.info('Approval step approved', {
      requestId: id,
      stepOrder: request.current_step,
      isLastStep,
      userId: req.user.id,
    });

    res.json({
      success: true,
      data: fullRequest,
      message: isLastStep ? 'Demande approuvée' : `Étape ${request.current_step} validée`,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════
// REJECT CURRENT STEP
// ═══════════════════════════════════════════════════════════════════════
export const rejectStep = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const client = await getPool().connect();
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { comment, returnToStep } = req.body;

    if (!comment) {
      throw new ApiError('Un commentaire est requis pour le rejet', 400);
    }

    const reqResult = await client.query(
      'SELECT * FROM approval_requests WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    if (reqResult.rows.length === 0) {
      throw new ApiError('Approval request not found', 404);
    }

    const request = reqResult.rows[0];

    if (request.user_id !== req.user.id) {
      throw new ApiError('Not authorized', 403);
    }

    if (request.status === 'approuve' || request.status === 'annule') {
      throw new ApiError('Request already finalized', 400);
    }

    await client.query('BEGIN');

    // Get current step
    const stepResult = await client.query(
      `SELECT * FROM approval_steps 
       WHERE request_id = $1 AND step_order = $2`,
      [id, request.current_step]
    );

    if (stepResult.rows.length > 0) {
      const step = stepResult.rows[0];

      // Mark step as rejected
      await client.query(
        `UPDATE approval_steps 
         SET status = 'rejete', decided_by = $1, decided_by_name = $2,
             decision_date = NOW(), comment = $3, updated_at = NOW()
         WHERE id = $4`,
        [req.user.id, `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email, comment, step.id]
      );

      // History
      await client.query(
        `INSERT INTO approval_history 
          (request_id, step_id, action, actor_id, actor_name, comment, metadata)
         VALUES ($1, $2, 'rejected', $3, $4, $5, $6)`,
        [
          id, step.id, req.user.id, `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email,
          comment,
          JSON.stringify({ stepOrder: request.current_step, stepLabel: step.step_label, returnToStep }),
        ]
      );
    }

    if (returnToStep && returnToStep > 0 && returnToStep < request.current_step) {
      // Return to a previous step instead of full rejection
      await client.query(
        `UPDATE approval_requests 
         SET current_step = $1, status = 'en_cours', updated_at = NOW()
         WHERE id = $2`,
        [returnToStep, id]
      );

      // Reset steps from returnToStep onwards
      await client.query(
        `UPDATE approval_steps 
         SET status = CASE WHEN step_order = $1 THEN 'en_cours' ELSE 'en_attente' END,
             decided_by = NULL, decided_by_name = NULL, decision_date = NULL,
             comment = NULL, updated_at = NOW()
         WHERE request_id = $2 AND step_order >= $1`,
        [returnToStep, id]
      );
    } else {
      // Full rejection
      await client.query(
        `UPDATE approval_requests 
         SET status = 'rejete', completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
    }

    await client.query('COMMIT');

    const fullRequest = await getFullRequest(id);

    logger.info('Approval step rejected', {
      requestId: id,
      stepOrder: request.current_step,
      returnToStep,
      userId: req.user.id,
    });

    res.json({
      success: true,
      data: fullRequest,
      message: returnToStep ? `Renvoyé à l'étape ${returnToStep}` : 'Demande rejetée',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════
// CANCEL REQUEST
// ═══════════════════════════════════════════════════════════════════════
export const cancelRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const client = await getPool().connect();
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { reason } = req.body;

    const reqResult = await client.query(
      'SELECT * FROM approval_requests WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (reqResult.rows.length === 0) {
      throw new ApiError('Request not found or not authorized', 404);
    }

    const request = reqResult.rows[0];
    if (request.status === 'approuve') {
      throw new ApiError('Cannot cancel an already approved request', 400);
    }

    await client.query('BEGIN');

    await client.query(
      `UPDATE approval_requests 
       SET status = 'annule', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    await client.query(
      `INSERT INTO approval_history 
        (request_id, action, actor_id, actor_name, comment)
       VALUES ($1, 'cancelled', $2, $3, $4)`,
      [id, req.user.id, `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email, reason || null]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Demande annulée',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};

// ═══════════════════════════════════════════════════════════════════════
// APPROVAL STATS SUMMARY
// ═══════════════════════════════════════════════════════════════════════
export const getApprovalStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const result = await getPool().query(
      `SELECT 
        COUNT(*) FILTER (WHERE status = 'en_attente' OR status = 'en_cours') as pending_count,
        COUNT(*) FILTER (WHERE status = 'approuve') as approved_count,
        COUNT(*) FILTER (WHERE status = 'rejete') as rejected_count,
        COUNT(*) FILTER (WHERE status = 'annule') as cancelled_count,
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE priority = 'urgente' AND status IN ('en_attente', 'en_cours')) as urgent_count,
        COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE AND status IN ('en_attente', 'en_cours')) as overdue_count,
        COALESCE(SUM(montant) FILTER (WHERE status = 'en_attente' OR status = 'en_cours'), 0) as pending_amount,
        COALESCE(SUM(montant) FILTER (WHERE status = 'approuve'), 0) as approved_amount,
        ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - submitted_at)) / 3600) FILTER (WHERE completed_at IS NOT NULL), 1) as avg_hours_to_complete
       FROM approval_requests
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [req.user.id]
    );

    const stats = keysToCamel(result.rows[0]);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// WORKFLOW TEMPLATE CRUD
// ═══════════════════════════════════════════════════════════════════════
export const createWorkflow = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { name, description, documentType, projectId, steps, requireAllSteps, allowParallel } = req.body;

    if (!name || !documentType) {
      throw new ApiError('name and documentType are required', 400);
    }

    const result = await getPool().query(
      `INSERT INTO approval_workflows 
        (user_id, project_id, name, description, document_type, steps, 
         require_all_steps, allow_parallel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.user.id,
        projectId || null,
        name,
        description || null,
        documentType,
        JSON.stringify(steps || []),
        requireAllSteps !== false,
        allowParallel === true,
      ]
    );

    res.status(201).json({
      success: true,
      data: keysToCamel(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

export const getWorkflowsByProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;

    const result = await getPool().query(
      `SELECT * FROM approval_workflows 
       WHERE user_id = $1 AND (project_id = $2 OR project_id IS NULL) 
         AND deleted_at IS NULL AND is_active = true
       ORDER BY created_at DESC`,
      [req.user.id, projectId]
    );

    res.json({
      success: true,
      data: result.rows.map(keysToCamel),
    });
  } catch (error) {
    next(error);
  }
};

export const deleteWorkflow = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;

    await getPool().query(
      `UPDATE approval_workflows SET deleted_at = NOW() WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );

    res.json({ success: true, message: 'Workflow supprimé' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Get full request with steps and history
// ═══════════════════════════════════════════════════════════════════════
async function getFullRequest(requestId: string) {
  const pool = getPool();

  const reqResult = await pool.query(
    `SELECT ar.*, p.objet as project_name, p.marche_no
     FROM approval_requests ar
     LEFT JOIN projects p ON p.id = ar.project_id
     WHERE ar.id = $1`,
    [requestId]
  );

  if (reqResult.rows.length === 0) return null;

  const request = keysToCamel(reqResult.rows[0]);

  // Get steps
  const stepsResult = await pool.query(
    'SELECT * FROM approval_steps WHERE request_id = $1 ORDER BY step_order',
    [requestId]
  );
  request.steps = stepsResult.rows.map(keysToCamel);

  // Get history
  const historyResult = await pool.query(
    'SELECT * FROM approval_history WHERE request_id = $1 ORDER BY created_at DESC',
    [requestId]
  );
  request.history = historyResult.rows.map(keysToCamel);

  return request;
}
