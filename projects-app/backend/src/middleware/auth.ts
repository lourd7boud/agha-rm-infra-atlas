import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiError } from './errorHandler';
import logger from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    firstName?: string;
    lastName?: string;
  };
}

// SECURITY: Fail loud if JWT_SECRET is not configured in production
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET === 'your-secret-key') {
  if (process.env.NODE_ENV === 'production') {
    logger.error('FATAL: JWT_SECRET environment variable is not set or uses default value.');
    process.exit(1);
  } else {
    logger.warn('WARNING: JWT_SECRET not set. Using insecure default for development ONLY.');
  }
}

const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'dev-only-insecure-secret-do-not-use-in-production';

// SECURITY: Restrict JWT algorithms to prevent "alg: none" attacks
const JWT_VERIFY_OPTIONS: jwt.VerifyOptions = {
  algorithms: ['HS256', 'HS384', 'HS512'],
};

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new ApiError('No valid authorization header provided', 401);
    }

    const token = authHeader.slice(7).trim(); // Remove "Bearer " prefix
    if (!token) {
      throw new ApiError('No token provided', 401);
    }

    // SECURITY: Enforce algorithm to prevent alg:none attacks
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET, JWT_VERIFY_OPTIONS) as jwt.JwtPayload;

    // Validate required claims exist in token
    if (!decoded.id || !decoded.email || !decoded.role) {
      throw new ApiError('Invalid token payload', 401);
    }

    // Only assign validated, typed properties to req.user
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
    };

    next();
  } catch (error: any) {
    if (error instanceof ApiError) {
      return next(error);
    }
    logger.warn('Token verification failed', { message: error.message, ip: req.ip, path: req.path });
    next(new ApiError('Invalid or expired token', 401));
  }
};

/**
 * Middleware for static file serving (uploads).
 * Supports authentication via:
 * 1. Authorization header (Bearer token) — API clients
 * 2. Cookie 'auth_token' — browser <img>, <video>, etc.
 * This is necessary because <img src="..."> cannot send Authorization headers.
 */
export const authenticateStaticFiles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let token: string | undefined;

    // 1. Check Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    }

    // 2. Fallback to cookie
    if (!token && req.cookies?.auth_token) {
      token = req.cookies.auth_token;
    }

    if (!token) {
      throw new ApiError('Authentication required to access this resource', 401);
    }

    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET, JWT_VERIFY_OPTIONS) as jwt.JwtPayload;

    if (!decoded.id || !decoded.email || !decoded.role) {
      throw new ApiError('Invalid token payload', 401);
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
    };

    next();
  } catch (error: any) {
    if (error instanceof ApiError) {
      return next(error);
    }
    logger.warn('Static file auth failed', { message: error.message, ip: req.ip, path: req.path });
    next(new ApiError('Invalid or expired token', 401));
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError('User not authenticated', 401));
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Authorization denied', { userId: req.user.id, role: req.user.role, path: req.path });
      return next(new ApiError('Insufficient permissions', 403));
    }

    next();
  };
};
