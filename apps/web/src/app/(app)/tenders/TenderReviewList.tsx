import { BuyerAvatar } from '@/components/ui/BuyerAvatar';
import { moroccoTimeZone } from '@atlas/contracts';
import { Icon } from '@/components/ui/Icon';
import { CATEGORY_TONES, conflictingPortalDeadline, hasRegion, type TenderItem } from '@/lib/tenders';

const deadlineFormats = {
  UTC: new Intl.DateTimeFormat('fr-MA', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }),
  'Africa/Casablanca': new Intl.DateTimeFormat('fr-MA', { timeZone: 'Africa/Casablanca', dateStyle: 'short', timeStyle: 'short' }),
};
const amountFormat = new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 2 });

function amount(value: number | undefined) {
  return value != null && Number.isFinite(value) ? `${amountFormat.format(value)} MAD` : 'Non renseigné';
}

interface TenderReviewListProps {
  items: readonly TenderItem[];
  selectedId: string | null;
  onSelect: (item: TenderItem) => void;
  isSeen: (id: string) => boolean;
  now: number | null;
}

export function TenderReviewList({ items, selectedId, onSelect, isSeen, now }: TenderReviewListProps) {
  return (
    <ul aria-label="Opportunités" className="@container divide-y divide-line">
      {items.map((item) => {
        const open = item.lifecycleStatus === 'en_cours';
        const deadline = new Date(item.deadlineAt);
        const dateKnown = Number.isFinite(deadline.getTime());
        const conflict = conflictingPortalDeadline(item);
        const hoursLeft = open && dateKnown && now !== null
          ? (Math.min(deadline.getTime(), conflict?.getTime() ?? Infinity) - now) / 3_600_000 : null;
        const imminent = hoursLeft !== null && hoursLeft > 0 && hoursLeft < 72;
        const status = hoursLeft === null ? item.lifecycleLabel
          : hoursLeft <= 0 ? (conflict ? 'Date à confirmer' : 'Échu')
          : imminent ? (hoursLeft < 24 ? 'Moins de 24 h' : 'Moins de 72 h')
          : item.lifecycleLabel;
        const location = item.location?.trim() || (hasRegion(item.region) ? `Région : ${item.region}` : 'Lieu à confirmer');
        const dossier = item.hasBpu ? 'Bordereau disponible' : item.dossierExtractedAt ? 'DCE analysé' : 'DCE à examiner';
        const seen = isSeen(item.id);
        return (
          <li key={item.id} className={selectedId === item.id ? 'bg-cyan-soft/40' : 'hover:bg-sand/30'}>
            <article className="grid gap-x-5 gap-y-3 px-4 py-4 @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(21rem,0.92fr)]">
              <div className="min-w-0">
                <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                  <BuyerAvatar name={item.buyerName} size="sm" />
                  <span className="min-w-0 truncate" title={item.buyerName}>{item.buyerName}</span>
                  {!seen && <span className="shrink-0 rounded bg-cyan-soft px-1.5 py-0.5 font-semibold text-ink">Non lu</span>}
                </div>
                <h2 className="text-sm font-semibold leading-snug text-ink">
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    aria-haspopup="dialog"
                    className="group flex w-full cursor-pointer items-start gap-1 rounded text-left hover:text-cyan focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                  >
                    <span className="line-clamp-3 min-w-0 break-words">{item.objet}</span>
                    <Icon name="chevronRight" size={15} className="mt-0.5 shrink-0 text-muted group-hover:text-cyan" />
                  </button>
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="break-all font-mono">{item.reference}</span>
                  <span className={`rounded px-1.5 py-0.5 font-medium ${CATEGORY_TONES[item.category]}`}>{item.category}</span>
                  <span>{item.procedureLabel}</span>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-xs text-muted" title={location}>
                  <Icon name="pin" size={13} className="mt-px shrink-0" />
                  <span className="line-clamp-2 break-words">{location}</span>
                </p>
              </div>
              <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-sand/45 px-3 py-2.5 text-xs @min-[760px]:self-center">
                <div className="min-w-0">
                  <dt className="text-muted">Date limite</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                    {dateKnown ? <time dateTime={item.deadlineAt}>{deadlineFormats[moroccoTimeZone(deadline)].format(deadline)}</time> : 'À confirmer'}
                    {conflict && <span className="block text-ochre">Deux dates publiées · à vérifier</span>}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted">Estimation</dt>
                  <dd className="mt-0.5 break-words font-semibold tabular-nums text-ink">{amount(item.estimationMad)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted">Dossier</dt>
                  <dd className="mt-0.5 font-medium text-ink">{dossier}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted">Caution provisoire</dt>
                  <dd className="mt-0.5 break-words font-semibold tabular-nums text-ink">{amount(item.cautionProvisoireMad)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="sr-only">État de la consultation</dt>
                  <dd>
                    <span className={`inline-block rounded px-1.5 py-0.5 font-medium ${imminent ? 'bg-clay text-paper' : 'bg-paper-2 text-muted'}`}>
                      {status}
                    </span>
                  </dd>
                </div>
              </dl>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
