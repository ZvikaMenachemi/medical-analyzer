/** Shared interfaces for parsed PDF sessions and results. */

export interface ParsedResult {
  category: string | null;
  test_name: string;
  value_num: number | null;
  value_text: string | null;
  is_less_than: number;   // 0 | 1
  is_numeric: number;     // 0 | 1
  unit: string;
  range_min: number | null;
  range_max: number | null;
  raw_range: string;
  is_abnormal: number | null;  // 0 | 1 | null
  notes: string;
}

export interface ParsedSession {
  record_num: string | null;
  date: string;               // ISO "YYYY-MM-DD"
  lab_source: string;         // "hadassah" | "maccabi" | "imaging" | "generic"
  department: string | null;
  material: string | null;
  urine_volume: number | null;
  urine_hours: number | null;
  original_filename: string;
  version: number;
  parse_confidence: 'high' | 'medium' | 'low';
  results: ParsedResult[];
}

/** Raw text item extracted by pdf.js */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
}

/** A row of text items grouped by approximate y-coordinate */
export type TextRow = TextItem[];
