import { Pool, PoolClient } from 'pg';
import logger from '../utils/logger';

// SECURITY: Validate required database credentials in production
if (!process.env.POSTGRES_PASSWORD) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('FATAL: POSTGRES_PASSWORD environment variable is required in production.');
    process.exit(1);
  } else {
    logger.warn('POSTGRES_PASSWORD not set. Using insecure default for development ONLY.');
  }
}

// Log config without exposing credentials
logger.info('PostgreSQL config', {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || '5432',
  database: process.env.POSTGRES_DB || 'btpdb',
  user: process.env.POSTGRES_USER || 'btpuser',
  passwordSet: !!process.env.POSTGRES_PASSWORD,
});

// PostgreSQL connection configuration
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'btpdb',
  user: process.env.POSTGRES_USER || 'btpuser',
  password: process.env.POSTGRES_PASSWORD || 'dev-only-password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // SECURITY: Enable SSL in production
  ...(process.env.NODE_ENV === 'production' && process.env.POSTGRES_SSL !== 'false' ? {
    ssl: { rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false' },
  } : {}),
});

pool.on('connect', () => {
  logger.info('Connected to PostgreSQL');
});

pool.on('error', (err: Error) => {
  logger.error('PostgreSQL pool error:', err);
});

export const initPostgres = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    logger.info('Successfully connected to PostgreSQL');
    
    // Create tables if not exists
    await client.query(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(50) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        trial_end_date TIMESTAMP,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Projects table
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        objet TEXT NOT NULL,
        marche_no VARCHAR(100),
        annee VARCHAR(10),
        date_ouverture DATE,
        montant DECIMAL(15, 2) DEFAULT 0,
        type_marche VARCHAR(50) DEFAULT 'normal',
        commune VARCHAR(255),
        societe VARCHAR(255),
        rc VARCHAR(100),
        cb VARCHAR(100),
        cnss VARCHAR(100),
        patente VARCHAR(100),
        programme VARCHAR(255),
        projet VARCHAR(255),
        ligne VARCHAR(100),
        chapitre VARCHAR(100),
        delais_execution INTEGER,
        osc DATE,
        date_reception_provisoire DATE,
        date_reception_definitive DATE,
        achevement_travaux DATE,
        status VARCHAR(50) DEFAULT 'draft',
        progress INTEGER DEFAULT 0,
        folder_path TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Bordereaux table
      CREATE TABLE IF NOT EXISTS bordereaux (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        lignes JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Periodes table
      CREATE TABLE IF NOT EXISTS periodes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        numero INTEGER NOT NULL,
        date_debut DATE,
        date_fin DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Metres table
      CREATE TABLE IF NOT EXISTS metres (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        periode_id UUID REFERENCES periodes(id),
        bordereau_ligne_id VARCHAR(255),
        data JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Decompts table
      CREATE TABLE IF NOT EXISTS decompts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        periode_id UUID REFERENCES periodes(id),
        numero INTEGER NOT NULL,
        date_decompte DATE,
        montant_cumule DECIMAL(15, 2) DEFAULT 0,
        montant_precedent DECIMAL(15, 2) DEFAULT 0,
        montant_actuel DECIMAL(15, 2) DEFAULT 0,
        montant_total DECIMAL(15, 2) DEFAULT 0,
        is_dernier BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Attachments table
      CREATE TABLE IF NOT EXISTS attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        periode_id UUID REFERENCES periodes(id),
        decompte_id UUID REFERENCES decompts(id),
        file_name VARCHAR(255),
        file_path TEXT,
        file_type VARCHAR(100),
        file_size INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Photos table
      CREATE TABLE IF NOT EXISTS photos (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        file_name VARCHAR(255),
        file_path TEXT,
        file_size INTEGER,
        mime_type VARCHAR(100),
        description TEXT,
        tags JSONB DEFAULT '[]',
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- PVs table (Procès-Verbaux)
      CREATE TABLE IF NOT EXISTS pvs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        type VARCHAR(100),
        numero VARCHAR(50),
        date DATE,
        objet TEXT,
        contenu TEXT,
        participants JSONB DEFAULT '[]',
        attachments JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      );

      -- Sync operations log (for offline sync)
      CREATE TABLE IF NOT EXISTS sync_operations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id VARCHAR(255) NOT NULL,
        user_id UUID REFERENCES users(id),
        operation_type VARCHAR(50) NOT NULL,
        table_name VARCHAR(100) NOT NULL,
        record_id UUID NOT NULL,
        payload JSONB,
        timestamp BIGINT NOT NULL,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Companies table (for autocomplete)
      CREATE TABLE IF NOT EXISTS companies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        nom VARCHAR(255) NOT NULL,
        rc VARCHAR(100),
        cb VARCHAR(100),
        cnss VARCHAR(100),
        patente VARCHAR(100),
        adresse TEXT,
        telephone VARCHAR(50),
        email VARCHAR(255),
        usage_count INTEGER DEFAULT 0,
        last_used TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Create indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_bordereaux_project_id ON bordereaux(project_id);
      CREATE INDEX IF NOT EXISTS idx_periodes_project_id ON periodes(project_id);
      CREATE INDEX IF NOT EXISTS idx_metres_project_id ON metres(project_id);
      CREATE INDEX IF NOT EXISTS idx_metres_periode_id ON metres(periode_id);
      CREATE INDEX IF NOT EXISTS idx_decompts_project_id ON decompts(project_id);
      CREATE INDEX IF NOT EXISTS idx_photos_project_id ON photos(project_id);
      CREATE INDEX IF NOT EXISTS idx_pvs_project_id ON pvs(project_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_project_id ON attachments(project_id);
      CREATE INDEX IF NOT EXISTS idx_sync_operations_user_id ON sync_operations(user_id);
      CREATE INDEX IF NOT EXISTS idx_sync_operations_timestamp ON sync_operations(timestamp);

      -- Add missing columns to projects if they don't exist
      DO $$ BEGIN
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS snss VARCHAR(100);
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS cbn VARCHAR(100);
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS rcn VARCHAR(100);
        ALTER TABLE projects ADD COLUMN IF NOT EXISTS delais_entree_service DATE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_sync TIMESTAMP;
        -- Add deleted_at to companies for soft delete support
        ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
    `);

    client.release();
    logger.info('PostgreSQL tables initialized');
  } catch (error: any) {
    logger.error('PostgreSQL initialization error:', error);
    throw error;
  }
};

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 50)}...`);
  return res;
};

export const getClient = () => pool.connect();

export const getPool = () => pool;

export default pool;
