/**
 * parsers/maccabi/index.ts — Maccabi lab PDF parser.
 *
 * Maccabi PDFs have a 4-column RTL layout:
 *   (visual L→R): reference scale | value+unit | test name (English) | Hebrew notes
 *
 * Date format: DD/MM/YY (2-digit year!)
 * Fingerprint: header contains "מכבי" or "Maccabi" or "מכבי" in reversed form
 *
 * Abnormality is detected by looking for values printed in red — but since pdf.js
 * doesn't reliably expose color, we also fall back to range comparison.
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ParsedSession, ParsedResult, TextItem } from '../types';
import { parseValue } from '../value-parser';
import { parseRange } from '../range-parser';
import { computeAbnormal } from '../abnormal-detector';
import { groupIntoRows } from '../hadassah/table-parser';

export function isMaccabiPdf(fullText: string): boolean {
  return (
    // "מכבי" as a standalone word — NOT followed by another Hebrew letter
    // (avoids matching "מכבים" in patient addresses like "מודיעין-מכבים-רעות")
    /מכבי(?![א-ת])/.test(fullText) ||
    fullText.includes('Maccabi') ||       // full English name
    /יבכמ/.test(fullText)                 // reversed Hebrew (legacy pdfplumber output)
  );
}

/** Convert "DD/MM/YY" or "DD/MM/YYYY" to ISO "YYYY-MM-DD" */
function maccabiDateToIso(d: string): string {
  const parts = d.split('/');
  if (parts.length !== 3) return '';
  const [day, month, year] = parts;
  const fullYear = year.length === 2 ? `20${year}` : year;
  return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function extractPageItems(page: pdfjsLib.PDFPageProxy): Promise<TextItem[]> {
  const content  = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const items: TextItem[] = [];

  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    items.push({ str: item.str, x: tx[4], y: tx[5], width: item.width, height: item.height });
  }
  return items;
}

/**
 * Parse a Maccabi-style row from positioned text items.
 * Sorted by x descending so rightmost item = test name (RTL start).
 */
function parseMaccabiRow(items: TextItem[]): ParsedResult | null {
  const sorted = [...items].sort((a, b) => b.x - a.x);
  if (sorted.length === 0) return null;

  const testName = sorted[0]?.str?.trim();
  if (!testName || testName.length < 2) return null;

  if (/תאריך|Date|מכבי|Maccabi|Patient|שם|ת\.ז/i.test(testName)) return null;

  let valueStr = '';
  let unitStr  = '';
  let rangeStr = '';
  const remaining = sorted.slice(1);

  for (const item of remaining) {
    const s = item.str.trim();
    if (!valueStr && /^[<>]?\s*\d/.test(s)) {
      const numMatch = s.match(/^([<>]?\s*\d+(?:\.\d+)?)\s*(.*)/);
      if (numMatch) {
        valueStr = numMatch[1].trim();
        if (numMatch[2]) unitStr = numMatch[2].trim();
      } else {
        valueStr = s;
      }
      continue;
    }
    if (valueStr && !unitStr && /^[a-z%µ]/i.test(s)) { unitStr = s; continue; }
    if (valueStr && /^\d+[.\d]*\s*[-–]\s*\d/.test(s)) rangeStr = s;
  }

  if (!valueStr) return null;

  const { value_num, value_text, is_less_than, is_numeric } = parseValue(valueStr);
  const { range_min, range_max, raw_range } = parseRange(rangeStr);
  const is_abnormal = computeAbnormal(value_num, is_less_than === 1, range_min, range_max, null);

  return {
    category: null, test_name: testName,
    value_num, value_text, is_less_than, is_numeric,
    unit: unitStr, range_min, range_max, raw_range, is_abnormal, notes: '',
  };
}


/** Returns true when at least half the results have a non-numeric test name */
function hasValidTestNames(results: ParsedResult[]): boolean {
  if (results.length === 0) return false;
  const valid = results.filter(r => /[a-zA-Z\u05D0-\u05EA]/.test(r.test_name ?? '')).length;
  return valid / results.length > 0.5;
}

/**
 * Parse Maccabi online portal fullText.
 * Format: "TestName (B|U|F) unit currentValue rangeMin rangeMax"
 * e.g., "Glucose (B) mg/dl 109 70 100"
 */
function parseMaccabiOnlineText(fullText: string): ParsedResult[] {
  const results: ParsedResult[] = [];

  // Primary: "Word(s) (B|U|F)  unit  value  min  max"
  const re = /([A-Z][A-Za-z0-9 .%\-()]*?\([BUF]\))\s+([\w/%µ*^.³]+)\s+([<>]?\s*\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    const testName = m[1].trim();
    const unit     = m[2].trim();
    const valueStr = m[3].replace(',', '.').trim();
    const minStr   = m[4].replace(',', '.');
    const maxStr   = m[5].replace(',', '.');

    const { value_num, value_text, is_less_than, is_numeric } = parseValue(valueStr);
    const rangeStr = `${minStr}-${maxStr}`;
    const { range_min, range_max, raw_range } = parseRange(rangeStr);
    const is_abnormal = computeAbnormal(value_num, is_less_than === 1, range_min, range_max, null);

    results.push({
      category: null, test_name: testName,
      value_num, value_text, is_less_than, is_numeric,
      unit, range_min, range_max, raw_range, is_abnormal, notes: '',
    });
  }

  return results;
}

export async function parseMaccabiPdf(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  filename: string,
  ocrText?: string,
): Promise<ParsedSession> {
  const textParts: string[] = [];
  const allResults: ParsedResult[] = [];
  let totalItems = 0;

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter(it => 'str' in it)
      .map(it => (it as { str: string }).str)
      .join(' ');
    textParts.push(pageText);

    const items = await extractPageItems(page);
    totalItems += items.length;
    const rows  = groupIntoRows(items);

    for (const row of rows) {
      if (row.length < 2) continue;
      const result = parseMaccabiRow(row);
      if (result) allResults.push(result);
    }
  }

  const fullTextJoined = textParts.join('\n');

  // If position-based parsing found no valid results (test names are numbers / missing),
  // fall back to full-text parsing which works for both:
  //   1. Maccabi online portal PDFs (have text but unusual layout)
  //   2. OCR'd vector-path PDFs
  if (!hasValidTestNames(allResults)) {
    allResults.length = 0;
    const textToParse = (totalItems === 0 && ocrText) ? ocrText : fullTextJoined;
    const textResults = parseMaccabiOnlineText(textToParse);
    allResults.push(...textResults);
  }

  // Use OCR text for date if pdfjs found nothing
  const textForDate = totalItems === 0 && ocrText ? ocrText : fullTextJoined;

  // Extract date — Maccabi uses "DD/MM/YY" format
  let isoDate = new Date().toISOString().slice(0, 10);
  const dateMatch = textForDate.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (dateMatch) isoDate = maccabiDateToIso(dateMatch[1]);

  return {
    record_num:        null,
    date:              isoDate,
    lab_source:        'maccabi',
    department:        null,
    material:          'דם',
    urine_volume:      null,
    urine_hours:       null,
    original_filename: filename,
    version:           1,
    parse_confidence:  allResults.length > 3 ? 'medium' : 'low',
    results:           allResults,
  };
}
