import { Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import { keysToCamel } from '../utils/transform';

/**
 * Photo Albums Controller
 * Manages photo albums for project organization
 */

// Use canonical keysToCamel (was duplicated as toCamelCase)
const toCamelCase = keysToCamel;

/**
 * Get all albums for a project
 */
export const getAlbums = async (
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

    // Get albums with photo count
    const result = await pool.query(`
      SELECT 
        a.*,
        COUNT(pa.id) FILTER (WHERE pa.type = 'photo' AND pa.deleted_at IS NULL) as photo_count,
        (SELECT storage_path FROM project_assets WHERE id = a.cover_photo_id) as cover_photo_path
      FROM photo_albums a
      LEFT JOIN project_assets pa ON pa.album_id = a.id
      WHERE a.project_id = $1
      GROUP BY a.id
      ORDER BY a.sort_order ASC, a.created_at ASC
    `, [projectId]);

    res.json({
      success: true,
      data: toCamelCase(result.rows),
      count: result.rows.length,
    });
  } catch (error) {
    logger.error('Error fetching albums:', error);
    next(error);
  }
};

/**
 * Create a new album
 */
export const createAlbum = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const { name, description, color, icon, periodeId } = req.body;

    if (!name || !name.trim()) {
      throw new ApiError('Album name is required', 400);
    }

    const pool = getPool();

    // Verify project ownership
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [projectId, req.user.id]
    );

    if (projectCheck.rows.length === 0) {
      throw new ApiError('Project not found or not authorized', 404);
    }

    // Get max sort_order
    const maxOrder = await pool.query(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM photo_albums WHERE project_id = $1',
      [projectId]
    );

    const result = await pool.query(`
      INSERT INTO photo_albums (project_id, name, description, color, icon, periode_id, sort_order, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      projectId,
      name.trim(),
      description || null,
      color || '#3B82F6',
      icon || 'folder',
      periodeId || null,
      maxOrder.rows[0].next_order,
      req.user.id
    ]);

    logger.info(`Album created: ${result.rows[0].id}`);

    res.status(201).json({
      success: true,
      data: toCamelCase(result.rows[0]),
    });
  } catch (error) {
    logger.error('Error creating album:', error);
    next(error);
  }
};

/**
 * Update an album
 */
export const updateAlbum = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const { name, description, color, icon, coverPhotoId, periodeId, sortOrder } = req.body;

    const pool = getPool();

    // Verify album ownership
    const albumCheck = await pool.query(`
      SELECT a.id FROM photo_albums a
      INNER JOIN projects p ON a.project_id = p.id
      WHERE a.id = $1 AND p.user_id = $2
    `, [id, req.user.id]);

    if (albumCheck.rows.length === 0) {
      throw new ApiError('Album not found or not authorized', 404);
    }

    const result = await pool.query(`
      UPDATE photo_albums SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        color = COALESCE($3, color),
        icon = COALESCE($4, icon),
        cover_photo_id = COALESCE($5, cover_photo_id),
        periode_id = COALESCE($6, periode_id),
        sort_order = COALESCE($7, sort_order),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [name, description, color, icon, coverPhotoId, periodeId, sortOrder, id]);

    res.json({
      success: true,
      data: toCamelCase(result.rows[0]),
    });
  } catch (error) {
    logger.error('Error updating album:', error);
    next(error);
  }
};

/**
 * Delete an album (photos will have album_id set to null)
 */
export const deleteAlbum = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { id } = req.params;
    const pool = getPool();

    // Verify album ownership
    const albumCheck = await pool.query(`
      SELECT a.id FROM photo_albums a
      INNER JOIN projects p ON a.project_id = p.id
      WHERE a.id = $1 AND p.user_id = $2
    `, [id, req.user.id]);

    if (albumCheck.rows.length === 0) {
      throw new ApiError('Album not found or not authorized', 404);
    }

    await pool.query('DELETE FROM photo_albums WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Album deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting album:', error);
    next(error);
  }
};

/**
 * Move photos to an album
 */
export const movePhotosToAlbum = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { albumId } = req.params;
    const { photoIds } = req.body;

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      throw new ApiError('Photo IDs array is required', 400);
    }

    const pool = getPool();

    // If albumId is 'none', set to null (remove from album)
    const targetAlbumId = albumId === 'none' ? null : albumId;

    // Verify album ownership if not removing
    if (targetAlbumId) {
      const albumCheck = await pool.query(`
        SELECT a.id FROM photo_albums a
        INNER JOIN projects p ON a.project_id = p.id
        WHERE a.id = $1 AND p.user_id = $2
      `, [targetAlbumId, req.user.id]);

      if (albumCheck.rows.length === 0) {
        throw new ApiError('Album not found or not authorized', 404);
      }
    }

    // Update photos
    const result = await pool.query(`
      UPDATE project_assets 
      SET album_id = $1, updated_at = NOW()
      WHERE id = ANY($2::uuid[]) AND type = 'photo'
      RETURNING id
    `, [targetAlbumId, photoIds]);

    res.json({
      success: true,
      message: `${result.rowCount} photos moved`,
      movedCount: result.rowCount,
    });
  } catch (error) {
    logger.error('Error moving photos:', error);
    next(error);
  }
};
