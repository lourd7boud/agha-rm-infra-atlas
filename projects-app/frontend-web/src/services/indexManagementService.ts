/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 📊 Index Management Service - Phase 4B
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { apiService } from './apiService';

// Types
export interface IndexMonth {
  id: number;
  monthDate: string;
  indexCount: number;
  status: 'provisoire' | 'definitif';
  source: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IndexDetail {
  id: number;
  monthDate: string;
  indexes: Record<string, { value: number; name: string; category: string }>;
  rawIndexes: Record<string, number>;
  status: 'provisoire' | 'definitif';
  source: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IndexCatalog {
  catalog: Record<string, { name: string; category: string; liste?: string }>;
  categories: Record<string, Array<{ code: string; name: string; liste?: string }>>;
  listes?: Record<string, Array<{ code: string; name: string; category: string }>>;
  totalIndexes: number;
}

export interface AuditLogEntry {
  id: number;
  monthDate: string;
  action: string;
  userEmail: string;
  changes: any;
  source: string;
  createdAt: string;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// API Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get index catalog (all known indexes)
 */
export const getIndexCatalog = async (): Promise<IndexCatalog> => {
  const response = await apiService.get('/index-management/catalog');
  return response.data;
};

/**
 * List all months with indexes
 */
export const listIndexes = async (params?: {
  year?: number;
  status?: 'provisoire' | 'definitif';
}): Promise<{ months: IndexMonth[]; availableYears: number[]; totalMonths: number }> => {
  const queryStr = params ? '?' + new URLSearchParams(params as any).toString() : '';
  const response = await apiService.get(`/index-management/${queryStr}`);
  return response.data;
};

/**
 * Get indexes for a specific month
 */
export const getMonthIndexes = async (month: string): Promise<IndexDetail> => {
  const response = await apiService.get(`/index-management/${month}`);
  return response.data;
};

/**
 * Create indexes for a new month
 */
export const createMonthIndexes = async (data: {
  monthDate: string;
  indexes: Record<string, number>;
  status: 'provisoire' | 'definitif';
  source?: string;
  notes?: string;
}): Promise<{ id: number; monthDate: string; indexCount: number; status: string }> => {
  const response = await apiService.post('/index-management/', data);
  return response.data;
};

/**
 * Update indexes for a month
 */
export const updateMonthIndexes = async (
  month: string,
  data: {
    indexes?: Record<string, number>;
    status?: 'provisoire' | 'definitif';
    source?: string;
    notes?: string;
  }
): Promise<{ id: number; monthDate: string; status: string; updatedAt: string }> => {
  const response = await apiService.put(`/index-management/${month}`, data);
  return response.data;
};

/**
 * Delete indexes for a month
 */
export const deleteMonthIndexes = async (month: string): Promise<void> => {
  await apiService.delete(`/index-management/${month}`);
};

/**
 * Download Excel template
 */
export const downloadTemplate = async (): Promise<void> => {
  const blob = await apiService.getBlob('/index-management/template');
  
  // Create download link
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'index_template.xlsx');
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

/**
 * Import indexes from Excel file
 */
export const importFromExcel = async (
  file: File,
  updateExisting: boolean = true
): Promise<ImportResult> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('updateExisting', String(updateExisting));
  
  const response = await apiService.postFormData('/index-management/import', formData);
  
  return response.data;
};

/**
 * Get audit log
 */
export const getAuditLog = async (params?: {
  month?: string;
  action?: string;
  limit?: number;
}): Promise<AuditLogEntry[]> => {
  const queryStr = params ? '?' + new URLSearchParams(params as any).toString() : '';
  const response = await apiService.get(`/index-management/audit${queryStr}`);
  return response.data;
};

// ═══════════════════════════════════════════════════════════════════════════
// Price Revision Specific Functions
// ═══════════════════════════════════════════════════════════════════════════

export interface IndexValue {
  year: number;
  month: number;
  value: number;
}

/**
 * Get monthly index values for a specific index code in a date range
 * Used for price revision calculations
 */
export const getMonthlyIndexValues = async (
  indexCode: string,
  startMonth: string,
  endMonth: string
): Promise<IndexValue[]> => {
  const values: IndexValue[] = [];
  
  // Get all months data
  const { months } = await listIndexes();
  
  // Filter and get values for each month
  for (const monthInfo of months) {
    const monthDate = new Date(monthInfo.monthDate);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth() + 1;
    
    // Check if month is in range
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    if (monthKey >= startMonth && monthKey <= endMonth) {
      try {
        const detail = await getMonthIndexes(monthKey);
        if (detail.rawIndexes && detail.rawIndexes[indexCode] !== undefined) {
          values.push({
            year,
            month,
            value: detail.rawIndexes[indexCode]
          });
        }
      } catch (err) {
        console.warn(`Could not load indexes for ${monthKey}:`, err);
      }
    }
  }
  
  return values.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
};

/**
 * Get all index values for multiple codes in a date range
 * More efficient - fetches each month once
 */
export const getMultipleIndexValues = async (
  indexCodes: string[],
  startMonth: string,
  endMonth: string
): Promise<Map<string, Record<string, number>>> => {
  const result = new Map<string, Record<string, number>>();
  
  // Get all months data
  const { months } = await listIndexes();
  
  for (const monthInfo of months) {
    const monthDate = new Date(monthInfo.monthDate);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    
    // Check if month is in range
    if (monthKey >= startMonth && monthKey <= endMonth) {
      try {
        const detail = await getMonthIndexes(monthKey);
        const monthIndexes: Record<string, number> = {};
        
        for (const code of indexCodes) {
          if (detail.rawIndexes && detail.rawIndexes[code] !== undefined) {
            monthIndexes[code] = detail.rawIndexes[code];
          }
        }
        
        if (Object.keys(monthIndexes).length > 0) {
          result.set(monthKey, monthIndexes);
        }
      } catch (err) {
        console.warn(`Could not load indexes for ${monthKey}:`, err);
      }
    }
  }
  
  return result;
};

export default {
  getIndexCatalog,
  listIndexes,
  getMonthIndexes,
  createMonthIndexes,
  updateMonthIndexes,
  deleteMonthIndexes,
  downloadTemplate,
  importFromExcel,
  getAuditLog,
  getMonthlyIndexValues,
  getMultipleIndexValues
};
