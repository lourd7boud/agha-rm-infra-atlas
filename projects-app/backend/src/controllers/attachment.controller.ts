import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

/**
 * Upload attachment (PostgreSQL version)
 */
export const uploadAttachment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    logger.info('Uploading attachment...');
    
    if (!req.user) throw new ApiError('Not authenticated', 401);

    if (!req.file) {
      throw new ApiError('No file uploaded', 400);
    }

    const { projectId, category, description, linkedType, linkedId, periodeId, decompteId } = req.body;

    if (!projectId) {
      throw new ApiError('Project ID required', 400);
    }

    const pool = getPool();

    // Verify project ownership
    const project = await pool.query(
      'SELECT id, folder_path FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (project.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    const folderPath = project.rows[0].folder_path;

    // Determine destination folder based on category
    const categoryFolders: { [key: string]: string } = {
      facture: 'Facture',
      bp: 'BP',
      plan: 'Plans',
      autre: 'Attachement',
    };
    const folder = categoryFolders[category] || 'Attachement';

    // Move file to project folder
    const destPath = path.join(
      process.cwd(),
      'uploads',
      folderPath,
      folder,
      req.file.filename
    );

    // Ensure directory exists
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.rename(req.file.path, destPath);

    const attachmentId = uuidv4();
    const filePathUrl = `/uploads/${folderPath}/${folder}/${req.file.filename}`;

    const result = await pool.query(
      `INSERT INTO attachments (
        id, project_id, periode_id, decompte_id, file_name, file_path, file_type, file_size, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [
        attachmentId,
        projectId,
        periodeId || null,
        decompteId || null,
        req.file.originalname,
        filePathUrl,
        req.file.mimetype,
        req.file.size
      ]
    );

    logger.info(`Attachment uploaded: ${attachmentId}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Error uploading attachment:', error);
    next(error);
  }
};

/**
 * Get all attachments for a project (PostgreSQL version)
 */
export const getAttachments = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const pool = getPool();

    // Verify project ownership
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    const result = await pool.query(
      `SELECT * FROM attachments WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [projectId]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching attachments:', error);
    next(error);
  }
};

/**
 * Get attachment by ID (PostgreSQL version)
 */
export const getAttachmentById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT a.* FROM attachments a
       INNER JOIN projects p ON a.project_id = p.id
       WHERE a.id = $1 AND p.user_id = $2 AND a.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Attachment not found', 404);
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete attachment (PostgreSQL version)
 */
export const deleteAttachment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    // Check ownership and get file path
    const existing = await pool.query(
      `SELECT a.* FROM attachments a
       INNER JOIN projects p ON a.project_id = p.id
       WHERE a.id = $1 AND p.user_id = $2 AND a.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Attachment not found', 404);
    }

    // Soft delete
    await pool.query(
      `UPDATE attachments SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    // Optionally delete physical file
    try {
      const filePath = path.join(process.cwd(), existing.rows[0].file_path);
      await fs.unlink(filePath);
    } catch (e) {
      // File may not exist, ignore
    }

    logger.info(`Attachment deleted: ${id}`);

    res.json({
      success: true,
      message: 'Attachment deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
