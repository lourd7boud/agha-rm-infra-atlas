import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createMetreSchema, updateMetreSchema, idParamSchema, projectIdParamSchema } from '../middleware/schemas';
import {
  createMetre,
  getMetres,
  getMetreById,
  updateMetre,
  deleteMetre,
} from '../controllers/metre.controller';

const router = Router();
router.use(authenticate);

router.post('/', validate({ body: createMetreSchema }), createMetre);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getMetres);
router.get('/:id', validate({ params: idParamSchema }), getMetreById);
router.put('/:id', validate({ body: updateMetreSchema, params: idParamSchema }), updateMetre);
router.delete('/:id', validate({ params: idParamSchema }), deleteMetre);

export default router;
