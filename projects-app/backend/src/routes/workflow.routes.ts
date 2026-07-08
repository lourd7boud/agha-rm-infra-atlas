import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createApprovalRequestSchema,
  approveStepSchema,
  rejectStepSchema,
  createWorkflowSchema,
  projectIdParamSchema,
  idParamSchema,
} from '../middleware/schemas';
import {
  createApprovalRequest,
  getRequestsByProject,
  getPendingApprovals,
  getRequestById,
  approveStep,
  rejectStep,
  cancelRequest,
  getApprovalStats,
  createWorkflow,
  getWorkflowsByProject,
  deleteWorkflow,
} from '../controllers/workflow.controller';

const router = Router();
router.use(authenticate);

// Approval Requests
router.post('/', validate({ body: createApprovalRequestSchema }), createApprovalRequest);
router.get('/pending', getPendingApprovals);
router.get('/stats/summary', getApprovalStats);
router.get('/project/:projectId', validate({ params: projectIdParamSchema }), getRequestsByProject);
router.get('/:id', validate({ params: idParamSchema }), getRequestById);
router.post('/:id/approve', validate({ params: idParamSchema, body: approveStepSchema }), approveStep);
router.post('/:id/reject', validate({ params: idParamSchema, body: rejectStepSchema }), rejectStep);
router.post('/:id/cancel', validate({ params: idParamSchema }), cancelRequest);

// Workflow Templates
router.post('/workflows', validate({ body: createWorkflowSchema }), createWorkflow);
router.get('/workflows/project/:projectId', validate({ params: projectIdParamSchema }), getWorkflowsByProject);
router.delete('/workflows/:id', validate({ params: idParamSchema }), deleteWorkflow);

export default router;
