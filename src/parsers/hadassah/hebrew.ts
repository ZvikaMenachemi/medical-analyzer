/**
 * hebrew.ts — Restore correct Hebrew from text extracted in visual (reversed) order.
 * Direct port of parser.py _fix_hebrew().
 *
 * In Hadassah PDFs, pdfplumber (and sometimes pdf.js) extracts Hebrew text in visual
 * order (RTL), so each Hebrew word has its characters reversed and the word order
 * within RTL runs is also reversed. Numbers and punctuation stay correct.
 */

function isHebrew(word: string): boolean {
  return /[\u05d0-\u05ea]/.test(word);
}

export function fixHebrew(text: string): string {
  if (!text) return text;
  const words = text.split(/\s+/);
  const result: string[] = [];
  for (const word of [...words].reverse()) {
    if (isHebrew(word)) {
      result.push(word.split('').reverse().join(''));
    } else {
      result.push(word);
    }
  }
  return result.join(' ');
}
