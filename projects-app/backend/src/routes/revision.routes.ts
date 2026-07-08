/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Revision Routes - API Routes Registration
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Phase 2: Input/Output API only
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createFormulaSchema, createIndexSchema, createProjectConfigSchema, idParamSchema, projectIdParamSchema } from '../middleware/schemas';
import {
  // Formulas
  getFormulas,
  getFormula,
  createFormula,
  // Indexes
  getIndexes,
  createIndex,
  updateIndex,
  deleteIndex,
  // Project Config
  getProjectConfig,
  createProjectConfig,
  updateProjectConfig,
  // Calculation (Phase 3)
  calculateRevision
} from '../controllers/revision.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ═══════════════════════════════════════════════════════════════════════════
// 📋 FORMULAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/revision/formulas
 * الحصول على جميع الصيغ
 */
router.get('/formulas', getFormulas);

/**
 * GET /api/revision/formulas/:id
 * الحصول على صيغة محددة
 */
router.get('/formulas/:id', getFormula);

/**
 * POST /api/revision/formulas
 * إنشاء صيغة جديدة
 */
router.post('/formulas', validate({ body: createFormulaSchema }), createFormula);

// ═══════════════════════════════════════════════════════════════════════════
// 📊 INDEXES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/revision/indexes
 * الحصول على جميع المؤشرات
 * Query params: ?year=2024&month=8
 */
router.get('/indexes', getIndexes);

/**
 * POST /api/revision/indexes
 * إضافة مؤشرات شهر جديد
 */
router.post('/indexes', validate({ body: createIndexSchema }), createIndex);

/**
 * PUT /api/revision/indexes/:id
 * تحديث مؤشرات شهر
 */
router.put('/indexes/:id', validate({ body: createIndexSchema.partial(), params: idParamSchema }), updateIndex);

/**
 * DELETE /api/revision/indexes/:id
 * حذف مؤشرات شهر
 */
router.delete('/indexes/:id', validate({ params: idParamSchema }), deleteIndex);

// ═══════════════════════════════════════════════════════════════════════════
// ⚙️ PROJECT CONFIG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/revision/config/:projectId
 * الحصول على إعدادات المراجعة للمشروع
 */
router.get('/config/:projectId', getProjectConfig);

/**
 * POST /api/revision/config/:projectId
 * إنشاء/تحديث إعدادات المراجعة للمشروع
 */
router.post('/config/:projectId', validate({ body: createProjectConfigSchema, params: projectIdParamSchema }), createProjectConfig);

/**
 * PUT /api/revision/config/:projectId
 * تحديث إعدادات المراجعة للمشروع
 */
router.put('/config/:projectId', validate({ body: createProjectConfigSchema.partial(), params: projectIdParamSchema }), updateProjectConfig);

// ═══════════════════════════════════════════════════════════════════════════
// 🧮 CALCULATION (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/revision/calculate
 * حساب المراجعة (Phase 3 - غير مفعّل)
 */
router.post('/calculate', calculateRevision);

export default router;
