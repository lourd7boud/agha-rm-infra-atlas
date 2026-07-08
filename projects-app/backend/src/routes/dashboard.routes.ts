/**
 * Dashboard Routes — Phase 2
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getDashboardSummary } from '../controllers/dashboard.controller';

const router = Router();

// All dashboard routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/dashboard/summary
 * @desc    Get aggregated dashboard data (single query replaces N+1)
 * @access  Private
 */
router.get('/summary', getDashboardSummary);

export default router;
