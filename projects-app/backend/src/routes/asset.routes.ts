/**
 * Asset Routes (Unified V1)
 * Single router for all project assets: photos, PV, documents
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, authenticateStaticFiles } from '../middleware/auth';
import {
  listAssets,
  uploadAsset,
  uploadMultiplePhotos,
  createPV,
  uploadPV,
  deleteAsset,
  getAssetCounts,
  getAssetThumbnail,
} from '../controllers/asset.controller';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads', 'temp'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max per file
    files: 50, // Max 50 files at once
  },
  fileFilter: (req, file, cb) => {
    // Allow images, PDFs, and common document types
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.dwg',
      'application/acad',
      'image/vnd.dwg',
    ];

    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(null, true); // Accept all files for now, validation can be stricter later
    }
  },
});

/**
 * GET /api/assets/:assetId/thumbnail
 * Serve a thumbnail for an image asset
 * Query params: ?size=grid|preview (default: grid)
 * Uses authenticateStaticFiles to support cookie-based auth for <img src="..."> tags
 * Must be registered BEFORE router.use(authenticate) so cookies work
 */
router.get('/:assetId/thumbnail', authenticateStaticFiles, getAssetThumbnail);

// All other routes require Bearer token authentication
router.use(authenticate);

/**
 * GET /api/assets/project/:projectId
 * List all assets for a project (optionally filter by type)
 * Query params: ?type=photo|pv|document
 */
router.get('/project/:projectId', listAssets);

/**
 * GET /api/assets/project/:projectId/counts
 * Get asset counts by type
 */
router.get('/project/:projectId/counts', getAssetCounts);

/**
 * POST /api/assets/project/:projectId/upload
 * Upload a single asset (photo or document)
 * Body: type (required), file (multipart)
 */
router.post('/project/:projectId/upload', upload.single('file'), uploadAsset);

/**
 * POST /api/assets/project/:projectId/photos
 * Upload multiple photos at once (up to 50 photos)
 */
router.post('/project/:projectId/photos', upload.array('files', 50), uploadMultiplePhotos);

/**
 * POST /api/assets/project/:projectId/pv
 * Create a PV (generates PDF)
 * Body: pvType, date, observations?, participants?
 */
router.post('/project/:projectId/pv', createPV);

/**
 * POST /api/assets/project/:projectId/pv/upload
 * Upload PV files (PDF or images)
 * Body: pvType, date?, description?, files (multipart)
 */
router.post('/project/:projectId/pv/upload', upload.array('files', 10), uploadPV);

/**
 * DELETE /api/assets/:assetId
 * Soft delete an asset
 */
router.delete('/:assetId', deleteAsset);

export default router;
