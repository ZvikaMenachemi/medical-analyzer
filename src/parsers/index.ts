/**
 * parsers/index.ts — PDF parser dispatcher.
 *
 * 1. Load PDF with pdf.js
 * 2. Extract full text to detect which lab format it is
 * 3. Dispatch to the appropriate parser
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { ParsedSession } from './types';
import { isHadassahPdf, parseHadassahPdf } from './hadassah';
import { isMaccabiPdf, parseMaccabiPdf }  from './maccabi';
import { parseGenericPdf }                 from './generic';
import { ocrPdfDoc }                       from './ocr';

/**
 * True for ANY Hadassah-issued document (lab, imaging, nuclear medicine…).
 * These always contain the hospital name even if they have no lab table.
 * Must be checked BEFORE isMaccabiPdf because Hadassah documents can contain
 * "מכבי שרותי בריאות" as the patient's referring health-fund.
 */
function isAnyHadassahDoc(fullText: string): boolean {
  return (
    isHadassahPdf(fullText) ||
    fullText.includes('הסתדרות מדיצינית הדסה') ||
    fullText.includes('Hadassah medical organization')
  );
}

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

async function getFullText(pdfDoc: pdfjsLib.PDFDocumentProxy): Promise<string> {
  const parts: string[] = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page    = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    parts.push(
      content.items
        .filter(it => 'str' in it)
        .map(it => (it as { str: string }).str)
        .join(' ')
    );
  }
  return parts.join('\n');
}

export class NoTextError extends Error {
  constructor() {
    super('PDF_NO_TEXT');
    this.name = 'NoTextError';
  }
}

export async function parsePdf(
  file: File,
  onOcrProgress?: (pct: number) => void,
): Promise<ParsedSession> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = await getFullText(pdfDoc);

  // PDF has no extractable text — vector-path rendering (some Maccabi reports).
  // If an OCR progress callback was supplied, run OCR automatically.
  // Otherwise throw so the caller can ask the user first.
  if (fullText.trim().length < 20) {
    if (onOcrProgress) {
      fullText = await ocrPdfDoc(pdfDoc, onOcrProgress);
    } else {
      throw new NoTextError();
    }
  }

  if (isAnyHadassahDoc(fullText)) {
    return parseHadassahPdf(pdfDoc, file.name);
  }

  if (isMaccabiPdf(fullText)) {
    return parseMaccabiPdf(pdfDoc, file.name, fullText);
  }

  return parseGenericPdf(pdfDoc, file.name);
}
