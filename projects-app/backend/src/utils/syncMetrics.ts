/**
 * Sync Metrics and Monitoring Utilities
 * 
 * Provides metrics collection, logging, and monitoring
 * for the sync system.
 */

import logger from './logger';

// ==================== METRICS STORAGE ====================

interface SyncMetrics {
  // Counters
  pushAttempts: number;
  pushSuccesses: number;
  pushFailures: number;
  pullAttempts: number;
  pullSuccesses: number;
  pullFailures: number;
  conflictsDetected: number;
  conflictsResolved: number;
  
  // Gauges
  pendingOpsCount: number;
  lastPushDuration: number;
  lastPullDuration: number;
  avgPushLatency: number;
  avgPullLatency: number;
  
  // Histograms
  pushLatencies: number[];
  pullLatencies: number[];
  batchSizes: number[];
  
  // Errors
  lastError: string | null;
  errorCount: number;
  
  // Timestamps
  lastPushAt: number | null;
  lastPullAt: number | null;
  lastSyncAt: number | null;
}

const defaultMetrics: SyncMetrics = {
  pushAttempts: 0,
  pushSuccesses: 0,
  pushFailures: 0,
  pullAttempts: 0,
  pullSuccesses: 0,
  pullFailures: 0,
  conflictsDetected: 0,
  conflictsResolved: 0,
  pendingOpsCount: 0,
  lastPushDuration: 0,
  lastPullDuration: 0,
  avgPushLatency: 0,
  avgPullLatency: 0,
  pushLatencies: [],
  pullLatencies: [],
  batchSizes: [],
  lastError: null,
  errorCount: 0,
  lastPushAt: null,
  lastPullAt: null,
  lastSyncAt: null,
};

// Per-user metrics storage
const metricsStore: Map<string, SyncMetrics> = new Map();

// ==================== METRICS FUNCTIONS ====================

/**
 * Get metrics for a user
 */
export const getMetrics = (userId: string): SyncMetrics => {
  if (!metricsStore.has(userId)) {
    metricsStore.set(userId, { ...defaultMetrics });
  }
  return metricsStore.get(userId)!;
};

/**
 * Record a push attempt
 */
export const recordPushAttempt = (
  userId: string, 
  batchSize: number
): () => void => {
  const metrics = getMetrics(userId);
  metrics.pushAttempts++;
  metrics.batchSizes.push(batchSize);
  
  const startTime = Date.now();
  
  // Return a function to call on completion
  return () => {
    const duration = Date.now() - startTime;
    metrics.lastPushDuration = duration;
    metrics.pushLatencies.push(duration);
    metrics.lastPushAt = Date.now();
    metrics.lastSyncAt = Date.now();
    
    // Update average
    if (metrics.pushLatencies.length > 0) {
      metrics.avgPushLatency = 
        metrics.pushLatencies.reduce((a, b) => a + b, 0) / metrics.pushLatencies.length;
    }
    
    // Keep only last 100 latency samples
    if (metrics.pushLatencies.length > 100) {
      metrics.pushLatencies = metrics.pushLatencies.slice(-100);
    }
  };
};

/**
 * Record a successful push
 */
export const recordPushSuccess = (
  userId: string, 
  opsCount: number
): void => {
  const metrics = getMetrics(userId);
  metrics.pushSuccesses++;
  
  logger.info({
    event: 'sync_push_success',
    userId,
    opsCount,
    duration: metrics.lastPushDuration,
  });
};

/**
 * Record a failed push
 */
export const recordPushFailure = (
  userId: string, 
  error: string
): void => {
  const metrics = getMetrics(userId);
  metrics.pushFailures++;
  metrics.lastError = error;
  metrics.errorCount++;
  
  logger.error({
    event: 'sync_push_failure',
    userId,
    error,
  });
};

/**
 * Record a pull attempt
 */
export const recordPullAttempt = (userId: string): () => void => {
  const metrics = getMetrics(userId);
  metrics.pullAttempts++;
  
  const startTime = Date.now();
  
  return () => {
    const duration = Date.now() - startTime;
    metrics.lastPullDuration = duration;
    metrics.pullLatencies.push(duration);
    metrics.lastPullAt = Date.now();
    metrics.lastSyncAt = Date.now();
    
    if (metrics.pullLatencies.length > 0) {
      metrics.avgPullLatency = 
        metrics.pullLatencies.reduce((a, b) => a + b, 0) / metrics.pullLatencies.length;
    }
    
    if (metrics.pullLatencies.length > 100) {
      metrics.pullLatencies = metrics.pullLatencies.slice(-100);
    }
  };
};

/**
 * Record a successful pull
 */
export const recordPullSuccess = (
  userId: string, 
  opsCount: number
): void => {
  const metrics = getMetrics(userId);
  metrics.pullSuccesses++;
  
  logger.info({
    event: 'sync_pull_success',
    userId,
    opsCount,
    duration: metrics.lastPullDuration,
  });
};

/**
 * Record a failed pull
 */
export const recordPullFailure = (
  userId: string, 
  error: string
): void => {
  const metrics = getMetrics(userId);
  metrics.pullFailures++;
  metrics.lastError = error;
  metrics.errorCount++;
  
  logger.error({
    event: 'sync_pull_failure',
    userId,
    error,
  });
};

/**
 * Record a conflict
 */
export const recordConflict = (
  userId: string, 
  entity: string, 
  entityId: string,
  conflictType: string
): void => {
  const metrics = getMetrics(userId);
  metrics.conflictsDetected++;
  
  logger.warn({
    event: 'sync_conflict_detected',
    userId,
    entity,
    entityId,
    conflictType,
  });
};

/**
 * Record conflict resolution
 */
export const recordConflictResolution = (
  userId: string, 
  resolution: string
): void => {
  const metrics = getMetrics(userId);
  metrics.conflictsResolved++;
  
  logger.info({
    event: 'sync_conflict_resolved',
    userId,
    resolution,
  });
};

/**
 * Update pending ops count
 */
export const updatePendingOpsCount = (
  userId: string, 
  count: number
): void => {
  const metrics = getMetrics(userId);
  metrics.pendingOpsCount = count;
  
  if (count > 100) {
    logger.warn({
      event: 'sync_high_pending_ops',
      userId,
      count,
    });
  }
};

// ==================== HEALTH CHECK ====================

interface SyncHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  metrics: {
    totalPushAttempts: number;
    totalPullAttempts: number;
    successRate: number;
    avgLatency: number;
    pendingOps: number;
    unresolvedConflicts: number;
  };
}

/**
 * Get sync health status
 */
export const getSyncHealth = (userId: string): SyncHealth => {
  const metrics = getMetrics(userId);
  const issues: string[] = [];
  
  // Calculate success rate
  const totalAttempts = metrics.pushAttempts + metrics.pullAttempts;
  const totalSuccesses = metrics.pushSuccesses + metrics.pullSuccesses;
  const successRate = totalAttempts > 0 ? totalSuccesses / totalAttempts : 1;
  
  // Calculate average latency
  const avgLatency = (metrics.avgPushLatency + metrics.avgPullLatency) / 2;
  
  // Calculate unresolved conflicts
  const unresolvedConflicts = metrics.conflictsDetected - metrics.conflictsResolved;
  
  // Check for issues
  if (successRate < 0.9) {
    issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
  }
  
  if (avgLatency > 5000) {
    issues.push(`High latency: ${avgLatency.toFixed(0)}ms`);
  }
  
  if (metrics.pendingOpsCount > 100) {
    issues.push(`High pending ops: ${metrics.pendingOpsCount}`);
  }
  
  if (unresolvedConflicts > 0) {
    issues.push(`Unresolved conflicts: ${unresolvedConflicts}`);
  }
  
  if (metrics.lastSyncAt && Date.now() - metrics.lastSyncAt > 3600000) {
    issues.push('No sync in last hour');
  }
  
  // Determine status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (issues.length > 0) status = 'degraded';
  if (issues.length > 2 || successRate < 0.5) status = 'unhealthy';
  
  return {
    status,
    issues,
    metrics: {
      totalPushAttempts: metrics.pushAttempts,
      totalPullAttempts: metrics.pullAttempts,
      successRate: Math.round(successRate * 100) / 100,
      avgLatency: Math.round(avgLatency),
      pendingOps: metrics.pendingOpsCount,
      unresolvedConflicts,
    },
  };
};

// ==================== PROMETHEUS METRICS FORMAT ====================

/**
 * Get metrics in Prometheus format
 */
export const getPrometheusMetrics = (): string => {
  const lines: string[] = [];
  
  lines.push('# HELP btp_sync_push_total Total number of sync push attempts');
  lines.push('# TYPE btp_sync_push_total counter');
  
  lines.push('# HELP btp_sync_pull_total Total number of sync pull attempts');
  lines.push('# TYPE btp_sync_pull_total counter');
  
  lines.push('# HELP btp_sync_latency_seconds Sync operation latency in seconds');
  lines.push('# TYPE btp_sync_latency_seconds histogram');
  
  lines.push('# HELP btp_sync_pending_ops Number of pending sync operations');
  lines.push('# TYPE btp_sync_pending_ops gauge');
  
  lines.push('# HELP btp_sync_conflicts_total Total number of sync conflicts');
  lines.push('# TYPE btp_sync_conflicts_total counter');
  
  for (const [userId, metrics] of metricsStore.entries()) {
    lines.push(`btp_sync_push_total{user="${userId}",result="success"} ${metrics.pushSuccesses}`);
    lines.push(`btp_sync_push_total{user="${userId}",result="failure"} ${metrics.pushFailures}`);
    lines.push(`btp_sync_pull_total{user="${userId}",result="success"} ${metrics.pullSuccesses}`);
    lines.push(`btp_sync_pull_total{user="${userId}",result="failure"} ${metrics.pullFailures}`);
    lines.push(`btp_sync_latency_seconds{user="${userId}",operation="push"} ${metrics.avgPushLatency / 1000}`);
    lines.push(`btp_sync_latency_seconds{user="${userId}",operation="pull"} ${metrics.avgPullLatency / 1000}`);
    lines.push(`btp_sync_pending_ops{user="${userId}"} ${metrics.pendingOpsCount}`);
    lines.push(`btp_sync_conflicts_total{user="${userId}"} ${metrics.conflictsDetected}`);
  }
  
  return lines.join('\n');
};

// ==================== ALERT FUNCTIONS ====================

interface AlertConfig {
  pendingOpsThreshold: number;
  errorRateThreshold: number;
  latencyThreshold: number;
  conflictThreshold: number;
}

const defaultAlertConfig: AlertConfig = {
  pendingOpsThreshold: 100,
  errorRateThreshold: 0.2,
  latencyThreshold: 10000,
  conflictThreshold: 5,
};

/**
 * Check if alerts should be triggered
 */
export const checkAlerts = (
  userId: string, 
  config: AlertConfig = defaultAlertConfig
): string[] => {
  const metrics = getMetrics(userId);
  const alerts: string[] = [];
  
  // Pending ops alert
  if (metrics.pendingOpsCount > config.pendingOpsThreshold) {
    alerts.push(`HIGH_PENDING_OPS: ${metrics.pendingOpsCount} operations pending for user ${userId}`);
  }
  
  // Error rate alert
  const totalAttempts = metrics.pushAttempts + metrics.pullAttempts;
  const totalFailures = metrics.pushFailures + metrics.pullFailures;
  const errorRate = totalAttempts > 0 ? totalFailures / totalAttempts : 0;
  
  if (errorRate > config.errorRateThreshold) {
    alerts.push(`HIGH_ERROR_RATE: ${(errorRate * 100).toFixed(1)}% errors for user ${userId}`);
  }
  
  // Latency alert
  const avgLatency = (metrics.avgPushLatency + metrics.avgPullLatency) / 2;
  if (avgLatency > config.latencyThreshold) {
    alerts.push(`HIGH_LATENCY: ${avgLatency.toFixed(0)}ms average latency for user ${userId}`);
  }
  
  // Conflict alert
  const unresolvedConflicts = metrics.conflictsDetected - metrics.conflictsResolved;
  if (unresolvedConflicts > config.conflictThreshold) {
    alerts.push(`UNRESOLVED_CONFLICTS: ${unresolvedConflicts} conflicts for user ${userId}`);
  }
  
  // Log alerts
  for (const alert of alerts) {
    logger.warn({ event: 'sync_alert', userId, alert });
  }
  
  return alerts;
};

// ==================== RESET METRICS ====================

/**
 * Reset metrics for a user
 */
export const resetMetrics = (userId: string): void => {
  metricsStore.set(userId, { ...defaultMetrics });
};

/**
 * Reset all metrics
 */
export const resetAllMetrics = (): void => {
  metricsStore.clear();
};
