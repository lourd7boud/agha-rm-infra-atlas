import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema, projectIdParamSchema } from '../middleware/schemas';
import {
  createDiaryEntry,
  getDiaryEntries,
  getDiaryEntry,
  updateDiaryEntry,
  validateDiaryEntry,
  signDiaryEntry,
  deleteDiaryEntry,
  duplicateDiaryEntry,
  getDiaryStats,
} from '../controllers/siteDiary.controller';

const router = Router();
router.use(authenticate);

// CRUD
router.post('/', createDiaryEntry);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getDiaryEntries);
router.get('/stats/:projectId', validate({ params: projectIdParamSchema }), getDiaryStats);
router.get('/:id', validate({ params: idParamSchema }), getDiaryEntry);
router.put('/:id', validate({ params: idParamSchema }), updateDiaryEntry);
router.delete('/:id', validate({ params: idParamSchema }), deleteDiaryEntry);

// Actions
router.post('/:id/validate', validate({ params: idParamSchema }), validateDiaryEntry);
router.post('/:id/sign', validate({ params: idParamSchema }), signDiaryEntry);
router.post('/:id/duplicate', validate({ params: idParamSchema }), duplicateDiaryEntry);

export default router;
