/**
 * range-parser.ts — Parse a reference range string.
 * Direct port of parser.py _parse_range().
 */

export interface ParsedRange {
  range_min: number | null;
  range_max: number | null;
  raw_range: string;
}

export function parseRange(rangeStr: string): ParsedRange {
  if (!rangeStr || !rangeStr.trim()) {
    return { range_min: null, range_max: null, raw_range: '' };
  }

  const raw = rangeStr.trim();

  // Take only the first line — subsequent lines may be Hebrew footnotes
  let clean = raw.split('\n')[0].trim();

  // Remove gender qualifiers that may appear inline
  clean = clean.replace(/\s*(MALE|FEMALE)\b.*/i, '').trim();

  if (!clean) {
    return { range_min: null, range_max: null, raw_range: raw };
  }

  // One-sided lower bound: "> X"
  const gtMatch = clean.match(/^>\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (gtMatch) {
    return { range_min: parseFloat(gtMatch[1]), range_max: null, raw_range: raw };
  }

  // One-sided upper bound: "< X"
  const ltMatch = clean.match(/^<\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (ltMatch) {
    return { range_min: null, range_max: parseFloat(ltMatch[1]), raw_range: raw };
  }

  // Standard "min - max" (handles negative min like "-2 - 2")
  const rangeMatch = clean.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    return {
      range_min: parseFloat(rangeMatch[1]),
      range_max: parseFloat(rangeMatch[2]),
      raw_range: raw,
    };
  }

  // Text range ("Normal: No para protein")
  return { range_min: null, range_max: null, raw_range: raw };
}
