/**
 * StatCard.tsx — Dashboard stat card with trend arrow.
 * Ported from Hadassah dashboard.html buildStatCard().
 */

import type { DashboardEntry } from '../../db/queries';
import { useNavigate } from 'react-router-dom';
import { useFilterStore } from '../../store/filterStore';

interface Props {
  entry: DashboardEntry;
}

function formatVal(entry: DashboardEntry): string {
  if (entry.current_value === null) return entry.current_text ?? '—';
  return entry.is_less_than ? `< ${entry.current_value}` : String(entry.current_value);
}

function formatRange(entry: DashboardEntry): string {
  const { range_min: mn, range_max: mx } = entry;
  if (mn !== null && mx !== null) return `${mn} – ${mx}`;
  if (mn !== null) return `> ${mn}`;
  if (mx !== null) return `< ${mx}`;
  return '';
}

function trendArrow(cur: number | null, prev: number | null): { arrow: string; pct: string } {
  if (cur === null || prev === null || prev === 0) return { arrow: '', pct: '' };
  const diff = ((cur - prev) / prev) * 100;
  const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  return { arrow, pct: `${Math.abs(diff).toFixed(1)}%` };
}

export default function StatCard({ entry }: Props) {
  const navigate = useNavigate();
  const setSelectedTests = useFilterStore(s => s.setSelectedTests);

  const statusClass = entry.is_abnormal === 1 ? 'abnormal'
    : entry.is_abnormal === 0 ? 'normal' : '';

  const { arrow, pct } = trendArrow(entry.current_value, entry.prev_value);
  const rangeStr = formatRange(entry);

  function goToGraph() {
    setSelectedTests([entry.test_name]);
    navigate('/graphs');
  }

  return (
    <div className={`stat-card ${statusClass}`} onClick={goToGraph}>
      <div className="test-name" title={entry.test_name}>{entry.test_name}</div>
      <div className="current-val">
        {formatVal(entry)}
        {entry.unit && <span style={{ fontSize: 13, fontWeight: 400, marginRight: 4 }}>{entry.unit}</span>}
      </div>
      {arrow && (
        <div className="trend" style={{ color: arrow === '↑' ? 'var(--red)' : 'var(--green)' }}>
          {arrow} {pct} מהמדידה הקודמת
        </div>
      )}
      {rangeStr && <div className="range-info">נורמה: {rangeStr}</div>}
      <div className="date-info">{entry.current_date}</div>
    </div>
  );
}
