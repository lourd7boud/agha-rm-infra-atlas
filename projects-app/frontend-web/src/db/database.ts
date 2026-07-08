import Dexie, { Table } from 'dexie';

// Types locaux (miroir des types backend)
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'admin' | 'user';
  isActive: boolean;
  trialEndDate?: string;          // تاريخ انتهاء الفترة التجريبية
  createdBy?: string;             // من أنشأ الحساب
  createdAt: string;
  lastLogin?: string;
  token?: string;
  lastSync?: number;
}

export interface Project {
  id: string;
  userId: string;
  objet: string;
  marcheNo: string;
  annee: string;
  dateOuverture: string;
  montant: number;
  typeMarche?: 'normal' | 'negocie';  // نوع المشروع: عادي أو تفاوضي
  commune?: string;                   // الجماعة (Commune) - Province de Tata
  // Informations entreprise (pour PDF)
  societe?: string;              // Nom de la société
  rc?: string;                   // R.C. n° (Registre de Commerce)
  cb?: string;                   // C.B n° (Compte Bancaire)
  cnss?: string;                 // C.N.S.S. n° (Caisse Nationale de Sécurité Sociale)
  patente?: string;              // Numéro de patente
  // Informations projet supplémentaires (pour PDF)
  programme?: string;            // Programme budgétaire
  projet?: string;               // Numéro de projet
  ligne?: string;                // Ligne budgétaire
  chapitre?: string;             // Chapitre budgétaire
  ordreService?: string;         // Date ordre de service (format: DD/MM/YYYY)
  delaisExecution?: number;      // Délais d'exécution en mois
  // Intervenants du projet
  assistanceTechnique?: string;  // L'ASSISTANCE TECHNIQUE
  maitreOeuvre?: string;         // Le Maître d'Oeuvre
  
  // === Gestion des délais ===
  osc?: string;                  // Ordre de Service de Commencement (date début travaux)
  // Arrêts et reprises (jusqu'à 5)
  arrets?: ArretTravaux[];       // Liste des arrêts de travaux
  // Dates de réception
  dateReceptionProvisoire?: string;   // Date réception provisoire
  dateReceptionDefinitive?: string;   // Date réception définitive
  achevementTravaux?: string;         // Date achèvement travaux (ACH TVX)
  
  // Champs anciens (à supprimer progressivement)
  snss?: string;                 // @deprecated: use cnss instead
  cbn?: string;                  // @deprecated: use cb instead
  rcn?: string;                  // @deprecated: use rc instead
  delaisEntreeService?: string;  // @deprecated: use delaisExecution instead
  status: 'draft' | 'active' | 'completed' | 'archived';
  progress: number;
  folderPath: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  _rev?: string;
}

// Interface pour les arrêts de travaux
export interface ArretTravaux {
  id: string;
  dateArret: string;      // OSA - Date d'arrêt
  dateReprise?: string;   // OSR - Date de reprise
  motif: string;          // Motif de l'arrêt
}

export interface Bordereau {
  id: string;
  projectId: string;
  userId: string;
  reference: string;
  designation: string;
  lignes: Array<{
    id: string;
    numero: number;
    designation: string;
    unite: string;
    quantite: number;
    prixUnitaire: number;
    montant: number;
  }>;
  montantTotal: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// ============== HIERARCHICAL METRE STRUCTURE ==============
// Structure: Section (Douar) → SubSection (Element) → MetreLigne (Measurement)

/**
 * Section principale - représente un lieu/douar
 * Exemple: "AIT WARKHAN-AIT WAHMAN", "DOUAR TAFRAOUT"
 */
export interface MetreSection {
  id: string;
  titre: string;                    // Titre de la section (ex: "pour (AIT WARKHAN-AIT WAHMAN)")
  ordre: number;                    // Ordre d'affichage
  couleur?: string;                 // Couleur pour différencier (optionnel)
  isCollapsed?: boolean;            // État plié/déplié
  isFromPreviousPeriode?: boolean;  // 🔴 لتحديد إذا كان من فترة سابقة
}

/**
 * Sous-section - représente un élément de construction
 * Exemple: "semeille", "Potaux", "radier", "voile", "dalle"
 */
export interface MetreSubSection {
  id: string;
  sectionId: string;                // Référence à la section parente
  titre: string;                    // Titre (ex: "semeille", "radier + voile")
  ordre: number;                    // Ordre d'affichage dans la section
  isCollapsed?: boolean;            // État plié/déplié
  nombreElements?: number;          // Nombre d'éléments/structures (ex: nombre de poteaux)
  isFromPreviousPeriode?: boolean;  // 🔴 لتحديد إذا كان من فترة سابقة
}

/**
 * Ligne de mesure - les données de calcul réelles
 */
export interface MetreLigne {
  id: string;
  sectionId?: string;               // Référence à la section (optionnel pour rétrocompatibilité)
  subSectionId?: string;            // Référence à la sous-section (optionnel)
  numero: number;
  designation: string;
  
  // Nombre des parties semblables (multiplicateur)
  nombreSemblables?: number;
  
  // Dimensions selon l'unité
  longueur?: number;
  largeur?: number;
  profondeur?: number;
  nombre?: number;
  diametre?: number;
  
  // Résultats
  partiel: number;
  observations?: string;
  isFromPreviousPeriode?: boolean;  // 🔴 لتحديد إذا كان من فترة سابقة
}

export interface Metre {
  id: string;
  projectId: string;
  periodeId: string;
  bordereauLigneId: string;
  userId: string;
  
  // Info bordereau
  reference: string;
  designationBordereau: string;
  unite: string;
  
  // ============== HIERARCHICAL STRUCTURE ==============
  // Sections et sous-sections pour organisation hiérarchique
  sections?: MetreSection[];        // Sections principales (Douars, Lieux)
  subSections?: MetreSubSection[];  // Sous-sections (Éléments: semeille, radier, etc.)
  
  // Lignes de métré
  lignes: MetreLigne[];
  
  // Totaux
  totalPartiel: number;
  totalCumule: number;
  quantiteBordereau: number;
  pourcentageRealisation: number;
  
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Periode {
  id: string;
  projectId: string;
  userId: string;
  numero: number;
  libelle: string;
  dateDebut: string;
  dateFin: string;
  statut: 'en_cours' | 'validee' | 'facturee';
  isDecompteDernier?: boolean; // True si c'est le dernier décompte
  observations?: string;
  // Paramètres financiers du décompte
  tauxTVA?: number; // Taux TVA (défaut: 20%)
  tauxRetenue?: number; // Taux retenue de garantie (défaut: 10%)
  depensesExercicesAnterieurs?: number; // Dépenses imputées sur exercices antérieurs
  decomptesPrecedents?: number; // Montant des acomptes délivrés sur l'exercice en cours
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Decompt {
  id: string;
  projectId: string;
  periodeId: string;
  userId: string;
  numero: number;
  lignes: Array<{
    prixNo: number;
    designation: string;
    unite: string;
    quantiteBordereau: number;
    quantiteRealisee: number;
    prixUnitaireHT: number;
    montantHT: number;
    bordereauLigneId: string;
    metreId?: string;
  }>;
  montantTotal: number;
  totalTTC?: number;
  statut: 'draft' | 'submitted' | 'validated' | 'paid';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Photo {
  id: string;
  projectId: string;
  userId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  description?: string;
  tags: string[];
  location?: { latitude: number; longitude: number };
  localPath?: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;                // 'create_user', 'disable_user', 'enable_user', etc.
  entityType: string;            // 'user', 'project', 'decompte', etc.
  entityId?: string;
  details: any;                  // معلومات إضافية عن العملية
  ipAddress?: string;
  timestamp: string;
}

export interface PV {
  id: string;
  projectId: string;
  userId: string;
  type: 'installation' | 'reception' | 'constat' | 'other';
  numero: string;
  date: string;
  objet: string;
  contenu: string;
  participants: Array<{
    nom: string;
    fonction: string;
    signature?: string;
  }>;
  attachments: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface Attachment {
  id: string;
  projectId: string;
  userId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  category: 'facture' | 'bp' | 'plan' | 'autre';
  description?: string;
  linkedTo?: {
    type: 'project' | 'bordereau' | 'metre' | 'decompt' | 'pv';
    id: string;
  };
  localPath?: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// AVENANTS (Contract Amendments / ملاحق العقود)
// ═══════════════════════════════════════════════════════════════════════

export interface AvenantModification {
  bordereauLigneId: string;
  action: 'modifier_quantite' | 'modifier_prix' | 'supprimer';
  ancienneQuantite?: number;
  nouvelleQuantite?: number;
  ancienPrix?: number;
  nouveauPrix?: number;
  designation: string;
  unite: string;
  montantDifference: number;
}

export interface AvenantPrixNouveau {
  id: string;
  numero: number;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number;
  montant: number;
}

export interface Avenant {
  id: string;
  projectId: string;
  userId: string;
  numero: number;
  objet: string;
  reference?: string;
  dateAvenant?: string;
  dateNotification?: string;
  dateApprobation?: string;
  montantInitial: number;
  montantAvenant: number;
  montantNouveau: number;
  pourcentageVariation: number;
  delaisSupplementaire: number;
  nouveauDelais: number;
  typeAvenant: 'modification' | 'prix_nouveaux' | 'mixte' | 'diminution';
  motif?: string;
  statut: 'brouillon' | 'en_attente' | 'approuve' | 'rejete' | 'annule';
  modifications: AvenantModification[];
  prixNouveaux: AvenantPrixNouveau[];
  observations?: string;
  montantCumule?: number; // calculated field from API
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface AvenantSummary {
  project: any;
  montantInitial: number;
  montantActuel: number;
  totalMontantAvenants: number;
  variationTotale: number;
  delaisInitial: number;
  delaisActuel: number;
  totalDelaisSup: number;
  nombreAvenants: number;
  nombreApprouves: number;
  avenants: Avenant[];
}

// WORKFLOW & APPROVALS (Circuit de Validation/Visa)

export interface ApprovalStep {
  id: string;
  requestId: string;
  stepOrder: number;
  stepLabel: string;
  role?: string;
  status: 'en_attente' | 'en_cours' | 'approuve' | 'rejete' | 'renvoye';
  decidedBy?: string;
  decidedByName?: string;
  decisionDate?: string;
  comment?: string;
  conditions?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalHistory {
  id: string;
  requestId: string;
  stepId?: string;
  action: string;
  actorId?: string;
  actorName?: string;
  comment?: string;
  metadata?: any;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  userId: string;
  projectId: string;
  workflowId?: string;
  documentType: 'decompt' | 'avenant' | 'pv' | 'ods' | 'attachement' | 'autre';
  documentId: string;
  documentReference?: string;
  status: 'en_attente' | 'en_cours' | 'approuve' | 'rejete' | 'annule';
  currentStep: number;
  totalSteps: number;
  priority: 'basse' | 'normal' | 'haute' | 'urgente';
  dueDate?: string;
  note?: string;
  montant?: number;
  submittedAt: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  projectName?: string;
  marcheNo?: string;
  steps?: ApprovalStep[];
  history?: ApprovalHistory[];
}

export interface ApprovalStats {
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  cancelledCount: number;
  totalCount: number;
  urgentCount: number;
  overdueCount: number;
  pendingAmount: number;
  approvedAmount: number;
  avgHoursToComplete: number | null;
}

// PENALTIES & BONDS (غرامات وضمانات)

export interface Penalty {
  id: string;
  projectId: string;
  type: 'retard' | 'malfacon' | 'non_conformite' | 'securite' | 'environnement' | 'autre';
  dateDebut?: string;
  dateFin?: string;
  nombreJours: number;
  taux: number;
  baseCalcul: number;
  montantPenalite: number;
  plafondPourcentage: number;
  montantPlafond: number;
  montantApplique: number;
  statut: 'calculee' | 'notifiee' | 'contestee' | 'appliquee' | 'annulee' | 'remise';
  referenceNotification?: string;
  dateNotification?: string;
  motif?: string;
  observations?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Bond {
  id: string;
  projectId: string;
  type: 'caution_provisoire' | 'caution_definitive' | 'retenue_garantie' | 'caution_avance' | 'caution_bonne_execution' | 'garantie_decennale';
  montant: number;
  pourcentage?: number;
  baseCalcul: number;
  organisme?: string;
  referenceOrganisme?: string;
  dateEmission?: string;
  dateExpiration?: string;
  dateMainlevee?: string;
  statut: 'en_attente' | 'active' | 'expiree' | 'liberee' | 'saisie' | 'annulee';
  observations?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Retention {
  id: string;
  projectId: string;
  bondId?: string;
  decomptId?: string;
  decomptNumero?: number;
  montantDecompt: number;
  tauxRetenue: number;
  montantRetenue: number;
  montantCumule: number;
  liberee: boolean;
  dateLiberation?: string;
  createdAt: string;
}

export interface FinancialSummary {
  penalties: {
    totalPenalties: number;
    totalPenalites: number;
    penalitesAppliquees: number;
    joursRetard: number;
  };
  bonds: {
    totalBonds: number;
    montantCautionsActives: number;
    cautionDefinitive: number;
    retenueGarantieBond: number;
    cautionsExpirees: number;
  };
  retentions: {
    totalRetentions: number;
    totalRetenue: number;
    retenueLiberee: number;
    retenueEnCours: number;
  };
}

export interface SyncOperation {
  id: string;
  userId: string;
  deviceId: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: 'project' | 'bordereau' | 'periode' | 'metre' | 'decompt' | 'photo' | 'pv' | 'attachment' | 'company' | 'avenant' | 'approval';
  entityId: string;
  data: any;
  timestamp: number;
  synced: boolean;
  syncedAt?: number;
  conflicts?: {
    localData: any;
    remoteData: any;
    resolved: boolean;
    resolution?: 'local' | 'remote' | 'merge';
  };
}

// Informations de l'entreprise/société (pour autocomplétion)
export interface Company {
  id: string;
  userId: string;
  nom: string;           // Nom de la société
  rc?: string;           // Registre de Commerce
  cb?: string;           // Compte Bancaire
  cnss?: string;         // CNSS
  patente?: string;      // Numéro de patente
  adresse?: string;      // Adresse
  telephone?: string;    // Téléphone
  email?: string;        // Email
  usageCount: number;    // Nombre de fois utilisée (pour tri par popularité)
  lastUsed: string;      // Dernière utilisation
  createdAt: string;
  updatedAt: string;
}

// Base de données Dexie
export class ProjetDatabase extends Dexie {
  users!: Table<User, string>;
  projects!: Table<Project, string>;
  bordereaux!: Table<Bordereau, string>;
  periodes!: Table<Periode, string>;
  metres!: Table<Metre, string>;
  decompts!: Table<Decompt, string>;
  photos!: Table<Photo, string>;
  pvs!: Table<PV, string>;
  attachments!: Table<Attachment, string>;
  syncOperations!: Table<SyncOperation, string>;
  auditLogs!: Table<AuditLog, string>;
  companies!: Table<Company, string>;

  constructor() {
    super('ProjetGestionDB');
    
    // Version 1: Schema initial
    this.version(1).stores({
      users: 'id, email',
      projects: 'id, userId, status, annee, marcheNo',
      bordereaux: 'id, projectId, userId, reference',
      metres: 'id, projectId, bordereauLigneId, userId, reference',
      decompts: 'id, projectId, userId, periode, numero',
      photos: 'id, projectId, userId, syncStatus',
      pvs: 'id, projectId, userId, type, date',
      attachments: 'id, projectId, userId, category, syncStatus',
      syncOperations: 'id, userId, deviceId, entity, timestamp, synced, syncedAt',
    });

    // Version 2: Ajout de l'index syncedAt pour syncOperations
    this.version(2).stores({
      syncOperations: 'id, userId, deviceId, entity, timestamp, synced, syncedAt',
    });

    // Version 3: Ajout de Periode et mise à jour de Metre/Decompt avec periodeId
    this.version(3).stores({
      periodes: 'id, projectId, userId, numero, statut',
      metres: 'id, projectId, periodeId, bordereauLigneId, userId, reference',
      decompts: 'id, projectId, periodeId, userId, numero',
    });

    // Version 4: Ajout des paramètres financiers dans Periode (pas besoin de changer les stores)
    this.version(4).stores({
      periodes: 'id, projectId, userId, numero, statut',
    });

    // Version 5: Ajout des champs entreprise et projet pour PDF (pas besoin de changer les stores)
    this.version(5).stores({
      projects: 'id, userId, status, annee, marcheNo',
    });

    // Version 6: Ajout de AuditLog et mise à jour de User avec nouveaux champs
    this.version(6).stores({
      users: 'id, email, role, isActive, createdBy',
      auditLogs: 'id, userId, action, entityType, timestamp',
    });

    // Version 7: Ajout de la table Companies pour l'autocomplétion
    this.version(7).stores({
      companies: 'id, userId, nom, rc, cnss, usageCount, lastUsed',
    });

    // Version 8: Enhanced indexes for sync operations
    this.version(8).stores({
      syncOperations: 'id, userId, deviceId, entity, entityId, timestamp, synced, syncedAt, [userId+synced]',
      projects: 'id, userId, status, annee, marcheNo, deletedAt',
      bordereaux: 'id, projectId, userId, reference, deletedAt',
      metres: 'id, projectId, periodeId, bordereauLigneId, userId, deletedAt',
      decompts: 'id, projectId, periodeId, userId, numero, deletedAt',
      periodes: 'id, projectId, userId, numero, statut, deletedAt',
    });
  }
}

export const db = new ProjetDatabase();

// ==================== PROFESSIONAL SYNC UTILITIES ====================

/**
 * Force Full Sync: Clears all local data and re-fetches from server
 * Use this when there's a sync mismatch or data corruption
 */
export const forceFullSync = async (): Promise<void> => {
  console.log('🔄 Starting Force Full Sync - clearing all local data...');
  
  await db.transaction('rw', 
    [db.projects, db.bordereaux, db.periodes, db.metres, db.decompts, db.photos, db.pvs, db.attachments, db.syncOperations],
    async () => {
      // Clear all data tables
      await db.projects.clear();
      await db.bordereaux.clear();
      await db.periodes.clear();
      await db.metres.clear();
      await db.decompts.clear();
      await db.photos.clear();
      await db.pvs.clear();
      await db.attachments.clear();
      // Clear sync queue too
      await db.syncOperations.clear();
    }
  );
  
  // Clear localStorage sync timestamp
  localStorage.removeItem('lastSyncTimestamp');
  localStorage.removeItem('lastSuccessfulSync');
  
  console.log('✅ Force Full Sync: All local data cleared. Ready for fresh sync.');
};

/**
 * Purge soft-deleted items older than specified days
 * Call periodically to clean up tombstones
 */
export const purgeSoftDeleted = async (daysOld: number = 30): Promise<number> => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const cutoffStr = cutoffDate.toISOString();
  
  let totalPurged = 0;
  
  await db.transaction('rw', 
    [db.projects, db.bordereaux, db.periodes, db.metres, db.decompts],
    async () => {
      // Purge old deleted projects
      const deletedProjects = await db.projects.filter(p => !!(p.deletedAt && p.deletedAt < cutoffStr)).toArray();
      for (const p of deletedProjects) {
        await db.projects.delete(p.id);
        totalPurged++;
      }
      
      // Purge old deleted bordereaux
      const deletedBordereaux = await db.bordereaux.filter(b => !!(b.deletedAt && b.deletedAt < cutoffStr)).toArray();
      for (const b of deletedBordereaux) {
        await db.bordereaux.delete(b.id);
        totalPurged++;
      }
      
      // Purge old deleted periodes
      const deletedPeriodes = await db.periodes.filter(p => !!(p.deletedAt && p.deletedAt < cutoffStr)).toArray();
      for (const p of deletedPeriodes) {
        await db.periodes.delete(p.id);
        totalPurged++;
      }
      
      // Purge old deleted metres
      const deletedMetres = await db.metres.filter(m => !!(m.deletedAt && m.deletedAt < cutoffStr)).toArray();
      for (const m of deletedMetres) {
        await db.metres.delete(m.id);
        totalPurged++;
      }
      
      // Purge old deleted decompts
      const deletedDecompts = await db.decompts.filter(d => !!(d.deletedAt && d.deletedAt < cutoffStr)).toArray();
      for (const d of deletedDecompts) {
        await db.decompts.delete(d.id);
        totalPurged++;
      }
    }
  );
  
  if (totalPurged > 0) {
    console.log(`🗑️ Purged ${totalPurged} soft-deleted items older than ${daysOld} days`);
  }
  
  return totalPurged;
};

/**
 * Get sync statistics for debugging
 */
export const getSyncStats = async () => {
  const projectsCount = await db.projects.filter(p => !p.deletedAt).count();
  const deletedProjectsCount = await db.projects.filter(p => !!p.deletedAt).count();
  const bordereauxCount = await db.bordereaux.filter(b => !b.deletedAt).count();
  const periodesCount = await db.periodes.filter(p => !p.deletedAt).count();
  const metresCount = await db.metres.filter(m => !m.deletedAt).count();
  const decomptsCount = await db.decompts.filter(d => !d.deletedAt).count();
  const pendingSyncCount = await db.syncOperations.where('synced').equals(0).count();
  
  return {
    projects: projectsCount,
    deletedProjects: deletedProjectsCount,
    bordereaux: bordereauxCount,
    periodes: periodesCount,
    metres: metresCount,
    decompts: decomptsCount,
    pendingSync: pendingSyncCount,
    lastSync: localStorage.getItem('lastSyncTimestamp'),
  };
};
