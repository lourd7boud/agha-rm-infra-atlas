import { Request, Response } from 'express';

export const notFound = (req: Request, res: Response) => {
  // SECURITY: Sanitize reflected URL to prevent XSS in API consumers
  const sanitizedPath = req.path.replace(/[<>"'&]/g, '');
  res.status(404).json({
    success: false,
    error: {
      message: `Route not found: ${sanitizedPath}`,
    },
  });
};
