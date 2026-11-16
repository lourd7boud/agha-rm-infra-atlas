import { moroccoTimeZone, parsePmmpDate } from '@atlas/contracts';

export function isPmmpUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname, protocol } = new URL(url);
    return (protocol === 'https:' || protocol === 'http:') &&
      (hostname === 'marchespublics.gov.ma' || hostname === 'www.marchespublics.gov.ma');
  } catch {
    return false;
  }
}

/** PMMP's published daily access window is 07:30 to midnight in Morocco. */
export function nextPmmpOpening(now = new Date()): Date | null {
  const timeZone = moroccoTimeZone(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
  if (time >= '07:30') return null;
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(now);
  return parsePmmpDate(`${day} 07:30`);
}

export class PmmpClosedError extends Error {
  constructor(readonly portalReopensAt: Date) {
    super('PMMP closed for the night');
    this.name = 'PmmpClosedError';
  }
}
