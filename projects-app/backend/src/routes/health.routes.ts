import { Router, Request, Response } from 'express';
import pool from '../config/postgres';
import logger from '../utils/logger';

const router = Router();

interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: { status: string; latency?: number };
    memory: { used: number; total: number; percentage: number };
  };
}

// GET /api/health - Basic health check
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    uptime: process.uptime(),
    checks: {
      database: { status: 'unknown' },
      memory: {
        used: 0,
        total: 0,
        percentage: 0
      }
    }
  };

  // Check database connection
  try {
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    health.checks.database = {
      status: 'connected',
      latency: Date.now() - dbStart
    };
  } catch (error) {
    health.checks.database = { status: 'disconnected' };
    health.status = 'unhealthy';
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  health.checks.memory = {
    used: Math.round(memUsage.heapUsed / 1024 / 1024),
    total: Math.round(memUsage.heapTotal / 1024 / 1024),
    percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
  };

  // Memory warning if > 90%
  if (health.checks.memory.percentage > 90) {
    health.status = health.status === 'healthy' ? 'degraded' : health.status;
  }

  const statusCode = health.status === 'healthy' ? 200 : 
                     health.status === 'degraded' ? 200 : 503;
  
  res.status(statusCode).json(health);
});

// GET /api/health/live - Kubernetes liveness probe
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

// GET /api/health/ready - Kubernetes readiness probe
router.get('/ready', async (req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not ready', error: 'Database unavailable' });
  }
});

// POST /api/health/client-error - Receive frontend error reports
router.post('/client-error', (req: Request, res: Response): void => {
  try {
    const { errors } = req.body;
    if (!Array.isArray(errors) || errors.length === 0) {
      res.status(400).json({ success: false });
      return;
    }

    // Log each client error (limit to 20 per request to prevent abuse)
    const limited = errors.slice(0, 20);
    for (const entry of limited) {
      logger.warn('Client error', {
        level: entry.level,
        clientMessage: entry.message?.substring(0, 500),
        clientUrl: entry.url,
        timestamp: entry.timestamp,
      });
    }

    res.json({ success: true, received: limited.length });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

export default router;
