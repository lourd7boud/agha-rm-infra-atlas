import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { ensureJsonResponse } from './middleware/jsonOnly';
import { authenticate, authenticateStaticFiles, AuthRequest } from './middleware/auth';
import logger from './utils/logger';
import { initPostgres } from './config/postgres';
import { initSocketServer, setupRealtimeTriggers } from './realtime';

logger.info('BTP Backend Server v4 starting', {
  nodeVersion: process.version,
  environment: process.env.NODE_ENV || 'development',
  timestamp: new Date().toISOString(),
});

// Routes
import authRoutes from './routes/auth.routes';
import projectRoutes from './routes/project.routes';
import bordereauRoutes from './routes/bordereau.routes';
import metreRoutes from './routes/metre.routes';
import decomptRoutes from './routes/decompt.routes';
import photoRoutes from './routes/photo.routes';
import pvRoutes from './routes/pv.routes';
import attachmentRoutes from './routes/attachment.routes';
import periodeRoutes from './routes/periode.routes';
import syncRoutes from './routes/sync.routes';
import assetRoutes from './routes/asset.routes';
import healthRoutes from './routes/health.routes';
import revisionRoutes from './routes/revision.routes';
import indexManagementRoutes from './routes/indexManagement.routes';
import albumRoutes from './routes/album.routes';
import dashboardRoutes from './routes/dashboard.routes';
import integrityRoutes from './routes/integrity.routes';
import avenantRoutes from './routes/avenant.routes';
import workflowRoutes from './routes/workflow.routes';
import penaltyRoutes from './routes/penalty.routes';
import exportRoutes from './routes/export.routes';
import siteDiaryRoutes from './routes/siteDiary.routes';
import odsRoutes from './routes/ods.routes';
import portalRoutes from './routes/portal.routes';
import reportsRoutes from './routes/reports.routes';
import ganttRoutes from './routes/gantt.routes';
import adminRoutes from './routes/admin.routes';

logger.info('All routes imported successfully');

// dotenv is preloaded via -r dotenv/config in package.json

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Trust first proxy (nginx) — required for express-rate-limit to read X-Forwarded-For correctly
app.set('trust proxy', 1);

// Middleware
// Configure helmet with security-hardened settings
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin access to resources
  crossOriginEmbedderPolicy: false, // Disable COEP for PDF embedding
  crossOriginOpenerPolicy: false, // Disable COOP for Electron compatibility
  xFrameOptions: false, // Let nginx handle X-Frame-Options for PDF embedding
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],  // SECURITY: Removed 'unsafe-inline' to prevent XSS
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'", "https:", "wss:"],
      frameSrc: ["'self'", "blob:", "https:"],
      objectSrc: ["'none'"],  // SECURITY: Block object embeds
      mediaSrc: ["'self'", "blob:"],
      frameAncestors: ["'self'", "file:"],  // SECURITY: Removed wildcard *, keep Electron file:// support
    },
  },
}));

// SECURITY: Explicit CORS origins instead of wildcard with credentials
const DEFAULT_ORIGINS = [
  'https://marocinfra.com',
  'https://www.marocinfra.com',
  'https://dev.marocinfra.com',
  'http://localhost:5173',
  'http://localhost:3000',
];
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : DEFAULT_ORIGINS;

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, Electron, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    logger.warn('CORS blocked', { origin });
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(compression());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// SECURITY: Reasonable body limits — was 500MB (DoS risk), now 50MB for photo uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure JSON responses for all API routes
app.use(ensureJsonResponse);

// ── Rate Limiting ───────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000,                // 5000 requests per 15 min per IP (SPA needs many)
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests, please try again later' } },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,                  // 20 login/register attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many authentication attempts, please try again later' } },
});

const syncLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max: 30,                  // 30 sync operations per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Sync rate limited, please try again shortly' } },
});

app.use('/api/', globalLimiter);

// SECURITY: Static files behind authentication — supports cookie-based auth for <img> tags
app.use('/uploads', authenticateStaticFiles, (req: Request, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  // Cache static files for 1 hour to improve performance
  res.setHeader('Cache-Control', 'private, max-age=3600');
  next();
}, express.static('uploads'));

// Health check (minimal info — no uptime leak)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth/login', authLimiter);
// Register endpoint disabled - user creation is admin-only via /api/admin/users
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/bordereau', bordereauRoutes);
app.use('/api/metre', metreRoutes);
app.use('/api/decompt', decomptRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/pv', pvRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/periodes', periodeRoutes);
app.use('/api/sync', syncLimiter, syncRoutes);
app.use('/api/assets', assetRoutes);
app.use('/api/revision', revisionRoutes);
app.use('/api/index-management', indexManagementRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/integrity', integrityRoutes);
app.use('/api/avenants', avenantRoutes);
app.use('/api/approvals', workflowRoutes);
app.use('/api/financial', penaltyRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/site-diary', siteDiaryRoutes);
app.use('/api/ods', odsRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/gantt', ganttRoutes);
app.use('/api/admin', adminRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Create HTTP server
const server = createServer(app);

// Initialize Database and Start server
const startServer = async () => {
  try {
    await initPostgres();
    logger.info('PostgreSQL initialized');
    
    await setupRealtimeTriggers();
    logger.info('Realtime triggers ready');
    
    initSocketServer(server);
    logger.info('Socket.IO server ready');
    
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, {
        environment: process.env.NODE_ENV || 'development',
        port: PORT,
      });
    });
  } catch (error: any) {
    console.error('FATAL: Failed to start server:', error);
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

export default app;
