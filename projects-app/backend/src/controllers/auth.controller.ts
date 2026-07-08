import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

// SECURITY: No hardcoded secrets — use env vars with dev-only fallback
const JWT_SECRET: Secret = process.env.JWT_SECRET || 'dev-only-insecure-secret-do-not-use-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // 7 days for better UX
const JWT_REFRESH_SECRET: Secret = process.env.JWT_REFRESH_SECRET || 'dev-only-refresh-secret-do-not-use';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d'; // 30 days refresh

// Cookie maxAge must match JWT_EXPIRES_IN for static file access (images, PDFs, documents)
// Parse JWT_EXPIRES_IN to milliseconds — default 7 days
function parseJwtExpiryToMs(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // fallback 7 days
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}
const COOKIE_MAX_AGE = parseJwtExpiryToMs(JWT_EXPIRES_IN);

// SECURITY: Bcrypt cost factor — 12 is the minimum recommended (was 10)
const BCRYPT_ROUNDS = 12;

// SECURITY: Valid roles whitelist
const VALID_USER_ROLES = ['user', 'admin'] as const;

// Email format validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

const generateToken = (payload: { id: string; email: string; role: string }): string => {
  const options: SignOptions = { expiresIn: JWT_EXPIRES_IN as any };
  return jwt.sign(payload, JWT_SECRET, options);
};

const generateRefreshToken = (payload: { id: string; email: string; role: string }): string => {
  const options: SignOptions = { expiresIn: JWT_REFRESH_EXPIRES_IN as any };
  return jwt.sign(payload, JWT_REFRESH_SECRET, options);
};

/**
 * Register new user (PostgreSQL version)
 */
export const register = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password || !firstName || !lastName) {
      throw new ApiError('All fields are required', 400);
    }

    const pool = getPool();

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      throw new ApiError('Email already registered', 400);
    }

    // Hash password with secure cost factor
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const userId = uuidv4();
    const result = await pool.query(
      `INSERT INTO users (id, email, password, first_name, last_name, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [userId, email.toLowerCase().trim(), hashedPassword, firstName.trim(), lastName.trim(), 'user', true]
    );

    const user = result.rows[0];

    // Generate token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
        },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user (PostgreSQL version)
 */
export const login = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError('Email and password are required', 400);
    }

    const pool = getPool();

    // Find user by email
    const result = await pool.query(
      `SELECT id, email, password, first_name, last_name, role, is_active, 
              trial_end_date, created_by, created_at, last_login
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Invalid credentials', 401);
    }

    const user = result.rows[0];

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new ApiError('Invalid credentials', 401);
    }

    if (!user.is_active) {
      throw new ApiError('Account is disabled', 403);
    }

    // Check trial expiration
    if (user.trial_end_date) {
      const trialEnd = new Date(user.trial_end_date);
      const now = new Date();
      if (trialEnd < now) {
        await pool.query(
          'UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1',
          [user.id]
        );
        throw new ApiError('Your trial period has expired. Please contact the administrator.', 403);
      }
    }

    // Generate token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = NOW(), last_sync = NOW(), updated_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Set auth cookie for static file access (images, documents, PDFs)
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: COOKIE_MAX_AGE, // Must match JWT_EXPIRES_IN (7d = 604800000ms)
      path: '/',
    });

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          isActive: user.is_active,
          trialEndDate: user.trial_end_date,
          createdBy: user.created_by,
          createdAt: user.created_at,
          lastLogin: new Date().toISOString(),
        },
        token,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current user (PostgreSQL version)
 */
export const getCurrentUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, role, last_sync, is_active
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('User not found', 404);
    }

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        lastSync: user.last_sync,
        isActive: user.is_active,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh token
 */
export const refreshToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw new ApiError('Token is required', 400);
    }

    // SECURITY: Verify with JWT_REFRESH_SECRET (was incorrectly using JWT_SECRET)
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as any;

    // Validate user still exists and is active
    const pool = getPool();
    const userCheck = await pool.query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userCheck.rows.length === 0 || !userCheck.rows[0].is_active) {
      throw new ApiError('User no longer active', 401);
    }

    const user = userCheck.rows[0];
    const newToken = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    // Refresh the auth cookie as well
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('auth_token', newToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: COOKIE_MAX_AGE, // Must match JWT_EXPIRES_IN (7d = 604800000ms)
      path: '/',
    });

    res.json({
      success: true,
      data: { token: newToken },
    });
  } catch (error) {
    next(new ApiError('Invalid token', 401));
  }
};

/**
 * Get all users (admin only)
 */
export const getAllUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      throw new ApiError('Not authorized', 403);
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT id, email, first_name, last_name, role, is_active, 
              trial_end_date, created_by, created_at, last_login
       FROM users ORDER BY created_at DESC`
    );

    const users = result.rows.map(user => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      isActive: user.is_active,
      trialEndDate: user.trial_end_date,
      createdBy: user.created_by,
      createdAt: user.created_at,
      lastLogin: user.last_login,
    }));

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create user (admin only)
 */
export const createUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      throw new ApiError('Not authorized', 403);
    }

    const { email, password, firstName, lastName, role, trialEndDate } = req.body;

    if (!email || !password || !firstName || !lastName) {
      throw new ApiError('All fields are required', 400);
    }

    // SECURITY: Validate email format
    if (!EMAIL_REGEX.test(email)) {
      throw new ApiError('Invalid email format', 400);
    }

    // SECURITY: Enforce password strength
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    // SECURITY: Validate role against whitelist
    const userRole = role || 'user';
    if (!VALID_USER_ROLES.includes(userRole as any) && userRole !== 'super_admin') {
      throw new ApiError('Invalid role. Allowed: user, admin', 400);
    }

    // SECURITY: Only super_admin can create admin/super_admin accounts
    if ((userRole === 'admin' || userRole === 'super_admin') && req.user.role !== 'super_admin') {
      throw new ApiError('Only super_admin can create admin accounts', 403);
    }

    const pool = getPool();

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (existingUser.rows.length > 0) {
      throw new ApiError('Email already registered', 400);
    }

    // Hash password with secure cost factor
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // Create user
    const userId = uuidv4();
    const result = await pool.query(
      `INSERT INTO users (id, email, password, first_name, last_name, role, is_active, trial_end_date, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, NOW(), NOW())
       RETURNING id, email, first_name, last_name, role, is_active, trial_end_date, created_at`,
      [userId, email.toLowerCase().trim(), hashedPassword, firstName.trim(), lastName.trim(), userRole, trialEndDate || null, req.user.id]
    );

    const user = result.rows[0];

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
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update user (admin only)
 */
export const updateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      throw new ApiError('Not authorized', 403);
    }

    const { id } = req.params;
    const { firstName, lastName, role, isActive, trialEndDate, password } = req.body;

    const pool = getPool();

    // Build update query dynamically
    const updates: string[] = ['updated_at = NOW()'];
    const values: any[] = [];
    let paramIndex = 1;

    if (firstName) {
      updates.push(`first_name = $${paramIndex++}`);
      values.push(firstName);
    }
    if (lastName) {
      updates.push(`last_name = $${paramIndex++}`);
      values.push(lastName);
    }
    if (role) {
      // PHASE 2: Prevent role escalation — only super_admin can set admin/super_admin
      if ((role === 'admin' || role === 'super_admin') && req.user!.role !== 'super_admin') {
        throw new ApiError('Only super_admin can assign admin roles', 403);
      }
      if (!['user', 'admin', 'super_admin'].includes(role)) {
        throw new ApiError('Invalid role', 400);
      }
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    if (typeof isActive === 'boolean') {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(isActive);
    }
    if (trialEndDate !== undefined) {
      updates.push(`trial_end_date = $${paramIndex++}`);
      values.push(trialEndDate);
    }
    if (password) {
      // SECURITY: Enforce password strength for updates too
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new ApiError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
      }
      const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
      updates.push(`password = $${paramIndex++}`);
      values.push(hashedPassword);
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}
       RETURNING id, email, first_name, last_name, role, is_active, trial_end_date`,
      values
    );

    if (result.rows.length === 0) {
      throw new ApiError('User not found', 404);
    }

    const user = result.rows[0];

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
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete user (admin only)
 */
export const deleteUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    if (req.user.role !== 'super_admin') {
      throw new ApiError('Not authorized', 403);
    }

    const { id } = req.params;

    if (id === req.user.id) {
      throw new ApiError('Cannot delete yourself', 400);
    }

    const pool = getPool();

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('User not found', 404);
    }

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
