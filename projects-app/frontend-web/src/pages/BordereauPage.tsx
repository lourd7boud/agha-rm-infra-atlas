import { FC, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import { useAuthStore } from '../store/authStore';
import {
  ArrowLeft,
  Plus,
  FileText,
  Upload,
  Copy,
  Library,
  AlertCircle,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { logSyncOperation } from '../services/syncService';
import {
  BordereauTable,
  CreateBordereauModal,
  ImportExcelModal,
  TemplateLibraryModal,
  CopyFromProjectModal,
} from '../components/bordereau';
import { isWeb } from '../utils/platform';
import { apiService } from '../services/apiService';

type CreateMode = 'blank' | 'template' | 'copy' | 'import' | null;

// Local interfaces for this page
interface Project {
  id: string;
  objet: string;
  marcheNo: string;
  annee: string;
}

interface Bordereau {
  id: string;
  projectId: string;
  reference: string;
  designation: string;
  lignes: any[];
  montantTotal: number;
  deletedAt?: string;
}

const BordereauPage: FC = () => {

  const { projectId: rawProjectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [createMode, setCreateMode] = useState<CreateMode>(null);
  
  // State for data
  const [project, setProject] = useState<Project | null>(null);
  const [bordereaux, setBordereaux] = useState<Bordereau[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Raw ID without prefix for API calls
  const rawId = rawProjectId?.includes(':') ? rawProjectId.split(':').pop()! : rawProjectId;
  
  // Normalized ID with prefix for navigation
  const projectId = rawProjectId?.includes(':') ? rawProjectId : `project:${rawProjectId}`;

  // Fetch project data
  const fetchProject = useCallback(async () => {
    if (!rawId) return;
    try {
      console.log(`🌐 [BordereauPage] Fetching project ${rawId}...`);
      const response = await apiService.getProject(rawId);
      const data = response.data || response;
      setProject(data);
      console.log(`✅ [BordereauPage] Loaded project`, data);
    } catch (err) {
      console.error(`❌ [BordereauPage] Failed to fetch project:`, err);
    }
  }, [rawId]);

  // Fetch bordereaux data
  const fetchBordereaux = useCallback(async () => {
    if (!rawId) return;
    try {
      console.log(`🌐 [BordereauPage] Fetching bordereaux for ${rawId}...`);
      const response = await apiService.getBordereaux(rawId);
      const data = (response.data || response) as Bordereau[];
      const filtered = data.filter(b => !b.deletedAt);
      setBordereaux(filtered);
      console.log(`✅ [BordereauPage] Loaded ${filtered.length} bordereaux`);
    } catch (err) {
      console.error(`❌ [BordereauPage] Failed to fetch bordereaux:`, err);
    }
  }, [rawId]);

  // Initial load
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchProject(), fetchBordereaux()]);
      setIsLoading(false);
    };
    loadData();
  }, [fetchProject, fetchBordereaux]);

  // Get first bordereau
  const bordereau = bordereaux[0] || null;

  const handleCreateBlank = async (data: { reference: string; designation: string }) => {
    if (!user || !projectId) return;

    const bordereauId = `bordereau:${uuidv4()}`;
    const rawBordereauId = bordereauId.replace('bordereau:', '');
    const now = new Date().toISOString();

    const newBordereau = {
      id: bordereauId,
      projectId: projectId,
      userId: user.id,
      reference: data.reference,
      designation: data.designation,
      lignes: [],
      montantTotal: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (isWeb()) {
      // Web: use API directly
      try {
        console.log('📤 [BordereauPage] Creating bordereau...');
        await apiService.createBordereau({
          projectId: rawId,
          reference: data.reference,
          designation: data.designation,
          lignes: [],
          montantTotal: 0,
        });
        console.log('✅ [BordereauPage] Bordereau created, refreshing...');
        await fetchBordereaux();
        console.log('✅ [BordereauPage] Refresh completed');
      } catch (error) {
        console.error('❌ [BordereauPage] Failed to create bordereau:', error);
        throw error;
      }
    } else {
      // Electron: use IndexedDB + sync
      await db.bordereaux.add(newBordereau);
      await logSyncOperation('CREATE', 'bordereau', rawBordereauId, newBordereau, user.id);
    }

    setCreateMode(null);
  };

  // Show loading only while actually loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Chargement...</p>
        </div>
      </div>
    );
  }

  // Show error if project not found after loading
  if (!project) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
          <p className="text-gray-700 font-medium mb-2">Projet non trouvé</p>
          <p className="text-gray-500 text-sm mb-4">Synchronisez les données ou vérifiez l'URL</p>
          <button onClick={() => navigate('/projects')} className="btn btn-primary">
            Retour aux projets
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          Retour au projet
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Bordereau des Prix</h1>
            <p className="text-gray-600">{project.objet}</p>
            <p className="text-sm text-gray-500">Marché N° {project.marcheNo} - {project.annee}</p>
          </div>
        </div>
      </div>

      {/* Si bordereau existe, l'afficher directement */}
      {bordereau ? (
        <BordereauTable 
          bordereauId={bordereau.id} 
          onClose={() => navigate(`/projects/${projectId}`)} 
          onSaved={() => {
            // Refresh data after bordereau saved
            fetchProject();
            fetchBordereaux();
          }}
        />
      ) : (
        /* Sinon, afficher les options de création */
        <div className="card">
          <div className="text-center py-8 mb-6">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Créer le bordereau</h2>
            <p className="text-gray-600">Choisissez la méthode qui vous convient</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              onClick={() => setCreateMode('blank')}
              className="card hover:shadow-lg transition-all border-2 border-transparent hover:border-primary-500 cursor-pointer"
            >
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Plus className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">Nouveau vide</h3>
                <p className="text-sm text-gray-600">Créer un bordereau depuis zéro</p>
              </div>
            </button>

            <button
              onClick={() => setCreateMode('template')}
              className="card hover:shadow-lg transition-all border-2 border-transparent hover:border-primary-500 cursor-pointer"
            >
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Library className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">Depuis bibliothèque</h3>
                <p className="text-sm text-gray-600">Utiliser des articles prédéfinis</p>
              </div>
            </button>

            <button
              onClick={() => setCreateMode('copy')}
              className="card hover:shadow-lg transition-all border-2 border-transparent hover:border-primary-500 cursor-pointer"
            >
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Copy className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">Copier un projet</h3>
                <p className="text-sm text-gray-600">Dupliquer depuis un projet existant</p>
              </div>
            </button>

            <button
              onClick={() => setCreateMode('import')}
              className="card hover:shadow-lg transition-all border-2 border-transparent hover:border-primary-500 cursor-pointer"
            >
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-lg flex items-center justify-center mx-auto mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">Importer Excel</h3>
                <p className="text-sm text-gray-600">Charger un fichier Excel existant</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {createMode === 'blank' && (
        <CreateBordereauModal
          onClose={() => setCreateMode(null)}
          onCreate={handleCreateBlank}
        />
      )}

      {createMode === 'template' && (
        <TemplateLibraryModal
          projectId={projectId!}
          onClose={() => setCreateMode(null)}
          onCreated={async () => {
            console.log('📥 [BordereauPage] Template created, refreshing...');
            await fetchBordereaux();
            setCreateMode(null);
          }}
        />
      )}

      {createMode === 'copy' && (
        <CopyFromProjectModal
          currentProjectId={projectId!}
          onClose={() => setCreateMode(null)}
          onCopied={async () => {
            console.log('📥 [BordereauPage] Copy created, refreshing...');
            await fetchBordereaux();
            setCreateMode(null);
          }}
        />
      )}

      {createMode === 'import' && (
        <ImportExcelModal
          projectId={projectId!}
          onClose={() => setCreateMode(null)}
          onImported={async () => {
            console.log('📥 [BordereauPage] Import created, refreshing...');
            await fetchBordereaux();
            setCreateMode(null);
          }}
        />
      )}
    </div>
  );
};

export default BordereauPage;
