import { FC, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, MetreLigne } from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  Download,
  TrendingUp,
} from 'lucide-react';

import { toDecimal, round2, toNumber } from '../../utils/financeEngine';

// 🔒 تقريب الكميات لرقمين - ROUND_HALF_UP via Decimal.js
// ⚠️ Math.round(x*100)/100 يُسبب أخطاء (مثل 2.675 → 2.67 بدل 2.68)
const roundQuantity = (value: number): number => {
  return toNumber(round2(toDecimal(value)));
};
import { v4 as uuidv4 } from 'uuid';
import { logSyncOperation } from '../../services/syncService';
import {
  getCalculationType,
  calculatePartiel,
  formatNumber,
  calculatePourcentage,
} from '../../utils/metreCalculations';
import MetreLigneEditor from './MetreLigneEditor';

interface MetreTableProps {
  metreId: string;
  onClose: () => void;
}

const MetreTable: FC<MetreTableProps> = ({ metreId, onClose }) => {
  const { user } = useAuthStore();
  const [editingLigneId, setEditingLigneId] = useState<string | null>(null);
  const [isAddingLigne, setIsAddingLigne] = useState(false);

  const metre = useLiveQuery(() => db.metres.get(metreId), [metreId]);

  const calculationType = metre
    ? getCalculationType(metre.unite)
    : null;

  const handleAddLigne = async (newLigne: Omit<MetreLigne, 'id' | 'numero'>) => {
    if (!metre || !user) return;

    const ligneId = `ligne:${uuidv4()}`;
    const numero = metre.lignes.length + 1;

    // Calculer le partiel
    const partiel = calculatePartiel(
      metre.unite as any,
      newLigne.longueur,
      newLigne.largeur,
      newLigne.profondeur,
      newLigne.nombre,
      newLigne.diametre
    );

    const ligneToAdd: MetreLigne = {
      ...newLigne,
      id: ligneId,
      numero,
      partiel,
    };

    const updatedLignes = [...metre.lignes, ligneToAdd];
    // ⚠️ تقريب المجموع لرقمين - هذا الرقم سيُستخدم في الديكونت
    const totalPartiel = roundQuantity(updatedLignes.reduce((sum, l) => sum + l.partiel, 0));

    // Récupérer tous les métrés de la même ligne de bordereau pour calculer le cumulé
    const allMetresForLigne = await db.metres
      .where('bordereauLigneId')
      .equals(metre.bordereauLigneId)
      .and((m) => !m.deletedAt)
      .toArray();

    // ⚠️ تقريب الكميلي أيضاً
    const totalCumule = roundQuantity(
      allMetresForLigne
        .filter((m) => m.id !== metreId)
        .reduce((sum, m) => sum + m.totalCumule, 0) + totalPartiel
    );

    const pourcentageRealisation = calculatePourcentage(totalCumule, metre.quantiteBordereau);

    await db.metres.update(metreId, {
      lignes: updatedLignes,
      totalPartiel,
      totalCumule,
      pourcentageRealisation,
      updatedAt: new Date().toISOString(),
    });

    await logSyncOperation('UPDATE', 'metre', metreId.replace('metre:', ''), { lignes: updatedLignes }, user.id);

    setIsAddingLigne(false);
  };

  const handleUpdateLigne = async (ligneId: string, updates: Partial<MetreLigne>) => {
    if (!metre || !user) return;

    const updatedLignes = metre.lignes.map((l) => {
      if (l.id !== ligneId) return l;

      const updated = { ...l, ...updates };
      const partiel = calculatePartiel(
        metre.unite as any,
        updated.longueur,
        updated.largeur,
        updated.profondeur,
        updated.nombre,
        updated.diametre
      );

      return { ...updated, partiel };
    });

    // ⚠️ تقريب المجموع لرقمين
    const totalPartiel = roundQuantity(updatedLignes.reduce((sum, l) => sum + l.partiel, 0));

    const allMetresForLigne = await db.metres
      .where('bordereauLigneId')
      .equals(metre.bordereauLigneId)
      .and((m) => !m.deletedAt)
      .toArray();

    // ⚠️ تقريب الكميلي أيضاً
    const totalCumule = roundQuantity(
      allMetresForLigne
        .filter((m) => m.id !== metreId)
        .reduce((sum, m) => sum + m.totalCumule, 0) + totalPartiel
    );

    const pourcentageRealisation = calculatePourcentage(totalCumule, metre.quantiteBordereau);

    await db.metres.update(metreId, {
      lignes: updatedLignes,
      totalPartiel,
      totalCumule,
      pourcentageRealisation,
      updatedAt: new Date().toISOString(),
    });

    await logSyncOperation('UPDATE', 'metre', metreId.replace('metre:', ''), { lignes: updatedLignes }, user.id);

    setEditingLigneId(null);
  };

  const handleDeleteLigne = async (ligneId: string) => {
    if (!metre || !user) return;
    if (!confirm('Supprimer cette ligne ?')) return;

    const updatedLignes = metre.lignes.filter((l) => l.id !== ligneId);
    // ⚠️ تقريب المجموع لرقمين
    const totalPartiel = roundQuantity(updatedLignes.reduce((sum, l) => sum + l.partiel, 0));

    const allMetresForLigne = await db.metres
      .where('bordereauLigneId')
      .equals(metre.bordereauLigneId)
      .and((m) => !m.deletedAt)
      .toArray();

    // ⚠️ تقريب الكميلي أيضاً
    const totalCumule = roundQuantity(
      allMetresForLigne
        .filter((m) => m.id !== metreId)
        .reduce((sum, m) => sum + m.totalCumule, 0) + totalPartiel
    );

    const pourcentageRealisation = calculatePourcentage(totalCumule, metre.quantiteBordereau);

    await db.metres.update(metreId, {
      lignes: updatedLignes,
      totalPartiel,
      totalCumule,
      pourcentageRealisation,
      updatedAt: new Date().toISOString(),
    });

    await logSyncOperation('UPDATE', 'metre', metreId.replace('metre:', ''), { lignes: updatedLignes }, user.id);
  };

  if (!metre || !calculationType) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Chargement...</p>
        </div>
      </div>
    );
  }

  const { champs } = calculationType;

  return (
    <div className="card">
      {/* Header */}
      <div className="border-b border-gray-200 pb-4 mb-4">
        <button
          onClick={onClose}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className="w-5 h-5" />
          Retour à la liste
        </button>

        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-gray-900">{metre.reference}</h2>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm font-medium">
                {metre.unite}
              </span>
            </div>
            <p className="text-gray-700 mb-1">{metre.designationBordereau}</p>
            <p className="text-sm text-gray-500">Quantité bordereau: {formatNumber(metre.quantiteBordereau)} {metre.unite}</p>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" />
              Exporter
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-blue-50 p-3 rounded-lg">
            <p className="text-xs text-blue-600 mb-1">Total Partiel</p>
            <p className="text-xl font-bold text-blue-700">{formatNumber(metre.totalPartiel)}</p>
          </div>
          <div className="bg-purple-50 p-3 rounded-lg">
            <p className="text-xs text-purple-600 mb-1">Total Cumulé</p>
            <p className="text-xl font-bold text-purple-700">{formatNumber(metre.totalCumule)}</p>
          </div>
          <div className="bg-green-50 p-3 rounded-lg">
            <p className="text-xs text-green-600 mb-1">% Réalisation</p>
            <p className="text-xl font-bold text-green-700">{formatNumber(metre.pourcentageRealisation)}%</p>
          </div>
          <div className="bg-orange-50 p-3 rounded-lg">
            <p className="text-xs text-orange-600 mb-1">Reste à faire</p>
            <p className="text-xl font-bold text-orange-700">
              {formatNumber(Math.max(0, metre.quantiteBordereau - metre.totalCumule))}
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full">
          <thead className="bg-gray-50 border-b-2 border-gray-200">
            <tr>
              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-700 w-12">N°</th>
              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-700 min-w-[200px]">
                Désignation
              </th>
              {champs.includes('longueur') && (
                <th className="px-3 py-3 text-right text-sm font-semibold text-gray-700 w-24">
                  Longueur (m)
                </th>
              )}
              {champs.includes('largeur') && (
                <th className="px-3 py-3 text-right text-sm font-semibold text-gray-700 w-24">
                  Largeur (m)
                </th>
              )}
              {champs.includes('profondeur') && (
                <th className="px-3 py-3 text-right text-sm font-semibold text-gray-700 w-24">
                  Profondeur (m)
                </th>
              )}
              {champs.includes('nombre') && (
                <th className="px-3 py-3 text-right text-sm font-semibold text-gray-700 w-24">Nombre</th>
              )}
              {champs.includes('diametre') && (
                <th className="px-3 py-3 text-center text-sm font-semibold text-gray-700 w-24">Ø (mm)</th>
              )}
              <th className="px-3 py-3 text-right text-sm font-semibold text-gray-700 w-32 bg-blue-50">
                Partiel
              </th>
              <th className="px-3 py-3 text-left text-sm font-semibold text-gray-700 min-w-[150px]">
                Observations
              </th>
              <th className="px-3 py-3 text-center text-sm font-semibold text-gray-700 w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {metre.lignes.map((ligne) => (
              <tr key={ligne.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-700">{ligne.numero}</td>
                <td className="px-3 py-2 text-gray-900">{ligne.designation}</td>
                {champs.includes('longueur') && (
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(ligne.longueur || 0)}</td>
                )}
                {champs.includes('largeur') && (
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(ligne.largeur || 0)}</td>
                )}
                {champs.includes('profondeur') && (
                  <td className="px-3 py-2 text-right font-mono">{formatNumber(ligne.profondeur || 0)}</td>
                )}
                {champs.includes('nombre') && (
                  <td className="px-3 py-2 text-right font-mono">{ligne.nombre || 0}</td>
                )}
                {champs.includes('diametre') && (
                  <td className="px-3 py-2 text-center">
                    {ligne.diametre ? `Ø${ligne.diametre}` : '-'}
                  </td>
                )}
                <td className="px-3 py-2 text-right font-bold text-blue-600 bg-blue-50">
                  {formatNumber(ligne.partiel)}
                </td>
                <td className="px-3 py-2 text-gray-600 text-sm">{ligne.observations || '-'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => setEditingLigneId(ligne.id)}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Modifier"
                    >
                      <Save className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteLigne(ligne.id)}
                      className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {metre.lignes.length === 0 && (
              <tr>
                <td colSpan={100} className="px-3 py-12 text-center text-gray-500">
                  <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p>Aucune ligne de métré</p>
                  <p className="text-sm">Cliquez sur "Ajouter une ligne" pour commencer</p>
                </td>
              </tr>
            )}
          </tbody>

          {/* Footer avec totaux */}
          {metre.lignes.length > 0 && (
            <tfoot className="bg-gray-100 border-t-2 border-gray-300">
              <tr>
                <td
                  colSpan={champs.filter((c: string) => c !== 'observations').length + 2}
                  className="px-3 py-3 text-right font-bold text-gray-900"
                >
                  TOTAL PARTIEL:
                </td>
                <td className="px-3 py-3 text-right font-bold text-xl text-blue-700 bg-blue-100">
                  {formatNumber(metre.totalPartiel)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Bouton d'ajout */}
      <div className="flex justify-center">
        <button
          onClick={() => setIsAddingLigne(true)}
          className="btn btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Ajouter une ligne
        </button>
      </div>

      {/* Modal d'ajout/édition */}
      {(isAddingLigne || editingLigneId) && (
        <MetreLigneEditor
          unite={metre.unite}
          initialData={editingLigneId ? metre.lignes.find((l) => l.id === editingLigneId) : undefined}
          onSave={(data) => {
            if (editingLigneId) {
              handleUpdateLigne(editingLigneId, data);
            } else {
              handleAddLigne(data);
            }
          }}
          onCancel={() => {
            setIsAddingLigne(false);
            setEditingLigneId(null);
          }}
        />
      )}
    </div>
  );
};

export default MetreTable;
