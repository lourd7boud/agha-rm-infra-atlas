// Statut légal & documents — fiche d'identité légale de la société,
// obligations annuelles (liasse, AG, dépôt greffe…) et coffre des documents
// officiels (attestations avec alerte d'expiration, statuts, PV, liasses).
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  TYPE_DOCUMENT_LABELS,
  URGENCE_BADGES,
  fmtDate,
  fmtFileSize,
  type ComptaProfil,
  type LegalDocument,
  type Obligation,
  type Urgence,
} from '@/lib/compta';
import {
  deleteDocument,
  genererEcheancier,
  patchDocument,
  patchObligation,
  uploadLegalDocument,
} from '../actions';
import {
  AnneePicker,
  ComptaHeader,
  SectionCard,
  StatusBanners,
  StatutBadge,
  inputClass,
} from '../ui';

export const metadata = { title: 'Statut légal — Comptabilité ATLAS' };

function urgenceExpiration(date: string | null): Urgence | null {
  if (!date) return null;
  const jours = Math.floor((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (jours < 0) return 'en_retard';
  if (jours <= 7) return 'urgent';
  if (jours <= 45) return 'proche';
  return 'a_venir';
}

export default async function LegalPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; code?: string; annee?: string }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const [profil, obligations, documents] = await Promise.all([
    apiGet<ComptaProfil>('/compta/profil'),
    apiGet<Obligation[]>(`/compta/obligations?annee=${annee}`),
    apiGet<LegalDocument[]>('/compta/documents'),
  ]);

  const fiche: Array<[string, string | null]> = [
    ['Raison sociale', `${profil.raisonSociale} (${profil.formeJuridique})`],
    ['Registre de commerce', profil.registreCommerce],
    ['Identifiant fiscal (IF)', profil.identifiantFiscal],
    ['ICE', profil.ice],
    ['Taxe professionnelle', profil.taxeProfessionnelle],
    ['Affiliation CNSS', profil.cnssAffiliation],
    ['Gérant', profil.gerant],
    ['Siège', [profil.adresse, profil.ville].filter(Boolean).join(', ') || null],
  ];

  return (
    <div>
      <ComptaHeader
        title="Statut légal & documents"
        subtitle="Identité légale de la société, obligations annuelles (loi 9-88, loi 5-96, CGI) et coffre des documents officiels avec alertes d'expiration."
        actions={<AnneePicker annee={annee} path="/compta/legal" />}
      />
      <StatusBanners searchParams={params} />

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Fiche légale */}
        <SectionCard
          title="Fiche légale"
          actions={
            <Link
              href="/compta/parametres"
              className="text-xs font-semibold text-cyan hover:underline"
            >
              Modifier →
            </Link>
          }
        >
          <dl className="divide-y divide-line text-sm">
            {fiche.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 px-5 py-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {label}
                </dt>
                <dd className={`text-right font-mono text-xs ${value ? 'text-ink' : 'text-clay'}`}>
                  {value ?? 'À compléter'}
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>

        {/* Obligations annuelles */}
        <SectionCard
          title={`Obligations ${annee}`}
          subtitle="Inventaire, liasse, AG, dépôt au greffe, attestation fiscale."
          actions={
            <form action={genererEcheancier}>
              <input type="hidden" name="annee" value={annee} />
              <input type="hidden" name="backTo" value={`/compta/legal?annee=${annee}`} />
              <button className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-muted hover:bg-sand">
                ⚡ Générer
              </button>
            </form>
          }
        >
          {obligations.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              Aucune obligation générée pour {annee}.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {obligations.map((obligation) => {
                const u =
                  obligation.statut === 'a_faire'
                    ? (urgenceExpiration(obligation.dateEcheance) ?? 'a_venir')
                    : 'fait';
                const badge = URGENCE_BADGES[u];
                return (
                  <li key={obligation.id} className="flex items-center gap-2.5 px-5 py-2.5">
                    <span
                      className={`inline-flex w-18 shrink-0 justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium" title={obligation.label}>
                        {obligation.label}
                      </p>
                      <p className="font-mono text-[10px] text-faint">
                        {fmtDate(obligation.dateEcheance)}
                      </p>
                    </div>
                    {obligation.statut === 'a_faire' ? (
                      <form action={patchObligation} className="flex gap-1">
                        <input type="hidden" name="id" value={obligation.id} />
                        <input type="hidden" name="statut" value="fait" />
                        <input type="hidden" name="backTo" value={`/compta/legal?annee=${annee}`} />
                        <button className="rounded bg-emerald-soft/50 px-2 py-0.5 text-[10px] font-bold text-emerald">
                          ✓ Fait
                        </button>
                      </form>
                    ) : (
                      <StatutBadge statut={obligation.statut} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {/* Upload */}
        <SectionCard
          title="Déposer un document"
          subtitle="PDF, images ou Office — attestations, statuts, PV, liasses."
        >
          <form action={uploadLegalDocument} className="space-y-2.5 px-5 py-4">
            <input type="hidden" name="backTo" value="/compta/legal" />
            <input
              type="file"
              name="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              className="w-full text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-soft file:px-3 file:py-2 file:text-xs file:font-bold file:text-cyan"
            />
            <select
              name="type"
              className={`${inputClass} w-full`}
              defaultValue="attestation_fiscale"
            >
              {Object.entries(TYPE_DOCUMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              name="titre"
              placeholder="Titre (sinon nom du fichier)"
              className={`${inputClass} w-full`}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted">
                Émission
                <input type="date" name="dateEmission" className={`${inputClass} font-mono`} />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-muted">
                Expiration (alerte)
                <input type="date" name="dateExpiration" className={`${inputClass} font-mono`} />
              </label>
            </div>
            <button className="w-full rounded-lg bg-cyan px-4 py-2 text-sm font-bold text-paper">
              Téléverser
            </button>
          </form>
        </SectionCard>
      </div>

      {/* Coffre documents */}
      <div className="mt-6">
        <SectionCard
          title={`Coffre des documents (${documents.length})`}
          subtitle="Conservation 10 ans — les attestations proches de l'expiration remontent sur le tableau de bord."
        >
          {documents.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Aucun document déposé.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2 text-left">Document</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Émission</th>
                  <th className="px-3 py-2 text-left">Expiration</th>
                  <th className="px-3 py-2 text-right">Taille</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {documents.map((doc) => {
                  const u = urgenceExpiration(doc.dateExpiration);
                  return (
                    <tr key={doc.id} className="transition hover:bg-sand/40">
                      <td className="max-w-72 px-4 py-2">
                        {doc.storageKey ? (
                          <a
                            href={`/api/compta-doc/${doc.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block truncate text-sm font-semibold text-cyan hover:underline"
                            title={doc.titre}
                          >
                            {doc.titre}
                          </a>
                        ) : (
                          <span className="block truncate text-sm">{doc.titre}</span>
                        )}
                        {doc.annee && (
                          <span className="font-mono text-[10px] text-faint">{doc.annee}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {TYPE_DOCUMENT_LABELS[doc.type] ?? doc.type}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {fmtDate(doc.dateEmission)}
                      </td>
                      <td className="px-3 py-2">
                        {doc.dateExpiration ? (
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-xs tabular-nums">
                              {fmtDate(doc.dateExpiration)}
                            </span>
                            {u && u !== 'a_venir' && (
                              <span
                                className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${URGENCE_BADGES[u].className}`}
                              >
                                {u === 'en_retard' ? 'Expiré' : 'Bientôt'}
                              </span>
                            )}
                          </span>
                        ) : (
                          <form action={patchDocument} className="flex gap-1">
                            <input type="hidden" name="id" value={doc.id} />
                            <input type="hidden" name="backTo" value="/compta/legal" />
                            <input
                              type="date"
                              name="dateExpiration"
                              className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[10px]"
                            />
                            <button className="rounded bg-sand px-1.5 text-[10px] font-bold text-muted">
                              ✓
                            </button>
                          </form>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {fmtFileSize(doc.fileSize)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <form action={deleteDocument}>
                          <input type="hidden" name="id" value={doc.id} />
                          <input type="hidden" name="backTo" value="/compta/legal" />
                          <button className="text-xs font-semibold text-faint hover:text-clay">
                            Supprimer
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
