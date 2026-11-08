'use client';

import { useActionState } from 'react';
import {
  ACCOUNTING_PROJECTION_BADGES,
  fmtCentsMad,
  fmtDate,
  INVOICE_SETTLEMENT_BADGES,
  type ClientRecord,
  type InvoiceAggregate,
} from '@/lib/sales';
import {
  createInvoiceCreditNote,
  deleteInvoiceDraft,
  issueInvoice,
  issueInvoiceCreditNote,
  recordInvoicePayment,
  reverseInvoicePayment,
  refundInvoiceCreditNote,
  updateInvoiceDraft,
  type SalesActionState,
} from '../actions';

interface InvoiceWorkflowProps {
  aggregate: InvoiceAggregate;
  client: ClientRecord;
  idempotencySeed: string;
}

const INITIAL_SALES_ACTION_STATE: SalesActionState = { status: 'idle' };

function ActionMessage({ state }: { state: SalesActionState }) {
  return (
    <p
      aria-live="polite"
      className={state.status === 'error' ? 'text-sm text-clay' : 'text-sm text-emerald'}
    >
      {state.status === 'error'
        ? state.message
        : state.status === 'success'
          ? 'Opération enregistrée.'
          : ''}
    </p>
  );
}

export function InvoiceWorkflow({
  aggregate,
  client,
  idempotencySeed,
}: InvoiceWorkflowProps) {
  const { invoice, settlement, payments, creditNotes } = aggregate;
  const [issueState, issueAction, issuing] = useActionState(
    issueInvoice,
    INITIAL_SALES_ACTION_STATE,
  );
  const [updateState, updateAction, updating] = useActionState(
    updateInvoiceDraft,
    INITIAL_SALES_ACTION_STATE,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteInvoiceDraft,
    INITIAL_SALES_ACTION_STATE,
  );
  const [paymentState, paymentAction, paying] = useActionState(
    recordInvoicePayment,
    INITIAL_SALES_ACTION_STATE,
  );
  const [reversalState, reversalAction, reversing] = useActionState(
    reverseInvoicePayment,
    INITIAL_SALES_ACTION_STATE,
  );
  const [creditState, creditAction, crediting] = useActionState(
    createInvoiceCreditNote,
    INITIAL_SALES_ACTION_STATE,
  );
  const [issueCreditState, issueCreditAction, issuingCredit] = useActionState(
    issueInvoiceCreditNote,
    INITIAL_SALES_ACTION_STATE,
  );
  const [refundState, refundAction, refunding] = useActionState(
    refundInvoiceCreditNote, INITIAL_SALES_ACTION_STATE,
  );

  const issueBlockReasons = [
    !client.address?.trim() ? 'Adresse du client manquante' : null,
    client.clientType === 'professionnel' && !client.ice?.trim()
      ? 'ICE du client professionnel manquant'
      : null,
  ].filter((reason): reason is string => Boolean(reason));
  const reversedMovementIds = new Set(
    payments
      .filter((payment) => payment.movementType === 'remboursement')
      .map((payment) => payment.originalMovementId),
  );
  const settlementBadge = INVOICE_SETTLEMENT_BADGES[settlement.state];
  const projectionBadge = ACCOUNTING_PROJECTION_BADGES[aggregate.accountingProjection];
  const isDraft = invoice.status === 'brouillon';
  const canSettle = invoice.status === 'emise' || invoice.status === 'envoyee';
  const operationDate = invoice.invoiceDate.slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-paper-2 p-5">
          <p className="text-xs uppercase tracking-widest text-faint">Règlement</p>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${settlementBadge.classes}`}>
            {settlementBadge.label}
          </span>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5">
          <p className="text-xs uppercase tracking-widest text-faint">Reçu net</p>
          <p className="mt-2 font-mono text-lg font-bold">{fmtCentsMad(settlement.netReceivedCents)}</p>
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5">
          <p className="text-xs uppercase tracking-widest text-faint">Reste à régler</p>
          <p className="mt-2 font-mono text-lg font-bold text-cyan">{fmtCentsMad(settlement.outstandingCents)}</p>
          {settlement.customerCreditCents > 0 && (
            <p className="mt-1 text-xs text-muted">Crédit client {fmtCentsMad(settlement.customerCreditCents)}</p>
          )}
        </div>
        <div className="rounded-xl border border-line bg-paper-2 p-5">
          <p className="text-xs uppercase tracking-widest text-faint">Comptabilité</p>
          <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${projectionBadge.classes}`}>
            {projectionBadge.label}
          </span>
        </div>
      </div>

      {isDraft ? (
        <section className="rounded-xl border border-line bg-paper-2 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold">Modifier le brouillon</h2>
              <p className="mt-1 text-sm text-muted">Référence attribuée à l’émission</p>
            </div>
            <form action={issueAction}>
              <input type="hidden" name="invoiceId" value={invoice.id} />
              <button
                disabled={issuing || issueBlockReasons.length > 0}
                className="rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40"
              >
                {issuing ? 'Émission…' : 'Émettre la facture'}
              </button>
            </form>
          </div>
          {issueBlockReasons.length > 0 && (
            <ul aria-live="polite" className="mt-4 rounded-lg border border-clay-soft bg-clay-soft/20 p-4 text-sm text-clay">
              {issueBlockReasons.map((reason) => <li key={reason}>• {reason}</li>)}
            </ul>
          )}
          <ActionMessage state={issueState} />
          <form action={updateAction} className="mt-5 grid gap-4 md:grid-cols-3">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="version" value={invoice.version} />
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Échéance</span>
              <input type="date" name="dueDate" defaultValue={invoice.dueDate?.slice(0, 10)} className="w-full rounded-md border border-line-2 bg-paper px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Conditions de paiement</span>
              <input name="paymentTerms" defaultValue={invoice.paymentTerms} className="w-full rounded-md border border-line-2 bg-paper px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted">Notes</span>
              <input name="notes" defaultValue={invoice.notes} className="w-full rounded-md border border-line-2 bg-paper px-3 py-2" />
            </label>
            <button disabled={updating} className="w-fit rounded-md border border-line-2 px-4 py-2 text-sm font-semibold">
              {updating ? 'Enregistrement…' : 'Enregistrer le brouillon'}
            </button>
          </form>
          <ActionMessage state={updateState} />
          <form action={deleteAction} className="mt-4">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button disabled={deleting} className="text-sm font-semibold text-clay hover:underline">
              {deleting ? 'Suppression…' : 'Supprimer le brouillon'}
            </button>
          </form>
          <ActionMessage state={deleteState} />
        </section>
      ) : (
        <p className="rounded-lg border border-line bg-paper-2 px-4 py-3 text-sm text-muted">
          Document émis et immuable. Toute correction passe par un avoir ou une contre-passation.
        </p>
      )}

      {canSettle && (
        <section className="rounded-xl border border-line bg-paper-2 p-6">
          <h2 className="font-bold">Enregistrer un encaissement</h2>
          <form action={paymentAction} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <input type="hidden" name="idempotencyKey" value={`${idempotencySeed}:payment`} />
            <label className="text-sm">Montant (MAD)<input required name="amountMad" inputMode="decimal" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <label className="text-sm">Mode<select name="method" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2"><option value="virement">Virement</option><option value="cheque">Chèque</option><option value="especes">Espèces</option><option value="carte">Carte</option></select></label>
            <label className="text-sm">Compte de trésorerie<input required name="treasuryAccount" pattern="[0-9]{4,6}" defaultValue="5141" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <label className="text-sm">Date de valeur<input required type="date" name="valueDate" defaultValue={operationDate} className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <label className="text-sm">Référence bancaire<input name="reference" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <button disabled={paying} className="self-end rounded-md bg-cyan-deep px-4 py-2 text-sm font-semibold text-paper">{paying ? 'Enregistrement…' : 'Enregistrer'}</button>
          </form>
          <ActionMessage state={paymentState} />
        </section>
      )}

      <section className="rounded-xl border border-line bg-paper-2 p-6">
        <h2 className="font-bold">Mouvements de règlement</h2>
        <div className="mt-4 space-y-3">
          {payments.map((payment) => (
            <div key={payment.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm">
              <span className="font-mono font-bold">{fmtCentsMad(payment.amountCents)}</span>
              <span className="text-muted">{payment.movementType === 'encaissement' ? 'Encaissement' : 'Remboursement'} · {fmtDate(payment.valueDate)}</span>
              {payment.movementType === 'encaissement' && !reversedMovementIds.has(payment.id) && canSettle &&
                !creditNotes.some((credit) => credit.status === 'emise' && credit.againstCollectedCents > 0) && (
                <form action={reversalAction} className="ml-auto flex items-center gap-2">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <input type="hidden" name="valueDate" value={operationDate} />
                  <input type="hidden" name="idempotencyKey" value={`${idempotencySeed}:reverse:${payment.id}`} />
                  <button disabled={reversing} className="font-semibold text-clay hover:underline">Contre-passer</button>
                </form>
              )}
            </div>
          ))}
          {payments.length === 0 && <p className="text-sm text-faint">Aucun mouvement.</p>}
        </div>
        <ActionMessage state={reversalState} />
      </section>

      {canSettle && (
        <section className="rounded-xl border border-line bg-paper-2 p-6">
          <h2 className="font-bold">Créer un avoir</h2>
          <form action={creditAction} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <label className="text-sm">Date<input required type="date" name="creditDate" defaultValue={operationDate} className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <label className="text-sm">Montant HT (MAD)<input required name="totalHtMad" inputMode="decimal" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <label className="text-sm">TVA (MAD)<input required name="tvaMad" inputMode="decimal" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <label className="text-sm">Motif<input required name="reason" className="mt-1 w-full rounded-md border border-line-2 bg-paper px-3 py-2" /></label>
            <button disabled={crediting} className="w-fit rounded-md border border-line-2 px-4 py-2 text-sm font-semibold">{crediting ? 'Création…' : 'Créer l’avoir'}</button>
          </form>
          <ActionMessage state={creditState} />
        </section>
      )}

      <section className="rounded-xl border border-line bg-paper-2 p-6">
        <h2 className="font-bold">Avoirs</h2>
        <div className="mt-4 space-y-3">
          {creditNotes.map((credit) => (
            <div key={credit.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm">
              <span className="font-mono font-bold">{credit.reference ?? 'Brouillon d’avoir'}</span>
              <span>{fmtCentsMad(credit.totalTtcCents)}</span>
              <span className="text-muted">{credit.reason}</span>
              {credit.status === 'brouillon' && (
                <form action={issueCreditAction} className="ml-auto">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <input type="hidden" name="creditNoteId" value={credit.id} />
                  <button disabled={issuingCredit} className="font-semibold text-cyan hover:underline">Émettre l’avoir</button>
                </form>
              )}
              {credit.status === 'emise' && settlement.customerCreditCents > 0 &&
                credit.againstCollectedCents > payments.filter((payment) => payment.creditNoteId === credit.id)
                  .reduce((sum, payment) => sum + payment.amountCents, 0) && (
                <form action={refundAction} className="mt-3 flex w-full flex-wrap items-end gap-3">
                  <input type="hidden" name="invoiceId" value={invoice.id} />
                  <input type="hidden" name="creditNoteId" value={credit.id} />
                  <input type="hidden" name="idempotencyKey" value={`${idempotencySeed}:refund:${credit.id}`} />
                  <label>Montant à rembourser (MAD)<input name="amountMad" required inputMode="decimal" className="mt-1 block rounded border border-line-2 bg-paper px-2 py-1" /></label>
                  <label>Mode de remboursement<select name="method" className="mt-1 block rounded border border-line-2 bg-paper px-2 py-1"><option value="virement">Virement</option><option value="cheque">Chèque</option><option value="especes">Espèces</option></select></label>
                  <label>Compte de remboursement<input name="treasuryAccount" required pattern="[0-9]{4,6}" defaultValue="5141" className="mt-1 block rounded border border-line-2 bg-paper px-2 py-1" /></label>
                  <label>Date du remboursement<input name="valueDate" required type="date" defaultValue={operationDate} className="mt-1 block rounded border border-line-2 bg-paper px-2 py-1" /></label>
                  <button disabled={refunding} className="rounded border border-line-2 px-3 py-2 font-semibold text-cyan">Rembourser cet avoir</button>
                </form>
              )}
            </div>
          ))}
          {creditNotes.length === 0 && <p className="text-sm text-faint">Aucun avoir.</p>}
        </div>
        <ActionMessage state={issueCreditState} />
        <ActionMessage state={refundState} />
      </section>
    </div>
  );
}
