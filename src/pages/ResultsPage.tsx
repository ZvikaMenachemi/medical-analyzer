import { useState, useEffect, useCallback } from 'react';
import { getResults } from '../db/queries';
import type { Result } from '../db/queries';
import { useFilterStore } from '../store/filterStore';
import FilterPanel from '../components/filters/FilterPanel';
import ResultsTable from '../components/results/ResultsTable';

export default function ResultsPage() {
  const [results, setResults] = useState<Result[]>([]);
  const filter = useFilterStore();

  const load = useCallback(() => {
    setResults(getResults({
      tests:        filter.selectedTests.length > 0 ? filter.selectedTests : undefined,
      dateFrom:     filter.dateFrom || undefined,
      dateTo:       filter.dateTo   || undefined,
      materials:    filter.materials.length > 0 ? filter.materials : undefined,
      abnormalOnly: filter.abnormalOnly || undefined,
    }));
  }, [filter.selectedTests, filter.dateFrom, filter.dateTo, filter.materials, filter.abnormalOnly]);

  useEffect(() => { load(); }, [load]);

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
      gap: 20,
      alignItems: 'start',
    }}>
      {!isMobile && (
        <FilterPanel onApply={load} />
      )}

      <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ fontSize: 15, color: 'var(--blue)' }}>תוצאות בדיקות</h2>
          <span style={{
            fontSize: 12, color: 'var(--gray-md)',
            background: 'var(--gray-lt)', padding: '3px 10px', borderRadius: 12,
          }}>
            {results.length} תוצאות
          </span>
        </div>

        {isMobile && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <FilterPanel onApply={load} />
          </div>
        )}

        <ResultsTable results={results} />
      </div>
    </div>
  );
}
