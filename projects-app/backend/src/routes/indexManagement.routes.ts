/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Index Management Routes - Phase 4B
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Admin-only routes for managing revision indexes
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import multer from 'multer';
import { authenticate, authorize } from '../middleware/auth';
import {
  getIndexCatalog,
  listIndexes,
  getMonthIndexes,
  createMonthIndexes,
  updateMonthIndexes,
  deleteMonthIndexes,
  downloadTemplate,
  importFromExcel,
  getAuditLog
} from '../controllers/indexManagement.controller';

const router = Router();

// Configure multer for Excel upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
    }
  }
});

// All routes require authentication
router.use(authenticate);

// ═══════════════════════════════════════════════════════════════════════════
// 📋 INDEX CATALOG (Public for all authenticated users)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/index-management/catalog
 * Get the catalog of all official indexes
 */
router.get('/catalog', getIndexCatalog);

// ═══════════════════════════════════════════════════════════════════════════
// 📊 INDEX MANAGEMENT (Admin only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/index-management/
 * List all months with indexes
 * Query: ?year=2024&status=definitif
 */
router.get('/', authorize('admin', 'super_admin'), listIndexes);

/**
 * GET /api/index-management/template
 * Download Excel template for import
 */
router.get('/template', authorize('admin', 'super_admin'), downloadTemplate);

/**
 * GET /api/index-management/audit
 * Get audit log
 * Query: ?month=2024-01&action=update&limit=100
 */
router.get('/audit', authorize('admin', 'super_admin'), getAuditLog);

/**
 * GET /api/index-management/:month
 * Get indexes for a specific month
 * Param: month in format YYYY-MM or YYYY-MM-DD
 */
router.get('/:month', authorize('admin', 'super_admin'), getMonthIndexes);

/**
 * POST /api/index-management/
 * Create indexes for a new month
 * Body: { monthDate, indexes, status, source, notes }
 */
router.post('/', authorize('admin', 'super_admin'), createMonthIndexes);

/**
 * POST /api/index-management/import
 * Import indexes from Excel file
 * Body: multipart/form-data with file
 */
router.post('/import', authorize('admin', 'super_admin'), upload.single('file'), importFromExcel);

/**
 * PUT /api/index-management/:month
 * Update indexes for a month
 * Body: { indexes?, status?, source?, notes? }
 */
router.put('/:month', authorize('admin', 'super_admin'), updateMonthIndexes);

/**
 * DELETE /api/index-management/:month
 * Delete indexes for a month
 */
router.delete('/:month', authorize('admin', 'super_admin'), deleteMonthIndexes);

export default router;
