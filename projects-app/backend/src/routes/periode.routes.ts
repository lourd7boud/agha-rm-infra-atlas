import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createPeriodeSchema, idParamSchema, projectIdParamSchema } from '../middleware/schemas';
import {
  createPeriode,
  getPeriodes,
  getPeriodeById,
  updatePeriode,
  deletePeriode,
} from '../controllers/periode.controller';

const router = Router();
router.use(authenticate);

router.post('/', validate({ body: createPeriodeSchema }), createPeriode);
router.post('/project/:projectId', validate({ body: createPeriodeSchema, params: projectIdParamSchema }), createPeriode);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getPeriodes);
router.get('/:id', validate({ params: idParamSchema }), getPeriodeById);
router.put('/:id', validate({ body: createPeriodeSchema.partial(), params: idParamSchema }), updatePeriode);
router.delete('/:id', validate({ params: idParamSchema }), deletePeriode);

export default router;
