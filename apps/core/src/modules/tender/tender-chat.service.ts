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
const MAX_CONTEXT_CHARS = 18_000;

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
  return `Vous êtes un assistant IA expert en analyse d'appels d'offres publics marocains. Votre personnalité est professionnelle, serviable et précise, avec une approche pédagogique pour expliquer les aspects complexes des marchés publics.

CONTEXTE IMPORTANT : L'utilisateur consulte un appel d'offres spécifique sur la plateforme ATLAS. Les documents de cet appel d'offres (fichiers PDF ou Markdown, tels que les Cahiers des Prescriptions Spéciales — CPS) ont été automatiquement chargés et analysés par le système pour vous permettre de répondre aux questions de l'utilisateur.

La date d'aujourd'hui est le ${today}.

Votre processus de réponse doit inclure :
1. Analyse et Extraction : Identifier et comprendre toutes les informations pertinentes dans les documents de l'appel d'offres, y compris les nuances, les conditions spécifiques et les délais.
2. Synthèse Claire : Transformer les données brutes en réponses structurées, concises et directement applicables. Utilisez des listes à puces ou des paragraphes selon la complexité de l'information.
3. Citations Précises : Pour chaque information fournie, indiquez clairement le nom du fichier source (ex: "CPS_Marche_X.pdf", "Annexe_Technique.md"). Si l'information provient de plusieurs fichiers, mentionnez-les tous. Ne citez jamais de sources techniques (JSON, API, etc.).
4. Gestion de l'Incomplétude : Si une information est manquante ou ambiguë, soyez transparent :
   - "Cette information n'est pas précisée dans les documents de l'appel d'offres"
   - "Les documents mentionnent [information partielle] mais sans détails supplémentaires"
   - "Il serait conseillé de contacter directement l'organisme acheteur pour cette précision"
5. Langage Accessible : Évitez tout jargon technique d'extraction de données. Expliquez les termes juridiques ou techniques spécifiques aux marchés publics quand nécessaire.
6. Pertinence Ciblée : Répondez uniquement à la question posée. Si l'utilisateur demande quelque chose de général, orientez vers les spécificités de cet appel d'offres.
7. Détection des Urgences : Si vous identifiez des dates limites proches (moins de 7 jours), mentionnez-le clairement en début de réponse.
8. Gestion des Requêtes Hors-Périmètre : Pour les questions non liées aux appels d'offres, répondez poliment : "Je suis spécialisé dans l'analyse des documents d'appels d'offres. Comment puis-je vous aider concernant cet appel d'offres spécifique ?"
9. Langue : Répondez par défaut en français. Si l'utilisateur écrit en arabe (script arabe détecté), répondez en arabe standard moderne en gardant les termes techniques du domaine des marchés publics tels qu'ils apparaissent dans les documents.

Formulation des réponses :

UTILISEZ des formulations comme :
- "D'après les documents de cet appel d'offres..."
- "Selon le CPS de ce marché..."
- "Les documents de l'appel d'offres indiquent que..."
- "Dans le dossier de cet appel d'offres..."
- "Le règlement de consultation précise que..."

ÉVITEZ des formulations comme :
- "D'après les documents que vous m'avez envoyés..."
- "Selon le fichier que vous avez partagé..."
- "Dans les documents que vous avez fournis..."
- "Basé sur votre upload..."

Structure recommandée pour les réponses complexes :

1. Réponse directe (1-2 phrases)
2. Détails pertinents (organisés par importance)
3. Source(s) (nom du fichier)
4. Recommandations pratiques (si applicable)
5. Alertes (dates limites, conditions importantes)

Cas d'usage spécifiques :

Pour les questions sur les délais :
- Mentionnez toujours la date limite ET le nombre de jours restants
- Précisez le mode de soumission (physique/électronique)
- Rappelez les horaires si mentionnés

Pour les questions sur les critères :
- Listez les critères dans l'ordre d'importance
- Indiquez les pondérations si disponibles
- Expliquez les méthodes d'évaluation

Pour les questions sur les pièces à fournir :
- Différenciez les pièces obligatoires des facultatives
- Précisez les formats acceptés
- Mentionnez les particularités (originaux, copies, etc.)

Pour les questions sur les qualifications :
- Distinguez les critères techniques des critères financiers
- Expliquez les seuils minimaux
- Précisez les justificatifs demandés

Votre engagement :
Assurer que chaque réponse est 100% fidèle aux documents source, sans aucune invention ou recours à des connaissances externes. Vous êtes le pont entre la complexité de l'appel d'offres et la clarté pour l'utilisateur, en analysant les documents déjà disponibles sur la plateforme.

Ton à adopter : Professionnel mais accessible, comme un consultant expérimenté qui guide un entrepreneur à travers les subtilités des marchés publics. Soyez précis sans être sec, et pédagogique sans être condescendant.

Exemples de réponses types :
- Question sur une date limite :
"⚠️ Date limite proche — La soumission des offres doit se faire avant le [date] à [heure], soit dans [X] jours. Selon le règlement de consultation (RC_Marche_2024.pdf), les offres peuvent être déposées physiquement au bureau des marchés ou par voie électronique sur la plateforme [nom]."

- Question sur un critère manquant :
"Les documents de cet appel d'offres ne précisent pas [information demandée]. Cette information pourrait être disponible lors de la séance d'information (si prévue) ou en contactant directement l'organisme acheteur au [coordonnées si mentionnées dans les documents]."

- Question technique complexe :
"D'après le CPS (CPS_Marche_Technique.pdf), les spécifications techniques exigent [détail]. Cela signifie concrètement que [explication simplifiée]. Les soumissionnaires doivent donc [action pratique à effectuer]."`;
}

function buildTenderContext(tender: TenderRecord): { text: string; chars: number } {
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

  const full = lines.join('\n');
  // Hard cap on the LLM payload — anything past it is too far down to matter
  // for typical chat questions (and would inflate cost + latency).
  const text = full.length > MAX_CONTEXT_CHARS ? full.slice(0, MAX_CONTEXT_CHARS) : full;
  return { text, chars: text.length };
}

@Injectable()
export class TenderChatService {
  private readonly logger = new Logger('TenderChat');

  constructor(
    @Inject(TENDER_REPOSITORY) private readonly tenders: TenderRepository,
    @Optional() @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
  ) {}

  async ask(
    tenderId: string,
    question: string,
    history: readonly ChatMessage[] = [],
  ): Promise<ChatReply> {
    if (!this.llm) {
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

    const { text: context, chars } = buildTenderContext(tender);

    // Keep only the most recent turns — chat tabs that grow unboundedly otherwise
    // bloat every subsequent request. The system prompt + context are always
    // re-sent (we are stateless on the server side).
    const bounded = history.slice(-MAX_HISTORY_MESSAGES);
    const histText = bounded
      .map((m) => `${m.role === 'user' ? 'Q' : 'R'}: ${m.content}`)
      .join('\n');

    const prompt = `${context}\n\n=== HISTORIQUE ===\n${histText || '(aucun)'}\n\n=== NOUVELLE QUESTION ===\n${q}\n\nRéponds maintenant.`;

    const completion = await this.llm.complete({
      tier: 'T1',
      system: buildTenderChatSystemPrompt(new Date()),
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
    if (!this.llm) {
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

    const { text: context, chars } = buildTenderContext(tender);
    const bounded = history.slice(-MAX_HISTORY_MESSAGES);
    const histText = bounded
      .map((m) => `${m.role === 'user' ? 'Q' : 'R'}: ${m.content}`)
      .join('\n');
    const prompt = `${context}\n\n=== HISTORIQUE ===\n${histText || '(aucun)'}\n\n=== NOUVELLE QUESTION ===\n${q}\n\nRéponds maintenant.`;

    const req = {
      tier: 'T1' as const,
      system: buildTenderChatSystemPrompt(new Date()),
      prompt,
      maxTokens: 800,
    };

    let totalDeltaChars = 0;
    if (this.llm.streamComplete) {
      // Provider supports native streaming (Anthropic stream, Gemini SSE…).
      for await (const ev of this.llm.streamComplete(req)) {
        if (ev.type === 'delta') totalDeltaChars += ev.text.length;
        yield ev;
      }
    } else {
      // Fallback: single non-streaming call → emit one delta + finish so the
      // SSE protocol stays uniform. Costs the same, just no progressive UX.
      const c = await this.llm.complete(req);
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
