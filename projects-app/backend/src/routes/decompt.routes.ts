import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createDecomptSchema, idParamSchema, projectIdParamSchema } from '../middleware/schemas';
import {
  createDecompt,
  getDecompts,
  getDecomptById,
  updateDecompt,
  deleteDecompt,
  generateDecomptPDF,
} from '../controllers/decompt.controller';

const router = Router();
router.use(authenticate);

router.post('/', validate({ body: createDecomptSchema }), createDecompt);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getDecompts);
router.get('/:id', validate({ params: idParamSchema }), getDecomptById);
router.put('/:id', validate({ body: createDecomptSchema.partial(), params: idParamSchema }), updateDecompt);
router.delete('/:id', validate({ params: idParamSchema }), deleteDecompt);
router.get('/:id/pdf', validate({ params: idParamSchema }), generateDecomptPDF);

export default router;
