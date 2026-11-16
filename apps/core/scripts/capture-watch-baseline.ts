import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { isPmmpUrl, nextPmmpOpening, PmmpClosedError } from '../src/lib/pmmp-hours';
import { PortalBlockedError, PradoPortalSource } from '../src/modules/watch/watch.source';

const PAGE_LIMIT = 200;
const PAGE_SIZE = 50;
const DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Uses the public detail anchors directly, independent of the radar's card parser.
function readPage(html: string, base: string) {
  const $ = load(html);
  const results = $('[id$="_resultSearch_panelElementsFound"]');
  if (results.length !== 1) throw new Error('Unrecognized PMMP listing');
  const count = (selector: string) => {
    const field = results.find(selector);
    const text = field.text().replace(/\s/g, '');
    return field.length === 1 && /^\d+$/.test(text) ? Number(text) : null;
  };
  const declared = count('[id$="_resultSearch_nombreElement"]');
  const declaredPages = count('[id$="_resultSearch_nombrePageTop"]');
  const pageField = results.find('input[id$="_resultSearch_numPageTop"]');
  const rawPage = pageField.attr('value') ?? '';
  const displayedPage = pageField.length === 1 && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : null;
  const selector = 'a[href*="EntrepriseDetailsConsultation"]';
  const cards = results.find('.contentColumn .tender_item');
  const identities: string[] = [];
  let invalidLinks = results.find(selector).length - cards.find(selector).length;
  for (const card of cards) {
    const anchors = $(card).find(selector);
    const cardIds = new Set<string>();
    let valid = anchors.length > 0;
    for (const anchor of anchors) {
      try {
        const url = new URL($(anchor).attr('href') ?? '', base);
        const ref = url.searchParams.get('refConsultation') ?? '';
        const org = url.searchParams.get('orgAcronyme') ?? '';
        if (!isPmmpUrl(url.href) || url.searchParams.get('page') !== 'entreprise.EntrepriseDetailsConsultation' ||
            !/^\d{1,20}$/.test(ref) || !/^[a-z\d_]{1,40}$/i.test(org)) {
          valid = false;
        } else {
          cardIds.add(`${ref}/${org}`);
        }
      } catch {
        valid = false;
      }
    }
    if (valid && cardIds.size === 1) identities.push([...cardIds][0]!);
    else invalidLinks += 1;
  }
  return { declared, declaredPages, displayedPage, hasPageField: pageField.length > 0, identities, invalidLinks };
}

class InvalidListingError extends Error {}

function readVerifiedPage(html: string, base: string, page: number, archived = false) {
  const observation = readPage(html, base);
  if (observation.displayedPage !== null && observation.displayedPage !== page) {
    throw new InvalidListingError(`expected page ${page}, portal displayed page ${observation.displayedPage}`);
  }
  if (observation.hasPageField && observation.displayedPage === null) {
    throw new InvalidListingError('invalid displayed page number');
  }
  const initialEmpty = page === 1 && observation.declared === 0 && observation.identities.length === 0 &&
    observation.invalidLinks === 0 && (observation.declaredPages ?? 0) <= 1;
  if (!archived && !initialEmpty && observation.displayedPage === null && observation.declaredPages !== 1) {
    throw new InvalidListingError('missing displayed page number');
  }
  const declared = observation.declared;
  if (declared === null || (!initialEmpty && (declared === 0 || observation.identities.length === 0))) {
    throw new InvalidListingError('missing count or consultation links');
  }
  return { ...observation, declared };
}

function checkHours(): void {
  const reopening = nextPmmpOpening();
  if (reopening) throw new PmmpClosedError(reopening);
}

function failureReason(error: unknown): string {
  if (error instanceof PmmpClosedError) return 'scheduled closure';
  if (error instanceof InvalidListingError) return error.message;
  if (!(error instanceof Error)) return 'request or source format failed';
  const status = /\bHTTP (\d{3})\b/.exec(error.message)?.[1];
  if (status) return `portal HTTP ${status}`;
  const cause = error.cause;
  const causeCode = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : null;
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || causeCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'portal request timed out';
  }
  if (error.message === 'Unrecognized PMMP listing') return 'unrecognized listing format';
  return 'request or source format failed';
}

async function main() {
  const [output, fixture] = process.argv.slice(2);
  const url = process.env.WATCH_PMMP_URL;
  if (!output || !url || !isPmmpUrl(url)) {
    throw new Error('Usage: set WATCH_PMMP_URL to the official radar scope and run capture-watch-baseline.ts output.json [archived-page.html]');
  }
  const observedFrom = new Date();
  let requestedPage = 1;
  const source = new PradoPortalSource(url, {
    attempts: 3,
    backoffMs: 4000,
    pageSize: PAGE_SIZE,
    fetchImpl: async (input, init) => {
      checkHours();
      const response = await fetch(input, init);
      if (response.status === 888) throw new PortalBlockedError(888);
      if (response.ok) {
        try {
          // Reject invalid HTML before Prado adopts its form state or cookies.
          readVerifiedPage(await response.clone().text(), url, requestedPage);
        } catch (error) {
          void response.body?.cancel().catch(() => undefined);
          throw error;
        }
      }
      return response;
    },
    sleep: async (ms) => { checkHours(); await sleep(ms); },
  });
  const identities = new Set<string>();
  const repeats = new Set<string>();
  const declaredValues = new Set<number>();
  const declaredPageCounts = new Set<number | null>();
  const pageObservations: {
    page: number; displayedPage: number | null; observedAt: string;
    declared: number; declaredPages: number | null; identities: string[];
  }[] = [];
  let invalidLinks = 0;
  let pages = 0;
  let lastVerifiedPage = 0;
  let finished = false;
  let interruption: string | null = fixture ? 'single archived page' : null;

  if (!fixture) checkHours();
  for (let page = 1; page <= PAGE_LIMIT; page++) {
    try {
      requestedPage = page;
      const result = fixture ? { html: await readFile(fixture, 'utf8'), hasNext: false } : await source.fetch(page);
      const observation = readVerifiedPage(result.html, url, page, Boolean(fixture));
      pages += 1;
      if (observation.displayedPage !== null) lastVerifiedPage = observation.displayedPage;
      pageObservations.push({
        page,
        displayedPage: observation.displayedPage,
        observedAt: new Date().toISOString(),
        declared: observation.declared,
        declaredPages: observation.declaredPages,
        identities: observation.identities,
      });
      declaredValues.add(observation.declared);
      declaredPageCounts.add(observation.declaredPages);
      invalidLinks += observation.invalidLinks;
      for (const id of observation.identities) {
        if (identities.has(id)) repeats.add(id);
        identities.add(id);
      }
      if (!fixture && page % 25 === 0) {
        console.error(`PMMP baseline: ${page} pages, ${identities.size} distinct consultations`);
      }
      if (result.hasNext === false) { finished = true; break; }
      if (page < PAGE_LIMIT) await sleep(DELAY_MS);
    } catch (error) {
      interruption = `${failureReason(error)} on page ${page}`;
      break;
    }
  }
  if (!pages) throw new Error(interruption ?? 'No official listing pages observed');
  if (!finished && !interruption) interruption = 'page limit reached';
  const complete = !fixture && finished && !interruption && declaredValues.size === 1 &&
    declaredValues.has(identities.size) && declaredPageCounts.size === 1 &&
    declaredPageCounts.has(pages) && repeats.size === 0 && invalidLinks === 0;
  const capture = {
    scopeHash: createHash('sha256').update(url).digest('hex'),
    observedFrom,
    observedAt: new Date(),
    complete,
    interruption,
    pages,
    lastVerifiedPage,
    declaredValues: [...declaredValues],
    declaredPageCounts: [...declaredPageCounts],
    repeated: [...repeats],
    invalidLinks,
    identities: [...identities],
    pageObservations,
  };
  await writeFile(output, JSON.stringify(capture, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ complete, pages, unique: identities.size, interruption }));
  if (!complete && !fixture) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
