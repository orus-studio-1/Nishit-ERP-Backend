import cron from 'node-cron';
import { syncTallyVouchers, isGlobalSyncRunning, setGlobalSyncRunning } from './tallySync';
import prisma from '../../lib/prisma';

/**
 * Initializes the background jobs for Tally Integration.
 */
export function initTallyJobs() {
  console.log('Initializing Tally Cron Jobs...');

  // Run at Midnight every day (0 0 * * *)
  cron.schedule('0 0 * * *', async () => {
    if (isGlobalSyncRunning) {
      console.log('[CRON] Tally Sync is already running globally. Skipping this scheduled run.');
      return;
    }

    try {
      setGlobalSyncRunning(true);
      console.log('[CRON] Starting Scheduled Tally Vouchers Sync for all companies...');
      
      const companies = await prisma.company.findMany({ select: { id: true, name: true } });
      
      for (const company of companies) {
        console.log(`[CRON] Syncing Tally for company: ${company.name} (${company.id})`);
        try {
          await syncTallyVouchers(company.id);
        } catch (err: any) {
          if (err.message.includes('already running')) {
             console.log(`[CRON] Skipping company ${company.id} because a manual sync is already in progress.`);
          } else {
             console.error(`[CRON] Failed to sync Tally for company ${company.id}:`, err);
          }
        }
      }
    } catch (error) {
      console.error('[CRON] Scheduled Tally Sync Failed', error);
    } finally {
      setGlobalSyncRunning(false);
    }
  });
}
