/**
 * ChartCard.tsx — Single Chart.js line chart for one test.
 * Ported from Hadassah graphs.js buildChart() and showCharts().
 */

import { useEffect, useRef } from 'react';
import {
  Chart, LineController, LineElement, PointElement, LinearScale,
  CategoryScale, Tooltip, Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import type { Result } from '../../db/queries';
import { PALETTE } from '../../data/testSets';

Chart.register(
  LineController, LineElement, PointElement, LinearScale,
  CategoryScale, Tooltip, Legend, annotationPlugin
);

interface Props {
  testName: string;
  rows: Result[];
  colorIdx: number;
}

function formatRangeDisplay(min: number | null, max: number | null, raw: string): string {
  if (min !== null && max !== null) return `${min} – ${max}`;
  if (min !== null) return `> ${min}`;
  if (max !== null) return `< ${max}`;
  return raw?.split('\n')[0] ?? '';
}

export default function ChartCard({ testName, rows, colorIdx }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef  = useRef<Chart | null>(null);

  // Separate numeric from text rows
  const rawNumeric = rows.filter(r => r.is_numeric && r.value_num !== null);
  const nonZero    = rawNumeric.map(r => r.value_num!).filter(v => v > 0).sort((a, b) => a - b);
  const median     = nonZero.length ? nonZero[Math.floor(nonZero.length / 2)] : 0;
  const numericRows = median > 0.5
    ? rawNumeric.filter(r => r.value_num! > 0)
    : rawNumeric;
  const textRows = rows.filter(r => !r.is_numeric);

  const color  = PALETTE[colorIdx % PALETTE.length];
  const unit   = rows[0]?.unit ?? '';
  const refRow = numericRows.find(r => r.range_min !== null || r.range_max !== null);
  const rMin   = refRow?.range_min ?? null;
  const rMax   = refRow?.range_max ?? null;
  const rangeDisplay = refRow ? formatRangeDisplay(rMin, rMax, refRow.raw_range) : '';

  useEffect(() => {
    if (!canvasRef.current || numericRows.length === 0) return;

    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    const labels = numericRows.map(r => r.date ?? '');
    const values = numericRows.map(r => r.value_num!);
    const pointColors = numericRows.map(r => r.is_abnormal === 1 ? '#c0392b' : color);
    const pointRadius = numericRows.map(r => r.is_abnormal === 1 ? 6 : 4);

    // Build annotation for normal range band
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const annotations: Record<string, any> = {};
    if (rMin !== null && rMax !== null) {
      annotations.normalBand = {
        type: 'box', yMin: rMin, yMax: rMax,
        backgroundColor: 'rgba(39,174,96,0.08)',
        borderColor: 'rgba(39,174,96,0.3)', borderWidth: 1,
        label: { display: false },
      };
    } else if (rMin !== null) {
      annotations.minLine = {
        type: 'line', yMin: rMin, yMax: rMin,
        borderColor: 'rgba(39,174,96,0.5)', borderWidth: 1, borderDash: [4, 4],
      };
    } else if (rMax !== null) {
      annotations.maxLine = {
        type: 'line', yMin: rMax, yMax: rMax,
        borderColor: 'rgba(39,174,96,0.5)', borderWidth: 1, borderDash: [4, 4],
      };
    }

    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: testName + (unit ? ` (${unit})` : ''),
          data: values,
          borderColor: color,
          backgroundColor: color + '22',
          pointBackgroundColor: pointColors,
          pointBorderColor: pointColors,
          pointRadius,
          pointHoverRadius: 7,
          fill: false,
          tension: 0.3,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (ctx) => ctx[0].label,
              label: (ctx) => {
                const row = numericRows[ctx.dataIndex];
                let s = `${ctx.parsed.y}`;
                if (row.is_less_than) s = '< ' + s;
                if (unit) s += ' ' + unit;
                if (row.is_abnormal === 1) s += ' ⚠ חריג';
                return s;
              },
              afterLabel: (ctx) => {
                const row = numericRows[ctx.dataIndex];
                const rd = formatRangeDisplay(row.range_min, row.range_max, row.raw_range);
                return rd ? `נורמה: ${rd}` : null!;
              },
            },
          },
          annotation: { annotations },
        },
        scales: {
          x: {
            type: 'category',
            ticks: { maxRotation: 45, font: { size: 11 } },
          },
          y: {
            title: { display: !!unit, text: unit, font: { size: 11 } },
            ticks: { font: { size: 11 } },
          },
        },
      },
    });

    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [testName, rows, colorIdx]);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">{testName}</span>
        {unit      && <span className="chart-unit">{unit}</span>}
        {rangeDisplay && <span className="chart-range">נורמה: {rangeDisplay}</span>}
        <span className="chart-count">{rows.length} מדידות</span>
      </div>

      {numericRows.length > 0 ? (
        <div className="chart-canvas-wrap">
          <canvas ref={canvasRef} />
        </div>
      ) : textRows.length > 0 ? (
        <table className="text-results-table">
          <thead><tr><th>תאריך</th><th>תוצאה</th></tr></thead>
          <tbody>
            {textRows.map(r => (
              <tr key={r.id}><td>{r.date}</td><td>{r.value_text}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-empty">אין נתונים</div>
      )}
    </div>
  );
}
