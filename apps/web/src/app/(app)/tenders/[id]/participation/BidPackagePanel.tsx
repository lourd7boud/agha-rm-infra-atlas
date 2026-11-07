import Link from 'next/link';
import type { BidPackageEnvelope, BidWorkspaceState } from '@atlas/contracts';
import { packageChecklist } from '@/lib/bid-package';

export interface BidPackageRequirementView {
  id: string;
  code: string;
  label: string;
  envelope: BidPackageEnvelope;
  required: boolean;
  requiresSignature?: boolean;
  source: string;
}

export interface BidPackageFileView {
  id: string;
  requirementId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
}

export interface BidPackageSnapshotView {
  workspace: {
    id: string;
    state: BidWorkspaceState;
    version: number;
    currentPackageVersion: number | null;
  };
  requirements: BidPackageRequirementView[];
  packageVersion: null | {
    id: string;
    version: number;
    status: 'draft' | 'frozen' | 'superseded';
    manifestSha256: string | null;
    frozenAt: string | null;
  };
  files: BidPackageFileView[];
}

export interface VaultDocumentOption {
  id: string;
  label: string;
  kind: string;
  filename?: string;
  objectKey?: string;
  sha256?: string;
  sizeBytes?: number;
  status?: string;
}

const envelopeLabels: Record<BidPackageEnvelope, string> = {
  administrative: 'Administratif',
  technical: 'Technique',
  financial: 'Financier',
  supplementary: 'Complémentaire',
};

function formatBytes(size: number) {
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / 1024 / 1024).toFixed(1)} Mo`;
}

export function BidPackagePanel({
  snapshot,
  vaultDocuments,
  seedRequirementsAction,
  addRequirementAction,
  updateRequirementAction,
  attachFileAction,
  freezeAction,
}: {
  snapshot: BidPackageSnapshotView;
  vaultDocuments: VaultDocumentOption[];
  seedRequirementsAction: (formData: FormData) => Promise<void>;
  addRequirementAction: (formData: FormData) => Promise<void>;
  updateRequirementAction: (formData: FormData) => Promise<void>;
  attachFileAction: (formData: FormData) => Promise<void>;
  freezeAction: (formData: FormData) => Promise<void>;
}) {
  const checklist = packageChecklist(snapshot.requirements, snapshot.files);
  const filesByRequirement = new Map(
    snapshot.files.map((file) => [file.requirementId, file]),
  );
  const usableVaultDocuments = vaultDocuments.filter(
    (document) => document.objectKey && document.sha256,
  );
  const editable =
    snapshot.workspace.state === 'assembling' ||
    snapshot.workspace.state === 'review';

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan">
            Dossier de soumission versionné
          </p>
          <h2 className="mt-2 text-xl font-semibold text-ink">
            {snapshot.packageVersion
              ? `Version ${snapshot.packageVersion.version} · ${snapshot.packageVersion.status === 'frozen' ? 'figée' : 'brouillon'}`
              : 'Aucune version créée'}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Chaque document joint est copié et identifié par son empreinte SHA-256.
          </p>
        </div>
        <div className="min-w-48 rounded-xl border border-line bg-sand/50 px-4 py-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted">Pièces obligatoires</span>
            <strong>{checklist.satisfied}/{checklist.required}</strong>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-emerald-600"
              style={{
                width: `${checklist.required ? (checklist.satisfied / checklist.required) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="p-6">
        {snapshot.requirements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-cyan/40 bg-cyan/5 p-5">
            <h3 className="font-semibold text-ink">Construire la checklist documentaire</h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Le socle proposé couvre les pièces usuelles. Il doit être comparé au RC et au
              CPS de cette consultation avant gel.
            </p>
            {editable && (
              <form action={seedRequirementsAction} className="mt-4">
                <input type="hidden" name="expectedVersion" value={snapshot.workspace.version} />
                <button className="rounded-xl bg-cyan px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-deep">
                  Initialiser le socle contrôlé
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {snapshot.requirements.map((requirement) => {
              const file = filesByRequirement.get(requirement.id);
              return (
                <article
                  className="grid gap-4 rounded-xl border border-line p-4 lg:grid-cols-[1fr_1.25fr] lg:items-center"
                  key={requirement.id}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase text-slate-600">
                        {envelopeLabels[requirement.envelope]}
                      </span>
                      {requirement.required ? (
                        <span className="text-xs font-semibold text-rose-700">Obligatoire</span>
                      ) : (
                        <span className="text-xs text-muted">Optionnel</span>
                      )}
                      {requirement.requiresSignature && (
                        <span className="rounded-md bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-800">
                          Signature électronique requise
                        </span>
                      )}
                    </div>
                    <h3 className="mt-2 font-semibold text-ink">{requirement.label}</h3>
                    <p className="mt-1 font-mono text-[11px] text-muted">{requirement.code}</p>
                    {editable && (
                      <form action={updateRequirementAction} className="mt-3 flex items-center gap-2">
                        <input type="hidden" name="expectedVersion" value={snapshot.workspace.version} />
                        <input type="hidden" name="code" value={requirement.code} />
                        <input type="hidden" name="label" value={requirement.label} />
                        <input type="hidden" name="envelope" value={requirement.envelope} />
                        <input type="hidden" name="required" value={requirement.required ? 'true' : 'false'} />
                        <label className="flex items-center gap-2 text-xs text-muted">
                          <input
                            type="checkbox"
                            name="requiresSignature"
                            defaultChecked={requirement.requiresSignature}
                          />
                          Le RC exige sa signature
                        </label>
                        <button className="rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-slate-50">
                          Enregistrer
                        </button>
                      </form>
                    )}
                  </div>
                  {file ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-emerald-950">
                          ✓ {file.filename}
                        </span>
                        <span className="text-xs text-emerald-800">{formatBytes(file.sizeBytes)}</span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-emerald-800">
                        SHA-256 {file.sha256}
                      </p>
                    </div>
                  ) : editable ? (
                    usableVaultDocuments.length > 0 ? (
                      <form action={attachFileAction} className="flex gap-2">
                        <input type="hidden" name="requirementId" value={requirement.id} />
                        <input type="hidden" name="expectedVersion" value={snapshot.workspace.version} />
                        <select
                          name="vaultDocumentId"
                          required
                          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Choisir dans le coffre…</option>
                          {usableVaultDocuments.map((document) => (
                            <option value={document.id} key={document.id}>
                              {document.label} {document.filename ? `· ${document.filename}` : ''}
                            </option>
                          ))}
                        </select>
                        <button className="rounded-lg border border-cyan px-3 py-2 text-sm font-semibold text-cyan hover:bg-cyan/5">
                          Joindre
                        </button>
                      </form>
                    ) : (
                      <Link href="/compta/legal" className="text-sm font-semibold text-cyan hover:underline">
                        Ajouter d’abord le fichier au coffre documentaire →
                      </Link>
                    )
                  ) : (
                    <span className="text-sm text-rose-700">Pièce absente</span>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {editable && snapshot.requirements.length > 0 && (
          <details className="mt-5 rounded-xl border border-line bg-sand/30 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              Ajouter une exigence du RC/CPS
            </summary>
            <form action={addRequirementAction} className="mt-4 grid gap-3 lg:grid-cols-[1fr_2fr_1fr_auto_auto_auto]">
              <input type="hidden" name="expectedVersion" value={snapshot.workspace.version} />
              <input name="code" required placeholder="code_unique" className="rounded-lg border border-line px-3 py-2 text-sm" />
              <input name="label" required placeholder="Intitulé exact de la pièce" className="rounded-lg border border-line px-3 py-2 text-sm" />
              <select name="envelope" className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
                {Object.entries(envelopeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="required" defaultChecked /> Obligatoire</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requiresSignature" /> À signer</label>
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Ajouter</button>
            </form>
          </details>
        )}

        {snapshot.packageVersion?.status === 'frozen' ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-950">Dossier figé et prêt pour le protocole de signature</p>
            <p className="mt-1 break-all font-mono text-[11px] text-emerald-800">
              Manifest SHA-256: {snapshot.packageVersion.manifestSha256}
            </p>
          </div>
        ) : snapshot.workspace.state === 'review' ? (
          <form action={freezeAction} className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-line bg-slate-950 p-4 text-white">
            <input type="hidden" name="expectedVersion" value={snapshot.workspace.version} />
            <div>
              <p className="font-semibold">Contrôle final du contenu</p>
              <p className="mt-1 text-xs text-slate-300">
                {checklist.complete
                  ? 'Toutes les pièces obligatoires sont présentes. Le gel recalculera chaque empreinte.'
                  : `Pièces manquantes: ${checklist.missingCodes.join(', ') || 'checklist vide'}`}
              </p>
            </div>
            <button
              disabled={!checklist.complete}
              className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Vérifier et figer
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
