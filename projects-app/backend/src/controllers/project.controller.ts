import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import path from 'path';
import fs from 'fs/promises';
import logger from '../utils/logger';

/**
 * SECURITY: Sanitize path components to prevent directory traversal
 */
const sanitizePath = (input: string): string => {
  return String(input).replace(/[^a-zA-Z0-9\-_\.]/g, '').substring(0, 50);
};

/**
 * Créer la structure de dossiers pour un projet
 */
const createProjectFolders = async (folderPath: string): Promise<void> => {
  const folders = [
    'Facture',
    'BP',
    'Photo',
    'Decompt',
    'Metre',
    'Detail',
    'Attachement',
    'PV',
    'Plans',
  ];

  const basePath = path.join(process.cwd(), 'uploads', folderPath);

  await fs.mkdir(basePath, { recursive: true });

  for (const folder of folders) {
    await fs.mkdir(path.join(basePath, folder), { recursive: true });
  }
};

/**
 * Create new project (PostgreSQL version)
 */
export const createProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const {
      objet,
      marcheNo,
      annee,
      dateOuverture,
      montant,
      typeMarche,
      commune,
      societe,
      rc,
      cb,
      cnss,
      patente,
      programme,
      projet,
      ligne,
      chapitre,
      delaisExecution,
      status,
      assistanceTechnique,
      maitreOeuvre,
      osc,
      dateReceptionProvisoire,
      dateReceptionDefinitive,
    } = req.body;

    if (!objet || !marcheNo || !annee) {
      throw new ApiError('Required fields missing', 400);
    }

    const pool = getPool();
    const projectId = uuidv4();
    
    // SECURITY: Sanitize path components to prevent directory traversal
    const safeAnnee = sanitizePath(String(annee));
    const safeMarcheNo = sanitizePath(String(marcheNo));
    if (!safeAnnee || !safeMarcheNo) {
      throw new ApiError('Invalid annee or marcheNo format', 400);
    }
    const folderPath = `${safeAnnee}/${safeMarcheNo}`;

    // Create project in PostgreSQL with all fields
    const result = await pool.query(
      `INSERT INTO projects (
        id, user_id, objet, marche_no, annee, date_ouverture, montant,
        type_marche, commune, societe, rc, cb, cnss, patente,
        programme, projet, ligne, chapitre, delais_execution,
        status, assistance_technique, maitre_oeuvre, osc, date_reception_provisoire, date_reception_definitive,
        progress, folder_path, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW(), NOW()
      ) RETURNING *`,
      [
        projectId,
        req.user.id,
        objet,
        marcheNo,
        annee,
        dateOuverture ? new Date(dateOuverture) : null,
        parseFloat(montant) || 0,
        typeMarche || null,
        commune || null,
        societe || null,
        rc || null,
        cb || null,
        cnss || null,
        patente || null,
        programme || null,
        projet || null,
        ligne || null,
        chapitre || null,
        delaisExecution ? parseInt(delaisExecution) : null,
        status || 'active',
        assistanceTechnique || null,
        maitreOeuvre || null,
        osc ? new Date(osc) : null,
        dateReceptionProvisoire ? new Date(dateReceptionProvisoire) : null,
        dateReceptionDefinitive ? new Date(dateReceptionDefinitive) : null,
        0,
        folderPath
      ]
    );

    // Create folder structure
    await createProjectFolders(folderPath);

    logger.info(`Project created: ${projectId} by user ${req.user.id}`);

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all projects for current user (PostgreSQL version)
 */
export const getProjects = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const pool = getPool();
    const { status, search, page, limit: limitParam, sort, order } = req.query;

    // Pagination params (backwards-compatible: no page = return all)
    const isPaginated = page !== undefined;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limitParam as string) || 20));
    const offset = (pageNum - 1) * pageSize;

    // Sort params
    const allowedSortFields: Record<string, string> = {
      created_at: 'created_at', date: 'created_at',
      marche_no: 'marche_no', objet: 'objet',
      montant: 'montant', status: 'status',
      updated_at: 'updated_at',
    };
    const sortField = allowedSortFields[(sort as string)?.toLowerCase()] || 'created_at';
    const sortOrder = (order as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    let query = `SELECT * FROM projects WHERE user_id = $1 AND deleted_at IS NULL`;
    let countQuery = `SELECT COUNT(*) FROM projects WHERE user_id = $1 AND deleted_at IS NULL`;
    const params: any[] = [req.user.id];
    const countParams: any[] = [req.user.id];
    let paramIndex = 2;

    if (status) {
      query += ` AND status = $${paramIndex}`;
      countQuery += ` AND status = $${paramIndex}`;
      params.push(status);
      countParams.push(status);
      paramIndex++;
    }

    // Search across multiple fields
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const searchTerm = `%${search.trim()}%`;
      query += ` AND (
        objet ILIKE $${paramIndex} OR 
        marche_no ILIKE $${paramIndex} OR 
        societe ILIKE $${paramIndex} OR 
        commune ILIKE $${paramIndex} OR 
        programme ILIKE $${paramIndex}
      )`;
      countQuery += ` AND (
        objet ILIKE $${paramIndex} OR 
        marche_no ILIKE $${paramIndex} OR 
        societe ILIKE $${paramIndex} OR 
        commune ILIKE $${paramIndex} OR 
        programme ILIKE $${paramIndex}
      )`;
      params.push(searchTerm);
      countParams.push(searchTerm);
      paramIndex++;
    }

    query += ` ORDER BY ${sortField} ${sortOrder}`;

    if (isPaginated) {
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(pageSize, offset);
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      isPaginated ? pool.query(countQuery, countParams) : Promise.resolve(null),
    ]);

    const totalCount = countResult ? parseInt(countResult.rows[0].count) : result.rows.length;

    logger.info(`Fetched ${result.rows.length} projects for user ${req.user.id}`);

    // Transform snake_case to camelCase
    const projects = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      objet: row.objet,
      marcheNo: row.marche_no,
      annee: row.annee,
      dateOuverture: row.date_ouverture,
      montant: parseFloat(row.montant) || 0,
      typeMarche: row.type_marche,
      commune: row.commune,
      societe: row.societe,
      rc: row.rc,
      cb: row.cb,
      cnss: row.cnss,
      patente: row.patente,
      programme: row.programme,
      projet: row.projet,
      ligne: row.ligne,
      chapitre: row.chapitre,
      ordreService: row.ordre_service,
      delaisExecution: row.delais_execution,
      assistanceTechnique: row.assistance_technique,
      maitreOeuvre: row.maitre_oeuvre,
      osc: row.osc,
      arrets: row.arrets,
      dateReceptionProvisoire: row.date_reception_provisoire,
      dateReceptionDefinitive: row.date_reception_definitive,
      achevementTravaux: row.achevement_travaux,
      penalites: row.penalites,
      status: row.status,
      progress: row.progress,
      folderPath: row.folder_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));

    res.json({
      success: true,
      data: projects,
      count: projects.length,
      ...(isPaginated && {
        pagination: {
          page: pageNum,
          limit: pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          hasMore: pageNum * pageSize < totalCount,
        },
      }),
    });
  } catch (error) {
    logger.error('Error fetching projects:', error);
    next(error);
  }
};

/**
 * Get project by ID (PostgreSQL version)
 */
export const getProjectById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    const row = result.rows[0];

    if (row.user_id !== req.user.id) {
      throw new ApiError('Not authorized', 403);
    }

    // Transform snake_case to camelCase
    const project = {
      id: row.id,
      userId: row.user_id,
      objet: row.objet,
      marcheNo: row.marche_no,
      annee: row.annee,
      dateOuverture: row.date_ouverture,
      montant: parseFloat(row.montant) || 0,
      typeMarche: row.type_marche,
      commune: row.commune,
      societe: row.societe,
      rc: row.rc,
      cb: row.cb,
      cnss: row.cnss,
      patente: row.patente,
      programme: row.programme,
      projet: row.projet,
      ligne: row.ligne,
      chapitre: row.chapitre,
      ordreService: row.ordre_service,
      delaisExecution: row.delais_execution,
      assistanceTechnique: row.assistance_technique,
      maitreOeuvre: row.maitre_oeuvre,
      osc: row.osc,
      arrets: row.arrets,
      dateReceptionProvisoire: row.date_reception_provisoire,
      dateReceptionDefinitive: row.date_reception_definitive,
      achevementTravaux: row.achevement_travaux,
      penalites: row.penalites,
      status: row.status,
      progress: row.progress,
      folderPath: row.folder_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };

    res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update project (PostgreSQL version)
 */
export const updateProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { id } = req.params;
    const pool = getPool();

    // Check if project exists and belongs to user
    const existing = await pool.query(
      `SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    if (existing.rows[0].user_id !== req.user.id) {
      throw new ApiError('Not authorized', 403);
    }

    const {
      objet,
      marcheNo,
      annee,
      dateOuverture,
      montant,
      typeMarche,
      commune,
      societe,
      rc,
      cb,
      cnss,
      patente,
      programme,
      projet,
      ligne,
      chapitre,
      delaisExecution,
      osc,
      status,
      progress,
      assistanceTechnique,
      maitreOeuvre,
      dateReceptionProvisoire,
      dateReceptionDefinitive,
    } = req.body;

    const result = await pool.query(
      `UPDATE projects SET
        objet = COALESCE($1, objet),
        marche_no = COALESCE($2, marche_no),
        annee = COALESCE($3, annee),
        date_ouverture = $4,
        montant = COALESCE($5, montant),
        type_marche = COALESCE($6, type_marche),
        commune = $7,
        societe = $8,
        rc = $9,
        cb = $10,
        cnss = $11,
        patente = $12,
        programme = $13,
        projet = $14,
        ligne = $15,
        chapitre = $16,
        delais_execution = $17,
        osc = $18,
        status = COALESCE($19, status),
        progress = COALESCE($20, progress),
        assistance_technique = $21,
        maitre_oeuvre = $22,
        date_reception_provisoire = $23,
        date_reception_definitive = $24,
        updated_at = NOW()
      WHERE id = $25
      RETURNING *`,
      [
        objet,
        marcheNo,
        annee,
        dateOuverture ? new Date(dateOuverture) : null,
        montant !== undefined ? parseFloat(montant) : null,
        typeMarche,
        commune || null,
        societe || null,
        rc || null,
        cb || null,
        cnss || null,
        patente || null,
        programme || null,
        projet || null,
        ligne || null,
        chapitre || null,
        delaisExecution ? parseInt(delaisExecution) : null,
        osc ? new Date(osc) : null,
        status,
        progress !== undefined ? parseInt(progress) : null,
        assistanceTechnique || null,
        maitreOeuvre || null,
        dateReceptionProvisoire ? new Date(dateReceptionProvisoire) : null,
        dateReceptionDefinitive ? new Date(dateReceptionDefinitive) : null,
        id
      ]
    );

    logger.info(`Project updated: ${id} by user ${req.user.id}`);

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete project (soft delete) (PostgreSQL version)
 */
export const deleteProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { id } = req.params;
    const pool = getPool();

    // Check if project exists and belongs to user
    const existing = await pool.query(
      `SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (existing.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    if (existing.rows[0].user_id !== req.user.id) {
      throw new ApiError('Not authorized', 403);
    }

    await pool.query(
      `UPDATE projects SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    logger.info(`Project deleted: ${id} by user ${req.user.id}`);

    res.json({
      success: true,
      message: 'Project deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get project folder structure (PostgreSQL version)
 */
export const getProjectStructure = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    const project = result.rows[0];

    if (project.user_id !== req.user.id) {
      throw new ApiError('Not authorized', 403);
    }

    const structure = {
      path: project.folder_path,
      folders: [
        'Facture',
        'BP',
        'Photo',
        'Decompt',
        'Metre',
        'Detail',
        'Attachement',
        'PV',
        'Plans',
      ],
    };

    res.json({
      success: true,
      data: structure,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get deleted projects (for trash/recycle bin)
 */
export const getDeletedProjects = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const pool = getPool();
    const result = await pool.query(
      `SELECT * FROM projects WHERE user_id = $1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
      [req.user.id]
    );

    const projects = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      objet: row.objet,
      marcheNo: row.marche_no,
      annee: row.annee,
      dateOuverture: row.date_ouverture,
      montant: parseFloat(row.montant),
      typeMarche: row.type_marche,
      commune: row.commune,
      societe: row.societe,
      rc: row.rc,
      cb: row.cb,
      cnss: row.cnss,
      patente: row.patente,
      programme: row.programme,
      projet: row.projet,
      ligne: row.ligne,
      chapitre: row.chapitre,
      ordreService: row.ordre_service,
      delaisExecution: row.delais_execution,
      osc: row.osc,
      arrets: row.arrets,
      dateReceptionProvisoire: row.date_reception_provisoire,
      dateReceptionDefinitive: row.date_reception_definitive,
      achevementTravaux: row.achevement_travaux,
      penalites: row.penalites,
      status: row.status,
      progress: row.progress,
      folderPath: row.folder_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));

    res.json({
      success: true,
      data: projects,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Restore a deleted project
 */
export const restoreProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      throw new ApiError('Not authenticated', 401);
    }

    const { id } = req.params;
    const pool = getPool();

    // Check if project exists and is deleted
    const checkResult = await pool.query(
      `SELECT * FROM projects WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      throw new ApiError('Deleted project not found', 404);
    }

    const project = checkResult.rows[0];

    if (project.user_id !== req.user.id) {
      throw new ApiError('Not authorized', 403);
    }

    // Restore project by setting deleted_at to NULL
    await pool.query(
      `UPDATE projects SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    // Get updated project
    const result = await pool.query(
      `SELECT * FROM projects WHERE id = $1`,
      [id]
    );

    const restoredProject = result.rows[0];

    res.json({
      success: true,
      data: {
        id: restoredProject.id,
        userId: restoredProject.user_id,
        objet: restoredProject.objet,
        marcheNo: restoredProject.marche_no,
        annee: restoredProject.annee,
        dateOuverture: restoredProject.date_ouverture,
        montant: parseFloat(restoredProject.montant),
        typeMarche: restoredProject.type_marche,
        commune: restoredProject.commune,
        societe: restoredProject.societe,
        rc: restoredProject.rc,
        cb: restoredProject.cb,
        cnss: restoredProject.cnss,
        patente: restoredProject.patente,
        programme: restoredProject.programme,
        projet: restoredProject.projet,
        ligne: restoredProject.ligne,
        chapitre: restoredProject.chapitre,
        ordreService: restoredProject.ordre_service,
        delaisExecution: restoredProject.delais_execution,
        osc: restoredProject.osc,
        arrets: restoredProject.arrets,
        dateReceptionProvisoire: restoredProject.date_reception_provisoire,
        dateReceptionDefinitive: restoredProject.date_reception_definitive,
        achevementTravaux: restoredProject.achevement_travaux,
        penalites: restoredProject.penalites,
        status: restoredProject.status,
        progress: restoredProject.progress,
        folderPath: restoredProject.folder_path,
        createdAt: restoredProject.created_at,
        updatedAt: restoredProject.updated_at,
        deletedAt: restoredProject.deleted_at,
      },
    });
  } catch (error) {
    next(error);
  }
};
