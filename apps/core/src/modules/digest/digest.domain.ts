import type { DocumentKind } from '@atlas/contracts';
import { daysUntil } from '../../lib/dates';
import type { ReadinessReport } from '../vault/validity';

/**
 * Daily digest (governance §2): the 07:30 brief the Direction reads first.
 * Pure composition over repository data — rendering and delivery are
 * separate concerns.
 */

export interface DigestTenderInput {
  reference: string;
  buyerName: string;
  objet: string;
  pipelineState: string;
  deadlineAt: Date;
  raw: Record<string, unknown> | null;
}

export interface DigestWallEntry {
  reference: string;
  buyerName: string;
  daysLeft: number;
  state: string;
  urgency: 'rouge' | 'orange' | 'normal';
}

export interface Digest {
  date: string;
  wall: readonly DigestWallEntry[];
  urgent: readonly DigestWallEntry[];
  pendingG1: readonly string[];
  readiness: ReadinessReport;
  counts: {
    suivis: number;
    urgents: number;
    enAttenteG1: number;
    documentsManquants: number;
  };
}

const ACTIVE_STATES = new Set([
  'detected',
  'parsed',
  'qualified',
  'go_decided',
  'preparing',
  'submitted',
]);

function urgencyOf(daysLeft: number): DigestWallEntry['urgency'] {
  if (daysLeft <= 7) return 'rouge';
  if (daysLeft <= 15) return 'orange';
  return 'normal';
}

export function buildDigest(
  tenders: readonly DigestTenderInput[],
  readiness: ReadinessReport,
  today: Date,
): Digest {
  const active = tenders.filter((t) => ACTIVE_STATES.has(t.pipelineState));
  const wall = active
    .map((t) => ({
      reference: t.reference,
      buyerName: t.buyerName,
      daysLeft: daysUntil(t.deadlineAt, today),
      state: t.pipelineState,
      urgency: urgencyOf(daysUntil(t.deadlineAt, today)),
    }))
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const urgent = wall.filter((entry) => entry.urgency !== 'normal');

  // Qualified tenders await a human Go/No-Go — they block the pipeline.
  const pendingG1 = active
    .filter((t) => t.pipelineState === 'qualified')
    .map((t) => t.reference);

  return {
    date: today.toISOString().slice(0, 10),
    wall,
    urgent,
    pendingG1,
    readiness,
    counts: {
      suivis: wall.length,
      urgents: urgent.length,
      enAttenteG1: pendingG1.length,
      documentsManquants: readiness.missing.length + readiness.expired.length,
    },
  };
}

const KIND_LABELS: Partial<Record<DocumentKind, string>> = {
  attestation_fiscale: 'Attestation fiscale',
  attestation_cnss: 'Attestation CNSS',
  qualification_classification: 'Certificat de qualification',
  registre_commerce: 'Registre de commerce',
  statuts: 'Statuts',
  pouvoirs_signataire: 'Pouvoirs du signataire',
};

function labelOf(kind: DocumentKind): string {
  return KIND_LABELS[kind] ?? kind;
}

/** French text rendering — the body for email/WhatsApp delivery. */
export function renderDigestFr(digest: Digest): string {
  const lines: string[] = [
    `ATLAS — Brief du ${digest.date}`,
    `${digest.counts.suivis} AO suivis · ${digest.counts.urgents} urgents · ${digest.counts.enAttenteG1} en attente de décision G1`,
    '',
  ];

  if (digest.urgent.length > 0) {
    lines.push('— ÉCHÉANCES CRITIQUES —');
    for (const entry of digest.urgent) {
      lines.push(
        `J-${entry.daysLeft}  ${entry.reference}  (${entry.buyerName}) [${entry.state}]`,
      );
    }
    lines.push('');
  }

  if (digest.pendingG1.length > 0) {
    lines.push('— DÉCISIONS G1 EN ATTENTE —');
    for (const ref of digest.pendingG1) lines.push(`• ${ref}`);
    lines.push('');
  }

  lines.push(
    `— COFFRE-FORT — score ${digest.readiness.score}/100 ${digest.readiness.ready ? '(prêt à soumissionner)' : '(DOSSIER INCOMPLET)'}`,
  );
  if (digest.readiness.missing.length > 0) {
    lines.push(`Manquants: ${digest.readiness.missing.map(labelOf).join(', ')}`);
  }
  if (digest.readiness.expired.length > 0) {
    lines.push(`Expirés: ${digest.readiness.expired.map(labelOf).join(', ')}`);
  }
  if (digest.readiness.expiring.length > 0) {
    lines.push(`À renouveler: ${digest.readiness.expiring.map(labelOf).join(', ')}`);
  }

  return lines.join('\n');
}
