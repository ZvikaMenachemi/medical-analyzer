/**
 * parsers/hadassah/index.ts — Hadassah PDF parser entry point.
 *
 * Detection fingerprint:
 *   - Full text contains reversed Hebrew patterns for מספר רישום and תאריך תשובה
 *   - OR full text contains "מערך המעבדות" (Hadassah lab header)
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ParsedSession, TextItem } from '../types';
import { extractHeaderMetadata, ddmmyyyyToIso } from './metadata';
import { parseHadassahTable } from './table-parser';

export function isHadassahPdf(fullText: string): boolean {
  return (
    fullText.includes('מערך המעבדות') ||                  // Hadassah lab header (correct Hebrew)
    /\d{7,10}\s+מספר רישום/.test(fullText) ||             // record number pattern
    fullText.includes('תודבעמה ךרעמ') ||                  // מערך המעבדות reversed (legacy)
    /\d{7,10}\s*:\s*\S+\s+רפסמ/.test(fullText)            // reversed record num (legacy)
  );
}

async function extractPageItems(page: pdfjsLib.PDFPageProxy): Promise<TextItem[]> {
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const items: TextItem[] = [];

  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    items.push({
      str:      item.str,
      x:        tx[4],
      y:        tx[5],
      width:    item.width,
      height:   item.height,
    });
  }

  return items;
}

export async function parseHadassahPdf(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  filename: string,
): Promise<ParsedSession> {
  const textParts: string[] = [];
  const allPageItems: TextItem[][] = [];

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .filter(it => 'str' in it)
      .map(it => (it as { str: string }).str)
      .join(' ');
    textParts.push(pageText);

    const items = await extractPageItems(page);
    allPageItems.push(items);
  }

  const fullText = textParts.join('\n');
  const meta = extractHeaderMetadata(fullText);
  const results = parseHadassahTable(allPageItems);

  const isoDate = meta.date ? ddmmyyyyToIso(meta.date) : new Date().toISOString().slice(0, 10);

  // If no lab results were found, this is likely a Hadassah imaging / radiology report.
  // Detect the report type from the department text and store it as a single text record
  // so it appears in the timeline with date + source.
  if (results.length === 0) {
    const lowerText = fullText.toLowerCase();
    let imagingType = 'דיווח רפואי';
    if (lowerText.includes('אולטרסאונד') || lowerText.includes('ultrasound')) imagingType = 'אולטרסאונד';
    else if (lowerText.includes('טומוגרפיה') || lowerText.includes('c.t') || lowerText.includes(' ct ')) imagingType = 'CT';
    else if (lowerText.includes('mri') || lowerText.includes('תהודה מגנטית')) imagingType = 'MRI';
    else if (lowerText.includes('ביופיזיקה') || lowerText.includes('גרעיני') || lowerText.includes('nuclear')) imagingType = 'רפואה גרעינית';
    else if (lowerText.includes('רנטגן') || lowerText.includes('x-ray')) imagingType = 'רנטגן';

    const dept = meta.department ?? imagingType;

    return {
      record_num:        meta.record_num,
      date:              isoDate,
      lab_source:        'hadassah',
      department:        dept,
      material:          'הדמיה',
      urine_volume:      null,
      urine_hours:       null,
      original_filename: filename,
      version:           1,
      parse_confidence:  'high',
      results: [{
        category:     'הדמיה',
        test_name:    imagingType,
        value_num:    null,
        value_text:   dept,
        is_less_than: 0,
        is_numeric:   0,
        unit:         '',
        range_min:    null,
        range_max:    null,
        raw_range:    '',
        is_abnormal:  null,
        notes:        filename,
      }],
    };
  }

  return {
    record_num:       meta.record_num,
    date:             isoDate,
    lab_source:       'hadassah',
    department:       meta.department,
    material:         meta.material,
    urine_volume:     meta.urine_volume,
    urine_hours:      meta.urine_hours,
    original_filename: filename,
    version:          meta.version,
    parse_confidence: 'high',
    results,
  };
}
