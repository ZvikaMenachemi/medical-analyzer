/**
 * value-parser.ts — Parse a result value string.
 * Direct port of parser.py _parse_value().
 */

export interface ParsedValue {
  value_num: number | null;
  value_text: string | null;
  is_less_than: number;
  is_numeric: number;
}

export function parseValue(valueStr: string): ParsedValue {
  if (!valueStr || !valueStr.trim()) {
    return { value_num: null, value_text: null, is_less_than: 0, is_numeric: 1 };
  }

  const v = valueStr.trim();

  // Less-than prefix: "< 15.0"
  if (v.startsWith('<')) {
    const num = parseFloat(v.slice(1).trim());
    if (!isNaN(num)) {
      return { value_num: num, value_text: null, is_less_than: 1, is_numeric: 1 };
    }
  }

  // Regular number (including negatives like -5.3)
  const num = parseFloat(v);
  if (!isNaN(num) && v.match(/^-?\d+(\.\d+)?$/)) {
    return { value_num: num, value_text: null, is_less_than: 0, is_numeric: 1 };
  }

  // Text result ("No para protein", "Positive", etc.)
  return { value_num: null, value_text: v, is_less_than: 0, is_numeric: 0 };
}
