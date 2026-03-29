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
    // Normalize em-dash / en-dash to hyphen so "IgG — blood" parses correctly
    .replace(/[–—]/g, ' - ')
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
    .replace(/(\d):(\d)/g, '$1.$2')       // colon-as-decimal: "13:8" → "13.8"
    .replace(/(\d):\./g, '$1.')            // colon-before-decimal: "3:.5" → "3.5"
    .replace(/(\s*-\s*){2,}/g, ' - ')     // collapse double-dash: "- -" → "-"
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 3. Find the test name: FIRST capital-letter English sequence that is
  //    immediately followed by a number OR a misread-digit letter (the result value).
  //    Using a lazy quantifier ensures we stop at the shortest match.
  const nameRe = /\b([A-Z%#][A-Za-z0-9 \-+/.(,)]{1,50}?)(?=\s+[<>]?\d)/;
  const nameMatch = nameRe.exec(fixed);

  // Reversed column layout: value precedes name at end of line.
  // Also try reversed when nameRe matched but the name looks like graph noise
  // (fewer lowercase letters than the reversed candidate, which is the real name).
  // Allow integers (no decimal required) and optional trailing unit/% noise.
  // Greedy match: capture the full trailing name (not lazy) so "RBC - blood" isn't cut to "RBC -"
  const rev = fixed.match(/\b([<>]?\d+[.,]?\d*)\s+([A-Z][A-Za-z0-9 \-\/(),.%]{2,})\s*$/);
  const fwdLower = nameMatch ? (nameMatch[1].match(/[a-z]/g) ?? []).length : -1;
  const revLower = rev ? (rev[2].match(/[a-z]/g) ?? []).length : -1;
  // Prefer reversed only when the reversed name has ≥3 lowercase letters (real word)
  // and is clearly better than the forward match.
  // revLower >= 3 prevents graph noise like "TOY i" (revL=1) or "SON i" (revL=1)
  // from wrongly beating real short test names like MCV / MPV (fwdL=0).
  const preferReversed = rev && revLower >= 3 && (
    !nameMatch ||
    fwdLower === 0 ||
    revLower > fwdLower + 1
  );

  if (preferReversed && rev) {
    // Move trailing "%" to front: "Neutrophils % 63.7" → "% Neutrophils 63.7"
    // so that nameRe can match "% Neutrophils" as the test name.
    const revName = rev[2].trim();
    const trailingPct = revName.endsWith('%');
    const cleanRevName = trailingPct ? revName.slice(0, -1).trim() : revName;
    const r2 = parseBlock([`${cleanRevName} ${rev[1]}`]);
    if (!r2) return null;
    // Restore leading "%" to the test name (% was at end in OCR, belongs at front)
    if (trailingPct && !r2.test_name.startsWith('%')) {
      r2.test_name = '% ' + r2.test_name;
    }
    // Range: first try the original fixed string (may contain it),
    // then the range from the block (already set if found).
    if (!r2.raw_range) {
      const rangeInFixed = findRange(fixed, true);
      if (rangeInFixed) {
        const { range_min, range_max, raw_range } = parseRange(rangeInFixed);
        r2.range_min = range_min; r2.range_max = range_max; r2.raw_range = raw_range;
      }
    }
    return r2;
  }

  if (!nameMatch) return null;

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

  let valueStr   = valueMatch[1].replace(',', '.');
  let afterValue = afterNameSkipped.slice(valueMatch[0].length).trim();

  // ── Extend name when the parsed "value" is actually a digit in the name ──
  // Example: "Alpha 1 globulin electrophores 6.0 % H 1.9-4.8"
  //   nameRe stops at "Alpha" because "1" looks like a value.
  //   Detect: integer < 20 followed by letter-word(s) then a decimal number.
  if (/^\d+$/.test(valueStr) && parseInt(valueStr, 10) < 20) {
    const cont = afterValue.match(/^([a-zA-Z][a-zA-Z0-9 \-\/(),]*?)\s+(\d+[.,]\d+)\b/);
    if (cont && !looksLikeUnit(cont[1].trim().split(/\s+/)[0])) {
      name = (name + ' ' + valueStr + ' ' + cont[1]).trim().replace(/\s+/g, ' ');
      valueStr = cont[2].replace(',', '.');
      const valEndIdx = afterValue.indexOf(cont[2]) + cont[2].length;
      afterValue = afterValue.slice(valEndIdx).trim();
    }
  }

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
  let clean = fixed.replace(/[–—]/g, ' - ').replace(/^[\s,.()\[\]'"\-]+/, '').trim();
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
  console.log('[Ichilov] OCR text:\n', ocrText);
  const results: ParsedResult[] = [];
  // Map: dedup key → index in results array
  const seen = new Map<string, number>();

  function push(r: ParsedResult | null) {
    if (!r || r.test_name.length < 3) return;
    // Include unit in key so the same test with different units (e.g. % vs gr/l)
    // is stored as separate rows (electrophoresis PDFs have both).
    const key = r.test_name.toLowerCase() + '|' + (r.unit ?? '');
    if (!seen.has(key)) {
      seen.set(key, results.length);
      results.push(r);
    } else {
      // Replace existing if new result's value falls within its reference range
      // but the existing result's value doesn't (catches OCR misreads like 24 vs 2.0).
      const idx = seen.get(key)!;
      const ex = results[idx];
      const withinRange = (v: number | null, mn: number | null, mx: number | null) =>
        v !== null && mn !== null && mx !== null && v >= mn * 0.5 && v <= mx * 2;
      if (withinRange(r.value_num, r.range_min, r.range_max) &&
          !withinRange(ex.value_num, ex.range_min, ex.range_max)) {
        results[idx] = r;
      }
    }
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
  // When a result has no range, look at adjacent lines for one.
  const allLines = ocrText.split('\n');
  for (let li = 0; li < allLines.length; li++) {
    const line = allLines[li];
    if (/Catalog\s+D|CamScanner|SOURASKY|ICHILOV|STATE OF ISRAEL|Weizmann|Tel-Aviv|MINISTRY|MEDICAL CENTER/i.test(line)) continue;
    const r = tryParseCleanLine(line);
    push(r);
  }

  // ── Post-pass dedup: same test_name + same value → keep the one with range ─
  // Handles cases where the same test appears with and without units (different
  // dedup keys), e.g. "Protein, total" parsed from two places with same value.
  const finalMap = new Map<string, ParsedResult>();
  for (const r of results) {
    const k = r.test_name.toLowerCase() + '|' + (r.value_num ?? r.value_text ?? '');
    const ex = finalMap.get(k);
    if (!ex || (r.raw_range && !ex.raw_range)) {
      finalMap.set(k, r);
    }
  }
  return Array.from(finalMap.values());
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
