export interface User {
  _id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'admin' | 'user';
  isActive: boolean;
  trialEndDate?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  lastSync?: Date;
  lastLogin?: string;
}

export interface Project {
  _id: string;
  userId: string;
  
  // Informations administratives
  objet: string;
  marcheNo: string;
  annee: string;
  dateOuverture: Date;
  montant: number; // MAD
  snss: string;
  cbn: string;
  rcn: string;
  societe: string;
  patente: string;
  
  // Délais
  delaisEntreeService?: Date;
  osc?: Date;
  
  // Métadonnées
  status: 'draft' | 'active' | 'completed' | 'archived';
  progress: number; // 0-100
  folderPath: string; // Auto-généré: /{year}/{marche}-{affaire}
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _rev?: string; // CouchDB revision
}

export interface Bordereau {
  _id: string;
  projectId: string;
  userId: string;
  
  reference: string;
  designation: string;
  unite: string;
  quantite: number;
  prixUnitaire: number; // MAD
  montantTotal: number; // MAD (auto-calculé)
  
  // Liens
  metreIds: string[]; // Liés aux métrés
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _rev?: string;
}

export interface Metre {
  _id: string;
  projectId: string;
  bordereauId: string;
  userId: string;
  
  reference: string;
  designation: string;
  
  // Mesures
  mesures: {
    id: string;
    longueur?: number;
    largeur?: number;
    hauteur?: number;
    quantite: number;
    unite: string;
  }[];
  
  totalQuantite: number; // Auto-calculé
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _rev?: string;
}

export interface Decompt {
  _id: string;
  projectId: string;
  userId: string;
  
  periode: string; // ex: "Janvier 2025"
  numero: number;
  
  // Lignes du décompte (basées sur bordereau + métré)
  lignes: {
    bordereauId: string;
    metreId: string;
    quantiteExecutee: number;
    montant: number; // MAD
  }[];
  
  montantTotal: number; // MAD
  statut: 'draft' | 'submitted' | 'validated' | 'paid';
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _rev?: string;
}

export interface Photo {
  _id: string;
  projectId: string;
  userId: string;
  
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  
  description?: string;
  tags: string[];
  location?: {
    latitude: number;
    longitude: number;
  };
  
  // Sync
  localPath?: string; // Chemin local avant sync
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _rev?: string;
}

export interface PV {
  _id: string;
  projectId: string;
  userId: string;
  
  type: 'installation' | 'reception' | 'constat' | 'other';
  numero: string;
  date: Date;
  
  objet: string;
  contenu: string; // Contenu du PV
  
  participants: {
    nom: string;
    fonction: string;
    signature?: string; // URL de la signature
  }[];
  
  attachments: string[]; // IDs des fichiers attachés
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _rev?: string;
}

export interface Attachment {
  _id: string;
  projectId: string;
  userId: string;
  
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  
  category: 'facture' | 'bp' | 'plan' | 'autre';
  description?: string;
  
  // Relations
  linkedTo?: {
    type: 'project' | 'bordereau' | 'metre' | 'decompt' | 'pv';
    id: string;
  };
  
  // Sync
  localPath?: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  _rev?: string;
}

// Système de synchronisation
export interface SyncOperation {
  _id: string;
  userId: string;
  deviceId: string;
  
  type: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: 'project' | 'bordereau' | 'metre' | 'decompt' | 'photo' | 'pv' | 'attachment';
  entityId: string;
  
  data: any; // Les données de l'opération
  timestamp: number;
  
  synced: boolean;
  syncedAt?: Date;
  
  conflicts?: {
    localData: any;
    remoteData: any;
    resolved: boolean;
    resolution?: 'local' | 'remote' | 'merge';
  };
  
  createdAt: Date;
}

export interface Alert {
  _id: string;
  projectId: string;
  userId: string;
  
  type: 'deadline' | 'delay' | 'warning' | 'info';
  severity: 'low' | 'medium' | 'high' | 'critical';
  
  title: string;
  message: string;
  
  triggeredAt: Date;
  read: boolean;
  
  createdAt: Date;
}
