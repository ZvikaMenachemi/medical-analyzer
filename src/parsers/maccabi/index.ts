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
 *
 * Three patterns handled:
 *   A) "TestName (B|U|F)  unit  value  min  max"   — original high-confidence
 *   B) "TestName  unit  value  min  max"            — tests without (B/U/F) suffix
 *   C) "TestName  value  unit"                      — tests with no range shown
 */
function parseMaccabiOnlineText(fullText: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  const seen = new Set<string>();

  function push(testName: string, unit: string, valueStr: string, rangeStr: string) {
    const name = testName.trim();
    const key  = name.toLowerCase();
    // Skip if too short, already seen, or contains Hebrew (boilerplate)
    if (key.length < 2 || seen.has(key) || /[\u05D0-\u05EA]/.test(name)) return;
    seen.add(key);

    const { value_num, value_text, is_less_than, is_numeric } = parseValue(valueStr.replace(',', '.').trim());
    const { range_min, range_max, raw_range } = parseRange(rangeStr);
    const is_abnormal = computeAbnormal(value_num, is_less_than === 1, range_min, range_max, null);

    results.push({
      category: null, test_name: name,
      value_num, value_text, is_less_than, is_numeric,
      unit: unit.trim(), range_min, range_max, raw_range, is_abnormal, notes: '',
    });
  }

  // Pattern A: "TestName (B|U|F)  unit  value  min  max"
  const reA = /([A-Z][A-Za-z0-9 .%\-()]*?\([BUF]\))\s+([\w/%µ*^.³]+)\s+([<>]?\s*\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(fullText)) !== null) {
    push(m[1], m[2], m[3], `${m[4].replace(',', '.')}-${m[5].replace(',', '.')}`);
  }

  // Pattern B: "TestName  unit  value  min  max" — no (B/U/F) required.
  // Anchor on known unit tokens to avoid false positives.
  const reB = /([A-Z][A-Za-z0-9 .%+\-/#*()]{1,60}?)\s+(mg\/(?:dl|dL)|g\/dl|mmol\/l|nmol\/L|ng\/ml|mIu\/l|pg\/ml|10\*[36]\/micl|u\/l|U\/l|%|fl|pg\/cell)\s+([<>]?\s*\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)/g;
  while ((m = reB.exec(fullText)) !== null) {
    push(m[1], m[2], m[3], `${m[4].replace(',', '.')}-${m[5].replace(',', '.')}`);
  }

  // Pattern C: "TestName  value  unit" — no range shown (e.g. Cholesterol, LDL, HDL)
  const reC = /([A-Z][A-Za-z0-9 .%+\-/#*()]{1,60}?)\s+([<>]?\s*\d+(?:[.,]\d+)?)\s+(mg\/(?:dl|dL)|g\/dl|mmol\/l|nmol\/L|ng\/ml|mIu\/l|pg\/ml|u\/l|U\/l)(?!\s*\d)/g;
  while ((m = reC.exec(fullText)) !== null) {
    push(m[1], m[3], m[2], '');
  }

  return results;
}

/**
 * Remove the repeated page header/footer that Maccabi online portal inserts
 * on every printed page. Stripping it lets regex patterns match test results
 * that are split across a page boundary (e.g. Triglycerides name on page N,
 * value on page N+1).
 */
function stripMaccabiPageChrome(text: string): string {
  let cleaned = text;
  // Footer: "3/26/26, 2:32 PM Maccabi Online https://... 2/9"
  cleaned = cleaned.replace(
    /\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d+:\d+\s*(?:AM|PM)\s+Maccabi\s+Online\s+https?:\/\/\S+\s+\d+\/\d+/gi,
    ' ',
  );
  // Repeated header block: "תוצאות בדיקות מעבדה ... DD/MM/YY | Doctor name"
  cleaned = cleaned.replace(
    /תוצאות בדיקות מעבדה[\s\S]{0,400}?\d{1,2}\/\d{1,2}\/\d{2,4}\s*\|\s*[^\n\u05D0-\u05EA]{0,40}/g,
    ' ',
  );
  // Navigation links
  cleaned = cleaned.replace(/(?:מעבר לתוכן מרכזי|מעבר לפעולות מהירות|הדפסה \/ שמירה)/g, ' ');
  // Star icons (★ ☆) that appear next to tracked test names
  cleaned = cleaned.replace(/[\u2605\u2606]/g, ' ');
  // "השוואה" compare links (appear between test name and value)
  cleaned = cleaned.replace(/השוואה/g, ' ');
  // "הצגת תוצאות חריגות בבדיקה" checkbox label
  cleaned = cleaned.replace(/הצגת תוצאות חריגות בבדיקה/g, ' ');
  // Arrow characters ← → that appear as part of the compare link
  cleaned = cleaned.replace(/[\u2190\u2192\u2039\u203A]/g, ' ');
  // Category headings in Hebrew (כימיה בדם, המטולוגיה, אנדוקרינולוגיה, etc.)
  cleaned = cleaned.replace(/[א-ת][\u05D0-\u05EA\s\-()]{2,}/g, ' ');
  return cleaned;
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
  // Strip repeated page headers/footers so cross-page results (e.g. Triglycerides)
  // can be matched by text-based parsing.
  const cleanedText = stripMaccabiPageChrome(fullTextJoined);

  if (!hasValidTestNames(allResults)) {
    // Position-based parsing found nothing useful — use text parsing exclusively.
    // Covers: Maccabi online portal PDFs and OCR'd vector-path PDFs.
    allResults.length = 0;
    const textToParse = (totalItems === 0 && ocrText) ? ocrText : cleanedText;
    allResults.push(...parseMaccabiOnlineText(textToParse));
  } else {
    // Position-based parsing found range-based tests. Supplement with text parsing
    // to capture tests that have no reference range (Cholesterol, LDL, HDL, etc.)
    // which are displayed differently on the page and missed by position-based logic.
    const existingNames = new Set(allResults.map(r => r.test_name?.toLowerCase()));
    for (const r of parseMaccabiOnlineText(cleanedText)) {
      if (!existingNames.has(r.test_name?.toLowerCase())) {
        allResults.push(r);
      }
    }
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
