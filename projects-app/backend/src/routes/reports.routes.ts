import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getGlobalReport,
  getFinancialReport,
  getDeadlinesReport,
  getActivityReport,
} from '../controllers/reports.controller';

const router = Router();

router.use(authenticate);

router.get('/global', getGlobalReport);
router.get('/financial', getFinancialReport);
router.get('/deadlines', getDeadlinesReport);
router.get('/activity', getActivityReport);

export default router;
