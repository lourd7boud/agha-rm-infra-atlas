/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚙️ Project Revision Config Page
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * صفحة إعدادات المراجعة للمشروع
 * 
 * ⚠️ Phase 2: Input UI فقط - بدون حساب فعلي
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  Settings,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Info
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

interface ProjectRevisionConfig {
  id?: number;
  projectId: string;
  formulaId: number;
  baseIndexes: Record<string, number>;
  baseDate?: string;
  isEnabled: boolean;
  notes?: string;
}

interface Project {
  id: string;
  objet: string;
  marcheNo?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🎨 COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const ProjectRevisionConfigPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  // State
  const [project, setProject] = useState<Project | null>(null);
  const [formulas, setFormulas] = useState<RevisionFormula[]>([]);
  const [selectedFormula, setSelectedFormula] = useState<RevisionFormula | null>(null);
  const [config, setConfig] = useState<ProjectRevisionConfig | null>(null);
  
  const [baseIndexes, setBaseIndexes] = useState<Record<string, string>>({});
  const [baseDate, setBaseDate] = useState('');
  const [isEnabled, setIsEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // 📥 LOAD DATA
  // ═══════════════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    if (projectId) {
      loadData();
    }
  }, [projectId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load project
      const projectRes = await fetch(`/api/projects/${projectId}`);
      if (projectRes.ok) {
        const projectData = await projectRes.json();
        setProject(projectData);
      }
      
      // Load formulas
      const formulasRes = await fetch('/api/revision/formulas');
      if (formulasRes.ok) {
        const formulasData = await formulasRes.json();
        setFormulas(formulasData);
      }
      
      // Load existing config
      const configRes = await fetch(`/api/revision/config/${projectId}`);
      if (configRes.ok) {
        const configData = await configRes.json();
        if (configData) {
          setConfig(configData);
          setBaseIndexes(
            Object.fromEntries(
              Object.entries(configData.baseIndexes).map(([k, v]) => [k, String(v)])
            )
          );
          setBaseDate(configData.baseDate || '');
          setIsEnabled(configData.isEnabled);
          setNotes(configData.notes || '');
          
          // Set selected formula
          const formula = formulas.find(f => f.id === configData.formulaId);
          if (formula) {
            setSelectedFormula(formula);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setMessage({ type: 'error', text: 'فشل تحميل البيانات' });
    } finally {
      setLoading(false);
    }
  };

  // Handle formula change
  useEffect(() => {
    if (selectedFormula && !config) {
      // Initialize base indexes for new config
      const indexes: Record<string, string> = {};
      Object.keys(selectedFormula.weights).forEach(name => {
        indexes[name] = '';
      });
      setBaseIndexes(indexes);
    }
  }, [selectedFormula]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 💾 SAVE CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  
  const handleSave = async () => {
    if (!selectedFormula || !projectId) return;
    
    // Validate base indexes
    const required = Object.keys(selectedFormula.weights);
    const missing = required.filter(name => !baseIndexes[name] || baseIndexes[name].trim() === '');
    
    if (missing.length > 0) {
      setMessage({ type: 'error', text: `مؤشرات أساس ناقصة: ${missing.join(', ')}` });
      return;
    }
    
    setSaving(true);
    try {
      const configData: ProjectRevisionConfig = {
        projectId,
        formulaId: selectedFormula.id,
        baseIndexes: Object.fromEntries(
          Object.entries(baseIndexes).map(([k, v]) => [k, parseFloat(v)])
        ),
        baseDate: baseDate || undefined,
        isEnabled,
        notes: notes || undefined
      };
      
      const res = await fetch(`/api/revision/config/${projectId}`, {
        method: config ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData)
      });
      
      if (res.ok) {
        setMessage({ type: 'success', text: 'تم حفظ الإعدادات بنجاح' });
        loadData();
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      console.error('Failed to save config:', error);
      setMessage({ type: 'error', text: 'فشل حفظ الإعدادات' });
    } finally {
      setSaving(false);
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
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                إعدادات مراجعة الأثمنة
              </h1>
              <p className="text-sm text-gray-500">
                {project?.objet || 'Configuration Révision des Prix'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div className={`max-w-4xl mx-auto px-4 mt-4`}>
          <div className={`p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
            <button onClick={() => setMessage(null)} className="ml-auto">×</button>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 📝 FORMULA SELECTION */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-600" />
              اختيار الصيغة
            </h2>
            
            <select
              value={selectedFormula?.id || ''}
              onChange={(e) => {
                const formula = formulas.find(f => f.id === parseInt(e.target.value));
                setSelectedFormula(formula || null);
              }}
              className="w-full px-4 py-3 border rounded-lg text-lg"
            >
              <option value="">-- اختر الصيغة --</option>
              {formulas.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name} ({Object.keys(f.weights).length} مؤشرات)
                </option>
              ))}
            </select>
            
            {selectedFormula?.description && (
              <p className="mt-2 text-sm text-gray-500 flex items-start gap-1">
                <Info className="w-4 h-4 mt-0.5" />
                {selectedFormula.description}
              </p>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* 📊 BASE INDEXES */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          
          {selectedFormula && (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-4">
                  مؤشرات الأساس (Époque de base)
                </h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(selectedFormula.weights).map(([indexName, weight]) => (
                    <div key={indexName} className="flex items-center gap-3">
                      <label className="w-32 text-sm font-medium flex items-center justify-between">
                        <span>{indexName}</span>
                        <span className="text-xs text-gray-400">({(weight * 100).toFixed(0)}%)</span>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={`قيمة ${indexName}₀`}
                        value={baseIndexes[indexName] || ''}
                        onChange={(e) => setBaseIndexes({
                          ...baseIndexes,
                          [indexName]: e.target.value
                        })}
                        className="flex-1 px-3 py-2 border rounded-lg"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* 📅 BASE DATE */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-4">
                  تاريخ الأساس
                </h2>
                
                <input
                  type="month"
                  value={baseDate}
                  onChange={(e) => setBaseDate(e.target.value)}
                  className="w-full sm:w-auto px-4 py-2 border rounded-lg"
                />
                <p className="mt-2 text-sm text-gray-500">
                  شهر إعلان المناقصة أو شهر مرجعي آخر
                </p>
              </div>

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* ✅ ENABLED */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              
              <div className="mb-6">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => setIsEnabled(e.target.checked)}
                    className="w-5 h-5 rounded"
                  />
                  <span className="font-medium">تفعيل المراجعة لهذا المشروع</span>
                </label>
              </div>

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* 📝 NOTES */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              
              <div className="mb-6">
                <h2 className="text-lg font-semibold mb-4">
                  ملاحظات (اختياري)
                </h2>
                
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="ملاحظات إضافية..."
                  rows={3}
                  className="w-full px-4 py-3 border rounded-lg resize-none"
                />
              </div>

              {/* ═══════════════════════════════════════════════════════════════ */}
              {/* 💾 SAVE */}
              {/* ═══════════════════════════════════════════════════════════════ */}
              
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 text-lg font-medium"
              >
                {saving ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                حفظ الإعدادات
              </button>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* ⚠️ PHASE 2 NOTE */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div className="text-sm text-yellow-700">
                <strong>Phase 2:</strong> هذه الإعدادات للحفظ فقط. 
                الحساب الفعلي للمراجعة سيكون متاحاً في Phase 3.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectRevisionConfigPage;
