/**
 * store/dbStore.ts — Zustand store for DB initialization state and data refresh.
 */

import { create } from 'zustand';
import { initDb } from '../db/engine';
import { initSchema } from '../db/schema';
import { getStats } from '../db/queries';

interface DbStore {
  ready: boolean;
  error: string | null;
  stats: { sessions: number; results: number; abnormal: number; earliest: string | null; latest: string | null };
  init: () => Promise<void>;
  refreshStats: () => void;
}

export const useDbStore = create<DbStore>((set) => ({
  ready: false,
  error: null,
  stats: { sessions: 0, results: 0, abnormal: 0, earliest: null, latest: null },

  init: async () => {
    try {
      await initDb();
      initSchema();
      set({ ready: true, stats: getStats() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  refreshStats: () => {
    try {
      set({ stats: getStats() });
    } catch {}
  },
}));
