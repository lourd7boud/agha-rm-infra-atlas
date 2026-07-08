import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createPenaltySchema,
  updatePenaltySchema,
  createBondSchema,
  updateBondSchema,
  createRetentionSchema,
  projectIdParamSchema,
  idParamSchema,
} from '../middleware/schemas';
import {
  createPenalty,
  getPenaltiesByProject,
  updatePenalty,
  deletePenalty,
  createBond,
  getBondsByProject,
  updateBond,
  deleteBond,
  createRetention,
  getRetentionsByProject,
  getProjectFinancialSummary,
} from '../controllers/penalty.controller';

const router = Router();
router.use(authenticate);

// Penalties
router.post('/penalties', validate({ body: createPenaltySchema }), createPenalty);
router.get('/penalties/project/:projectId', validate({ params: projectIdParamSchema }), getPenaltiesByProject);
router.put('/penalties/:id', validate({ params: idParamSchema, body: updatePenaltySchema }), updatePenalty);
router.delete('/penalties/:id', validate({ params: idParamSchema }), deletePenalty);

// Bonds
router.post('/bonds', validate({ body: createBondSchema }), createBond);
router.get('/bonds/project/:projectId', validate({ params: projectIdParamSchema }), getBondsByProject);
router.put('/bonds/:id', validate({ params: idParamSchema, body: updateBondSchema }), updateBond);
router.delete('/bonds/:id', validate({ params: idParamSchema }), deleteBond);

// Retentions
router.post('/retentions', validate({ body: createRetentionSchema }), createRetention);
router.get('/retentions/project/:projectId', validate({ params: projectIdParamSchema }), getRetentionsByProject);

// Summary
router.get('/summary/project/:projectId', validate({ params: projectIdParamSchema }), getProjectFinancialSummary);

export default router;
