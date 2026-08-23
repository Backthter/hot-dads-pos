import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { saveAllData } from '../../db/persistence';
import { initSyncTables, hasUnsentChanges, sendChanges } from '../../db/sync-client';
import type { StateCore } from './core';

/**
 * The two things the desktop shell asks of the program.
 *
 * Neither belongs to a domain: closing the window is about the window, and the
 * sync timer is about the database as a whole. Both are gated on the load
 * having finished, because a device that syncs or saves before it has read its
 * own data would upload an empty till over a real one.
 */

/** How often to ask whether anything is waiting to go up. */
const SYNC_POLL_MS = 30_000;

export function useDesktopShell(core: StateCore, dataLoaded: boolean) {
  const [closeRequested, setCloseRequested] = useState(false);

  /**
   * Background sync.
   *
   * Deliberately a poll rather than a subscription: the question it asks is
   * whether SQLite's `data_version` has moved, which is cheap, and nothing in
   * the ordering path waits for the answer. A market with no connection at all
   * fails every one of these quietly and keeps trading.
   */
  useEffect(() => {
    if (!dataLoaded) return;
    let syncTimer: number | null = null;
    (async () => {
      try {
        await initSyncTables();
        console.log('SQLite Sync: tables initialized');
      } catch (e) {
        console.log('SQLite Sync: not available yet (configure in Settings > Program Settings)', e);
        return;
      }
      syncTimer = window.setInterval(async () => {
        try {
          const changes = await hasUnsentChanges().catch(() => false);
          if (changes) {
            const result = await sendChanges();
            console.log('SQLite Sync: auto-sync result', result);
          }
        } catch {
          // sync not configured yet, skip
        }
      }, SYNC_POLL_MS);
    })();
    return () => {
      if (syncTimer !== null) clearInterval(syncTimer);
    };
  }, [dataLoaded]);

  /**
   * Closing the window is intercepted rather than allowed.
   *
   * The debounced save runs 300ms behind the last change, so a window closed
   * immediately after an order can outrun it. Confirming first buys the time
   * and gives the operator a chance to say they did not mean it.
   */
  useEffect(() => {
    if (!dataLoaded) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<null>('close-requested-ui', () => {
          setCloseRequested(true);
        });
      } catch {
        // Not in Tauri environment
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [dataLoaded]);

  const confirmClose = useCallback(async () => {
    setCloseRequested(false);
    try {
      await saveAllData(core.snapshot.current);
      await invoke('close_app');
    } catch {
      // fallback
    }
  }, [core]);

  const cancelClose = useCallback(() => setCloseRequested(false), []);

  return { closeRequested, confirmClose, cancelClose };
}
