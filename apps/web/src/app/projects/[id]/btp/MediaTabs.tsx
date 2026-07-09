// Photothèque (albums + grille) et Documents/PV — fichiers dans MinIO, URLs
// présignées 1h. L'upload passe par un server action multipart.
import { apiGet } from '@/lib/api';
import { fmtDate, fmtFileSize, type Album, type Asset, type BtpProjectDetail } from '@/lib/btp';
import { createAlbum, deleteAlbum, deleteAsset, moveAssetToAlbum, uploadAssets } from '../actions';

const inputClass =
  'rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-cyan';

const PV_TYPES: Record<string, string> = {
  installation_chantier: 'PV d’installation de chantier',
  reunion_chantier: 'PV de réunion de chantier',
  constat: 'PV de constat',
  reception_provisoire: 'PV de réception provisoire',
  reception_definitive: 'PV de réception définitive',
  arret_travaux: 'PV d’arrêt des travaux',
  reprise_travaux: 'PV de reprise des travaux',
  autre: 'Autre PV',
};

// ─── Photos ──────────────────────────────────────────────────────────────────

export async function PhotosTab({ project }: { project: BtpProjectDetail }) {
  const [albums, photos] = await Promise.all([
    apiGet<Album[]>(`/btp/projects/${project.id}/albums`),
    apiGet<Asset[]>(`/btp/projects/${project.id}/assets?type=photo`),
  ]);
  const albumName = new Map(albums.map((a) => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Photothèque du chantier</h2>
          <p className="text-xs text-muted">
            {photos.length} photo{photos.length > 1 ? 's' : ''} · organisées par albums.
          </p>
        </div>
        {/* Upload */}
        <form
          action={uploadAssets}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-paper-2 px-4 py-3 shadow-sm"
        >
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="type" value="photo" />
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Photos (multi)
            <input
              type="file"
              name="files"
              multiple
              required
              accept="image/jpeg,image/png,image/webp"
              className="mt-1 block text-xs text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-cyan-soft file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-cyan"
            />
          </label>
          <label className="text-[11px] font-semibold uppercase tracking-widest text-faint">
            Album
            <select
              name="albumId"
              className="mt-1 block rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
            >
              <option value="">Sans album</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.name}
                </option>
              ))}
            </select>
          </label>
          <input
            name="description"
            placeholder="Description…"
            className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
          />
          <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90">
            ⬆ Téléverser
          </button>
        </form>
      </div>

      {/* Albums */}
      <div className="flex flex-wrap items-center gap-2">
        {albums.map((album) => (
          <span
            key={album.id}
            className="group inline-flex items-center gap-2 rounded-full border border-line bg-paper-2 px-3 py-1.5 text-xs font-semibold text-ink-2"
            style={{ borderLeftColor: album.color, borderLeftWidth: 3 }}
          >
            {album.name}
            <span className="font-mono text-[10px] text-faint">{album.photosCount}</span>
            <form action={deleteAlbum} className="hidden group-hover:block">
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="albumId" value={album.id} />
              <button className="text-faint hover:text-clay" title="Supprimer l'album">
                ✕
              </button>
            </form>
          </span>
        ))}
        <form action={createAlbum} className="inline-flex items-center gap-1.5">
          <input type="hidden" name="projectId" value={project.id} />
          <input
            name="name"
            required
            placeholder="Nouvel album…"
            className="rounded-full border border-dashed border-line bg-transparent px-3 py-1.5 text-xs outline-none placeholder:text-faint focus:border-cyan"
          />
          <button className="rounded-full bg-sand px-2.5 py-1.5 text-xs font-bold text-ink-2 hover:bg-line">
            +
          </button>
        </form>
      </div>

      {/* Grille */}
      {photos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-muted">Aucune photo.</p>
          <p className="mt-1 text-xs text-faint">Téléversez les premières photos du chantier.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {photos.map((photo) => (
            <figure
              key={photo.id}
              className="group relative overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm"
            >
              {photo.url ? (
                <a href={photo.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt={photo.originalName ?? 'photo chantier'}
                    loading="lazy"
                    className="aspect-square w-full object-cover transition group-hover:scale-105"
                  />
                </a>
              ) : (
                <div className="flex aspect-square items-center justify-center text-faint">—</div>
              )}
              <figcaption className="flex items-center justify-between gap-1 px-2.5 py-1.5 text-[10px] text-faint">
                <span className="truncate">
                  {photo.albumId ? (albumName.get(photo.albumId) ?? '') : fmtDate(photo.createdAt)}
                </span>
                <form action={deleteAsset}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="assetId" value={photo.id} />
                  <input type="hidden" name="backTo" value={`/projects/${project.id}?tab=photos`} />
                  <button className="opacity-0 transition hover:text-clay group-hover:opacity-100">
                    ✕
                  </button>
                </form>
              </figcaption>
              {albums.length > 0 && (
                <form
                  action={moveAssetToAlbum}
                  className="absolute inset-x-2 top-2 opacity-0 transition group-hover:opacity-100"
                >
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="assetId" value={photo.id} />
                  <select
                    name="albumId"
                    defaultValue={photo.albumId ?? ''}
                    className="w-full rounded-md border border-line bg-paper/90 px-1.5 py-1 text-[10px]"
                  >
                    <option value="">Sans album</option>
                    {albums.map((album) => (
                      <option key={album.id} value={album.id}>
                        {album.name}
                      </option>
                    ))}
                  </select>
                  <button className="mt-1 w-full rounded-md bg-cyan-soft px-1.5 py-0.5 text-[10px] font-bold text-cyan">
                    Déplacer
                  </button>
                </form>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Documents & PV ──────────────────────────────────────────────────────────

function AssetTable({
  projectId,
  assets,
  emptyLabel,
  backTab,
}: {
  projectId: string;
  assets: Asset[];
  emptyLabel: string;
  backTab: string;
}) {
  if (assets.length === 0) {
    return <p className="px-5 py-6 text-center text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-line bg-sand text-xs uppercase tracking-wider text-muted">
        <tr>
          <th className="px-4 py-2.5">Fichier</th>
          <th className="px-4 py-2.5">Type / description</th>
          <th className="px-4 py-2.5 text-right">Taille</th>
          <th className="px-4 py-2.5">Ajouté le</th>
          <th className="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {assets.map((asset) => {
          const meta = asset.metadata as { pvType?: string; description?: string };
          return (
            <tr key={asset.id} className="transition hover:bg-sand/40">
              <td className="px-4 py-2.5">
                {asset.url ? (
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-cyan hover:underline"
                  >
                    {asset.originalName ?? asset.fileName ?? 'document'}
                  </a>
                ) : (
                  <span className="text-sm text-muted">{asset.originalName ?? '—'}</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted">
                {meta.pvType ? (PV_TYPES[meta.pvType] ?? meta.pvType) : (meta.description ?? '—')}
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                {fmtFileSize(asset.fileSize)}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">{fmtDate(asset.createdAt)}</td>
              <td className="px-4 py-2.5 text-right">
                <form action={deleteAsset}>
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="assetId" value={asset.id} />
                  <input
                    type="hidden"
                    name="backTo"
                    value={`/projects/${projectId}?tab=${backTab}`}
                  />
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
  );
}

export async function DocumentsTab({ project }: { project: BtpProjectDetail }) {
  const [documents, pvs] = await Promise.all([
    apiGet<Asset[]>(`/btp/projects/${project.id}/assets?type=document`),
    apiGet<Asset[]>(`/btp/projects/${project.id}/assets?type=pv`),
  ]);
  return (
    <div className="space-y-6">
      {/* PV */}
      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Procès-verbaux ({pvs.length})
          </h3>
          <form action={uploadAssets} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="type" value="pv" />
            <input type="hidden" name="backTo" value={`/projects/${project.id}?tab=documents`} />
            <select
              name="pvType"
              className="rounded-lg border border-line bg-paper px-2 py-1.5 text-xs"
            >
              {Object.entries(PV_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="file"
              name="files"
              multiple
              required
              accept="application/pdf,image/jpeg,image/png"
              className="text-xs text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-cyan-soft file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-cyan"
            />
            <button className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-bold text-paper transition hover:opacity-90">
              ⬆ Joindre le PV
            </button>
          </form>
        </div>
        <AssetTable
          projectId={project.id}
          assets={pvs}
          emptyLabel="Aucun PV."
          backTab="documents"
        />
      </section>

      {/* Documents */}
      <section className="overflow-hidden rounded-xl border border-line bg-paper-2 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-faint">
            Documents du marché ({documents.length})
          </h3>
          <form action={uploadAssets} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="type" value="document" />
            <input type="hidden" name="backTo" value={`/projects/${project.id}?tab=documents`} />
            <input
              name="description"
              placeholder="Catégorie / description…"
              className={`${inputClass} w-48 py-1.5 text-xs`}
            />
            <input
              type="file"
              name="files"
              multiple
              required
              className="text-xs text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-cyan-soft file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-cyan"
            />
            <button className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-bold text-paper transition hover:opacity-90">
              ⬆ Joindre
            </button>
          </form>
        </div>
        <AssetTable
          projectId={project.id}
          assets={documents}
          emptyLabel="Aucun document."
          backTab="documents"
        />
      </section>
    </div>
  );
}
