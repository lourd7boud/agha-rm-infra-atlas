import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema, projectIdParamSchema } from '../middleware/schemas';
import {
  createODS,
  getODSByProject,
  getODS,
  updateODS,
  emitODS,
  notifyODS,
  acknowledgeODS,
  executeODS,
  closeODS,
  cancelODS,
  deleteODS,
} from '../controllers/ods.controller';

const router = Router();
router.use(authenticate);

// CRUD
router.post('/', createODS);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getODSByProject);
router.get('/:id', validate({ params: idParamSchema }), getODS);
router.put('/:id', validate({ params: idParamSchema }), updateODS);
router.delete('/:id', validate({ params: idParamSchema }), deleteODS);

// Workflow actions
router.post('/:id/emit', validate({ params: idParamSchema }), emitODS);
router.post('/:id/notify', validate({ params: idParamSchema }), notifyODS);
router.post('/:id/acknowledge', validate({ params: idParamSchema }), acknowledgeODS);
router.post('/:id/execute', validate({ params: idParamSchema }), executeODS);
router.post('/:id/close', validate({ params: idParamSchema }), closeODS);
router.post('/:id/cancel', validate({ params: idParamSchema }), cancelODS);

export default router;
