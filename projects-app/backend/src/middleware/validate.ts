/**
 * Zod Validation Middleware
 * 
 * Validates request body, params, and query against Zod schemas.
 * Returns 400 with structured error messages on validation failure.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

/**
 * Express middleware that validates request parts against Zod schemas.
 * Usage: router.post('/endpoint', validate({ body: mySchema }), handler)
 */
export const validate = (schemas: ValidationSchemas) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: { field: string; message: string }[] = [];

    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
    } catch (err) {
      if (err instanceof ZodError) {
        errors.push(...err.issues.map(issue => ({
          field: `body.${issue.path.join('.')}`,
          message: issue.message,
        })));
      }
    }

    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as any;
      }
    } catch (err) {
      if (err instanceof ZodError) {
        errors.push(...err.issues.map(issue => ({
          field: `params.${issue.path.join('.')}`,
          message: issue.message,
        })));
      }
    }

    try {
      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as any;
      }
    } catch (err) {
      if (err instanceof ZodError) {
        errors.push(...err.issues.map(issue => ({
          field: `query.${issue.path.join('.')}`,
          message: issue.message,
        })));
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          details: errors,
        },
      });
      return;
    }

    next();
  };
};
