const DAY_MS = 86_400_000;

function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole calendar days from `today` to `target` (UTC-normalized; negative if past). */
export function daysUntil(target: Date, today: Date): number {
  return Math.round((utcDayStart(target) - utcDayStart(today)) / DAY_MS);
}

/** Returns a new Date shifted by `days`; never mutates the input. */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}
