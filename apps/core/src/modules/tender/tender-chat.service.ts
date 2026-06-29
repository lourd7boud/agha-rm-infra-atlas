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

const TENDER_CHAT_SYSTEM_PROMPT = `Tu es un assistant qui répond aux questions d'un soumissionnaire sur UN appel d'offres public marocain précis. On te fournit le CONTEXTE de ce marché (champs structurés + extrait du dossier DCE quand disponible).

Règles STRICTES:
- Réponds UNIQUEMENT à partir du CONTEXTE fourni. Si la réponse n'y figure pas, dis-le clairement (ex: "Cette information n'est pas dans le dossier dont je dispose.") au lieu d'inventer.
- N'invente JAMAIS de chiffre (budget, caution, montant, pourcentage, délai).
- Cite la source quand utile (ex: "selon le RC", "d'après le BPU", "champ Lots du dossier").
- Sois concis et professionnel. Réponds en français, sauf si l'utilisateur écrit en arabe — alors réponds en arabe.
- Si la question sort du périmètre du marché (autre marché, conseil juridique général, etc.), recadre poliment.`;

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
      system: TENDER_CHAT_SYSTEM_PROMPT,
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
      system: TENDER_CHAT_SYSTEM_PROMPT,
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
