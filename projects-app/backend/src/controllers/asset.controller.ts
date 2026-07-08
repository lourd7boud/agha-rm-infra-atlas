/**
 * Project Asset Controller (Unified V1)
 * Single controller for all project assets: photos, PV, documents
 * 
 * Architecture: One table, one API, different types
 */

import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { getPool } from '../config/postgres';
import { ApiError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';
import PDFDocument from 'pdfkit';
import { generateAllThumbnails, getOrGenerateThumbnail, isThumbnailable, THUMBNAIL_SIZES } from '../utils/thumbnailService';

// Valid asset types
type AssetType = 'photo' | 'pv' | 'document';

/**
 * Fix UTF-8 encoding for filenames from browser uploads
 * Browsers sometimes send filenames in Latin-1 encoding
 */
function fixFilenameEncoding(filename: string): string {
  try {
    // Try to decode as Latin-1 then re-encode as UTF-8
    const decoded = Buffer.from(filename, 'latin1').toString('utf8');
    // Check if the result looks valid (no replacement characters)
    if (!decoded.includes('\ufffd') && decoded !== filename) {
      return decoded;
    }
    return filename;
  } catch {
    return filename;
  }
}

/**
 * List assets by project and type
 */
export const listAssets = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const { type, search, page, limit: limitParam } = req.query;

    const pool = getPool();

    // Pagination (backwards-compatible)
    const isPaginated = page !== undefined;
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(limitParam as string) || 50));
    const offset = (pageNum - 1) * pageSize;

    // Build query
    let query = `
      SELECT pa.*, u.first_name, u.last_name 
      FROM project_assets pa
      LEFT JOIN users u ON pa.created_by = u.id
      WHERE pa.project_id = $1 AND pa.deleted_at IS NULL
    `;
    let countQuery = `
      SELECT COUNT(*) FROM project_assets pa
      WHERE pa.project_id = $1 AND pa.deleted_at IS NULL
    `;
    const params: any[] = [projectId];
    const countParams: any[] = [projectId];
    let paramIndex = 2;

    if (type && ['photo', 'pv', 'document'].includes(type as string)) {
      query += ` AND pa.type = $${paramIndex}`;
      countQuery += ` AND pa.type = $${paramIndex}`;
      params.push(type);
      countParams.push(type);
      paramIndex++;
    }

    // Search by original filename
    if (search && typeof search === 'string' && search.trim().length > 0) {
      query += ` AND pa.original_name ILIKE $${paramIndex}`;
      countQuery += ` AND pa.original_name ILIKE $${paramIndex}`;
      params.push(`%${search.trim()}%`);
      countParams.push(`%${search.trim()}%`);
      paramIndex++;
    }

    query += ` ORDER BY pa.created_at DESC`;

    if (isPaginated) {
      query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(pageSize, offset);
    }

    const [result, countResult] = await Promise.all([
      pool.query(query, params),
      isPaginated ? pool.query(countQuery, countParams) : Promise.resolve(null),
    ]);

    const totalCount = countResult ? parseInt(countResult.rows[0].count) : result.rows.length;

    // Transform to camelCase
    const assets = result.rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      type: row.type,
      fileName: row.file_name,
      originalName: row.original_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      storagePath: row.storage_path,
      createdBy: row.created_by,
      createdByName: row.first_name && row.last_name 
        ? `${row.first_name} ${row.last_name}` 
        : null,
      metadata: row.metadata,
      albumId: row.album_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({
      success: true,
      data: assets,
      count: assets.length,
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
    logger.error('Error listing assets:', error);
    next(error);
  }
};

/**
 * Upload asset (photo or document)
 */
export const uploadAsset = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    if (!req.file) throw new ApiError('No file uploaded', 400);

    const { projectId } = req.params;
    const { type } = req.body;

    // Validate type
    if (!type || !['photo', 'document'].includes(type)) {
      throw new ApiError('Invalid asset type. Must be "photo" or "document"', 400);
    }

    const pool = getPool();

    // Verify project exists
    const project = await pool.query(
      'SELECT id, folder_path FROM projects WHERE id = $1 AND deleted_at IS NULL',
      [projectId]
    );

    if (project.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    const folderPath = project.rows[0].folder_path || projectId;

    // Determine subfolder based on type
    const subfolder = type === 'photo' ? 'Photos' : 'Documents';

    // Create destination path
    const destDir = path.join(process.cwd(), 'uploads', folderPath, subfolder);
    await fs.mkdir(destDir, { recursive: true });

    // Generate unique filename
    const ext = path.extname(req.file.originalname);
    const uniqueName = `${uuidv4()}${ext}`;
    const destPath = path.join(destDir, uniqueName);

    // Move file from temp to destination
    await fs.rename(req.file.path, destPath);

    // Storage path (relative URL)
    const storagePath = `/uploads/${folderPath}/${subfolder}/${uniqueName}`;

    // Fix filename encoding
    const originalName = fixFilenameEncoding(req.file.originalname);

    // Insert into database
    const assetId = uuidv4();
    const result = await pool.query(
      `INSERT INTO project_assets (
        id, project_id, type, file_name, original_name, mime_type, file_size, storage_path, created_by, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        assetId,
        projectId,
        type,
        uniqueName,
        originalName,
        req.file.mimetype,
        req.file.size,
        storagePath,
        req.user.id,
        JSON.stringify({})
      ]
    );

    const asset = result.rows[0];

    logger.info(`Asset uploaded: ${assetId} (${type})`);

    // Generate thumbnails in background for images
    if (type === 'photo' && isThumbnailable(req.file.mimetype)) {
      generateAllThumbnails(destPath).catch(err =>
        logger.warn(`Background thumbnail generation failed: ${err.message}`)
      );
    }

    res.status(201).json({
      success: true,
      data: {
        id: asset.id,
        projectId: asset.project_id,
        type: asset.type,
        fileName: asset.file_name,
        originalName: asset.original_name,
        mimeType: asset.mime_type,
        fileSize: asset.file_size,
        storagePath: asset.storage_path,
        createdBy: asset.created_by,
        metadata: asset.metadata,
        createdAt: asset.created_at,
      },
    });
  } catch (error) {
    logger.error('Error uploading asset:', error);
    next(error);
  }
};

/**
 * Upload multiple photos at once
 */
export const uploadMultiplePhotos = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      throw new ApiError('No files uploaded', 400);
    }

    const { projectId } = req.params;
    const { albumId } = req.body; // Optional album ID
    const pool = getPool();

    // Verify project exists
    const project = await pool.query(
      'SELECT id, folder_path FROM projects WHERE id = $1 AND deleted_at IS NULL',
      [projectId]
    );

    if (project.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    // If albumId provided, verify it exists and belongs to this project
    if (albumId) {
      const album = await pool.query(
        'SELECT id FROM photo_albums WHERE id = $1 AND project_id = $2',
        [albumId, projectId]
      );
      if (album.rows.length === 0) {
        throw new ApiError('Album not found', 404);
      }
    }

    const folderPath = project.rows[0].folder_path || projectId;
    const destDir = path.join(process.cwd(), 'uploads', folderPath, 'Photos');
    await fs.mkdir(destDir, { recursive: true });

    const uploadedAssets = [];

    for (const file of req.files) {
      try {
        const ext = path.extname(file.originalname);
        const uniqueName = `${uuidv4()}${ext}`;
        const destPath = path.join(destDir, uniqueName);

        await fs.rename(file.path, destPath);

        const storagePath = `/uploads/${folderPath}/Photos/${uniqueName}`;
        const assetId = uuidv4();

        // Fix filename encoding
        const originalName = fixFilenameEncoding(file.originalname);

        const result = await pool.query(
          `INSERT INTO project_assets (
            id, project_id, type, file_name, original_name, mime_type, file_size, storage_path, created_by, album_id
          ) VALUES ($1, $2, 'photo', $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
          [assetId, projectId, uniqueName, originalName, file.mimetype, file.size, storagePath, req.user.id, albumId || null]
        );

        uploadedAssets.push({
          id: result.rows[0].id,
          fileName: result.rows[0].file_name,
          originalName: result.rows[0].original_name,
          storagePath: result.rows[0].storage_path,
          fileSize: result.rows[0].file_size,
          albumId: result.rows[0].album_id,
        });

        // Generate thumbnails in background (non-blocking)
        if (isThumbnailable(file.mimetype)) {
          generateAllThumbnails(destPath).catch(err =>
            logger.warn(`Background thumbnail generation failed: ${err.message}`)
          );
        }
      } catch (fileError) {
        logger.error(`Error processing file ${file.originalname}:`, fileError);
      }
    }

    logger.info(`${uploadedAssets.length} photos uploaded for project ${projectId}`);

    res.status(201).json({
      success: true,
      data: uploadedAssets,
      count: uploadedAssets.length,
    });
  } catch (error) {
    logger.error('Error uploading multiple photos:', error);
    next(error);
  }
};

/**
 * Create PV (Procès-Verbal) with PDF generation - Enhanced V2
 */
export const createPV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const pvData = req.body;
    const { pvType, pvTypeCode, date } = pvData;

    if (!pvType || !date) {
      throw new ApiError('PV type and date are required', 400);
    }

    const pool = getPool();

    // Get project info for PDF
    const projectResult = await pool.query(
      `SELECT p.*, u.first_name, u.last_name 
       FROM projects p 
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    const project = projectResult.rows[0];
    const folderPath = project.folder_path || projectId;

    // Create PV folder
    const pvDir = path.join(process.cwd(), 'uploads', folderPath, 'PV');
    await fs.mkdir(pvDir, { recursive: true });

    // Generate PDF
    const pvId = uuidv4();
    const safeTypeName = (pvTypeCode || pvType).replace(/[^a-zA-Z0-9_-]/g, '_');
    const pdfFileName = `PV_${safeTypeName}_${date}_${pvId.substring(0, 8)}.pdf`;
    const pdfPath = path.join(pvDir, pdfFileName);

    await generatePVPdfV2(pdfPath, {
      ...pvData,
      project: {
        marcheNo: project.marche_no,
        objet: project.objet,
        societe: project.societe,
        client: project.maitre_ouvrage,
      },
      createdBy: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
    });

    // Get file size
    const stats = await fs.stat(pdfPath);
    const storagePath = `/uploads/${folderPath}/PV/${pdfFileName}`;

    // Save to database with all metadata
    const result = await pool.query(
      `INSERT INTO project_assets (
        id, project_id, type, file_name, original_name, mime_type, file_size, storage_path, created_by, metadata
      ) VALUES ($1, $2, 'pv', $3, $4, 'application/pdf', $5, $6, $7, $8)
      RETURNING *`,
      [
        pvId,
        projectId,
        pdfFileName,
        pdfFileName,
        stats.size,
        storagePath,
        req.user.id,
        JSON.stringify(pvData)
      ]
    );

    logger.info(`PV created: ${pvId} - ${pvType}`);

    res.status(201).json({
      success: true,
      data: {
        id: result.rows[0].id,
        projectId: result.rows[0].project_id,
        type: 'pv',
        fileName: result.rows[0].file_name,
        storagePath: result.rows[0].storage_path,
        metadata: result.rows[0].metadata,
        createdAt: result.rows[0].created_at,
      },
    });
  } catch (error) {
    logger.error('Error creating PV:', error);
    next(error);
  }
};

/**
 * Generate PV PDF document - Enhanced V2 with dynamic fields
 */
async function generatePVPdfV2(
  filePath: string,
  data: any
) {
  return new Promise<void>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = require('fs').createWriteStream(filePath);
      
      doc.pipe(stream);

      const pageWidth = doc.page.width;
      const margin = 50;
      const contentWidth = pageWidth - margin * 2;

      // ═══════════════════════════════════════════════════════════════════
      // HEADER
      // ═══════════════════════════════════════════════════════════════════
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#1a365d')
        .text('PROCÈS-VERBAL', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(16).fillColor('#2d3748')
        .text(data.pvType?.toUpperCase() || 'PV', { align: 'center' });
      
      // Horizontal line
      doc.moveDown();
      doc.strokeColor('#e2e8f0').lineWidth(1)
        .moveTo(margin, doc.y)
        .lineTo(pageWidth - margin, doc.y)
        .stroke();
      doc.moveDown();

      // ═══════════════════════════════════════════════════════════════════
      // PROJECT INFO BOX
      // ═══════════════════════════════════════════════════════════════════
      const boxY = doc.y;
      doc.fillColor('#f7fafc').rect(margin, boxY, contentWidth, 70).fill();
      doc.strokeColor('#e2e8f0').rect(margin, boxY, contentWidth, 70).stroke();

      doc.fillColor('#2d3748').font('Helvetica-Bold').fontSize(10);
      
      // Left column
      doc.text('Marché N°:', margin + 10, boxY + 10);
      doc.font('Helvetica').text(data.project?.marcheNo || '-', margin + 80, boxY + 10);
      
      doc.font('Helvetica-Bold').text('Objet:', margin + 10, boxY + 28);
      doc.font('Helvetica').text(data.project?.objet || '-', margin + 80, boxY + 28, { width: contentWidth/2 - 90 });
      
      // Right column
      doc.font('Helvetica-Bold').text('Date:', margin + contentWidth/2, boxY + 10);
      doc.font('Helvetica').text(data.date || '-', margin + contentWidth/2 + 50, boxY + 10);
      
      doc.font('Helvetica-Bold').text('Société:', margin + contentWidth/2, boxY + 28);
      doc.font('Helvetica').text(data.project?.societe || '-', margin + contentWidth/2 + 50, boxY + 28);
      
      if (data.heureDebut) {
        doc.font('Helvetica-Bold').text('Heure:', margin + contentWidth/2, boxY + 46);
        doc.font('Helvetica').text(`${data.heureDebut}${data.heureFin ? ' - ' + data.heureFin : ''}`, margin + contentWidth/2 + 50, boxY + 46);
      }

      doc.y = boxY + 80;

      // ═══════════════════════════════════════════════════════════════════
      // DYNAMIC CONTENT BASED ON PV TYPE
      // ═══════════════════════════════════════════════════════════════════
      doc.fontSize(11);

      // Installation de chantier specific fields
      if (data.pvTypeCode === 'installation_chantier') {
        renderSection(doc, 'Lieu d\'installation', data.lieuInstallation);
        if (data.superficieBase) renderSection(doc, 'Superficie base vie', `${data.superficieBase} m²`);
        
        if (data.checklist && Object.keys(data.checklist).length > 0) {
          doc.moveDown();
          doc.font('Helvetica-Bold').fillColor('#2d3748').text('Installations réalisées:');
          doc.moveDown(0.3);
          Object.entries(data.checklist).forEach(([item, checked]) => {
            if (checked) {
              doc.font('Helvetica').fillColor('#2d3748').text(`  ✓ ${item}`);
            }
          });
        }
      }

      // Réunion de chantier specific fields
      if (data.pvTypeCode === 'reunion_chantier') {
        if (data.numeroReunion) renderSection(doc, 'Réunion N°', data.numeroReunion);
        renderSection(doc, 'Ordre du jour', data.ordreJour);
        renderSection(doc, 'Points discutés', data.pointsDiscutes);
        renderSection(doc, 'Décisions prises', data.decisions);
        renderSection(doc, 'Actions à suivre', data.actionsSuivre);
        if (data.prochaineReunion) renderSection(doc, 'Prochaine réunion', data.prochaineReunion);
      }

      // Constat specific fields
      if (data.pvTypeCode === 'constat') {
        renderSection(doc, 'Type de constat', data.typeConstat);
        renderSection(doc, 'Objet', data.objet);
        renderSection(doc, 'Localisation', data.localisation);
        renderSection(doc, 'Description', data.description);
        renderSection(doc, 'Mesures / Dimensions', data.mesures);
        renderSection(doc, 'Conclusion', data.conclusionConstat);
      }

      // Réception provisoire specific fields
      if (data.pvTypeCode === 'reception_provisoire') {
        if (data.numeroMarche) renderSection(doc, 'N° Marché', data.numeroMarche);
        renderSection(doc, 'Objet du marché', data.objetMarche);
        if (data.montantMarche) renderSection(doc, 'Montant du marché', `${Number(data.montantMarche).toLocaleString('fr-FR')} MAD`);
        if (data.dateDebutTravaux) renderSection(doc, 'Date début travaux', data.dateDebutTravaux);
        if (data.dateFinTravaux) renderSection(doc, 'Date fin travaux', data.dateFinTravaux);
        if (data.delaiExecution) renderSection(doc, 'Délai d\'exécution', `${data.delaiExecution} jours`);
        renderSection(doc, 'Résultat', data.resultatReception);
        renderSection(doc, 'Réserves', data.reserves);
        if (data.delaiLeveeReserves) renderSection(doc, 'Délai levée réserves', `${data.delaiLeveeReserves} jours`);
      }

      // Réception définitive specific fields
      if (data.pvTypeCode === 'reception_definitive') {
        if (data.numeroMarche) renderSection(doc, 'N° Marché', data.numeroMarche);
        renderSection(doc, 'Objet du marché', data.objetMarche);
        if (data.dateReceptionProvisoire) renderSection(doc, 'Date réception provisoire', data.dateReceptionProvisoire);
        if (data.dureeGarantie) renderSection(doc, 'Durée de garantie', `${data.dureeGarantie} mois`);
        renderSection(doc, 'Réserves levées', data.reservesLevees);
        renderSection(doc, 'État de l\'ouvrage', data.etatOuvrage);
        renderSection(doc, 'Conclusion', data.conclusion);
      }

      // Arrêt de travaux specific fields
      if (data.pvTypeCode === 'arret_travaux') {
        renderSection(doc, 'Motif de l\'arrêt', data.motifArret);
        renderSection(doc, 'Détail du motif', data.detailMotif);
        if (data.etatAvancement) renderSection(doc, 'Avancement', `${data.etatAvancement}%`);
        renderSection(doc, 'Travaux en cours', data.travauxEnCours);
        renderSection(doc, 'Mesures de conservation', data.mesuresConservation);
        if (data.dateReprisePrevue) renderSection(doc, 'Date reprise prévue', data.dateReprisePrevue);
      }

      // Reprise de travaux specific fields
      if (data.pvTypeCode === 'reprise_travaux') {
        if (data.dateArret) renderSection(doc, 'Date de l\'arrêt', data.dateArret);
        if (data.dureeArret) renderSection(doc, 'Durée de l\'arrêt', `${data.dureeArret} jours`);
        renderSection(doc, 'Motif arrêt', data.motifArret);
        renderSection(doc, 'État du chantier', data.etatChantier);
        renderSection(doc, 'Travaux prévus', data.travauxPrevus);
        renderSection(doc, 'Nouveau délai', data.nouveauDelai);
      }

      // Autre PV specific fields
      if (data.pvTypeCode === 'autre') {
        renderSection(doc, 'Titre', data.titre);
        renderSection(doc, 'Contenu', data.contenu);
      }

      // Generic observations (fallback for old format)
      if (data.observations) {
        renderSection(doc, 'Observations', data.observations);
      }

      // ═══════════════════════════════════════════════════════════════════
      // PARTICIPANTS
      // ═══════════════════════════════════════════════════════════════════
      if (data.participants && data.participants.length > 0) {
        doc.moveDown();
        doc.font('Helvetica-Bold').fillColor('#2d3748').text('Participants / Présents:');
        doc.moveDown(0.3);
        data.participants.forEach((p: string) => {
          doc.font('Helvetica').text(`  • ${p}`);
        });
      }

      // ═══════════════════════════════════════════════════════════════════
      // SIGNATURES
      // ═══════════════════════════════════════════════════════════════════
      // Ensure enough space for signatures
      if (doc.y > doc.page.height - 200) {
        doc.addPage();
      }

      doc.moveDown(3);
      doc.strokeColor('#e2e8f0').lineWidth(1)
        .moveTo(margin, doc.y)
        .lineTo(pageWidth - margin, doc.y)
        .stroke();
      doc.moveDown();

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#2d3748')
        .text('SIGNATURES', { align: 'center' });
      doc.moveDown(2);

      // Three columns for signatures
      const sigY = doc.y;
      const colWidth = contentWidth / 3;

      doc.fontSize(10);
      doc.font('Helvetica-Bold').text('Le Maître d\'Ouvrage', margin, sigY, { width: colWidth, align: 'center' });
      doc.font('Helvetica-Bold').text('Le Maître d\'Œuvre', margin + colWidth, sigY, { width: colWidth, align: 'center' });
      doc.font('Helvetica-Bold').text('L\'Entrepreneur', margin + colWidth * 2, sigY, { width: colWidth, align: 'center' });

      const lineY = sigY + 50;
      doc.strokeColor('#2d3748').lineWidth(0.5);
      doc.moveTo(margin + 20, lineY).lineTo(margin + colWidth - 20, lineY).stroke();
      doc.moveTo(margin + colWidth + 20, lineY).lineTo(margin + colWidth * 2 - 20, lineY).stroke();
      doc.moveTo(margin + colWidth * 2 + 20, lineY).lineTo(pageWidth - margin - 20, lineY).stroke();

      // ═══════════════════════════════════════════════════════════════════
      // FOOTER
      // ═══════════════════════════════════════════════════════════════════
      doc.fontSize(9).font('Helvetica').fillColor('#718096')
        .text(
          `Document généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')} par ${data.createdBy}`,
          margin, doc.page.height - 40,
          { align: 'center', width: contentWidth }
        );

      doc.end();

      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

// Helper function to render a section in the PDF
function renderSection(doc: any, label: string, value: any) {
  if (!value) return;
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fillColor('#4a5568').text(`${label}:`);
  doc.font('Helvetica').fillColor('#2d3748').text(String(value), { indent: 10 });
}

/**
 * Generate PV PDF document (Legacy - kept for compatibility)
 */
async function generatePVPdf(
  filePath: string,
  data: {
    pvType: string;
    date: string;
    observations?: string;
    participants?: string[];
    project: { marcheNo: string; objet: string; societe: string };
    createdBy: string;
  }
) {
  return new Promise<void>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = require('fs').createWriteStream(filePath);
      
      doc.pipe(stream);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text('PROCÈS-VERBAL', { align: 'center' });
      doc.moveDown();
      doc.fontSize(16).text(data.pvType.toUpperCase(), { align: 'center' });
      doc.moveDown(2);

      // Project info
      doc.fontSize(12).font('Helvetica-Bold').text('Marché N°: ', { continued: true });
      doc.font('Helvetica').text(data.project.marcheNo || '-');
      
      doc.font('Helvetica-Bold').text('Objet: ', { continued: true });
      doc.font('Helvetica').text(data.project.objet || '-');
      
      doc.font('Helvetica-Bold').text('Société: ', { continued: true });
      doc.font('Helvetica').text(data.project.societe || '-');
      
      doc.moveDown();
      doc.font('Helvetica-Bold').text('Date: ', { continued: true });
      doc.font('Helvetica').text(data.date);

      doc.moveDown(2);

      // Observations
      if (data.observations) {
        doc.font('Helvetica-Bold').text('Observations:');
        doc.moveDown(0.5);
        doc.font('Helvetica').text(data.observations);
        doc.moveDown(2);
      }

      // Participants
      if (data.participants && data.participants.length > 0) {
        doc.font('Helvetica-Bold').text('Participants:');
        doc.moveDown(0.5);
        data.participants.forEach(p => {
          doc.font('Helvetica').text(`• ${p}`);
        });
        doc.moveDown(2);
      }

      // Signatures section
      doc.moveDown(3);
      doc.font('Helvetica-Bold').text('Signatures:', { underline: true });
      doc.moveDown(2);

      // Two columns for signatures
      const leftX = 50;
      const rightX = 350;
      const y = doc.y;

      doc.text('Le Maître d\'Ouvrage:', leftX, y);
      doc.text('L\'Entrepreneur:', rightX, y);
      
      doc.moveDown(4);
      doc.text('_______________________', leftX);
      doc.text('_______________________', rightX, doc.y - 14);

      // Footer
      doc.moveDown(4);
      doc.fontSize(10).font('Helvetica').fillColor('gray')
        .text(`Généré le ${new Date().toLocaleDateString('fr-FR')} par ${data.createdBy}`, { align: 'center' });

      doc.end();

      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Upload PV files (PDF or images)
 */
export const uploadPV = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const { pvType, date, description } = req.body;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      throw new ApiError('No files uploaded', 400);
    }

    if (!pvType) {
      throw new ApiError('PV type is required', 400);
    }

    const pool = getPool();

    // Get project info
    const projectResult = await pool.query(
      `SELECT folder_path FROM projects WHERE id = $1 AND deleted_at IS NULL`,
      [projectId]
    );

    if (projectResult.rows.length === 0) {
      throw new ApiError('Project not found', 404);
    }

    const folderPath = projectResult.rows[0].folder_path || projectId;

    // Create PV folder
    const pvDir = path.join(process.cwd(), 'uploads', folderPath, 'PV');
    await fs.mkdir(pvDir, { recursive: true });

    const uploadedAssets = [];

    for (const file of files) {
      const pvId = uuidv4();
      const originalName = fixFilenameEncoding(file.originalname);
      const ext = path.extname(originalName);
      const newFileName = `PV_${pvType.replace(/\s+/g, '_')}_${date || new Date().toISOString().split('T')[0]}_${pvId.substring(0, 8)}${ext}`;
      
      // Move file from temp to PV folder
      const newPath = path.join(pvDir, newFileName);
      await fs.rename(file.path, newPath);
      
      const storagePath = `/uploads/${folderPath}/PV/${newFileName}`;

      // Save to database
      const result = await pool.query(
        `INSERT INTO project_assets (
          id, project_id, type, file_name, original_name, mime_type, file_size, storage_path, created_by, metadata
        ) VALUES ($1, $2, 'pv', $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          pvId,
          projectId,
          newFileName,
          originalName,
          file.mimetype,
          file.size,
          storagePath,
          req.user.id,
          JSON.stringify({ 
            pvType, 
            date: date || new Date().toISOString().split('T')[0], 
            description,
            uploadedFile: true 
          })
        ]
      );

      uploadedAssets.push({
        id: result.rows[0].id,
        projectId: result.rows[0].project_id,
        type: 'pv',
        fileName: result.rows[0].file_name,
        originalName: result.rows[0].original_name,
        mimeType: result.rows[0].mime_type,
        storagePath: result.rows[0].storage_path,
        metadata: result.rows[0].metadata,
        createdAt: result.rows[0].created_at,
      });

      logger.info(`PV uploaded: ${pvId} - ${originalName}`);
    }

    res.status(201).json({
      success: true,
      data: uploadedAssets,
      count: uploadedAssets.length,
    });
  } catch (error) {
    logger.error('Error uploading PV:', error);
    next(error);
  }
};

/**
 * Delete asset (soft delete)
 */
export const deleteAsset = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { assetId } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `UPDATE project_assets 
       SET deleted_at = NOW(), updated_at = NOW() 
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [assetId]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Asset not found', 404);
    }

    logger.info(`Asset deleted: ${assetId}`);

    res.json({
      success: true,
      message: 'Asset deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting asset:', error);
    next(error);
  }
};

/**
 * Serve a thumbnail for an asset
 * GET /api/assets/:assetId/thumbnail?size=grid|preview
 */
export const getAssetThumbnail = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { assetId } = req.params;
    const size = (req.query.size as string) || 'grid';

    if (!THUMBNAIL_SIZES[size]) {
      throw new ApiError(`Invalid size. Must be one of: ${Object.keys(THUMBNAIL_SIZES).join(', ')}`, 400);
    }

    const pool = getPool();
    const result = await pool.query(
      'SELECT storage_path, mime_type FROM project_assets WHERE id = $1 AND deleted_at IS NULL',
      [assetId]
    );

    if (result.rows.length === 0) {
      throw new ApiError('Asset not found', 404);
    }

    const { storage_path, mime_type } = result.rows[0];

    if (!isThumbnailable(mime_type)) {
      throw new ApiError('Asset is not an image', 400);
    }

    const thumbPath = await getOrGenerateThumbnail(storage_path, size);

    // Set caching headers — thumbnails are immutable (content-addressed)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', 'image/webp');
    res.sendFile(thumbPath);
  } catch (error) {
    logger.error('Error serving thumbnail:', error);
    next(error);
  }
};

/**
 * Get asset counts by type for a project
 */
export const getAssetCounts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) throw new ApiError('Not authenticated', 401);

    const { projectId } = req.params;
    const pool = getPool();

    const result = await pool.query(
      `SELECT type, COUNT(*) as count 
       FROM project_assets 
       WHERE project_id = $1 AND deleted_at IS NULL 
       GROUP BY type`,
      [projectId]
    );

    const counts = {
      photos: 0,
      pv: 0,
      documents: 0,
    };

    result.rows.forEach(row => {
      if (row.type === 'photo') counts.photos = parseInt(row.count);
      else if (row.type === 'pv') counts.pv = parseInt(row.count);
      else if (row.type === 'document') counts.documents = parseInt(row.count);
    });

    res.json({
      success: true,
      data: counts,
    });
  } catch (error) {
    logger.error('Error getting asset counts:', error);
    next(error);
  }
};
