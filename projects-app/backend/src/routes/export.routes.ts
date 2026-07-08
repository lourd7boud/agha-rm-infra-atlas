/**
 * Export Routes — Smart Excel Export
 * ═══════════════════════════════════
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  exportBordereau,
  exportDecompte,
  exportSituation,
  exportRecapitulatif,
  getAvailableExports,
} from '../controllers/export.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// List available exports for a project
router.get('/available/:projectId', getAvailableExports);

// Export endpoints (return .xlsx files)
router.get('/bordereau/:projectId', exportBordereau);
router.get('/decompt/:decomptId', exportDecompte);
router.get('/situation/:projectId', exportSituation);
router.get('/recapitulatif/:projectId', exportRecapitulatif);

export default router;
