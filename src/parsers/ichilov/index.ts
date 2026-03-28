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
// Range helper (module-level so both parseBlock and reversed-column path use it)
// ---------------------------------------------------------------------------

function findRange(text: string, firstOnly: boolean): string {
  const re = /(\d+[.,]?\d*)\s*[-<>=~]\s*(\d+[.,]?\d*)(?=\s|$|[^0-9,.])/g;
  let m: RegExpExecArray | null;
  let best = '';
  while ((m = re.exec(text)) !== null) {
    const r1 = parseFloat(m[1].replace(',', '.'));
    const r2 = parseFloat(m[2].replace(',', '.'));
    if (r1 < r2) {
      best = `${m[1].replace(',', '.')}-${m[2].replace(',', '.')}`;
      if (firstOnly) return best;
    }
  }
  return best;
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

  // 2. Fix colon used as decimal point (Tesseract OCR artefact: "13:8" → "13.8"),
  //    then strip date noise from Remark column (DD.MM.YY / DD.MM.YYYY) that
  //    leaks into the combined text and tricks the name regex into stopping early.
  const fixed = combined
    .replace(/(\d):(\d)/g, '$1.$2')
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 3. Find the test name: FIRST capital-letter English sequence that is
  //    immediately followed by a number OR a misread-digit letter (the result value).
  //    Using a lazy quantifier ensures we stop at the shortest match.
  const nameRe = /\b([A-Z%#][A-Za-z0-9 \-+/.(,)]{1,50}?)(?=\s+[<>]?\d)/;
  const nameMatch = nameRe.exec(fixed);
  if (!nameMatch) {
    // Reversed column layout: value precedes name at end of line
    // e.g. "5 0 0.78 Free light chain Kappa/Lambda 0.26-1.65 ..."
    // Require a decimal point in the value to avoid matching integer noise codes.
    const rev = fixed.match(/\b([<>]?\d+[.,]\d+)\s+([A-Z][A-Za-z0-9 \/(),-]{2,})\s*$/);
    if (!rev) return null;
    // Rearrange as "Name value" and re-parse, then patch range from original line
    const r2 = parseBlock([`${rev[2].trim()} ${rev[1]}`]);
    if (!r2) return null;
    if (!r2.raw_range) {
      // Search for range in the original fixed string
      const { range_min, range_max, raw_range } = parseRange(findRange(fixed, false));
      r2.range_min = range_min;
      r2.range_max = range_max;
      r2.raw_range = raw_range;
    }
    return r2;
  }

  let name = nameMatch[1]
    .trim()
    .replace(/[,\s]+$/, '')   // strip trailing comma/space
    .replace(/\s+/g, ' ')
    // Strip unit token absorbed when OCR mis-reads a digit as a letter
    // e.g. "Amylase - blood i U/L H" (where "i" = misread "111") → "Amylase - blood"
    .replace(/(\s+[A-Za-z]{1,5}\/[A-Za-z]{1,5}.*)$/, '')
    .replace(/\s+[HLB]$/, '')     // strip trailing abnormality flag
    .replace(/\s+[a-z]$/, '')     // strip trailing single lowercase (misread digit)
    .trim();

  if (name.length < 2) return null;

  // 3b. Name continuation: "1110" is an OCR artefact for the line-wrap separator
  //     in Ichilov multi-line test rows.  Text after "1110" (before the next
  //     uppercase word or digit) is the continuation of the test name.
  //     e.g. "LD (Lactate 176 U/L 1110 dehydrogenase) - b"  →  append "dehydrogenase) - b"
  const tailMatch = fixed.match(/\b1110\b\s+([a-z][A-Za-z0-9 (),-]*?)(?=\s+[A-Z\d]|$)/);
  if (tailMatch) {
    const tail = tailMatch[1].trim().replace(/\s+/g, ' ');
    if (tail) name = (name + ' ' + tail).trim();
  }

  // 4. Value: first number after the cleaned test name.
  //    We re-locate the end of the cleaned name in fixed (rather than using
  //    nameMatch[0].length) because name-cleanup may strip absorbed noise tokens,
  //    which would otherwise shift the value search past the real value.
  //    We also skip a single OCR-noise token like "i" / "l" that represents a
  //    digit OCR failed to read (e.g. "Amylase - blood i U/L H 28-100" where
  //    "i" = misread "111").  In that case value_num will be null.
  const nameEndInFixed = fixed.indexOf(name, nameMatch.index);
  const searchFrom = nameEndInFixed >= 0 ? nameEndInFixed + name.length : nameMatch.index + nameMatch[0].length;
  const afterName = fixed.slice(searchFrom).trim();

  // Skip a single misread-digit token (one lowercase letter before a unit)
  const afterNameSkipped = afterName.replace(/^([a-z])\s+(?=[A-Z%\\])/, '');
  const valueMatch = afterNameSkipped.match(/^([<>]?\d+[.,]?\d*)/);
  if (!valueMatch) return null;

  const valueStr   = valueMatch[1].replace(',', '.');
  const afterValue = afterNameSkipped.slice(valueMatch[0].length).trim();

  const afterValueWindow = afterValue.slice(0, 80);
  let rangeStr = findRange(afterValueWindow, true);
  if (!rangeStr) {
    // Fallback: search text before the name
    const beforeName = fixed.slice(0, nameMatch.index);
    rangeStr = findRange(beforeName, false);
  }

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

  if (!fixed || !/[A-Za-z]/.test(fixed)) return null;
  if (!/\d/.test(fixed)) return null;

  // Strip leading punctuation/noise chars (including leading "-" from RTL artefacts)
  // e.g. "- ,Lambda light chain 1.46..." → "Lambda light chain 1.46..."
  // e.g. "6 Globulin - blood 17.3 gr/1l" → "Globulin - blood 17.3 gr/1l"
  let clean = fixed.replace(/^[\s,.()\[\]'"\-]+/, '').trim();
  if (/^\d\s+[A-Z]/.test(clean)) clean = clean.replace(/^\d\s+/, '');

  // If still starts with digit(s)/noise, pass directly to parseBlock —
  // the reversed-column handler there will extract value + name correctly.
  // (Aggressive token-stripping was eating part of decimal values like 0.78)
  if (!clean) return null;

  const r = parseBlock([clean]);
  // Reject garbage entries: name must be ≥3 chars and look like a real test name
  if (!r || r.test_name.length < 3) return null;
  // Reject implausibly large values (>100000) or address-like numbers
  if (r.value_num !== null && r.value_num > 100000) return null;
  return r;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function parseIchilovOcrText(ocrText: string): ParsedResult[] {
  const results: ParsedResult[] = [];
  const seen   = new Set<string>();

  function push(r: ParsedResult | null) {
    if (!r || r.test_name.length < 3) return;
    const key = r.test_name.toLowerCase();
    // Prefix-aware dedup: "LD (Lactate dehydrogenase)" and "LD (Lactate" are the
    // same test (one is truncated).  Keep the longer (more complete) name.
    for (const existingKey of seen) {
      const same = existingKey === key ||
        existingKey.startsWith(key + ' ') ||
        key.startsWith(existingKey + ' ');
      if (same) {
        if (key.length > existingKey.length) {
          // Replace shorter entry with the longer, more complete name
          seen.delete(existingKey);
          seen.add(key);
          const idx = results.findIndex(r2 => r2.test_name.toLowerCase() === existingKey);
          if (idx !== -1) results[idx] = r;
        }
        return;
      }
    }
    seen.add(key);
    results.push(r);
  }

  // ── Pass 1: split on "ערכי הייחוס" — each chunk is one test result ──────
  // OCR may render final letter as ס or ם (common confusion); handle both.
  const chunks = ocrText.split(/ערכי הייחו[סם]/);

  // chunk[0] = document header (patient info, column headers) — skip it.
  for (let i = 1; i < chunks.length; i++) {
    const lines = chunks[i].split('\n');
    push(parseBlock(lines));
  }

  // ── Pass 2: line-by-line fallback ────────────────────────────────────────
  // Run on ALL lines of the whole document so we catch tests whose Remark
  // column has a different text (e.g. Globulin, Albumin without Hebrew marker)
  // and blocks that returned null in Pass 1.  The `seen` set prevents doubles.
  for (const line of ocrText.split('\n')) {
    if (/Catalog\s+D|CamScanner|SOURASKY|ICHILOV|STATE OF ISRAEL/i.test(line)) continue;
    push(tryParseCleanLine(line));
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
