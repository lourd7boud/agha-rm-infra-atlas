/**
 * Frontend Logger
 * Structured logging for the frontend application.
 * 
 * - In development: logs to console with formatting  
 * - In production: suppresses debug/info, sends errors to backend
 * - Captures unhandled errors and promise rejections globally
 */

const isDev = import.meta.env.DEV;
const LOG_ENDPOINT = `${import.meta.env.BASE_URL}api/health/client-error`;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: any;
  timestamp: string;
  url: string;
  userAgent: string;
}

class FrontendLogger {
  private queue: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  debug(message: string, data?: any) {
    if (isDev) {
      console.debug(`[DEBUG] ${message}`, data ?? '');
    }
  }

  info(message: string, data?: any) {
    if (isDev) {
      console.info(`[INFO] ${message}`, data ?? '');
    }
  }

  warn(message: string, data?: any) {
    if (isDev) {
      console.warn(`[WARN] ${message}`, data ?? '');
    }
    this.enqueue('warn', message, data);
  }

  error(message: string, data?: any) {
    if (isDev) {
      console.error(`[ERROR] ${message}`, data ?? '');
    }
    this.enqueue('error', message, data);
  }

  private enqueue(level: LogLevel, message: string, data?: any) {
    // Only send warn/error to backend
    if (level !== 'warn' && level !== 'error') return;

    const entry: LogEntry = {
      level,
      message: message.substring(0, 500), // Limit message size
      data: data ? this.sanitize(data) : undefined,
      timestamp: new Date().toISOString(),
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    };

    this.queue.push(entry);

    // Debounce: flush after 2 seconds of inactivity
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 2000);

    // Flush immediately if queue is large
    if (this.queue.length >= 10) {
      this.flush();
    }
  }

  private flush() {
    if (this.queue.length === 0) return;
    const entries = [...this.queue];
    this.queue = [];

    // Fire-and-forget POST to backend  
    const token = localStorage.getItem('authToken');
    fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ errors: entries }),
      credentials: 'include',
    }).catch(() => {
      // Silently fail — we don't want logging to cause more errors
    });
  }

  private sanitize(data: any): any {
    try {
      if (data instanceof Error) {
        return {
          name: data.name,
          message: data.message,
          stack: isDev ? data.stack?.substring(0, 1000) : undefined,
        };
      }
      // Ensure serializable and size-limited
      const str = JSON.stringify(data);
      if (str.length > 2000) {
        return JSON.parse(str.substring(0, 2000) + '..."truncated"');
      }
      return data;
    } catch {
      return String(data).substring(0, 500);
    }
  }
}

export const appLogger = new FrontendLogger();

/**
 * Install global error handlers
 * Call this once at app startup
 */
export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return;

  // Unhandled JS errors
  window.addEventListener('error', (event) => {
    appLogger.error(`Unhandled error: ${event.message}`, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    appLogger.error(
      `Unhandled promise rejection: ${reason?.message || reason}`,
      reason instanceof Error ? reason : undefined
    );
  });
}
