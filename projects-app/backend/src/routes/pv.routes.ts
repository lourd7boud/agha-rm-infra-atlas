import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPVSchema, idParamSchema, projectIdParamSchema } from '../middleware/schemas';
import {
  createPV,
  getPVs,
  getPVById,
  updatePV,
  deletePV,
} from '../controllers/pv.controller';

const router = Router();
router.use(authenticate);

router.post('/', validate({ body: createPVSchema }), createPV);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getPVs);
router.get('/:id', validate({ params: idParamSchema }), getPVById);
router.put('/:id', validate({ body: createPVSchema.partial(), params: idParamSchema }), updatePV);
router.delete('/:id', validate({ params: idParamSchema }), deletePV);

export default router;
