import { FC, useState, useEffect } from 'react';
import { MetreLigne } from '../../db/database';
import { X, Calculator, Edit3 } from 'lucide-react';
import {
  getCalculationType,
  DIAMETRES_DISPONIBLES,
  calculatePartiel,
  formatNumber,
} from '../../utils/metreCalculations';

interface MetreLigneEditorProps {
  unite: string;
  initialData?: MetreLigne;
  onSave: (data: Omit<MetreLigne, 'id' | 'numero'>) => void;
  onCancel: () => void;
}

const MetreLigneEditor: FC<MetreLigneEditorProps> = ({ unite, initialData, onSave, onCancel }) => {
  const calculationType = getCalculationType(unite);

  // 🆕 حالة جديدة: إدخال مباشر أو حساب تلقائي
  const [inputMode, setInputMode] = useState<'direct' | 'calculated'>('calculated');
  const [directPartiel, setDirectPartiel] = useState<number>(initialData?.partiel || 0);

  const [formData, setFormData] = useState({
    designation: initialData?.designation || '',
    longueur: initialData?.longueur || 0,
    largeur: initialData?.largeur || 0,
    profondeur: initialData?.profondeur || 0,
    nombre: initialData?.nombre || 1,
    diametre: initialData?.diametre || undefined,
    observations: initialData?.observations || '',
  });

  const [partielPreview, setPartielPreview] = useState(0);
  
  // 🆕 تحديد الوضع الافتراضي بناءً على البيانات الموجودة
  useEffect(() => {
    if (initialData) {
      // إذا كانت جميع القياسات صفر لكن partiel موجود، فهذا إدخال مباشر
      const hasNoMeasurements = 
        (!initialData.longueur || initialData.longueur === 0) &&
        (!initialData.largeur || initialData.largeur === 0) &&
        (!initialData.profondeur || initialData.profondeur === 0) &&
        (!initialData.nombre || initialData.nombre <= 1) &&
        !initialData.diametre;
      
      if (hasNoMeasurements && initialData.partiel > 0) {
        setInputMode('direct');
        setDirectPartiel(initialData.partiel);
      }
    }
  }, [initialData]);

  // Recalculer le partiel à chaque changement
  useEffect(() => {
    if (inputMode === 'calculated') {
      const preview = calculatePartiel(
        unite as any,
        formData.longueur,
        formData.largeur,
        formData.profondeur,
        formData.nombre,
        formData.diametre
      );
      setPartielPreview(preview);
    } else {
      // في الوضع المباشر، استخدم القيمة المدخلة
      setPartielPreview(directPartiel);
    }
  }, [formData, unite, inputMode, directPartiel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.designation.trim()) {
      alert('La désignation est obligatoire');
      return;
    }

    let partiel: number;
    
    if (inputMode === 'direct') {
      // 🆕 في الوضع المباشر، استخدم القيمة المدخلة مباشرة
      partiel = directPartiel;
      // حفظ مع قياسات صفرية للإشارة إلى أنه إدخال مباشر
      onSave({ 
        ...formData, 
        longueur: 0,
        largeur: 0,
        profondeur: 0,
        nombre: 1,
        diametre: undefined,
        partiel 
      });
    } else {
      // الوضع التقليدي - حساب تلقائي
      partiel = calculatePartiel(
        unite as any,
        formData.longueur,
        formData.largeur,
        formData.profondeur,
        formData.nombre,
        formData.diametre
      );
      onSave({ ...formData, partiel });
    }
  };

  if (!calculationType) {
    return null;
  }

  const { champs, label } = calculationType;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {initialData ? 'Modifier la ligne' : 'Ajouter une ligne'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Type de calcul: {label} ({unite})
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Désignation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Désignation <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.designation}
              onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
              className="input w-full"
              placeholder="Ex: Fouille en pleine masse..."
              required
              autoFocus
            />
          </div>

          {/* 🆕 اختيار وضع الإدخال */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Mode de saisie
            </label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setInputMode('calculated')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                  inputMode === 'calculated'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                }`}
              >
                <Calculator className="w-5 h-5" />
                <span className="font-medium">Calcul détaillé</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode('direct')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                  inputMode === 'direct'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                }`}
              >
                <Edit3 className="w-5 h-5" />
                <span className="font-medium">Saisie directe</span>
              </button>
            </div>
          </div>

          {/* 🆕 حقل الإدخال المباشر - يظهر فقط في وضع الإدخال المباشر */}
          {inputMode === 'direct' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <label className="block text-sm font-medium text-green-700 mb-2">
                Quantité directe ({unite})
              </label>
              <input
                type="number"
                value={directPartiel || ''}
                onChange={(e) => setDirectPartiel(parseFloat(e.target.value) || 0)}
                className="input w-full text-lg font-semibold"
                min="0"
                step="0.01"
                placeholder={`Entrez la quantité en ${unite}...`}
                autoFocus
              />
              <p className="text-xs text-green-600 mt-2">
                💡 Utilisez ce mode quand vous connaissez déjà le total (ex: SANS DETAIL 4483 kg)
              </p>
            </div>
          )}

          {/* Champs dynamiques selon le type - يظهر فقط في وضع الحساب */}
          {inputMode === 'calculated' && (
            <div className="grid grid-cols-2 gap-4">
            {champs.includes('nombre') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre
                </label>
                <input
                  type="number"
                  value={formData.nombre}
                  onChange={(e) => setFormData({ ...formData, nombre: parseFloat(e.target.value) || 0 })}
                  className="input w-full"
                  min="0"
                  step="1"
                />
              </div>
            )}

            {champs.includes('longueur') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Longueur (m)
                </label>
                <input
                  type="number"
                  value={formData.longueur}
                  onChange={(e) => setFormData({ ...formData, longueur: parseFloat(e.target.value) || 0 })}
                  className="input w-full"
                  min="0"
                  step="0.01"
                />
              </div>
            )}

            {champs.includes('largeur') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Largeur (m)
                </label>
                <input
                  type="number"
                  value={formData.largeur}
                  onChange={(e) => setFormData({ ...formData, largeur: parseFloat(e.target.value) || 0 })}
                  className="input w-full"
                  min="0"
                  step="0.01"
                />
              </div>
            )}

            {champs.includes('profondeur') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Profondeur (m)
                </label>
                <input
                  type="number"
                  value={formData.profondeur}
                  onChange={(e) =>
                    setFormData({ ...formData, profondeur: parseFloat(e.target.value) || 0 })
                  }
                  className="input w-full"
                  min="0"
                  step="0.01"
                />
              </div>
            )}

            {champs.includes('diametre') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Diamètre (mm)
                </label>
                <select
                  value={formData.diametre || ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      diametre: e.target.value ? parseInt(e.target.value) : undefined,
                    })
                  }
                  className="input w-full"
                >
                  <option value="">Sélectionner...</option>
                  {DIAMETRES_DISPONIBLES.map((d) => (
                    <option key={d} value={d}>
                      Ø{d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            </div>
          )}

          {/* Observations */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Observations</label>
            <textarea
              value={formData.observations}
              onChange={(e) => setFormData({ ...formData, observations: e.target.value })}
              className="input w-full"
              rows={3}
              placeholder="Observations ou remarques..."
            />
          </div>

          {/* Prévisualisation du calcul */}
          <div className={`border rounded-lg p-4 ${inputMode === 'direct' ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-medium mb-1 ${inputMode === 'direct' ? 'text-green-900' : 'text-blue-900'}`}>
                  {inputMode === 'direct' ? 'Quantité saisie directement' : 'Prévisualisation du calcul'}
                </p>
                {inputMode === 'calculated' && (
                  <p className="text-xs text-blue-600">
                    {champs.includes('nombre') && formData.nombre > 0 && `${formData.nombre} × `}
                    {champs.includes('longueur') && formData.longueur > 0 && `${formData.longueur} m`}
                    {champs.includes('largeur') && formData.largeur > 0 && ` × ${formData.largeur} m`}
                    {champs.includes('profondeur') &&
                      formData.profondeur > 0 &&
                      ` × ${formData.profondeur} m`}
                    {champs.includes('diametre') && formData.diametre && ` × Ø${formData.diametre}`}
                  </p>
                )}
                {inputMode === 'direct' && (
                  <p className="text-xs text-green-600">SANS DETAIL</p>
                )}
              </div>
              <div className="text-right">
                <p className={`text-2xl font-bold ${inputMode === 'direct' ? 'text-green-700' : 'text-blue-700'}`}>
                  {formatNumber(partielPreview)}
                </p>
                <p className={`text-xs ${inputMode === 'direct' ? 'text-green-600' : 'text-blue-600'}`}>{unite}</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={onCancel} className="btn btn-secondary">
              Annuler
            </button>
            <button type="submit" className="btn btn-primary">
              {initialData ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MetreLigneEditor;
