/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Revision Indexes Management Page
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * صفحة إدارة مؤشرات الأشهر - Generic
 * 
 * ⚠️ Phase 2: Input UI فقط - بدون دمج مع Décompte
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  Plus, 
  Trash2, 
  Calendar,
  AlertCircle,
  CheckCircle,
  RefreshCw
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// 📊 TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface RevisionFormula {
  id: number;
  name: string;
  description?: string;
  fixedPart: number;
  weights: Record<string, number>;
  isDefault: boolean;
}

interface MonthlyIndex {
  id?: number;
  monthDate: string;
  indexValues: Record<string, number>;
  source?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎨 COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const RevisionIndexesPage: React.FC = () => {
  const navigate = useNavigate();
  
  // State
  const [formulas, setFormulas] = useState<RevisionFormula[]>([]);
  const [selectedFormula, setSelectedFormula] = useState<RevisionFormula | null>(null);
  const [indexes, setIndexes] = useState<MonthlyIndex[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // New index form
  const [newMonth, setNewMonth] = useState('');
  const [newIndexValues, setNewIndexValues] = useState<Record<string, string>>({});
  const [newSource, setNewSource] = useState('');

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 LOAD DATA
  // ═══════════════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load formulas
      const formulasRes = await fetch(`${import.meta.env.BASE_URL}api/revision/formulas`);
      if (formulasRes.ok) {
        const data = await formulasRes.json();
        setFormulas(data);
        // Select default formula
        const defaultFormula = data.find((f: RevisionFormula) => f.isDefault) || data[0];
        if (defaultFormula) {
          setSelectedFormula(defaultFormula);
          initNewIndexValues(defaultFormula);
        }
      }
      
      // Load indexes
      const indexesRes = await fetch(`${import.meta.env.BASE_URL}api/revision/indexes`);
      if (indexesRes.ok) {
        const data = await indexesRes.json();
        setIndexes(data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setMessage({ type: 'error', text: 'فشل تحميل البيانات' });
    } finally {
      setLoading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔧 HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  const initNewIndexValues = (formula: RevisionFormula) => {
    const values: Record<string, string> = {};
    Object.keys(formula.weights).forEach(indexName => {
      values[indexName] = '';
    });
    setNewIndexValues(values);
  };

  const isIndexComplete = (index: MonthlyIndex): boolean => {
    if (!selectedFormula) return false;
    const required = Object.keys(selectedFormula.weights);
    return required.every(name => 
      index.indexValues[name] !== undefined && 
      index.indexValues[name] !== null
    );
  };

  const getMissingIndexes = (index: MonthlyIndex): string[] => {
    if (!selectedFormula) return [];
    const required = Object.keys(selectedFormula.weights);
    return required.filter(name => 
      index.indexValues[name] === undefined || 
      index.indexValues[name] === null
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 💾 SAVE INDEX
  // ═══════════════════════════════════════════════════════════════════════════
  
  const handleSaveIndex = async () => {
    if (!newMonth || !selectedFormula) return;
    
    // Validate all required indexes are filled
    const required = Object.keys(selectedFormula.weights);
    const missing = required.filter(name => !newIndexValues[name] || newIndexValues[name].trim() === '');
    
    if (missing.length > 0) {
      setMessage({ type: 'error', text: `مؤشرات ناقصة: ${missing.join(', ')}` });
      return;
    }
    
    setSaving(true);
    try {
      const indexData: MonthlyIndex = {
        monthDate: `${newMonth}-01`,
        indexValues: Object.fromEntries(
          Object.entries(newIndexValues).map(([k, v]) => [k, parseFloat(v)])
        ),
        source: newSource || 'Manual Entry'
      };
      
      const res = await fetch(`${import.meta.env.BASE_URL}api/revision/indexes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(indexData)
      });
      
      if (res.ok) {
        setMessage({ type: 'success', text: 'تم حفظ المؤشرات بنجاح' });
        loadData();
        // Reset form
        setNewMonth('');
        initNewIndexValues(selectedFormula);
        setNewSource('');
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error('Failed to save index:', error);
      setMessage({ type: 'error', text: 'فشل حفظ المؤشرات' });
    } finally {
      setSaving(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 🗑️ DELETE INDEX
  // ═══════════════════════════════════════════════════════════════════════════
  
  const handleDeleteIndex = async (id: number) => {
    if (!confirm('هل أنت متأكد من حذف مؤشرات هذا الشهر؟')) return;
    
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/revision/indexes/${id}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        setMessage({ type: 'success', text: 'تم الحذف بنجاح' });
        loadData();
      }
    } catch (error) {
      console.error('Failed to delete:', error);
      setMessage({ type: 'error', text: 'فشل الحذف' });
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 🎨 RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate(-1)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  مؤشرات مراجعة الأثمنة
                </h1>
                <p className="text-sm text-gray-500">
                  Indices de Révision des Prix
                </p>
              </div>
            </div>
            
            {/* Formula Selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-600">الصيغة:</label>
              <select
                value={selectedFormula?.id || ''}
                onChange={(e) => {
                  const formula = formulas.find(f => f.id === parseInt(e.target.value));
                  if (formula) {
                    setSelectedFormula(formula);
                    initNewIndexValues(formula);
                  }
                }}
                className="px-3 py-2 border rounded-lg text-sm"
              >
                {formulas.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`mx-4 mt-4 p-4 rounded-lg flex items-center gap-2 ${
          message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-auto">×</button>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 📝 ADD NEW INDEX */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              إضافة مؤشرات شهر جديد
            </h2>
            
            {selectedFormula && (
              <div className="space-y-4">
                {/* Month Picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Calendar className="w-4 h-4 inline mr-1" />
                    الشهر
                  </label>
                  <input
                    type="month"
                    value={newMonth}
                    onChange={(e) => setNewMonth(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                
                {/* Dynamic Index Inputs */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-gray-700">
                    المؤشرات المطلوبة ({Object.keys(selectedFormula.weights).length})
                  </label>
                  
                  {Object.entries(selectedFormula.weights).map(([indexName, weight]) => (
                    <div key={indexName} className="flex items-center gap-3">
                      <label className="w-32 text-sm text-gray-600 flex items-center justify-between">
                        <span className="font-medium">{indexName}</span>
                        <span className="text-xs text-gray-400">({(weight * 100).toFixed(0)}%)</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={`قيمة ${indexName}`}
                        value={newIndexValues[indexName] || ''}
                        onChange={(e) => setNewIndexValues({
                          ...newIndexValues,
                          [indexName]: e.target.value
                        })}
                        className="flex-1 px-3 py-2 border rounded-lg"
                      />
                    </div>
                  ))}
                </div>
                
                {/* Source */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    المصدر (اختياري)
                  </label>
                  <input
                    type="text"
                    placeholder="مثال: HCP, BTP Index..."
                    value={newSource}
                    onChange={(e) => setNewSource(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                
                {/* Save Button */}
                <button
                  onClick={handleSaveIndex}
                  disabled={saving || !newMonth}
                  className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  حفظ المؤشرات
                </button>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 📊 EXISTING INDEXES */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-green-600" />
              المؤشرات المسجلة
            </h2>
            
            {indexes.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                لا توجد مؤشرات مسجلة بعد
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {indexes.map((index) => (
                  <div 
                    key={index.id}
                    className={`p-4 rounded-lg border ${
                      isIndexComplete(index) ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">
                        {new Date(index.monthDate).toLocaleDateString('fr-FR', { 
                          month: 'long', 
                          year: 'numeric' 
                        })}
                      </span>
                      <div className="flex items-center gap-2">
                        {isIndexComplete(index) ? (
                          <CheckCircle className="w-4 h-4 text-green-600" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-yellow-600" />
                        )}
                        <button
                          onClick={() => index.id && handleDeleteIndex(index.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-500"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    
                    {/* Index Values */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                      {Object.entries(index.indexValues).map(([name, value]) => (
                        <div key={name} className="flex justify-between">
                          <span className="text-gray-600">{name}:</span>
                          <span className="font-mono">{value}</span>
                        </div>
                      ))}
                    </div>
                    
                    {/* Missing Indexes Warning */}
                    {!isIndexComplete(index) && (
                      <div className="mt-2 text-xs text-yellow-700">
                        ⚠️ ناقص: {getMissingIndexes(index).join(', ')}
                      </div>
                    )}
                    
                    {index.source && (
                      <div className="mt-2 text-xs text-gray-400">
                        المصدر: {index.source}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* 📋 FORMULA INFO */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        
        {selectedFormula && (
          <div className="mt-6 bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">
              📋 تفاصيل الصيغة المختارة
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium text-gray-700 mb-2">{selectedFormula.name}</h3>
                {selectedFormula.description && (
                  <p className="text-sm text-gray-500 mb-3">{selectedFormula.description}</p>
                )}
                
                <div className="text-sm">
                  <div className="flex justify-between py-1 border-b">
                    <span>الجزء الثابت:</span>
                    <span className="font-mono">{(selectedFormula.fixedPart * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between py-1 border-b">
                    <span>عدد المؤشرات:</span>
                    <span className="font-mono">{Object.keys(selectedFormula.weights).length}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span>المجموع:</span>
                    <span className="font-mono">
                      {((selectedFormula.fixedPart + Object.values(selectedFormula.weights).reduce((a, b) => a + b, 0)) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-700 mb-2">أوزان المؤشرات:</h4>
                <div className="space-y-2">
                  {Object.entries(selectedFormula.weights).map(([name, weight]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="w-24 text-sm">{name}</span>
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${weight * 100}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-sm font-mono">
                        {(weight * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default RevisionIndexesPage;
