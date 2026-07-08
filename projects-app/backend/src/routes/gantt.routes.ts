import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  batchUpdateTasks,
  createDependency,
  deleteDependency,
  getStats
} from '../controllers/gantt.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Tasks
router.get('/tasks/:projectId', getTasks);
router.post('/tasks', createTask);
router.put('/tasks/:id', updateTask);
router.delete('/tasks/:id', deleteTask);
router.put('/tasks/batch/:projectId', batchUpdateTasks);

// Dependencies
router.post('/dependencies', createDependency);
router.delete('/dependencies/:id', deleteDependency);

// Stats
router.get('/stats/:projectId', getStats);

export default router;
