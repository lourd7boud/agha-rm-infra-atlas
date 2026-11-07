// À valider — cockpit du superviseur. Le comptable ne saisit plus : le système
// génère les écritures automatiquement (ventes, encaissements, dépenses) ; ici il
// RELIT puis valide (à l'unité ou en masse), et voit d'un coup d'œil les factures
// confirmées/payées dont l'écriture manque (réconciliation — le filet de sécurité).
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  fmtMad,
  type Ecriture,
  type FactureSansEcriture,
  type ReconciliationVentes,
} from '@/lib/compta';
import {
  genererEcrituresDepenses,
  genererEcrituresVentes,
  validerEcriture,
  validerTousBrouillons,
} from '../actions';
import {
  AnneePicker,
  ComptaHeader,
  KpiCard,
  SectionCard,
  StatusBanners,
  btnGhost,
  btnPrimary,
} from '../ui';

export const metadata = { title: 'À valider — Comptabilité ATLAS' };

const SOURCE_LABEL: Record<string, string> = {
  vente: 'Vente',
  reglement: 'Encaissement',
  depense: 'Dépense',
  manuel: 'Manuel',
  systeme: 'Système',
};

const SOURCE_CLASS: Record<string, string> = {
  vente: 'bg-cyan-soft/60 text-cyan-deep',
  reglement: 'bg-emerald-soft/60 text-emerald',
  depense: 'bg-clay-soft/50 text-clay',
};

export default async function AValiderPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; code?: string; annee?: string }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const backTo = `/compta/a-valider?annee=${annee}`;

  const [brouillons, reconciliation] = await Promise.all([
    apiGet<{ items: Ecriture[]; total: number }>(
      `/compta/ecritures?annee=${annee}&statut=brouillon&limit=100`,
    ),
    apiGet<ReconciliationVentes>(`/compta/reconciliation?annee=${annee}`),
  ]);

  const nbBrouillons = brouillons.total;
  const nbVentes = reconciliation.ventesManquantes.length;
  const nbEncaissements = reconciliation.encaissementsManquants.length;
  const toutReconcilie = nbVentes === 0 && nbEncaissements === 0;

  return (
    <div>
      <ComptaHeader
        title="À valider"
        subtitle="Le système comptabilise tout automatiquement — vous relisez puis validez. Rien ne se perd : les factures sans écriture apparaissent en réconciliation."
        actions={<AnneePicker annee={annee} path="/compta/a-valider" />}
      />
      <StatusBanners searchParams={params} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Écritures à valider"
          value={nbBrouillons}
          hint={nbBrouillons === 0 ? 'Tout est validé' : 'Brouillons en attente'}
          accent={nbBrouillons === 0 ? 'border-l-emerald' : 'border-l-cyan'}
        />
        <KpiCard
          label="Ventes non comptabilisées"
          value={nbVentes}
          hint="Factures confirmées sans écriture"
          accent={nbVentes === 0 ? 'border-l-emerald' : 'border-l-clay'}
        />
        <KpiCard
          label="Encaissements manquants"
          value={nbEncaissements}
          hint="Factures payées sans écriture de règlement"
          accent={nbEncaissements === 0 ? 'border-l-emerald' : 'border-l-clay'}
        />
      </div>

      <div className="space-y-6">
        <SectionCard
          title={`Écritures à valider — ${nbBrouillons}`}
          subtitle="Générées automatiquement. Validez à l'unité, ou tout d'un coup après relecture."
          actions={
            nbBrouillons > 0 ? (
              <form action={validerTousBrouillons}>
                <input type="hidden" name="annee" value={annee} />
                <input type="hidden" name="backTo" value={backTo} />
                <button className={btnPrimary}>✓ Tout valider ({nbBrouillons})</button>
              </form>
            ) : null
          }
        >
          {brouillons.items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              Rien à valider — toutes les écritures de {annee} sont validées. ✓
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-3">Journal / N°</th>
                  <th className="px-4 py-3">Libellé</th>
                  <th className="px-4 py-3">Origine</th>
                  <th className="px-4 py-3 text-right">Montant</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {brouillons.items.map((e) => (
                  <tr key={e.id} className="border-b border-line/60 hover:bg-sand/40">
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {e.journalCode}-{e.numero}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/compta/ecritures?annee=${annee}&ecriture=${e.id}`}
                        className="font-medium text-ink hover:text-cyan"
                      >
                        {e.libelle}
                      </Link>
                      {e.pieceRef && (
                        <span className="ml-2 font-mono text-[11px] text-faint">{e.pieceRef}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          SOURCE_CLASS[e.source] ?? 'bg-sand text-muted'
                        }`}
                      >
                        {SOURCE_LABEL[e.source] ?? e.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {fmtMad(e.totalDebit)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={validerEcriture} className="inline">
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="backTo" value={backTo} />
                        <button className={btnGhost}>Valider</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard
          title="Réconciliation — factures sans écriture"
          subtitle="Le filet de sécurité : rien n'est oublié (exercice clôturé, import, incident). Cliquez pour rattraper — les écritures manquantes sont générées."
          actions={
            <div className="flex flex-wrap gap-2">
              <form action={genererEcrituresVentes}>
                <input type="hidden" name="annee" value={annee} />
                <input type="hidden" name="backTo" value={backTo} />
                <button className={btnPrimary}>⚡ Rattraper ventes + encaissements</button>
              </form>
              <form action={genererEcrituresDepenses}>
                <input type="hidden" name="annee" value={annee} />
                <input type="hidden" name="backTo" value={backTo} />
                <button className={btnGhost}>Comptabiliser les dépenses chantier</button>
              </form>
            </div>
          }
        >
          {toutReconcilie ? (
            <p className="px-5 py-8 text-center text-sm text-muted">
              Aucune facture en attente de comptabilisation pour {annee}. Tout est réconcilié. ✓
            </p>
          ) : (
            <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-line">
              <ReconcColumn
                title="Ventes non comptabilisées"
                hint="Facture confirmée, écriture de vente absente"
                factures={reconciliation.ventesManquantes}
              />
              <ReconcColumn
                title="Encaissements manquants"
                hint="Facture payée, écriture de règlement (+ TVA) absente"
                factures={reconciliation.encaissementsManquants}
              />
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function ReconcColumn({
  title,
  hint,
  factures,
}: {
  title: string;
  hint: string;
  factures: FactureSansEcriture[];
}) {
  return (
    <div className="p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{title}</p>
      <p className="mb-3 text-[11px] text-muted">{hint}</p>
      {factures.length === 0 ? (
        <p className="py-4 text-center text-sm text-emerald">À jour ✓</p>
      ) : (
        <ul className="space-y-1.5">
          {factures.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2"
            >
              <Link
                href={`/sales/invoices/${f.id}`}
                className="min-w-0 flex-1 truncate"
                title={f.clientName}
              >
                <span className="font-mono text-xs text-cyan-deep">{f.reference}</span>
                <span className="ml-2 truncate text-xs text-muted">{f.clientName}</span>
              </Link>
              <span className="shrink-0 font-mono text-xs tabular-nums text-ink">
                {fmtMad(f.totalTtcMad)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
