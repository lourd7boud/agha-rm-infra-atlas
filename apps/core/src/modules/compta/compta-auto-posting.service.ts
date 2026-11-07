// Pont Ventes → Compta : transforme un événement de facturation confirmé en
// écriture comptable AUTOMATIQUEMENT, pour que le comptable ne soit que
// superviseur. Best-effort par conception : un échec de génération est journalisé,
// jamais propagé à l'appelant (le changement de statut de la facture reste valide)
// — le batch idempotent « Générer depuis les ventes » demeure le filet de secours.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { COMPTA_REPOSITORY, type ComptaRepository } from './compta.repository';
import {
  VENTE_POSTING_NEEDS_ATTENTION,
  type VentePostingResult,
} from './compta-ventes.domain';
import type { ReglementMethod } from './compta-reglements.domain';

@Injectable()
export class ComptaAutoPostingService {
  private readonly logger = new Logger(ComptaAutoPostingService.name);

  constructor(
    @Inject(COMPTA_REPOSITORY) private readonly compta: ComptaRepository,
  ) {}

  /**
   * Fired when a sales invoice is confirmed (leaves 'brouillon'). Posts the sale
   * écriture (D 3421 / C 71242 / C 4455) — auto-validated when certain, else left
   * as brouillon for the accountant.
   */
  onInvoiceConfirmed(invoiceId: string, actor: string | null): Promise<VentePostingResult> {
    return this.run('vente', invoiceId, () =>
      this.compta.genererEcritureVente(invoiceId, actor),
    );
  }

  /**
   * Fired when an invoice is marked paid (status → 'payee'). Posts the
   * encaissement écriture (D 514x/516x / C 3421) for the received amount.
   */
  onInvoicePaid(
    invoiceId: string,
    actor: string | null,
    method?: ReglementMethod,
  ): Promise<VentePostingResult> {
    return this.run('encaissement', invoiceId, () =>
      this.compta.genererEcritureEncaissement(invoiceId, actor, { method }),
    );
  }

  /**
   * Non-throwing (never fails the status change) but NEVER silent: run a posting,
   * return its structured outcome AND log — WARN for the "should have posted but
   * couldn't" reasons (incoherent totals, closed exercice, unexpected error) so a
   * human is guaranteed a trace, ERROR for an unexpected exception, quiet for
   * benign no-ops (already posted / still draft). Idempotent.
   */
  private async run(
    kind: string,
    invoiceId: string,
    poster: () => Promise<VentePostingResult>,
  ): Promise<VentePostingResult> {
    try {
      const result = await poster();
      if (result.created) {
        this.logger.log(
          `Écriture ${kind} ${result.validated ? 'validée' : 'brouillon'} — facture ${invoiceId}`,
        );
      } else if (VENTE_POSTING_NEEDS_ATTENTION.includes(result.reason)) {
        this.logger.warn(
          `Écriture ${kind} NON générée (${result.reason}) — facture ${invoiceId} à régulariser manuellement.`,
        );
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Auto-post ${kind} échoué (facture ${invoiceId}) : ${(error as Error).message}`,
      );
      return { created: false, reason: 'error' };
    }
  }
}
