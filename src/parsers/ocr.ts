/**
 * parsers/ocr.ts — Render a PDF page to canvas, pre-process for best OCR
 * accuracy, then recognise with Tesseract.js (heb + eng).
 *
 * Pre-processing pipeline (all in-browser, no server):
 *   1. Render at 3× scale (vs 2× before) — biggest single win for digit accuracy.
 *   2. Apply CSS filter: grayscale + contrast boost before PDF render so
 *      faint scan artefacts are eliminated before Tesseract sees the image.
 *   3. Unsharp-mask convolution after render — sharpens digit edges so
 *      Tesseract doesn't insert spurious spaces inside numbers (e.g. "4 .4").
 */

import * as pdfjsLib from 'pdfjs-dist';
import { createWorker } from 'tesseract.js';

// ---------------------------------------------------------------------------
// Image pre-processing helpers
// ---------------------------------------------------------------------------

/**
 * Apply a 3×3 unsharp-mask (laplacian sharpen) to the canvas in-place.
 * Kernel:  [ 0 -1  0 ]
 *          [-1  5 -1 ]
 *          [ 0 -1  0 ]
 * Border pixels are copied unchanged.
 */
function sharpenCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s   = src.data;
  const d   = dst.data;
  const row = w * 4;

  // Interior pixels: apply kernel
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * row + x * 4;
      for (let c = 0; c < 3; c++) {
        d[i + c] = Math.min(255, Math.max(0,
          5 * s[i + c]
          - s[i - row + c]   // top
          - s[i + row + c]   // bottom
          - s[i - 4   + c]   // left
          - s[i + 4   + c],  // right
        ));
      }
      d[i + 3] = 255;
    }
  }

  // Border rows
  for (let x = 0; x < w; x++) {
    const t = x * 4;
    const b = (h - 1) * row + x * 4;
    for (let c = 0; c < 4; c++) { d[t + c] = s[t + c]; d[b + c] = s[b + c]; }
  }
  // Border columns
  for (let y = 1; y < h - 1; y++) {
    const l = y * row;
    const r = y * row + (w - 1) * 4;
    for (let c = 0; c < 4; c++) { d[l + c] = s[l + c]; d[r + c] = s[r + c]; }
  }

  ctx.putImageData(dst, 0, 0);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * OCR all pages of a PDF document and return the combined text.
 * `onProgress` receives 0–100 while OCR is running.
 */
export async function ocrPdfDoc(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  onProgress?: (pct: number) => void,
): Promise<string> {
  onProgress?.(0);

  // Load heb + eng language models (OEM 1 = LSTM neural network)
  const worker = await createWorker('heb+eng', 1, {
    logger: () => undefined,
  });

  const texts: string[] = [];
  const total = pdfDoc.numPages;

  for (let i = 1; i <= total; i++) {
    const page = await pdfDoc.getPage(i);

    // ── Step 1: render at 3× scale ──────────────────────────────────────────
    // Higher resolution gives Tesseract more pixels per character, reducing
    // misreads of close-together digits (e.g. "123" → "13.3").
    const viewport = page.getViewport({ scale: 3 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx      = canvas.getContext('2d')!;

    // ── Step 2: contrast boost before render ────────────────────────────────
    // grayscale(1)   — convert to greyscale so colour artefacts don't confuse OCR
    // contrast(1.6)  — punch up contrast so faint scan dots become white, dark
    //                  ink becomes pure black
    ctx.filter = 'grayscale(1) contrast(1.6)';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvasContext: ctx, viewport } as any).promise;

    // ── Step 3: unsharp mask ─────────────────────────────────────────────────
    // Sharpens digit edges so Tesseract doesn't insert whitespace inside
    // numbers like "4 .4" instead of "4.4".
    sharpenCanvas(ctx, canvas.width, canvas.height);

    const { data } = await worker.recognize(canvas);
    texts.push(data.text);

    onProgress?.(Math.round((i / total) * 95));
  }

  await worker.terminate();
  onProgress?.(100);

  return texts.join('\n');
}
