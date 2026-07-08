/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Revision Controller - API Endpoints
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ⚠️ Phase 2: Input/Output only - no calculation integration
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Request, Response } from 'express';
import { getPool } from '../config/postgres';
import { AuthRequest } from '../middleware/auth';
import { ApiError } from '../middleware/errorHandler';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════════════
// 📋 FORMULAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/revision/formulas
 * الحصول على جميع الصيغ المتاحة
 */
export async function getFormulas(req: Request, res: Response) {
  try {
    const pool = getPool();
    const result = await pool.query(`
      SELECT 
        id,
        name,
        description,
        fixed_part as "fixedPart",
        weights,
        is_default as "isDefault",
        created_at as "createdAt"
      FROM revision_formulas
      ORDER BY is_default DESC, name ASC
    `);
    
    res.json(result.rows);
  } catch (error) {
    logger.error('Error getting formulas:', error);
    res.status(500).json({ error: 'Failed to get formulas' });
  }
}

/**
 * GET /api/revision/formulas/:id
 * الحصول على صيغة محددة
 */
export async function getFormula(req: Request, res: Response): Promise<void> {
  try {
    const pool = getPool();
    const { id } = req.params;
    
    const result = await pool.query(`
      SELECT 
        id,
        name,
        description,
        fixed_part as "fixedPart",
        weights,
        is_default as "isDefault"
      FROM revision_formulas
      WHERE id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Formula not found' });
      return;
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error getting formula:', error);
    res.status(500).json({ error: 'Failed to get formula' });
  }
}

/**
 * POST /api/revision/formulas
 * إنشاء صيغة جديدة
 */
export async function createFormula(req: Request, res: Response): Promise<void> {
  try {
    const pool = getPool();
    const { name, description, fixedPart, weights, isDefault } = req.body;
    
    // Validate sum = 1
    const weightsSum = Object.values(weights as Record<string, number>).reduce((a, b) => a + b, 0);
    const total = fixedPart + weightsSum;
    if (Math.abs(total - 1) > 0.0001) {
      res.status(400).json({ 
        error: `Invalid formula: sum = ${total.toFixed(4)} (must be 1.0000)` 
      });
      return;
    }
    
    // PHASE 2: Use transaction to atomically unset default + insert
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (isDefault) {
        await client.query('UPDATE revision_formulas SET is_default = false');
      }

      const result = await client.query(`
        INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [name, description, fixedPart, JSON.stringify(weights), isDefault || false]);

      await client.query('COMMIT');
      res.status(201).json({ id: result.rows[0].id, message: 'Formula created' });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error creating formula:', error);
    res.status(500).json({ error: 'Failed to create formula' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 📊 INDEXES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/revision/indexes
 * الحصول على جميع المؤشرات
 */
export async function getIndexes(req: Request, res: Response) {
  try {
    const pool = getPool();
    const { year, month } = req.query;
    
    let query = `
      SELECT 
        id,
        month_date as "monthDate",
        index_values as "indexValues",
        source,
        created_at as "createdAt"
      FROM revision_indexes
    `;
    
    const params: any[] = [];
    const conditions: string[] = [];
    
    if (year) {
      conditions.push(`EXTRACT(YEAR FROM month_date) = $${params.length + 1}`);
      params.push(year);
    }
    
    if (month) {
      conditions.push(`EXTRACT(MONTH FROM month_date) = $${params.length + 1}`);
      params.push(month);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY month_date DESC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    logger.error('Error getting indexes:', error);
    res.status(500).json({ error: 'Failed to get indexes' });
  }
}

/**
 * POST /api/revision/indexes
 * إضافة مؤشرات شهر جديد
 */
export async function createIndex(req: Request, res: Response) {
  try {
    const pool = getPool();
    const { monthDate, indexValues, source } = req.body;
    
    const result = await pool.query(`
      INSERT INTO revision_indexes (month_date, index_values, source)
      VALUES ($1, $2, $3)
      ON CONFLICT (month_date) DO UPDATE SET
        index_values = EXCLUDED.index_values,
        source = EXCLUDED.source,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [monthDate, JSON.stringify(indexValues), source || 'Manual']);
    
    res.status(201).json({ id: result.rows[0].id, message: 'Index saved' });
  } catch (error) {
    logger.error('Error creating index:', error);
    res.status(500).json({ error: 'Failed to save index' });
  }
}

/**
 * PUT /api/revision/indexes/:id
 * تحديث مؤشرات شهر
 */
export async function updateIndex(req: Request, res: Response) {
  try {
    const pool = getPool();
    const { id } = req.params;
    const { indexValues, source } = req.body;
    
    await pool.query(`
      UPDATE revision_indexes
      SET index_values = $1, source = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [JSON.stringify(indexValues), source, id]);
    
    res.json({ message: 'Index updated' });
  } catch (error) {
    logger.error('Error updating index:', error);
    res.status(500).json({ error: 'Failed to update index' });
  }
}

/**
 * DELETE /api/revision/indexes/:id
 * حذف مؤشرات شهر
 */
export async function deleteIndex(req: Request, res: Response) {
  try {
    const pool = getPool();
    const { id } = req.params;
    
    await pool.query('DELETE FROM revision_indexes WHERE id = $1', [id]);
    
    res.json({ message: 'Index deleted' });
  } catch (error) {
    logger.error('Error deleting index:', error);
    res.status(500).json({ error: 'Failed to delete index' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚙️ PROJECT CONFIG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/revision/config/:projectId
 * GET /api/projects/:id/revision-config
 * الحصول على إعدادات المراجعة للمشروع
 */
export async function getProjectConfig(req: Request, res: Response): Promise<void> {
  try {
    const pool = getPool();
    // Support both :projectId and :id params
    const projectId = req.params.projectId || req.params.id;
    
    const result = await pool.query(`
      SELECT 
        prc.id,
        prc.project_id as "projectId",
        prc.formula_id as "formulaId",
        prc.base_indexes as "baseIndexes",
        prc.base_date as "baseDate",
        prc.is_enabled as "isEnabled",
        prc.notes,
        rf.name as "formulaName",
        rf.fixed_part as "fixedPart",
        rf.weights as "formulaWeights"
      FROM project_revision_config prc
      LEFT JOIN revision_formulas rf ON rf.id = prc.formula_id
      WHERE prc.project_id = $1
    `, [projectId]);
    
    if (result.rows.length === 0) {
      res.json(null);
      return;
    }
    
    const row = result.rows[0];
    // Restructure for frontend
    res.json({
      id: row.id,
      projectId: row.projectId,
      formula: row.formulaId ? {
        id: row.formulaId,
        name: row.formulaName,
        fixedPart: parseFloat(row.fixedPart) || 0.15,
        weights: row.formulaWeights || {}
      } : null,
      baseIndexes: row.baseIndexes,
      baseDate: row.baseDate,
      isEnabled: row.isEnabled,
      notes: row.notes
    });
  } catch (error) {
    logger.error('Error getting project config:', error);
    res.status(500).json({ error: 'Failed to get config' });
  }
}

/**
 * POST /api/revision/config/:projectId
 * POST /api/projects/:id/revision-config
 * إنشاء إعدادات المراجعة للمشروع
 * يدعم الآن الصيغة المضمّنة (inline formula)
 */
export async function createProjectConfig(req: Request, res: Response) {
  try {
    const pool = getPool();
    // Support both :projectId and :id params
    const projectId = req.params.projectId || req.params.id;
    const { formula, formulaId, baseIndexes, baseDate, isEnabled, notes } = req.body;
    
    // PHASE 2: Use transaction for atomic formula creation + config save
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let finalFormulaId = formulaId;
      
      // إذا تم إرسال صيغة مضمّنة، قم بحفظها أولاً
      if (formula && !formulaId) {
        const formulaResult = await client.query(`
          INSERT INTO revision_formulas (name, description, fixed_part, weights, is_default)
          VALUES ($1, $2, $3, $4, false)
          RETURNING id
        `, [
          formula.name || 'Formule personnalisée',
          formula.description || null,
          formula.fixedPart || 0.15,
          JSON.stringify(formula.weights || {})
        ]);
        finalFormulaId = formulaResult.rows[0].id;
      }
      
      // جلب مؤشرات الأساس من تاريخ الافتتاح إذا لم تُعطَ
      let finalBaseIndexes = baseIndexes || {};
      if (baseDate && Object.keys(finalBaseIndexes).length === 0) {
        const monthKey = baseDate.substring(0, 7) + '-01'; // YYYY-MM-01
        const indexResult = await client.query(`
          SELECT index_values FROM revision_indexes WHERE month_date = $1
        `, [monthKey]);
        if (indexResult.rows.length > 0) {
          finalBaseIndexes = indexResult.rows[0].index_values;
        }
      }
      
      const result = await client.query(`
        INSERT INTO project_revision_config 
          (project_id, formula_id, base_indexes, base_date, is_enabled, notes)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (project_id) DO UPDATE SET
          formula_id = EXCLUDED.formula_id,
          base_indexes = EXCLUDED.base_indexes,
          base_date = EXCLUDED.base_date,
          is_enabled = EXCLUDED.is_enabled,
          notes = EXCLUDED.notes,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [
        projectId, 
        finalFormulaId, 
        JSON.stringify(finalBaseIndexes), 
        baseDate || null, 
        isEnabled ?? true, 
        notes || null
      ]);

      await client.query('COMMIT');

      res.status(201).json({ 
        id: result.rows[0].id, 
        formulaId: finalFormulaId,
        baseIndexesLoaded: Object.keys(finalBaseIndexes).length,
        message: 'Config saved' 
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error creating project config:', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
}

/**
 * PUT /api/revision/config/:projectId
 * PUT /api/projects/:id/revision-config
 * تحديث إعدادات المراجعة للمشروع
 */
export async function updateProjectConfig(req: Request, res: Response) {
  try {
    const pool = getPool();
    // Support both :projectId and :id params
    const projectId = req.params.projectId || req.params.id;
    const { formula, formulaId, baseIndexes, baseDate, isEnabled, notes } = req.body;
    
    // PHASE 2: Use transaction for atomic formula update + config update
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let finalFormulaId = formulaId;
      
      // إذا تم إرسال صيغة مضمّنة بدلاً من formulaId
      if (formula && !formulaId) {
        const existingConfig = await client.query(
          'SELECT formula_id FROM project_revision_config WHERE project_id = $1',
          [projectId]
        );
        
        if (existingConfig.rows.length > 0 && existingConfig.rows[0].formula_id) {
          await client.query(`
            UPDATE revision_formulas
            SET name = $1, fixed_part = $2, weights = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
          `, [
            formula.name || `Project ${projectId} Formula`,
            formula.fixedPart,
            JSON.stringify(formula.weights),
            existingConfig.rows[0].formula_id
          ]);
          finalFormulaId = existingConfig.rows[0].formula_id;
        } else {
          const formulaResult = await client.query(`
            INSERT INTO revision_formulas (name, fixed_part, weights, is_public)
            VALUES ($1, $2, $3, false)
            RETURNING id
          `, [
            formula.name || `Project ${projectId} Formula`,
            formula.fixedPart,
            JSON.stringify(formula.weights)
          ]);
          finalFormulaId = formulaResult.rows[0].id;
        }
      }
      
      await client.query(`
        UPDATE project_revision_config
        SET 
          formula_id = $1,
          base_indexes = $2,
          base_date = $3,
          is_enabled = $4,
          notes = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE project_id = $6
      `, [
        finalFormulaId,
        JSON.stringify(baseIndexes),
        baseDate || null,
        isEnabled ?? true,
        notes || null,
        projectId
      ]);

      await client.query('COMMIT');
      res.json({ message: 'Config updated', formulaId: finalFormulaId });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error updating project config:', error);
    res.status(500).json({ error: 'Failed to update config' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧮 CALCULATION (Phase 3 - مُعطّل حالياً)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/revision/calculate
 * ⚠️ Phase 3 - حساب المراجعة (غير مفعّل بعد)
 */
export async function calculateRevision(req: Request, res: Response) {
  // Phase 3: Not implemented yet
  res.status(501).json({ 
    error: 'Not implemented', 
    message: 'Calculation will be available in Phase 3' 
  });
}
