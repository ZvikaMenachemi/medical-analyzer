/**
 * parsers/generic/index.ts — Generic / imaging PDF handler.
 *
 * For PDFs that don't match any known lab format:
 *   - Imaging reports (MRI, CT, ultrasound, biopsy): stored as text summary
 *   - Unknown lab tables: heuristic table extraction
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ParsedSession, ParsedResult, TextItem } from '../types';
import { parseValue } from '../value-parser';
import { parseRange } from '../range-parser';
import { computeAbnormal } from '../abnormal-detector';
import { groupIntoRows } from '../hadassah/table-parser';

// Keywords that indicate an imaging / narrative report
const IMAGING_KEYWORDS = [
  'MRI', 'CT', 'PET', 'אולטראסאונד', 'ultrasound', 'ביופסיה', 'biopsy',
  'ממצאים', 'findings', 'סיכום', 'impression', 'המלצות', 'recommendations',
  'תאור', 'description', 'רנטגן', 'X-ray', 'XRAY',
];

function isImagingReport(fullText: string): boolean {
  const lower = fullText.toLowerCase();
  return IMAGING_KEYWORDS.some(kw => lower.includes(kw.toLowerCase())) &&
    !/<?\s*\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?/.test(fullText); // no range patterns
}

/** Extract date from any format */
function extractDate(text: string): string {
  // Try YYYY-MM-DD
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Try DD/MM/YYYY
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  // Try DD/MM/YY
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
  if (m) return `20${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  return new Date().toISOString().slice(0, 10);
}

/** Score a row as a potential result row (higher = more likely) */
function scoreRow(items: TextItem[]): number {
  const texts = items.map(i => i.str.trim());
  const combined = texts.join(' ');

  let score = 0;
  // Has a numeric value
  if (/\d+(?:\.\d+)?/.test(combined)) score += 2;
  // Has a range pattern
  if (/\d+\s*[-–]\s*\d+/.test(combined)) score += 3;
  // Has a unit
  if (/\b(mg|dl|g|mmol|µg|IU|mEq|%|units?)\b/i.test(combined)) score += 2;
  // Has at least 3 distinct text items (= multiple columns)
  if (items.length >= 3) score += 1;
  // Penalize if it looks like a header
  if (/שם בדיקה|test name|result|תוצאה|יחידות|unit/i.test(combined)) score -= 5;

  return score;
}

function parseGenericRow(items: TextItem[]): ParsedResult | null {
  if (items.length < 2) return null;

  // Sort by x descending (RTL: rightmost = test name)
  const sorted = [...items].sort((a, b) => b.x - a.x);

  const testName = sorted[0]?.str?.trim();
  if (!testName || testName.length < 2 || /^\d+$/.test(testName)) return null;

  let valueStr = '';
  let unitStr  = '';
  let rangeStr = '';

  for (const item of sorted.slice(1)) {
    const s = item.str.trim();
    if (!s) continue;

    if (!valueStr && /^[<>]?\s*\d/.test(s)) {
      valueStr = s;
      continue;
    }
    if (valueStr && !unitStr && /^[a-z%µ]/i.test(s) && s.length < 15) {
      unitStr = s;
      continue;
    }
    if (/\d+\s*[-–]\s*\d/.test(s)) {
      rangeStr = s;
    }
  }

  if (!valueStr) return null;

  const { value_num, value_text, is_less_than, is_numeric } = parseValue(valueStr);
  const { range_min, range_max, raw_range } = parseRange(rangeStr);
  const is_abnormal = computeAbnormal(value_num, is_less_than === 1, range_min, range_max, null);

  return {
    category:    null,
    test_name:   testName,
    value_num,
    value_text,
    is_less_than,
    is_numeric,
    unit:        unitStr,
    range_min,
    range_max,
    raw_range,
    is_abnormal,
    notes:       '',
  };
}

export async function parseGenericPdf(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  filename: string,
): Promise<ParsedSession> {
  const textParts: string[] = [];
  const allPageItems: TextItem[][] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter(it => 'str' in it)
      .map(it => (it as { str: string }).str)
      .join(' ');
    textParts.push(pageText);

    const viewport = page.getViewport({ scale: 1 });
    const items: TextItem[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      items.push({ str: item.str, x: tx[4], y: tx[5], width: item.width, height: item.height });
    }
    allPageItems.push(items);
  }

  const fullText = textParts.join('\n');
  const isoDate  = extractDate(fullText);

  // Imaging / narrative report
  if (isImagingReport(fullText)) {
    return {
      record_num:        null,
      date:              isoDate,
      lab_source:        'imaging',
      department:        null,
      material:          'דיווח הדמיה',
      urine_volume:      null,
      urine_hours:       null,
      original_filename: filename,
      version:           1,
      parse_confidence:  'high',
      results: [{
        category:    'דיווח',
        test_name:   filename.replace('.pdf', ''),
        value_num:   null,
        value_text:  fullText.slice(0, 2000),  // first 2000 chars as summary
        is_less_than: 0,
        is_numeric:  0,
        unit:        '',
        range_min:   null,
        range_max:   null,
        raw_range:   '',
        is_abnormal: null,
        notes:       '',
      }],
    };
  }

  // Generic lab — try heuristic table extraction
  const allResults: ParsedResult[] = [];

  for (const pageItems of allPageItems) {
    const rows = groupIntoRows(pageItems);
    for (const row of rows) {
      if (scoreRow(row) >= 4) {
        const result = parseGenericRow(row);
        if (result) allResults.push(result);
      }
    }
  }

  return {
    record_num:        null,
    date:              isoDate,
    lab_source:        'generic',
    department:        null,
    material:          null,
    urine_volume:      null,
    urine_hours:       null,
    original_filename: filename,
    version:           1,
    parse_confidence:  allResults.length > 5 ? 'medium' : 'low',
    results:           allResults,
  };
}
