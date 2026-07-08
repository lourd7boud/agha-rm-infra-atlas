/**
 * Sync Inspector - Debug tool for comparing Dexie with PostgreSQL
 * 
 * Usage in browser console:
 * 
 * import { syncInspector } from './services/syncInspector';
 * 
 * // Run full inspection
 * await syncInspector.inspect();
 * 
 * // Re-sync missing data
 * await syncInspector.resync();
 * 
 * // Get detailed report
 * syncInspector.getReport();
 */

import { db } from '../db/database';
import { apiService } from '../services/apiService';
import { pullLatestData, getSyncLogs } from '../hooks/useSyncManagerCore';

// ==================== TYPES ====================

interface EntityComparison {
  entity: string;
  localCount: number;
  serverCount: number;
  missing: string[];
  extra: string[];
  outdated: string[];
}

interface SyncReport {
  timestamp: Date;
  deviceId: string;
  comparisons: EntityComparison[];
  totalMissing: number;
  totalExtra: number;
  syncLogs: any[];
  recommendations: string[];
}

// ==================== ID UTILS ====================

const cleanId = (id: string): string => {
  if (!id) return '';
  return id.includes(':') ? id.split(':').pop()! : id;
};

// ==================== INSPECTOR ====================

class SyncInspector {
  private lastReport: SyncReport | null = null;

  /**
   * Run full inspection comparing local Dexie with server
   */
  async inspect(): Promise<SyncReport> {
    console.log('🔍 Starting sync inspection...');
    
    const report: SyncReport = {
      timestamp: new Date(),
      deviceId: localStorage.getItem('deviceId') || 'unknown',
      comparisons: [],
      totalMissing: 0,
      totalExtra: 0,
      syncLogs: getSyncLogs().slice(0, 50),
      recommendations: [],
    };

    try {
      // ===== PROJECTS =====
      const projectsComparison = await this.compareEntity('project', 'projects', async () => {
        const response = await apiService.getProjects();
        return response.data || response;
      }, async () => {
        return await db.projects.toArray();
      });
      report.comparisons.push(projectsComparison);

      // ===== BORDEREAUX =====
      const bordereauxComparison = await this.compareEntity('bordereau', 'bordereaux', async () => {
        // Get all bordereaux from all projects
        const projects = await apiService.getProjects();
        const allBordereaux: any[] = [];
        for (const project of (projects.data || projects)) {
          try {
            const bordResp = await apiService.getBordereaux(cleanId(project.id));
            const bords = bordResp.data || bordResp;
            if (Array.isArray(bords)) allBordereaux.push(...bords);
          } catch (e) { /* Ignore */ }
        }
        return allBordereaux;
      }, async () => {
        return await db.bordereaux.toArray();
      });
      report.comparisons.push(bordereauxComparison);

      // Calculate totals
      for (const comp of report.comparisons) {
        report.totalMissing += comp.missing.length;
        report.totalExtra += comp.extra.length;
      }

      // Generate recommendations
      if (report.totalMissing > 0) {
        report.recommendations.push(`⚠️ ${report.totalMissing} entities missing locally. Run syncInspector.resync() to fix.`);
      }
      if (report.totalExtra > 0) {
        report.recommendations.push(`ℹ️ ${report.totalExtra} extra entities found locally (not on server).`);
      }
      if (report.totalMissing === 0 && report.totalExtra === 0) {
        report.recommendations.push('✅ Local data is in sync with server!');
      }

      this.lastReport = report;
      
      // Log summary
      console.log('📊 Sync Inspection Report:');
      console.log('='.repeat(50));
      for (const comp of report.comparisons) {
        console.log(`${comp.entity}: Local=${comp.localCount}, Server=${comp.serverCount}, Missing=${comp.missing.length}, Extra=${comp.extra.length}`);
      }
      console.log('='.repeat(50));
      report.recommendations.forEach(r => console.log(r));

      return report;

    } catch (error: any) {
      console.error('❌ Inspection error:', error);
      report.recommendations.push(`❌ Error during inspection: ${error.message}`);
      return report;
    }
  }

  /**
   * Compare a single entity type
   */
  private async compareEntity(
    entityName: string,
    _tableName: string,
    fetchServer: () => Promise<any[]>,
    fetchLocal: () => Promise<any[]>
  ): Promise<EntityComparison> {
    const comparison: EntityComparison = {
      entity: entityName,
      localCount: 0,
      serverCount: 0,
      missing: [],
      extra: [],
      outdated: [],
    };

    try {
      const [serverData, localData] = await Promise.all([
        fetchServer(),
        fetchLocal(),
      ]);

      comparison.serverCount = serverData.length;
      comparison.localCount = localData.length;

      // Create maps for quick lookup
      const serverIds = new Set(serverData.map(item => cleanId(item.id)));
      const localIds = new Set(localData.map(item => cleanId(item.id)));

      // Find missing (on server but not local)
      for (const serverId of serverIds) {
        if (!localIds.has(serverId)) {
          comparison.missing.push(serverId);
        }
      }

      // Find extra (on local but not server) - excluding deleted items
      for (const localItem of localData) {
        const localItemId = cleanId(localItem.id);
        if (!serverIds.has(localItemId) && !localItem.deletedAt) {
          comparison.extra.push(localItemId);
        }
      }

    } catch (error: any) {
      console.error(`Error comparing ${entityName}:`, error);
    }

    return comparison;
  }

  /**
   * Re-sync missing data from server
   */
  async resync(): Promise<{ synced: number; errors: string[] }> {
    console.log('🔄 Starting re-sync of missing data...');
    
    const result = { synced: 0, errors: [] as string[] };

    try {
      const pulled = await pullLatestData();
      result.synced = pulled;
      console.log(`✅ Re-synced ${pulled} items`);
    } catch (error: any) {
      result.errors.push(error.message);
      console.error('❌ Re-sync error:', error);
    }

    return result;
  }

  /**
   * Clear local database and re-sync everything
   */
  async fullReset(): Promise<{ success: boolean; error?: string }> {
    console.log('⚠️ Starting full reset...');
    
    try {
      // Clear all data tables (but keep syncOperations for history)
      const tables = [
        db.projects, 
        db.bordereaux, 
        db.metres, 
        db.decompts, 
        db.periodes,
        db.pvs,
        db.photos
      ];
      
      await db.transaction('rw', tables, async () => {
          await db.projects.clear();
          await db.bordereaux.clear();
          await db.metres.clear();
          await db.decompts.clear();
          await db.periodes.clear();
          await db.pvs.clear();
          await db.photos.clear();
        }
      );
      
      // Clear attachments in separate transaction
      await db.attachments.clear();
      
      // Reset sync timestamp to force full sync
      localStorage.removeItem('lastSyncTimestamp');
      localStorage.removeItem('serverSeq');
      
      console.log('🗑️ Local data cleared');
      
      // Re-sync from server
      const pulled = await pullLatestData();
      console.log(`✅ Full reset complete. Synced ${pulled} items`);
      
      return { success: true };
    } catch (error: any) {
      console.error('❌ Full reset error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the last inspection report
   */
  getReport(): SyncReport | null {
    return this.lastReport;
  }

  /**
   * Get sync operation history
   */
  async getOperationHistory(limit = 100): Promise<any[]> {
    return await db.syncOperations
      .orderBy('timestamp')
      .reverse()
      .limit(limit)
      .toArray();
  }

  /**
   * Clear failed/orphan sync operations
   */
  async clearFailedOperations(): Promise<number> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // Delete old synced operations
    const deleted = await db.syncOperations
      .where('synced')
      .equals(1)
      .filter(op => new Date(op.timestamp) < thirtyDaysAgo)
      .delete();
    
    console.log(`🗑️ Cleared ${deleted} old sync operations`);
    return deleted;
  }

  /**
   * Print detailed status
   */
  async printStatus(): Promise<void> {
    console.log('\n📊 SYNC STATUS\n' + '='.repeat(50));
    
    // Local counts
    console.log('\n📁 Local Data:');
    console.log('  Projects:', await db.projects.count());
    console.log('  Bordereaux:', await db.bordereaux.count());
    console.log('  Metres:', await db.metres.count());
    console.log('  Decompts:', await db.decompts.count());
    console.log('  Periodes:', await db.periodes.count());
    console.log('  PVs:', await db.pvs.count());
    console.log('  Photos:', await db.photos.count());
    console.log('  Attachments:', await db.attachments.count());
    
    // Sync operations
    const pendingOps = await db.syncOperations.filter(op => !op.synced).count();
    const syncedOps = await db.syncOperations.filter(op => op.synced === true).count();
    console.log('\n🔄 Sync Operations:');
    console.log('  Pending:', pendingOps);
    console.log('  Synced:', syncedOps);
    
    // Timestamps
    console.log('\n⏰ Timestamps:');
    console.log('  Last sync:', localStorage.getItem('lastSyncTimestamp') || 'Never');
    console.log('  Device ID:', localStorage.getItem('deviceId') || 'Not set');
    
    console.log('\n' + '='.repeat(50));
  }
}

// Export singleton instance
export const syncInspector = new SyncInspector();

// Make available globally for console access
if (typeof window !== 'undefined') {
  (window as any).syncInspector = syncInspector;
}

export default syncInspector;
