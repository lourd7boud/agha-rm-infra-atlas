import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createAvenantSchema, updateAvenantSchema, projectIdParamSchema, idParamSchema } from '../middleware/schemas';
import {
  createAvenant,
  getAvenantsByProject,
  getAvenantById,
  updateAvenant,
  deleteAvenant,
  getProjectAvenantSummary,
} from '../controllers/avenant.controller';

const router = Router();
router.use(authenticate);

// CRUD
router.post('/', validate({ body: createAvenantSchema }), createAvenant);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getAvenantsByProject);
router.get('/project/:projectId/summary', validate({ params: projectIdParamSchema }), getProjectAvenantSummary);
router.get('/:id', validate({ params: idParamSchema }), getAvenantById);
router.put('/:id', validate({ params: idParamSchema, body: updateAvenantSchema }), updateAvenant);
router.delete('/:id', validate({ params: idParamSchema }), deleteAvenant);

export default router;
