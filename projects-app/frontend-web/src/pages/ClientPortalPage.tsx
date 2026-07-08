import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Building2, MapPin, Calendar, DollarSign, TrendingUp,
  FileText, Camera, ClipboardList, Shield, Lock,
  AlertTriangle, Clock, BarChart3, Layers,
  FileSignature, Hash, User, Briefcase
} from 'lucide-react';
import { apiService } from '../services/apiService';

// ═══════════════════════════════════════════════════════════════
// Client Portal Page — بوابة العميل
// Public page accessible via shared token link
// ═══════════════════════════════════════════════════════════════

interface PortalData {
  link: {
    label: string;
    recipientName: string | null;
    recipientRole: string;
    permissions: Record<string, boolean>;
  };
  project: {
    objet: string;
    marcheNo: string;
    societe: string;
    commune: string;
    programme: string;
    montant: number;
    delaisExecution: number;
    dateOuverture: string;
    dateOsCommencement: string;
    dateFinTravaux: string;
    statut: string;
    owner: string;
  };
  financialSummary?: {
    montantMarche: number;
    montantCumule: number;
    totalTtc: number;
    nombreDecomptes: number;
    avancementFinancier: string;
  };
  decompts?: any[];
  photos?: any[];
  bordereaux?: any[];
  recentDiary?: any[];
  ods?: any[];
  penaltiesSummary?: { count: string; total: string };
  avenantsSummary?: { count: string; total: string };
}

const ClientPortalPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [requirePin, setRequirePin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [basicInfo, setBasicInfo] = useState<any>(null);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    fetchPortalData();
  }, [token]);

  const fetchPortalData = async (pin?: string) => {
    if (!token) return;
    try {
      setLoading(true);
      setError(null);
      const res = await apiService.getPortalData(token, pin);
      if (res.requirePin) {
        setRequirePin(true);
        setBasicInfo(res.data);
        if (pin) setPinError(true);
      } else {
        setData(res.data);
        setRequirePin(false);
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Lien invalide ou expiré';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(false);
    fetchPortalData(pinInput);
  };

  const formatCurrency = (v: number | string | undefined) => {
    const num = typeof v === 'string' ? parseFloat(v) : (v || 0);
    return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('fr-FR');
  };

  const statusColors: Record<string, string> = {
    en_cours: 'bg-blue-100 text-blue-700',
    termine: 'bg-green-100 text-green-700',
    suspendu: 'bg-amber-100 text-amber-700',
    planifie: 'bg-gray-100 text-gray-700',
  };

  // ─── PIN Screen ───────────────────────────────
  if (requirePin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-1">Accès protégé par PIN</h1>
          <p className="text-sm text-gray-500 mb-1">{basicInfo?.projectName}</p>
          {basicInfo?.recipientName && (
            <p className="text-xs text-gray-400 mb-4">Pour: {basicInfo.recipientName}</p>
          )}
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              value={pinInput}
              onChange={e => { setPinInput(e.target.value); setPinError(false); }}
              placeholder="Entrez le code PIN"
              className={`w-full border-2 rounded-xl px-4 py-3 text-center text-lg tracking-wider focus:ring-2 focus:ring-blue-300 ${
                pinError ? 'border-red-400 bg-red-50' : 'border-gray-200'
              }`}
              autoFocus
              maxLength={8}
            />
            {pinError && (
              <p className="text-red-500 text-sm">Code PIN incorrect</p>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors"
            >
              Accéder au portail
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Loading ───────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Chargement du portail...</p>
        </div>
      </div>
    );
  }

  // ─── Error ───────────────────────────────
  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-red-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Accès non disponible</h1>
          <p className="text-gray-500">{error || 'Lien invalide'}</p>
        </div>
      </div>
    );
  }

  const { project, link, financialSummary } = data;
  const perms = link.permissions || {};

  const sections = [
    { id: 'overview', label: 'Vue d\'ensemble', icon: Building2, show: true },
    { id: 'financials', label: 'Finances', icon: DollarSign, show: perms.financials },
    { id: 'decompts', label: 'Décomptes', icon: FileText, show: perms.decompts && data.decompts },
    { id: 'photos', label: 'Photos', icon: Camera, show: perms.photos && data.photos },
    { id: 'bordereaux', label: 'Bordereaux', icon: Layers, show: perms.bordereaux && data.bordereaux },
    { id: 'diary', label: 'Journal', icon: ClipboardList, show: perms.diary && data.recentDiary },
    { id: 'ods', label: 'ODS', icon: FileSignature, show: perms.ods && data.ods },
  ].filter(s => s.show);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-blue-600 mb-1">
                <Shield className="w-3 h-3" />
                <span>Portail Client BTP</span>
                {link.recipientName && <span>— {link.recipientName}</span>}
              </div>
              <h1 className="text-xl font-bold text-gray-800">{project.objet}</h1>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Hash className="w-3 h-3" /> {project.marcheNo}
                </span>
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {project.societe}
                </span>
                {project.commune && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {project.commune}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[project.statut] || 'bg-gray-100 text-gray-600'}`}>
                {project.statut === 'en_cours' ? 'En cours' : project.statut === 'termine' ? 'Terminé' : project.statut}
              </span>
              {financialSummary && (
                <div className="mt-1 text-sm font-semibold text-blue-700">
                  {financialSummary.avancementFinancier}% avancement
                </div>
              )}
            </div>
          </div>

          {/* Section Tabs */}
          <div className="flex gap-1 mt-4 overflow-x-auto pb-1">
            {sections.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
                  activeSection === s.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <s.icon className="w-4 h-4" />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* OVERVIEW */}
        {activeSection === 'overview' && (
          <div className="space-y-6">
            {/* Project Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <InfoCard
                icon={<DollarSign className="w-5 h-5 text-green-600" />}
                label="Montant du Marché"
                value={`${formatCurrency(project.montant)} DH`}
                bgColor="bg-green-50"
              />
              <InfoCard
                icon={<Calendar className="w-5 h-5 text-blue-600" />}
                label="Délai d'exécution"
                value={`${project.delaisExecution || '—'} mois`}
                bgColor="bg-blue-50"
              />
              <InfoCard
                icon={<User className="w-5 h-5 text-purple-600" />}
                label="Responsable"
                value={project.owner}
                bgColor="bg-purple-50"
              />
            </div>

            {/* Dates */}
            <div className="bg-white rounded-xl p-5 border shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" />
                Dates clés
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <DateItem label="Ouverture des plis" date={project.dateOuverture} />
                <DateItem label="OS de commencement" date={project.dateOsCommencement} />
                <DateItem label="Fin prévue des travaux" date={project.dateFinTravaux} />
              </div>
            </div>

            {/* Financial Progress */}
            {financialSummary && (
              <div className="bg-white rounded-xl p-5 border shadow-sm">
                <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-500" />
                  Avancement financier
                </h3>
                <div className="mb-3">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Progression</span>
                    <span className="font-semibold text-blue-700">
                      {financialSummary.avancementFinancier}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(parseFloat(financialSummary.avancementFinancier), 100)}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                  <MiniStat label="Montant marché" value={`${formatCurrency(financialSummary.montantMarche)} DH`} />
                  <MiniStat label="Montant cumulé" value={`${formatCurrency(financialSummary.montantCumule)} DH`} />
                  <MiniStat label="Total TTC" value={`${formatCurrency(financialSummary.totalTtc)} DH`} />
                  <MiniStat label="Décomptes" value={`${financialSummary.nombreDecomptes}`} />
                </div>
              </div>
            )}

            {/* Avenants & Penalties Summary */}
            {(data.avenantsSummary || data.penaltiesSummary) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.avenantsSummary && (
                  <div className="bg-white rounded-xl p-4 border shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Briefcase className="w-4 h-4 text-purple-500" />
                      <span className="font-medium text-gray-700">Avenants</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-700">{data.avenantsSummary.count}</div>
                    <div className="text-sm text-gray-500">
                      Montant total: {formatCurrency(data.avenantsSummary.total)} DH
                    </div>
                  </div>
                )}
                {data.penaltiesSummary && (
                  <div className="bg-white rounded-xl p-4 border shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                      <span className="font-medium text-gray-700">Pénalités</span>
                    </div>
                    <div className="text-2xl font-bold text-red-600">{data.penaltiesSummary.count}</div>
                    <div className="text-sm text-gray-500">
                      Montant total: {formatCurrency(data.penaltiesSummary.total)} DH
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* FINANCIALS DETAILS */}
        {activeSection === 'financials' && financialSummary && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl p-5 border shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-green-500" />
                Résumé financier
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Montant marché" value={`${formatCurrency(financialSummary.montantMarche)} DH`} color="blue" />
                <StatCard label="Montant cumulé" value={`${formatCurrency(financialSummary.montantCumule)} DH`} color="green" />
                <StatCard label="Total TTC dernier DC" value={`${formatCurrency(financialSummary.totalTtc)} DH`} color="purple" />
                <StatCard label="Avancement" value={`${financialSummary.avancementFinancier}%`} color="amber" />
              </div>
            </div>

            {data.decompts && data.decompts.length > 0 && (
              <div className="bg-white rounded-xl p-5 border shadow-sm">
                <h3 className="font-semibold text-gray-700 mb-3">Historique des décomptes</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-gray-500">
                        <th className="text-left py-2 px-2">N°</th>
                        <th className="text-left py-2 px-2">Date</th>
                        <th className="text-right py-2 px-2">Montant actuel</th>
                        <th className="text-right py-2 px-2">Cumulé</th>
                        <th className="text-right py-2 px-2">TTC</th>
                        <th className="text-center py-2 px-2">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.decompts.map((dc: any, i: number) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 px-2 font-medium">DC-{dc.numero}</td>
                          <td className="py-2 px-2">{formatDate(dc.dateDecompte)}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatCurrency(dc.montantActuel)}</td>
                          <td className="py-2 px-2 text-right font-mono">{formatCurrency(dc.montantCumule)}</td>
                          <td className="py-2 px-2 text-right font-mono font-medium">{formatCurrency(dc.totalTtc)}</td>
                          <td className="py-2 px-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs ${
                              dc.statut === 'valide' ? 'bg-green-100 text-green-700' :
                              dc.statut === 'brouillon' ? 'bg-gray-100 text-gray-600' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {dc.statut}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DECOMPTS */}
        {activeSection === 'decompts' && data.decompts && (
          <div className="bg-white rounded-xl p-5 border shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500" />
              Décomptes ({data.decompts.length})
            </h3>
            <div className="space-y-3">
              {data.decompts.map((dc: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <span className="font-medium">Décompte N°{dc.numero}</span>
                    <span className="text-sm text-gray-500 ml-2">{formatDate(dc.dateDecompte)}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{formatCurrency(dc.totalTtc)} DH TTC</div>
                    <div className="text-xs text-gray-500">Cumulé: {formatCurrency(dc.montantCumule)} DH</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PHOTOS */}
        {activeSection === 'photos' && data.photos && (
          <div className="bg-white rounded-xl p-5 border shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Camera className="w-4 h-4 text-pink-500" />
              Photos du chantier ({data.photos.length})
            </h3>
            {data.photos.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">Aucune photo disponible</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {data.photos.map((photo: any) => (
                  <div key={photo.id} className="rounded-xl overflow-hidden border group">
                    <div className="aspect-square bg-gray-100 flex items-center justify-center">
                      <Camera className="w-8 h-8 text-gray-300" />
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium text-gray-700 truncate">{photo.originalName || photo.description || 'Photo'}</p>
                      <p className="text-[10px] text-gray-400">{formatDate(photo.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* BORDEREAUX */}
        {activeSection === 'bordereaux' && data.bordereaux && (
          <div className="bg-white rounded-xl p-5 border shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-500" />
              Bordereaux de prix ({data.bordereaux.length})
            </h3>
            <div className="space-y-2">
              {data.bordereaux.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <span className="font-medium text-gray-700">{b.titre}</span>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatCurrency(b.totalHt)} DH HT</div>
                    <div className="text-xs text-gray-500">{b.nombreLignes} lignes</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DIARY */}
        {activeSection === 'diary' && data.recentDiary && (
          <div className="bg-white rounded-xl p-5 border shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-teal-500" />
              Journal de chantier (10 dernières entrées)
            </h3>
            <div className="space-y-2">
              {data.recentDiary.map((entry: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <span className="font-medium">Entrée N°{entry.entryNumber}</span>
                    <span className="text-sm text-gray-500 ml-2">{formatDate(entry.entryDate)}</span>
                    {entry.weather && (
                      <span className="ml-2 text-xs text-gray-400">{entry.weather}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>Propre: {entry.workforceOwn || 0}</span>
                    <span>Sous-trait: {entry.workforceSubcontractor || 0}</span>
                    <span className={`px-2 py-0.5 rounded-full ${
                      entry.statut === 'valide' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {entry.statut}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ODS */}
        {activeSection === 'ods' && data.ods && (
          <div className="bg-white rounded-xl p-5 border shadow-sm">
            <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-orange-500" />
              Ordres de Service ({data.ods.length})
            </h3>
            <div className="space-y-2">
              {data.ods.map((ods: any, i: number) => {
                const typeLabels: Record<string, string> = {
                  commencement: 'Commencement',
                  arret: 'Arrêt',
                  reprise: 'Reprise',
                  modification: 'Modification',
                  travaux_supplementaires: 'Travaux Suppl.',
                  prolongation: 'Prolongation',
                  reception_provisoire: 'Réception Prov.',
                  reception_definitive: 'Réception Déf.',
                  mise_en_demeure: 'Mise en Demeure',
                  autre: 'Autre',
                };
                return (
                  <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <span className="font-medium">{ods.reference || `ODS-${ods.numero}`}</span>
                      <span className="ml-2 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
                        {typeLabels[ods.type] || ods.type}
                      </span>
                      <p className="text-sm text-gray-500 mt-0.5">{ods.objet}</p>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        ods.statut === 'cloture' ? 'bg-green-100 text-green-700' :
                        ods.statut === 'execute' ? 'bg-blue-100 text-blue-700' :
                        ods.statut === 'annule' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {ods.statut}
                      </span>
                      {ods.dateEmission && (
                        <div className="text-xs text-gray-400 mt-1">{formatDate(ods.dateEmission)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-white mt-8">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center text-xs text-gray-400">
          <p>Portail Client BTP — Accès en lecture seule</p>
          <p className="mt-1">Ce lien vous a été partagé par le responsable du projet</p>
        </div>
      </footer>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────

const InfoCard: React.FC<{ icon: React.ReactNode; label: string; value: string; bgColor: string }> = ({ icon, label, value, bgColor }) => (
  <div className={`${bgColor} rounded-xl p-4 border`}>
    <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-gray-500">{label}</span></div>
    <div className="text-lg font-bold text-gray-800">{value}</div>
  </div>
);

const DateItem: React.FC<{ label: string; date: string | null }> = ({ label, date }) => (
  <div className="flex items-start gap-2">
    <Clock className="w-4 h-4 text-gray-400 mt-0.5" />
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium text-gray-700">{date ? new Date(date).toLocaleDateString('fr-FR') : '—'}</p>
    </div>
  </div>
);

const MiniStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="text-center">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="font-semibold text-gray-700 text-sm">{value}</div>
  </div>
);

const StatCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    purple: 'bg-purple-50 border-purple-200',
    amber: 'bg-amber-50 border-amber-200',
  };
  return (
    <div className={`${colors[color] || 'bg-gray-50 border-gray-200'} rounded-xl p-3 border`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-bold text-gray-800 mt-1">{value}</div>
    </div>
  );
};

export default ClientPortalPage;
