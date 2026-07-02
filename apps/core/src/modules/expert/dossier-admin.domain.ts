import type { DocumentKind } from '@atlas/contracts';
import type { ReadinessReport } from '../vault/validity';
import type { TenderRecord } from '../tender/tender.repository';

/**
 * Dossier administratif & financier builder — assembles the piece-by-piece
 * submission checklist for one consultation (decree 2-22-431 shape): which
 * vault documents are on hand / expired / à fournir, which pieces the agent
 * can generate (déclaration, acte d'engagement, bordereau), and the exact
 * caution + montant figures those pieces must carry. Pure: readiness comes
 * from vault/validity, money from the tender + the agent's BPU proposal.
 */

export type PieceStatut =
  | 'disponible'
  | 'a_fournir'
  | 'expire'
  | 'a_generer'
  | 'a_etablir';

export interface DossierPiece {
  code: string;
  label: string;
  volet: 'administratif' | 'technique' | 'financier';
  statut: PieceStatut;
  note?: string;
}

export interface QualificationRequirement {
  secteur?: string | null;
  qualification?: string | null;
  classe?: string | null;
}

export interface AdminFinancialDossier {
  reference: string;
  buyerName: string;
  objet: string;
  generatedAt: string;
  readinessScore: number;
  ready: boolean;
  pieces: DossierPiece[];
  cautionProvisoireMad: number | null;
  qualificationsRequises: QualificationRequirement[];
  chiffreAffairesMinMad: number | null;
  delaiExecutionMois: number | null;
  acteEngagement: {
    montantMad: number | null;
    montantEnLettres: string | null;
  };
}

const KIND_LABELS: Partial<Record<DocumentKind, string>> = {
  attestation_fiscale: "Attestation fiscale (moins d'un an)",
  attestation_cnss: 'Attestation CNSS (situation régulière)',
  qualification_classification: 'Certificat de qualification et classification',
  registre_commerce: 'Registre de commerce (modèle J / RC)',
  statuts: 'Statuts de la société',
  pouvoirs_signataire: 'Pouvoirs du signataire',
};

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
  'dix-sept',
  'dix-huit',
  'dix-neuf',
] as const;

const TENS: Record<number, string> = {
  2: 'vingt',
  3: 'trente',
  4: 'quarante',
  5: 'cinquante',
  6: 'soixante',
  8: 'quatre-vingt',
};

/**
 * `final` = nothing follows this group inside the number. "cent" and
 * "quatre-vingt" only take their plural s in final position: deux cents
 * dirhams BUT deux cent mille; quatre-vingts BUT quatre-vingt mille.
 * (million/milliard are nouns, so a count before them stays final.)
 */
function below100(n: number, final: boolean): string {
  if (n < 20) return UNITS[n] as string;
  const tens = Math.floor(n / 10);
  const rest = n % 10;
  // 70-79 and 90-99 build on soixante/quatre-vingt + 10-19.
  if (tens === 7 || tens === 9) {
    const base = tens === 7 ? 'soixante' : 'quatre-vingt';
    const teen = UNITS[10 + rest] as string;
    if (tens === 7 && rest === 1) return 'soixante et onze';
    return `${base}-${teen}`;
  }
  const tensWord = TENS[tens] as string;
  if (rest === 0) return tens === 8 && final ? 'quatre-vingts' : tensWord;
  if (rest === 1 && tens !== 8) return `${tensWord} et un`;
  return `${tensWord}-${UNITS[rest]}`;
}

function below1000(n: number, final: boolean): string {
  if (n < 100) return below100(n, final);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const prefix =
    hundreds === 1
      ? 'cent'
      : rest === 0 && final
        ? `${UNITS[hundreds]} cents`
        : `${UNITS[hundreds]} cent`;
  return rest === 0 ? prefix : `${prefix} ${below100(rest, final)}`;
}

function scaleWord(
  count: number,
  singular: string,
  plural: string,
  countIsFinal: boolean,
): string {
  const countWords =
    count === 1 && singular === 'mille' ? '' : below1000(count, countIsFinal);
  const word = count > 1 ? plural : singular;
  return countWords ? `${countWords} ${word}` : word;
}

function integerToFrench(n: number): string {
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const milliards = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1_000);
  const rest = n % 1000;
  // million/milliard are nouns → the count keeps its final form before them;
  // mille is a numeral adjective → the count loses the plural s.
  if (milliards > 0) parts.push(scaleWord(milliards, 'milliard', 'milliards', true));
  if (millions > 0) parts.push(scaleWord(millions, 'million', 'millions', true));
  if (milliers > 0) parts.push(scaleWord(milliers, 'mille', 'mille', false));
  if (rest > 0) parts.push(below1000(rest, true));
  return parts.join(' ');
}

/**
 * "1 144 774,88" → "un million cent quarante-quatre mille sept cent
 * soixante-quatorze dirhams et quatre-vingt-huit centimes". The legal spelled
 * amount for the acte d'engagement. Bounded below a trillion MAD.
 */
export function montantEnLettresFr(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0 || amount >= 1_000_000_000_000) {
    throw new Error('Montant hors limites pour la conversion en lettres');
  }
  const dirhams = Math.floor(amount);
  const centimes = Math.round((amount - dirhams) * 100);
  // A raw x.995+ float rounds its centimes to 100 — carry into the dirhams
  // instead of emitting the illegal "et cent centimes".
  if (centimes >= 100) return montantEnLettresFr(dirhams + 1);
  const dirhamWord = dirhams > 1 || dirhams === 0 ? 'dirhams' : 'dirham';
  const main = `${integerToFrench(dirhams)} ${dirhamWord}`;
  if (centimes === 0) return main;
  const centimeWord = centimes > 1 ? 'centimes' : 'centime';
  return `${main} et ${integerToFrench(centimes)} ${centimeWord}`;
}

export interface AdminDossierInput {
  tender: Pick<
    TenderRecord,
    'reference' | 'buyerName' | 'objet' | 'cautionProvisoireMad' | 'estimationMad'
  >;
  readiness: ReadinessReport;
  requiredKinds: readonly DocumentKind[];
  qualifications: readonly QualificationRequirement[];
  chiffreAffairesMinMad?: number | null;
  delaiExecutionMois?: number | null;
  /** Total of the agent's BPU proposal — fills the acte d'engagement. */
  proposedTotalMad?: number | null;
  now: Date;
}

const fmtMad = (value: number): string =>
  `${new Intl.NumberFormat('fr-FR').format(Math.round(value))} MAD`;

export function buildAdminFinancialDossier(
  input: AdminDossierInput,
): AdminFinancialDossier {
  const { tender, readiness, requiredKinds, now } = input;

  const vaultPieces: DossierPiece[] = requiredKinds.map((kind) => {
    const statut: PieceStatut = readiness.missing.includes(kind)
      ? 'a_fournir'
      : readiness.expired.includes(kind)
        ? 'expire'
        : 'disponible';
    const expiring = readiness.expiring.includes(kind);
    return {
      code: kind,
      label: KIND_LABELS[kind] ?? kind,
      volet: 'administratif',
      statut,
      ...(expiring ? { note: 'Expire bientôt — renouveler avant dépôt.' } : {}),
    };
  });

  const caution = tender.cautionProvisoireMad ?? null;
  const montant = input.proposedTotalMad ?? null;

  const generatedPieces: DossierPiece[] = [
    {
      code: 'declaration_honneur',
      label: "Déclaration sur l'honneur",
      volet: 'administratif',
      statut: 'a_generer',
      note: 'Générée depuis le profil entreprise — à dater et signer.',
    },
    {
      code: 'caution_provisoire',
      label: 'Caution provisoire (attestation bancaire)',
      volet: 'administratif',
      statut: 'a_etablir',
      note:
        caution !== null
          ? `Montant exigé : ${fmtMad(caution)} — à demander à la banque.`
          : 'Montant non publié — vérifier le règlement de consultation.',
    },
    {
      code: 'cps_signe',
      label: 'CPS paraphé et signé',
      volet: 'administratif',
      statut: 'a_etablir',
      note: 'Chaque page paraphée, dernière page signée avec cachet.',
    },
    {
      code: 'dossier_technique',
      label: 'Dossier technique (moyens humains, matériels, références)',
      volet: 'technique',
      statut: 'a_etablir',
      ...(input.qualifications.length > 0
        ? { note: 'Joindre les certificats couvrant les qualifications exigées.' }
        : {}),
    },
    {
      code: 'acte_engagement',
      label: "Acte d'engagement",
      volet: 'financier',
      statut: 'a_generer',
      note:
        montant !== null
          ? `Montant proposé : ${fmtMad(montant)} (en lettres ci-dessous).`
          : 'Montant à reporter depuis le bordereau des prix une fois chiffré.',
    },
    {
      code: 'bordereau_prix',
      label: 'Bordereau des prix unitaires (BPU)',
      volet: 'financier',
      statut: montant !== null ? 'a_generer' : 'a_etablir',
      note:
        montant !== null
          ? 'Rempli par la proposition de prix AGHA — à relire ligne par ligne.'
          : 'Lancer la proposition de prix AGHA (BPU extrait requis).',
    },
    {
      code: 'detail_estimatif',
      label: 'Détail estimatif',
      volet: 'financier',
      statut: montant !== null ? 'a_generer' : 'a_etablir',
    },
  ];

  return {
    reference: tender.reference,
    buyerName: tender.buyerName,
    objet: tender.objet,
    generatedAt: now.toISOString(),
    readinessScore: readiness.score,
    ready: readiness.ready,
    pieces: [...vaultPieces, ...generatedPieces],
    cautionProvisoireMad: caution,
    qualificationsRequises: [...input.qualifications],
    chiffreAffairesMinMad: input.chiffreAffairesMinMad ?? null,
    delaiExecutionMois: input.delaiExecutionMois ?? null,
    acteEngagement: {
      montantMad: montant,
      montantEnLettres: montant !== null ? montantEnLettresFr(montant) : null,
    },
  };
}
