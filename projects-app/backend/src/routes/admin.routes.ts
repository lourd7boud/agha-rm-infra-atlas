import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getAdminStats,
  getAllUsersAdmin,
  createUserAdmin,
  updateUserAdmin,
  deleteUserAdmin,
  getAuditLogs,
  getProjectMembers,
  setProjectMember,
  removeProjectMember,
  getOnlineUsers,
} from '../controllers/admin.controller';

const router = Router();

// All admin routes require authentication
router.use(authenticate);

// ─── Dashboard Stats ────────────────────────────────
router.get('/stats', getAdminStats);

// ─── Users CRUD ─────────────────────────────────────
router.get('/users', getAllUsersAdmin);
router.post('/users', createUserAdmin);
router.put('/users/:id', updateUserAdmin);
router.delete('/users/:id', deleteUserAdmin);

// ─── Project Members ────────────────────────────────
router.get('/projects/:projectId/members', getProjectMembers);
router.post('/projects/:projectId/members', setProjectMember);
router.delete('/projects/:projectId/members/:userId', removeProjectMember);

// ─── Audit Logs ─────────────────────────────────────
router.get('/audit-logs', getAuditLogs);

// ─── Online Users (Presence) ────────────────────────
router.get('/online', getOnlineUsers);

export default router;
