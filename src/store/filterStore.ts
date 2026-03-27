/**
 * store/filterStore.ts — Zustand store for shared filter state (Results + Graphs + Dashboard).
 */

import { create } from 'zustand';

interface FilterStore {
  selectedTests: string[];
  dateFrom: string;
  dateTo: string;
  materials: string[];    // [] = all
  abnormalOnly: boolean;

  setSelectedTests: (tests: string[]) => void;
  setDateFrom: (d: string) => void;
  setDateTo: (d: string) => void;
  setMaterials: (m: string[]) => void;
  setAbnormalOnly: (v: boolean) => void;
  clearFilters: () => void;
}

export const useFilterStore = create<FilterStore>((set) => ({
  selectedTests: [],
  dateFrom: '',
  dateTo: '',
  materials: [],
  abnormalOnly: false,

  setSelectedTests: (tests) => set({ selectedTests: tests }),
  setDateFrom:      (d)     => set({ dateFrom: d }),
  setDateTo:        (d)     => set({ dateTo: d }),
  setMaterials:     (m)     => set({ materials: m }),
  setAbnormalOnly:  (v)     => set({ abnormalOnly: v }),
  clearFilters: () => set({
    selectedTests: [],
    dateFrom: '',
    dateTo: '',
    materials: [],
    abnormalOnly: false,
  }),
}));
