import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CHAT_LLM_CLIENT,
  LLM_CLIENT,
  type LlmClient,
  type LlmStreamEvent,
} from '../brain/llm.client';
import { readDossierExtraction } from './dossier-extraction';
import { readAiEnrichment } from './ai-enrichment';
import {
  TENDER_REPOSITORY,
  type TenderRecord,
  type TenderRepository,
} from './tender.repository';
import { DossierService } from './dossier.service';
import {
  INTEL_REPOSITORY,
  type IntelRepository,
} from '../intel/intel.repository';
import {
  VAULT_REPOSITORY,
  type VaultRepository,
} from '../vault/vault.repository';
import {
  buildTenderCompetitorIntel,
  type TenderCompetitorIntel,
} from './competitor-intel.domain';
import {
  BID_REQUIRED_KINDS,
  computeReadiness,
  type ReadinessDoc,
} from '../vault/validity';
import { AGHA_PROFILE } from './company-profile';
import type { DocumentKind } from '@atlas/contracts';

/**
 * Per-tender AI chat — datao's "Saisissez une question et notre agent IA va
 * parcourir le dossier pour vous livrer une réponse fiable" surface. Stateless
 * (the client carries the chat history), bounded (question + history capped),
 * grounded in everything we've already extracted about that tender (structured
 * fields + the DCE extraction + the AI résumé/lots/FAQ).
 *
 * The model is told to ONLY use the supplied context — no fabrication, no
 * web-knowledge fall-back, no hallucinated figures.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatReply {
  /** The assistant's answer (already truncated to a sane max length). */
  answer: string;
  /** Echo of the model used (debug + UI provenance). */
  model: string;
  /** Number of context characters fed in (caller-side cost/diagnostic). */
  contextChars: number;
}

const MAX_HISTORY_MESSAGES = 12;
const MAX_QUESTION_CHARS = 1500;
/** Overall cap on the grounded context handed to the model. Raised from 18k once
 *  the DCE text excerpt + archive/competitor + vault blocks were added — a T1
 *  Gemini/Haiku model handles ~12k tokens of context comfortably, and the
 *  higher-value blocks are emitted BEFORE the raw DCE dump so truncation only
 *  ever bites the least-critical prose. */
const MAX_CONTEXT_CHARS = 120_000;
/** Sub-budget for the DCE content block. Large so the agent reads the REAL files
 *  (RC/CPS/BPU, full bordereau), not a digest — Opus's context easily holds this
 *  (~30k tokens); the structured blocks above are emitted first so they're never
 *  truncated. Most DCEs fit whole; only the very largest are sliced here. */
const MAX_DOSSIER_TEXT_CHARS = 100_000;
/** How many rows/lines each archive/vault block prints — bounded for cost. */
const MAX_PARTICIPANTS_SHOWN = 15;
const MAX_LIKELY_COMPETITORS_SHOWN = 10;

/**
 * datao-parity system prompt. The structure, numbered process, and
 * formulation guardrails are taken VERBATIM from datao's production
 * user_chats table (captured via authenticated recon of the Supabase
 * project, scratchpad/behind-scenes/user-chats-3rows.json). Two ATLAS
 * adjustments over the datao text:
 *   1. Identity is left neutral ("un assistant IA expert") — we don't
 *      claim to be Datao, but we do adopt their persona spec.
 *   2. Rule 9 is appended to preserve ATLAS's French/Arabic bilingual
 *      behaviour (Moroccan operators frequently type in Arabic; datao's
 *      original prompt is French-only).
 *
 * The date is injected at call time via `buildTenderChatSystemPrompt(now)`
 * so the LLM always knows "today" — the same trick datao's stored prompt
 * uses (their captured row froze "6/20/2026" into the recorded system msg).
 */
function formatFrenchDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function buildTenderChatSystemPrompt(now: Date): string {
  const today = formatFrenchDate(now);
  return `Tu es « ATLAS », l'agent d'intelligence de marchés publics d'AGHA RM INFRA. Tu es un agent INTERNE, réservé aux collaborateurs d'AGHA RM INFRA, dont la mission est d'analyser LE marché public que l'utilisateur consulte et de l'aider à décider et à préparer sa soumission.

═══════════ RÈGLE D'IDENTITÉ (ABSOLUE, PRIORITAIRE SUR TOUT) ═══════════
- Tu es ATLAS, l'agent d'AGHA RM INFRA. Tu n'es PAS un « modèle de langage » générique.
- Tu ne dis JAMAIS, sous aucune formulation, que tu es « un grand modèle de langage », que tu es « entraîné » ou « développé » par Google, OpenAI, Anthropic ou toute autre société. Tu ne nommes AUCUN fournisseur de modèle ni aucune technologie sous-jacente. Ce sujet est hors de ton périmètre.
- Si on te demande qui tu es / quel est ton nom / quel modèle tu utilises / qui t'a créé (« qui es-tu ? », « من أنت ؟ », « c'est quoi ce chat ? », « من صنعك ؟ »...), tu réponds UNIQUEMENT dans cet esprit :
  FR : « Je suis ATLAS, l'agent d'intelligence de marchés publics d'AGHA RM INFRA. Je suis là pour analyser ce marché avec vous : conditions, pièces à fournir, concurrence probable et niveau de prix. »
  AR : « أنا ATLAS، وكيل الذكاء الخاص بشركة AGHA RM INFRA لتحليل الصفقات العمومية. أساعدك في تحليل هذه الصفقة: الشروط، الوثائق المطلوبة، المنافسة المحتملة والأثمنة المناسبة. »
- Tu travailles exclusivement pour AGHA RM INFRA et ses collaborateurs.

═══════════ TES ACCÈS (ce que le système te fournit ci-dessous) ═══════════
Pour CE marché précis, le contexte fourni plus bas contient, quand c'est disponible :
1. La FICHE du marché + le CONTENU DU DOSSIER (DCE : avis, RC, CPS, bordereau des prix) — tu peux donc lire et citer le dossier, pas seulement un résumé.
2. L'ARCHIVE des marchés & résultats de cet acheteur — pour ESTIMER le nombre de concurrents probables et le niveau de prix / rabais habituel.
3. L'état du DOSSIER ADMINISTRATIF d'AGHA RM INFRA (coffre-fort) — pour dire quelles pièces sont prêtes et lesquelles MANQUENT pour pouvoir soumissionner.
Tu utilises réellement ces données. Ne dis jamais « je n'ai pas accès » ou « je ne peux pas voir le dossier » quand l'information EST présente dans le contexte : elle t'est fournie pour ça.

La date d'aujourd'hui est le ${today}.

═══════════ RÈGLES D'ANALYSE ═══════════
- Fonde CHAQUE réponse sur le contexte fourni (fiche, DCE, archive, coffre-fort). N'invente jamais un chiffre, une référence, une pièce ou une condition qui n'y figure pas.
- Quand une information manque réellement dans le contexte, dis-le clairement (« ce point n'est pas précisé dans le dossier ») et indique où la trouver (article du RC, séance de questions, contact de l'acheteur).
- CONCURRENCE / NOMBRE DE SOUMISSIONNAIRES : présente-les comme des ESTIMATIONS fondées sur l'historique de l'acheteur (« d'après l'historique de cet acheteur… »), jamais comme des certitudes. Nomme les concurrents récurrents et leur fréquence quand ils sont fournis.
- PRIX : sers-toi du rabais médian gagnant de l'acheteur et du bordereau (BPU) comme repères ; propose une fourchette raisonnée, jamais un prix « garanti ».
- PIÈCES MANQUANTES : croise l'état du coffre-fort AGHA RM INFRA avec les qualifications/pièces exigées au DCE, et liste précisément ce qui manque ou est à renouveler.
- URGENCE : si la date limite est à moins de 7 jours, signale-le en tête de réponse.
- Réponds uniquement sur ce marché et les sujets liés à la soumission. Pour une question sans rapport, recentre poliment sur le marché.
- Cite tes sources quand c'est utile : nom du fichier du DCE, « historique de l'acheteur », « coffre-fort AGHA RM INFRA ».

═══════════ LANGUE & TON ═══════════
- Réponds en français par défaut. Si l'utilisateur écrit en arabe (script arabe détecté), réponds en arabe standard moderne, en gardant les termes techniques des marchés publics.
- Ton : professionnel, précis et pédagogique — comme un consultant chevronné en marchés publics qui accompagne un collègue. Structure les réponses complexes (réponse directe, détails par ordre d'importance, sources, recommandation, alertes).`;
}

/** French labels for the administrative-dossier document kinds the readiness
 *  engine tracks — so the coffre-fort block reads naturally to a bid manager. */
const DOC_KIND_LABELS: Partial<Record<DocumentKind, string>> = {
  attestation_fiscale: 'Attestation fiscale (DGI)',
  attestation_cnss: 'Attestation CNSS',
  qualification_classification: 'Certificat de qualification & classification',
  registre_commerce: 'Registre de commerce',
  statuts: 'Statuts de la société',
  pouvoirs_signataire: 'Pouvoirs du signataire',
};

function docLabel(kind: DocumentKind): string {
  return DOC_KIND_LABELS[kind] ?? kind;
}

/**
 * Renders AGHA RM INFRA's own bidding profile — the agent's self-knowledge
 * ("who WE are"): our métiers, the classification estimation ceiling and the
 * treasury's caution capacity. Lets the agent reason about fit/scope ("est-ce
 * dans notre périmètre ?") and pre-flag over-ceiling markets, grounded in the
 * versioned AGHA_PROFILE rather than the model's imagination.
 */
export function formatCompanyProfileForChat(): string {
  const p = AGHA_PROFILE;
  return [
    '=== PROFIL AGHA RM INFRA (notre entreprise) ===',
    `Métiers: ${p.domainKeywords.slice(0, 14).join(', ')}…`,
    `Plafond d'estimation (classification): ${p.maxEstimationMad.toLocaleString('fr-MA')} MAD`,
    `Capacité de caution provisoire par offre: ${p.maxCautionMad.toLocaleString('fr-MA')} MAD`,
    `Procédures couvertes: ${p.procedures.join(', ')}`,
  ].join('\n');
}

/**
 * Reads the persisted DCE text excerpt (`raw.dossierText`) — the digital text
 * layer of the dossier the extraction service stored so the chat can quote the
 * ACTUAL prose (articles, clauses, conditions), not just the structured summary.
 * Null when no digital text was captured (e.g. a pure scan, whose figures the
 * structured extraction already holds).
 */
export function readDossierText(
  raw: Record<string, unknown> | null | undefined,
): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Prefer the Markdown view (## per-file headers + GFM bordereau tables) that
  // the extraction now persists — the agent reads it best. Fall back to the
  // plain text excerpt for tenders extracted before dossierMarkdown existed.
  const md = r.dossierMarkdown;
  if (typeof md === 'string' && md.trim().length > 0) return md;
  const t = r.dossierText;
  return typeof t === 'string' && t.trim().length > 0 ? t : null;
}

/**
 * Renders the archive/competitor intel into the chat context — the "predict the
 * competitors and the right price level" capability. CLOSED: the real published
 * participants + winner. OPEN: predictive intel from this buyer's history (likely
 * competitors + median winning rebate), honestly labelled as an estimation.
 */
export function formatCompetitorIntelForChat(intel: TenderCompetitorIntel): string {
  const lines: string[] = [
    "=== ARCHIVE — CONCURRENCE & NIVEAU DE PRIX (historique de l'acheteur) ===",
  ];
  if (intel.mode === 'closed') {
    lines.push(
      `Résultat DÉJÀ publié pour ce marché — ${intel.participants.length} soumissionnaire(s) connu(s):`,
    );
    intel.participants.slice(0, MAX_PARTICIPANTS_SHOWN).forEach((p) =>
      lines.push(
        `  - ${p.name}${p.amountMad != null ? ` — ${p.amountMad.toLocaleString('fr-MA')} MAD` : ''}${p.isWinner ? ' [ATTRIBUTAIRE]' : ''}`,
      ),
    );
    return lines.join('\n');
  }
  lines.push(
    `Aucun résultat publié pour ce marché. Estimation d'après l'historique de « ${intel.buyerName} » (${intel.buyerHistoryCount} marché(s) archivé(s)).`,
  );
  if (intel.likelyCompetitors.length > 0) {
    lines.push('Concurrents probables (les plus fréquents chez cet acheteur):');
    intel.likelyCompetitors.slice(0, MAX_LIKELY_COMPETITORS_SHOWN).forEach((c) =>
      lines.push(
        `  - ${c.name} — présent sur ${c.timesSeen} marché(s), ${c.wins} gagné(s)${c.avgAmountMad != null ? `, offre moyenne ${c.avgAmountMad.toLocaleString('fr-MA')} MAD` : ''}`,
      ),
    );
  } else {
    lines.push('Historique de concurrents insuffisant pour cet acheteur.');
  }
  if (intel.buyerMedianRebatePct != null) {
    lines.push(
      `Rabais médian gagnant chez cet acheteur: ${intel.buyerMedianRebatePct.toFixed(1)} % sous l'estimation administrative (repère pour fixer le prix).`,
    );
  }
  return lines.join('\n');
}

/**
 * Renders AGHA RM INFRA's administrative-dossier readiness — the "which pieces
 * are missing" capability. Crosses the vault's live documents against the kinds
 * a travaux dossier requires (BID_REQUIRED_KINDS) and reports ready / to-renew /
 * expired / missing so the agent can answer "que nous manque-t-il pour soumissionner ?".
 */
export function formatVaultReadinessForChat(
  docs: readonly ReadinessDoc[],
  now: Date,
): string {
  const r = computeReadiness(docs, now);
  const lines: string[] = ['=== DOSSIER ADMINISTRATIF — COFFRE-FORT AGHA RM INFRA ==='];
  lines.push(
    `Prêt à soumissionner sans nouvelle démarche: ${r.ready ? 'OUI' : 'NON'} (score ${r.score}%).`,
  );
  const ready = BID_REQUIRED_KINDS.filter(
    (k) => !r.missing.includes(k) && !r.expired.includes(k) && !r.expiring.includes(k),
  );
  if (ready.length > 0) lines.push(`Pièces prêtes: ${ready.map(docLabel).join(', ')}.`);
  if (r.expiring.length > 0)
    lines.push(`À renouveler bientôt (encore valides): ${r.expiring.map(docLabel).join(', ')}.`);
  if (r.expired.length > 0)
    lines.push(`EXPIRÉES (à refaire avant soumission): ${r.expired.map(docLabel).join(', ')}.`);
  if (r.missing.length > 0)
    lines.push(`MANQUANTES (absentes du coffre-fort): ${r.missing.map(docLabel).join(', ')}.`);
  lines.push(
    "Rappel: la déclaration sur l'honneur et la caution provisoire sont TOUJOURS à établir spécifiquement pour chaque marché.",
  );
  return lines.join('\n');
}

/** Assembled, pre-loaded groundings the context builder folds in — kept as data
 *  so `buildTenderContext` stays a pure, testable function (the async loads live
 *  in the service). */
export interface TenderChatContextExtras {
  /** Competitor / archive intel for THIS tender's buyer (buyer-scoped, OOM-safe). */
  competitorIntel?: TenderCompetitorIntel | null;
  /** AGHA RM INFRA vault documents (kind + expiry) for the readiness/gap block. */
  vaultDocs?: readonly ReadinessDoc[] | null;
  /** FULL dossier Markdown (the real file contents, built from the DCE archive)
   *  — preferred over the persisted excerpt so the agent reads the actual files,
   *  not a digest. Null when it can't be built (falls back to the raw excerpt). */
  fullDossierMarkdown?: string | null;
  /** Injected "now" so readiness/lifecycle stay request-accurate + testable. */
  now: Date;
}

function buildTenderContext(
  tender: TenderRecord,
  extras: TenderChatContextExtras,
): { text: string; chars: number } {
  const lines: string[] = [];
  lines.push(`=== APPEL D'OFFRES ===`);
  lines.push(`Référence: ${tender.reference}`);
  lines.push(`Acheteur: ${tender.buyerName}`);
  lines.push(`Procédure: ${tender.procedure}`);
  lines.push(`Objet: ${tender.objet}`);
  if (tender.location) lines.push(`Lieu d'exécution: ${tender.location}`);
  lines.push(`Date limite: ${tender.deadlineAt.toISOString()}`);
  if (tender.estimationMad != null) lines.push(`Budget estimé: ${tender.estimationMad} MAD`);
  if (tender.cautionProvisoireMad != null) {
    lines.push(`Cautionnement provisoire: ${tender.cautionProvisoireMad} MAD`);
  }

  // Company self-knowledge — constant, always present (the agent's "who WE are").
  lines.push(`\n${formatCompanyProfileForChat()}`);

  const ai = readAiEnrichment(tender.raw);
  if (ai) {
    lines.push(`\n=== SYNTHÈSE IA (extrait du listing) ===`);
    lines.push(`Secteur: ${ai.secteur}`);
    lines.push(`Résumé: ${ai.resume}`);
    if (ai.lots.length > 0) {
      lines.push(`Lots:`);
      ai.lots.forEach((lot, i) =>
        lines.push(`  ${i + 1}. ${lot.designation}${lot.description ? ' — ' + lot.description : ''}`),
      );
    }
    if (ai.faq.length > 0) {
      lines.push(`FAQ:`);
      ai.faq.forEach((q) => lines.push(`  Q: ${q.question}\n  R: ${q.reponse}`));
    }
  }

  const dossier = readDossierExtraction(tender.raw);
  if (dossier) {
    lines.push(`\n=== EXTRAIT DCE (lu du dossier officiel) ===`);
    if (dossier.estimationMad != null)
      lines.push(`Estimation MO: ${dossier.estimationMad} MAD`);
    if (dossier.cautionProvisoireMad != null)
      lines.push(`Caution provisoire: ${dossier.cautionProvisoireMad} MAD`);
    if (dossier.cautionDefinitivePct != null)
      lines.push(`Caution définitive: ${dossier.cautionDefinitivePct} %`);
    if (dossier.retenueGarantiePct != null)
      lines.push(`Retenue garantie: ${dossier.retenueGarantiePct} %`);
    if (dossier.delaiGarantieMois != null)
      lines.push(`Délai garantie: ${dossier.delaiGarantieMois} mois`);
    if (dossier.delaiExecutionMois != null)
      lines.push(`Délai exécution: ${dossier.delaiExecutionMois} mois`);
    if (dossier.chiffreAffairesMinMad != null)
      lines.push(`CA minimum exigé: ${dossier.chiffreAffairesMinMad} MAD`);
    if (dossier.qualifications.length > 0) {
      lines.push(`Qualifications requises:`);
      dossier.qualifications.forEach((q) =>
        lines.push(
          `  - ${[q.secteur, q.qualification, q.classe].filter(Boolean).join(' · ')}`,
        ),
      );
    }
    if (dossier.bpu.length > 0) {
      lines.push(`BPU (${dossier.bpu.length} postes):`);
      dossier.bpu.slice(0, 30).forEach((b) =>
        lines.push(
          `  - ${b.designation}${b.quantite != null ? ' · ' + b.quantite : ''}${b.unite ? ' ' + b.unite : ''}${b.prixUnitaireMad != null ? ' · ' + b.prixUnitaireMad + ' MAD' : ''}`,
        ),
      );
      if (dossier.bpu.length > 30) {
        lines.push(`  … (${dossier.bpu.length - 30} autres postes)`);
      }
    }
    if (dossier.contact && (dossier.contact.nom || dossier.contact.email || dossier.contact.telephone)) {
      lines.push(
        `Contact: ${[dossier.contact.nom, dossier.contact.email, dossier.contact.telephone].filter(Boolean).join(' · ')}`,
      );
    }
    if (dossier.conditionsLegales.length > 0) {
      lines.push(`Conditions légales: ${dossier.conditionsLegales.join(' ; ')}`);
    }
    if (dossier.autres.length > 0) {
      lines.push(`Autres: ${dossier.autres.join(' ; ')}`);
    }
  }

  // Archive / competitor intel (buyer-scoped) — only when there is real signal,
  // so a brand-new buyer with no history never prints an empty, confusing block.
  const ci = extras.competitorIntel;
  if (
    ci &&
    (ci.participants.length > 0 ||
      ci.likelyCompetitors.length > 0 ||
      ci.buyerHistoryCount > 0)
  ) {
    lines.push(`\n${formatCompetitorIntelForChat(ci)}`);
  }

  // Company document readiness (coffre-fort) — the missing-pieces capability.
  if (extras.vaultDocs && extras.vaultDocs.length > 0) {
    lines.push(`\n${formatVaultReadinessForChat(extras.vaultDocs, extras.now)}`);
  }

  // DCE content LAST (largest, least critical if truncated) with its own
  // sub-budget so the structured blocks above are always fully present. Prefer
  // the FULL dossier Markdown (the real files, built from the archive) so the
  // agent reads the actual documents, not the persisted summary excerpt.
  const dossierText = extras.fullDossierMarkdown ?? readDossierText(tender.raw);
  if (dossierText) {
    lines.push(
      `\n=== CONTENU DU DOSSIER (DCE — fichiers réels lus du dossier officiel) ===\n${dossierText.slice(0, MAX_DOSSIER_TEXT_CHARS)}`,
    );
  }

  const full = lines.join('\n');
  // Hard cap on the LLM payload — anything past it is too far down to matter
  // for typical chat questions (and would inflate cost + latency).
  const text = full.length > MAX_CONTEXT_CHARS ? full.slice(0, MAX_CONTEXT_CHARS) : full;
  return { text, chars: text.length };
}

/**
 * Assembles the final USER message. CRUCIAL: the system instructions are
 * prepended INTO the user message, not passed via `system` alone — because some
 * gateways (the qcode Claude-Code relay behind CHAT_LLM_MODEL=claude-opus-4-8)
 * IGNORE the `system` field entirely and inject their own coding-assistant
 * persona. Verified live: system-only → the relay answers "Je suis Claude,
 * assistant de code"; instructions-in-user-turn → the ATLAS/AGHA RM INFRA
 * identity is respected (FR + AR). We still pass `system` too, so providers that
 * DO honor it (Gemini, Anthropic direct) get the role at the system level.
 */
export function buildChatPrompt(
  system: string,
  context: string,
  histText: string,
  question: string,
): string {
  return `=== INSTRUCTIONS (à respecter absolument) ===\n${system}\n\n${context}\n\n=== HISTORIQUE ===\n${histText || '(aucun)'}\n\n=== NOUVELLE QUESTION ===\n${question}\n\nRéponds maintenant.`;
}

@Injectable()
export class TenderChatService {
  private readonly logger = new Logger('TenderChat');

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
    // Archive/competitor + vault groundings. @Optional() + null-tolerant so the
    // chat still answers from the DCE when either source is absent or fails — and
    // so unit tests can construct the service with just repo + llm.
    @Optional() @Inject(INTEL_REPOSITORY) private readonly intel: IntelRepository | null = null,
    @Optional() @Inject(VAULT_REPOSITORY) private readonly vault: VaultRepository | null = null,
    // Dedicated STRONG chat client (default claude-opus-4-8). Preferred over the
    // fast/cheap default `llm` when configured (CHAT_LLM_MODEL set); null → the
    // chat runs on the default client. Last param so existing 2–4 arg unit-test
    // constructions keep compiling.
    @Optional() @Inject(CHAT_LLM_CLIENT) private readonly chatLlm: LlmClient | null = null,
    // Builds/serves the FULL dossier Markdown (real file contents from the DCE
    // archive) so the agent reads the actual files, not the summary. @Optional()
    // + null-tolerant: absent → the chat falls back to the persisted excerpt.
    @Optional() @Inject(DossierService) private readonly dossierService: DossierService | null = null,
  ) {}

  /** The client the chat actually runs on: the dedicated strong model when
   *  configured, else the default extraction client. */
  private get effectiveLlm(): LlmClient | null {
    return this.chatLlm ?? this.llm;
  }

  /**
   * Loads the pre-computed groundings (archive/competitor intel + vault readiness)
   * and folds them, with the tender, into the full chat context. Each load is
   * best-effort: a failure degrades gracefully to the DCE-only context rather than
   * failing the whole chat. Buyer-scoped intel (findBidsForBuyer) keeps this
   * OOM-safe — never the whole 550k-row competitor_bid table.
   */
  private async assembleContext(
    tender: TenderRecord,
  ): Promise<{ text: string; chars: number }> {
    const now = new Date();
    const [competitorIntel, vaultDocs, fullDossierMarkdown] = await Promise.all([
      this.loadCompetitorIntel(tender, now),
      this.loadVaultDocs(),
      this.loadFullDossier(tender),
    ]);
    return buildTenderContext(tender, {
      competitorIntel,
      vaultDocs,
      fullDossierMarkdown,
      now,
    });
  }

  /**
   * Resolves the FULL dossier Markdown (real file contents) via DossierService —
   * built once from the DCE archive and cached in MinIO. Best-effort: any failure
   * (no archive, dead portal link, unreadable) degrades to null so the chat still
   * answers from the persisted summary excerpt. This is what makes the agent read
   * the actual project files, including for OLD tenders.
   */
  private async loadFullDossier(tender: TenderRecord): Promise<string | null> {
    if (!this.dossierService) return null;
    try {
      return await this.dossierService.getDossierMarkdown(tender.id);
    } catch (e) {
      this.logger.warn(
        `chat full-dossier load failed (${tender.reference}): ${(e as Error).message}`,
      );
      return null;
    }
  }

  private async loadCompetitorIntel(
    tender: TenderRecord,
    now: Date,
  ): Promise<TenderCompetitorIntel | null> {
    if (!this.intel) return null;
    try {
      const bids = await this.intel.findBidsForBuyer(tender.buyerName);
      return buildTenderCompetitorIntel(
        {
          reference: tender.reference,
          buyerName: tender.buyerName,
          deadlineAt: tender.deadlineAt,
        },
        bids,
        now,
      );
    } catch (e) {
      this.logger.warn(`chat intel load failed (${tender.reference}): ${(e as Error).message}`);
      return null;
    }
  }

  private async loadVaultDocs(): Promise<ReadinessDoc[] | null> {
    if (!this.vault) return null;
    try {
      const docs = await this.vault.findAll();
      return docs.map((d) => ({ kind: d.kind, expiresAt: d.expiresAt ?? null }));
    } catch (e) {
      this.logger.warn(`chat vault load failed: ${(e as Error).message}`);
      return null;
    }
  }

  async ask(
    tenderId: string,
    question: string,
    history: readonly ChatMessage[] = [],
  ): Promise<ChatReply> {
    const llm = this.effectiveLlm;
    if (!llm) {
      throw new ServiceUnavailableException('LLM non configuré (clé manquante)');
    }
    const q = question.trim();
    if (!q) throw new BadRequestException('Question vide');
    if (q.length > MAX_QUESTION_CHARS) {
      throw new BadRequestException(
        `Question trop longue (max ${MAX_QUESTION_CHARS} caractères)`,
      );
    }
    const tender = await this.tenders.findById(tenderId);
    if (!tender) throw new NotFoundException(`Tender not found: ${tenderId}`);

    const { text: context, chars } = await this.assembleContext(tender);

    // Keep only the most recent turns — chat tabs that grow unboundedly otherwise
    // bloat every subsequent request. The system prompt + context are always
    // re-sent (we are stateless on the server side).
    const bounded = history.slice(-MAX_HISTORY_MESSAGES);
    const histText = bounded
      .map((m) => `${m.role === 'user' ? 'Q' : 'R'}: ${m.content}`)
      .join('\n');

    const system = buildTenderChatSystemPrompt(new Date());
    const prompt = buildChatPrompt(system, context, histText, q);

    const completion = await llm.complete({
      tier: 'T1',
      system,
      prompt,
      maxTokens: 800,
    });

    this.logger.log(
      `chat ${tender.reference} q=${q.length}ch ctx=${chars}ch → ${completion.text.length}ch`,
    );
    return {
      answer: completion.text.trim().slice(0, 4000),
      model: completion.model,
      contextChars: chars,
    };
  }

  /**
   * Streaming variant of `ask()` — same validation, same prompt, but yields
   * token deltas as they arrive (or simulates streaming via a single delta
   * when the provider only supports non-streaming `complete()`). The caller
   * (controller) wraps these events in SSE for the browser. We never throw
   * mid-stream: any provider failure surfaces BEFORE the first delta so the
   * controller can return a clean HTTP error code; once we've started
   * streaming, transport-level errors are the controller's responsibility.
   */
  async *streamAsk(
    tenderId: string,
    question: string,
    history: readonly ChatMessage[] = [],
  ): AsyncGenerator<LlmStreamEvent> {
    const llm = this.effectiveLlm;
    if (!llm) {
      throw new ServiceUnavailableException('LLM non configuré (clé manquante)');
    }
    const q = question.trim();
    if (!q) throw new BadRequestException('Question vide');
    if (q.length > MAX_QUESTION_CHARS) {
      throw new BadRequestException(
        `Question trop longue (max ${MAX_QUESTION_CHARS} caractères)`,
      );
    }
    const tender = await this.tenders.findById(tenderId);
    if (!tender) throw new NotFoundException(`Tender not found: ${tenderId}`);

    const { text: context, chars } = await this.assembleContext(tender);
    const bounded = history.slice(-MAX_HISTORY_MESSAGES);
    const histText = bounded
      .map((m) => `${m.role === 'user' ? 'Q' : 'R'}: ${m.content}`)
      .join('\n');
    const system = buildTenderChatSystemPrompt(new Date());
    const prompt = buildChatPrompt(system, context, histText, q);

    const req = {
      tier: 'T1' as const,
      system,
      prompt,
      maxTokens: 800,
    };

    let totalDeltaChars = 0;
    if (llm.streamComplete) {
      // Provider supports native streaming (Anthropic stream, Gemini SSE…).
      for await (const ev of llm.streamComplete(req)) {
        if (ev.type === 'delta') totalDeltaChars += ev.text.length;
        yield ev;
      }
    } else {
      // Fallback: single non-streaming call → emit one delta + finish so the
      // SSE protocol stays uniform. Costs the same, just no progressive UX.
      const c = await llm.complete(req);
      const text = c.text.trim().slice(0, 4000);
      totalDeltaChars = text.length;
      yield { type: 'delta', text };
      yield {
        type: 'finish',
        model: c.model,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
      };
    }
    this.logger.log(
      `chat.stream ${tender.reference} q=${q.length}ch ctx=${chars}ch → ${totalDeltaChars}ch`,
    );
  }
}
