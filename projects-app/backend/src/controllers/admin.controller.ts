import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

const BCRYPT_ROUNDS = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const VALID_ROLES = ['user', 'admin', 'super_admin'];
const VALID_PROJECT_ROLES = ['chef_projet', 'ingenieur', 'conducteur', 'metreur', 'viewer'];

// ═══════════════════════════════════════════════════════════════
// Helper: require admin or super_admin
// ═══════════════════════════════════════════════════════════════
function requireAdmin(req: AuthRequest): void {
  if (!req.user) throw new ApiError('Not authenticated', 401);
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
    throw new ApiError('Not authorized — admin access required', 403);
  }
}

function requireSuperAdmin(req: AuthRequest): void {
  if (!req.user) throw new ApiError('Not authenticated', 401);
  if (req.user.role !== 'super_admin') {
    throw new ApiError('Not authorized — super admin access required', 403);
  }
}

// ═══════════════════════════════════════════════════════════════
// Helper: Record audit log
// ═══════════════════════════════════════════════════════════════
async function auditLog(
  req: AuthRequest,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, any> = {}
): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO audit_logs_server (id, user_id, user_email, action, entity_type, entity_id, details, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        uuidv4(),
        req.user?.id || null,
        req.user?.email || 'system',
        action,
        entityType,
        entityId,
        JSON.stringify(details),
        req.ip || req.socket?.remoteAddress || null,
        req.headers['user-agent'] || null,
      ]
    );
  } catch (err) {
    logger.error('Audit log write failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. ADMIN DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════
export const getAdminStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const pool = getPool();

    const [usersResult, projectsResult, onlineResult, recentLoginsResult] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_active = true) as active,
          COUNT(*) FILTER (WHERE trial_end_date IS NOT NULL AND trial_end_date > NOW()) as trial,
          COUNT(*) FILTER (WHERE trial_end_date IS NOT NULL AND trial_end_date <= NOW()) as expired,
          COUNT(*) FILTER (WHERE role = 'admin') as admins,
          COUNT(*) FILTER (WHERE role = 'super_admin') as super_admins
        FROM users WHERE deleted_at IS NULL
      `),
      pool.query(`SELECT COUNT(*) as total FROM projects WHERE deleted_at IS NULL`),
      pool.query(`
        SELECT COUNT(DISTINCT user_id) as count 
        FROM user_sessions 
        WHERE is_active = true AND last_heartbeat > NOW() - INTERVAL '5 minutes'
      `),
      pool.query(`
        SELECT id, email, first_name, last_name, role, last_login
        FROM users WHERE last_login IS NOT NULL AND deleted_at IS NULL
        ORDER BY last_login DESC LIMIT 10
      `),
    ]);

    const stats = usersResult.rows[0];
    res.json({
      success: true,
      data: {
        users: {
          total: parseInt(stats.total),
          active: parseInt(stats.active),
          trial: parseInt(stats.trial),
          expired: parseInt(stats.expired),
          admins: parseInt(stats.admins),
          superAdmins: parseInt(stats.super_admins),
        },
        projects: {
          total: parseInt(projectsResult.rows[0].total),
        },
        online: parseInt(onlineResult.rows[0].count),
        recentLogins: recentLoginsResult.rows.map((u: any) => ({
          id: u.id,
          email: u.email,
          firstName: u.first_name,
          lastName: u.last_name,
          role: u.role,
          lastLogin: u.last_login,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// 2. GET ALL USERS (with extra details)
// ═══════════════════════════════════════════════════════════════
export const getAllUsersAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const pool = getPool();

    const result = await pool.query(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
        u.trial_end_date, u.created_by, u.created_at, u.last_login,
        u.job_title, u.phone, u.avatar_url, u.department,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.user_id = u.id) as project_count,
        (
          SELECT CASE WHEN EXISTS(
            SELECT 1 FROM user_sessions us 
            WHERE us.user_id = u.id AND us.is_active = true 
              AND us.last_heartbeat > NOW() - INTERVAL '5 minutes'
          ) THEN true ELSE false END
        ) as is_online
      FROM users u
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at DESC
    `);

    const users = result.rows.map((u: any) => ({
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      role: u.role,
      isActive: u.is_active,
      trialEndDate: u.trial_end_date,
      createdBy: u.created_by,
      createdAt: u.created_at,
      lastLogin: u.last_login,
      jobTitle: u.job_title,
      phone: u.phone,
      avatarUrl: u.avatar_url,
      department: u.department,
      projectCount: parseInt(u.project_count),
      isOnline: u.is_online,
    }));

    res.json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// 3. CREATE USER (Admin)
// ═══════════════════════════════════════════════════════════════
export const createUserAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const { email, password, firstName, lastName, role, trialEndDate, jobTitle, phone, department } = req.body;

    // Validations
    if (!email || !password || !firstName || !lastName) {
      throw new ApiError('Email, password, first name and last name are required', 400);
    }
    if (!EMAIL_REGEX.test(email)) throw new ApiError('Invalid email format', 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    const userRole = role || 'user';
    if (!VALID_ROLES.includes(userRole)) {
      throw new ApiError(`Invalid role. Allowed: ${VALID_ROLES.join(', ')}`, 400);
    }
    if ((userRole === 'admin' || userRole === 'super_admin') && req.user!.role !== 'super_admin') {
      throw new ApiError('Only super_admin can create admin accounts', 403);
    }

    const pool = getPool();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) throw new ApiError('Email already registered', 400);

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = uuidv4();

    const result = await pool.query(
      `INSERT INTO users (id, email, password, first_name, last_name, role, is_active, trial_end_date, created_by, job_title, phone, department, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING id, email, first_name, last_name, role, is_active, trial_end_date, job_title, phone, department, created_at`,
      [userId, email.toLowerCase().trim(), hashedPassword, firstName.trim(), lastName.trim(), userRole, trialEndDate || null, req.user!.id, jobTitle || null, phone || null, department || null]
    );

    const user = result.rows[0];

    await auditLog(req, 'user.create', 'user', userId, {
      email: user.email,
      role: userRole,
      createdBy: req.user!.email,
    });

    res.status(201).json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
        trialEndDate: user.trial_end_date,
        jobTitle: user.job_title,
        phone: user.phone,
        department: user.department,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// 4. UPDATE USER (Admin)
// ═══════════════════════════════════════════════════════════════
export const updateUserAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const { id } = req.params;
    const { firstName, lastName, role, isActive, trialEndDate, password, jobTitle, phone, department } = req.body;

    const pool = getPool();
    const updates: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let paramIndex = 1;

    if (firstName !== undefined) { updates.push(`first_name = $${paramIndex++}`); values.push(firstName.trim()); }
    if (lastName !== undefined) { updates.push(`last_name = $${paramIndex++}`); values.push(lastName.trim()); }
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) throw new ApiError('Invalid role', 400);
      if ((role === 'admin' || role === 'super_admin') && req.user!.role !== 'super_admin') {
        throw new ApiError('Only super_admin can assign admin roles', 403);
      }
      updates.push(`role = $${paramIndex++}`); values.push(role);
    }
    if (typeof isActive === 'boolean') { updates.push(`is_active = $${paramIndex++}`); values.push(isActive); }
    if (trialEndDate !== undefined) { updates.push(`trial_end_date = $${paramIndex++}`); values.push(trialEndDate); }
    if (password) {
      if (password.length < MIN_PASSWORD_LENGTH) throw new ApiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
      updates.push(`password = $${paramIndex++}`); values.push(await bcrypt.hash(password, BCRYPT_ROUNDS));
    }
    if (jobTitle !== undefined) { updates.push(`job_title = $${paramIndex++}`); values.push(jobTitle); }
    if (phone !== undefined) { updates.push(`phone = $${paramIndex++}`); values.push(phone); }
    if (department !== undefined) { updates.push(`department = $${paramIndex++}`); values.push(department); }

    if (values.length === 0) throw new ApiError('No fields to update', 400);

    values.push(id);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL
       RETURNING id, email, first_name, last_name, role, is_active, trial_end_date, job_title, phone, department`,
      values
    );

    if (result.rows.length === 0) throw new ApiError('User not found', 404);
    const user = result.rows[0];

    await auditLog(req, 'user.update', 'user', id, {
      email: user.email,
      changes: req.body,
      updatedBy: req.user!.email,
    });

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        isActive: user.is_active,
        trialEndDate: user.trial_end_date,
        jobTitle: user.job_title,
        phone: user.phone,
        department: user.department,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// 5. DELETE USER (Soft delete — Super Admin only)
// ═══════════════════════════════════════════════════════════════
export const deleteUserAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireSuperAdmin(req);
    const { id } = req.params;
    if (id === req.user!.id) throw new ApiError('Cannot delete yourself', 400);

    const pool = getPool();
    const result = await pool.query(
      `UPDATE users SET deleted_at = NOW(), is_active = false, updated_at = NOW() 
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, email`,
      [id]
    );

    if (result.rows.length === 0) throw new ApiError('User not found', 404);

    // Also remove from all project memberships
    await pool.query('DELETE FROM project_members WHERE user_id = $1', [id]);
    // Close all sessions
    await pool.query('UPDATE user_sessions SET is_active = false, disconnected_at = NOW() WHERE user_id = $1', [id]);

    await auditLog(req, 'user.delete', 'user', id, {
      email: result.rows[0].email,
      deletedBy: req.user!.email,
    });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// 6. PROJECT MEMBERS
// ═══════════════════════════════════════════════════════════════
export const getProjectMembers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const { projectId } = req.params;
    const pool = getPool();

    const result = await pool.query(`
      SELECT pm.*, u.email, u.first_name, u.last_name, u.role as user_role, u.job_title, u.avatar_url,
        (SELECT CASE WHEN EXISTS(
          SELECT 1 FROM user_sessions us 
          WHERE us.user_id = pm.user_id AND us.is_active = true 
            AND us.last_heartbeat > NOW() - INTERVAL '5 minutes'
        ) THEN true ELSE false END) as is_online
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY pm.assigned_at DESC
    `, [projectId]);

    res.json({
      success: true,
      data: result.rows.map((r: any) => ({
        id: r.id,
        projectId: r.project_id,
        userId: r.user_id,
        role: r.role,
        permissions: r.permissions,
        assignedAt: r.assigned_at,
        user: {
          email: r.email,
          firstName: r.first_name,
          lastName: r.last_name,
          role: r.user_role,
          jobTitle: r.job_title,
          avatarUrl: r.avatar_url,
          isOnline: r.is_online,
        },
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const setProjectMember = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const { projectId } = req.params;
    const { userId, role, permissions } = req.body;

    if (!userId || !role) throw new ApiError('userId and role are required', 400);
    if (!VALID_PROJECT_ROLES.includes(role)) {
      throw new ApiError(`Invalid project role. Allowed: ${VALID_PROJECT_ROLES.join(', ')}`, 400);
    }

    const pool = getPool();

    // Upsert
    const result = await pool.query(`
      INSERT INTO project_members (id, project_id, user_id, role, permissions, assigned_by, assigned_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (project_id, user_id) 
      DO UPDATE SET role = $4, permissions = $5, assigned_by = $6, assigned_at = NOW()
      RETURNING *
    `, [uuidv4(), projectId, userId, role, JSON.stringify(permissions || {}), req.user!.id]);

    await auditLog(req, 'project.member.set', 'project_member', result.rows[0].id, {
      projectId,
      userId,
      role,
      assignedBy: req.user!.email,
    });

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

export const removeProjectMember = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const { projectId, userId } = req.params;
    const pool = getPool();

    const result = await pool.query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING id',
      [projectId, userId]
    );

    if (result.rows.length === 0) throw new ApiError('Member not found', 404);

    await auditLog(req, 'project.member.remove', 'project_member', result.rows[0].id, {
      projectId,
      userId,
      removedBy: req.user!.email,
    });

    res.json({ success: true, message: 'Member removed' });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// 7. AUDIT LOGS
// ═══════════════════════════════════════════════════════════════
export const getAuditLogs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requireAdmin(req);
    const pool = getPool();
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const action = req.query.action as string;

    let whereClause = '';
    const params: any[] = [limit, offset];
    if (action) {
      whereClause = `WHERE a.action LIKE $3`;
      params.push(`%${action}%`);
    }

    const result = await pool.query(`
      SELECT a.*, u.first_name, u.last_name
      FROM audit_logs_server a
      LEFT JOIN users u ON u.id = a.user_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM audit_logs_server a ${whereClause}
    `, action ? [`%${action}%`] : []);

    res.json({
      success: true,
      data: result.rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        userEmail: r.user_email,
        userName: r.first_name ? `${r.first_name} ${r.last_name}` : null,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        details: r.details,
        ipAddress: r.ip_address,
        createdAt: r.created_at,
      })),
      pagination: {
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// 8. ONLINE USERS (Real-time Presence)
// ═══════════════════════════════════════════════════════════════
export const getOnlineUsers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const pool = getPool();

    const result = await pool.query(`
      SELECT DISTINCT ON (us.user_id)
        us.user_id, us.current_page, us.current_project_id, us.current_activity,
        us.last_heartbeat, us.connected_at,
        u.email, u.first_name, u.last_name, u.role, u.avatar_url, u.job_title,
        p.objet as project_name
      FROM user_sessions us
      JOIN users u ON u.id = us.user_id
      LEFT JOIN projects p ON p.id = us.current_project_id
      WHERE us.is_active = true 
        AND us.last_heartbeat > NOW() - INTERVAL '5 minutes'
      ORDER BY us.user_id, us.last_heartbeat DESC
    `);

    res.json({
      success: true,
      data: result.rows.map((r: any) => ({
        userId: r.user_id,
        email: r.email,
        firstName: r.first_name,
        lastName: r.last_name,
        role: r.role,
        avatarUrl: r.avatar_url,
        jobTitle: r.job_title,
        currentPage: r.current_page,
        currentProjectId: r.current_project_id,
        currentProjectName: r.project_name,
        currentActivity: r.current_activity,
        lastHeartbeat: r.last_heartbeat,
        connectedAt: r.connected_at,
      })),
    });
  } catch (error) {
    next(error);
  }
};
