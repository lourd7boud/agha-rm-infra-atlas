import axios, { AxiosInstance, AxiosError } from 'axios';

// Use relative URL in production (works with Nginx proxy), full URL in development
const getApiUrl = () => {
  // CRITICAL: Check if Electron context bridge exposed apiUrl
  if (typeof window !== 'undefined' && (window as any).electronAPI?.apiUrl) {
    const electronApiUrl = (window as any).electronAPI.apiUrl;
    console.log('🔌 [API] Using Electron API URL:', electronApiUrl);
    return `${electronApiUrl}/api`;
  }
  
  // In WEB browser (production/staging), ALWAYS use relative path for Nginx proxy
  // This ensures HTTPS pages use HTTPS API (no mixed content)
  // Works for BOTH marocinfra.com AND dev.marocinfra.com
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    // Mount-aware: import.meta.env.BASE_URL is the vite `base` (e.g. '/projects/')
    const base = (import.meta as any).env?.BASE_URL || '/';
    console.log('🌐 [API] Web production mode, using mounted path', `${base}api`);
    return `${base}api`;
  }
  
  // Only use VITE_API_URL in localhost development
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (envUrl) {
    console.log('🔧 [API] Dev mode, using VITE_API_URL:', envUrl);
    return envUrl;
  }
  // In production (no VITE_API_URL), use relative path for Nginx proxy
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    const base = (import.meta as any).env?.BASE_URL || '/';
    console.log('🌐 [API] Production mode, using mounted path');
    return `${base}api`;
  }
  
  console.log('🔧 [API] Development mode, using localhost');
  return 'http://localhost:3000/api';
};

class ApiService {
  private client: AxiosInstance;
  private isRefreshing = false;
  private failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
  }> = [];

  private processQueue(error: any, token: string | null = null) {
    this.failedQueue.forEach(({ resolve, reject }) => {
      if (token) {
        resolve(token);
      } else {
        reject(error);
      }
    });
    this.failedQueue = [];
  }

  constructor() {
    const baseURL = getApiUrl();
    
    this.client = axios.create({
      baseURL,
      withCredentials: true, // Send cookies with requests (needed for auth_token cookie)
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('API Service initialized with baseURL:', baseURL);

    this.client.interceptors.request.use(
      (config) => {
        console.log('API Request:', config.method?.toUpperCase(), config.url, config.data);
        const token = localStorage.getItem('authToken');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => {
        console.log('API Response:', response.status, response.config.url, response.data);
        
        // Check for new token in response headers (auto-refresh from server)
        const newToken = response.headers['x-new-token'];
        if (newToken) {
          console.log('🔄 Token auto-refreshed by server, updating storage');
          this.updateStoredToken(newToken);
        }
        
        return response;
      },
      async (error: AxiosError) => {
        const status = error.response?.status;
        console.error('API Error:', status, error.config?.url, error.response?.data);
        
        const originalRequest = error.config;
        
        // CRITICAL: 429 (Too Many Requests) should NEVER logout the user
        // Just reject and let the app show an error/retry
        if (status === 429) {
          console.warn('⚠️ Rate limited (429) - session preserved, will retry later');
          return Promise.reject(error);
        }
        
        // CRITICAL: Server errors (500, 502, 503, 504) should NEVER invalidate the session
        // User should remain authenticated and retry later
        if (status && status >= 500) {
          console.warn(`⚠️ Server error ${status} - session preserved, app will work offline`);
          // Don't logout, don't clear tokens - just reject and let the app handle offline mode
          return Promise.reject(error);
        }
        
        // Network errors (no response) should also preserve session
        if (!error.response && error.code === 'ERR_NETWORK') {
          console.warn('⚠️ Network error - session preserved, app will work offline');
          return Promise.reject(error);
        }
        
        // Only handle 401 for non-auth endpoints and avoid infinite loops
        if (status === 401 && 
            originalRequest &&
            !originalRequest.url?.includes('/auth/login') && 
            !originalRequest.url?.includes('/auth/register') &&
            !originalRequest.url?.includes('/auth/refresh') &&
            !(originalRequest as any)._retry) {
          
          // If already refreshing, queue this request to wait
          if (this.isRefreshing) {
            return new Promise<any>((resolve, reject) => {
              this.failedQueue.push({
                resolve: (token: string) => {
                  originalRequest.headers = originalRequest.headers || {};
                  originalRequest.headers.Authorization = `Bearer ${token}`;
                  resolve(this.client.request(originalRequest));
                },
                reject: (err: any) => {
                  reject(err);
                }
              });
            });
          }

          // Mark this request as retried to avoid infinite loops
          (originalRequest as any)._retry = true;
          this.isRefreshing = true;
          
          // Try to refresh token
          const token = localStorage.getItem('authToken');
          if (token) {
            try {
              console.log('🔄 Attempting to refresh token...');
              
              // Use a fresh axios instance to avoid interceptor loops
              const refreshAxios = axios.create({
                baseURL: this.client.defaults.baseURL,
                headers: { 'Content-Type': 'application/json' },
                timeout: 10000 // 10s timeout for refresh
              });
              
              const refreshResponse = await refreshAxios.post('/auth/refresh', { token });
              
              if (refreshResponse.data?.data?.token) {
                const newToken = refreshResponse.data.data.token;
                console.log('✅ Token refreshed successfully');
                this.updateStoredToken(newToken);
                
                // Resolve all queued requests with the new token
                this.processQueue(null, newToken);
                this.isRefreshing = false;
                
                // Retry original request with new token
                originalRequest.headers = originalRequest.headers || {};
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                return this.client.request(originalRequest);
              }
            } catch (refreshError: any) {
              const refreshStatus = refreshError.response?.status;
              console.log('🔒 Token refresh failed:', refreshStatus || refreshError.message);
              
              // Reject all queued requests
              this.processQueue(refreshError, null);
              this.isRefreshing = false;
              
              // Only logout if refresh truly failed with auth error (not server/network error)
              if (refreshStatus === 401 || refreshStatus === 403) {
                this.handleLogout();
              }
              // For server errors during refresh, preserve session
              if (refreshStatus && refreshStatus >= 500) {
                console.warn('⚠️ Server error during refresh - session preserved');
                return Promise.reject(error);
              }
            }
          } else {
            // No token at all, reject queued and redirect to login
            this.processQueue(error, null);
            this.isRefreshing = false;
            this.handleLogout();
          }
        }
        
        return Promise.reject(error);
      }
    );
  }
  
  private updateStoredToken(newToken: string) {
    localStorage.setItem('authToken', newToken);
    
    // Update zustand auth storage
    const authStorage = localStorage.getItem('auth-storage');
    if (authStorage) {
      try {
        const parsed = JSON.parse(authStorage);
        if (parsed.state) {
          parsed.state.token = newToken;
          localStorage.setItem('auth-storage', JSON.stringify(parsed));
        }
      } catch (e) {
        console.warn('Failed to update auth storage:', e);
      }
    }
  }
  
  private handleLogout() {
    console.log('🚪 Logging out user due to auth failure');
    localStorage.removeItem('authToken');
    localStorage.removeItem('auth-storage');
    localStorage.removeItem('lastSyncTimestamp');
    
    // Check if using hash router or regular router
    const isHashRouter = window.location.hash.includes('#/');
    const currentPath = isHashRouter 
      ? window.location.hash.replace('#', '') 
      : window.location.pathname;
    
    if (!currentPath.includes('/login')) {
      if (isHashRouter) {
        window.location.hash = '#/login';
      } else {
        window.location.href = '/login';
      }
    }
  }

  async refreshToken(token: string) {
    const response = await this.client.post('/auth/refresh', { token });
    return response.data;
  }

  async register(data: { email: string; password: string; firstName: string; lastName: string }) {
    const response = await this.client.post('/auth/register', data);
    return response.data;
  }

  async login(email: string, password: string) {
    const response = await this.client.post('/auth/login', { email, password });
    return response.data;
  }

  async getCurrentUser() {
    const response = await this.client.get('/auth/me');
    return response.data;
  }

  async getProjects(status?: string) {
    const response = await this.client.get('/projects', { params: { status } });
    return response.data;
  }

  async getProject(id: string) {
    const response = await this.client.get(`/projects/${id}`);
    return response.data;
  }

  async createProject(data: any) {
    const response = await this.client.post('/projects', data);
    return response.data;
  }

  async updateProject(id: string, data: any) {
    const response = await this.client.put(`/projects/${id}`, data);
    return response.data;
  }

  async deleteProject(id: string) {
    const response = await this.client.delete(`/projects/${id}`);
    return response.data;
  }

  async getDeletedProjects() {
    const response = await this.client.get('/projects/deleted/list');
    return response.data;
  }

  async restoreProject(id: string) {
    const response = await this.client.post(`/projects/${id}/restore`);
    return response.data;
  }

  async getBordereaux(projectId: string) {
    const response = await this.client.get(`/bordereau/project/${projectId}`);
    return response.data;
  }

  async getPeriodes(projectId: string) {
    const response = await this.client.get(`/periodes/project/${projectId}`);
    return response.data;
  }

  async createBordereau(data: any) {
    const response = await this.client.post('/bordereau', data);
    return response.data;
  }

  async updateBordereau(id: string, data: any) {
    const response = await this.client.put(`/bordereau/${id}`, data);
    return response.data;
  }

  async deleteBordereau(id: string) {
    const response = await this.client.delete(`/bordereau/${id}`);
    return response.data;
  }

  async getMetres(projectId: string) {
    const response = await this.client.get(`/metre/project/${projectId}`);
    return response.data;
  }

  async createMetre(data: any) {
    const response = await this.client.post('/metre', data);
    return response.data;
  }

  async updateMetre(id: string, data: any) {
    const response = await this.client.put(`/metre/${id}`, data);
    return response.data;
  }

  async deleteMetre(id: string) {
    const response = await this.client.delete(`/metre/${id}`);
    return response.data;
  }

  async getDecompts(projectId: string) {
    const response = await this.client.get(`/decompt/project/${projectId}`);
    return response.data;
  }

  async createDecompt(data: any) {
    const response = await this.client.post('/decompt', data);
    return response.data;
  }

  async updateDecompt(id: string, data: any) {
    const response = await this.client.put(`/decompt/${id}`, data);
    return response.data;
  }

  async deleteDecompt(id: string) {
    const response = await this.client.delete(`/decompt/${id}`);
    return response.data;
  }

  async uploadPhoto(projectId: string, file: File, metadata: any) {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('projectId', projectId);
    Object.keys(metadata).forEach((key) => {
      formData.append(key, metadata[key]);
    });
    const response = await this.client.post('/photos', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getPhotos(projectId: string) {
    const response = await this.client.get(`/photos/project/${projectId}`);
    return response.data;
  }

  async deletePhoto(id: string) {
    const response = await this.client.delete(`/photos/${id}`);
    return response.data;
  }

  async getPVs(projectId: string) {
    const response = await this.client.get(`/pv/project/${projectId}`);
    return response.data;
  }

  async createPV(data: any) {
    const response = await this.client.post('/pv', data);
    return response.data;
  }

  async updatePV(id: string, data: any) {
    const response = await this.client.put(`/pv/${id}`, data);
    return response.data;
  }

  async deletePV(id: string) {
    const response = await this.client.delete(`/pv/${id}`);
    return response.data;
  }

  async uploadAttachment(projectId: string, file: File, metadata: any) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('projectId', projectId);
    Object.keys(metadata).forEach((key) => {
      formData.append(key, metadata[key]);
    });
    const response = await this.client.post('/attachments', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getAttachments(projectId: string, category?: string) {
    const response = await this.client.get(`/attachments/project/${projectId}`, {
      params: { category },
    });
    return response.data;
  }

  async deleteAttachment(id: string) {
    const response = await this.client.delete(`/attachments/${id}`);
    return response.data;
  }

  async syncPush(operations: any[], deviceId: string) {
    const response = await this.client.post('/sync/push', { operations, deviceId });
    return response.data;
  }

  async syncPull(lastSync: number, deviceId: string) {
    const response = await this.client.get('/sync/pull', {
      params: { lastSync, deviceId },
    });
    return response.data;
  }

  async getLastSyncTime() {
    const response = await this.client.get('/sync/last');
    return response.data;
  }

  async resolveConflict(id: string, resolution: 'local' | 'remote' | 'merge', mergedData?: any) {
    const response = await this.client.post(`/sync/conflict/${id}`, { resolution, mergedData });
    return response.data;
  }

  // Missing methods
  async getBordereau(id: string) {
    const response = await this.client.get(`/bordereau/${id}`);
    return response.data;
  }

  async createPeriode(data: any) {
    const response = await this.client.post('/periodes', data);
    return response.data;
  }

  async updatePeriode(id: string, data: any) {
    const response = await this.client.put(`/periodes/${id}`, data);
    return response.data;
  }

  async deletePeriode(id: string) {
    const response = await this.client.delete(`/periodes/${id}`);
    return response.data;
  }

  async permanentDeleteProject(id: string) {
    const response = await this.client.delete(`/projects/${id}/permanent`);
    return response.data;
  }

  /**
   * Get unique companies from all existing projects
   * Used for autocomplete suggestions
   */
  async getCompanies(): Promise<{ nom: string; rc?: string; cb?: string; cnss?: string; patente?: string }[]> {
    try {
      const response = await this.getProjects();
      
      // Handle both formats: {success: true, data: [...]} and direct array
      const projects = response?.data || response || [];
      
      // Extract unique companies from projects
      const companiesMap = new Map<string, { nom: string; rc?: string; cb?: string; cnss?: string; patente?: string }>();
      
      if (Array.isArray(projects)) {
        for (const project of projects) {
          const societe = project.societe || project.société;
          if (societe && societe.trim()) {
            const key = societe.trim().toLowerCase();
            if (!companiesMap.has(key)) {
              companiesMap.set(key, {
                nom: societe.trim(),
                rc: project.rc || '',
                cb: project.cb || '',           // 🔴 FIX: Ajout cb
                cnss: project.cnss || '',
                patente: project.patente || ''  // 🔴 FIX: Ajout patente
              });
            }
          }
        }
      }
      
      console.log(`📊 ${companiesMap.size} entreprises uniques trouvées`);
      return Array.from(companiesMap.values());
    } catch (error) {
      console.error('Error fetching companies from projects:', error);
      return [];
    }
  }

  // ============================================
  // Generic HTTP methods for extensibility
  // ============================================

  /**
   * Generic GET request
   */
  async get(url: string) {
    const response = await this.client.get(url);
    return response.data;
  }

  /**
   * Generic POST request
   */
  async post(url: string, data: any) {
    const response = await this.client.post(url, data);
    return response.data;
  }

  /**
   * Generic PUT request
   */
  async put(url: string, data: any) {
    const response = await this.client.put(url, data);
    return response.data;
  }

  /**
   * Generic DELETE request
   */
  async delete(url: string) {
    const response = await this.client.delete(url);
    return response.data;
  }

  /**
   * POST with FormData (for file uploads)
   */
  async postFormData(url: string, formData: FormData, onProgress?: (progress: number) => void) {
    const response = await this.client.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
    return response.data;
  }

  /**
   * GET request that returns a blob (for file downloads)
   */
  async getBlob(url: string): Promise<Blob> {
    const response = await this.client.get(url, {
      responseType: 'blob'
    });
    return response.data;
  }

  // ═══════════════════════════════════════════════════════════════════
  // AVENANTS (Contract Amendments / ملاحق العقود)
  // ═══════════════════════════════════════════════════════════════════

  async getAvenants(projectId: string) {
    const response = await this.client.get(`/avenants/project/${projectId}`);
    return response.data;
  }

  async getAvenantSummary(projectId: string) {
    const response = await this.client.get(`/avenants/project/${projectId}/summary`);
    return response.data;
  }

  async getAvenantById(id: string) {
    const response = await this.client.get(`/avenants/${id}`);
    return response.data;
  }

  async createAvenant(data: any) {
    const response = await this.client.post('/avenants', data);
    return response.data;
  }

  async updateAvenant(id: string, data: any) {
    const response = await this.client.put(`/avenants/${id}`, data);
    return response.data;
  }

  async deleteAvenant(id: string) {
    const response = await this.client.delete(`/avenants/${id}`);
    return response.data;
  }

  // WORKFLOW & APPROVALS (Circuit de Validation / نظام التأشيرات)
  // ═══════════════════════════════════════════════════════════════════

  async createApprovalRequest(data: any) {
    const response = await this.client.post('/approvals', data);
    return response.data;
  }

  async getApprovalsByProject(projectId: string, params?: { status?: string; documentType?: string }) {
    const response = await this.client.get(`/approvals/project/${projectId}`, { params });
    return response.data;
  }

  async getPendingApprovals() {
    const response = await this.client.get('/approvals/pending');
    return response.data;
  }

  async getApprovalById(id: string) {
    const response = await this.client.get(`/approvals/${id}`);
    return response.data;
  }

  async approveStep(id: string, data?: { comment?: string; conditions?: string }) {
    const response = await this.client.post(`/approvals/${id}/approve`, data || {});
    return response.data;
  }

  async rejectStep(id: string, data: { comment: string; returnToStep?: number }) {
    const response = await this.client.post(`/approvals/${id}/reject`, data);
    return response.data;
  }

  async cancelApproval(id: string, reason?: string) {
    const response = await this.client.post(`/approvals/${id}/cancel`, { reason });
    return response.data;
  }

  async getApprovalStats() {
    const response = await this.client.get('/approvals/stats/summary');
    return response.data;
  }

  async createWorkflow(data: any) {
    const response = await this.client.post('/approvals/workflows', data);
    return response.data;
  }

  async getWorkflowsByProject(projectId: string) {
    const response = await this.client.get(`/approvals/workflows/project/${projectId}`);
    return response.data;
  }

  async deleteWorkflow(id: string) {
    const response = await this.client.delete(`/approvals/workflows/${id}`);
    return response.data;
  }

  // PENALTIES & BONDS (الغرامات والضمانات)
  // ═══════════════════════════════════════════════════════════════════

  async createPenalty(data: any) {
    const response = await this.client.post('/financial/penalties', data);
    return response.data;
  }

  async getPenalties(projectId: string) {
    const response = await this.client.get(`/financial/penalties/project/${projectId}`);
    return response.data;
  }

  async updatePenalty(id: string, data: any) {
    const response = await this.client.put(`/financial/penalties/${id}`, data);
    return response.data;
  }

  async deletePenalty(id: string) {
    const response = await this.client.delete(`/financial/penalties/${id}`);
    return response.data;
  }

  async createBond(data: any) {
    const response = await this.client.post('/financial/bonds', data);
    return response.data;
  }

  async getBonds(projectId: string) {
    const response = await this.client.get(`/financial/bonds/project/${projectId}`);
    return response.data;
  }

  async updateBond(id: string, data: any) {
    const response = await this.client.put(`/financial/bonds/${id}`, data);
    return response.data;
  }

  async deleteBond(id: string) {
    const response = await this.client.delete(`/financial/bonds/${id}`);
    return response.data;
  }

  async createRetention(data: any) {
    const response = await this.client.post('/financial/retentions', data);
    return response.data;
  }

  async getRetentions(projectId: string) {
    const response = await this.client.get(`/financial/retentions/project/${projectId}`);
    return response.data;
  }

  async getFinancialSummary(projectId: string) {
    const response = await this.client.get(`/financial/summary/project/${projectId}`);
    return response.data;
  }

  // EXCEL EXPORTS (التصدير إلى إكسل)
  // ═══════════════════════════════════════════════════════════════════════════

  async getAvailableExports(projectId: string) {
    const response = await this.client.get(`/export/available/${projectId}`);
    return response.data;
  }

  async downloadExport(url: string, filename: string) {
    const response = await this.client.get(url, { responseType: 'blob' });
    const blob = new Blob([response.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // ═══════════════════════════════════════════════════════════
  // SITE DIARY — Journal de Chantier
  // ═══════════════════════════════════════════════════════════
  async getDiaryEntries(projectId: string) {
    const response = await this.client.get(`/site-diary/project/${projectId}`);
    return response.data;
  }

  async getDiaryEntry(id: string) {
    const response = await this.client.get(`/site-diary/${id}`);
    return response.data;
  }

  async createDiaryEntry(data: any) {
    const response = await this.client.post('/site-diary', data);
    return response.data;
  }

  async updateDiaryEntry(id: string, data: any) {
    const response = await this.client.put(`/site-diary/${id}`, data);
    return response.data;
  }

  async deleteDiaryEntry(id: string) {
    const response = await this.client.delete(`/site-diary/${id}`);
    return response.data;
  }

  async validateDiaryEntry(id: string) {
    const response = await this.client.post(`/site-diary/${id}/validate`);
    return response.data;
  }

  async signDiaryEntry(id: string, data: any) {
    const response = await this.client.post(`/site-diary/${id}/sign`, data);
    return response.data;
  }

  async duplicateDiaryEntry(id: string, data: any) {
    const response = await this.client.post(`/site-diary/${id}/duplicate`, data);
    return response.data;
  }

  async getDiaryStats(projectId: string) {
    const response = await this.client.get(`/site-diary/stats/${projectId}`);
    return response.data;
  }

  // ODS — Ordres de Service

  async getODSByProject(projectId: string) {
    const response = await this.client.get(`/ods/project/${projectId}`);
    return response.data;
  }

  async getODS(id: string) {
    const response = await this.client.get(`/ods/${id}`);
    return response.data;
  }

  async createODS(data: any) {
    const response = await this.client.post('/ods', data);
    return response.data;
  }

  async updateODS(id: string, data: any) {
    const response = await this.client.put(`/ods/${id}`, data);
    return response.data;
  }

  async deleteODS(id: string) {
    const response = await this.client.delete(`/ods/${id}`);
    return response.data;
  }

  async emitODS(id: string) {
    const response = await this.client.post(`/ods/${id}/emit`);
    return response.data;
  }

  async notifyODS(id: string, data: any) {
    const response = await this.client.post(`/ods/${id}/notify`, data);
    return response.data;
  }

  async acknowledgeODS(id: string, data: any) {
    const response = await this.client.post(`/ods/${id}/acknowledge`, data);
    return response.data;
  }

  async executeODS(id: string) {
    const response = await this.client.post(`/ods/${id}/execute`);
    return response.data;
  }

  async closeODS(id: string) {
    const response = await this.client.post(`/ods/${id}/close`);
    return response.data;
  }

  async cancelODS(id: string, data: any) {
    const response = await this.client.post(`/ods/${id}/cancel`, data);
    return response.data;
  }

  // ═══════════════════════════════════════════════
  // Client Portal — Portail Client
  // ═══════════════════════════════════════════════

  async createShareLink(data: any) {
    const response = await this.client.post('/portal/links', data);
    return response.data;
  }

  async getShareLinks(projectId: string) {
    const response = await this.client.get(`/portal/links/project/${projectId}`);
    return response.data;
  }

  async toggleShareLink(id: string) {
    const response = await this.client.patch(`/portal/links/${id}/toggle`);
    return response.data;
  }

  async deleteShareLink(id: string) {
    const response = await this.client.delete(`/portal/links/${id}`);
    return response.data;
  }

  async getShareLinkAccessLog(id: string) {
    const response = await this.client.get(`/portal/links/${id}/log`);
    return response.data;
  }

  // Public (no auth)
  async getPortalData(token: string, pin?: string) {
    const params = pin ? `?pin=${pin}` : '';
    const response = await this.client.get(`/portal/view/${token}${params}`);
    return response.data;
  }

  // ═══════════════════════════════════════════════
  // Cross-Project Reports — التقارير الشاملة
  // ═══════════════════════════════════════════════

  async getGlobalReport() {
    const response = await this.client.get('/reports/global');
    return response.data;
  }

  async getFinancialReport() {
    const response = await this.client.get('/reports/financial');
    return response.data;
  }

  async getDeadlinesReport() {
    const response = await this.client.get('/reports/deadlines');
    return response.data;
  }

  async getActivityReport() {
    const response = await this.client.get('/reports/activity');
    return response.data;
  }

  // ═══════════════════════════════════════════════════════════
  // Gantt Planning
  // ═══════════════════════════════════════════════════════════
  async getGanttTasks(projectId: string) {
    const response = await this.client.get(`/gantt/tasks/${projectId}`);
    return response.data;
  }

  async createGanttTask(data: Record<string, unknown>) {
    const response = await this.client.post('/gantt/tasks', data);
    return response.data;
  }

  async updateGanttTask(id: string, data: Record<string, unknown>) {
    const response = await this.client.put(`/gantt/tasks/${id}`, data);
    return response.data;
  }

  async deleteGanttTask(id: string) {
    const response = await this.client.delete(`/gantt/tasks/${id}`);
    return response.data;
  }

  async batchUpdateGanttTasks(projectId: string, tasks: Record<string, unknown>[]) {
    const response = await this.client.put(`/gantt/tasks/batch/${projectId}`, { tasks });
    return response.data;
  }

  async createGanttDependency(data: Record<string, unknown>) {
    const response = await this.client.post('/gantt/dependencies', data);
    return response.data;
  }

  async deleteGanttDependency(id: string) {
    const response = await this.client.delete(`/gantt/dependencies/${id}`);
    return response.data;
  }

  async getGanttStats(projectId: string) {
    const response = await this.client.get(`/gantt/stats/${projectId}`);
    return response.data;
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN — User Management & Presence
  // ═══════════════════════════════════════════════════════════

  async getAdminStats() {
    const response = await this.client.get('/admin/stats');
    return response.data;
  }

  async getAdminUsers() {
    const response = await this.client.get('/admin/users');
    return response.data;
  }

  async createAdminUser(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role?: string;
    trialEndDate?: string;
    jobTitle?: string;
    phone?: string;
    department?: string;
  }) {
    const response = await this.client.post('/admin/users', data);
    return response.data;
  }

  async updateAdminUser(id: string, data: Record<string, any>) {
    const response = await this.client.put(`/admin/users/${id}`, data);
    return response.data;
  }

  async deleteAdminUser(id: string) {
    const response = await this.client.delete(`/admin/users/${id}`);
    return response.data;
  }

  async getProjectMembers(projectId: string) {
    const response = await this.client.get(`/admin/projects/${projectId}/members`);
    return response.data;
  }

  async setProjectMember(projectId: string, data: { userId: string; role: string; permissions?: Record<string, boolean> }) {
    const response = await this.client.post(`/admin/projects/${projectId}/members`, data);
    return response.data;
  }

  async removeProjectMember(projectId: string, userId: string) {
    const response = await this.client.delete(`/admin/projects/${projectId}/members/${userId}`);
    return response.data;
  }

  async getAuditLogs(params?: { limit?: number; offset?: number; action?: string }) {
    const response = await this.client.get('/admin/audit-logs', { params });
    return response.data;
  }

  async getOnlineUsers() {
    const response = await this.client.get('/admin/online');
    return response.data;
  }
}

export const apiService = new ApiService();

