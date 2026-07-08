import { create } from 'zustand';

interface DirtyPage {
  pageId: string;
  pageName: string;
  isDirty: boolean;
  lastModified: Date;
}

interface DirtyStateStore {
  dirtyPages: Map<string, DirtyPage>;
  
  // تعيين صفحة كـ dirty (فيها تغييرات غير محفوظة)
  setDirty: (pageId: string, pageName: string) => void;
  
  // تنظيف صفحة (بعد الحفظ)
  clearDirty: (pageId: string) => void;
  
  // التحقق إذا كان هناك أي صفحة dirty
  hasAnyDirtyPages: () => boolean;
  
  // الحصول على قائمة الصفحات dirty
  getDirtyPages: () => DirtyPage[];
  
  // التحقق إذا كانت صفحة معينة dirty
  isPageDirty: (pageId: string) => boolean;
  
  // تنظيف كل الصفحات
  clearAll: () => void;
}

export const useDirtyStateStore = create<DirtyStateStore>((set, get) => ({
  dirtyPages: new Map(),

  setDirty: (pageId: string, pageName: string) => {
    set((state) => {
      const newMap = new Map(state.dirtyPages);
      newMap.set(pageId, {
        pageId,
        pageName,
        isDirty: true,
        lastModified: new Date(),
      });
      console.log(`🔴 Dirty state SET: ${pageName} (${pageId})`);
      return { dirtyPages: newMap };
    });
  },

  clearDirty: (pageId: string) => {
    set((state) => {
      const newMap = new Map(state.dirtyPages);
      const page = newMap.get(pageId);
      if (page) {
        console.log(`🟢 Dirty state CLEARED: ${page.pageName} (${pageId})`);
      }
      newMap.delete(pageId);
      return { dirtyPages: newMap };
    });
  },

  hasAnyDirtyPages: () => {
    return get().dirtyPages.size > 0;
  },

  getDirtyPages: () => {
    return Array.from(get().dirtyPages.values());
  },

  isPageDirty: (pageId: string) => {
    return get().dirtyPages.has(pageId);
  },

  clearAll: () => {
    console.log('🧹 All dirty states CLEARED');
    set({ dirtyPages: new Map() });
  },
}));

// Hook مساعد للاستخدام في الصفحات
export const useDirtyState = (pageId: string, pageName: string) => {
  const { setDirty, clearDirty, isPageDirty } = useDirtyStateStore();
  
  const markDirty = () => setDirty(pageId, pageName);
  const markClean = () => clearDirty(pageId);
  const isDirty = isPageDirty(pageId);
  
  return { markDirty, markClean, isDirty };
};
