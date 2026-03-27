import { useState, useCallback } from 'react';
import { getResults } from '../db/queries';
import type { Result } from '../db/queries';
import { useFilterStore } from '../store/filterStore';
import FilterPanel from '../components/filters/FilterPanel';
import ChartCard from '../components/charts/ChartCard';

export default function GraphsPage() {
  const [chartData, setChartData] = useState<Map<string, Result[]>>(new Map());
  const filter = useFilterStore();

  const showCharts = useCallback(() => {
    if (filter.selectedTests.length === 0) {
      setChartData(new Map());
      return;
    }

    const rows = getResults({
      tests:     filter.selectedTests,
      dateFrom:  filter.dateFrom || undefined,
      dateTo:    filter.dateTo   || undefined,
      materials: filter.materials.length > 0 ? filter.materials : undefined,
    });

    // Sort by date ascending for graphs
    rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

    // Group by test name
    const grouped = new Map<string, Result[]>();
    for (const row of rows) {
      if (!grouped.has(row.test_name)) grouped.set(row.test_name, []);
      grouped.get(row.test_name)!.push(row);
    }

    setChartData(grouped);
  }, [filter.selectedTests, filter.dateFrom, filter.dateTo, filter.materials]);

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
      gap: 20,
      alignItems: 'start',
    }}>
      {!isMobile && (
        <FilterPanel onApply={showCharts} singleSelect />
      )}

      <div style={{ minHeight: 200 }}>
        {isMobile && (
          <div style={{ marginBottom: 16 }}>
            <FilterPanel onApply={showCharts} singleSelect />
          </div>
        )}

        {chartData.size === 0 ? (
          <div className="chart-placeholder">
            <p>בחר בדיקות מהרשימה ולחץ "הצג"</p>
          </div>
        ) : (
          Array.from(chartData.entries()).map(([testName, rows], idx) => (
            <ChartCard key={testName} testName={testName} rows={rows} colorIdx={idx} />
          ))
        )}
      </div>
    </div>
  );
}
