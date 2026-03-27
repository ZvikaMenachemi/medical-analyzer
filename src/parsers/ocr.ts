/**
 * parsers/ocr.ts — Render a PDF page to canvas, then OCR it with Tesseract.js.
 *
 * Used only when pdfjs can't extract any text (vector-path PDFs such as the
 * Maccabi online portal reports).  Tesseract language data is downloaded on
 * first use and cached by the service worker; subsequent calls are fast.
 */

import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

/**
 * OCR all pages of a PDF document and return the combined text.
 * `onProgress` receives 0–100 while OCR is running.
 */
export async function ocrPdfDoc(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  onProgress?: (pct: number) => void,
): Promise<string> {
  onProgress?.(0);

  // Load heb + eng language models
  const worker = await createWorker('heb+eng', 1, {
    // Silence verbose Tesseract logs
    logger: () => undefined,
  });

  const texts: string[] = [];
  const total = pdfDoc.numPages;

  for (let i = 1; i <= total; i++) {
    const page     = await pdfDoc.getPage(i);
    // Scale 2× for better OCR accuracy
    const viewport = page.getViewport({ scale: 2 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx      = canvas.getContext('2d')!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data } = await worker.recognize(canvas);
    texts.push(data.text);

    onProgress?.(Math.round((i / total) * 95));
  }

  await worker.terminate();
  onProgress?.(100);

  return texts.join('\n');
}
