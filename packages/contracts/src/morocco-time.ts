// Decree 2.26.530 returned Morocco to GMT at 02:00 local on 20 September 2026.
// Older browser and Node timezone databases can still display GMT+1 afterwards.
const GMT_TRANSITION = Date.UTC(2026, 8, 20, 1);

export function moroccoTimeZone(instant: Date): 'UTC' | 'Africa/Casablanca' {
  return instant.getTime() >= GMT_TRANSITION ? 'UTC' : 'Africa/Casablanca';
}

const civilTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Converts a PMMP civil date into an instant. An ambiguous hour uses the earlier occurrence. */
export function parsePmmpDate(text: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const [y, m, d, h, min] = [Number(year), Number(month), Number(day), Number(hour), Number(minute)] as const;
  const naive = Date.UTC(y, m - 1, d, h, min);
  const check = new Date(naive);
  if (y < 2000 || m < 1 || m > 12 || d < 1 || h > 23 || min > 59 ||
      check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  for (const offset of [60, 0]) {
    const date = new Date(naive - offset * 60_000);
    if (moroccoTimeZone(date) === 'UTC') {
      if (offset === 0) return date;
      continue;
    }
    const parts = Object.fromEntries(civilTime.formatToParts(date).map((p) => [p.type, p.value]));
    if (Number(parts.year) === y && Number(parts.month) === m && Number(parts.day) === d &&
        Number(parts.hour) === h && Number(parts.minute) === min) return date;
  }
  return null;
}

const FRENCH_MONTHS: Record<string, number> = {
  jan: 1, janvier: 1, fev: 2, fevr: 2, fevrier: 2, mar: 3, mars: 3,
  avr: 4, avril: 4, mai: 5, juin: 6, jui: 7, juil: 7, juillet: 7,
  aou: 8, aout: 8, sep: 9, sept: 9, septembre: 9, oct: 10, octobre: 10,
  nov: 11, novembre: 11, dec: 12, decembre: 12,
};

/** Reads the numeric or French date and time displayed by PMMP. */
export function parsePmmpDeadline(text: string): Date | null {
  const numeric = /(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2})/.exec(text);
  if (numeric) return parsePmmpDate(`${numeric[1]} ${numeric[2]}`);
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = /\b(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\s+(\d{2}:\d{2})/.exec(normalized);
  if (!match) return null;
  const [, day, monthName, year, time] = match;
  const month = FRENCH_MONTHS[monthName!];
  return month ? parsePmmpDate(`${day!.padStart(2, '0')}/${String(month).padStart(2, '0')}/${year} ${time}`) : null;
}
