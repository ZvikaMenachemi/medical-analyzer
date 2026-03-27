/**
 * metadata.ts — Extract header metadata from Hadassah PDF full text.
 * Direct port of parser.py _extract_header_metadata(), updated for pdf.js.
 *
 * pdf.js returns Hebrew text in correct Unicode logical order (NOT reversed
 * like pdfplumber).  Items from RTL rows are often emitted right-to-left, so
 * labels may precede their values in the joined text:
 *
 *   מספר רישום <value>        (label first, value after)
 *   תשובה : תאריך <date>      (partial label, then date)
 *   גורם שולח <department>    (label first, value after)
 *   <material> חומר :         (value first, label after)
 *   גירסה <n>                 (label first, version after)
 */

export interface HadassahMetadata {
  record_num: string | null;
  date: string | null;        // "DD/MM/YYYY" — will be converted to ISO by the caller
  department: string | null;
  material: string | null;
  urine_volume: number | null;
  urine_hours: number | null;
  version: number;
}

export function extractHeaderMetadata(fullText: string): HadassahMetadata {
  const meta: HadassahMetadata = {
    record_num:   null,
    date:         null,
    department:   null,
    material:     null,
    urine_volume: null,
    urine_hours:  null,
    version:      1,
  };

  // Order number (מספר רישום) — appears as "<digits> מספר רישום" in pdf.js output
  let m = fullText.match(/(\d{7,10})\s+מספר רישום/);
  if (m) meta.record_num = m[1];

  // Result date (תאריך תשובה) — appears as "תשובה : תאריך DD/MM/YYYY"
  m = fullText.match(/תשובה[^0-9\n]{0,30}(\d{2}\/\d{2}\/\d{4})/);
  if (m) {
    meta.date = m[1];
  } else {
    // Fall back: arrival date (תאריך הגעה) — appears as "הגעה תאריך : DD/MM/YYYY"
    m = fullText.match(/הגעה[^0-9\n]{0,30}(\d{2}\/\d{2}\/\d{4})/);
    if (m) meta.date = m[1];
    else {
      // Last resort: first date-like token
      m = fullText.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (m) meta.date = m[1];
    }
  }

  // Department (גורם שולח) — label precedes value: "גורם שולח <value>"
  // Value ends at next known label or end-of-relevant-section
  m = fullText.match(/גורם שולח\s+(.+?)(?=\s+(?:מין|כתובת|טלפון|רופא שולח|מס' רשומה)|$)/);
  if (m) meta.department = m[1].trim();

  // Material (חומר) — value precedes label: "<material> חומר :"
  // E.g. "דם חומר :" or "שתן חומר :"
  m = fullText.match(/(\S+)\s+חומר\s*[:\s]/);
  if (m) {
    let rawMat = m[1].trim();
    // Strip accidental numeric/colon prefix from urine lines
    rawMat = rawMat.replace(/^\d+\s*/, '').trim();
    if (rawMat) meta.material = rawMat;
  }

  // Urine volume — "חפנ" was reversed pdfplumber; pdf.js: "<volume> : נפח" or "נפח : <volume>"
  let volM = fullText.match(/(\d+)\s*:\s*נפח/) ?? fullText.match(/נפח\s*:\s*(\d+)/);
  if (volM) meta.urine_volume = parseInt(volM[1], 10);

  // Urine hours — "(<hours>) שעות" or similar
  let hrsM = fullText.match(/(\d+)\s*:\s*שעות/) ?? fullText.match(/שעות\s*:\s*(\d+)/);
  if (hrsM) meta.urine_hours = parseInt(hrsM[1], 10);

  // Revised version (גירסה) — "גירסה <n>" or "<n> גירסה"
  m = fullText.match(/גירסה\s+(\d+)/) ?? fullText.match(/(\d+)\s+גירסה/);
  if (m) meta.version = parseInt(m[1], 10);

  return meta;
}

/** Convert "DD/MM/YYYY" to ISO "YYYY-MM-DD" */
export function ddmmyyyyToIso(d: string): string {
  const [day, month, year] = d.split('/');
  return `${year}-${month}-${day}`;
}
