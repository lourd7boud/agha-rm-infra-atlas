import React, { useState, useEffect, useCallback } from 'react';
import {
  Share2, Link, Copy, Eye, EyeOff, Trash2, Plus, Shield,
  Clock, Users, ExternalLink, Check, Lock, Globe, Activity
} from 'lucide-react';
import { apiService } from '../../services/apiService';

interface ShareLink {
  id: string;
  token: string;
  label: string;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientRole: string;
  permissions: Record<string, boolean>;
  pinCode: string | null;
  expiresAt: string | null;
  maxViews: number | null;
  viewCount: number;
  isActive: boolean;
  lastAccessedAt: string | null;
  lastAccessedIp: string | null;
  createdAt: string;
}

interface AccessLogEntry {
  id: string;
  ipAddress: string;
  userAgent: string;
  sectionViewed: string;
  accessedAt: string;
}

const RECIPIENT_ROLES = [
  { value: 'client', label: 'Client / Maître d\'Ouvrage' },
  { value: 'maitre_ouvrage', label: 'Maître d\'Ouvrage Délégué' },
  { value: 'bureau_etudes', label: 'Bureau d\'Études' },
  { value: 'controleur', label: 'Contrôleur / Auditeur' },
];

const PERMISSION_LABELS: Record<string, string> = {
  overview: 'Vue d\'ensemble',
  financials: 'Données financières',
  photos: 'Photos du chantier',
  documents: 'Documents',
  bordereaux: 'Bordereaux de prix',
  decompts: 'Décomptes',
  diary: 'Journal de chantier',
  ods: 'Ordres de Service',
};

const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  overview: true,
  financials: true,
  photos: true,
  documents: false,
  bordereaux: false,
  decompts: true,
  diary: false,
  ods: false,
};

interface ShareLinksPanelProps {
  projectId: string;
}

const ShareLinksPanel: React.FC<ShareLinksPanelProps> = ({ projectId }) => {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showLog, setShowLog] = useState<string | null>(null);
  const [accessLog, setAccessLog] = useState<AccessLogEntry[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Create form state
  const [form, setForm] = useState({
    label: '',
    recipientName: '',
    recipientEmail: '',
    recipientRole: 'client',
    permissions: { ...DEFAULT_PERMISSIONS },
    pinCode: '',
    expiresInDays: '',
    maxViews: '',
  });

  const fetchLinks = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiService.getShareLinks(projectId);
      setLinks(res.data || []);
    } catch (err) {
      console.error('Error fetching share links:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleCreate = async () => {
    try {
      const payload: any = {
        projectId,
        label: form.label || 'Lien de partage',
        recipientName: form.recipientName || null,
        recipientEmail: form.recipientEmail || null,
        recipientRole: form.recipientRole,
        permissions: form.permissions,
        pinCode: form.pinCode || null,
        maxViews: form.maxViews ? parseInt(form.maxViews) : null,
      };
      if (form.expiresInDays) {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(form.expiresInDays));
        payload.expiresAt = d.toISOString();
      }
      await apiService.createShareLink(payload);
      setShowCreate(false);
      setForm({
        label: '', recipientName: '', recipientEmail: '', recipientRole: 'client',
        permissions: { ...DEFAULT_PERMISSIONS }, pinCode: '', expiresInDays: '', maxViews: '',
      });
      fetchLinks();
    } catch (err) {
      console.error('Error creating share link:', err);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await apiService.toggleShareLink(id);
      fetchLinks();
    } catch (err) {
      console.error('Error toggling link:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Supprimer ce lien de partage ?')) return;
    try {
      await apiService.deleteShareLink(id);
      fetchLinks();
    } catch (err) {
      console.error('Error deleting link:', err);
    }
  };

  const handleShowLog = async (id: string) => {
    if (showLog === id) { setShowLog(null); return; }
    try {
      const res = await apiService.getShareLinkAccessLog(id);
      setAccessLog(res.data || []);
      setShowLog(id);
    } catch (err) {
      console.error('Error fetching access log:', err);
    }
  };

  const copyLink = (token: string, id: string) => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL}#/portal/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      client: 'bg-blue-100 text-blue-700',
      maitre_ouvrage: 'bg-purple-100 text-purple-700',
      bureau_etudes: 'bg-green-100 text-green-700',
      controleur: 'bg-amber-100 text-amber-700',
    };
    const labels: Record<string, string> = {
      client: 'Client',
      maitre_ouvrage: 'M.O. Délégué',
      bureau_etudes: 'Bureau d\'Études',
      controleur: 'Contrôleur',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[role] || 'bg-gray-100 text-gray-700'}`}>
        {labels[role] || role}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Share2 className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Portail Client</h3>
          <span className="text-sm text-gray-500">— Liens de partage</span>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          <Plus className="w-4 h-4" />
          Nouveau lien
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 space-y-4 shadow-sm">
          <h4 className="font-semibold text-gray-700 flex items-center gap-2">
            <Link className="w-4 h-4 text-blue-500" />
            Créer un lien de partage
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Libellé</label>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="Ex: Accès client M. Benani"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Rôle du destinataire</label>
              <select
                value={form.recipientRole}
                onChange={e => setForm({ ...form, recipientRole: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              >
                {RECIPIENT_ROLES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Nom du destinataire</label>
              <input
                type="text"
                value={form.recipientName}
                onChange={e => setForm({ ...form, recipientName: e.target.value })}
                placeholder="M. Ahmed Benani"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Email (optionnel)</label>
              <input
                type="email"
                value={form.recipientEmail}
                onChange={e => setForm({ ...form, recipientEmail: e.target.value })}
                placeholder="ahmed@example.com"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">
              <Shield className="w-4 h-4 inline mr-1" />
              Permissions d'accès
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-100">
                  <input
                    type="checkbox"
                    checked={form.permissions[key] || false}
                    onChange={e => setForm({
                      ...form,
                      permissions: { ...form.permissions, [key]: e.target.checked }
                    })}
                    className="rounded text-blue-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Security & Limits */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                <Lock className="w-3 h-3 inline mr-1" />
                Code PIN (optionnel)
              </label>
              <input
                type="text"
                value={form.pinCode}
                onChange={e => setForm({ ...form, pinCode: e.target.value })}
                placeholder="Ex: 1234"
                maxLength={8}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                <Clock className="w-3 h-3 inline mr-1" />
                Expire dans (jours)
              </label>
              <input
                type="number"
                value={form.expiresInDays}
                onChange={e => setForm({ ...form, expiresInDays: e.target.value })}
                placeholder="30"
                min="1"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                <Eye className="w-3 h-3 inline mr-1" />
                Consultations max (optionnel)
              </label>
              <input
                type="number"
                value={form.maxViews}
                onChange={e => setForm({ ...form, maxViews: e.target.value })}
                placeholder="Illimité"
                min="1"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-gray-600 border rounded-lg hover:bg-gray-50 text-sm"
            >
              Annuler
            </button>
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-1.5"
            >
              <Link className="w-4 h-4" />
              Créer le lien
            </button>
          </div>
        </div>
      )}

      {/* Links List */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Chargement...</div>
      ) : links.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <Globe className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Aucun lien de partage créé</p>
          <p className="text-gray-400 text-xs mt-1">
            Créez un lien pour permettre à vos clients de suivre l'avancement du projet
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {links.map(link => (
            <div
              key={link.id}
              className={`bg-white rounded-xl border p-4 transition-all ${
                link.isActive ? 'border-green-200' : 'border-gray-200 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${link.isActive ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <h4 className="font-medium text-gray-800 truncate">{link.label}</h4>
                    {getRoleBadge(link.recipientRole)}
                    {link.pinCode && (
                      <span className="flex items-center gap-0.5 text-xs text-amber-600">
                        <Lock className="w-3 h-3" /> PIN
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                    {link.recipientName && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {link.recipientName}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Eye className="w-3 h-3" /> {link.viewCount} consultation{link.viewCount !== 1 ? 's' : ''}
                      {link.maxViews && ` / ${link.maxViews} max`}
                    </span>
                    {link.expiresAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Expire: {new Date(link.expiresAt).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                    {link.lastAccessedAt && (
                      <span>
                        Dernier accès: {new Date(link.lastAccessedAt).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </div>
                  {/* Permission tags */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries(link.permissions || {}).filter(([, v]) => v).map(([key]) => (
                      <span key={key} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 text-[10px] rounded font-medium">
                        {PERMISSION_LABELS[key] || key}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 ml-3">
                  <button
                    onClick={() => copyLink(link.token, link.id)}
                    className="p-2 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                    title="Copier le lien"
                  >
                    {copiedId === link.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href={`${import.meta.env.BASE_URL}#/portal/${link.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
                    title="Ouvrir le portail"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => handleShowLog(link.id)}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
                    title="Journal d'accès"
                  >
                    <Activity className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleToggle(link.id)}
                    className={`p-2 rounded-lg transition-colors ${
                      link.isActive ? 'hover:bg-amber-50 text-amber-600' : 'hover:bg-green-50 text-green-600'
                    }`}
                    title={link.isActive ? 'Désactiver' : 'Activer'}
                  >
                    {link.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(link.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-red-500 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Access Log */}
              {showLog === link.id && (
                <div className="mt-3 pt-3 border-t">
                  <h5 className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                    <Activity className="w-3 h-3" /> Journal d'accès
                  </h5>
                  {accessLog.length === 0 ? (
                    <p className="text-xs text-gray-400">Aucun accès enregistré</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b">
                            <th className="text-left py-1">Date</th>
                            <th className="text-left py-1">IP</th>
                            <th className="text-left py-1">Section</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accessLog.map(entry => (
                            <tr key={entry.id} className="border-b border-gray-50">
                              <td className="py-1 text-gray-600">
                                {new Date(entry.accessedAt).toLocaleString('fr-FR')}
                              </td>
                              <td className="py-1 text-gray-500 font-mono">{entry.ipAddress}</td>
                              <td className="py-1 text-gray-500">{entry.sectionViewed}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShareLinksPanel;
