import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  logger.error(`Error: ${err.message}`, {
    statusCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // SECURITY: Don't leak internal error details (DB schema, stack traces) in production
  const message = (isProduction && statusCode === 500)
    ? 'Internal Server Error'
    : (err.message || 'Internal Server Error');

  res.setHeader('Content-Type', 'application/json');
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      timestamp: new Date().toISOString(),
      ...(!isProduction && {
        path: req.path,
        stack: err.stack,
      }),
    },
  });
};

export class ApiError extends Error implements AppError {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
