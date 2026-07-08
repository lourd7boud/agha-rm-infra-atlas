import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createBordereauSchema, updateBordereauSchema, projectIdParamSchema, idParamSchema } from '../middleware/schemas';
import {
  createBordereau,
  getBordereaux,
  getBordereauById,
  updateBordereau,
  deleteBordereau,
} from '../controllers/bordereau.controller';

const router = Router();
router.use(authenticate);

router.post('/', validate({ body: createBordereauSchema }), createBordereau);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getBordereaux);
router.get('/:id', validate({ params: idParamSchema }), getBordereauById);
router.put('/:id', validate({ params: idParamSchema, body: updateBordereauSchema }), updateBordereau);
router.delete('/:id', validate({ params: idParamSchema }), deleteBordereau);

export default router;
