import { Router } from 'express';
import {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  getProjectStructure,
  getDeletedProjects,
  restoreProject,
} from '../controllers/project.controller';
import {
  getProjectConfig,
  createProjectConfig,
  updateProjectConfig,
} from '../controllers/revision.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  createProjectSchema,
  updateProjectSchema,
  createProjectConfigSchema,
  idParamSchema,
} from '../middleware/schemas';

const router = Router();

// Toutes les routes nécessitent l'authentification
router.use(authenticate);

/**
 * @route   POST /api/projects
 * @desc    Create new project
 * @access  Private
 */
router.post('/', validate({ body: createProjectSchema }), createProject);

/**
 * @route   GET /api/projects
 * @desc    Get all projects for current user
 * @access  Private
 */
router.get('/', getProjects);

/**
 * @route   GET /api/projects/:id
 * @desc    Get project by ID
 * @access  Private
 */
router.get('/:id', getProjectById);

/**
 * @route   PUT /api/projects/:id
 * @desc    Update project
 * @access  Private
 */
router.put('/:id', validate({ body: updateProjectSchema, params: idParamSchema }), updateProject);

/**
 * @route   DELETE /api/projects/:id
 * @desc    Delete project (soft delete)
 * @access  Private
 */
router.delete('/:id', validate({ params: idParamSchema }), deleteProject);

/**
 * @route   GET /api/projects/deleted/list
 * @desc    Get deleted projects (trash bin)
 * @access  Private
 */
router.get('/deleted/list', getDeletedProjects);

/**
 * @route   POST /api/projects/:id/restore
 * @desc    Restore a deleted project
 * @access  Private
 */
router.post('/:id/restore', restoreProject);

/**
 * @route   GET /api/projects/:id/structure
 * @desc    Get project folder structure
 * @access  Private
 */
router.get('/:id/structure', getProjectStructure);

// ═══════════════════════════════════════════════════════════════════════════
// 📐 REVISION CONFIG - صيغة مراجعة الأسعار
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @route   GET /api/projects/:id/revision-config
 * @desc    Get project revision formula configuration
 * @access  Private
 */
router.get('/:id/revision-config', getProjectConfig);

/**
 * @route   POST /api/projects/:id/revision-config
 * @desc    Create/Update project revision formula configuration
 * @access  Private
 */
router.post('/:id/revision-config', validate({ body: createProjectConfigSchema, params: idParamSchema }), createProjectConfig);

/**
 * @route   PUT /api/projects/:id/revision-config
 * @desc    Update project revision formula configuration
 * @access  Private
 */
router.put('/:id/revision-config', validate({ body: createProjectConfigSchema.partial(), params: idParamSchema }), updateProjectConfig);

/**
 * @route   DELETE /api/projects/:id/revision-config
 * @desc    Delete project revision formula configuration
 * @access  Private
 */
router.delete('/:id/revision-config', async (req, res) => {
  const pool = (await import('../config/postgres')).getPool();
  try {
    await pool.query('DELETE FROM project_revision_config WHERE project_id = $1', [req.params.id]);
    res.json({ message: 'Config deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete config' });
  }
});

export default router;
