/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Revision Service - API Client
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Phase 2: Input/Output only
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// Use same logic as apiService - relative URL in production
const getApiUrl = () => {
  // In WEB browser (production/staging), use the mount base for Nginx proxy.
  // Paths here already carry their own '/api/...', so return base without trailing slash.
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return ((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '');
  }
  // Only use VITE_API_URL in localhost development
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) {
    return envUrl;
  }
  return 'http://localhost:3001';
};

const API_URL = getApiUrl();

// ═══════════════════════════════════════════════════════════════════════════
// 📋 TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface RevisionFormula {
  id: string;
  name: string;
  description: string;
  fixedPart: number;
  weights: Record<string, number>;
  isDefault?: boolean;
  createdAt?: string;
}

export interface RevisionIndex {
  id: string;
  monthDate: string;
  indexValues: Record<string, number>;
  source?: string;
  createdAt?: string;
}

export interface ProjectRevisionConfig {
  id?: string;
  projectId: string;
  formulaId?: string;
  formula?: {
    id: number;
    name: string;
    fixedPart: number;
    weights: Record<string, number>;
  } | null;
  baseIndexes: Record<string, number>;
  baseDate?: string;
  isEnabled: boolean;
  notes?: string;
  formulaName?: string;
  formulaWeights?: Record<string, number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 AXIOS INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

const api = axios.create({
  baseURL: `${API_URL}/api/revision`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ═══════════════════════════════════════════════════════════════════════════
// 📋 FORMULAS API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الحصول على جميع الصيغ المتاحة
 */
export async function getFormulas(): Promise<RevisionFormula[]> {
  const response = await api.get('/formulas');
  return response.data;
}

/**
 * الحصول على صيغة محددة
 */
export async function getFormula(id: string): Promise<RevisionFormula> {
  const response = await api.get(`/formulas/${id}`);
  return response.data;
}

/**
 * إنشاء صيغة جديدة
 */
export async function createFormula(formula: Omit<RevisionFormula, 'id' | 'createdAt'>): Promise<{ id: string }> {
  const response = await api.post('/formulas', formula);
  return response.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// 📊 INDEXES API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الحصول على المؤشرات
 */
export async function getIndexes(params?: { year?: number; month?: number }): Promise<RevisionIndex[]> {
  const response = await api.get('/indexes', { params });
  return response.data;
}

/**
 * إضافة/تحديث مؤشرات شهر
 */
export async function saveIndex(index: Omit<RevisionIndex, 'id' | 'createdAt'>): Promise<{ id: string }> {
  const response = await api.post('/indexes', index);
  return response.data;
}

/**
 * تحديث مؤشرات شهر
 */
export async function updateIndex(id: string, data: { indexValues: Record<string, number>; source?: string }): Promise<void> {
  await api.put(`/indexes/${id}`, data);
}

/**
 * حذف مؤشرات شهر
 */
export async function deleteIndex(id: string): Promise<void> {
  await api.delete(`/indexes/${id}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚙️ PROJECT CONFIG API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * الحصول على إعدادات المراجعة للمشروع
 */
export async function getProjectConfig(projectId: string): Promise<ProjectRevisionConfig | null> {
  const response = await api.get(`/config/${projectId}`);
  return response.data;
}

/**
 * حفظ إعدادات المراجعة للمشروع
 */
export async function saveProjectConfig(projectId: string, config: Omit<ProjectRevisionConfig, 'id' | 'projectId'>): Promise<{ id: string }> {
  const response = await api.post(`/config/${projectId}`, config);
  return response.data;
}

/**
 * تحديث إعدادات المراجعة للمشروع
 */
export async function updateProjectConfig(projectId: string, config: Partial<ProjectRevisionConfig>): Promise<void> {
  await api.put(`/config/${projectId}`, config);
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧰 UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * فحص اكتمال المؤشرات لصيغة معينة
 */
export function validateIndexesCompleteness(
  indexValues: Record<string, number>,
  formula: RevisionFormula
): { isComplete: boolean; missingIndexes: string[] } {
  const requiredIndexes = Object.keys(formula.weights);
  const missingIndexes = requiredIndexes.filter(
    (idx) => indexValues[idx] === undefined || indexValues[idx] === null
  );
  
  return {
    isComplete: missingIndexes.length === 0,
    missingIndexes,
  };
}

/**
 * فحص صحة الصيغة (مجموع = 1)
 */
export function validateFormulaSum(formula: Pick<RevisionFormula, 'fixedPart' | 'weights'>): {
  isValid: boolean;
  sum: number;
} {
  const weightsSum = Object.values(formula.weights).reduce((a, b) => a + b, 0);
  const sum = formula.fixedPart + weightsSum;
  
  return {
    isValid: Math.abs(sum - 1) < 0.0001,
    sum,
  };
}
