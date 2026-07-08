import { FC, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Save } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { db, Company } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import { useProject, useCanModify } from '../hooks/useUnifiedData';
import { saveCompany, extractCompanyFromProject } from '../services/companyService';
import CompanyAutocomplete from '../components/CompanyAutocomplete';
import IntervenantAutocomplete from '../components/IntervenantAutocomplete';
import { isWeb } from '../utils/platform';
import { apiService } from '../services/apiService';
import PriceRevisionFormulaEditor, { RevisionFormulaData } from '../components/project/PriceRevisionFormulaEditor';
import DateInput from '../components/ui/DateInput';

const EditProjectPage: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { canModify, reason: cannotModifyReason } = useCanModify();

  // استخدام useProject بدلاً من useLiveQuery
  const rawId = id?.startsWith('project:') ? id.replace('project:', '') : id;
  const { project, isLoading: projectLoading } = useProject(rawId || null);
  const [revisionFormula, setRevisionFormula] = useState<RevisionFormulaData | null>(null);

  const [formData, setFormData] = useState({
    objet: '',
    marcheNo: '',
    annee: '',
    dateOuverture: '',
    typeMarche: 'normal' as 'normal' | 'negocie',
    commune: '',
    // Informations entreprise
    societe: '',
    rc: '',
    cb: '',
    cnss: '',
    patente: '',
    // Informations projet supplémentaires
    programme: '',
    projet: '',
    ligne: '',
    chapitre: '',
    delaisExecution: '',
    status: 'draft' as 'draft' | 'active' | 'completed' | 'archived',
    // Intervenants du projet
    assistanceTechnique: '',
    maitreOeuvre: '',
    // Gestion des délais
    osc: '', // Ordre de Service de Commencement (date début travaux)
    dateReceptionProvisoire: '', // Date réception provisoire
    dateReceptionDefinitive: '', // Date réception définitive
  });

  // Helper to extract date part (YYYY-MM-DD) from ISO string or date
  const formatDateForInput = (dateStr: string | undefined | null): string => {
    if (!dateStr) return '';
    // If it's already YYYY-MM-DD format, return as is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // Extract YYYY-MM-DD from ISO string
    return dateStr.split('T')[0];
  };

  // Charger les données du projet
  useEffect(() => {
    if (project) {
      setFormData({
        objet: project.objet || '',
        marcheNo: project.marcheNo || '',
        annee: project.annee || '',
        dateOuverture: formatDateForInput(project.dateOuverture),
        typeMarche: project.typeMarche || 'normal',
        commune: project.commune || '',
        societe: project.societe || '',
        rc: project.rc || '',
        cb: project.cb || '',
        cnss: project.cnss || '',
        patente: project.patente || '',
        programme: project.programme || '',
        projet: project.projet || '',
        ligne: project.ligne || '',
        chapitre: project.chapitre || '',
        delaisExecution: project.delaisExecution?.toString() || '',
        status: project.status || 'draft',
        // Intervenants du projet
        assistanceTechnique: project.assistanceTechnique || '',
        maitreOeuvre: project.maitreOeuvre || '',
        // Gestion des délais
        osc: formatDateForInput(project.osc),
        dateReceptionProvisoire: formatDateForInput(project.dateReceptionProvisoire),
        dateReceptionDefinitive: formatDateForInput(project.dateReceptionDefinitive),
      });

      // Charger la config de révision si web
      if (isWeb() && rawId) {
        apiService.get(`/projects/${rawId}/revision-config`)
          .then((config: any) => {
            if (config && config.formula) {
              const weights = Object.entries(config.formula.weights || {}).map(([code, weight]) => ({
                indexCode: code,
                indexName: code, // Will be enriched from catalog
                weight: weight as number
              }));
              setRevisionFormula({
                name: config.formula.name || 'Formule de révision',
                fixedPart: config.formula.fixedPart || 0.15,
                weights
              });
            }
          })
          .catch(() => {
            // Pas de config existante, c'est OK
          });
      }
    }
  }, [project, rawId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !project) return;
    
    if (!canModify) {
      setError(cannotModifyReason || 'Vous devez être connecté pour modifier un projet');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const now = new Date().toISOString();

      const updatedProjectData = {
        objet: formData.objet,
        marcheNo: formData.marcheNo,
        annee: formData.annee,
        dateOuverture: formData.dateOuverture,
        typeMarche: formData.typeMarche,
        commune: formData.commune || undefined,
        // Informations entreprise
        societe: formData.societe,
        rc: formData.rc,
        cb: formData.cb,
        cnss: formData.cnss,
        patente: formData.patente,
        // Informations projet
        programme: formData.programme,
        projet: formData.projet,
        ligne: formData.ligne,
        chapitre: formData.chapitre,
        delaisExecution: formData.delaisExecution ? parseInt(formData.delaisExecution) : undefined,
        status: formData.status,
        // Intervenants du projet
        assistanceTechnique: formData.assistanceTechnique || undefined,
        maitreOeuvre: formData.maitreOeuvre || undefined,
        // Gestion des délais
        osc: formData.osc || undefined,
        dateReceptionProvisoire: formData.dateReceptionProvisoire || undefined,
        dateReceptionDefinitive: formData.dateReceptionDefinitive || undefined,
        folderPath: `${formData.annee}/${formData.marcheNo}`,
      };

      // 🌐 Web: تحديث عبر API
      if (isWeb()) {
        await apiService.updateProject(rawId!, updatedProjectData);
        console.log('✅ [WEB] Projet modifié via API');
        
        // Sauvegarder/mettre à jour la config de révision
        if (revisionFormula) {
          try {
            await apiService.post(`/projects/${rawId}/revision-config`, {
              formula: {
                name: revisionFormula.name,
                fixedPart: revisionFormula.fixedPart,
                weights: revisionFormula.weights.reduce((acc, w) => {
                  acc[w.indexCode] = w.weight;
                  return acc;
                }, {} as Record<string, number>)
              },
              baseDate: formData.dateOuverture
            });
            console.log('✅ [WEB] Config révision mise à jour');
          } catch (revErr) {
            console.warn('⚠️ Erreur mise à jour config révision:', revErr);
          }
        } else {
          // Supprimer la config si désactivée
          try {
            await apiService.delete(`/projects/${rawId}/revision-config`);
          } catch {
            // Pas de config à supprimer
          }
        }
        
        navigate(`/projects/${rawId}`);
        return;
      }

      // 🖥️ Electron: تحديث محلي مع sync
      const updatedProject = {
        ...project,
        ...updatedProjectData,
        updatedAt: now,
      };

      // تحديث في IndexedDB
      await db.projects.update(project.id, updatedProject);

      // Sauvegarder les informations de l'entreprise pour l'autocomplétion future
      const companyData = extractCompanyFromProject(formData);
      if (companyData) {
        try {
          await saveCompany(user.id, companyData);
          console.log('✅ Entreprise sauvegardée pour autocomplétion:', companyData.nom);
        } catch (companyError) {
          console.warn('⚠️ Impossible de sauvegarder l\'entreprise:', companyError);
        }
      }

      // إنشاء عملية sync
      await db.syncOperations.add({
        id: `sync:${uuidv4()}`,
        userId: user.id,
        deviceId: localStorage.getItem('deviceId') || 'device-001',
        type: 'UPDATE',
        entity: 'project',
        entityId: project.id,
        data: updatedProject,
        timestamp: Date.now(),
        synced: false,
      });

      console.log('✅ Projet modifié avec succès:', updatedProject);
      navigate(`/projects/${id}`);
    } catch (err: any) {
      console.error('❌ Erreur modification projet:', err);
      setError(err.message || 'Erreur lors de la modification du projet');
    } finally {
      setIsLoading(false);
    }
  };

  if (!project && !projectLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-gray-500">{isWeb() ? 'Projet non trouvé sur le serveur' : 'Projet non trouvé'}</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>{t('common.back')}</span>
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Modifier le projet</h1>
        <p className="text-gray-600 mt-2">Modifiez les informations du projet "{project.objet}"</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="card space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Informations générales */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informations générales
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type de marché *
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="typeMarche"
                    value="normal"
                    checked={formData.typeMarche === 'normal'}
                    onChange={(e) => setFormData({ ...formData, typeMarche: e.target.value as 'normal' | 'negocie' })}
                    className="w-4 h-4 text-primary-600"
                  />
                  <span className="text-gray-700">Marché Normal</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="typeMarche"
                    value="negocie"
                    checked={formData.typeMarche === 'negocie'}
                    onChange={(e) => setFormData({ ...formData, typeMarche: e.target.value as 'normal' | 'negocie' })}
                    className="w-4 h-4 text-primary-600"
                  />
                  <span className="text-gray-700">Marché Négocié</span>
                </label>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Objet du marché *
              </label>
              <input
                type="text"
                required
                className="input"
                value={formData.objet}
                onChange={(e) => setFormData({ ...formData, objet: e.target.value })}
                placeholder="Ex: Construction d'un bâtiment..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                N° Marché *
              </label>
              <input
                type="text"
                required
                className="input"
                value={formData.marcheNo}
                onChange={(e) => setFormData({ ...formData, marcheNo: e.target.value })}
                placeholder="Ex: 123/2025"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Année *
              </label>
              <input
                type="text"
                required
                className="input"
                value={formData.annee}
                onChange={(e) => setFormData({ ...formData, annee: e.target.value })}
                placeholder="2025"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Commune (CT)
              </label>
              <select
                className="input"
                value={formData.commune}
                onChange={(e) => setFormData({ ...formData, commune: e.target.value })}
              >
                <option value="">-- Sélectionner une commune --</option>
                <optgroup label="Municipalités (communes urbaines)">
                  <option value="Akka">Akka</option>
                  <option value="Fam El Hisn">Fam El Hisn</option>
                  <option value="Foum Zguid">Foum Zguid</option>
                  <option value="Tata">Tata</option>
                </optgroup>
                <optgroup label="Communes Rurales - Cercle d'Akka">
                  <option value="Ait Ouabelli">Ait Ouabelli</option>
                  <option value="Kasbat Sidi Abdellah Ben Mbarek">Kasbat Sidi Abdellah Ben Mbarek</option>
                  <option value="Tamanarte">Tamanarte</option>
                  <option value="Tizounine">Tizounine</option>
                </optgroup>
                <optgroup label="Communes Rurales - Cercle de Foum Zguid">
                  <option value="Aguinane">Aguinane</option>
                  <option value="Akka Ighane">Akka Ighane</option>
                  <option value="Allougoum">Allougoum</option>
                  <option value="Ibn Yacoub">Ibn Yacoub</option>
                  <option value="Tissint">Tissint</option>
                  <option value="Tlite">Tlite</option>
                </optgroup>
                <optgroup label="Communes Rurales - Cercle de Tata">
                  <option value="Adis">Adis</option>
                  <option value="Issafen">Issafen</option>
                  <option value="Oum El Guerdane">Oum El Guerdane</option>
                  <option value="Tagmout">Tagmout</option>
                  <option value="Tigzmerte">Tigzmerte</option>
                  <option value="Tizaghte">Tizaghte</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Statut *
              </label>
              <select
                required
                className="input"
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value as any })
                }
              >
                <option value="draft">Brouillon</option>
                <option value="active">Actif</option>
                <option value="completed">Terminé</option>
                <option value="archived">Archivé</option>
              </select>
            </div>
          </div>
        </div>

        {/* Informations entreprise */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informations de l'entreprise
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Société
              </label>
              <CompanyAutocomplete
                userId={user?.id || ''}
                value={formData.societe}
                onChange={(value) => setFormData({ ...formData, societe: value })}
                onSelect={(company: Company) => {
                  // Remplir automatiquement les champs avec les données de l'entreprise
                  setFormData(prev => ({
                    ...prev,
                    societe: company.nom,
                    rc: company.rc || prev.rc,
                    cb: company.cb || prev.cb,
                    cnss: company.cnss || prev.cnss,
                    patente: company.patente || prev.patente,
                  }));
                }}
                placeholder="Ex: SOUS ISKE TRAVAUX DIVERS(SARL)"
              />
              <p className="mt-1 text-xs text-gray-500">
                💡 Commencez à taper pour voir les entreprises enregistrées
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                R.C. n° (Registre de Commerce)
              </label>
              <input
                type="text"
                className="input"
                value={formData.rc}
                onChange={(e) => setFormData({ ...formData, rc: e.target.value })}
                placeholder="Ex: 217/2021"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                C.B n° (Compte Bancaire)
              </label>
              <input
                type="text"
                className="input"
                value={formData.cb}
                onChange={(e) => setFormData({ ...formData, cb: e.target.value })}
                placeholder="Ex: 007550604987600000228218"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                C.N.S.S. n° (Sécurité Sociale)
              </label>
              <input
                type="text"
                className="input"
                value={formData.cnss}
                onChange={(e) => setFormData({ ...formData, cnss: e.target.value })}
                placeholder="Ex: 4444634"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Patente
              </label>
              <input
                type="text"
                className="input"
                value={formData.patente}
                onChange={(e) => setFormData({ ...formData, patente: e.target.value })}
                placeholder="Ex: 47730296"
              />
            </div>
          </div>
        </div>

        {/* Informations budgétaires et administratives */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Informations budgétaires et délais
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Programme
              </label>
              <input
                type="text"
                className="input"
                value={formData.programme}
                onChange={(e) => setFormData({ ...formData, programme: e.target.value })}
                placeholder="Ex: 31000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Projet
              </label>
              <input
                type="text"
                className="input"
                value={formData.projet}
                onChange={(e) => setFormData({ ...formData, projet: e.target.value })}
                placeholder="Ex: 47/2025/DPA/TA"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ligne
              </label>
              <input
                type="text"
                className="input"
                value={formData.ligne}
                onChange={(e) => setFormData({ ...formData, ligne: e.target.value })}
                placeholder="Ex: 24"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Chapitre
              </label>
              <input
                type="text"
                className="input"
                value={formData.chapitre}
                onChange={(e) => setFormData({ ...formData, chapitre: e.target.value })}
                placeholder="Ex: 320010/03012"
              />
            </div>

          </div>
        </div>

        {/* Intervenants du projet */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Intervenants du projet
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <IntervenantAutocomplete
              type="assistanceTechnique"
              value={formData.assistanceTechnique}
              onChange={(value) => setFormData({ ...formData, assistanceTechnique: value })}
              label="L'ASSISTANCE TECHNIQUE"
              placeholder="Ex: Bureau d'études XYZ"
              helpText="💡 Commencez à taper pour voir les suggestions"
            />

            <IntervenantAutocomplete
              type="maitreOeuvre"
              value={formData.maitreOeuvre}
              onChange={(value) => setFormData({ ...formData, maitreOeuvre: value })}
              label="Le Maître d'Oeuvre"
              placeholder="Ex: DPA de Tata"
              helpText="💡 Commencez à taper pour voir les suggestions"
            />
          </div>
        </div>

        {/* Gestion des délais */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Gestion des délais
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date d'ouverture
              </label>
              <DateInput
                className="input"
                value={formData.dateOuverture}
                onChange={(val) => setFormData({ ...formData, dateOuverture: val })}
              />
              <p className="text-xs text-gray-500 mt-1">Date d'ouverture des plis</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Délais d'exécution (mois)
              </label>
              <input
                type="number"
                className="input"
                value={formData.delaisExecution}
                onChange={(e) => setFormData({ ...formData, delaisExecution: e.target.value })}
                placeholder="Ex: 10"
                min="1"
              />
              <p className="text-xs text-gray-500 mt-1">Durée du marché en mois</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                O.S.C (Date début des travaux)
              </label>
              <DateInput
                className="input"
                value={formData.osc}
                onChange={(val) => setFormData({ ...formData, osc: val })}
              />
              <p className="text-xs text-gray-500 mt-1">Ordre de Service de Commencement</p>
            </div>
          </div>
        </div>

        {/* Formule de Révision des Prix */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Révision des Prix
          </h2>
          <PriceRevisionFormulaEditor
            value={revisionFormula}
            onChange={setRevisionFormula}
            dateOuverture={formData.dateOuverture}
          />
          {revisionFormula && (
            <p className="text-xs text-gray-500 mt-2">
              Les index de base (X₀) seront automatiquement récupérés depuis le mois de la date d'ouverture.
              Les calculs de révision seront appliqués automatiquement dans chaque décompte.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-4 pt-4 border-t">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn btn-secondary"
            disabled={isLoading}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="btn btn-primary flex items-center gap-2"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Enregistrement...</span>
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                <span>Enregistrer les modifications</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditProjectPage;
