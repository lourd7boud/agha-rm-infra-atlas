import { Request, Response, NextFunction } from 'express';

/**
 * JSON-only middleware to ensure all API responses are JSON
 * Prevents HTML error pages from being sent
 */
export const ensureJsonResponse = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Only apply to API routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }
  
  // Set JSON content type for API routes
  res.setHeader('Content-Type', 'application/json');
  
  next();
};
