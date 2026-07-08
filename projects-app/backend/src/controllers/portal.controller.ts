import { Request, Response, NextFunction } from 'express';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { keysToCamel } from '../utils/transform';
import logger from '../utils/logger';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// Client Portal Controller — Portail Client
// بوابة العميل
// ═══════════════════════════════════════════════════════════════

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ─── Helper: verify project ownership ───
async function verifyProject(projectId: string, userId: string) {
  const result = await getPool().query(
    'SELECT id, objet, marche_no, societe, commune, montant FROM projects WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [projectId, userId]
  );
  return result.rows.length > 0 ? keysToCamel(result.rows[0]) : null;
}

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATED ENDPOINTS (require login)
// ═══════════════════════════════════════════════════════════════

// CREATE SHARE LINK
export const createShareLink = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const {
      projectId, label, recipientName, recipientEmail, recipientRole,
      permissions, pinCode, expiresAt, maxViews
    } = req.body;

    if (!projectId) throw new ApiError('projectId is required', 400);

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const token = generateToken();

    const result = await getPool().query(
      `INSERT INTO project_share_links (
        project_id, user_id, token, label,
        recipient_name, recipient_email, recipient_role,
        permissions, pin_code, expires_at, max_views
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *`,
      [
        projectId, req.user.id, token,
        label || 'Lien de partage',
        recipientName || null,
        recipientEmail || null,
        recipientRole || 'client',
        JSON.stringify(permissions || {
          overview: true, financials: true, photos: true, documents: false,
          bordereaux: false, decompts: true, diary: false, ods: false
        }),
        pinCode || null,
        expiresAt || null,
        maxViews || null
      ]
    );

    logger.info('Share link created', {
      linkId: result.rows[0].id,
      projectId,
      recipientName
    });

    res.status(201).json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// LIST SHARE LINKS FOR PROJECT
export const getShareLinks = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { projectId } = req.params;

    const project = await verifyProject(projectId, req.user.id);
    if (!project) throw new ApiError('Projet non trouvé', 404);

    const result = await getPool().query(
      `SELECT * FROM project_share_links
       WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [projectId, req.user.id]
    );

    res.json({ success: true, data: result.rows.map(keysToCamel) });
  } catch (error) {
    next(error);
  }
};

// TOGGLE SHARE LINK ACTIVE STATUS
export const toggleShareLink = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    const result = await getPool().query(
      `UPDATE project_share_links
       SET is_active = NOT is_active
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, req.user.id]
    );

    if (result.rows.length === 0) throw new ApiError('Lien non trouvé', 404);

    logger.info('Share link toggled', { linkId: id, active: result.rows[0].is_active });
    res.json({ success: true, data: keysToCamel(result.rows[0]) });
  } catch (error) {
    next(error);
  }
};

// DELETE SHARE LINK
export const deleteShareLink = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    await getPool().query(
      'UPDATE project_share_links SET deleted_at = NOW() WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    res.json({ success: true, message: 'Lien supprimé' });
  } catch (error) {
    next(error);
  }
};

// GET ACCESS LOG FOR A LINK
export const getAccessLog = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    const { id } = req.params;

    // Verify ownership
    const link = await getPool().query(
      'SELECT id FROM project_share_links WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
      [id, req.user.id]
    );
    if (link.rows.length === 0) throw new ApiError('Lien non trouvé', 404);

    const result = await getPool().query(
      `SELECT * FROM portal_access_log
       WHERE share_link_id = $1
       ORDER BY accessed_at DESC LIMIT 50`,
      [id]
    );

    res.json({ success: true, data: result.rows.map(keysToCamel) });
  } catch (error) {
    next(error);
  }
};

// ═══════════════════════════════════════════════════════════════
// PUBLIC ENDPOINTS (no auth required — token-based)
// ═══════════════════════════════════════════════════════════════

// VERIFY TOKEN + GET PROJECT OVERVIEW
export const getPortalData = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;
    const { pin } = req.query;

    // Find the share link
    const linkResult = await getPool().query(
      `SELECT sl.*, p.id as p_id, p.objet, p.marche_no, p.societe, p.commune,
              p.programme, p.montant, p.delais_execution, p.date_ouverture,
              p.osc, p.achevement_travaux, p.status as project_status,
              p.created_at as p_created,
              u.first_name as owner_first, u.last_name as owner_last
       FROM project_share_links sl
       INNER JOIN projects p ON sl.project_id = p.id
       INNER JOIN users u ON sl.user_id = u.id
       WHERE sl.token = $1 AND sl.is_active = true AND sl.deleted_at IS NULL AND p.deleted_at IS NULL`,
      [token]
    );

    if (linkResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Lien invalide ou expiré' });
      return;
    }

    const link = keysToCamel<any>(linkResult.rows[0]);

    // Check expiration
    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      res.status(410).json({ success: false, error: 'Ce lien a expiré' });
      return;
    }

    // Check max views
    if (link.maxViews && link.viewCount >= link.maxViews) {
      res.status(410).json({ success: false, error: 'Nombre maximum de consultations atteint' });
      return;
    }

    // Check PIN
    if (link.pinCode) {
      if (!pin || pin !== link.pinCode) {
        res.json({
          success: true,
          requirePin: true,
          data: {
            label: link.label,
            recipientName: link.recipientName,
            projectName: link.objet,
          }
        });
        return;
      }
    }

    // Increment view count + update last accessed
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await getPool().query(
      `UPDATE project_share_links
       SET view_count = view_count + 1, last_accessed_at = NOW(), last_accessed_ip = $2
       WHERE id = $1`,
      [link.id, typeof clientIp === 'string' ? clientIp : (clientIp as string[])[0]]
    );

    // Log access
    await getPool().query(
      `INSERT INTO portal_access_log (share_link_id, project_id, ip_address, user_agent, section_viewed)
       VALUES ($1, $2, $3, $4, 'overview')`,
      [link.id, link.projectId, typeof clientIp === 'string' ? clientIp : (clientIp as string[])[0], req.headers['user-agent'] || '']
    );

    const permissions = link.permissions || {};
    const projectId = link.projectId;
    const portalData: any = {
      link: {
        label: link.label,
        recipientName: link.recipientName,
        recipientRole: link.recipientRole,
        permissions,
      },
      project: {
        objet: link.objet,
        marcheNo: link.marcheNo,
        societe: link.societe,
        commune: link.commune,
        programme: link.programme,
        montant: link.montant,
        delaisExecution: link.delaisExecution,
        dateOuverture: link.dateOuverture,
        dateOsCommencement: link.osc,
        dateFinTravaux: link.achevementTravaux,
        statut: link.projectStatus,
        owner: `${link.ownerFirst || ''} ${link.ownerLast || ''}`.trim(),
      },
    };

    // Fetch permitted sections
    if (permissions.financials) {
      const decompts = await getPool().query(
        `SELECT numero, date_decompte, montant_cumule, montant_actuel, total_ttc, statut
         FROM decompts WHERE project_id = $1 AND deleted_at IS NULL ORDER BY numero`,
        [projectId]
      );
      portalData.decompts = decompts.rows.map(keysToCamel);

      // Financial summary
      const lastDecompt = decompts.rows.length > 0 ? keysToCamel<any>(decompts.rows[decompts.rows.length - 1]) : null;
      portalData.financialSummary = {
        montantMarche: link.montant,
        montantCumule: lastDecompt?.montantCumule || 0,
        totalTtc: lastDecompt?.totalTtc || 0,
        nombreDecomptes: decompts.rows.length,
        avancementFinancier: link.montant > 0 ? ((lastDecompt?.montantCumule || 0) / link.montant * 100).toFixed(1) : '0',
      };
    }

    if (permissions.photos) {
      const photos = await getPool().query(
        `SELECT id, file_name, description, tags, created_at
         FROM photos WHERE project_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT 20`,
        [projectId]
      );
      portalData.photos = photos.rows.map(keysToCamel);
    }

    if (permissions.bordereaux) {
      const bordereaux = await getPool().query(
        `SELECT id, reference, designation, montant_total
         FROM bordereaux WHERE project_id = $1 AND deleted_at IS NULL`,
        [projectId]
      );
      portalData.bordereaux = bordereaux.rows.map(keysToCamel);
    }

    if (permissions.diary) {
      const diary = await getPool().query(
        `SELECT entry_date, entry_number, weather, workforce_own, workforce_subcontractor,
                workforce_supervisors, statut
         FROM site_diary_entries WHERE project_id = $1 AND deleted_at IS NULL
         ORDER BY entry_date DESC LIMIT 10`,
        [projectId]
      );
      portalData.recentDiary = diary.rows.map(keysToCamel);
    }

    if (permissions.ods) {
      const ods = await getPool().query(
        `SELECT numero, reference, type, objet, statut, date_emission, impact_financier
         FROM ordres_service WHERE project_id = $1 AND deleted_at IS NULL
         ORDER BY numero`,
        [projectId]
      );
      portalData.ods = ods.rows.map(keysToCamel);
    }

    // Penalties summary (always included if financials enabled)
    if (permissions.financials) {
      const penalties = await getPool().query(
        `SELECT COUNT(*) as count, COALESCE(SUM(montant_applique),0) as total
         FROM penalties WHERE project_id = $1 AND deleted_at IS NULL AND statut != 'annulee'`,
        [projectId]
      );
      portalData.penaltiesSummary = keysToCamel(penalties.rows[0]);

      const avenants = await getPool().query(
        `SELECT COUNT(*) as count, COALESCE(SUM(montant_avenant),0) as total
         FROM avenants WHERE project_id = $1 AND deleted_at IS NULL AND statut != 'rejete'`,
        [projectId]
      );
      portalData.avenantsSummary = keysToCamel(avenants.rows[0]);
    }

    res.json({ success: true, data: portalData });
  } catch (error) {
    next(error);
  }
};
