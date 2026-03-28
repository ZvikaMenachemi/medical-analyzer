/**
 * parsers/ichilov/index.ts — Tel Aviv Sourasky (Ichilov) lab PDF parser.
 *
 * Ichilov PDFs are scanned images. The caller runs OCR (Tesseract heb+eng)
 * and passes the resulting text here.
 *
 * Actual OCR format (heb+eng Tesseract):
 *   - Each test result row is on a line that starts with Hebrew "ערכי הייחוס"
 *     (= "reference values"), followed by the English data in RTL-mixed order:
 *     sometimes:  [Hebrew] TestName  value  unit  [H|L|B]  range  [graph junk]
 *     sometimes:  [Hebrew] [graph]   range  TestName  value  unit
 *   - Continuation lines for wrapped test names start with "1110 בתאריך" or
 *     just a Hebrew date string, followed by the rest of the English name.
 *
 * Parsing strategy:
 *   1. Split OCR text at every "ערכי הייחוס" occurrence — each chunk is one test.
 *   2. For each chunk: strip Hebrew chars, strip graph noise, then extract
 *      test name / value / unit / range with order-agnostic heuristics.
 *   3. Fallback line-by-line pass for any tests that lack the Hebrew marker
 *      (e.g. immunology tests with a different remark).
 */

import type { ParsedSession, ParsedResult } from '../types';
import { parseValue }      from '../value-parser';
import { parseRange }      from '../range-parser';
import { computeAbnormal } from '../abnormal-detector';

export function isIchilovPdf(text: string): boolean {
  return /SOURASKY|ICHILOV/i.test(text);
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

function extractDate(text: string): string {
  // Header contains birth date (year <2000) then test date (year ≥2020).
  // Take the FIRST 4-digit-year date that falls in 2020-2050.
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
// Unit recognition (handles common OCR variants)
// ---------------------------------------------------------------------------

const UNIT_RE =
  /^(?:mg\/[dDlL]{2}|mg\\[lL]|[Mm][Gg]\/[lL]|[Uu]\/[lL]|[Ii][Uu]\/[lL]|[Gg]\/[dDlL]{2}|[Gg]\/[lL]|gr\/[lL1]{1,2}|mmol\/[lL]|nmol\/[lL]|ng\/m[lL]|[Ff][lLiI]|pg|%|10e[36]\/\S+|ml\/min\/\S+)$/;

function looksLikeUnit(tok: string): boolean {
  return UNIT_RE.test(tok);
}

// ---------------------------------------------------------------------------
// Core: parse a single test block
// ---------------------------------------------------------------------------

/**
 * Given all text lines belonging to one test result (obtained by splitting on
 * "ערכי הייחוס"), extract a ParsedResult.
 */
function parseBlock(lines: string[]): ParsedResult | null {
  // 1. Concatenate lines, strip Hebrew + graph noise
  const combined = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/CamScanner|Confidential|09TIN/i.test(l))
    .join(' ')
    // Remove Unicode bidirectional control marks (U+200E LTR, U+200F RTL, etc.)
    // that Tesseract embeds between Hebrew and English text segments
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    // Remove Hebrew characters (and common Hebrew punctuation)
    .replace(/[\u05D0-\u05EA\u05F0-\u05F4\uFB1D-\uFB4E'"״׳]+/g, ' ')
    // Remove graph visualisation patterns (3+ consecutive punctuation chars)
    .replace(/[.*[\]|\\]{3,}/g, ' ')
    // Remove isolated dots left from graph column
    .replace(/(?<!\d)\.\s/g, ' ')
    // Normalise whitespace
    .replace(/\s+/g, ' ')
    .trim();

  if (!combined || !/[A-Za-z]/.test(combined)) return null;

  // 2. Fix colon used as decimal point (Tesseract OCR artefact: "13:8" → "13.8")
  const fixed = combined.replace(/(\d):(\d)/g, '$1.$2');

  // 3. Extract ALL valid ranges "X-Y" (X < Y) — take the LAST one
  //    (earlier numbers in the line may be D.T column values or graph artefacts)
  let rangeStr = '';
  const rangeRe = /(\d+[.,]?\d*)\s*[-<>=~]\s*(\d+[.,]?\d*)(?=\s|$|[^0-9,.])/g;
  let rm: RegExpExecArray | null;
  while ((rm = rangeRe.exec(fixed)) !== null) {
    const r1 = parseFloat(rm[1].replace(',', '.'));
    const r2 = parseFloat(rm[2].replace(',', '.'));
    if (r1 < r2) {
      rangeStr = `${rm[1].replace(',', '.')}-${rm[2].replace(',', '.')}`;
    }
  }

  // 4. Find the test name: FIRST capital-letter English sequence that is
  //    immediately followed by a number (the result value).
  //    Using a lazy quantifier ensures we stop at the shortest match.
  const nameRe = /\b([A-Z%#][A-Za-z0-9 \-+/.(,)]{1,50}?)(?=\s+[<>]?\d)/;
  const nameMatch = nameRe.exec(fixed);
  if (!nameMatch) return null;

  const name = nameMatch[1]
    .trim()
    .replace(/[,\s]+$/, '')   // strip trailing comma/space
    .replace(/\s+/g, ' ');

  if (name.length < 2) return null;

  // 5. Value: first number immediately after the test name
  const afterName = fixed.slice(nameMatch.index + nameMatch[0].length).trim();
  const valueMatch = afterName.match(/^([<>]?\d+[.,]?\d*)/);
  if (!valueMatch) return null;

  const valueStr   = valueMatch[1].replace(',', '.');
  const afterValue = afterName.slice(valueMatch[0].length).trim();

  // 6. Unit: check the first 1–2 tokens after the value
  const tokens = afterValue.split(/\s+/).filter(Boolean);
  let unit = '';
  for (const t of tokens.slice(0, 2)) {
    if (looksLikeUnit(t)) { unit = t; break; }
  }

  // 7. Abnormality flag: standalone H, L, or B (not part of a unit or word)
  const abnMatch = fixed.match(/(?<![/a-zA-Z0-9])([HLB])(?![/a-zA-Z0-9])/);
  const abnFlag  = abnMatch ? abnMatch[1] : '';

  // 8. Compute final fields
  const { value_num, value_text, is_less_than, is_numeric } = parseValue(valueStr);
  const { range_min, range_max, raw_range } = parseRange(rangeStr);

  let is_abnormal = computeAbnormal(value_num, is_less_than === 1, range_min, range_max, null);
  if (is_abnormal === null && abnFlag) is_abnormal = 1;

  return {
    category: null, test_name: name,
    value_num, value_text, is_less_than, is_numeric,
    unit, range_min, range_max, raw_range, is_abnormal, notes: '',
  };
}

// ---------------------------------------------------------------------------
// Fallback: line-by-line pass for tests without Hebrew marker
// ---------------------------------------------------------------------------

/**
 * Parse a single cleaned (Hebrew-stripped) line as a test result.
 * Used for immunology / other sections where "ערכי הייחוס" may be absent.
 */
function tryParseCleanLine(line: string): ParsedResult | null {
  const fixed = line
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .replace(/[\u05D0-\u05EA\u05F0-\u05F4\uFB1D-\uFB4E'"״׳]+/g, ' ')
    .replace(/[.*[\]|\\]{3,}/g, ' ')
    .replace(/(\d):(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();

  if (!fixed || !/^[A-Z%#,.]/.test(fixed)) return null;
  if (!/\d/.test(fixed)) return null;

  // Strip common leading punctuation
  const clean = fixed.replace(/^[,.()\[\]'\-\s]+/, '').trim();
  if (!/^[A-Z%#]/.test(clean)) return null;

  // Reuse block-parser logic on single line
  return parseBlock([clean]);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function parseIchilovOcrText(ocrText: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  const seen   = new Set<string>();

  function push(r: ParsedResult | null) {
    if (!r || r.test_name.length < 2) return;
    const key = r.test_name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); results.push(r); }
  }

  // ── Pass 1: split on "ערכי הייחוס" — each chunk is one test result ──────
  // OCR may render final letter as ס or ם (common confusion); handle both.
  const chunks = ocrText.split(/ערכי הייחו[סם]/);
  console.log('[Ichilov v2] chunks:', chunks.length, 'first chunk sample:', chunks[1]?.slice(0, 80));

  // chunk[0] = document header (patient info, column headers) — skip it.
  for (let i = 1; i < chunks.length; i++) {
    const lines = chunks[i].split('\n');
    const r = parseBlock(lines);
    console.log('[Ichilov v2] block', i, '→', r ? `${r.test_name} = ${r.value_num} ${r.unit}` : 'null');
    push(r);
  }

  // ── Pass 2: line-by-line fallback for tests without the Hebrew marker ────
  // Collect lines that are NOT inside any ערכי הייחוס block.
  if (chunks.length === 1) {
    // No Hebrew markers found at all — parse every line individually.
    for (const line of ocrText.split('\n')) {
      push(tryParseCleanLine(line));
    }
  } else {
    // Parse only the pre-marker header section (chunk[0]) line by line
    // to catch any tests that appear before the first Hebrew remark.
    const headerLines = chunks[0].split('\n');
    for (const line of headerLines) {
      // Skip obvious header/footer lines
      if (/Catalog\s+D|CamScanner|SOURASKY|ICHILOV|STATE OF ISRAEL/i.test(line)) continue;
      push(tryParseCleanLine(line));
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
