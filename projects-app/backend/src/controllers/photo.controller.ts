import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

/**
 * Upload photo (PostgreSQL version)
 */
export const uploadPhoto = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    logger.info('Uploading photo...');
    
    if (!req.user) throw new ApiError('Not authenticated', 401);

    if (!req.file) {
      throw new ApiError('No file uploaded', 400);
    }

    const { projectId, description, tags, latitude, longitude } = req.body;

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

    // PHASE 2: Validate MIME type BEFORE moving file
    const ALLOWED_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (!ALLOWED_PHOTO_MIMES.includes(req.file.mimetype)) {
      // Clean up temp file
      await fs.unlink(req.file.path).catch(() => {});
      throw new ApiError(`Invalid file type: ${req.file.mimetype}. Only images are allowed.`, 400);
    }

    // Move file to project folder
    const destPath = path.join(
      process.cwd(),
      'uploads',
      folderPath,
      'Photo',
      req.file.filename
    );

    // Ensure directory exists
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.rename(req.file.path, destPath);

    // PHASE 2: Safe JSON.parse for tags
    let parsedTags: any[] = [];
    if (tags) {
      try {
        parsedTags = JSON.parse(tags);
        if (!Array.isArray(parsedTags)) parsedTags = [];
      } catch {
        parsedTags = [];
      }
    }

    const photoId = uuidv4();
    const filePath = `/uploads/${folderPath}/Photo/${req.file.filename}`;

    const result = await pool.query(
      `INSERT INTO photos (
        id, project_id, file_name, file_path, file_size, mime_type,
        description, tags, latitude, longitude, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING *`,
      [
        photoId,
        projectId,
        req.file.originalname,
        filePath,
        req.file.size,
        req.file.mimetype,
        description || '',
        parsedTags,
        latitude ? parseFloat(latitude) : null,
        longitude ? parseFloat(longitude) : null
      ]
    );

    logger.info(`Photo uploaded: ${photoId}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    logger.error('Error uploading photo:', error);
    next(error);
  }
};

/**
 * Get all photos for a project (PostgreSQL version)
 */
export const getPhotos = async (
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
      `SELECT * FROM photos WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [projectId]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching photos:', error);
    next(error);
  }
};

/**
 * Get photo by ID (PostgreSQL version)
 */
export const getPhotoById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT ph.* FROM photos ph
       INNER JOIN projects p ON ph.project_id = p.id
       WHERE ph.id = $1 AND p.user_id = $2 AND ph.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Photo not found', 404);
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
 * Delete photo (PostgreSQL version)
 */
export const deletePhoto = async (
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
      `SELECT ph.* FROM photos ph
       INNER JOIN projects p ON ph.project_id = p.id
       WHERE ph.id = $1 AND p.user_id = $2 AND ph.deleted_at IS NULL`,
      [id, req.user.id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Photo not found', 404);
    }

    // Soft delete
    await pool.query(
      `UPDATE photos SET deleted_at = NOW() WHERE id = $1`,
      [id]
    );

    // Optionally delete physical file
    try {
      const filePath = path.join(process.cwd(), existing.rows[0].file_path);
      await fs.unlink(filePath);
    } catch (e) {
      // File may not exist, ignore
    }

    logger.info(`Photo deleted: ${id}`);

    res.json({
      success: true,
      message: 'Photo deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
