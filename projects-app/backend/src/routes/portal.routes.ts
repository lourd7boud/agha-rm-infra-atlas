import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createShareLink,
  getShareLinks,
  toggleShareLink,
  deleteShareLink,
  getAccessLog,
  getPortalData,
} from '../controllers/portal.controller';

const router = Router();

// ═══════════════════════════════════════════════
// Authenticated routes (project owner)
// ═══════════════════════════════════════════════
router.post('/links', authenticate, createShareLink);
router.get('/links/project/:projectId', authenticate, getShareLinks);
router.patch('/links/:id/toggle', authenticate, toggleShareLink);
router.delete('/links/:id', authenticate, deleteShareLink);
router.get('/links/:id/log', authenticate, getAccessLog);

// ═══════════════════════════════════════════════
// Public route (no auth — token-based access)
// ═══════════════════════════════════════════════
router.get('/view/:token', getPortalData);

export default router;
