'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { fmtDateTime } from '@/lib/tenders';

interface CheckedRevision {
  version: 1;
  officialIdentity: string | null;
  checkedAt: string;
  state: 'unchanged' | 'updated' | 'downloaded' | 'unavailable';
  mode?: 'anonymous' | 'account';
  reason?: 'scheduled_closure' | 'cooldown' | 'blocked' | 'anonymous_unavailable' | 'withdrawal_unconfirmed' | 'download_failed' | 'invalid_source' | 'verification_unavailable' | 'archive_unverified';
  retryAt?: string;
  previousArchiveSha256?: string;
  sourceArchiveSha256?: string;
  documentsIdentical?: boolean;
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
}

export type DceRevisionEvidence = { state: 'not_checked' } | CheckedRevision;

const REASONS: Record<NonNullable<CheckedRevision['reason']>, string> = {
  scheduled_closure: 'La source officielle est fermée pour la nuit.',
  cooldown: 'Le contrôle est suspendu pour respecter le délai de la source.',
  blocked: 'La source officielle a refusé la consultation.',
  anonymous_unavailable: 'Le téléchargement anonyme n’était pas disponible lors du contrôle.',
  withdrawal_unconfirmed: 'La demande de retrait a pu être enregistrée. Vérifiez son résultat sur le portail officiel avant toute nouvelle demande.',
  download_failed: 'La récupération du dossier officiel a échoué.',
  invalid_source: 'La référence de source officielle est invalide.',
  verification_unavailable: 'Le contrôle de la source est indisponible.',
  archive_unverified: 'L’archive affichée ne peut plus être confirmée par le contrôle enregistré. Vérifiez à nouveau la source officielle.',
};

const OFFICIAL_IDENTITY = /^(\d{1,20})\/([a-z\d_]{1,40})$/i;
type CheckMode = 'anonymous' | 'account';
type PendingAction = 'load' | CheckMode;

export function revisionUpdatesDossier(evidence: DceRevisionEvidence): boolean {
  return evidence.state === 'updated' || evidence.state === 'downloaded';
}

export function DceRevisionResult({ evidence }: { evidence: DceRevisionEvidence }) {
  if (evidence.state === 'not_checked') return <p className="text-xs text-muted">Version officielle à vérifier</p>;
  const label = evidence.state === 'unchanged'
    ? evidence.documentsIdentical ? 'Documents identiques lors du contrôle' : 'Aucun changement détecté lors du contrôle'
    : evidence.state === 'updated' ? 'Dossier actualisé · lecture à reprendre'
      : evidence.state === 'downloaded' ? 'Dossier récupéré · lecture à effectuer'
        : 'Version officielle non confirmée';
  const changes = [
    { label: 'Modifiés', files: evidence.changedFiles },
    { label: 'Ajoutés', files: evidence.addedFiles },
    { label: 'Retirés', files: evidence.removedFiles },
  ];
  const source = OFFICIAL_IDENTITY.exec(evidence.officialIdentity ?? '');
  const officialLink = source && `https://www.marchespublics.gov.ma/index.php?${new URLSearchParams({
    page: 'entreprise.EntrepriseDemandeTelechargementDce', refConsultation: source[1]!, orgAcronyme: source[2]!,
  })}`;
  return (
    <div className="space-y-1 text-xs text-ink-2" role="status">
      <p className="font-semibold">{label}</p>
      <p>{evidence.state === 'unavailable' && evidence.reason === 'archive_unverified'
        ? 'Dernière comparaison de la source le ' : 'Contrôle de la source le '}{fmtDateTime(evidence.checkedAt)}</p>
      {evidence.state === 'unavailable' && (
        <p>{evidence.mode === 'account' && evidence.reason === 'download_failed'
          ? 'Le téléchargement avec le compte de l’entreprise a échoué.'
          : (evidence.reason && REASONS[evidence.reason]) || 'La version officielle reste à confirmer.'}
          {evidence.retryAt ? ` Nouvel essai possible le ${fmtDateTime(evidence.retryAt)}.` : ''}</p>
      )}
      {evidence.state === 'unavailable' && officialLink && <a href={officialLink} target="_blank" rel="noopener noreferrer" className="text-cyan underline">Consulter le DCE sur le portail officiel</a>}
      <p>Ce contrôle porte sur la version des documents ; il ne valide pas les conditions de participation.</p>
      <details>
        <summary className="cursor-pointer">Détails du contrôle de version</summary>
        <div className="max-h-36 space-y-1 overflow-auto py-1">
          {evidence.officialIdentity && <p>Annonce : {evidence.officialIdentity}</p>}
          {evidence.previousArchiveSha256 && <p className="break-all">Archive précédente : {evidence.previousArchiveSha256}</p>}
          {evidence.sourceArchiveSha256 && <p className="break-all">Archive source : {evidence.sourceArchiveSha256}</p>}
          {changes.filter(change => change.files.length > 0).map(change => (
            <div key={change.label}>
              <p className="font-semibold">{change.label} ({change.files.length})</p>
              {change.files.slice(0, 20).map((name, index) => <p className="break-words" key={`${index}/${name}`}>{name}</p>)}
              {change.files.length > 20 && <p>{change.files.length - 20} autre(s) fichier(s)</p>}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export function DceRevisionActions({ evidence, busy, onCheck }: {
  evidence: DceRevisionEvidence;
  busy: PendingAction | null;
  onCheck: (mode: CheckMode) => void;
}) {
  const accountDescription = useId();
  const accountAvailable = evidence.state === 'unavailable' && OFFICIAL_IDENTITY.test(evidence.officialIdentity ?? '') &&
    evidence.reason !== 'withdrawal_unconfirmed' &&
    (!evidence.retryAt || Date.parse(evidence.retryAt) <= Date.now()) &&
    (evidence.reason === 'anonymous_unavailable' || evidence.mode === 'account');
  const buttonClass = 'rounded-lg border border-line bg-paper px-3 py-1.5 font-semibold text-ink disabled:opacity-50';
  return (
    <div className="mt-2 space-y-2 text-xs" aria-busy={busy !== null}>
      <button type="button" onClick={() => onCheck('anonymous')} disabled={busy !== null} className={buttonClass}>
        {busy === 'load' ? 'Chargement du contrôle…' : busy === 'anonymous' ? 'Vérification de la source…' : 'Vérifier la source officielle'}
      </button>
      {accountAvailable && (
        <div className="space-y-1">
          <p id={accountDescription} className="text-muted">
            Cette action utilise le compte de l’entreprise configuré dans ATLAS, accepte les conditions du portail et enregistre un retrait au nom de l’entreprise.
          </p>
          <button type="button" aria-describedby={accountDescription} onClick={() => onCheck('account')} disabled={busy !== null} className={buttonClass}>
            {busy === 'account' ? 'Téléchargement avec le compte…' : 'Télécharger avec le compte de l’entreprise'}
          </button>
        </div>
      )}
      {(busy === 'anonymous' || busy === 'account') && <p className="text-muted" role="status">La récupération peut prendre quelques minutes.</p>}
    </div>
  );
}

export function DceRevisionCheck({ tenderId, onUpdated, onChecked }: { tenderId: string; onUpdated?: () => void; onChecked?: () => void }) {
  const [record, setRecord] = useState<{ tenderId: string; evidence: DceRevisionEvidence } | null>(null);
  const [pending, setPending] = useState<{ tenderId: string; kind: PendingAction } | null>(null);
  const [failure, setFailure] = useState<{ tenderId: string; message: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const url = `/api/tenders/${encodeURIComponent(tenderId)}/dossier/revision`;

  useEffect(() => {
    const currentGeneration = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending({ tenderId, kind: 'load' });
    setFailure(null);
    void (async () => {
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Contrôle conservé indisponible. Vous pouvez réessayer.');
        const evidence = await response.json() as DceRevisionEvidence;
        if (!controller.signal.aborted && generation.current === currentGeneration) setRecord({ tenderId, evidence });
      } catch {
        if (!controller.signal.aborted && generation.current === currentGeneration) setFailure({ tenderId, message: 'Contrôle conservé indisponible. Vous pouvez réessayer.' });
      } finally {
        if (!controller.signal.aborted && generation.current === currentGeneration) {
          if (request.current === controller) request.current = null;
          setPending(null);
        }
      }
    })();
    return () => {
      generation.current++;
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, [tenderId, url]);

  async function checkSource(mode: CheckMode) {
    if (request.current) return;
    const currentGeneration = generation.current;
    const controller = new AbortController();
    request.current = controller;
    setPending({ tenderId, kind: mode });
    setFailure(null);
    try {
      const response = await fetch(mode === 'account' ? `${url}?mode=account` : url, {
        method: 'POST', cache: 'no-store', signal: controller.signal,
      });
      if (response.status === 429) {
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        const retryAfter = response.headers.get('retry-after');
        setFailure({ tenderId, message: retryAfter && /^\d{1,6}$/.test(retryAfter)
          ? `Contrôles rapprochés. Réessayez dans ${Math.max(1, Number(retryAfter))} s.`
          : 'Contrôles rapprochés. Réessayez dans un instant.' });
        return;
      }
      if (!response.ok) throw new Error('Contrôle de la source indisponible. Réessayez dans un instant.');
      const evidence = await response.json() as DceRevisionEvidence;
      if (controller.signal.aborted || generation.current !== currentGeneration) return;
      setRecord({ tenderId, evidence });
      if (revisionUpdatesDossier(evidence)) onUpdated?.();
      onChecked?.();
    } catch {
      if (!controller.signal.aborted && generation.current === currentGeneration) {
        setFailure({ tenderId, message: mode === 'account'
          ? 'Téléchargement avec le compte indisponible. Consultez le portail officiel.'
          : 'Contrôle de la source indisponible. Réessayez dans un instant.' });
      }
    } finally {
      if (!controller.signal.aborted && generation.current === currentGeneration) {
        if (request.current === controller) request.current = null;
        setPending(null);
      }
    }
  }

  const current = record?.tenderId === tenderId ? record.evidence : { state: 'not_checked' as const };
  const busy = pending?.tenderId === tenderId ? pending.kind : null;
  return (
    <div className="shrink-0 border-b border-line bg-sand/40 px-4 py-2" aria-label="Contrôle de la version DCE">
      <DceRevisionResult evidence={current} />
      <DceRevisionActions evidence={current} busy={busy} onCheck={checkSource} />
      {failure?.tenderId === tenderId && <p className="mt-1 text-xs text-rose" role="alert">{failure.message}</p>}
    </div>
  );
}
