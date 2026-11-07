'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  TerrainJourneePayload,
  TerrainJourneeRecord,
} from '@atlas/contracts';
import type { TerrainCrewMember } from '@/lib/btp-shared';
import { ReviewedSettlement } from './ReviewedSettlement';
import {
  dailyRecords,
  writeDaily,
  type DailyResult,
  type DailySettlement,
} from './daily-actions';
import {
  dailyDraftKey,
  emptyDaily,
  readDailyDraft,
  recoveryIsStale,
  type LocalDailyDraft,
} from './daily-draft';

const input =
  'mt-1 min-h-11 w-full rounded-lg border border-line bg-paper px-3 py-2 text-base text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan';
const button =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-line px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-50';
const statusLabels = {
  draft: 'Brouillon',
  submitted: 'À vérifier au bureau',
  returned: 'À corriger',
  reviewed: 'Vérifiée · verrouillée',
};
const groups = {
  attendance: 'Équipe',
  production: 'Travaux réalisés',
  equipment: 'Matériel et engins',
  materials: 'Matériaux',
  expenses: 'Dépenses complémentaires',
  blockers: 'Blocages',
} as const;
type Group = keyof typeof groups;
type Option = { value: string; label: string };
type Field<T> = {
  key: keyof T;
  label: string;
  type?: 'number' | 'date';
  nullable?: boolean;
  options?: Option[];
};

function Lines<T extends { id: string }>({
  title,
  help,
  rows,
  fields,
  create,
  onChange,
  disabled,
}: {
  title: string;
  help: string;
  rows: T[];
  fields: Field<T>[];
  create: () => T;
  onChange: (rows: T[]) => void;
  disabled: boolean;
}) {
  return (
    <details open={rows.length > 0} className="rounded-xl border border-line bg-paper-2 p-4 sm:p-5">
      <summary className="min-h-11 cursor-pointer text-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan">
        {title}<span className="ml-2 text-sm font-normal text-muted">{rows.length} ligne(s)</span>
      </summary>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mt-1 max-w-3xl text-sm text-muted">{help}</p>
        </div>
        {!disabled && (
          <button
            type="button"
            className={button}
            onClick={() => onChange([...rows, create()])}
          >
            + Ajouter
          </button>
        )}
      </div>
      {!rows.length && (
        <p className="mt-4 text-sm text-muted">Aucune ligne déclarée.</p>
      )}
      <div className="space-y-4">
        {rows.map((row, index) => (
          <fieldset
            disabled={disabled}
            key={row.id}
            className="mt-4 rounded-lg border border-line bg-paper p-3"
          >
            <legend className="px-1 text-sm font-semibold">
              {title} · {index + 1}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((field) => {
                const value =
                  row[field.key] == null ? '' : String(row[field.key]);
                const set = (v: string) =>
                  onChange(
                    rows.map((r, i) =>
                      i !== index
                        ? r
                        : {
                            ...r,
                            [field.key]:
                              v === '' && field.nullable
                                ? null
                                : field.type === 'number'
                                  ? v === ''
                                    ? ''
                                    : Number(v)
                                  : v,
                          },
                    ),
                  );
                return (
                  <label
                    key={String(field.key)}
                    className="text-sm font-medium text-muted"
                  >
                    {field.label}
                    {field.options ? (
                      <select
                        className={input}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                      >
                        {value &&
                          !field.options.some((o) => o.value === value) && (
                            <option value={value}>
                              Référence indisponible ({value})
                            </option>
                          )}
                        {field.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className={input}
                        value={value}
                        type={field.type ?? 'text'}
                        step={field.type === 'number' ? 'any' : undefined}
                        inputMode={
                          field.type === 'number' ? 'decimal' : undefined
                        }
                        onChange={(e) => set(e.target.value)}
                      />
                    )}
                  </label>
                );
              })}
            </div>
            {!disabled && (
              <button
                type="button"
                className={`${button} mt-3 text-clay`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                Retirer la ligne {index + 1}
              </button>
            )}
          </fieldset>
        ))}
      </div>
    </details>
  );
}

export function DailyEditor({
  projectId,
  accountScope,
  canReview,
  initialRecords,
  crew,
  bpu,
  photos,
  referenceWarning,
  initialDate,
  journalUnavailable,
}: {
  journalUnavailable: boolean;
  initialDate?: string;
  projectId: string;
  accountScope: string;
  canReview: boolean;
  initialRecords: TerrainJourneeRecord[];
  crew: TerrainCrewMember[];
  bpu: { id: string; label: string; unite: string }[];
  photos: { id: string; label: string }[];
  referenceWarning: boolean;
}) {
  const dateToday =
    initialDate ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const initial = initialRecords.find((r) => r.payload.date === dateToday);
  const [records, setRecords] = useState(initialRecords);
  const [record, setRecord] = useState<TerrainJourneeRecord | undefined>(
    initial,
  );
  const [id, setId] = useState(initial?.id ?? '');
  const [payload, setPayload] = useState<TerrainJourneePayload>(
    initial?.payload ?? emptyDaily(dateToday),
  );
  const [version, setVersion] = useState(initial?.version ?? 0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [localState, setLocalState] = useState('');
  const [recovery, setRecovery] = useState<LocalDailyDraft | null>(null);
  const [conflict, setConflict] = useState<TerrainJourneeRecord | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [reason, setReason] = useState('');
  const [online, setOnline] = useState(true);
  const restoredKey = useRef('');
  const key = dailyDraftKey(accountScope, projectId, payload.date);
  const locked =
    record?.status === 'reviewed' || record?.status === 'submitted';
  const disabled = locked || busy || !!recovery || conflicted;
  const eligibleCrew = crew.filter(
    (c) =>
      (!c.startDate || c.startDate.slice(0, 10) <= payload.date) &&
      (!c.endDate || c.endDate.slice(0, 10) >= payload.date),
  );
  useEffect(() => {
    if (!id) setId(crypto.randomUUID());
  }, [id]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  useEffect(() => {
    if (restoredKey.current === key) return;
    restoredKey.current = key;
    try {
      const raw = localStorage.getItem(key);
      const local = readDailyDraft(raw);
      setRecovery(local);
      if (raw && !local)
        setLocalState(
          'Le brouillon local est illisible. Téléchargez votre saisie avant de quitter.',
        );
    } catch {
      setLocalState(
        'Stockage local indisponible. Téléchargez votre saisie avant de quitter cette page.',
      );
    }
  }, [key]);
  function persist(): boolean {
    if (!id) return false;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          id,
          version,
          payload,
          savedAt: new Date().toISOString(),
        } satisfies LocalDailyDraft),
      );
      setLocalState('Brouillon enregistré sur cet appareil.');
      return true;
    } catch {
      setLocalState(
        'Sauvegarde locale impossible. Téléchargez votre saisie et gardez cette page ouverte.',
      );
      return false;
    }
  }
  useEffect(() => {
    if (!dirty || recovery || !id) return;
    const timer = setTimeout(() => persist(), 400);
    return () => clearTimeout(timer);
  }, [payload, id, version, dirty, recovery]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(next: TerrainJourneePayload) {
    setPayload(next);
    setDirty(true);
    setMessage('');
  }
  function rows<K extends Group>(group: K, next: TerrainJourneePayload[K]) {
    change({ ...payload, [group]: next });
  }
  function load(next?: TerrainJourneeRecord, date = dateToday) {
    setRecord(next);
    setPayload(next?.payload ?? emptyDaily(date));
    setId(next?.id ?? crypto.randomUUID());
    setVersion(next?.version ?? 0);
    setDirty(false);
    setConflict(null);
    setConflicted(false);
    setMessage('');
    setReason('');
    setLocalState('');
  }
  function download() {
    const blob = new Blob([JSON.stringify({ id, version, payload }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journee-${payload.date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function accept(next: TerrainJourneeRecord) {
    setRecord(next);
    setVersion(next.version);
    setPayload(next.payload);
    setDirty(false);
    setRecords((current) => [next, ...current.filter((r) => r.id !== next.id)]);
    try {
      localStorage.removeItem(key);
    } catch {
      /* Success remains explicit even if browser storage is unavailable. */
    }
    setLocalState('');
  }
  function failure(result: Extract<DailyResult, { ok: false }>) {
    setMessage(result.message);
    if (result.code === 'conflict') {
      setConflicted(true);
      setConflict(result.current ?? null);
    }
  }
  async function act(
    operation:
      | 'save'
      | 'submit'
      | 'review'
      | 'return'
      | 'reopen'
      | 'resolve'
      | 'settle',
    blockerId?: string,
    settlement?: DailySettlement,
  ) {
    if (busy || !id) return;
    persist();
    setBusy(true);
    setMessage('');
    try {
      let currentVersion = version;
      if (
        operation === 'save' ||
        (operation === 'submit' && (dirty || version === 0))
      ) {
        const saved = await writeDaily(
          projectId,
          id,
          currentVersion,
          'save',
          payload,
          undefined,
          accountScope,
        );
        if (!saved.ok) {
          failure(saved);
          return;
        }
        accept(saved.record);
        currentVersion = saved.record.version;
      }
      if (operation !== 'save') {
        const result = await writeDaily(
          projectId,
          id,
          currentVersion,
          operation,
          undefined,
          reason,
          accountScope,
          blockerId,
          settlement,
        );
        if (!result.ok) {
          failure(result);
          return;
        }
        accept(result.record);
      }
      setMessage(
        operation === 'settle'
          ? 'Rattachements enregistrés et journaux complétés sans modifier les quantités.'
          : operation === 'resolve'
            ? 'Blocage marqué comme résolu.'
            : operation === 'reopen'
              ? 'Journée rouverte pour correction. Les anciennes projections ont été annulées et la réouverture est tracée.'
              : operation === 'review'
                ? 'Journée vérifiée : les journaux ont été alimentés une seule fois.'
                : operation === 'submit'
                  ? 'Journée transmise au bureau.'
                  : operation === 'return'
                    ? 'Journée renvoyée au chantier pour correction.'
                    : 'Brouillon enregistré sur le serveur.',
      );
    } catch {
      setMessage(
        'Connexion interrompue. Votre saisie reste ici. Réessayez avec le même identifiant.',
      );
    } finally {
      setBusy(false);
    }
  }
  const section = (content: ReactNode) => (
    <div className="rounded-xl border border-line bg-paper-2 p-4 sm:p-5">
      {content}
    </div>
  );
  return (
    <div className="space-y-5">
      <header className="rounded-xl border border-line border-l-4 border-l-cyan bg-paper-2 p-5">
        <p className="text-xs font-bold uppercase tracking-widest text-cyan">
          Conduite des travaux · saisie quotidienne
        </p>
        <h2 className="mt-2 text-2xl font-bold">Journée du chantier</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          Une saisie pour l’équipe, les travaux et les ressources. La
          vérification du bureau alimente les journaux du chantier. Elle ne
          constitue pas une approbation du client.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">
          Date de travail
          <input
            className={input}
            type="date"
            value={payload.date}
            disabled={dirty || busy || !!recovery}
            onChange={(e) => {
              if (e.target.value)
                load(
                  records.find((r) => r.payload.date === e.target.value),
                  e.target.value,
                );
            }}
          />
        </label>
        <span className="rounded-full bg-sand px-3 py-2 text-sm font-semibold">
          {record ? statusLabels[record.status] : 'Nouvelle journée'} · version{' '}
          {version}
        </span>
        <span className="text-sm text-muted" role="status">
          {online ? 'Connexion disponible' : 'Hors connexion · saisie locale'}
          {dirty ? ' · modifications à transmettre' : ''}
        </span>
      </div>
      {journalUnavailable && (
        <p className="rounded-lg border border-clay bg-paper p-3 text-sm">
          Journal serveur indisponible. Vous pouvez reprendre un brouillon local
          ; la version sera contrôlée lors de la prochaine transmission.
        </p>
      )}
      {referenceWarning && (
        <p className="rounded-lg border border-ochre bg-sand p-3 text-sm">
          Certaines références (équipe, BPU ou photos) n’ont pas pu être
          chargées. Rechargez cette page après avoir sauvegardé votre brouillon.
        </p>
      )}
      {recovery && (
        <div className="rounded-xl border border-cyan bg-cyan-soft p-4">
          <h3 className="font-bold">Brouillon trouvé sur cet appareil</h3>
          <p className="mt-1 text-sm">
            Sauvé le {new Date(recovery.savedAt).toLocaleString('fr-MA')}.{' '}
            {recoveryIsStale(recovery, record)
              ? 'La version serveur diffère : comparez avant de reprendre.'
              : 'Vous pouvez reprendre votre saisie.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={button}
              onClick={() => {
                setId(recovery.id);
                setVersion(recovery.version);
                setPayload(recovery.payload);
                setDirty(true);
                if (recoveryIsStale(recovery, record)) {
                  setConflict(record ?? null);
                  setConflicted(true);
                }
                setRecovery(null);
              }}
            >
              Reprendre le brouillon local
            </button>
            <button
              className={button}
              onClick={() => {
                try {
                  localStorage.removeItem(key);
                } catch {
                  setLocalState('Suppression locale impossible.');
                }
                setRecovery(null);
              }}
            >
              Conserver la version serveur
            </button>
          </div>
        </div>
      )}
      {record?.returnReason && (
        <p className="rounded-lg border border-clay bg-paper p-4 text-sm">
          <strong>Correction demandée :</strong> {record.returnReason}
        </p>
      )}
      {locked && (
        <p className="rounded-lg bg-sand p-4 text-sm">
          {record?.status === 'reviewed'
            ? 'Journée verrouillée après vérification. Toute correction doit être tracée par le bureau.'
            : 'Journée transmise. Le bureau doit la renvoyer pour permettre une correction.'}
        </p>
      )}
      {section(
        <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Zone par défaut *
            <input
              className={input}
              value={payload.zone}
              onChange={(e) => change({ ...payload, zone: e.target.value })}
              placeholder="Bloc A · fondations"
            />
          </label>
          <label className="text-sm font-semibold">
            Travaux et faits marquants *
            <textarea
              rows={3}
              className={input}
              value={payload.summary}
              onChange={(e) => change({ ...payload, summary: e.target.value })}
            />
          </label>
        </fieldset>,
      )}
      {section(
        <>
          <h3 className="text-lg font-bold">
            Équipe affectée · confirmer la présence
          </h3>
          <p className="mt-1 text-sm text-muted">
            Aucune présence n’est supposée. Cochez les personnes confirmées et
            ajustez leur journée ci-dessous.
          </p>
          {eligibleCrew.length ? (
            <fieldset
              disabled={disabled}
              className="mt-4 grid gap-2 sm:grid-cols-2"
            >
              {eligibleCrew.map((person) => (
                <label
                  key={person.assignmentId}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line p-3 text-sm"
                >
                  <input
                    className="h-5 w-5 accent-cyan"
                    type="checkbox"
                    checked={payload.attendance.some(
                      (a) => a.assignmentId === person.assignmentId,
                    )}
                    onChange={(e) =>
                      rows(
                        'attendance',
                        e.target.checked
                          ? [
                              ...payload.attendance,
                              {
                                id: crypto.randomUUID(),
                                assignmentId: person.assignmentId,
                                temporaryName: null,
                                daysWorked: 1,
                                note: null,
                              },
                            ]
                          : payload.attendance.filter(
                              (a) => a.assignmentId !== person.assignmentId,
                            ),
                      )
                    }
                  />
                  <span>
                    {person.fullName}
                    <span className="block text-xs text-muted">
                      {person.metier}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Aucune affectation disponible. Gérez les affectations dans
              Personnel ou déclarez une personne temporaire.
            </p>
          )}
        </>,
      )}
      <Lines
        title="Présences confirmées"
        help="Une personne temporaire reste sans valorisation tant que le bureau n’a pas confirmé son coût."
        rows={payload.attendance}
        disabled={disabled}
        onChange={(next) =>
          rows(
            'attendance',
            next.map((a) => ({
              ...a,
              temporaryName: a.assignmentId ? null : (a.temporaryName ?? ''),
            })),
          )
        }
        create={() => ({
          id: crypto.randomUUID(),
          assignmentId: null,
          temporaryName: '',
          daysWorked: 1,
          note: null,
        })}
        fields={[
          {
            key: 'assignmentId',
            label: 'Affectation (ou temporaire)',
            nullable: true,
            options: [
              { value: '', label: 'Personne temporaire' },
              ...eligibleCrew.map((c) => ({
                value: c.assignmentId,
                label: c.fullName,
              })),
            ],
          },
          {
            key: 'temporaryName',
            label: 'Nom temporaire (sans affectation)',
            nullable: true,
          },
          {
            key: 'daysWorked',
            label: 'Journées confirmées (0 à 2)',
            type: 'number',
          },
          { key: 'note', label: 'Note', nullable: true },
        ]}
      />
      <Lines
        title="Travaux réalisés"
        help="La liaison au BPU est facultative. Les quantités seront déclarées comme attachements après vérification, sans approbation client implicite."
        rows={payload.production}
        disabled={disabled}
        onChange={(next) => rows('production', next)}
        create={() => ({
          id: crypto.randomUUID(),
          bpuLigneId: null,
          zone: null,
          designation: '',
          unite: '',
          quantite: 1,
          note: null,
        })}
        fields={[
          {
            key: 'bpuLigneId',
            label: 'Prix du bordereau',
            nullable: true,
            options: [
              { value: '', label: 'Hors BPU / à rattacher' },
              ...bpu.map((b) => ({ value: b.id, label: b.label })),
            ],
          },
          {
            key: 'zone',
            label: 'Zone / ouvrage (sinon zone par défaut)',
            nullable: true,
          },
          { key: 'designation', label: 'Travail réalisé *' },
          { key: 'unite', label: 'Unité *' },
          { key: 'quantite', label: 'Quantité réalisée *', type: 'number' },
          { key: 'note', label: 'Repère / note', nullable: true },
        ]}
      />
      <Lines
        title="Matériel et engins"
        help="Laissez les coûts inconnus vides. Le carburant consommé et la location ne sont pas à ressaisir en dépenses."
        rows={payload.equipment}
        disabled={disabled}
        onChange={(next) => rows('equipment', next)}
        create={() => ({
          id: crypto.randomUUID(),
          engin: '',
          regime: 'propre' as const,
          heuresUtilisation: null,
          carburantL: null,
          coutCarburantMad: null,
          coutLocationMad: null,
          note: null,
        })}
        fields={[
          { key: 'engin', label: 'Engin / matériel *' },
          {
            key: 'regime',
            label: 'Régime',
            options: [
              { value: 'propre', label: 'Propre' },
              { value: 'location', label: 'Location' },
            ],
          },
          {
            key: 'heuresUtilisation',
            label: 'Heures utilisées',
            type: 'number',
            nullable: true,
          },
          {
            key: 'carburantL',
            label: 'Carburant consommé (L)',
            type: 'number',
            nullable: true,
          },
          {
            key: 'coutCarburantMad',
            label: 'Coût carburant connu (DH)',
            type: 'number',
            nullable: true,
          },
          {
            key: 'coutLocationMad',
            label: 'Coût location connu (DH)',
            type: 'number',
            nullable: true,
          },
          { key: 'note', label: 'Note', nullable: true },
        ]}
      />
      <Lines
        title="Matériaux"
        help="Distinguez ce qui est livré de ce qui est consommé. Une réception n’est pas comptée comme une consommation."
        rows={payload.materials}
        disabled={disabled}
        onChange={(next) => rows('materials', next)}
        create={() => ({
          id: crypto.randomUUID(),
          kind: 'consumption' as const,
          article: '',
          unite: '',
          quantite: 1,
          prixUnitaireMad: null,
          fournisseur: null,
          bonLivraison: null,
          note: null,
        })}
        fields={[
          {
            key: 'kind',
            label: 'Mouvement',
            options: [
              { value: 'receipt', label: 'Réception sur site' },
              { value: 'consumption', label: 'Consommation effective' },
            ],
          },
          { key: 'article', label: 'Article *' },
          { key: 'unite', label: 'Unité *' },
          { key: 'quantite', label: 'Quantité *', type: 'number' },
          {
            key: 'prixUnitaireMad',
            label: 'Prix unitaire connu (DH)',
            type: 'number',
            nullable: true,
          },
          { key: 'fournisseur', label: 'Fournisseur', nullable: true },
          { key: 'bonLivraison', label: 'Bon de livraison', nullable: true },
          { key: 'note', label: 'Note', nullable: true },
        ]}
      />
      <Lines
        title="Dépenses complémentaires"
        help="Réservé aux autres frais. Les ressources déjà déclarées ci-dessus ne doivent pas être comptées deux fois."
        rows={payload.expenses}
        disabled={disabled}
        onChange={(next) => rows('expenses', next)}
        create={() => ({
          id: crypto.randomUUID(),
          category: 'autre' as const,
          label: '',
          amountMad: 1,
          note: null,
          photoId: null,
        })}
        fields={[
          {
            key: 'category',
            label: 'Catégorie',
            options: [
              { value: 'transport', label: 'Transport' },
              { value: 'sous_traitance', label: 'Sous-traitance' },
              { value: 'administratif', label: 'Administratif' },
              { value: 'taxes', label: 'Taxes' },
              { value: 'autre', label: 'Autre' },
            ],
          },
          { key: 'label', label: 'Libellé *' },
          { key: 'amountMad', label: 'Montant (DH) *', type: 'number' },
          {
            key: 'photoId',
            label: 'Justificatif existant',
            nullable: true,
            options: [
              { value: '', label: 'Aucun justificatif lié' },
              ...photos.map((p) => ({ value: p.id, label: p.label })),
            ],
          },
          { key: 'note', label: 'Note', nullable: true },
        ]}
      />
      <Lines
        title="Blocages"
        help="Chaque blocage doit avoir un responsable. Précisez son échéance et clôturez-le après résolution."
        rows={payload.blockers}
        disabled={disabled}
        onChange={(next) => rows('blockers', next)}
        create={() => ({
          id: crypto.randomUUID(),
          label: '',
          severity: 'warning' as const,
          owner: '',
          dueDate: null,
          status: 'open' as const,
        })}
        fields={[
          { key: 'label', label: 'Blocage *' },
          { key: 'owner', label: 'Responsable *' },
          { key: 'dueDate', label: 'Échéance', type: 'date', nullable: true },
          {
            key: 'severity',
            label: 'Priorité',
            options: [
              { value: 'info', label: 'Information' },
              { value: 'warning', label: 'À traiter' },
              { value: 'critical', label: 'Critique' },
            ],
          },
          {
            key: 'status',
            label: 'État',
            options: [
              { value: 'open', label: 'Ouvert' },
              { value: 'resolved', label: 'Résolu' },
            ],
          },
        ]}
      />
      {section(
        <>
          <h3 className="text-lg font-bold">Photos du chantier</h3>
          <p className="mt-1 text-sm text-muted">
            Liez les photos déjà présentes dans la photothèque. Pour ajouter un
            fichier, utilisez l’onglet Photos avec une connexion disponible.
          </p>
          <fieldset
            disabled={disabled}
            className="mt-3 grid gap-2 sm:grid-cols-2"
          >
            {photos.length ? (
              photos.map((photo) => (
                <label
                  key={photo.id}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-line p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-cyan"
                    checked={payload.photoIds.includes(photo.id)}
                    onChange={(e) =>
                      change({
                        ...payload,
                        photoIds: e.target.checked
                          ? [...payload.photoIds, photo.id]
                          : payload.photoIds.filter((id) => id !== photo.id),
                      })
                    }
                  />
                  {photo.label}
                </label>
              ))
            ) : (
              <p className="text-sm text-muted">Aucune photo disponible.</p>
            )}
          </fieldset>
        </>,
      )}
      {record &&
        payload.blockers.some((b) => b.status === 'open') &&
        section(
          <>
            <h3 className="text-lg font-bold">Résoudre un blocage</h3>
            <p className="mt-1 text-sm text-muted">
              La résolution est tracée sans modifier les ressources déjà
              vérifiées.
            </p>
            <ul className="mt-3 divide-y divide-line">
              {payload.blockers
                .filter((b) => b.status === 'open')
                .map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <span>
                      {b.label} · {b.owner}
                      {b.dueDate ? ` · ${b.dueDate}` : ''}
                    </span>
                    <button
                      className={button}
                      disabled={busy || dirty || conflicted || !!recovery}
                      onClick={() => act('resolve', b.id)}
                    >
                      Marquer résolu
                    </button>
                  </li>
                ))}
            </ul>
          </>,
        )}
      {canReview && record?.status === 'reviewed' && (
        <ReviewedSettlement
          key={`${record.id}:${record.version}`}
          payload={record.payload}
          crew={eligibleCrew}
          bpu={bpu}
          disabled={busy || dirty || conflicted || !!recovery}
          onSubmit={(mapping) => act('settle', undefined, mapping)}
        />
      )}
      {canReview &&
        record?.status === 'reviewed' &&
        section(
          <>
            <h3 className="text-lg font-bold">Correction tracée · bureau</h3>
            <p className="mt-1 text-sm text-muted">
              La réouverture annule les projections modifiables avant
              correction. Une journée liée à des éléments déjà engagés nécessite
              une correction officielle.
            </p>
            <label className="mt-3 block text-sm">
              Motif de réouverture obligatoire
              <input
                className={input}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className={`${button} mt-3`}
              disabled={busy || conflicted || !!recovery || !reason.trim()}
              onClick={() => act('reopen')}
            >
              Rouvrir pour correction
            </button>
          </>,
        )}
      {conflicted && (
        <div
          className="rounded-xl border border-clay bg-paper p-4"
          role="alert"
        >
          <h3 className="font-bold text-clay">Versions à comparer</h3>
          <p className="mt-2 text-sm">
            Votre saisie locale : version {version}, {payload.zone} —{' '}
            {payload.summary}
          </p>
          {conflict ? (
            <p className="mt-2 text-sm">
              Serveur : version {conflict.version},{' '}
              {statusLabels[conflict.status]}, {conflict.payload.zone} —{' '}
              {conflict.payload.summary}
            </p>
          ) : (
            <p className="mt-2 text-sm">
              La version serveur n’a pas pu être récupérée.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={button} onClick={download}>
              Télécharger ma saisie
            </button>
            <button
              className={button}
              onClick={async () => {
                try {
                  const latest = (await dailyRecords(projectId)).find(
                    (r) => r.id === id || r.payload.date === payload.date,
                  );
                  if (latest) setConflict(latest);
                  else
                    setMessage(
                      'Aucune journée correspondante sur le serveur. Conservez votre export puis rechargez cette page.',
                    );
                } catch {
                  setMessage(
                    'Impossible de charger le serveur. Réessayez quand la connexion revient.',
                  );
                }
              }}
            >
              Actualiser la comparaison
            </button>
            {conflict && (
              <button
                className={button}
                onClick={() => {
                  try {
                    localStorage.removeItem(key);
                  } catch {
                    /* Preserve visible recovery warnings. */
                  }
                  load(conflict);
                }}
              >
                Remplacer ma saisie par la version serveur
              </button>
            )}
          </div>
        </div>
      )}
      <div className="sticky bottom-3 z-10 rounded-xl border border-line bg-paper-2 p-4 shadow-lg">
        <div aria-live="polite" className="mb-3 space-y-1 text-sm">
          <p>{busy ? 'Transmission en cours…' : message}</p>
          <p className="text-muted">{localState}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!locked && (
            <>
              <button
                className={button}
                disabled={disabled || !id}
                onClick={() => act('save')}
              >
                Enregistrer le brouillon
              </button>
              <button
                className={`${button} border-cyan bg-cyan text-paper`}
                disabled={disabled || !id}
                onClick={() => act('submit')}
              >
                Transmettre au bureau
              </button>
            </>
          )}
          <button className={button} onClick={download}>
            Télécharger ma saisie
          </button>
        </div>
        {canReview && record?.status === 'submitted' && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-sm font-semibold">
              Vérification interne · bureau
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <button
                className={`${button} border-cyan text-cyan`}
                disabled={busy || conflicted}
                onClick={() => act('review')}
              >
                Vérifier et alimenter les journaux
              </button>
              <label className="min-w-0 flex-1 text-sm">
                Motif de retour
                <input
                  className={input}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Correction attendue…"
                />
              </label>
              <button
                className={button}
                disabled={busy || conflicted || !reason.trim()}
                onClick={() => act('return')}
              >
                Renvoyer pour correction
              </button>
            </div>
          </div>
        )}
      </div>
      {section(
        <>
          <h3 className="text-lg font-bold">Journées du chantier</h3>
          <p className="mt-1 text-sm text-muted">
            Enregistrez la saisie en cours avant de changer de journée.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {records.length ? (
              records.map((r) => (
                <button
                  key={r.id}
                  disabled={dirty || busy || !!recovery}
                  className={`${button} ${r.id === id ? 'border-cyan text-cyan' : ''}`}
                  onClick={() => load(r)}
                >
                  {r.payload.date} · {statusLabels[r.status]}
                </button>
              ))
            ) : (
              <p className="text-sm text-muted">
                {journalUnavailable
                  ? 'Journal serveur indisponible.'
                  : 'Aucune journée enregistrée sur le serveur.'}
              </p>
            )}
          </div>
          {record && (
            <details className="mt-4 text-sm">
              <summary className="min-h-11 cursor-pointer font-semibold">
                Historique de la journée
              </summary>
              <ul className="space-y-2">
                {record.history.map((event, index) => (
                  <li key={index}>
                    {new Date(event.at).toLocaleString('fr-MA')} ·{' '}
                    {event.action} · {event.actor} · v{event.version}
                    {event.reason ? ` · ${event.reason}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>,
      )}
    </div>
  );
}
