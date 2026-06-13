import type { DocumentKind, ValidityStatus } from '@atlas/contracts';
import { apiGet } from '@/lib/api';
import { DOCUMENT_LABELS, STATUS_BADGES } from '@/lib/labels';

interface VaultDocument {
  id: string;
  kind: DocumentKind;
  label: string;
  reference?: string;
  expiresAt?: string;
  status: ValidityStatus;
  dueAlerts: number[];
}

interface Readiness {
  score: number;
  ready: boolean;
  missing: DocumentKind[];
  expired: DocumentKind[];
  expiring: DocumentKind[];
}

export default async function VaultPage() {
  const [readiness, documents] = await Promise.all([
    apiGet<Readiness>('/vault/readiness'),
    apiGet<VaultDocument[]>('/vault/documents'),
  ]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">
          Coffre-fort documentaire
        </h1>
        <p className="mt-1 text-sm text-muted">
          Capacité à soumissionner aujourd&apos;hui, sans demander aucun document
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside
          className={`rounded-xl border p-6 shadow-sm ${
            readiness.ready
              ? 'border-emerald-200 bg-emerald-50'
              : 'border-clay-soft bg-clay-soft/30'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">
            Score de préparation
          </p>
          <p className="mt-2 font-mono text-6xl font-black tabular-nums">
            {readiness.score}
            <span className="text-2xl text-faint">/100</span>
          </p>
          <p
            className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-semibold ${
              readiness.ready
                ? 'bg-emerald-600 text-paper'
                : 'bg-rose-600 text-paper'
            }`}
          >
            {readiness.ready ? 'Prêt à soumissionner' : 'Dossier incomplet'}
          </p>

          {readiness.missing.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-clay">
                Manquants
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {readiness.missing.map((kind) => (
                  <li key={kind}>• {DOCUMENT_LABELS[kind]}</li>
                ))}
              </ul>
            </div>
          )}
          {readiness.expired.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-clay">
                Expirés
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {readiness.expired.map((kind) => (
                  <li key={kind}>• {DOCUMENT_LABELS[kind]}</li>
                ))}
              </ul>
            </div>
          )}
          {readiness.expiring.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-cyan">
                À renouveler bientôt
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {readiness.expiring.map((kind) => (
                  <li key={kind}>• {DOCUMENT_LABELS[kind]}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Document</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Expire le</th>
                <th className="px-4 py-3">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {documents.map((doc) => {
                const badge = STATUS_BADGES[doc.status];
                return (
                  <tr key={doc.id}>
                    <td className="px-4 py-3 font-medium">
                      {doc.label}
                      {doc.reference && (
                        <span className="ml-2 text-xs text-faint">
                          {doc.reference}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {DOCUMENT_LABELS[doc.kind]}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted">
                      {doc.expiresAt
                        ? new Date(doc.expiresAt).toLocaleDateString('fr-MA')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {documents.length === 0 && (
            <p className="p-10 text-center text-faint">
              Aucun document dans le coffre-fort.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
