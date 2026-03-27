/**
 * abnormal-detector.ts — Determine is_abnormal from domain indicator + range comparison.
 * Direct port of parser.py _parse_domain() and _compute_abnormal().
 */

/**
 * Parse the visual domain indicator [....#....].
 * Returns: 0 = normal, 1 = abnormal, null = unknown.
 *
 * Patterns:
 *   "[....#.....]"  — normal  (# inside brackets)
 *   "[.........]#"  — above range (# after closing bracket)
 *   "#[.........]"  — below range (# before opening bracket)
 */
export function parseDomain(domainStr: string): 0 | 1 | null {
  if (!domainStr || !domainStr.trim()) return null;

  const d = domainStr.trim();
  if (!d.includes('#')) return null;

  if (/^#\s*\[/.test(d))   return 1;  // below range
  if (/\]\s*#\s*$/.test(d)) return 1; // above range
  if (/^\[.*#.*\]$/.test(d)) return 0; // inside brackets = normal

  return null;
}

/**
 * Determine is_abnormal.
 * Prefers the domain indicator; falls back to value vs range comparison.
 */
export function computeAbnormal(
  valueNum: number | null,
  isLessThan: boolean,
  rangeMin: number | null,
  rangeMax: number | null,
  domainAbnormal: 0 | 1 | null,
): 0 | 1 | null {
  if (domainAbnormal !== null) return domainAbnormal;
  if (valueNum === null) return null;

  if (isLessThan) {
    if (rangeMin !== null && valueNum <= rangeMin) return 1;
    return null;
  }

  if (rangeMin !== null && valueNum < rangeMin) return 1;
  if (rangeMax !== null && valueNum > rangeMax) return 1;
  if (rangeMin !== null || rangeMax !== null) return 0;

  return null;
}
