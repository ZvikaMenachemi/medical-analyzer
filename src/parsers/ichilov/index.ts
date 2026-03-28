/**
 * parsers/ichilov/index.ts — Tel Aviv Sourasky (Ichilov) lab PDF parser.
 *
 * Ichilov PDFs are scanned images — no text layer. The caller (parsers/index.ts)
 * runs OCR first and passes the resulting text here.
 *
 * OCR table format (per page):
 *   Header:       "Catalog  DF  Result  Unit  Abn  Normal  Graph  Remark"
 *   Data line:    "[,.−]?TestName  value  [unit]  [H|L|B]  [range]  [graph junk]  [Hebrew]"
 *   Continuation: wrapped test-name text — no value, short English only
 *
 * Date format in page header: DD.MM.YYYY
 */

import type { ParsedSession, ParsedResult } from '../types';
import { parseValue } from '../value-parser';
import { parseRange } from '../range-parser';
import { computeAbnormal } from '../abnormal-detector';

export function isIchilovPdf(text: string): boolean {
  return /SOURASKY|ICHILOV/i.test(text);
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

function extractDate(text: string): string {
  // The header contains the birth date (usually 4-digit year < 2000) followed
  // by the test date (year ≥ 2020). Take the first 4-digit-year date ≥ 2020.
  const re = /(\d{1,2})\.(\d{1,2})\.(\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const year = parseInt(m[3], 10);
    if (year >= 2020 && year <= 2050) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Unit recognition
// ---------------------------------------------------------------------------

// Unit tokens that can appear in Ichilov reports (handles common OCR variants).
const UNIT_RE =
  /^(?:mg\/[dDlL]{2}|mg\\[lL]|[Mm][Gg]\/[lL]|[Uu]\/[lL]|[Ii][Uu]\/[lL]|[Gg]\/[dDlL]{2}|[Gg]\/[lL]|gr\/[lL1]|mmol\/[lL]|nmol\/[lL]|ng\/m[lL]|[Ff][lLiI]|pg|%|10e[36]\/\S+|ml\/min\/\S+)$/;

function looksLikeUnit(tok: string): boolean {
  return UNIT_RE.test(tok);
}

// ---------------------------------------------------------------------------
// Line classification helpers
// ---------------------------------------------------------------------------

/** Column-header line that marks the start of a table section. */
function isTableHeader(line: string): boolean {
  // "Catalog" is the first column — be permissive since heb+eng OCR varies
  return /\bCatalog\b/i.test(line);
}

/** Footer / CamScanner watermark line — stop parsing the current page. */
function isFooterLine(line: string): boolean {
  return /CamScanner|Confidential|09TIN|tp\s+Twn|top\s+Twn/i.test(line);
}

/** Lines that should be skipped (pure Hebrew, graph characters, page metadata). */
function isJunkLine(line: string): boolean {
  if (!line.trim()) return true;
  // Mostly Hebrew characters → section header or Hebrew remark line
  const hebCount = (line.match(/[\u05D0-\u05EA]/g) ?? []).length;
  const totalNonSpace = line.replace(/\s/g, '').length;
  if (totalNonSpace > 0 && hebCount / totalNonSpace > 0.35) return true;
  // No letters or digits at all → pure punctuation / graph junk
  if (!/[A-Za-z0-9]/.test(line)) return true;
  return false;
}

/**
 * True when a line is an English continuation of the previous test name:
 * short, only English words, no isolated 2+-digit number, no range.
 */
function isNameContinuation(line: string): boolean {
  if (!line.trim()) return false;
  const c = line.replace(/^[,. \s]+/, '').trim();   // keep leading "-"
  if (!c || c.length > 60) return false;
  if (!/[A-Za-z]/.test(c)) return false;
  if (/\d{2,}/.test(c)) return false;               // has 2+ consecutive digits → value
  if (/\d+\s*[-<>=~]\s*\d+/.test(c)) return false;  // has a range
  const hebCount = (c.match(/[\u05D0-\u05EA]/g) ?? []).length;
  if (hebCount > 2) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Core result-line parser
// ---------------------------------------------------------------------------

/**
 * Try to extract a ParsedResult from a single OCR data line.
 * Returns null if the line doesn't look like a test-result row.
 *
 * Column order on the line (after leading noise is stripped):
 *   TestName  value  [unit]  [H|L|B]  range  [graph junk]  [Hebrew remarks]
 */
function tryParseResultLine(line: string): ParsedResult | null {
  // Strip leading OCR noise: punctuation, brackets, leading spaces
  const clean = line.replace(/^[,.()\[\]'\-\s]+/, '').trim();

  // Must start with a capital letter, %, or #
  if (!/^[A-Z%#]/.test(clean)) return null;

  // Must contain at least one digit
  if (!/\d/.test(clean)) return null;

  // --- Step 1: find the range (most reliably OCR'd token) ---
  // Range: two numbers separated by -, <, =, ~ with no space around separator
  const rangeRe = /(\d+[.,]?\d*)\s*[-<>=~]\s*(\d+[.,]?\d*)(?=\s|$|[^0-9.,])/g;
  let bestRange: { str: string; index: number } | null = null;
  let rm: RegExpExecArray | null;
  while ((rm = rangeRe.exec(clean)) !== null) {
    const r1 = parseFloat(rm[1].replace(',', '.'));
    const r2 = parseFloat(rm[2].replace(',', '.'));
    if (r1 < r2) {
      // Pick the last valid range (graph column sometimes has small number pairs)
      bestRange = {
        str: `${rm[1].replace(',', '.')}-${rm[2].replace(',', '.')}`,
        index: rm.index,
      };
    }
  }

  const rangeStr  = bestRange?.str ?? '';
  const rangeIndex = bestRange?.index ?? clean.length;

  // --- Step 2: everything before the range is "name + value + unit + abn" ---
  const beforeRange = clean.slice(0, rangeIndex).trim();

  // Strip Hebrew remarks and graph characters that leaked into the beforeRange portion
  const beforeRangeClean = beforeRange.replace(/[\u05D0-\u05EA]+/g, ' ').trim();

  // --- Step 3: find standalone abnormality flag (H, L, B) at end of beforeRange ---
  // Must NOT be preceded by / or alphanumeric (to avoid matching "10e6/B")
  const abnRe = /(?<![/a-zA-Z0-9])([HLB])(?![/a-zA-Z0-9])\s*$/;
  const abnMatch = abnRe.exec(beforeRangeClean);
  const abnFlag  = abnMatch ? abnMatch[1] : '';
  const beforeAbn = abnMatch
    ? beforeRangeClean.slice(0, abnMatch.index).trim()
    : beforeRangeClean;

  // --- Step 4: fix colon used as decimal separator (common Tesseract OCR error) ---
  const fixed = beforeAbn.replace(/(\d):(\d)/g, '$1.$2').trim();

  // --- Step 5: token-based reverse scan for unit then value ---
  const tokens = fixed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // Find unit: check last 2 tokens (garbled range may sit at the very end)
  let unitIdx = tokens.length; // default: no unit
  for (const tryIdx of [tokens.length - 1, tokens.length - 2]) {
    if (tryIdx >= 0 && looksLikeUnit(tokens[tryIdx])) {
      unitIdx = tryIdx;
      break;
    }
  }

  // Find value: last token before the unit that looks like a number
  // Accept colon-decimal and plain integers
  const numPat = /^[<>]?\d+(?:[.,:]?\d+)?$/;
  let valueIdx = -1;
  for (let i = unitIdx - 1; i >= 0; i--) {
    if (numPat.test(tokens[i])) {
      valueIdx = i;
      break;
    }
  }

  if (valueIdx < 0) return null;

  const rawValueStr = tokens[valueIdx]
    .replace(/,/g, '.')   // comma → period
    .replace(/:/g, '.');   // colon → period (OCR artifact)

  // Test name: all tokens before the value, stripped of leading noise
  const rawName = tokens
    .slice(0, valueIdx)
    .join(' ')
    .replace(/^[,.\-\s]+/, '')
    .trim();
  if (!rawName || rawName.length < 2) return null;

  const unit = unitIdx < tokens.length ? tokens[unitIdx] : '';

  // --- Step 6: compute final fields ---
  const { value_num, value_text, is_less_than, is_numeric } = parseValue(rawValueStr);
  const { range_min, range_max, raw_range } = parseRange(rangeStr);

  // Prefer computed abnormality; fall back to explicit OCR flag
  let is_abnormal = computeAbnormal(value_num, is_less_than === 1, range_min, range_max, null);
  if (is_abnormal === null && abnFlag) {
    is_abnormal = (abnFlag === 'H' || abnFlag === 'B') ? 1 : abnFlag === 'L' ? 1 : null;
  }

  return {
    category:    null,
    test_name:   rawName,
    value_num, value_text, is_less_than, is_numeric,
    unit,
    range_min, range_max, raw_range,
    is_abnormal,
    notes: '',
  };
}

// ---------------------------------------------------------------------------
// Main text parser
// ---------------------------------------------------------------------------

export function parseIchilovOcrText(ocrText: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  const seen   = new Set<string>();
  const lines  = ocrText.split('\n').map(l => l.trim()).filter(Boolean);

  // DEBUG — remove after diagnosis
  console.log('[Ichilov] OCR text (first 1500 chars):', ocrText.slice(0, 1500));

  // Start searching immediately: the first ~20 lines are page header (patient info).
  // tryParseResultLine rejects non-result lines, so false positives are very rare.
  // isTableHeader re-enables after a footer break on multi-page PDFs.
  let inTable = false;
  let linesBeforeTable = 0;

  for (const line of lines) {
    // (Re-)detect table header — can appear on each page
    if (isTableHeader(line)) {
      inTable = true;
      continue;
    }

    // Page footer — next "Catalog" header will re-enable parsing
    if (isFooterLine(line)) {
      inTable = false;
      continue;
    }

    if (!inTable) {
      linesBeforeTable++;
      // After 30 lines with no table header found, assume OCR garbled "Catalog"
      // and start parsing anyway — tryParseResultLine filters non-result lines.
      if (linesBeforeTable < 30) continue;
    }
    if (isJunkLine(line))  continue;

    const result = tryParseResultLine(line);
    if (result) {
      const key = result.test_name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(result);
      }
    } else if (results.length > 0 && isNameContinuation(line)) {
      // Append wrapped name fragment to the most recent result
      const cont = line.replace(/^[,. \s]+/, '').trim();
      if (cont) {
        const last = results[results.length - 1];
        seen.delete(last.test_name.toLowerCase());
        last.test_name = (last.test_name + ' ' + cont).replace(/\s+/g, ' ').trim();
        seen.add(last.test_name.toLowerCase());
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function parseIchilovPdf(
  filename: string,
  ocrText: string,
): Promise<ParsedSession> {
  const results = parseIchilovOcrText(ocrText);
  const date    = extractDate(ocrText);

  return {
    record_num:        null,
    date,
    lab_source:        'ichilov',
    department:        null,
    material:          'דם',
    urine_volume:      null,
    urine_hours:       null,
    original_filename: filename,
    version:           1,
    parse_confidence:  'medium',
    results,
  };
}
