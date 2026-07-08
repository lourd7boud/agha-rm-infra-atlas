import { FC, useState, useMemo, useEffect } from 'react';
import { db } from '../db/database';
import { useAuthStore } from '../store/authStore';
import { logSyncOperation } from '../services/syncService';
import { apiService } from '../services/apiService';
import { Trash2, RotateCcw, AlertCircle, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { isWeb } from '../utils/platform';

const TrashPage: FC = () => {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [deletedProjects, setDeletedProjects] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Normaliser l'ID utilisateur pour la recherche
  const userIdVariants = useMemo(() => {
    if (!user?.id) return [];
    const cleanId = user.id.includes(':') ? user.id.split(':').pop()! : user.id;
    return [cleanId, `user:${cleanId}`];
  }, [user?.id]);

  // Charger les projets supprimés
  useEffect(() => {
    const loadDeletedProjects = async () => {
      if (!user?.id) {
        setDeletedProjects([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        if (isWeb()) {
          // 🌐 Web: charger depuis le serveur
          const response = await apiService.getDeletedProjects();
          setDeletedProjects(response.data || response || []);
        } else {
          // 🖥️ Electron: charger depuis IndexedDB
          const allProjects = await db.projects.filter(p => !!p.deletedAt).toArray();
          const filtered = allProjects.filter(p => userIdVariants.includes(p.userId));
          setDeletedProjects(filtered);
        }
      } catch (error) {
        console.error('Error loading deleted projects:', error);
        setDeletedProjects([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadDeletedProjects();
  }, [user?.id, userIdVariants]);

  const handleRestore = async (projectId: string) => {
    if (!user) return;

    setLoading(projectId);
    try {
      if (isWeb()) {
        // 🌐 Web: API directe
        await apiService.restoreProject(projectId.replace('project:', ''));
        // Recharger la liste
        const response = await apiService.getDeletedProjects();
        setDeletedProjects(response.data || response || []);
      } else {
        // 🖥️ Electron: IndexedDB + sync
        await apiService.restoreProject(projectId);
        await db.projects.update(projectId, {
          deletedAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        await logSyncOperation('UPDATE', 'project', projectId, { deletedAt: null }, user.id);
        // Recharger la liste
        const allProjects = await db.projects.filter(p => !!p.deletedAt).toArray();
        setDeletedProjects(allProjects.filter(p => userIdVariants.includes(p.userId)));
      }
    } catch (error) {
      console.error('Error restoring project:', error);
      alert('فشل في استعادة المشروع');
    } finally {
      setLoading(null);
    }
  };

  const handlePermanentDelete = async (projectId: string) => {
    if (!user || !confirm('هل أنت متأكد من الحذف النهائي؟ لا يمكن التراجع عن هذا الإجراء!')) return;

    setLoading(projectId);
    try {
      if (isWeb()) {
        // 🌐 Web: API directe
        await apiService.permanentDeleteProject(projectId.replace('project:', ''));
        // Recharger la liste
        const response = await apiService.getDeletedProjects();
        setDeletedProjects(response.data || response || []);
      } else {
        // 🖥️ Electron: IndexedDB
        await db.projects.delete(projectId);
        // Recharger la liste
        const allProjects = await db.projects.filter(p => !!p.deletedAt).toArray();
        setDeletedProjects(allProjects.filter(p => userIdVariants.includes(p.userId)));
      }
    } catch (error) {
      console.error('Error deleting project permanently:', error);
      alert('فشل في حذف المشروع نهائياً');
    } finally {
      setLoading(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-red-100 rounded-lg">
            <Trash2 className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">سلة المحذوفات</h1>
            <p className="text-sm text-gray-500">المشاريع المحذوفة مؤقتاً</p>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-medium">المشاريع المحذوفة يمكن استعادتها</p>
          <p className="mt-1">يمكنك استعادة أي مشروع محذوف أو حذفه نهائياً. المشاريع المحذوفة نهائياً لا يمكن استعادتها.</p>
        </div>
      </div>

      {/* Deleted Projects List */}
      {deletedProjects.length === 0 ? (
        <div className="text-center py-12">
          <Trash2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">سلة المحذوفات فارغة</h3>
          <p className="text-gray-500">لا توجد مشاريع محذوفة</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">المشروع</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">رقم السوق</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">السنة</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-700">تاريخ الحذف</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-gray-700">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {deletedProjects.map((project) => (
                  <tr key={project.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4">
                      <div className="font-medium text-gray-900">{project.objet}</div>
                      {project.societe && (
                        <div className="text-xs text-gray-500">{project.societe}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{project.marcheNo}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{project.annee}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        {project.deletedAt ? format(new Date(project.deletedAt), 'dd/MM/yyyy HH:mm') : '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleRestore(project.id)}
                          disabled={loading === project.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                          title="استعادة"
                        >
                          <RotateCcw className="w-4 h-4" />
                          استعادة
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(project.id)}
                          disabled={loading === project.id}
                          className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                          title="حذف نهائي"
                        >
                          <Trash2 className="w-4 h-4" />
                          حذف نهائي
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrashPage;
