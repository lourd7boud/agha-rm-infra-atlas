import type { DocumentKind } from '@atlas/contracts';
import {
  BID_REQUIRED_KINDS,
  computeReadiness,
  type ReadinessDoc,
} from '../vault/validity';

/**
 * Compliance Officer (agent B1) — the exact administrative checklist for one
 * tender (tender-lifecycle §3), crossed with the vault's live documents.
 * One missing item = elimination; the division KPI is zero of those.
 */

export type ChecklistStatus =
  | 'ok'
  | 'a_renouveler'
  | 'manquant'
  | 'a_faire'
  | 'a_verifier';

export interface ChecklistItem {
  code: string;
  label: string;
  status: ChecklistStatus;
  detail?: string;
}

export interface ComplianceChecklist {
  ready: boolean;
  items: readonly ChecklistItem[];
  counts: {
    ok: number;
    aRenouveler: number;
    manquant: number;
    aFaire: number;
    aVerifier: number;
  };
}

export interface ComplianceTenderInput {
  reference: string;
  cautionProvisoireMad?: number;
  raw: Record<string, unknown> | null;
}

const VAULT_LABELS: Record<string, string> = {
  attestation_fiscale: 'Attestation fiscale (DGI, moins d’un an)',
  attestation_cnss: 'Attestation CNSS (moins d’un an)',
  qualification_classification: 'Certificat de qualification et de classification',
  registre_commerce: 'Registre de commerce',
  statuts: 'Statuts de la société',
  pouvoirs_signataire: 'Pouvoirs du signataire',
};

function vaultItems(
  docs: readonly ReadinessDoc[],
  today: Date,
): ChecklistItem[] {
  const readiness = computeReadiness(docs, today);
  return BID_REQUIRED_KINDS.map((kind: DocumentKind): ChecklistItem => {
    const label = VAULT_LABELS[kind] ?? kind;
    if (readiness.expired.includes(kind)) {
      return {
        code: `vault:${kind}`,
        label,
        status: 'manquant',
        detail: 'Document expiré — à renouveler avant soumission',
      };
    }
    if (readiness.missing.includes(kind)) {
      return {
        code: `vault:${kind}`,
        label,
        status: 'manquant',
        detail: 'Absent du coffre-fort',
      };
    }
    if (readiness.expiring.includes(kind)) {
      return {
        code: `vault:${kind}`,
        label,
        status: 'a_renouveler',
        detail: 'Valide aujourd’hui mais expire bientôt — renouvellement à lancer',
      };
    }
    return { code: `vault:${kind}`, label, status: 'ok' };
  });
}

function tenderItems(tender: ComplianceTenderInput): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      code: 'declaration_honneur',
      label: 'Déclaration sur l’honneur',
      status: 'a_faire',
      detail: 'À établir et signer spécifiquement pour cet AO',
    },
  ];

  if (tender.cautionProvisoireMad !== undefined) {
    items.push({
      code: 'caution_provisoire',
      label: `Caution provisoire — ${tender.cautionProvisoireMad.toLocaleString('fr-MA')} MAD`,
      status: 'a_faire',
      detail: 'Demande à adresser à la banque (délai bancaire à anticiper)',
    });
  } else {
    items.push({
      code: 'caution_provisoire',
      label: 'Caution provisoire',
      status: 'a_verifier',
      detail: 'Montant à confirmer au DCE avant demande bancaire',
    });
  }

  const extraction = (tender.raw?.['extraction'] ?? null) as Record<
    string,
    unknown
  > | null;

  const qualifications = extraction?.['qualificationsRequises'];
  if (Array.isArray(qualifications)) {
    for (const qualification of qualifications) {
      if (typeof qualification === 'string' && qualification.length > 0) {
        items.push({
          code: `qualification:${qualification}`,
          label: `Qualification exigée — ${qualification}`,
          status: 'a_verifier',
          detail: 'Vérifier la détention du certificat correspondant',
        });
      }
    }
  }

  const visite = extraction?.['visiteDesLieux'];
  if (typeof visite === 'string' && visite.length > 0) {
    items.push({
      code: 'visite_lieux',
      label: `Visite des lieux — ${visite}`,
      status: 'a_faire',
      detail: 'À planifier (caractère obligatoire à confirmer au RC)',
    });
  }

  return items;
}

export function buildComplianceChecklist(
  tender: ComplianceTenderInput,
  vaultDocs: readonly ReadinessDoc[],
  today: Date,
): ComplianceChecklist {
  const items = [...vaultItems(vaultDocs, today), ...tenderItems(tender)];
  const count = (status: ChecklistStatus) =>
    items.filter((item) => item.status === status).length;

  return {
    ready: items.every((item) => item.status !== 'manquant'),
    items,
    counts: {
      ok: count('ok'),
      aRenouveler: count('a_renouveler'),
      manquant: count('manquant'),
      aFaire: count('a_faire'),
      aVerifier: count('a_verifier'),
    },
  };
}
