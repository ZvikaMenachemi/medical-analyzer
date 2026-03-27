/**
 * table-parser.ts — Convert raw text rows into structured result records.
 * Port of parser.py _parse_table_rows(), adapted for pdf.js text extraction.
 *
 * Hadassah PDFs have a 6-column RTL table:
 *   col 0: שם בדיקה   (test name)
 *   col 1: תוצאה      (result value)
 *   col 2: יחידות     (unit)
 *   col 3: ערכי ייחוס (reference range)
 *   col 4: תחום       (domain indicator [....#....])
 *   col 5: הערות      (notes)
 *
 * pdf.js extracts text items with x/y positions. We group them into rows
 * (by y-coordinate proximity) then into columns (by x-coordinate ranges
 * derived from the header row).
 */

import type { TextItem, TextRow, ParsedResult } from '../types';
import { parseValue } from '../value-parser';
import { parseRange } from '../range-parser';
import { parseDomain, computeAbnormal } from '../abnormal-detector';

const ROW_TOLERANCE_PT = 3;  // points within which items are on the "same" line

/** Group text items into rows by y-coordinate */
export function groupIntoRows(items: TextItem[]): TextRow[] {
  if (items.length === 0) return [];

  // Sort by descending y (pdf.js y=0 is at bottom of page), then by x
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: TextRow[] = [];
  let currentRow: TextRow = [sorted[0]];
  let rowY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - rowY) <= ROW_TOLERANCE_PT) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
      rowY = sorted[i].y;
    }
  }
  rows.push(currentRow);

  return rows;
}

/** Given a row, merge all text items into a single string (sorted by x) */
function rowToText(row: TextRow): string {
  return row
    .slice()
    .sort((a, b) => a.x - b.x)
    .map(i => i.str)
    .join(' ')
    .trim();
}

/** Detect if a row is the column header row of the results table */
function isHeaderRow(row: TextRow): boolean {
  const text = rowToText(row);
  // Header contains reversed Hebrew: "הקידב םש" (שם בדיקה) and "האצות" (תוצאה)
  return (text.includes('הקידב') && text.includes('האצות')) ||
         (text.includes('שם בדיקה') && text.includes('תוצאה'));
}

/**
 * Assign items in a row to columns based on the x-coordinate boundaries
 * derived from the header row.
 *
 * Column boundaries come from the header row: we find the center x of each
 * header cell and use midpoints between centers as column boundaries.
 *
 * In an RTL Hadassah PDF, the column x-order (left to right in PDF coords) is
 * roughly:  notes | domain | range | unit | value | test_name
 * because test_name is the rightmost visual column (RTL start).
 *
 * We detect columns dynamically from the header row, then map them
 * to known Hadassah column semantics.
 */
export interface ColumnBounds {
  boundaries: number[];   // sorted ascending x values that split columns
  count: number;
}

function deriveColumnBounds(headerRow: TextRow): ColumnBounds {
  if (headerRow.length === 0) return { boundaries: [], count: 1 };

  // Sort by x
  const sorted = [...headerRow].sort((a, b) => a.x - b.x);

  // Cluster header items into distinct columns (gap > threshold = new column)
  const GAP = 20;
  const clusters: number[][] = [[sorted[0].x]];

  for (let i = 1; i < sorted.length; i++) {
    const last = clusters[clusters.length - 1];
    if (sorted[i].x - last[last.length - 1] > GAP) {
      clusters.push([sorted[i].x]);
    } else {
      last.push(sorted[i].x);
    }
  }

  // Center of each cluster
  const centers = clusters.map(c => (Math.min(...c) + Math.max(...c)) / 2);

  // Midpoints between centers = column boundaries
  const boundaries: number[] = [];
  for (let i = 0; i < centers.length - 1; i++) {
    boundaries.push((centers[i] + centers[i + 1]) / 2);
  }

  return { boundaries, count: clusters.length };
}

function assignToColumns(row: TextRow, bounds: ColumnBounds): string[] {
  const cols: string[][] = Array.from({ length: bounds.count }, () => []);

  for (const item of row) {
    let col = 0;
    for (let i = 0; i < bounds.boundaries.length; i++) {
      if (item.x > bounds.boundaries[i]) col = i + 1;
    }
    cols[col].push(item.str);
  }

  return cols.map(c => c.join(' ').trim());
}

/** True if this row has a test name but no value/unit (= category header) */
function isCategoryHeader(cols: string[]): boolean {
  const testName = cols[0] ?? '';
  const value    = cols[1] ?? '';
  const unit     = cols[2] ?? '';
  return Boolean(testName) && !value && !unit;
}

/**
 * Main entry point: takes all text items from all pages and returns
 * structured result records.
 *
 * Hadassah PDFs have the table header row at the BOTTOM of the results
 * section (y≈315). All data rows are above it (higher y).  We do a
 * two-pass scan per page:
 *   1. Find the header row → derive column boundaries.
 *   2. Process rows with y > headerY as data rows.
 *
 * Column x order (ascending) matches the visual left-to-right layout:
 *   col 0 (x≈65-95):  שם בדיקה  (test name)
 *   col 1 (x≈186-197): תוצאה     (result value)
 *   col 2 (x≈251-261): יחידות    (unit)
 *   col 3 (x≈317-331): ערכי ייחוס (reference range)
 *   col 4 (x≈395-419): תחום       (domain indicator)
 *   col 5 (x≈525):     הערות      (notes)
 * No column reversal is needed.
 */
export function parseHadassahTable(allPageItems: TextItem[][]): ParsedResult[] {
  const results: ParsedResult[] = [];
  let currentCategory: string | null = null;

  for (const pageItems of allPageItems) {
    const rows = groupIntoRows(pageItems);

    // Pass 1: find the header row (usually near y=315 at bottom of table)
    let headerY = -1;
    let columnBounds: ColumnBounds | null = null;
    for (const row of rows) {
      if (isHeaderRow(row)) {
        headerY = row[0].y;
        columnBounds = deriveColumnBounds(row);
        break;
      }
    }
    if (!columnBounds || headerY < 0) continue;

    // Pass 2: process data rows that sit above the header (y > headerY)
    for (const row of rows) {
      if (row[0].y <= headerY) continue; // skip header row and everything below

      const rowText = rowToText(row);
      if (!rowText) continue;

      const cols = assignToColumns(row, columnBounds);

      // col order (ascending x): test_name | value | unit | range | domain | notes
      const testName  = cols[0] ?? '';
      const valueStr  = cols[1] ?? '';
      const unitStr   = cols[2] ?? '';
      const rangeStr  = cols[3] ?? '';
      const domainStr = cols[4] ?? '';
      const notesStr  = cols[5] ?? '';

      if (!testName) continue;

      // Skip page-header rows (e.g. "pr_r0102 84012981 לשמוש פנימי").
      // Real Hadassah test names are ALL-CAPS English or Hebrew; they never
      // start with a lowercase ASCII letter.
      if (/^[a-z]/.test(testName)) continue;

      if (isCategoryHeader(cols)) {
        currentCategory = testName;
        continue;
      }

      const { value_num, value_text, is_less_than, is_numeric } = parseValue(valueStr);
      const { range_min, range_max, raw_range } = parseRange(rangeStr);
      const domainAbnormal = parseDomain(domainStr);
      const is_abnormal = computeAbnormal(
        value_num, is_less_than === 1, range_min, range_max, domainAbnormal
      );

      results.push({
        category:     currentCategory,
        test_name:    testName,
        value_num,
        value_text,
        is_less_than,
        is_numeric,
        unit:         unitStr,
        range_min,
        range_max,
        raw_range,
        is_abnormal,
        notes:        notesStr,
      });
    }
  }

  return results;
}
