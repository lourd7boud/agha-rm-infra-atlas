/**
 * Thumbnail Service
 * Generates and caches resized images for grid views.
 * Uses sharp for fast, memory-efficient image processing.
 * 
 * Strategy:
 * - Thumbnails stored alongside originals in a .thumbs/ subfolder
 * - Two sizes: grid (400px) and preview (800px)
 * - Generated lazily on first request, then served from cache
 * - Also generated proactively on upload
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import logger from './logger';

export interface ThumbnailSize {
  name: string;
  width: number;
  height: number;
  quality: number;
}

export const THUMBNAIL_SIZES: Record<string, ThumbnailSize> = {
  grid: { name: 'grid', width: 400, height: 400, quality: 75 },
  preview: { name: 'preview', width: 800, height: 800, quality: 80 },
};

// Supported image MIME types for thumbnailing
const SUPPORTED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
]);

/**
 * Check if a file is a supported image for thumbnailing
 */
export function isThumbnailable(mimeType: string): boolean {
  return SUPPORTED_MIMES.has(mimeType.toLowerCase());
}

/**
 * Get the thumbnail path for a given original file path
 */
function getThumbnailPath(originalPath: string, size: string): string {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const basename = path.basename(originalPath, ext);
  const thumbDir = path.join(dir, '.thumbs');
  return path.join(thumbDir, `${basename}_${size}.webp`);
}

/**
 * Generate a thumbnail for a given image file
 * Returns the path to the generated thumbnail, or null if generation failed
 */
export async function generateThumbnail(
  originalAbsPath: string,
  size: string = 'grid'
): Promise<string | null> {
  const sizeConfig = THUMBNAIL_SIZES[size];
  if (!sizeConfig) {
    logger.warn(`Unknown thumbnail size: ${size}`);
    return null;
  }

  const thumbPath = getThumbnailPath(originalAbsPath, size);

  // Return cached thumbnail if it exists
  if (existsSync(thumbPath)) {
    return thumbPath;
  }

  try {
    // Ensure .thumbs directory exists
    const thumbDir = path.dirname(thumbPath);
    await fs.mkdir(thumbDir, { recursive: true });

    // Generate thumbnail with sharp
    await sharp(originalAbsPath)
      .rotate() // Auto-rotate based on EXIF
      .resize(sizeConfig.width, sizeConfig.height, {
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      })
      .webp({ quality: sizeConfig.quality })
      .toFile(thumbPath);

    const originalStat = await fs.stat(originalAbsPath);
    const thumbStat = await fs.stat(thumbPath);
    const reduction = ((1 - thumbStat.size / originalStat.size) * 100).toFixed(0);

    logger.info(`Thumbnail generated: ${path.basename(thumbPath)} (${reduction}% smaller)`);
    return thumbPath;
  } catch (error: any) {
    logger.error(`Thumbnail generation failed for ${originalAbsPath}: ${error.message}`);
    return null;
  }
}

/**
 * Generate all thumbnail sizes for an image
 */
export async function generateAllThumbnails(originalAbsPath: string): Promise<void> {
  const sizes = Object.keys(THUMBNAIL_SIZES);
  await Promise.allSettled(
    sizes.map(size => generateThumbnail(originalAbsPath, size))
  );
}

/**
 * Get or generate a thumbnail, returning the absolute file path
 * Falls back to original if thumbnail generation fails
 */
export async function getOrGenerateThumbnail(
  storagePath: string,
  size: string = 'grid'
): Promise<string> {
  // Convert storage path to absolute filesystem path
  // storagePath format: /uploads/folderPath/Photos/filename.ext
  const relativePath = storagePath.replace(/^\/uploads\//, '');
  const absolutePath = path.join(process.cwd(), 'uploads', relativePath);

  // Check if original exists
  if (!existsSync(absolutePath)) {
    throw new Error(`Original file not found: ${absolutePath}`);
  }

  // Try to generate/get thumbnail
  const thumbPath = await generateThumbnail(absolutePath, size);
  
  // Return thumbnail path, or original as fallback
  return thumbPath || absolutePath;
}

/**
 * Delete all thumbnails for a given file
 */
export async function deleteThumbnails(originalAbsPath: string): Promise<void> {
  for (const size of Object.keys(THUMBNAIL_SIZES)) {
    const thumbPath = getThumbnailPath(originalAbsPath, size);
    try {
      await fs.unlink(thumbPath);
    } catch {
      // Ignore if doesn't exist
    }
  }
}
