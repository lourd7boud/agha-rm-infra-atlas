// Écritures & journaux — liste filtrée + saisie en partie double + détail.
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import {
  fmtDate,
  fmtMad,
  type Compte,
  type Ecriture,
  type Journal,
} from '@/lib/compta';
import {
  createEcriture,
  deleteEcriture,
  genererEcrituresVentes,
  validerEcriture,
} from '../actions';
import { AnneePicker, ComptaHeader, SectionCard, StatusBanners, StatutBadge, btnGhost } from '../ui';
import { EcritureEditor } from './EcritureEditor';

export const metadata = { title: 'Écritures — Comptabilité ATLAS' };

export default async function EcrituresPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    code?: string;
    annee?: string;
    journal?: string;
    q?: string;
    page?: string;
    ecriture?: string;
  }>;
}) {
  const params = await searchParams;
  const annee = Number(params.annee) || new Date().getFullYear();
  const page = Math.max(1, Number(params.page) || 1);
  const query = new URLSearchParams({ annee: String(annee), page: String(page), limit: '25' });
  if (params.journal) query.set('journal', params.journal);
  if (params.q) query.set('q', params.q);

  const [liste, journaux, comptes, detail] = await Promise.all([
    apiGet<{ items: Ecriture[]; total: number }>(`/compta/ecritures?${query}`),
    apiGet<Journal[]>('/compta/journaux'),
    apiGet<Compte[]>('/compta/plan?actifs=1'),
    params.ecriture ? apiGet<Ecriture>(`/compta/ecritures/${params.ecriture}`) : null,
  ]);

  return (
    <div>
      <ComptaHeader
        title="Écritures & journaux"
        subtitle="Saisie en partie double (loi 9-88) — chaque écriture équilibrée, numérotée par journal. Les factures de vente peuvent être comptabilisées automatiquement."
        actions={<AnneePicker annee={annee} path="/compta/ecritures" />}
      />
      <StatusBanners searchParams={params} />

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <SectionCard
            title={`Journal — ${liste.total} écriture${liste.total > 1 ? 's' : ''}`}
            actions={
              <form action={genererEcrituresVentes}>
                <input type="hidden" name="annee" value={annee} />
                <input type="hidden" name="backTo" value={`/compta/ecritures?annee=${annee}`} />
                <button className={btnGhost} title="Comptabilise les factures du module Ventes">
                  ⚡ Générer depuis les ventes
                </button>
              </form>
            }
          >
            <form className="flex flex-wrap gap-2 border-b border-line bg-paper px-4 py-2.5">
              <input type="hidden" name="annee" value={annee} />
              <select
                name="journal"
                defaultValue={params.journal ?? ''}
                className="rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-xs outline-none"
              >
                <option value="">Tous journaux</option>
                {journaux.map((j) => (
                  <option key={j.code} value={j.code}>
                    {j.code}
                  </option>
                ))}
              </select>
              <input
                name="q"
                defaultValue={params.q ?? ''}
                placeholder="Libellé, pièce…"
                className="min-w-40 flex-1 rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-xs outline-none"
              />
              <button className="rounded-lg bg-sand px-3 py-1.5 text-xs font-semibold text-ink-2">
                Filtrer
              </button>
            </form>
            {liste.items.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                Aucune écriture sur {annee}.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">N°</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Libellé</th>
                    <th className="px-3 py-2 text-right">Montant</th>
                    <th className="px-3 py-2 text-left">Statut</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {liste.items.map((e) => (
                    <tr key={e.id} className="transition hover:bg-sand/40">
                      <td className="px-4 py-2 font-mono text-xs font-semibold text-cyan">
                        {e.journalCode}-{e.numero}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums">
                        {fmtDate(e.dateEcriture)}
                      </td>
                      <td className="max-w-60 truncate px-3 py-2" title={e.libelle}>
                        <Link
                          href={`/compta/ecritures?annee=${annee}&ecriture=${e.id}`}
                          className="hover:text-cyan"
                        >
                          {e.libelle}
                        </Link>
                        {e.pieceRef && (
                          <span className="ml-1.5 font-mono text-[10px] text-faint">
                            {e.pieceRef}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {fmtMad(e.totalDebit)}
                      </td>
                      <td className="px-3 py-2">
                        <StatutBadge statut={e.statut} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {e.statut === 'brouillon' && (
                          <div className="flex justify-end gap-1.5">
                            <form action={validerEcriture}>
                              <input type="hidden" name="id" value={e.id} />
                              <input
                                type="hidden"
                                name="backTo"
                                value={`/compta/ecritures?annee=${annee}`}
                              />
                              <button className="rounded bg-emerald-soft/50 px-2 py-0.5 text-[11px] font-bold text-emerald">
                                Valider
                              </button>
                            </form>
                            <form action={deleteEcriture}>
                              <input type="hidden" name="id" value={e.id} />
                              <input
                                type="hidden"
                                name="backTo"
                                value={`/compta/ecritures?annee=${annee}`}
                              />
                              <button className="rounded px-1.5 py-0.5 text-[11px] font-bold text-faint hover:text-clay">
                                ✕
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {liste.total > 25 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-muted">
                <span className="tabular-nums">
                  page {page}/{Math.ceil(liste.total / 25)}
                </span>
                <div className="flex gap-2">
                  {page > 1 && (
                    <Link
                      href={`/compta/ecritures?annee=${annee}&page=${page - 1}`}
                      className={btnGhost}
                    >
                      ← Précédent
                    </Link>
                  )}
                  {page * 25 < liste.total && (
                    <Link
                      href={`/compta/ecritures?annee=${annee}&page=${page + 1}`}
                      className={btnGhost}
                    >
                      Suivant →
                    </Link>
                  )}
                </div>
              </div>
            )}
          </SectionCard>

          {/* Détail d'une écriture */}
          {detail && (
            <SectionCard
              title={`Écriture ${detail.journalCode}-${detail.numero} — ${detail.libelle}`}
              subtitle={`${fmtDate(detail.dateEcriture)} · ${detail.source}`}
            >
              <table className="w-full text-sm">
                <thead className="bg-sand/60 text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-2 text-left">Compte</th>
                    <th className="px-3 py-2 text-left">Intitulé</th>
                    <th className="px-3 py-2 text-right">Débit</th>
                    <th className="px-3 py-2 text-right">Crédit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(detail.lignes ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2 font-mono text-xs font-semibold">{l.compteCode}</td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {l.compteIntitule ?? l.libelle ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {l.debit > 0 ? fmtMad(l.debit) : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {l.credit > 0 ? fmtMad(l.credit) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          )}
        </div>

        {/* Saisie */}
        <div className="xl:col-span-2">
          <SectionCard
            title="Nouvelle écriture"
            subtitle="Débits = crédits, comptes de détail (≥ 4 chiffres)."
          >
            <div className="px-5 py-4">
              <EcritureEditor journaux={journaux} comptes={comptes} action={createEcriture} />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
