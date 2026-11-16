import { isPortalBlockedError } from './portal-fetch';

interface GateOptions {
  shouldPause?: () => Promise<boolean>;
  onBlocked?: () => Promise<void>;
  delayMs?: number;
}

export class PortalPausedError extends Error {
  constructor(message = 'Portal cooldown in progress') {
    super(message);
    this.name = 'PortalPausedError';
  }
}

export function isPortalPausedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'PortalPausedError';
}

/** One in-flight listing/detail request per worker; cooldown is shared in Redis.
 * Operations create their HTTP deadlines only after obtaining the gate. */
export class PortalRequestGate {
  private tail: Promise<void> = Promise.resolve();
  private availableAt = 0;

  constructor(private readonly options: GateOptions = {}) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const delay = Math.max(0, this.availableAt - Date.now());
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (await this.options.shouldPause?.()) throw new PortalPausedError();
      try {
        return await operation();
      } catch (error) {
        if (isPortalBlockedError(error)) await this.options.onBlocked?.();
        throw error;
      }
    } finally {
      this.availableAt = Date.now() + Math.max(0, this.options.delayMs ?? 0);
      release();
    }
  }
}
